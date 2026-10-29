#!/usr/bin/env bash
# Public CDN verification. Do not retry an application failure by redeploying.
# Cloudflare 525 is an origin TLS handshake failure, not an image encoding bug.
set -euo pipefail
mode="${1:-}"
case "$mode" in
  preflight|release) ;;
  *) echo 'Usage: bash tests/public_https_checks.sh preflight|release' >&2; exit 2 ;;
esac

base='https://image.plainmile.com'
body=$(mktemp)
headers=$(mktemp)
trap 'rm -f "$body" "$headers"' EXIT

check_public() {
  local path="$1" expected="$2" needle="${3:-}"
  local code ray attempt
  for attempt in 1 2 3; do
    : > "$body"
    : > "$headers"
    code=$(curl --silent --show-error --connect-timeout 8 --max-time 20 \
      --output "$body" --dump-header "$headers" --write-out '%{http_code}' \
      "$base$path") || code='000'
    ray=$(grep -i '^cf-ray:' "$headers" | tail -n 1 | cut -d ':' -f2- | tr -cd 'A-Za-z0-9-' || true)
    printf 'HTTPS %s: %s (attempt %s/3, CF-Ray %s)\n' "$path" "$code" "$attempt" "${ray:-unavailable}"
    if [[ "$code" == "$expected" ]] && { [[ -z "$needle" ]] || grep -Fq "$needle" "$body"; }; then
      return 0
    fi
    if [[ "$code" == '525' ]]; then
      echo '::warning title=Cloudflare 525::Cloudflare could not complete TLS handshake with the shared origin edge. Check Nginx TLS listener, SNI and certificate; do not change image-tool logic or lower TLS strictness.'
    fi
    if (( attempt < 3 )); then sleep 2; fi
  done
  echo "::error title=Public HTTPS verification failed::Expected HTTP $expected and valid content at $path; last status $code; cf-ray ${ray:-unavailable}"
  return 1
}

if [[ "$mode" == preflight ]]; then
  # Before deploying anything, prove the shared TLS edge is already healthy.
  check_public '/healthz' 200
  if ! grep -qx 'ok' "$body"; then
    echo '::error title=Public HTTPS health mismatch::Origin healthz must contain exactly ok'
    exit 1
  fi
else
  check_public '/' 200 'href="/resize-image/"'
  check_public '/zh/' 200 'href="/zh/resize-image/"'
  check_public '/resize-image/' 200
  check_public '/robots.txt' 200 'Sitemap: https://image.plainmile.com/sitemap-index.xml'
  check_public '/sitemap-index.xml' 200 'sitemap-0.xml'
  check_public '/nonexistent-route' 404
fi
