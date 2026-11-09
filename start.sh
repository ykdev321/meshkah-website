#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8080}"
printf '\nمِشكاة | القرآن الكريم\n'
printf 'افتح في المتصفح: http://localhost:%s\n' "$PORT"
printf 'لإيقاف الخادم اضغط Ctrl+C\n\n'
exec python3 -m http.server "$PORT" --bind 0.0.0.0
