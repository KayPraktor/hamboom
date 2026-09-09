/**
 * ★★ رساندنِ ایمیج‌ها به VM — M5-D10 ([ADR-063](../ARCHITECTURE_DECISIONS.md#adr-063)).
 *
 * ```bash
 * pnpm infra:ship                      # ★ تمرینِ محلی: save → load → راستی‌آزمایی
 * pnpm infra:ship -- --to=root@1.2.3.4 # انتقالِ واقعی روی ssh
 * pnpm infra:ship -- --self-test       # ★★ سه سناریو، دو شکستنِ عمدی
 * pnpm infra:ship -- --build --tag=$(git rev-parse --short HEAD)
 * ```
 *
 * ── چرا `docker save` و نه رجیستری ───────────────────────────────────────
 *
 * دلیلِ کامل در ADR-063 است؛ خلاصه‌اش یک اندازه‌گیری: هر سه ایمیج با `docker save`
 * **۱۸۵MB** می‌شوند (و api تنها ۱۱۹MB)، نه ۱٫۲GBی که `docker images` نشان می‌دهد. با آن
 * عدد، رجیستری دو وابستگیِ شبکه‌ایِ خارج از کنترلِ ما اضافه می‌کند تا چند دقیقه صرفه‌جویی
 * کند.
 *
 * ── ★ «فرستادم» تا وقتی خوانده نشود ادعاست ───────────────────────────────
 *
 * همان قاعده‌ی `backup-db` و مشقِ بازیابی: بعد از `docker load`، **هر سه تگ در مقصد
 * `inspect` می‌شوند و شناسه‌شان با مبدأ سنجیده می‌شود**. یک `docker load` که خطایش را
 * ببلعد یا فقط دو تا از سه ایمیج را بیاورد، بدونِ این چک «موفق» دیده می‌شود.
 *
 * ── ⚠️ تله‌ای که اندازه‌گیری شد ───────────────────────────────────────────
 *
 * روی این محیط `docker save -o <file> <یک ایمیج>` فایلِ **صفر بایتی** می‌سازد، در حالی که
 * همان دستور با **سه** ایمیج ۱۸۵MB می‌نویسد. علتش ایزوله نشد و ادعایی درباره‌اش نمی‌کنیم —
 * ولی مسیرِ قابلِ‌اتکا **stdout** است، پس این‌جا هیچ‌جا `-o` استفاده نمی‌شود.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** سه ایمیجی که استکِ production از آن‌ها ساخته می‌شود. */
export const IMAGES = ["api", "realtime", "web"] as const;

/** ایمیج‌های پایه — فقط با `--base`، برای VMی که به Docker Hub نمی‌رسد. */
const BASE_IMAGES = ["postgres:16-alpine", "redis:7-alpine"];

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: string[],
  io: { outFile?: string; inFile?: string } = {},
): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    if (io.outFile !== undefined && child.stdout !== null) {
      child.stdout.pipe(createWriteStream(io.outFile));
    } else if (child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => (stdout += c));
    }
    child.stderr?.setEncoding("utf8").on("data", (c: string) => (stderr += c));

    if (io.inFile !== undefined && child.stdin !== null) {
      createReadStream(io.inFile).pipe(child.stdin);
      // ⚠️ اگر مقصد زودتر بمیرد (آرشیوِ خراب)، نوشتن روی stdinِ بسته EPIPE می‌دهد.
      //    تصمیم با کدِ خروجِ فرایند است، نه با این.
      child.stdin.on("error", () => undefined);
    } else {
      child.stdin?.end();
    }

    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function tagsFor(tag: string): string[] {
  return IMAGES.map((name) => `hamboom/${name}:${tag}`);
}

/** شناسه‌ی محتوایی هر تگ — مبنای مقایسه‌ی مبدأ و مقصد. */
async function imageIds(
  tags: string[],
  remote: string | null,
): Promise<Record<string, string | null>> {
  const ids: Record<string, string | null> = {};
  for (const tag of tags) {
    const args = ["image", "inspect", "-f", "{{.Id}}", tag];
    const result =
      remote === null ? await run("docker", args) : await run("ssh", [remote, "docker", ...args]);
    ids[tag] = result.code === 0 ? result.stdout.trim() : null;
  }
  return ids;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * آرشیو را در مقصد بارگذاری می‌کند و **اثبات می‌کند** هر سه تگ رسیده‌اند.
 *
 * `remote === null` یعنی تمرینِ محلی: همان مسیر، بدونِ ssh. عمداً همان تابع است تا
 * تمرین دقیقاً چیزی را بسنجد که انتقالِ واقعی انجام می‌دهد، نه یک بدلِ موازی.
 */
export async function loadAndVerify(
  archive: string,
  tags: string[],
  sourceIds: Record<string, string | null>,
  remote: string | null,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const where = remote === null ? "محلی" : remote;

  const load =
    remote === null
      ? await run("docker", ["load"], { inFile: archive })
      : await run("ssh", [remote, "docker", "load"], { inFile: archive });

  checks.push({
    name: `‏docker load در ${where} با کدِ صفر تمام می‌شود`,
    ok: load.code === 0,
    detail:
      load.code === 0
        ? load.stdout.trim().split(/\r?\n/).slice(-3).join(" · ") || "بارگذاری شد"
        : `کدِ ${String(load.code)} · ${load.stderr.trim().split(/\r?\n/).slice(-2).join(" · ").slice(0, 200)}`,
  });

  // ★★ چکِ لازم: بدونِ این، آرشیوی که فقط دو تا از سه ایمیج را دارد «موفق» دیده می‌شود.
  const targetIds = await imageIds(tags, remote);
  const missing = tags.filter((t) => targetIds[t] === null || targetIds[t] === undefined);
  checks.push({
    name: `★★ هر ${String(tags.length)} تگ در ${where} حاضرند`,
    ok: missing.length === 0,
    detail: missing.length === 0 ? tags.join(" · ") : `غایب: ${missing.join(" · ")}`,
  });

  const mismatched = tags.filter(
    (t) => targetIds[t] !== null && sourceIds[t] !== null && targetIds[t] !== sourceIds[t],
  );
  checks.push({
    name: "شناسه‌ی هر ایمیج در مقصد با مبدأ یکی است",
    ok: mismatched.length === 0,
    detail:
      mismatched.length === 0
        ? "همان بایت‌ها رسیدند، نه یک ایمیجِ هم‌نامِ قدیمی"
        : `ناهم‌خوان: ${mismatched.join(" · ")}`,
  });

  return checks;
}

function argValue(name: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

async function buildImages(tag: string): Promise<void> {
  for (const name of IMAGES) {
    console.log(`  build ${name}…`);
    const result = await run("docker", [
      "build",
      "-f",
      `infra/docker/${name}.Dockerfile`,
      "-t",
      `hamboom/${name}:${tag}`,
      ".",
    ]);
    if (result.code !== 0) {
      throw new Error(`buildِ ${name} شکست خورد:\n${result.stderr.trim().slice(-600)}`);
    }
  }
}

/**
 * ★★ خودآزمون — سه سناریو، و برای هر شکست **کدام چک باید بگیردش**.
 *
 * ⚠️ صرفِ «قرمز شد» کافی نیست. اگر آرشیوِ ناقص به‌خاطرِ کدِ خروجِ `docker load` قرمز شود،
 * چکِ «هر سه تگ حاضرند» هنوز اثبات نشده — همان اشتباهی که فاز ۴ در گیتِ ایمیج گرفت.
 */
async function selfTest(tag: string): Promise<void> {
  const tags = tagsFor(tag);
  const sourceIds = await imageIds(tags, null);
  const absent = tags.filter((t) => sourceIds[t] === null);
  if (absent.length > 0) {
    console.error(
      `✖ خودآزمون به ایمیج‌های محلی نیاز دارد و این‌ها نیستند: ${absent.join(" · ")}\n` +
        `    اول بساز:  pnpm infra:ship -- --build --tag=${tag}`,
    );
    process.exit(1);
  }

  const dir = await mkdtemp(join(tmpdir(), "hamboom-ship-selftest-"));
  const results: CheckResult[] = [];
  try {
    // ── ۱: آرشیوِ سالم ⇒ باید سبز شود ─────────────────────────────────
    const intact = join(dir, "intact.tar");
    const saved = await run("docker", ["save", ...tags], { outFile: intact });
    if (saved.code !== 0) throw new Error(`docker save شکست خورد: ${saved.stderr.trim()}`);
    {
      const checks = await loadAndVerify(intact, tags, sourceIds, null);
      const reds = checks.filter((c) => !c.ok);
      results.push({
        name: "آرشیوِ سالم ⇒ هر سه چک **سبز**",
        ok: reds.length === 0,
        detail:
          reds.length === 0
            ? "پس این گیت «همیشه قرمز» نیست"
            : `قرمزها: ${reds.map((r) => r.name).join(" · ")}`,
      });
    }

    // ── ۲: آرشیوِ بریده ⇒ کدِ خروجِ docker load ────────────────────────
    {
      const cut = join(dir, "cut.tar");
      const copy = await run("docker", ["save", ...tags], { outFile: cut });
      if (copy.code !== 0) throw new Error("save دوم شکست خورد");
      const { size } = await stat(cut);
      await truncate(cut, Math.floor(size * 0.4));
      const checks = await loadAndVerify(cut, tags, sourceIds, null);
      const loadRed = checks[0]?.ok === false;
      results.push({
        name: "★ آرشیوِ بریده ⇒ چکِ **کدِ خروجِ docker load** می‌گیردش",
        ok: loadRed,
        detail: loadRed ? "انتقالِ نیمه‌تمام موفق شمرده نمی‌شود" : "load سبز مانْد!",
      });
    }

    // ── ۳: ★★ آرشیوی که یک ایمیج کم دارد ⇒ فقط چکِ «هر سه تگ» ─────────
    //
    // ⚠️ این تنها سناریویی است که کدِ خروجِ `docker load` نمی‌گیردش: بارگذاری کاملاً
    //    موفق است و **فقط** فهرستِ تگ‌ها کم دارد. دقیقاً همان چیزی که یک گیتِ
    //    ساده‌لوح از دستش می‌داد — و همان کلاسِ نقصی که مشقِ بازیابی هم داشت.
    //
    // ⚠️⚠️ **و نگارشِ اولِ همین سناریو غلط بود.** ابتدا دو ایمیج از سه تا save می‌شد و
    //    انتظار می‌رفت سومی «غایب» دیده شود — ولی در تمرینِ محلی مبدأ و مقصد **یک
    //    daemon**اند، پس سومی از سناریوی قبل همان‌جا بود و چک سبز مانْد. یعنی
    //    «ایمیجِ واقعاً غایب» در تمرینِ محلی **ذاتاً غیرقابلِ ساخت** است.
    //
    // ⇒ ادعای واقعیِ زیرِ آزمون این است: «اگر تگی در مقصد نباشد، چک قرمز می‌شود.» پس با
    //    تگی سنجیده می‌شود که **هرگز ساخته نشده** — که همان شرط را دقیقاً برآورده می‌کند.
    {
      const partial = join(dir, "partial.tar");
      const twoTags = tags.slice(0, 2);
      const saved2 = await run("docker", ["save", ...twoTags], { outFile: partial });
      if (saved2.code !== 0) throw new Error("saveِ ناقص شکست خورد");
      const phantom = "hamboom/never-shipped:selftest";
      const expected = [...twoTags, phantom];
      const checks = await loadAndVerify(
        partial,
        expected,
        { ...sourceIds, [phantom]: null },
        null,
      );
      const loadOk = checks[0]?.ok === true;
      const tagsRed = checks[1]?.ok === false;
      results.push({
        name: "★★ یک ایمیجِ جاافتاده ⇒ **فقط** چکِ «هر تگ حاضر است» می‌گیردش",
        ok: loadOk && tagsRed,
        detail:
          loadOk && tagsRed
            ? "docker load کدِ صفر داد و باز هم قرمز است ⇒ چکِ تگ‌ها لازم است، نه تزئینی"
            : `loadسبز=${String(loadOk)} · تگ‌هاقرمز=${String(tagsRed)}`,
      });
    }

    console.log("\n── خودآزمونِ انتقالِ ایمیج ──");
    for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
    const reds = results.filter((r) => !r.ok);
    if (reds.length > 0) {
      console.error(`\n✖ خودآزمون شکست: ${String(reds.length)} سناریو — این گیت قابلِ اتکا نیست.`);
      process.exit(1);
    }
    console.log("\n✔ هر دو شکستِ عمدی را چکِ **درست** گرفت، و آرشیوِ سالم سبز مانْد.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const tag = argValue("tag") ?? "local";
  const remote = argValue("to") ?? null;

  if (argv.includes("--build")) {
    console.log(`── buildِ سه ایمیج با تگِ «${tag}» ──`);
    await buildImages(tag);
  }

  if (argv.includes("--self-test")) {
    await selfTest(tag);
    return;
  }

  const tags = [...tagsFor(tag), ...(argv.includes("--base") ? BASE_IMAGES : [])];
  const sourceIds = await imageIds(tags, null);
  const absent = tags.filter((t) => sourceIds[t] === null);
  if (absent.length > 0) {
    console.error(
      `✖ این ایمیج‌ها محلی نیستند: ${absent.join(" · ")}\n` +
        `    ‏  pnpm infra:ship -- --build --tag=${tag}`,
    );
    process.exit(1);
  }

  const dir = await mkdtemp(join(tmpdir(), "hamboom-ship-"));
  const archive = join(dir, "images.tar");
  try {
    console.log(`── ${String(tags.length)} ایمیج، تگِ «${tag}» ──`);
    const started = Date.now();
    // ⚠️ stdout، نه `-o` — دلیلش در صدرِ فایل.
    const saved = await run("docker", ["save", ...tags], { outFile: archive });
    if (saved.code !== 0) {
      throw new Error(`docker save شکست خورد: ${saved.stderr.trim().slice(-400)}`);
    }
    const { size } = await stat(archive);
    const sha = await sha256Of(archive);
    console.log(
      `  آرشیو: ${String(Math.round(size / 1024 / 1024))}MB · sha256 ${sha.slice(0, 16)}… · ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s`,
    );

    if (remote === null) {
      console.log(
        "\n⊘ بدونِ `--to`: **تمرینِ محلی**. همان مسیر اجرا می‌شود، فقط ssh وسطش نیست —\n" +
          "   یعنی آرشیو و راستی‌آزمایی اثبات می‌شوند، ولی خودِ انتقال نه.\n",
      );
    } else {
      console.log(`\n── انتقال به ${remote} ──`);
    }

    const checks = await loadAndVerify(archive, tags, sourceIds, remote);
    for (const c of checks) console.log(`${c.ok ? "✔" : "✖"} ${c.name}\n    ${c.detail}`);
    const reds = checks.filter((c) => !c.ok).length;
    if (reds > 0) {
      console.error(`\n✖ ${String(reds)} چک قرمز شد — این انتقال قابلِ اتکا نیست.`);
      process.exit(1);
    }

    console.log(
      remote === null
        ? "\n✔ آرشیو ساخته و بازگردانده شد. برای انتقالِ واقعی: `-- --to=user@host`."
        : `\n✔ هر ${String(tags.length)} ایمیج در ${remote} حاضر و هم‌شناسه‌اند.`,
    );
    console.log(`\n★ در \`.env.production\` بگذار:  IMAGE_TAG=${tag}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
