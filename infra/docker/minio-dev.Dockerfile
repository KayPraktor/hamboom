# MinIO و mc برای **توسعه و CI** — از سورسِ upstream، سنجاق‌شده ([ADR-071](../../ARCHITECTURE_DECISIONS.md#adr-071)).
#
# ⛔ **این ایمیج هرگز به production نمی‌رود.** انبارِ production آروان است و `docker-compose.prod.yml` اصلاً
#    MinIO ندارد. upstream بایگانی شده ⇒ هیچ رفعِ امنیتی‌ای نخواهد آمد؛ فقط پشتِ شبکه‌ی compose و loopback.
#
# ── چرا از سورس ─────────────────────────────────────────────────────────────
#
# `minio/minio` و `minio/mc` از Docker Hub رفته‌اند (API ۴۰۴، ۱۴۰۵/۰۷/۲۰) و Quay و آینه‌ی gcr هم ندارند؛ jobِ
# سنجه‌های CI از اولین پوشِ M6 روی همین می‌افتاد. `go install <module>@<شبه‌نسخه>` سورس را از پروکسیِ
# ماژولِ Go می‌آورد و با sum.golang.org راستی‌آزمایی می‌کند ⇒ نه به رجیستریِ ایمیج تکیه دارد، نه به
# زنده‌ماندنِ ریپوی بایگانی‌شده.
#
# ── چرا همین کامیت‌ها ──────────────────────────────────────────────────────
#
# همان‌هایی که ایمیج‌های رسمیِ کش‌شده‌ی ماشینِ توسعه از آن‌ها ساخته شده بودند — هر تستِ storageِ این ریپو
# سیزده ماه رویشان اجرا شده. ldflags همان برچسب‌های نسخه‌ی بیلدِ رسمی را می‌گذارد، و هر RUN پیش از ساخت
# می‌سنجد که شبه‌نسخه و کامیتِ اعلام‌شده **یک** کامیت‌اند (برچسب فقط متن است؛ کد را شبه‌نسخه تعیین می‌کند).
#
# ⚠️ تگِ ایمیج در `docker-compose.yml` **نامِ release** است. تغییری که نسخه را عوض کند تگ را هم باید عوض
#    کند؛ تغییرِ بی‌نسخه (مثلاً ایمیجِ پایه) ⇒ `docker compose -f infra/docker/docker-compose.yml build minio`،
#    وگرنه compose ایمیجِ قبلی با همان تگ را بی‌صدا نگه می‌دارد. کلیدِ کشِ CI hashِ همین فایل است.

FROM golang:1.24.6-alpine AS build
ENV CGO_ENABLED=0

ARG MINIO_MODULE=v0.0.0-20250907161309-07c3a429bfed
ARG MINIO_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb
ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_VERSION=2025-09-07T16:13:09Z
RUN set -e; short="$(echo "$MINIO_COMMIT" | cut -c1-12)"; \
    case "$MINIO_MODULE" in *-"$short") ;; *) echo "✖ MINIO_MODULE و MINIO_COMMIT یک کامیت نیستند" >&2; exit 1 ;; esac; \
    go install -trimpath -tags kqueue \
      -ldflags "-s -w \
        -X github.com/minio/minio/cmd.Version=$MINIO_VERSION \
        -X github.com/minio/minio/cmd.CopyrightYear=${MINIO_VERSION%%-*} \
        -X github.com/minio/minio/cmd.ReleaseTag=$MINIO_RELEASE \
        -X github.com/minio/minio/cmd.CommitID=$MINIO_COMMIT \
        -X github.com/minio/minio/cmd.ShortCommitID=$short" \
      "github.com/minio/minio@$MINIO_MODULE"; \
    go version -m /go/bin/minio | head -3

ARG MC_MODULE=v0.0.0-20250813083541-7394ce0dd2a8
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG MC_VERSION=2025-08-13T08:35:41Z
RUN set -e; short="$(echo "$MC_COMMIT" | cut -c1-12)"; \
    case "$MC_MODULE" in *-"$short") ;; *) echo "✖ MC_MODULE و MC_COMMIT یک کامیت نیستند" >&2; exit 1 ;; esac; \
    go install -trimpath -tags kqueue \
      -ldflags "-s -w \
        -X github.com/minio/mc/cmd.Version=$MC_VERSION \
        -X github.com/minio/mc/cmd.CopyrightYear=${MC_VERSION%%-*} \
        -X github.com/minio/mc/cmd.ReleaseTag=$MC_RELEASE \
        -X github.com/minio/mc/cmd.CommitID=$MC_COMMIT \
        -X github.com/minio/mc/cmd.ShortCommitID=$short" \
      "github.com/minio/mc@$MC_MODULE"; \
    go version -m /go/bin/mc | head -3

# ★ یک ایمیج با هر دو باینری و یک شل: `minio` سرور را اجرا می‌کند، `minio-init`ِ compose با `mc` و `sh`ِ همین
#   ایمیج باکت‌ها را می‌سازد.
FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /go/bin/minio /go/bin/mc /usr/bin/
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
