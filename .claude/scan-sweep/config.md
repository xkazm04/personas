---
autonomy:
  start:
    technical: 2
    product: 0
  frozen: []
---

# scan-sweep overlay - Personas

Read by `/scan-sweep` (ai-registry `skills/scan-sweep/SKILL.md`, "Project overlay"). Scaffolded 2026-10-30
(spark backlog-scan-family). Every key not set here takes the skill's default.

## Autonomy

The ladder's gate lives in this app's store, not in the skill: `POST /dev-tools/ideas` with `autoDecide`
looks the slice's level up itself (`GET /dev-tools/scan/trust`), and the Backlog's Trust popover shows each
slice's level, agreement and newest transition. These keys may only LOWER the contract's start levels.
