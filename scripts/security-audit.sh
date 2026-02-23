#!/usr/bin/env bash
# security-audit.sh — Deep security scanning for Personas Desktop
#
# Checks:
#   1. cargo audit  — known CVEs in Rust dependencies
#   2. npm audit    — known CVEs in Node dependencies
#   3. Secret scan  — grep for hardcoded keys/tokens in source
#   4. Crypto-specific checks (nonce, PBKDF2, unwrap, plaintext writes)
#   5. Outputs JUnit XML for GitLab test results tab
#
# Usage: bash scripts/security-audit.sh
# Exit code: 0 = all pass, 1 = at least one failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/security-results"
JUNIT_FILE="$RESULTS_DIR/security-audit.xml"

mkdir -p "$RESULTS_DIR"

TOTAL=0
PASSED=0
FAILED=0
TESTCASES=""

# Helper: record a test result
record_test() {
  local name="$1"
  local classname="$2"
  local status="$3" # pass or fail
  local message="${4:-}"

  TOTAL=$((TOTAL + 1))

  if [ "$status" = "pass" ]; then
    PASSED=$((PASSED + 1))
    TESTCASES="$TESTCASES    <testcase classname=\"$classname\" name=\"$name\" />\n"
  else
    FAILED=$((FAILED + 1))
    TESTCASES="$TESTCASES    <testcase classname=\"$classname\" name=\"$name\">\n"
    TESTCASES="$TESTCASES      <failure message=\"$name failed\"><![CDATA[$message]]></failure>\n"
    TESTCASES="$TESTCASES    </testcase>\n"
  fi
}

echo "=== Personas Desktop Security Audit ==="
echo ""

# ─── 1. Cargo audit ─────────────────────────────────────────────────────
echo "[1/5] cargo audit — checking Rust dependencies for known CVEs..."
if command -v cargo-audit &>/dev/null || cargo install cargo-audit --locked 2>/dev/null; then
  if cargo audit --file "$ROOT_DIR/src-tauri/Cargo.lock" 2>"$RESULTS_DIR/cargo-audit-stderr.txt"; then
    echo "  PASS: No known vulnerabilities in Rust dependencies."
    record_test "cargo-audit" "security.dependencies" "pass"
  else
    MSG=$(cat "$RESULTS_DIR/cargo-audit-stderr.txt" 2>/dev/null || echo "cargo audit found vulnerabilities")
    echo "  FAIL: cargo audit found issues."
    record_test "cargo-audit" "security.dependencies" "fail" "$MSG"
  fi
else
  echo "  SKIP: cargo-audit not available."
  record_test "cargo-audit" "security.dependencies" "fail" "cargo-audit binary not available"
fi

# ─── 2. npm audit ───────────────────────────────────────────────────────
echo "[2/5] npm audit — checking Node dependencies for known CVEs..."
if npm audit --audit-level=high --json >"$RESULTS_DIR/npm-audit.json" 2>/dev/null; then
  echo "  PASS: No high/critical vulnerabilities in Node dependencies."
  record_test "npm-audit" "security.dependencies" "pass"
else
  VULN_COUNT=$(node -e "try{const r=require('$RESULTS_DIR/npm-audit.json');console.log(r.metadata?.vulnerabilities?.high+r.metadata?.vulnerabilities?.critical||'unknown')}catch{console.log('unknown')}" 2>/dev/null || echo "unknown")
  echo "  FAIL: npm audit found $VULN_COUNT high/critical vulnerabilities."
  record_test "npm-audit" "security.dependencies" "fail" "$VULN_COUNT high/critical vulnerabilities found"
fi

# ─── 3. Secret pattern scan ─────────────────────────────────────────────
echo "[3/5] Secret pattern scan — checking for hardcoded keys/tokens..."

SECRET_PATTERNS=(
  'AKIA[0-9A-Z]{16}'                          # AWS access key
  'sk-[a-zA-Z0-9]{20,}'                       # OpenAI / Stripe secret key
  'ghp_[a-zA-Z0-9]{36}'                       # GitHub PAT
  'glpat-[a-zA-Z0-9\-_]{20,}'                 # GitLab PAT
  'xoxb-[0-9]+-[a-zA-Z0-9]+'                  # Slack bot token
  '-----BEGIN (RSA |EC )?PRIVATE KEY-----'     # Private keys
  'password\s*=\s*"[^"]{8,}"'                  # Hardcoded passwords
)

SECRET_HITS=""
for pattern in "${SECRET_PATTERNS[@]}"; do
  MATCHES=$(grep -rn --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.js" \
    -E "$pattern" "$ROOT_DIR/src" "$ROOT_DIR/src-tauri/src" 2>/dev/null | \
    grep -v 'node_modules' | grep -v 'target/' | grep -v '\.test\.' | grep -v '__tests__' || true)
  if [ -n "$MATCHES" ]; then
    SECRET_HITS="$SECRET_HITS\n$MATCHES"
  fi
done

if [ -z "$SECRET_HITS" ]; then
  echo "  PASS: No hardcoded secrets found."
  record_test "secret-scan" "security.secrets" "pass"
else
  echo "  FAIL: Potential hardcoded secrets detected:"
  echo -e "$SECRET_HITS" | head -20
  record_test "secret-scan" "security.secrets" "fail" "Potential hardcoded secrets found: $(echo -e "$SECRET_HITS" | wc -l) matches"
fi

# ─── 4. Crypto-specific checks ──────────────────────────────────────────
echo "[4/5] Crypto-specific checks..."

CRYPTO_FILE="$ROOT_DIR/src-tauri/src/engine/crypto.rs"
CRYPTO_FAILURES=""

# 4a. Verify nonce randomness (must use OsRng, not static/zeroed nonces)
echo "  [4a] Checking nonce randomness..."
if grep -q 'OsRng' "$CRYPTO_FILE" 2>/dev/null; then
  # Check there are no static nonces (Nonce::from_slice with hardcoded bytes)
  STATIC_NONCE=$(grep -n 'Nonce::from_slice.*\[0' "$CRYPTO_FILE" 2>/dev/null || true)
  if [ -n "$STATIC_NONCE" ]; then
    CRYPTO_FAILURES="$CRYPTO_FAILURES\nStatic nonce detected: $STATIC_NONCE"
    echo "    FAIL: Static nonce detected."
  else
    echo "    PASS: Nonces use OsRng for randomness."
  fi
else
  CRYPTO_FAILURES="$CRYPTO_FAILURES\nOsRng not found in crypto.rs — nonces may not be random"
  echo "    FAIL: OsRng not found."
fi

# 4b. Check PBKDF2 iterations >= 600k
echo "  [4b] Checking PBKDF2 iterations..."
PBKDF2_ITERS=$(grep -oP 'pbkdf2_hmac.*?(\d{3,}[_,]?\d{3})' "$CRYPTO_FILE" 2>/dev/null | grep -oP '\d[\d_,]+' | tail -1 | tr -d '_,' || echo "0")
if [ "$PBKDF2_ITERS" -ge 600000 ] 2>/dev/null; then
  echo "    PASS: PBKDF2 iterations = $PBKDF2_ITERS (>= 600,000)."
else
  CRYPTO_FAILURES="$CRYPTO_FAILURES\nPBKDF2 iterations too low: $PBKDF2_ITERS (need >= 600,000)"
  echo "    FAIL: PBKDF2 iterations = $PBKDF2_ITERS."
fi

# 4c. No plaintext credential writes outside crypto.rs
echo "  [4c] Checking for plaintext credential writes outside crypto module..."
PLAINTEXT_WRITES=$(grep -rn --include="*.rs" \
  'set_password\|insert.*credential.*data\|update.*credential.*data' \
  "$ROOT_DIR/src-tauri/src/" 2>/dev/null | \
  grep -v 'crypto\.rs' | grep -v 'target/' | grep -v '#\[test\]' | grep -v '// ' || true)
# Filter out keyring set_password calls (those are fine)
PLAINTEXT_WRITES=$(echo "$PLAINTEXT_WRITES" | grep -v 'keyring' | grep -v 'Entry::new' || true)
if [ -z "$PLAINTEXT_WRITES" ]; then
  echo "    PASS: No plaintext credential writes found outside crypto module."
else
  CRYPTO_FAILURES="$CRYPTO_FAILURES\nPlaintext credential writes outside crypto.rs:\n$PLAINTEXT_WRITES"
  echo "    FAIL: Plaintext credential writes detected."
fi

# 4d. No unwrap() in crypto/credential code paths
echo "  [4d] Checking for unwrap() in crypto/credential code..."
UNWRAP_HITS=$(grep -rn '\.unwrap()' \
  "$ROOT_DIR/src-tauri/src/engine/crypto.rs" \
  "$ROOT_DIR/src-tauri/src/commands/credentials/" \
  2>/dev/null | grep -v '#\[test\]' | grep -v '// test' || true)
if [ -z "$UNWRAP_HITS" ]; then
  echo "    PASS: No unwrap() calls in crypto/credential paths."
else
  CRYPTO_FAILURES="$CRYPTO_FAILURES\nunwrap() in crypto/credential code:\n$UNWRAP_HITS"
  echo "    FAIL: unwrap() calls found in crypto/credential code."
fi

if [ -z "$CRYPTO_FAILURES" ]; then
  record_test "crypto-checks" "security.crypto" "pass"
else
  record_test "crypto-checks" "security.crypto" "fail" "$(echo -e "$CRYPTO_FAILURES")"
fi

# ─── 5. Write JUnit XML ─────────────────────────────────────────────────
echo ""
echo "[5/5] Writing JUnit XML report..."

cat > "$JUNIT_FILE" <<XMLEOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Security Audit" tests="$TOTAL" failures="$FAILED">
  <testsuite name="security-audit" tests="$TOTAL" failures="$FAILED">
$(echo -e "$TESTCASES")  </testsuite>
</testsuites>
XMLEOF

echo "  Report written to: $JUNIT_FILE"
echo ""

# ─── Summary ─────────────────────────────────────────────────────────────
echo "=== Summary ==="
echo "  Total checks: $TOTAL"
echo "  Passed:       $PASSED"
echo "  Failed:       $FAILED"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "RESULT: FAIL — $FAILED check(s) did not pass."
  exit 1
else
  echo "RESULT: PASS — All security checks passed."
  exit 0
fi
