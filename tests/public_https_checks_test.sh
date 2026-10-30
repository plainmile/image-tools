#!/usr/bin/env bash
# Fully offline regression checks for public HTTPS gating. No DNS/SSH/API access.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat >"$tmp/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
out='' headers='' url=''
while (($#)); do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --dump-header) headers="$2"; shift 2 ;;
    --write-out|--connect-timeout|--max-time) shift 2 ;;
    *) if [[ "$1" == https://* ]]; then url="$1"; fi; shift ;;
  esac
done
[[ -n "$out" && -n "$headers" && -n "$url" ]] || exit 5
num=$(cat "$MOCK_COUNTER")
num=$((num+1))
printf '%s' "$num" > "$MOCK_COUNTER"
if [[ "$MOCK_CODES" == auto ]]; then
  case "$url" in
    */nonexistent-route) code=404 ;;
    *) code=200 ;;
  esac
else
  code=$(printf '%s' "$MOCK_CODES" | cut -d, -f"$num")
fi
[[ -n "$code" ]] || exit 6
printf 'CF-Ray: synthetic-test-SEA\r\n' > "$headers"
if [[ "$MOCK_BAD_BODY_AT" == "$num" ]]; then
  printf 'unexpected\n' > "$out"
else
  case "$url" in
    */healthz) printf 'ok\n' > "$out" ;;
    */robots.txt) printf 'Sitemap: https://image.plainmile.com/sitemap-index.xml\n' > "$out" ;;
    */sitemap-index.xml) printf 'sitemap-0.xml\n' > "$out" ;;
    */zh/) printf 'href="/zh/resize-image/"\n' > "$out" ;;
    */nonexistent-route) printf 'not found\n' > "$out" ;;
    */) printf 'href="/resize-image/"\n' > "$out" ;;
    *) printf 'image tool\n' > "$out" ;;
  esac
fi
printf '%s' "$code"
MOCK_CURL
cat >"$tmp/bin/sleep" <<'MOCK_SLEEP'
#!/usr/bin/env bash
exit 0
MOCK_SLEEP
chmod +x "$tmp/bin/curl" "$tmp/bin/sleep"

run_case() {
  local label="$1" mode="$2" codes="$3" bad_body="$4" expected="$5" expected_calls="$6"
  printf '0' > "$tmp/count"
  local status=0
  PATH="$tmp/bin:$PATH" MOCK_COUNTER="$tmp/count" MOCK_CODES="$codes" MOCK_BAD_BODY_AT="$bad_body" \
    bash "$root/tests/public_https_checks.sh" "$mode" > "$tmp/log" 2>&1 || status=$?
  if [[ "$status" != "$expected" ]] || [[ "$(cat "$tmp/count")" != "$expected_calls" ]]; then
    echo "FAIL $label (exit $status vs $expected; requests $(cat "$tmp/count") vs $expected_calls)" >&2
    cat "$tmp/log" >&2
    exit 1
  fi
  if [[ "$expected" != 0 ]] && ! grep -q '^::error title=' "$tmp/log"; then
    echo "FAIL $label: no actionable CI error" >&2
    cat "$tmp/log" >&2
    exit 1
  fi
  echo "PASS $label"
}

# Three fully healthy probes are required before changing production.
run_case 'three clean public preflight samples' preflight '200,200,200' 0 0 3
# A recovered 525 is still a shared origin TLS outage, not an all-clear.
run_case 'a single intermittent Cloudflare 525 blocks deploy' preflight '200,525,200' 0 1 3
# Other temporary edge errors and misleading 200 bodies also block deploy.
run_case 'a recovered 503 blocks deploy before mutation' preflight '503,200,200' 0 1 3
run_case 'misleading HTTP 200 with wrong health body blocks deploy' preflight '200,200,200' 2 1 3
# Existing release path/content checks must remain intact.
run_case 'healthy post-deploy release smoke' release auto 0 0 6
run_case 'a recovered Cloudflare 525 cannot produce green release' release '525,200' 0 1 2
echo 'All public HTTPS gating regression tests passed.'
