import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  writeElement,
} from "@hamboom/ydoc-schema";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

import { gaugeChildEnv, seedBoardMember, seedToken } from "./rt-seed.ts";

/**
 * ★★ تستِ **کشتنِ سرور** — معیارِ پذیرشِ گام ۴٫۳.
 *
 * «کلاینت یک ژست می‌زند و `saved` می‌بیند → پروسه با **SIGKILL** کشته می‌شود →
 * سرور بالا می‌آید → **آن ژست هنوز هست**. اگر `saved` دیده شده باشد و داده
 * نباشد، این گام قبول نیست.»
 *
 * ── چرا اسکریپت است و نه تستِ vitest ──────────────────────────────────
 *
 * همان دلیلِ `db:smoke` (گام ۰٫۳): این بررسی به PostgreSQLِ **زنده** و به یک
 * **پروسه‌ی واقعی** نیاز دارد که بشود کشتش. اگر تستِ عادی بود، یا `pnpm test`
 * روی ماشینِ بدونِ داکر قرمز می‌شد یا خودش را skip می‌کرد — و skip یک سبزِ
 * دروغین است، دقیقاً در جایی که کمترین جایش را دارد.
 *
 * ⚠️ **SIGKILL و نه SIGTERM**: با SIGTERM سرور فرصتِ خاموشیِ مودبانه دارد و
 * می‌تواند هرچه در بافر دارد بنویسد — یعنی تست چیزی را می‌سنجد که ادعا نکرده‌ایم.
 * ادعای ما این است که در لحظه‌ی `saved`، داده **از قبل** روی دیسک است.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:durability
 */

const PORT = 15390;

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

/** سرور را بالا می‌آورد و تا «آماده است» صبر می‌کند. */
function startServer(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"],
    {
      env: gaugeChildEnv(PORT), // ★ فاز ۷: رازِ سنجه + S3/DB/Redis از .env
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("سرور در ۲۰ ثانیه بالا نیامد")), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // ★ لاگِ سرور رد می‌شود بیرون: بارِ اول که این اسکریپت افتاد، علتش در
      //   همین خطوط بود ولی دیده نمی‌شد چون بلعیده می‌شدند.
      for (const line of text.split("\n")) {
        if (line.trim() && !line.includes("realtime آماده است")) {
          process.stdout.write(`  │ ${line.trim()}\n`);
        }
      }
      if (text.includes("realtime آماده است")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`سرور با کد ${String(code)} بسته شد`));
    });
  });
}

interface Client {
  socket: WebSocket;
  /**
   * ★★ صبر تا `HB_ROOM_INFO{save:"saved"}` با `seq`ِ **بزرگ‌تر از `afterSeq`**.
   *
   * ⚠️ **شرطِ `seq` حیاتی است، نه آرایش.** نسخه‌ی اولِ این اسکریپت فقط منتظرِ
   * «`saved`» می‌مانْد و همان پیامِ **زمانِ join** را می‌گرفت — که درباره‌ی بوردِ
   * بارگذاری‌شده حرف می‌زند، نه درباره‌ی ژستِ ما. نتیجه: «ذخیره شد» در ۵۹ms، و
   * صفر ردیف در دیتابیس. یعنی تست داشت **ackِ اشتباه** را می‌سنجید و یک باگِ
   * واقعی را می‌پوشاند.
   */
  waitForSavedAfter(afterSeq: number): Promise<number>;
  /** آخرین `seq`ی که سرور اعلام کرده. */
  seq(): number;
  close(): void;
}

function connect(boardId: string, token: string): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/rt?board=${boardId}&token=${token}`);
  let latestSeq = 0;
  let onSaved: ((seq: number, at: number) => void) | null = null;

  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (message?.type !== MSG_TYPES.HB_ROOM_INFO) return;
    latestSeq = message.seq;
    if (message.save === "saved") onSaved?.(message.seq, Date.now());
  });

  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("open", () =>
      resolve({
        socket,
        seq: () => latestSeq,
        waitForSavedAfter: (afterSeq) =>
          new Promise<number>((done, rejectSaved) => {
            const timer = setTimeout(
              () => rejectSaved(new Error(`«ذخیره شد» با seq > ${afterSeq} نیامد`)),
              10_000,
            );
            onSaved = (seq, at) => {
              if (seq <= afterSeq) return;
              clearTimeout(timer);
              done(at);
            };
          }),
        close: () => socket.close(),
      }),
    );
  });
}

/** یک ژستِ واقعی: یک استیکی روی سند، به‌صورت پیامِ SYNC. */
function gesture(elementId: string): Uint8Array {
  const doc = createBoardDoc();
  doc.transact(() => {
    writeElement(boardRoots(doc).elements, {
      id: elementId,
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      angle: 0,
      index: "a1",
      frameId: null,
      groupIds: [],
      locked: false,
      strokeColor: "#1a1a1a",
      backgroundColor: "#FFF9B1",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: 0,
      isDeleted: false,
      boundElements: null,
      link: null,
      customData: {
        hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
      },
    } as never);
  });

  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
  return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(encoder) });
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });
  // ★ فاز ۷: بوردِ واقعی + عضوِ editor + توکنِ واقعی — نقش از readerِ pgِ مشترک خوانده می‌شود.
  const seed = await seedBoardMember(pool, "editor");
  const boardId = seed.boardId;
  const elementId = `stk_${randomUUID().slice(0, 8)}`;
  const token = await seedToken(seed.userId, boardId, "editor");

  process.stdout.write(`▶ بورد: ${boardId}\n`);

  // ── ۱) سرور، کلاینت، یک ژست، و انتظار برای «ذخیره شد» ──────────
  let server = await startServer();
  const client = await connect(boardId, token);

  // ★ نقطه‌ی شروع: هرچه سرور تا اینجا اعلام کرده (بوردِ نو یعنی صفر).
  const seqAtJoin = client.seq();
  const saved = client.waitForSavedAfter(seqAtJoin);
  const sentAt = Date.now();
  client.socket.send(gesture(elementId));
  const savedAt = await saved;
  const latency = savedAt - sentAt;
  process.stdout.write(`✔ «ذخیره شد» (seq > ${seqAtJoin}) بعد از ${latency}ms رسید\n`);

  // ── ۲) ★ SIGKILL — بدونِ هیچ فرصتی برای تخلیه‌ی بافر ────────────
  server.kill("SIGKILL");
  await new Promise((resolve) => server.once("exit", resolve));
  process.stdout.write("✔ سرور با SIGKILL کشته شد\n");

  // ── ۳) آیا داده روی دیسک است؟ ──────────────────────────────────
  const rows = await pool.query<{ payload: Buffer }>(
    "SELECT payload FROM board_updates WHERE board_id = $1 ORDER BY seq ASC",
    [boardId],
  );
  if (rows.rowCount === 0) {
    fail("هیچ ردیفی در board_updates نیست — کلاینت «ذخیره شد» دید ولی داده نیست. گام قبول نیست.");
  }

  const restored = createBoardDoc();
  for (const row of rows.rows) Y.applyUpdate(restored, new Uint8Array(row.payload));
  if (!boardRoots(restored).elements.has(elementId)) {
    fail(`عنصر ${elementId} در سندِ بازسازی‌شده نیست. گام قبول نیست.`);
  }
  process.stdout.write(`✔ ${rows.rowCount} ردیف در board_updates؛ عنصر در سندِ بازسازی‌شده هست\n`);

  // ── ۴) ★ و سرورِ تازه هم همان را سرو می‌کند ─────────────────────
  server = await startServer();
  const second = await connect(boardId, token);
  const doc = new Y.Doc();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("سندی از سرورِ تازه نیامد")), 10_000);
    second.socket.on("message", (data: Buffer) => {
      const message = decodeMessage(new Uint8Array(data));
      if (message?.type !== MSG_TYPES.SYNC) return;
      syncProtocol.readSyncMessage(
        { arr: message.payload, pos: 0 } as never,
        encoding.createEncoder(),
        doc,
        null,
        () => {},
      );
      if (boardRoots(doc).elements.has(elementId)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  process.stdout.write("✔ سرورِ تازه همان ژست را سرو کرد\n");

  second.close();
  server.kill("SIGKILL");
  await pool.end();

  process.stdout.write(`\n✔ دوام تایید شد. تاخیرِ «ذخیره شد»: ${latency}ms\n`);
  process.exit(0);
}

void main().catch((error: unknown) => fail(String(error)));
