# syntax=docker/dockerfile:1
#
# probeِ گام ۱٫۴ — ایمیجِ apps/realtime طبقِ ADR-058: **هیچ buildی**، سورس می‌رود و Node 24
# تایپ‌ها را در runtime می‌کَنَد. این نگارش عمداً ساده است؛ بهینه‌سازی کارِ فاز ۲ است.

FROM node:24-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps
COPY packages ./packages
# ★ فقط درختِ خودِ api و وابستگی‌های ورک‌اسپیسش، فقط prod (بدونِ devDependencies).
RUN pnpm install --frozen-lockfile --prod --filter @hamboom/realtime...

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# ⚠️ کاربرِ غیر-root؛ ایمیجِ node از قبل کاربرِ `node` را دارد.
COPY --from=deps --chown=node:node /app /app
USER node
EXPOSE 3001
# ★ بدونِ pnpm در runtime — ورودی مستقیماً همان فایلِ .ts است (ADR-058).
CMD ["node", "apps/realtime/src/main.ts"]
