---
id: wire-credential-connector
title: Connect a real service (credential / connector) safely
promotion: discovery
primary_contexts: [credential-vault, credential-negotiator, agent-connectors, oauth-gateway, mcp-protocol]
surfaces: [credentials]
relevant_characters: [software-developer, it-sysadmin, finance-analyst, enterprise-admin, prospect-buyer]
---

## Goal (user POV)
"I need my agent to touch a real service (email, Sentry, a database, an MCP tool) — and I need to trust that my secret stays mine."

## Definition of done
- I added a credential for my service through a path I understood, and I'm confident it's stored locally / encrypted, not shipped to a cloud.
- The agent can now use it; a wrong/missing field gave me a clear error, not a silent failure.

## What L1 must check
- The add-credential type-picker → form/wizard/autopilot paths; does each reach a saved, usable credential?
- Trust signals in the UI: is "credentials stay local / AES-256-GCM" actually surfaced, or only true in the README?
- Reachability across credential types (API key, OAuth, DB, MCP, desktop).

## What L2 must confirm (l2_priority)
- A real connector actually authenticates and a persona can call it (grounded run).
- The trust claim is visible to a skeptical buyer at the moment they enter a secret.
