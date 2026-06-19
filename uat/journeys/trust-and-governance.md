---
id: trust-and-governance
title: Evaluate trust, data locality, and governance (buyer lens)
promotion: discovery
primary_contexts: [credential-vault, settings-preferences, p2p-networking, teams-management, error-analytics]
surfaces: [credentials, settings, team, overview]
relevant_characters: [prospect-buyer, enterprise-admin, it-sysadmin]
---

## Goal (user POV)
"Before I bet my team/clients on this, prove it's safe: where do my secrets live, what's the audit story, can I control access, and is it worth switching?"

## Definition of done
- I could verify (in-product, not just docs) that credentials stay local/encrypted and nothing leaves my machine without consent.
- I found tier/governance controls and an audit/observability story I'd defend to a security reviewer.
- I formed a clear "switch from Zapier/n8n or not" verdict.

## What L1 must check
- Are the trust claims (local-first, AES-256-GCM, no cloud custody) actually surfaced in the UI, or only in code/README?
- Governance reachability: admin controls, tier gates, network/P2P exposure manager, audit/incident surfaces.

## What L2 must confirm (l2_priority)
- The trust claim is legible at the moment of entering a secret and at the network-exposure surface.
- The credibility of the observability/audit surfaces under a skeptical eye.
