#!/usr/bin/env bash
# ============================================================================
# build-review.sh — Preemptive build & test pipeline for personas-desktop
#
# Runs all quality checks and writes results to build-review-report.txt.
# Exit code = number of failed steps (0 = all green).
#
# Works on: Linux, macOS, Windows (Git Bash / MSYS2)
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT="$PROJECT_DIR/build-review-report.txt"

cd "$PROJECT_DIR"

FAILURES=0
STEP=0

header() {
  local label="$1"
  STEP=$((STEP + 1))
  echo ""
  echo "========================================================================"
  echo "  STEP $STEP: $label"
  echo "========================================================================"
  echo ""
}

report_header() {
  local label="$1"
  {
    echo ""
    echo "========================================================================"
    echo "  STEP $STEP: $label"
    echo "========================================================================"
    echo ""
  } >> "$REPORT"
}

run_step() {
  local label="$1"
  shift
  local cmd=("$@")

  header "$label"
  report_header "$label"

  local output
  local exit_code
  output=$("${cmd[@]}" 2>&1) && exit_code=0 || exit_code=$?

  echo "$output"
  echo "$output" >> "$REPORT"

  if [ "$exit_code" -ne 0 ]; then
    echo ""
    echo "  >>> FAILED (exit code $exit_code)"
    echo "  >>> FAILED (exit code $exit_code)" >> "$REPORT"
    FAILURES=$((FAILURES + 1))
  else
    echo ""
    echo "  >>> PASSED"
    echo "  >>> PASSED" >> "$REPORT"
  fi
}

# ── Initialize report ──────────────────────────────────────────────────────
{
  echo "========================================================================"
  echo "  BUILD REVIEW REPORT"
  echo "  Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "  Project:   personas-desktop"
  echo "========================================================================"
} > "$REPORT"

# ── Step 1: ESLint ─────────────────────────────────────────────────────────
run_step "ESLint" npx eslint src/

# ── Step 2: TypeScript type check ──────────────────────────────────────────
run_step "TypeScript typecheck" npx tsc -b --noEmit

# ── Step 3: Vitest (frontend tests) ───────────────────────────────────────
run_step "Frontend tests (Vitest)" npx vitest run

# ── Step 4: Rust tests (cargo test) ───────────────────────────────────────
run_step "Rust tests (cargo test)" cargo test --manifest-path src-tauri/Cargo.toml

# ── Step 5: Rust lint (cargo clippy) ──────────────────────────────────────
run_step "Rust lint (cargo clippy)" cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# ── Summary ────────────────────────────────────────────────────────────────
{
  echo ""
  echo "========================================================================"
  echo "  SUMMARY"
  echo "========================================================================"
  echo ""
  echo "  Total steps: $STEP"
  echo "  Passed:      $((STEP - FAILURES))"
  echo "  Failed:      $FAILURES"
  echo ""
  if [ "$FAILURES" -eq 0 ]; then
    echo "  RESULT: ALL CHECKS PASSED"
  else
    echo "  RESULT: $FAILURES CHECK(S) FAILED"
  fi
  echo ""
} | tee -a "$REPORT"

echo "Full report: $REPORT"
exit "$FAILURES"
