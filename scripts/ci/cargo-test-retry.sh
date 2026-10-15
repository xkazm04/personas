#!/usr/bin/env bash
# cargo test, then ONE retry of the tests that failed, and only when the
# failure has the shape of a flake.
#
# Usage: scripts/ci/cargo-test-retry.sh <cargo test args...>
#   e.g. scripts/ci/cargo-test-retry.sh --workspace --manifest-path src-tauri/Cargo.toml --features desktop --no-fail-fast
#
# WHY THIS EXISTS. On 2026-10-15 a master run went red on
# `cli_mail_round_trips_and_an_oversized_body_is_refused`, a two-node P2P
# loopback test that passes on rerun. A GitHub re-run is refused while any job
# of the run is still going, so the flake cost a 36-minute wait and then a
# whole new 70-minute cycle. Retrying the failed tests inside the step costs
# seconds, because the test binaries are already built.
#
# A RETRY IS A LOAN, SO IT IS NARROW AND IT IS LOUD:
#   - only named `test ... FAILED` lines are retried, at most RETRY_MAX_FAILED
#     (default 5) of them. More than that is a regression, not a flake.
#   - no retry when a test binary died without printing its `test result:`
#     line (a crash, an abort, a stack overflow). Its tests have no names to
#     retry, and rerunning the others by name would report the crash as green.
#   - no retry when nothing failed by name (a compile error).
#   - no retry of doc-tests: their names are not --exact filters.
#   - a test that passes on the retry is reported as a `::warning` and in the
#     step summary as FLAKY, by name. It passes the job; it does not vanish.
set -o pipefail  # no -u: macOS runs bash 3.2, where "${arr[@]}" of an empty array is unbound

LOG_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
LOG="$LOG_DIR/cargo-test.log"
MAX="${RETRY_MAX_FAILED:-5}"

cargo test "$@" 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
[ "$STATUS" -eq 0 ] && exit 0

# A read loop, not mapfile: macOS runners run bash 3.2, which has no mapfile.
FAILED=()
while IFS= read -r t; do FAILED+=("$t"); done < <(sed -nE 's/^test (.+) \.\.\. FAILED$/\1/p' "$LOG" | sort -u)

refuse() { echo "::error title=cargo test (not retried)::$1"; exit "$STATUS"; }

[ "${#FAILED[@]}" -gt 0 ] || refuse "cargo test exited $STATUS with no failing test named - a compile error or a crashed binary."
[ "${#FAILED[@]}" -le "$MAX" ] || refuse "${#FAILED[@]} tests failed (more than $MAX) - that is a regression, not a flake."
for t in "${FAILED[@]}"; do
  case "$t" in *" - "*) refuse "doc-test failed: $t (doc-tests are not retried)." ;; esac
done
# Every test binary cargo started must have reported a result. A header with
# no `test result:` after it is a binary that died mid-run.
HEADERS=$(grep -cE '^ +(Running .+ \(.+\)|Doc-tests [A-Za-z0-9_-]+)$' "$LOG" || true)
RESULTS=$(grep -cE '^test result: ' "$LOG" || true)
[ "$HEADERS" -eq "$RESULTS" ] || refuse "$HEADERS test binaries started but only $RESULTS reported a result - one crashed, and a crash is never retried."

echo "::group::retrying ${#FAILED[@]} failed test(s) once"
printf '  %s\n' "${FAILED[@]}"
cargo test "$@" -- --exact "${FAILED[@]}" 2>&1 | tee "$LOG.retry"
RETRY=${PIPESTATUS[0]}
echo "::endgroup::"

# The retry must actually have run every test it was asked to, or a pass
# means nothing (a renamed test, a filter that matched zero).
for t in "${FAILED[@]}"; do
  grep -qE "^test $(printf '%s' "$t" | sed 's/[][\.*^$/]/\\&/g') \.\.\. (ok|FAILED)$" "$LOG.retry" \
    || refuse "the retry did not run '$t' - refusing to call it a flake."
done

if [ "$RETRY" -ne 0 ]; then
  echo "::error title=cargo test::failed again on retry - a real failure:"
  sed -nE 's/^test (.+) \.\.\. FAILED$/  \1/p' "$LOG.retry"
  exit "$RETRY"
fi

for t in "${FAILED[@]}"; do echo "::warning title=flaky test::$t failed, then passed on retry"; done
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Flaky Rust tests (failed, then passed on one retry)"
    echo ""
    for t in "${FAILED[@]}"; do echo "- \`$t\`"; done
    echo ""
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
