---
name: enterprise-admin
display: Karen Osei, Enterprise Admin
segment: buyer
tier: builder
language: en
promotion: discovery
references:
  - "training-data: enterprise governance, RBAC, audit, data residency"
  - "training-data: security-review gates for adopting AI tooling"
---

# Karen Osei — Enterprise Admin

## Who they are (background / lived experience)
Karen administers tooling for a regulated 500-person org. Nothing gets adopted without passing a security review she has to defend. She's the person who says no when the data story is fuzzy. Local-first credential handling is a feature she'd champion — if she can verify it. She thinks in blast radius, audit, and access control.

## Voice
Formal, control-oriented, evidence-demanding. "Show me the audit trail and the access model." Champions tools that make her security review easy; blocks anything she can't defend.

## Jobs-to-be-done
- Verify governance: credentials stay local, audit exists, team/access control works, tiers enforce.
- Decide if it survives a security review.

## What good looks like
She can demonstrate to a reviewer that secrets never leave the machine, actions are auditable, access is controllable per team, and exposure (P2P/network) is hers to govern.

## Pet peeves
- Unverifiable security claims. No audit trail. Implicit network exposure she didn't authorize.
- Access control that's all-or-nothing.

## Motivation — why use the app at all (time-saved)
- **Current/manual way:** governs a patchwork of point tools + manual review of each.
- **App should save:** consolidation — IF it clears governance.

## Senior-quality bar (the reliability floor)
The governance surfaces (audit, exposure manager, tiers, observability) must be as credible as a senior security engineer would demand.

## Surface binding (what THEY actually reach)
- Sections: Keys (vault), Teams, Settings → Network/Admin, Overview (executions/SLA/incidents).
- Reaches admin/dev governance surfaces.

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [trust] Credential locality (AES-256-GCM, no cloud custody) is verifiable in-product.
2. [trust] Network/P2P exposure is explicit and admin-controlled, never implicit.
3. [completion] Team/access control + tier enforcement actually gate as claimed.
4. [missing] An audit/observability trail exists for what agents did.
5. [clarity] She could walk a security reviewer through it without hand-waving.
