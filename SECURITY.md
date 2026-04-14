# Security Policy

Thank you for helping keep Personas Desktop and its users safe. This document explains how to report a vulnerability and what you can expect from us in return.

## Supported Versions

We provide security fixes for the latest minor release line. Older versions do not receive patches — users are expected to upgrade.

| Version   | Supported          |
| --------- | ------------------ |
| 0.4.x     | Yes                |
| < 0.4.0   | No                 |

Until the project reaches a stable 1.0 release, APIs, database schemas, and IPC surfaces may change between minor versions. Security fixes will be back-ported to the latest minor line only.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Public disclosure before a fix is available puts users at risk.

Instead, report privately using one of the following channels:

1. **GitHub Security Advisories** (preferred) — use the "Report a vulnerability" button on the [Security tab](https://github.com/xkazm04/personas/security/advisories) of this repository. This creates a private advisory visible only to maintainers.
2. **Email** — `michal.kazdan@borndigital.ai` with the subject line `[personas-security] <short description>`.

When reporting, please include as much of the following as you can:

- A clear description of the issue and its impact
- Steps to reproduce, ideally with a minimal proof of concept
- The affected version(s) and platform(s)
- Any known mitigations or workarounds
- Whether you intend to disclose the issue publicly and on what timeline

You do not need to have a fix ready — a clear report is more valuable than an incomplete patch.

## What to Expect

- **Acknowledgement** — we aim to acknowledge new reports within **3 business days**.
- **Triage** — within **7 business days** we will confirm whether the report is in scope and assign a severity.
- **Fix timeline** — depends on severity. Critical issues are prioritized immediately; lower-severity issues are batched into the next regular release.
- **Disclosure** — once a fix is released, we will publish a GitHub Security Advisory crediting the reporter (unless anonymity is requested) and describing the issue, affected versions, and remediation steps.
- **Credit** — we're happy to credit reporters by name, handle, or organization in the advisory and changelog. Let us know your preference when reporting.

## Scope

### In scope

- The desktop application itself (Rust backend, React frontend, Tauri IPC surface)
- The credential vault and encryption flow (AES-256-GCM, keyring integration, key derivation)
- The local webhook / trigger server (`localhost:9420`)
- The auto-updater and signing verification
- Built-in connectors that ship with the app
- Generated release binaries

### Out of scope

- Vulnerabilities in third-party AI provider APIs (Anthropic, OpenAI, Google, GitHub) — please report those directly to the vendor.
- Vulnerabilities in operating system components (WebView2, Keychain, Secret Service) — please report those to the OS vendor.
- Attacks that require the attacker to already have local administrator access on the user's machine, or physical access to an unlocked session.
- Issues in third-party connector endpoints — we pass credentials through, but the endpoint itself is operated by the service provider.
- Social engineering attacks against project maintainers.
- Automated scanner output without a demonstrable exploit.

## Threat Model (High Level)

Personas Desktop is a **local-first** application. Its security posture rests on:

1. **Credentials are encrypted at rest** with AES-256-GCM. The encryption key is stored in the OS-native keyring (Windows Credential Manager / macOS Keychain / Linux Secret Service), never on disk in plaintext. A PBKDF2-HMAC-SHA256 fallback (600k iterations) is used when no keyring is available.
2. **Credentials never touch the frontend in plaintext unnecessarily**. IPC transport uses a hybrid RSA-2048 + AES-256-GCM envelope, and session keys are regenerated on every app launch.
3. **Child processes receive credentials as environment variables**, not CLI arguments. Env vars are scrubbed from the parent process after the child is spawned.
4. **Sensitive values are zeroized on drop** (`ZeroizeOnDrop`) to reduce the window during which they live in memory.
5. **All outbound HTTP uses `rustls-tls`** — no cleartext HTTP to external services.
6. **The local webhook server binds to `127.0.0.1` only** and does not expose itself on the network.

Reports that demonstrate a break in any of the above assumptions are the highest priority.

## Safe Harbor

We support good-faith security research. If you make a reasonable, good-faith effort to comply with this policy, we will:

- Consider your research to be authorized
- Work with you to understand and resolve the issue quickly
- Not pursue legal action related to your research

"Good faith" means: you do not access data beyond what is needed to demonstrate the vulnerability, you do not degrade the service for other users, you give us a reasonable window to fix the issue before public disclosure, and you do not attempt to extort payment.

This project does not currently run a paid bug bounty program.

---

Thank you for helping make Personas Desktop safer.
