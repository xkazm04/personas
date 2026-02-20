---
name: build-review
description: Run full build/test pipeline and fix any issues found
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Build Review Pipeline

You are running a preemptive build review for the **personas-desktop** Tauri application.

## Step 1: Execute the build pipeline

Run the build-review script and capture all output:

```
bash scripts/build-review.sh
```

Wait for it to complete fully. The script runs these checks:
1. ESLint (frontend lint)
2. TypeScript typecheck (`tsc -b --noEmit`)
3. Vitest (frontend unit tests)
4. Cargo test (Rust backend tests)
5. Cargo clippy (Rust lint)

## Step 2: Read the full report

Read the generated report file:

```
build-review-report.txt
```

## Step 3: Analyze and fix

For each failing step in the report:

1. **Parse every error** — extract the file path, line number, and error message
2. **Read the relevant source files** to understand the context
3. **Fix each issue directly** using the Edit tool:
   - Lint errors: fix the code to satisfy the lint rule
   - Type errors: fix type mismatches, missing imports, unused variables
   - Test failures: fix the test or the code under test
   - Clippy warnings: apply the suggested fix
4. **Skip issues that cannot be fixed locally** (e.g., missing system dependencies, CI-only failures) — list these at the end

## Step 4: Re-verify

After making all fixes, run the pipeline again:

```
bash scripts/build-review.sh
```

If there are still failures, repeat steps 2-4 until all checks pass or only unfixable issues remain.

## Step 5: Report

Provide a summary:
- Total issues found and fixed
- Any remaining unfixable issues with explanation
- Files modified

Do NOT commit any changes — leave that to the user.
