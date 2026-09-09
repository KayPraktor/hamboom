#!/usr/bin/env bash
# ★★ probeِ شبکه‌ی VMِ آروان — ورودیِ تصمیمِ M5-D10 (مقصدِ رجیستریِ ایمیج).
#
# ── چرا این فایل وجود دارد ───────────────────────────────────────────────────
#
# M5-D10 عمداً باز مانده چون جوابش **حدس‌زدنی نیست**: از ماشینِ توسعه معلوم نمی‌شود
# که یک VM در ایران به کدام مخزن می‌رسد. این اسکریپت آن را **اندازه می‌گیرد** و یک
# جدولِ حکم چاپ می‌کند.
#
# ⚠️ سه گروه سوال دارد و هر سه لازم‌اند:
#   ۱. **پایه‌ها** — بدونِ `postgres:16-alpine` و `redis:7-alpine` استک اصلاً بالا
#      نمی‌آید. این مقدم بر انتخابِ رجیستری است.
#   ۲. **ایمیج‌های خودمان** — رجیستری یا انتقالِ دستی؟
#   ۳. ★★ **مقصدهای runtime** — زرین‌پال، sms.ir و Object Storage. اگر VM به این‌ها
#      نرسد، هیچ رجیستری‌ای به دردمان نمی‌خورد. این گروه اغلب فراموش می‌شود.
#
# اجرا **روی خودِ VM**:
#     bash probe-vm.sh            # کاملِ آزمون‌ها
#     ARVAN_REGISTRY=<host> bash probe-vm.sh
#
# خروجی را کامل بفرست؛ ADRِ M5-D10 از روی همین نوشته می‌شود.

set -u

PASS=0
FAIL=0
ROWS=()

row() { # نام | حکم | جزئیات
  ROWS+=("$1|$2|$3")
  if [ "$2" = "ok" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
}

# ★ ادعای این تابع دقیقاً یک چیز است: **مسیرِ TCP+TLS تا این میزبان باز است.**
#
# ⚠️ پس **هر** کدِ HTTP اثباتش می‌کند و فقط `000` (بی‌پاسخ) ردش. دو اندازه‌گیری این را
#    ثابت کرد: `HEAD https://ghcr.io/v2/` → **۴۰۵** (متد را نمی‌پذیرد) و
#    `https://api.sms.ir/` → **۴۰۴**. نگارشِ اولِ همین تابع هر دو را «نامعلوم» گزارش
#    می‌کرد، در حالی که هر دو کاملاً در دسترس‌اند. یک probe که ادعایش را با چیزِ
#    دیگری بسنجد، همان سبزِ دروغینی است که کلِ این پروژه دنبالش می‌گردد.
#
# ⊕ GET (نه HEAD) چون بعضی endpointها فقط GET را جواب می‌دهند؛ بدنه دور ریخته می‌شود.
http_reach() {
  local name="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null)
  case "$code" in
    000) row "$name" "no" "اصلاً وصل نشد (timeout/DNS/بسته)" ;;
    *) row "$name" "ok" "HTTP $code — مسیر باز است" ;;
  esac
}

docker_pull() {
  local name="$1" image="$2"
  local start end out
  start=$(date +%s)
  if out=$(docker pull "$image" 2>&1); then
    end=$(date +%s)
    row "$name" "ok" "pull شد در $((end - start)) ثانیه"
    docker rmi "$image" >/dev/null 2>&1
  else
    row "$name" "no" "$(echo "$out" | tail -1 | cut -c1-90)"
  fi
}

echo "── probeِ VM — $(date -u '+%Y-%m-%d %H:%M:%SZ') ──"
echo "میزبان: $(hostname) · $(uname -srm)"
if command -v docker >/dev/null 2>&1; then
  echo "docker: $(docker --version 2>&1 | head -1)"
  echo "compose: $(docker compose version 2>&1 | head -1)"
else
  echo "⚠️ docker نصب نیست — اول نصبش کن، وگرنه بقیه‌ی این probe بی‌معناست."
fi
echo "cpu: $(nproc 2>/dev/null || echo '?') · رم: $(free -h 2>/dev/null | awk '/Mem:/{print $2}' || echo '?')"
echo "دیسکِ آزاد: $(df -h / 2>/dev/null | awk 'NR==2{print $4}')"
echo

# ── گروه ۱: ایمیج‌های پایه (پیش‌نیازِ همه‌چیز) ──────────────────────────────
docker_pull "پایه — hello-world (Docker Hub)" "hello-world:latest"
docker_pull "پایه — postgres:16-alpine" "postgres:16-alpine"
docker_pull "پایه — redis:7-alpine" "redis:7-alpine"

# آینه‌ی داخلی، اگر Docker Hub مستقیم نیامد.
for mirror in docker.arvancloud.ir registry.docker.ir docker.iranrepo.ir; do
  http_reach "آینه‌ی احتمالی — $mirror" "https://$mirror/v2/"
done

# ── گروه ۲: مقصدهای ممکنِ ایمیج‌های خودمان ─────────────────────────────────
http_reach "رجیستری — Docker Hub API" "https://registry-1.docker.io/v2/"
http_reach "رجیستری — GHCR (ghcr.io)" "https://ghcr.io/v2/"
if [ -n "${ARVAN_REGISTRY:-}" ]; then
  http_reach "رجیستری — آروان ($ARVAN_REGISTRY)" "https://$ARVAN_REGISTRY/v2/"
else
  row "رجیستری — آروان" "?" "ARVAN_REGISTRY تنظیم نشده؛ اگر فعالش کردی دوباره با آن اجرا کن"
fi

# ── گروه ۳: اگر قرار باشد VM **خودش** build کند ────────────────────────────
http_reach "build — github.com" "https://github.com/"
http_reach "build — registry.npmjs.org" "https://registry.npmjs.org/"
http_reach "build — apt.postgresql.org (کلاینتِ pg، فاز ۷)" "https://apt.postgresql.org/"

# ── گروه ۴: ★★ مقصدهای runtime — بدونِ این‌ها استقرار بی‌معناست ─────────────
http_reach "runtime — زرین‌پال" "https://payment.zarinpal.com/"
http_reach "runtime — sms.ir" "https://api.sms.ir/"
http_reach "runtime — Object Storageِ آروان" "https://s3.ir-thr-at1.arvanstorage.ir/"

# ── سرعتِ خطِ خروجی: هزینه‌ی انتقالِ ~۱٫۲GB ایمیج را تخمین می‌زند ────────────
speed=$(curl -s -o /dev/null -w '%{speed_download}' --max-time 30 \
  https://speed.hetzner.de/100MB.bin 2>/dev/null)
if [ -n "$speed" ] && [ "${speed%.*}" -gt 0 ] 2>/dev/null; then
  mbps=$(awk -v s="$speed" 'BEGIN{printf "%.1f", s*8/1000000}')
  row "سرعتِ دانلود (نمونه)" "ok" "${mbps} Mb/s ⇒ ~۱٫۲GB ایمیج در حدودِ $(awk -v s="$speed" 'BEGIN{printf "%d", 1200000000/s/60}') دقیقه"
else
  row "سرعتِ دانلود (نمونه)" "?" "اندازه‌گیری نشد (مبدأ در دسترس نبود)"
fi

echo
printf '%-52s %-5s %s\n' "چه چیزی" "حکم" "جزئیات"
printf '%.0s─' {1..100}; echo
for r in "${ROWS[@]}"; do
  IFS='|' read -r n v d <<<"$r"
  mark="✔"; [ "$v" = "no" ] && mark="✖"; [ "$v" = "?" ] && mark="⚠"
  printf '%-52s %-5s %s\n' "$n" "$mark" "$d"
done
echo
echo "خلاصه: $PASS رسید · $FAIL نرسید/نامعلوم"
echo
echo "⚠️ خروجیِ کامل را بفرست — تصمیمِ M5-D10 از روی همین نوشته می‌شود، نه از روی حدس."
