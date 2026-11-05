# Security policy: personas

The shift-left guardrail against the vulnerable or secret-leaking code AI can confidently produce.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/xkazm04/personas/security/advisories/new)**
(the repository's **Security** tab, then **Report a vulnerability**). Please include:

- the version (Settings > About, or the release tag) and the platform (Windows, macOS, Linux, Android);
- what an attacker can do, and what they need first (local access, the same network, a paired device, a crafted
  template or connector);
- steps or a proof of concept, and any logs with secrets removed.

What happens next:

| Step | Target |
|---|---|
| Acknowledgement of your report | within 7 days |
| First assessment (confirmed or not, severity) | within 14 days |
| Fix or mitigation for a confirmed high or critical issue | in the next release, aimed at within 90 days |
| Public disclosure | coordinated with you, after a fixed release is out; we credit you unless you ask us not to |

The maintainer triages reports (see `.github/CODEOWNERS`). These are targets from a small team, not a contract; if you
hear nothing within 7 days, add a comment to your advisory.

**In scope:** the desktop app (`src/`, `src-tauri/`), its installers and auto-update channel
(`releases/latest/download/latest.json`), the phone companion and device pairing, the MCP server in `scripts/mcp-server`,
and the cloud worker in `cloud-worker/`. **Out of scope:** issues in third-party services the app connects to (report
those to their vendor), and findings that need an already compromised machine or account.

Only the latest release gets security fixes.

## Automated guardrails we run

- [x] SAST: CodeQL on every pull request and weekly (`.github/workflows/codeql.yml`; JavaScript/TypeScript only, the
  Rust code is not covered by it)
- [x] Dependency scanning: `cargo deny` in CI (`.github/workflows/ci.yml`) and a weekly audit
  (`.github/workflows/audit.yml`: `cargo audit`, `npm audit` through `scripts/security-audit.sh`, `cargo deny`);
  Renovate opens dependency updates (`renovate.json`)
- [ ] Secret scanning in CI: today only locally, through the lefthook pre-commit hook (`scripts/secret-scan.mjs`
  runs gitleaks when it is installed and skips otherwise); no CI job runs it
- [ ] Container image scanning: not applicable, no container image is shipped
- [ ] SBOM + signed, attested build artifacts (cosign/SLSA): updater bundles are signed with the Tauri updater key
  (`.github/workflows/release.yml`, `TAURI_SIGNING_PRIVATE_KEY`); `scripts/sbom.mjs` generates CycloneDX SBOMs from the
  lockfiles (`docs/development/release.md`, "SBOM"), but no release step publishes them and no build provenance is
  attested yet

## Notes

The workflows that enforce the ticked items: `.github/workflows/codeql.yml` (SAST), `.github/workflows/ci.yml`
(`cargo deny`), `.github/workflows/audit.yml` (weekly dependency audit) and `.github/workflows/release.yml` (updater
signatures; the release fails when a platform bundle or its signature is missing).
