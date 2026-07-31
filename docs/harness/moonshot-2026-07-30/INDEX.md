# Moonshot Scan — Personas, 2026-07-30

> moonshot-architect lens, group-level over the FRESH 2026-07-30 context map (679 ctx / 16 groups,
> commit `06df9e4`). 16 deep-thinking agents × exactly 2 moonshots = **32 moonshots**.
> Moonshot-adapted Pipeline B: Tier × Feasibility × Time-horizon (no severity, no fix waves —
> accepted items convert to Pipeline-A-style goals in dedicated sessions).

## Totals

| | Tier 1 (10x) | Tier 2 (3-5x) | Feasibility high | medium | Total |
|---|---:|---:|---:|---:|---:|
| Across 16 groups | 30 | 2 | 8 | 24 | **32** |

## Themes (triage buckets)

### A. The Overnight Autonomy Loop — 4 heavily-overlapping bets (pick a flagship, fold the rest in)
Four groups independently converged on "the portfolio improves itself while you sleep":
1. **Overnight Portfolio Engine** (platform-infrastructure#1, T1/high) — Autopilot `full` closes scan→triage→dispatch→verdict→checkpoint.
2. **Overnight Portfolio Operator** (factory-projects#1, T1/med) — same loop framed from Factory KPIs/ship-criteria.
3. **Night Shift** (ai-companion#2, T1/med) — Athena as chief-of-staff planning/supervising the overnight run + morning briefing.
4. **Campaign Conductor** (fleet-orchestration#1, T1/med) — multi-week multi-repo campaign as one durable self-driving object.

### B. Time-Machine Ops — replay, undo, autonomous incident ops
5. **Autonomous NOC** (overview-observability#1, T1/med-high) — observe→decide→act incident loop closes itself.
6. **Counterfactual Engine** (execution-engine#1, T1/med) — fork any past run at any span, deterministic re-execution. *Near-dup of #7.*
7. **Flight Simulator** (overview-observability#2, T1/med) — incident archive → executable regression corpus. *Near-dup of #6 — merge if both accepted.*
8. **Reversible Agent** (database-infrastructure#1, T1/**high**) — attributable, diffable, one-click-undo data ledger per execution.

### C. Self-Improving Agents — evolution with measured fitness
9. **Darwin Mode** (agent-platform#2, T1/med) — measured-fitness evolution loop, governance-gated promotion.
10. **Director's Lab** (agent-quality-governance#2, T1/med) — Director verdicts → hypotheses → A/B experiments → proven diffs.
11. **Self-Tuning Fabric** (execution-engine#2, T1/med) — routing/budgets/healing policy learned from telemetry, shadow-tested.
12. **Self-Evolving Team** (team-collaboration#1, T1/**high**) — retrospective→memory→trust→topology loop per assignment.

### D. Compounding Knowledge Substrate
13. **Brain-as-a-Primitive** (ai-companion#1, T1/med) — Athena's episodic/semantic/procedural memory as a mountable substrate for every persona.
14. **Crew Foundry** (factory-projects#2, T2/med) — each repo births + evolves a bespoke persona crew.
15. **Practice Refinery** (plugin-ecosystem#1, T1/**high**) — every lesson in ~20 repos distilled into versioned installable MCP skills.
16. **Self-Wiring Fabric** (automation-pipelines#1, T1/med) — event bus mines its own traffic, proposes/commits new trigger routes.

### E. Trust & Credentials
17. **Zero-Plaintext Credential Broker** (security-credentials#1, T1/**high**) — revocable handles + audited proxy; no plaintext secrets anywhere.
18. **Living Connector Network** (security-credentials#2, T1/med) — autonomous credential acquisition/keep-alive via signed recipe registry.
19. **Trust Contract** (agent-quality-governance#1, T1/med) — certification as runtime-enforced signed license gating capabilities.
20. **Certified Persona Foundry** (design-build-studio#1, T1/med) — every persona flight-tested + auto-fixed before it exists; living cert score.

### F. Federation & Distribution
21. **Agent Mesh** (agent-platform#1, T1/med) — every persona a signed, addressable node; finishes `a2a/client.rs` TODO into federation.
22. **Signed Persona Exchange** (platform-infrastructure#2, T1/med) — "npm of personas": provenance-verified public registry.
23. **Teams as Addressable Workforce** (team-collaboration#2, T1/med) — dispatch team assignments from MCP/CLI/CI.
24. **Federated Data Plane** (database-infrastructure#2, T1/med) — the 8-connector DB explorer becomes a governed agent-facing data fabric.

### G. Compilers & Shipping Products
25. **Automation Compiler** (automation-pipelines#2, T1/med) — one IR: ingest n8n/Zapier/Make/GH-Actions, compile back to any target.
26. **Athena Ships Agent-Native Apps** (design-build-studio#2, T1/med) — Studio ships the app + the persona workforce that operates it.
27. **Design Genome** (shared-ui-components#2, T1/med) — design system as versioned agent-installable organ for every managed repo.
28. **Twin Goes Live** (plugin-ecosystem#2, T1/med) — Digital Twin graduates to trust-laddered, signing, actually-sending representative.

### H. Command Surfaces
29. **Generative Cockpit** (shared-ui-components#1, T1/**high**) — agents emit live interactive UI from the 122-component catalog, not text.
30. **Morning Director** (home-dashboard#1, T1/**high**) — self-composing action-taking briefing cockpit; fleet run from the Home tab.
31. **Generative Tours** (home-dashboard#2, T1/med) — Athena authors spotlight walkthroughs at runtime for any "show me how".
32. **Fleet Command Anywhere** (fleet-orchestration#2, T2/med) — finish the mobile companion into a real remote bridge.

## Duplicate/overlap notes
- Theme A is one moonshot wearing four hats — the four reports pick different owners (Autopilot vs Factory vs Athena vs Fleet). If accepted, ONE conversion session should design the loop and cite all four reports.
- #6/#7 (Counterfactual Engine / Flight Simulator) share the same core harness (deterministic fork-re-execute-diff); #7 adds incident-to-regression framing.
- #9/#10/#20 all touch the Lab/evolution/certification machinery — sequencing matters if several are accepted.

## Conversion sequence (suggested, post-triage)
Each accepted moonshot = its own Pipeline-A-style goal (5-8 tasks per slice, first slice doable now).
Natural order: trust substrate (E) → replay/undo primitives (B) → autonomy loop (A) → self-improvement (C/D) → federation/distribution (F/G). Command surfaces (H) can interleave anytime.

## Provenance
16 parallel deep-thinking agents (session-model, ~70-110k tokens each), each read the shared
brief + group extract + use-cases + ~8-15 real source files. Reports: `<group-slug>.md` in this
dir. Group extracts + use-cases in `_groups/`. No code was modified.
