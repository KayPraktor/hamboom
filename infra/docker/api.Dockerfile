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
# ⚠️ کاربرِ غیر-root؛ ایمیجِ node از قبل کاربرِ `node` را دارد.
COPY --from=deps --chown=node:node /app /app
# ★★ اسکریپت‌های ریشه و SQLِ migration هم داخلِ **همین** ایمیج می‌آیند
#    ([ADR-062](../../ARCHITECTURE_DECISIONS.md#adr-062)): کارِ دوره‌ای و migration
#    کانتینرِ یک‌بارمصرفِ همین ایمیج‌اند، نه ایمیجِ دوم و نه `apps/worker`.
#    ⚠️ کلِ `scripts/` می‌آید ولی فقط **دو** ورودی پشتیبانی می‌شوند:
#    `scripts/migrate.ts` و `scripts/billing-reconcile.ts`. بقیه ابزارِ dev/CI اند و
#    وابستگی‌هایشان در نصبِ `--prod` نیستند.
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
