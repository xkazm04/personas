#!/usr/bin/env node
// scripts/secret-scan.mjs — the D9 secret-scan control, run from the lefthook pre-commit hook.
//
// Runs gitleaks if it's installed; if not, it SKIPS with an install hint (exit 0) instead of
// breaking the commit. Cross-platform (Node is guaranteed here; a raw shell guard is not — lefthook
// runs under cmd on Windows and sh elsewhere). When gitleaks IS present, real leaks still fail the
// commit, so the control bites once installed.
//
// Modes:
//   (default)  gitleaks protect --staged   — scan staged changes (the pre-commit control + capability verify)
//   --detect   gitleaks detect             — MANUAL full-history audit (slow; run once to triage existing repos)
import { spawnSync } from "node:child_process";

const onWindows = process.platform === "win32";
const detect = process.argv.includes("--detect");
const args = detect
  ? ["detect", "--redact", "--no-banner"]
  : ["protect", "--staged", "--redact", "--no-banner"];

// Probe for gitleaks. On Windows, bare-name resolution needs the shell (PATHEXT/.exe).
const probe = spawnSync("gitleaks", ["version"], { stdio: "ignore", shell: onWindows });
if (probe.error || probe.status !== 0) {
  console.log("[secret-scan] gitleaks not installed — secret scan SKIPPED (commit not blocked).");
  console.log("[secret-scan] Install to enable the D9 control: https://github.com/gitleaks/gitleaks");
  process.exit(0);
}

const res = spawnSync("gitleaks", args, { stdio: "inherit", shell: onWindows });
if (res.status && res.status !== 0) {
  console.error("[secret-scan] gitleaks found potential secrets — commit blocked. Remove them or add an allowlist entry.");
}
process.exit(res.status === null ? 1 : res.status);
