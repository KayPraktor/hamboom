# syntax=docker/dockerfile:1
#
# ایمیجِ productionِ `apps/api` — M5 گام ۲٫۱، طبقِ [ADR-058](../../ARCHITECTURE_DECISIONS.md#adr-058):
# **هیچ buildی**. سورس می‌رود و Node 24 تایپ‌ها را در بارگذاریِ ماژول می‌کَنَد.
#
# ★★ ریسکِ strip-only در فاز ۱ **کران‌دار** شد: نحوِ strip‌ناپذیر (مثلِ `enum`) در
# **بارگذاریِ ماژول** می‌شکند، و هیچ‌کدام از سرورها importِ پویا ندارند ⇒ هر خطای
# نحوی در **بوت** ظاهر می‌شود، نه وسطِ درخواستِ یک مشتری.
#
# اندازه‌گیریِ فاز ۱: ~۴۹۶MB، بوتِ سرد ۴۸۳ms، `/readyz` ۲۰۰ در ۱۷ms.

FROM node:24-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps
COPY packages ./packages
# ★ فقط درختِ خودِ api و وابستگی‌های ورک‌اسپیسش، فقط prod (بدونِ devDependencies).
#   ⚠️ `--frozen-lockfile` عمدی است: اگر `package.json`ی وابستگی‌ای را اعلام نکرده باشد
#   که کد استفاده‌اش می‌کند، همین‌جا (یا سرِ بوت) می‌شکند — همان نقصی که فاز ۱ در
#   `apps/realtime` پیدا کرد و نه dev، نه typecheck، نه `pnpm verify` نگرفته بودش.
# ★★ `--filter hamboom` = **خودِ پروژه‌ی ریشه**، و عمدی است: اسکریپت‌های اپراتور
#   (`scripts/migrate.ts`) از `/app/scripts/` بارگذاری می‌شوند و Node شناسه‌های bare را
#   از همان‌جا به بالا resolve می‌کند — یعنی از `/app/node_modules`، نه از
#   `apps/api/node_modules`. بدونِ این فیلتر، `docker compose run migrate` با
#   `ERR_MODULE_NOT_FOUND: @hamboom/config` می‌مُرد (اندازه‌گیری شد، گام ۲٫۵).
RUN pnpm install --frozen-lockfile --prod --filter @hamboom/api... --filter hamboom

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# ★★ کلاینتِ Postgres — M5 فاز ۷ (پشتیبان و **مشقِ بازیابی**).
#
# ⚠️ **نسخه‌اش عمداً پین است و باید با سرورِ compose یکی باشد.** `pg_dump`ِ قدیمی‌تر از
#    سرور اصلاً کار نمی‌کند، و جدیدتر خروجی‌ای می‌دهد که ممکن است سرورِ قدیمی‌تر در
#    **روزِ حادثه** نپذیرد. `scripts/pg-tools.ts` هر دو عدد را می‌سنجد و چاپ می‌کند.
#
# ⚠️ bookwormِ خودِ دبیان فقط `postgresql-client-15` دارد، پس مخزنِ PGDG لازم است.
#    یعنی این build به `apt.postgresql.org` نیاز دارد — یک مبدأ شبکه‌ایِ **تازه**، و
#    مثلِ M5-D10 باید از VMِ آروان probe شود. اگر آن‌جا در دسترس نبود، ایمیج در CI
#    ساخته و به VM برده می‌شود (همان تصمیمِ باز).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /etc/apt/trusted.gpg.d/pgdg.asc \
  && echo "deb https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
  # ★ ادعا در همان لایه‌ای که نصب می‌کند: اگر نسخه‌ی دیگری آمده باشد، **build** می‌شکند،
  #   نه اولین پشتیبانِ شبانه.
  && pg_dump --version | grep -q " 16\." \
  && pg_restore --version | grep -q " 16\."
# ⚠️ کاربرِ غیر-root؛ ایمیجِ node از قبل کاربرِ `node` را دارد.
COPY --from=deps --chown=node:node /app /app
# ★★ اسکریپت‌های ریشه و SQLِ migration هم داخلِ **همین** ایمیج می‌آیند
#    ([ADR-062](../../ARCHITECTURE_DECISIONS.md#adr-062)): کارِ دوره‌ای و migration
#    کانتینرِ یک‌بارمصرفِ همین ایمیج‌اند، نه ایمیجِ دوم و نه `apps/worker`.
#    ⚠️ کلِ `scripts/` می‌آید ولی فقط ورودی‌های زیر پشتیبانی می‌شوند — بقیه ابزارِ
#    dev/CI اند و وابستگی‌هایشان در نصبِ `--prod` نیستند:
#      migrate.ts · billing-reconcile.ts · backup-db.ts · backup-storage.ts ·
#      restore-drill.ts · sweep-orphans.ts · purge-deleted.ts
#      (+ کمکی‌ها: backup-common.ts، pg-tools.ts، db-fk-test.ts، sweep-orphans-core.ts)
#    ★ این فهرست با `PRODUCTION_SCRIPTS` در `scripts/check-workspace-deps.ts` یکی
#      است و گیتِ `deps` جداافتادنشان را قرمز می‌کند.
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node infra/sql ./infra/sql
USER node
EXPOSE 3002

# ⚠️ فقط می‌گوید «فرایند زنده است و پاسخ می‌دهد» — `/readyz` (که دیتابیس را می‌سنجد)
#    عمداً این‌جا نیست: یک قطعیِ کوتاهِ دیتابیس نباید کانتینرِ سالم را unhealthy کند.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ★ بدونِ pnpm در runtime — ورودی مستقیماً همان فایلِ .ts است (ADR-058).
CMD ["node", "apps/api/src/server.ts"]
