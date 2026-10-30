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
  local path="$1" expected="$2" needle="${3:-}" strict="${4:-0}"
  local code ray attempt failures=0 saw_525=0 matched
  for attempt in 1 2 3; do
    : > "$body"
    : > "$headers"
    code=$(curl --silent --show-error --connect-timeout 8 --max-time 20 \
      --output "$body" --dump-header "$headers" --write-out '%{http_code}' \
      "$base$path") || code='000'
    ray=$(grep -i '^cf-ray:' "$headers" | tail -n 1 | cut -d ':' -f2- | tr -cd 'A-Za-z0-9-' || true)
    printf 'HTTPS %s: %s (attempt %s/3, CF-Ray %s)\n' "$path" "$code" "$attempt" "${ray:-unavailable}"
    if [[ "$code" == '525' ]]; then
      saw_525=1
      echo '::warning title=Cloudflare 525::Cloudflare could not complete TLS handshake with the shared origin edge. Check Nginx TLS listener, SNI and certificate; do not change image-tool logic or lower TLS strictness.'
    fi
    matched=1
    if [[ "$code" != "$expected" ]]; then
      matched=0
    elif [[ "$strict" == '1' ]]; then
      # Preflight health must be exactly "ok" on *every* independent probe.
      grep -qx 'ok' "$body" || matched=0
    elif [[ -n "$needle" ]]; then
      grep -Fq "$needle" "$body" || matched=0
    fi
    if [[ "$matched" == 0 ]]; then
      failures=$((failures+1))
    elif [[ "$strict" != '1' ]]; then
      # A public endpoint that required retry after a 525 is NOT healthy.
      # A green deploy would otherwise hide the intermittent origin TLS fault.
      if [[ "$saw_525" == 1 ]]; then
        echo "::error title=Intermittent Cloudflare 525::HTTPS $path recovered after a TLS 525. Release is not verified healthy; investigate origin SNI/TLS without modifying this image container."
        return 1
      fi
      return 0
    fi
    if (( attempt < 3 )); then sleep 2; fi
  done
  if [[ "$strict" == '1' && "$failures" == 0 ]]; then return 0; fi
  echo "::error title=Public HTTPS verification failed::Expected HTTP $expected and valid content at $path; $failures of 3 checks failed; last status $code; cf-ray ${ray:-unavailable}"
  return 1
}

if [[ "$mode" == preflight ]]; then
  # Do not deploy into an intermittently failing shared TLS edge.
  # Three separate checks, including exact content, must ALL succeed.
  # A retry succeeding after a 525 is diagnostic evidence, not a clean preflight.
  check_public '/healthz' 200 'ok' 1
else
  check_public '/' 200 'href="/resize-image/"'
  check_public '/zh/' 200 'href="/zh/resize-image/"'
  check_public '/resize-image/' 200
  check_public '/robots.txt' 200 'Sitemap: https://image.plainmile.com/sitemap-index.xml'
  check_public '/sitemap-index.xml' 200 'sitemap-0.xml'
  check_public '/nonexistent-route' 404
fi
