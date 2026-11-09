#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/data/hadith"
mkdir -p "$DEST"
ALL=(nawawi bukhari muslim abudawud tirmidhi nasai ibnmajah)
usage(){ echo "Usage: $0 [--all | nawawi|bukhari|muslim|abudawud|tirmidhi|nasai|ibnmajah ...]"; }
if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then usage; exit 0; fi
if [[ ${1:-} == "--all" ]]; then shift; SET=("${ALL[@]}"); elif (($#)); then SET=("$@"); else SET=(nawawi); fi
for book in "${SET[@]}"; do
  case "$book" in
    nawawi) edition=ara-nawawi; min=42 ;;
    bukhari) edition=ara-bukhari; min=1000 ;;
    muslim) edition=ara-muslim; min=1000 ;;
    abudawud) edition=ara-abudawud; min=1000 ;;
    tirmidhi) edition=ara-tirmidhi; min=1000 ;;
    nasai) edition=ara-nasai; min=1000 ;;
    ibnmajah) edition=ara-ibnmajah; min=1000 ;;
    *) echo "Unknown collection: $book" >&2; usage >&2; exit 2 ;;
  esac
  target="$DEST/$edition.min.json"
  tmp="$target.part"
  ok=0
  for url in \
    "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/$edition.min.json" \
    "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/$edition.json" \
    "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/$edition.min.json"; do
    rm -f "$tmp"
    if command -v curl >/dev/null 2>&1; then
      curl --fail --location --retry 2 --connect-timeout 15 --max-time 240 "$url" -o "$tmp" || continue
    elif command -v wget >/dev/null 2>&1; then
      wget -q --timeout=30 --tries=2 "$url" -O "$tmp" || continue
    else
      echo "Install curl or wget first." >&2; exit 3
    fi
    if python3 - "$tmp" "$min" <<'PY'
import json,sys
p,minimum=sys.argv[1],int(sys.argv[2])
try:
 d=json.load(open(p,encoding='utf-8'))
 hs=d.get('hadiths') if isinstance(d,dict) else None
 valid=[h for h in hs if isinstance(h,dict) and isinstance(h.get('text'),str) and h['text'].strip()] if isinstance(hs,list) else []
 if len(valid)<minimum: raise SystemExit(1)
except Exception: raise SystemExit(1)
PY
    then mv "$tmp" "$target"; ok=1; break; fi
  done
  if [[ $ok != 1 ]]; then rm -f "$tmp"; echo "Download/validation failed for $edition" >&2; exit 4; fi
  bytes=$(wc -c < "$target" | tr -d ' ')
  count=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1],encoding="utf-8"))["hadiths"]))' "$target")
  echo "✓ $edition: $count hadiths, $bytes bytes -> ${target#$ROOT/}"
done
