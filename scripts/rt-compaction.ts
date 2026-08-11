import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import { signDevToken } from "@hamboom/realtime";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  writeElement,
} from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

/**
 * ★★ معیارِ پذیرشِ گام ۴٫۴ — **فشرده‌سازی با زیرساختِ واقعی**.
 *
 * «بعد از ۵۰۰ update، snapshot ساخته می‌شود، updateهای قدیمی حذف می‌شوند، و یک
 * کلاینتِ تازه **دقیقاً همان سند** را می‌گیرد (مقایسه‌ی state vector).»
 *
 * ── چرا اسکریپت است و نه تستِ vitest ──────────────────────────────────
 *
 * همان درسِ گران‌قیمتِ گام ۴٫۳: آنجا تستِ SIGKILL سه باگ گرفت که **هر ۵۰ تستِ
 * واحد** سبز از رویشان رد شده بودند — چون لاگِ حافظه‌ای `uuid` نمی‌فهمید و
 * محیطِ vitest همان Node نبود. اینجا ریسک دقیقاً از همان جنس است و **گران‌تر**:
 * فشرده‌سازی تنها جای M2 است که داده‌ی پایدار را **پاک می‌کند**. یک لاگِ
 * حافظه‌ای هیچ‌وقت ثابت نمی‌کند که `DELETE`ِ واقعی به‌اندازه‌ی درست بوده.
 *
 * ★ و سرور **بینِ فشرده‌سازی و خواندن، کشته و دوباره بالا آورده می‌شود** — وگرنه
 * کلاینتِ دوم به همان اتاقِ درون‌حافظه‌ای وصل می‌شد و مسیرِ «بارگذاری از
 * snapshot» — که کلِ ریسکِ این گام است — اصلاً اجرا نمی‌شد.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:compaction
 */

const SECRET = "hamboom-compaction-secret-at-least-32-chars";
const PORT = 15391;
const UPDATES = 500;
const SNAPSHOT_DIR = resolve(".hamboom", "snapshots-probe");

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

function startServer(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"],
    {
      env: {
        ...process.env,
        RT_PORT: String(PORT),
        RT_DEV_JWT_SECRET: SECRET,
        RT_SNAPSHOT_DIR: SNAPSHOT_DIR,
        RT_SNAPSHOT_EVERY_UPDATES: String(UPDATES),
        // ⚠️ آستانه‌ی زمانی عمداً **بزرگ** است: وگرنه معلوم نمی‌شود فشرده‌سازی به
        //    خاطرِ رسیدن به ۵۰۰ رخ داده یا فقط چون یک دقیقه گذشته.
        RT_SNAPSHOT_EVERY_MS: String(3_600_000),
        APP_ENV: "local",
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error("سرور در ۲۰ ثانیه بالا نیامد")), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim() && !line.includes("realtime آماده است")) {
          process.stdout.write(`  │ ${line.trim()}\n`);
        }
      }
      if (text.includes("realtime آماده است")) {
        clearTimeout(timer);
        resolve_(child);
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
  /** سندِ محلی — هر پیامِ SYNCِ ورودی روی آن اعمال می‌شود. */
  doc: Y.Doc;
  seq(): number;
  waitForSeq(atLeast: number, timeoutMs?: number): Promise<void>;
  waitForElements(count: number, timeoutMs?: number): Promise<void>;
  close(): void;
}

/**
 * کلاینتِ واقعی که **پیام‌های سرور را هم می‌خوانَد**.
 *
 * ★ خواندنِ ورودی حیاتی است، نه آرایش: بدونش سندِ محلی opِ `meta`ِ خودِ سرور را
 * هرگز نمی‌گیرد و مقایسه‌ی state vector همیشه شکست می‌خورد — نه به خاطرِ باگ،
 * بلکه چون دو سند اصلاً یک چیز را ندیده‌اند.
 */
function connect(boardId: string, token: string, doc: Y.Doc): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/rt?board=${boardId}&token=${token}`);
  let latestSeq = 0;

  // ⚠️ سکوت اینجا گران است: اگر سرور وسطِ کار ببندد، بدونِ این خط فقط یک
  //    timeoutِ بی‌معنی می‌بینی و دنبالِ باگ در جای اشتباه می‌گردی.
  socket.on("close", (code, reason) => {
    process.stdout.write(`  ⚑ سوکت بسته شد: ${String(code)} ${reason.toString()}\n`);
  });
  socket.on("error", (error) => {
    process.stdout.write(`  ⚑ خطای سوکت: ${String(error)}\n`);
  });

  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ROOM_INFO) {
      latestSeq = message.seq;
      return;
    }
    if (message.type !== MSG_TYPES.SYNC) return;
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.payload),
      reply,
      doc,
      "probe",
      () => {},
    );
    if (encoding.length(reply) > 0) {
      socket.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(reply) }));
    }
  });

  function until(check: () => boolean, what: string, timeoutMs: number): Promise<void> {
    return new Promise((done, reject) => {
      if (check()) {
        done();
        return;
      }
      const started = Date.now();
      const timer = setInterval(() => {
        if (check()) {
          clearInterval(timer);
          done();
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(what));
        }
      }, 50);
    });
  }

  return new Promise((resolve_, reject) => {
    socket.once("error", reject);
    socket.once("open", () =>
      resolve_({
        socket,
        doc,
        seq: () => latestSeq,
        waitForSeq: (atLeast, timeoutMs = 60_000) =>
          until(
            () => latestSeq >= atLeast,
            // ★ عددِ رسیده را بگو، نه فقط عددِ انتظار — تفاوتِ «هیچ نرسید» و
            //   «۴۹۹ رسید» دو باگِ کاملاً متفاوت است.
            `seq به ${atLeast} نرسید`,
            timeoutMs,
          ).catch((error: unknown) => {
            throw new Error(`${String(error)} (رسید: ${latestSeq})`);
          }),
        waitForElements: (count, timeoutMs = 30_000) =>
          until(
            () => boardRoots(doc).elements.size >= count,
            `سند به ${count} عنصر نرسید`,
            timeoutMs,
          ),
        close: () => socket.close(),
      }),
    );
  });
}

function sticky(id: string, index: number) {
  return {
    id,
    type: "rectangle",
    x: index * 3,
    y: index * 5,
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
  } as never;
}

interface SnapshotRow {
  seq_upto: string;
  storage_key: string;
  byte_size: string;
  element_count: number;
}

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const boardId = randomUUID();
  const token = signDevToken(
    { sub: randomUUID(), boardId, role: "editor", exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );

  process.stdout.write(`▶ بورد: ${boardId}\n`);
  await rm(join(SNAPSHOT_DIR, boardId), { recursive: true, force: true });

  const db = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();

  // ── ۱) ۵۰۰ updateِ واقعی از یک کلاینتِ واقعی ────────────────────
  let server = await startServer();
  const doc = createBoardDoc();
  const client = await connect(boardId, token, doc);

  /**
   * ★★ **هر ژست منتظرِ ackِ خودش می‌مانَد، و این آرایش نیست.**
   *
   * اولین نسخه‌ی این سنجه هر ۵۰۰ پیام را در **یک** تیک می‌فرستاد و نتیجه‌اش
   * `seq = 1` بود. باگ نبود: Yjs `applyUpdate`هایی را که در پاکسازیِ یک تراکنش
   * به هم می‌رسند **در یک تراکنش ادغام می‌کند**، پس ۵۰۰ پیام یک رویدادِ
   * `update` و یک ردیفِ لاگ شد. داده گم نشد — همه‌اش داخلِ همان یک ردیف بود.
   *
   * ⚠️ ولی آن‌وقت این سنجه چیزی را که ادعا می‌کند **نمی‌سنجد**: آستانه‌ی
   * فشرده‌سازی روی **ردیف‌های لاگ** است و یک ردیف چیزی برای فشردن ندارد.
   * یک تیکِ `setImmediate` هم کافی نبود (۳۵۴ ردیف از ۵۰۰) چون پیام‌ها روی TCP
   * دسته‌دسته می‌رسند و باز هم در یک نوبتِ حلقه ادغام می‌شوند.
   *
   * ★ پس هر ژست منتظرِ `seq`ِ خودش می‌مانَد — هم قطعی است، هم همان کاری است که
   * کاربرِ واقعی می‌کند: ژستِ بعدی بعد از دیدنِ نتیجه‌ی قبلی می‌آید.
   */
  // ★ مبدأ را **بعد** از آرام گرفتنِ تبادلِ اتصال بگیر: پاسخِ step2ِ خودِ کلاینت
  //   هم یک ردیف است و جزوِ ژست‌های ما نیست.
  await new Promise((settle) => setTimeout(settle, 300));
  const seq0 = client.seq();
  process.stdout.write(`  · مبدأ بعد از تبادلِ اتصال: seq=${seq0}\n`);

  const startedAt = Date.now();
  for (let index = 0; index < UPDATES; index++) {
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      writeElement(
        boardRoots(doc).elements,
        sticky(`stk_${String(index).padStart(4, "0")}`, index),
      );
    });
    const encoder = encoding.createEncoder();
    // ★ updateِ **افزایشی** — همان چیزی که binder روی سیم می‌فرستد.
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc, before));
    client.socket.send(
      encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(encoder) }),
    );
    await client.waitForSeq(seq0 + index + 1, 20_000);
  }
  const elapsed = Date.now() - startedAt;
  process.stdout.write(
    `✔ ${UPDATES} update در ${elapsed}ms نوشته شد (seq=${client.seq()}، ~${Math.round(elapsed / UPDATES)}ms هرکدام)\n`,
  );

  // ── ۲) snapshot باید ساخته شود ──────────────────────────────────
  const deadline = Date.now() + 60_000;
  let snapshot: SnapshotRow | undefined;
  while (Date.now() < deadline) {
    const rows = await db.query<SnapshotRow>(
      "SELECT seq_upto, storage_key, byte_size, element_count FROM board_snapshots WHERE board_id = $1 ORDER BY seq_upto DESC",
      [boardId],
    );
    snapshot = rows.rows[0];
    if (snapshot) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!snapshot) {
    await db.end();
    server.kill("SIGKILL");
    fail(`بعد از ${UPDATES} update هیچ snapshotی در board_snapshots نیست. گام قبول نیست.`);
  }
  const seqUpto = Number(snapshot.seq_upto);
  process.stdout.write(
    `✔ snapshot ثبت شد: seq_upto=${seqUpto}، ${snapshot.element_count} عنصر، ${snapshot.byte_size} بایت\n`,
  );

  // بایت‌ها واقعاً روی دیسک‌اند؟
  const file = join(SNAPSHOT_DIR, snapshot.storage_key);
  try {
    await access(file);
  } catch {
    await db.end();
    server.kill("SIGKILL");
    fail(`رکوردِ snapshot هست ولی فایلش نیست: ${file}. گام قبول نیست.`);
  }
  process.stdout.write(`✔ بایت‌ها روی دیسک‌اند: ${snapshot.storage_key}\n`);

  // ── ۳) ★ updateهای قدیمی واقعاً حذف شدند؟ ───────────────────────
  const remaining = await db.query<{ count: string; min: string | null }>(
    "SELECT COUNT(*) AS count, MIN(seq) AS min FROM board_updates WHERE board_id = $1",
    [boardId],
  );
  const left = Number(remaining.rows[0]?.count ?? 0);
  const minSeq = remaining.rows[0]?.min === null ? null : Number(remaining.rows[0]?.min);
  if (left >= UPDATES) {
    await db.end();
    server.kill("SIGKILL");
    fail(`updateهای قدیمی حذف نشدند (${left} ردیف مانده). گام قبول نیست.`);
  }
  if (minSeq !== null && minSeq <= seqUpto) {
    await db.end();
    server.kill("SIGKILL");
    fail(`ردیفی با seq=${minSeq} <= seq_upto=${seqUpto} مانده — حذف ناقص بوده.`);
  }
  process.stdout.write(`✔ ${UPDATES - left} ردیف حذف شد؛ ${left} ردیفِ بعد از مرز باقی است\n`);

  // ── ۴) ★★ سرور را بکش تا کلاینتِ بعدی **از snapshot** بخواند ─────
  client.close();
  server.kill("SIGKILL");
  await new Promise((r) => server.once("exit", r));
  process.stdout.write("✔ سرور کشته شد — اتاقِ درون‌حافظه‌ای از بین رفت\n");

  server = await startServer();
  const freshDoc = new Y.Doc();
  const fresh = await connect(boardId, token, freshDoc);
  await fresh.waitForElements(UPDATES);

  /**
   * ── ۵) ★★ دقیقاً همان سند؟ ────────────────────────────────────────
   *
   * ⚠️ **مقایسه با سندِ کلاینتِ اول سنجه‌ی درستی نبود، و آزمایش نشانش داد:**
   *
   *   کلاینتِ تازه : 1459188504:17001
   *   بعد از ادغام : 1459188504:17001  323570919:1
   *
   * محتوا (۱۷۰۰۱ op) مو‌به‌مو یکی بود؛ تنها تفاوت یک opِ تک‌تاییِ `meta` بود که
   * **اتاقِ مرده‌ی اول** موقعِ ساخته‌شدن زده بود. آن op هرگز پایدار نمی‌شود
   * (originش `ClientOrigin` نیست) و ربطی به فشرده‌سازی ندارد.
   *
   * ★ پس مرجع را عوض می‌کنیم: **مستقیماً از دیتابیس**. یک سند از
   * `snapshot + updateهای باقی‌مانده` ساخته می‌شود — بدونِ رد شدن از هیچ کدِ
   * سروری — و state vectorش باید **بایت‌به‌بایت** با کلاینتِ تازه یکی باشد.
   * این هم دقیقاً همان چیزی است که TODO خواسته، هم یک شاهدِ **مستقل** است:
   * اگر بارگذاریِ سرور و محتوای دیتابیس از هم واگرا شوند، همین‌جا لو می‌رود.
   */
  const elements = boardRoots(freshDoc).elements.size;
  const mineIds = [...boardRoots(doc).elements.keys()].sort();
  const theirIds = [...boardRoots(freshDoc).elements.keys()].sort();

  const oracle = new Y.Doc();
  const snapBytes = new Uint8Array(await readFile(file));
  const tail = await db.query<{ payload: Buffer }>(
    "SELECT payload FROM board_updates WHERE board_id = $1 AND seq > $2 ORDER BY seq ASC",
    [boardId, seqUpto],
  );
  oracle.transact(() => {
    Y.applyUpdate(oracle, snapBytes);
    for (const row of tail.rows) Y.applyUpdate(oracle, new Uint8Array(row.payload));
  });

  const beforeMerge = Y.encodeStateVector(freshDoc);
  const afterMerge = Y.encodeStateVector(oracle);
  const sameVector =
    beforeMerge.length === afterMerge.length && beforeMerge.every((b, i) => b === afterMerge[i]);
  const oracleIds = [...boardRoots(oracle).elements.keys()].sort();

  fresh.close();
  server.kill("SIGKILL");
  await db.end();

  if (!sameVector) {
    // ⚠️ «۱۵ بایت در برابرِ ۱۵ بایت» چیزی به کسی نمی‌گوید. تفاوت را **باز کن**:
    //    کدام کلاینت، با کدام ساعت — وگرنه ساعت‌ها دنبالِ باگ در جای اشتباه.
    const show = (v: Uint8Array) =>
      [...Y.decodeStateVector(v).entries()].map(([c, k]) => `${c}:${k}`).join(" ");
    process.stdout.write(
      `  ⚑ کلاینتِ تازه : ${show(beforeMerge)}\n  ⚑ دیتابیس      : ${show(afterMerge)}\n`,
    );
    fail("state vectorِ کلاینتِ تازه با محتوای دیتابیس یکی نیست. گام قبول نیست.");
  }
  if (elements !== UPDATES || mineIds.join() !== theirIds.join()) {
    fail(`مجموعه‌ی عناصر یکی نیست: ${theirIds.length} در برابرِ ${mineIds.length}. گام قبول نیست.`);
  }
  if (oracleIds.join() !== mineIds.join()) {
    fail(`دیتابیس ${oracleIds.length} عنصر دارد، کلاینتِ اول ${mineIds.length}. گام قبول نیست.`);
  }
  process.stdout.write(
    `✔ کلاینتِ تازه هر ${elements} عنصر را گرفت — و state vectorش **بایت‌به‌بایت** با دیتابیس یکی است\n`,
  );

  await rm(join(SNAPSHOT_DIR, boardId), { recursive: true, force: true });
  process.stdout.write(
    `\n✔ فشرده‌سازی تایید شد. ${UPDATES} update → یک snapshot تا seq=${seqUpto}، ${UPDATES - left} ردیفِ حذف‌شده.\n`,
  );
  process.exit(0);
}

void main().catch((error: unknown) => fail(String(error)));
