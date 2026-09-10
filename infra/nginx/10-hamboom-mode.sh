#!/bin/sh
# انتخابِ حالتِ nginx در بوت — M5 گام ۹٫۲.
#
# ایمیجِ رسمیِ nginx هر `/docker-entrypoint.d/*.sh`ِ اجرایی را **پیش از** خودِ nginx اجرا
# می‌کند؛ اگر یکی exit≠0 بدهد، کانتینر بالا نمی‌آید. این اسکریپت از همین استفاده می‌کند:
#
#   گواهی هست           → server-tls.conf   (۸۴۴۳ https + ۸۰۸۰ ریدایرکت/ACME) + HSTS
#   گواهی نیست، staging  → server-http.conf  (۸۰۸۰ http) با هشدارِ بلند
#   گواهی نیست، production → exit 1          (همان الگوی گاردهای بوتِ api، فاز ۴)
#
# ⚠️ «گواهی هست» یعنی **هر دو** فایل ناتهی باشند. یک `privkey.pem`ِ خالی که از یک کپیِ
#    نیمه‌کاره مانده، نباید nginx را با یک خطای گنگِ ssl بیندازد — این‌جا با پیامِ واضح می‌افتد.
set -eu

TLS_DIR="${HAMBOOM_TLS_DIR:-/etc/hamboom/tls}"
CONF=/etc/nginx/conf.d/default.conf
HEADERS=/etc/nginx/hamboom/headers.conf

cp /etc/nginx/hamboom/security-headers.conf "$HEADERS"

if [ -s "$TLS_DIR/fullchain.pem" ] && [ -s "$TLS_DIR/privkey.pem" ]; then
  cp /etc/nginx/hamboom/server-tls.conf "$CONF"
  # HSTS فقط وقتی TLS واقعاً هست؛ روی http مرورگر نادیده‌اش می‌گیرد ولی اینجا اصلاً نمی‌فرستیم.
  echo 'add_header Strict-Transport-Security "max-age=31536000" always;' >> "$HEADERS"
  echo "hamboom: TLS فعال — 8443 (https) + 8080 (ریدایرکت + ACME)"
else
  if [ "${APP_ENV:-}" = "production" ]; then
    echo "✖ hamboom: APP_ENV=production ولی گواهیِ TLS در $TLS_DIR نیست (fullchain.pem + privkey.pem، هر دو ناتهی). production بدونِ TLS بالا نمی‌آید." >&2
    exit 1
  fi
  cp /etc/nginx/hamboom/server-http.conf "$CONF"
  echo "⚠️ hamboom: TLS غیرفعال (گواهی در $TLS_DIR نیست) — فقط staging/لوکال؛ 8080 (http)"
fi
