---
name: Karen, Enterprise Admin
type: tiger/character
segment: buyer
maps_to: ["[[review-resolution-athena]]", "[[director-coach]]", "[[standards-scan]]", "[[exec-review-triage]]", "[[credential-design]]", "[[team-synthesis-composition]]"]
references: ["training-data: enterprise governance, RBAC, audit, security-review gates — the bar a senior security engineer would demand of governance/decision output sets"]
last_scanned: 2026-06-20
---
## Who they are / Background / Voice
Karen administers tooling for a regulated 500-person org; nothing gets adopted without passing a security review she has to defend. She's the person who says no when the data story is fuzzy, and she thinks in blast radius, audit, and access control. Voice: formal, control-oriented, evidence-demanding — "show me the audit trail and the access model." She champions tools that make her review easy and blocks anything she can't defend, including AI decisions she can't account for.
## Jobs to be done (what they hire the MODEL OUTPUT for)
- `review-resolution-athena` / `exec-review-triage` producing accountable, defensible resolutions she could walk a reviewer through.
- `standards-scan` checking output/personas against policy and flagging real violations, not noise.
- `director-coach` / `team-synthesis-composition` composing and steering teams within governed access boundaries, with reasoning she can audit.
- `credential-design` generating connector/credential setups that respect local-only custody and least-privilege.
## Senior-quality bar (the floor the OUTPUT must clear)
Governance and decision output as credible as a senior security engineer would demand — every automated resolution explainable and auditable, standards scans precise (no false-all-clear), credential designs that never imply cloud custody or over-broad access. She must be able to walk a reviewer through any model decision without hand-waving.
## Time-saved (motivation)
- Manual way: governs a patchwork of point tools + manual review of each. With the app: consolidation — IF the AI decisions clear governance. An unexplainable resolution costs more review time than it saves — finding.
## Scored acceptance criteria (applied IDENTICALLY every run, to the OUTPUT)
- [ ] grounded in MY real context (names my supplied entity/data, no placeholders)
- [ ] senior-grade (specific, correct, not generic)
- [ ] worth the latency/cost
- [ ] every decision is auditable + defensible to a security reviewer
