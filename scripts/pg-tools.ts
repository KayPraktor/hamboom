/**
 * ابزارهای خطِ فرمانِ PostgreSQL (`pg_dump` / `pg_restore` / `psql`) — M5 فاز ۷.
 *
 * ── ⚠️ چرا این فایل اصلاً وجود دارد ───────────────────────────────────────
 *
 * پشتیبان را نمی‌شود در Node «پیاده‌سازی» کرد. هر تلاشی برای نوشتنِ dumpِ منطقیِ خودمان
 * یعنی مشقِ بازیابی به‌جای `pg_dump`ِ واقعی، **بازنویسیِ ما** را می‌سنجد — یعنی دقیقاً
 * چیزی که در روزِ حادثه به کارمان نمی‌آید. پس ابزارِ رسمی اجرا می‌شود، نه بدلش.
 *
 * ⚠️ **ولی آن ابزار همه‌جا نیست.** روی این ماشینِ توسعه اصلاً روی PATH نبود (اندازه‌گیری
 * شد: `pg_dump: command not found`)، در حالی که کانتینرِ `postgres:16-alpine` بالا بود و
 * همان باینری **داخلش** حاضر بود. یک گیتی که فقط روی VM اجرا شود، همان گیتی است که
 * هیچ‌وقت اجرا نمی‌شود — درسِ `lint:css` و `db:smoke`. پس دو حالت داریم:
 *
 * | حالت | کِی | چطور |
 * |---|---|---|
 * | `path` | باینری روی PATH هست (کانتینرِ production، runnerِ CI) | مستقیم، با `-h/-p/-U` |
 * | `docker` | نیست، ولی کانتینرِ Postgres بالاست (این ماشین) | `docker exec -i <c> …` روی سوکتِ داخلی |
 *
 * ★ و حالت **گزارش می‌شود**، نه اینکه بی‌صدا انتخاب شود: اگر کسی فکر کند dumpِ
 * production را گرفته ولی در واقع از کانتینرِ لوکال گرفته، بدترین نوعِ سبزِ دروغین است.
 *
 * ── ★ تله‌ی نسخه، که صریح آزموده می‌شود ───────────────────────────────────
 *
 * `pg_dump`ِ قدیمی‌تر از سرور **کار نمی‌کند** (خطای صریح می‌دهد، خوب است)، ولی جدیدتر
 * کار می‌کند و خروجی‌اش ممکن است نحوی داشته باشد که سرورِ قدیمی‌تر در بازیابی نفهمد —
 * و آن **در روزِ حادثه** معلوم می‌شود. پس هر دو عدد چاپ می‌شوند و ناسازگاری خطاست.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";

/** اتصالِ تجزیه‌شده — از `DATABASE_URL`. */
export interface PgConnection {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

export function parseDatabaseUrl(url: string): PgConnection {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port === "" ? "5432" : u.port,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

/** خروجیِ اجرای یک ابزار. `code` هرگز بلعیده نمی‌شود — تصمیم با اوست. */
export interface ToolRun {
  code: number;
  stderr: string;
  stdout: string;
}

export interface PgTools {
  mode: "path" | "docker";
  /** یک خط برای لاگ — «از کجا dump گرفته شد» هرگز نباید حدس باشد. */
  describe(): string;
  clientMajor: number;
  clientVersion: string;
  serverMajor: number;
  serverVersion: string;
  /** `pg_dump` با آرگومان‌های دلخواه؛ stdout مستقیم به `outFile` می‌رود. */
  dump(extraArgs: string[], outFile: string): Promise<ToolRun>;
  /** `pg_restore` که ورودی‌اش از `inFile` روی stdin می‌آید. */
  restore(database: string, extraArgs: string[], inFile: string): Promise<ToolRun>;
  /** `psql -tAc` — خروجیِ trimشده. کدِ خروجِ غیرصفر خطا می‌اندازد. */
  psql(database: string, sql: string): Promise<string>;
  /** همان `psql`، ولی بدونِ throw — برای جاهایی که خودِ شکست داده است. */
  psqlRaw(database: string, sql: string): Promise<ToolRun>;
}

interface SpawnPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

async function runPlan(
  plan: SpawnPlan,
  io: { outFile?: string; inFile?: string } = {},
): Promise<ToolRun> {
  return await new Promise<ToolRun>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      env: plan.env,
      stdio: [
        io.inFile === undefined ? "ignore" : "pipe",
        io.outFile === undefined ? "pipe" : "pipe",
        "pipe",
      ],
    });

    let stdout = "";
    let stderr = "";
    let failed: Error | null = null;

    if (io.outFile !== undefined && child.stdout !== null) {
      const out = createWriteStream(io.outFile);
      child.stdout.pipe(out);
      out.on("error", (e) => (failed = e));
    } else if (child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => (stdout += c));
    }

    if (child.stderr !== null) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => (stderr += c));
    }

    if (io.inFile !== undefined && child.stdin !== null) {
      const input = createReadStream(io.inFile);
      input.pipe(child.stdin);
      // ⚠️ EPIPE عادی است: وقتی pg_restore زودتر می‌میرد (پشتیبانِ ناقص) نوشتن روی
      //    stdinِ بسته خطا می‌دهد. تصمیم با کدِ خروجِ فرایند است، نه با این.
      child.stdin.on("error", () => undefined);
      input.on("error", (e) => (failed = e));
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (failed !== null) {
        reject(failed);
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function majorOf(version: string): number {
  const m = /(\d+)/.exec(version);
  return m?.[1] === undefined ? 0 : Number(m[1]);
}

/**
 * آیا این باینری روی PATH هست؟ با `--version` سنجیده می‌شود، نه با `which` —
 * چون روی ویندوز `which` و PATHِ shell با آنچه `spawn` می‌بیند یکی نیست.
 */
async function versionOnPath(tool: string): Promise<string | null> {
  try {
    const run = await runPlan({ command: tool, args: ["--version"], env: process.env });
    if (run.code !== 0) return null;
    return run.stdout.trim();
  } catch {
    return null;
  }
}

async function containerIsRunning(name: string): Promise<boolean> {
  try {
    const run = await runPlan({
      command: "docker",
      args: ["inspect", "-f", "{{.State.Running}}", name],
      env: process.env,
    });
    return run.code === 0 && run.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  connection: PgConnection;
  /** override دستی: `path` | `docker`. پیش‌فرض: تشخیصِ خودکار. */
  mode?: string | undefined;
  /** نامِ کانتینرِ Postgres در حالتِ docker. */
  container?: string | undefined;
}

/**
 * ابزارها را پیدا می‌کند، نسخه‌ها را می‌سنجد، و یک `PgTools` می‌دهد.
 *
 * ⚠️ اگر هیچ‌کدام نبود، خطای فارسیِ صریح می‌دهد — نه `ENOENT`ِ گنگ.
 */
export async function resolvePgTools(opts: ResolveOptions): Promise<PgTools> {
  const container = opts.container ?? process.env.PG_TOOLS_CONTAINER ?? "hamboom-postgres";
  const wanted = opts.mode ?? process.env.PG_TOOLS_MODE;
  const explicit = wanted === "path" || wanted === "docker";

  /**
   * ترتیبِ نامزدها.
   *
   * ★ **چرا `path` قدیمی‌تر از سرور به `docker` می‌افتد و خطا نمی‌دهد:** runnerهای CI
   * یک کلاینتِ Postgres از پیش‌نصب دارند که نسخه‌اش با سرورِ compose یکی نیست و بی‌اطلاع
   * عوض می‌شود. یک گیت که با ارتقای runner قرمز شود، گیتِ ما را بی‌اعتبار می‌کند نه
   * پشتیبان را — پس اگر کانتینر هست، ابزارِ **هم‌نسخه‌ی داخلش** ترجیح دارد.
   */
  const candidates: ("path" | "docker")[] = explicit
    ? [wanted]
    : (await versionOnPath("pg_dump")) === null
      ? ["docker"]
      : ["path", "docker"];

  const reasons: string[] = [];
  for (const candidate of candidates) {
    if (candidate === "docker" && !(await containerIsRunning(container))) {
      reasons.push(`docker: کانتینرِ «${container}» بالا نیست`);
      continue;
    }
    try {
      const tools = await buildTools(candidate, opts.connection, container);
      if (tools.clientMajor < tools.serverMajor) {
        reasons.push(
          `${candidate}: pg_dump ${tools.clientVersion} از سرور ${tools.serverVersion} قدیمی‌تر است`,
        );
        continue;
      }
      if (candidate !== candidates[0]) {
        console.warn(`⚠️ حالتِ «${candidates[0] ?? ""}» کنار گذاشته شد — ${reasons.join(" · ")}`);
      }
      return tools;
    } catch (error) {
      reasons.push(`${candidate}: ${String((error as Error).message)}`);
    }
  }

  throw new Error(
    [
      "‏[hamboom] هیچ راهی برای اجرای `pg_dump` پیدا نشد:",
      "",
      ...reasons.map((r) => `‏  • ${r}`),
      "",
      "‏یکی از این دو را درست کن:",
      "‏  • کلاینتِ Postgres نصب کن که نسخه‌اش ≥ نسخه‌ی سرور باشد، یا",
      "‏  • دیتابیسِ لوکال را بالا بیاور:  pnpm db:up",
      "",
      "‏و اگر نامِ کانتینر فرق دارد:  PG_TOOLS_CONTAINER=<name>",
    ].join("\n"),
  );
}

async function buildTools(
  mode: "path" | "docker",
  conn: PgConnection,
  container: string,
): Promise<PgTools> {
  const planFor = (tool: string, args: string[]): SpawnPlan => {
    if (mode === "path") {
      return {
        command: tool,
        args: ["-h", conn.host, "-p", conn.port, "-U", conn.user, ...args],
        env: { ...process.env, PGPASSWORD: conn.password },
      };
    }
    // ⚠️ داخلِ کانتینر، `localhost:5544`ِ هاست معنایی ندارد — سوکتِ محلی استفاده می‌شود.
    // ★ `-e PGPASSWORD` **بدونِ مقدار** یعنی docker مقدار را از محیطِ خودمان بردارد؛
    //   با `-e PGPASSWORD=…` رمز داخلِ آرگومان‌ها و در `ps` دیده می‌شد.
    return {
      command: "docker",
      args: ["exec", "-i", "-e", "PGPASSWORD", container, tool, "-U", conn.user, ...args],
      env: { ...process.env, PGPASSWORD: conn.password },
    };
  };

  // ⚠️ `--version` باید **تنها** آرگومان باشد: `pg_dump -U x --version` با
  //    «too many command-line arguments» می‌افتد (اندازه‌گیری شد). پس این فراخوانی
  //    از `planFor` رد نمی‌شود — هیچ آرگومانِ اتصالی نمی‌گیرد.
  const versionPlan: SpawnPlan =
    mode === "path"
      ? { command: "pg_dump", args: ["--version"], env: process.env }
      : {
          command: "docker",
          args: ["exec", "-i", container, "pg_dump", "--version"],
          env: process.env,
        };
  const clientRun = await runPlan(versionPlan);
  if (clientRun.code !== 0) {
    throw new Error(
      `‏[hamboom] اجرای pg_dump شکست خورد (حالت ${mode}): ${clientRun.stderr.trim()}`,
    );
  }
  const clientVersion = clientRun.stdout.trim().replace(/^pg_dump \(PostgreSQL\) /, "");

  const serverRun = await runPlan(
    planFor("psql", ["-d", conn.database, "-tAc", "SHOW server_version"]),
  );
  if (serverRun.code !== 0) {
    throw new Error(
      `‏[hamboom] اتصال به دیتابیس شکست خورد (حالت ${mode}): ${serverRun.stderr.trim()}`,
    );
  }
  const serverVersion = serverRun.stdout.trim();

  // ⚠️ ناسازگاریِ نسخه این‌جا **throw نمی‌شود** — `resolvePgTools` تصمیم می‌گیرد،
  //    چون ممکن است حالتِ دیگری همان لحظه در دسترس و هم‌نسخه باشد.
  const clientMajor = majorOf(clientVersion);
  const serverMajor = majorOf(serverVersion);

  return {
    mode,
    clientMajor,
    clientVersion,
    serverMajor,
    serverVersion,
    describe() {
      const where =
        mode === "path" ? `PATH → ${conn.host}:${conn.port}` : `docker exec ${container}`;
      const warn = clientMajor > serverMajor ? "  ⚠️ کلاینت جلوتر از سرور است" : "";
      return `ابزار: ${where} · pg_dump ${clientVersion} · سرور ${serverVersion}${warn}`;
    },
    async dump(extraArgs, outFile) {
      return await runPlan(planFor("pg_dump", ["-d", conn.database, ...extraArgs]), { outFile });
    },
    async restore(database, extraArgs, inFile) {
      return await runPlan(planFor("pg_restore", ["-d", database, ...extraArgs]), { inFile });
    },
    async psqlRaw(database, sql) {
      return await runPlan(planFor("psql", ["-d", database, "-tAc", sql]));
    },
    async psql(database, sql) {
      const run = await runPlan(
        planFor("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-tAc", sql]),
      );
      if (run.code !== 0) {
        throw new Error(`‏[hamboom] psql شکست خورد: ${run.stderr.trim() || String(run.code)}`);
      }
      return run.stdout.trim();
    },
  };
}
