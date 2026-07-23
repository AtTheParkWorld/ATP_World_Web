#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# ATP cutover verification. Run against a domain to confirm the new
# platform is serving correctly — before AND after the DNS switch.
#
#   ./scripts/verify-cutover.sh https://atp-world-web.onrender.com   # pre-cutover baseline
#   ./scripts/verify-cutover.sh https://www.atthepark.world          # after DNS points at Render
#
# Exit code 0 = all green. Non-zero = at least one check failed.
# No secrets required; every check is unauthenticated / public-safe.
# ─────────────────────────────────────────────────────────────────────
set -u
BASE="${1:-https://atp-world-web.onrender.com}"
BASE="${BASE%/}"
SHOP="https://atp-store-7903.myshopify.com"
PASS=0; FAIL=0

c()  { printf '\033[%sm%s\033[0m' "$1" "$2"; }
ok() { PASS=$((PASS+1)); echo "  $(c 32 ✓) $1"; }
no() { FAIL=$((FAIL+1)); echo "  $(c 31 ✗) $1"; }

# expect_code <label> <path> <expected-code>
expect_code() {
  local label="$1" path="$2" want="$3"
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  [ "$got" = "$want" ] && ok "$label ($path → $got)" || no "$label ($path → $got, want $want)"
}
# expect_contains <label> <path> <needle>
expect_contains() {
  local label="$1" path="$2" needle="$3"
  curl -s "$BASE$path" | grep -q -- "$needle" && ok "$label" || no "$label (missing: $needle)"
}
# expect_redirect <label> <path> <needle-in-location>
expect_redirect() {
  local label="$1" path="$2" needle="$3"
  local loc; loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE$path")
  case "$loc" in *"$needle"*) ok "$label ($path → $loc)";; *) no "$label ($path → '$loc', want *$needle*)";; esac
}
# expect_code_any <label> <path> <code1> <code2> — passes if EITHER matches
expect_code_any() {
  local label="$1" path="$2" a="$3" b="$4"
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  { [ "$got" = "$a" ] || [ "$got" = "$b" ]; } && ok "$label ($path → $got)" || no "$label ($path → $got, want $a/$b)"
}

echo "── Verifying: $BASE"
echo
echo "Pages (HTTP 200):"
for p in / /sessions.html /community.html /profile.html /blog.html /coaches.html \
         /plans.html /offers.html /business.html /contacts.html /legal.html \
         /privacy /terms /appeal /join /checkin; do
  expect_code "page" "$p" 200
done
expect_code_any "page" /admin 200 301

echo
echo "Store cutover (redirect to Shopify):"
expect_redirect "/store → Shopify"      /store      "myshopify.com"
expect_redirect "/store.html → Shopify" /store.html "myshopify.com"
curl -s -o /dev/null -w '%{http_code}' "$SHOP" | grep -q 200 && ok "Shopify storefront reachable" || no "Shopify storefront unreachable"

echo
echo "Public APIs (JSON 200):"
expect_code "stats/public"          /api/stats/public                 200
expect_code "stats/public/sessions" "/api/stats/public/sessions?limit=1" 200
expect_code "recent-feedback"       "/api/sessions/recent-feedback?limit=5" 200
expect_code "health"                /health                           200

echo
echo "Auth gating (must NOT be public):"
expect_code "members/me needs auth"    /api/members/me    401
expect_code "corporate-plan gated"     /corporate-plan    404

echo
echo "SEO / infra:"
expect_code "sitemap.xml"  /sitemap.xml 200
expect_code "robots.txt"   /robots.txt  200
expect_code "404 page"     /does-not-exist-xyz 404
expect_contains "canonical = launch domain" / "canonical\" href=\"https://www.atthepark.world"

echo
echo "Universal links (app handoff):"
expect_contains "AASA appIDs world.atthepark.app" /.well-known/apple-app-site-association "world.atthepark.app"
expect_contains "AASA claims /auth/verify"        /.well-known/apple-app-site-association "/auth/verify"
curl -s -I "$BASE/.well-known/apple-app-site-association" | grep -qi 'content-type: application/json' \
  && ok "AASA content-type application/json" || no "AASA wrong content-type (Apple needs application/json, no redirect)"
expect_code "assetlinks.json" /.well-known/assetlinks.json 200

echo
echo "Frontend fixes (audit regressions guard):"
expect_contains "nav links absolute"     /atp.bundle.min.js "href:'/sessions.html'"
expect_contains "auth register repaired" /atp.bundle.min.js "Object.assign({},data.member"
expect_contains "admin appeals wired"    /admin/bundle.min.js "loadAppealsSection"

echo
echo "─────────────────────────────────────────"
echo "  $(c 32 "$PASS passed")   $([ "$FAIL" -gt 0 ] && c 31 "$FAIL failed" || echo "0 failed")"
[ "$FAIL" -eq 0 ] && { echo "  $(c 32 'ALL GREEN — safe to proceed.')"; exit 0; } \
                  || { echo "  $(c 31 'FAILURES — do not cut over until resolved.')"; exit 1; }
