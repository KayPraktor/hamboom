# syntax=docker/dockerfile:1
#
# ایمیجِ productionِ `apps/web` — M5 گام ۲٫۲ و ۲٫۳.
#
# ★★ **تنها اپی که واقعاً build دارد** ([ADR-058](../../ARCHITECTURE_DECISIONS.md#adr-058)):
# خروجیِ Vite فایلِ ایستاست، پس مرحله‌ی دوم اصلاً Node ندارد — nginx است که هم SPA را
# سرو می‌کند و هم reverse proxyِ api/WS است (یک مبدأ، بی‌CORS و بی‌کوکیِ third-party).
#
# ⚠️ برخلافِ api/realtime این‌جا `--prod` **غلط** است: `vite`/`typescript`/
# `@excalidraw/excalidraw` همه devDependency اند و بدونشان build اصلاً اجرا نمی‌شود.
# ایمیجِ نهایی هیچ‌کدام را نمی‌بَرد چون فقط `dist/` کپی می‌شود.

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @hamboom/web...
# `prebuild` فونت‌های Excalidraw را خودمیزبان می‌کند (P2)، بعد `tsc --noEmit && vite build`.
RUN pnpm --filter @hamboom/web build

FROM nginx:1.27-alpine AS runtime
# ⚠️ nginx خودش masterِ root و workerِ غیر-root است؛ سخت‌سازیِ بیشترِ لبه کارِ فاز ۹ است.
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# ★★ `api-locations.conf` **تولیدشده** است از `apps/web/src/api-prefixes.ts` — همان
#    فهرستی که پروکسیِ devِ Vite از آن می‌آید. گیتش: `pnpm infra:check-proxy`.
COPY infra/nginx/proxy-common.conf /etc/nginx/proxy-common.conf
COPY infra/nginx/api-locations.conf /etc/nginx/api-locations.conf
COPY infra/nginx/hamboom.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
