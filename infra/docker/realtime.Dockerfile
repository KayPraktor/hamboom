# syntax=docker/dockerfile:1
#
# ایمیجِ productionِ `apps/realtime` — M5 گام ۲٫۱، طبقِ [ADR-058](../../ARCHITECTURE_DECISIONS.md#adr-058):
# **هیچ buildی**. سورس می‌رود و Node 24 تایپ‌ها را در بارگذاریِ ماژول می‌کَنَد.
#
# ⚠️ **نقصی که فقط همین نصبِ `--prod` پیدایش کرد (فاز ۱):** این پکیج از
# `@hamboom/config` استفاده می‌کرد ولی اعلامش نکرده بود؛ dev و typecheck و کلِ
# `pnpm verify` سبز بودند چون ورک‌اسپیس resolveش می‌کرد. نگهبانش گامِ ۳٫۶ی CI است.
#
# اندازه‌گیریِ فاز ۱: ~۴۹۱MB. WS از بیرون در دسترس و fail-closed سالم (`1008 TOKEN_INVALID`).

FROM node:24-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps
COPY packages ./packages
# ★ فقط درختِ خودِ realtime و وابستگی‌های ورک‌اسپیسش، فقط prod.
RUN pnpm install --frozen-lockfile --prod --filter @hamboom/realtime...

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# ⚠️ کاربرِ غیر-root؛ ایمیجِ node از قبل کاربرِ `node` را دارد.
COPY --from=deps --chown=node:node /app /app
USER node
EXPOSE 3001

# ★★ **اصلاحِ یک یافته‌ی غلطِ فاز ۱.**
#
# ⚠️ فاز ۱ ثبت کرده بود «`apps/realtime` هیچ health endpointی ندارد» و به همین دلیل
# این‌جا یک چکِ TCPی گذاشته شد که فقط listen بودنِ پورت را می‌سنجید. فاز ۵ با یک
# درخواستِ واقعی سنجید: `/healthz` → **۲۰۰ `ok`** و `/readyz` → **۲۰۰ `ready`** — هر دو
# از M2 وجود داشته‌اند و در خاموشیِ مودبانه هم درست رفتار می‌کنند.
#
# ★ فرقش واقعی است: چکِ TCPی یک فرایندِ **قفل‌شده** را سالم می‌دید، چون سوکتِ listen
# هنوز باز بود.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.RT_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ★ بدونِ pnpm در runtime — ورودی مستقیماً همان فایلِ .ts است (ADR-058).
CMD ["node", "apps/realtime/src/main.ts"]
