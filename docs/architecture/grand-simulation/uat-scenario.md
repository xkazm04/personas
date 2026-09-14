# Grand Simulation — the `/uat` dimension (gap G10)

The operator's rule: "look at `/uat` for fixtures and simulated scenarios both ways." Both ways
are two different artefacts, and the plan (`../grand-simulation.md` §6) needed a concrete shape
for each. This file is that shape. Nothing here runs yet; it is what the `/grand-sim` skill's
`load` and `reflect` modes and the bank repositories' own `uat/` overlays read.

## Direction 1 — the simulation feeds `/uat` (fixtures)

`/uat` L2 refuses to judge a Character whose journey has no fixture ("untestable, not passing").
The simulation is a fixture factory: every workspace, project, App Master, goal, KPI and idea it
creates is a row a later `/uat` run can stand on. The generator
`scripts/e2e/sim-uat-fixtures.mjs` reads the live Personas database and writes the FIXTURES
section of an `env.md` for one workspace:

```bash
node scripts/e2e/sim-uat-fixtures.mjs --workspace Bank                 # print the section
node scripts/e2e/sim-uat-fixtures.mjs --workspace Bank --out uat/env.sim.md
```

What it emits, per workspace: the projects with their repositories and App Master (or the
absence of one, which is itself a fixture for the `architect-notices-an-unowned-project`
journey), the Architect, the goals with progress, the KPIs with their last measurement, the
idea backlog by status, and the active-persona headroom. Each line is a checkbox in the
`/uat` fixture convention, pre-ticked when the row exists and left open when a journey needs
something the simulation has not produced yet. The generator never writes into the bank
repositories; the App Master of each repository copies the section into its own `uat/env.md`
(that is one of the `acceptance-certification` charter's steps, see Direction 2).

Provenance rule carried over from `/uat` v1.6: every fixture line names its source row id and
`updated_at`, so a later run can tell simulation residue from product data.

Reachability rule from the reference (its abuse-smoke lane: "a 200 or 5xx on any probe is a
finding, not a pass"): a fixture that answers 401 to the identity a journey will actually use is
rejection evidence, not a baseline. The generator's next revision records, per fixture line,
whether the row is reachable with the journey's own identity, not only that the row exists. Until
then a Character's L2 preflight checks it by hand.

## Direction 2 — `/uat` scenarios drive the simulation (Characters and journeys)

The bank has no users, so its Characters are the closest thing to a product owner it will have.
They are derived from the bank's target group, not reused from the Personas roster (the skill's
own rule: "never reuse a generic roster across apps"). The roster below is the proposal for the
operator's open decision 5; each becomes a file under `<bank-repo>/uat/characters/` once the
Architect scaffolds the overlay.

| Character | Segment | Job to be done | LLM-less time | Senior bar |
|---|---|---|---|---|
| Retail customer (Jana) | consumer, mobile-first | open an account, pay a friend, see a statement | 25 min at a branch | a payment either lands or says exactly why not |
| SME treasurer (Tomas) | business, batch payer | pay 300 invoices on the 25th, reconcile the next morning | 3 h in spreadsheets | a batch never half-executes |
| Loan officer (Petra) | internal, back office | decide 40 applications a day inside policy | 20 min each by hand | every decision carries its reasons and its policy version |
| Compliance officer (Marek) | internal, control | prove every contract exchange is signed by both parties and immutable | a day per audit | an audit trail that needs no explanation |
| Fraud analyst (Eva) | internal, real time | see a suspicious pattern within a minute of it starting | never, without tooling | every alert names the signal that fired and the window it fired over (the reference's fraud service is a velocity-counter signal plane with no rule engine, so a rate-based bar would judge a thing that does not exist) |
| Investor (Lukas) | consumer, cautious | put money in a fund and understand what it costs | an hour reading PDFs | fees and risk stated before the button |
| Platform SRE (Nadia) | internal, operations | keep the bank up under the month-end wave | on call | the queue depth and the error budget, on one screen |
| TPP developer (Ondrej) | external, integrator | read a customer's account through the open-banking API with the customer's consent | weeks of bilateral integration | consent, SCA and the scope of the read are visible in one decision log |
| Auditor (Hana) | external, evidence | prove that every gate the bank claims to run actually ran and could fail | a week of sampling | a green gate that checked nothing is her finding, not a pass |

The TPP developer and the auditor come from the reference (`open-bank-reference.md` §8.5): the
first is the only Character who exercises the edge project's main external surface, the second
separates the evidence function from Marek's control function.

Journeys (goals with a user-POV definition of done, never step scripts):

- `open-account` — Jana has an account with an IBAN and a first login within five minutes.
- `pay-a-friend` — a payment between two accounts is visible on both sides with a final status.
- `batch-payroll` — Tomas submits 300 payments; every one is either executed or explained.
- `exchange-a-contract` — two parties sign, the document hash is immutable, Marek can prove it.
- `apply-for-a-loan` — Petra's queue shows Jana's application with a decision and its reasons.
- `invest-in-a-fund` — Lukas buys units, sees the fee, and can sell.
- `month-end-under-load` — Nadia watches the load act (below) with no data loss and a known error budget.
- `architect-notices-an-unowned-project` — a project without an App Master is named in the Architect's next decision (Personas-side journey, verifiable from the decision ledger).
- `erase-a-customer` — Jana asks to be forgotten: the account is tombstoned, the backup copy is crypto-shredded, and the ledger entries that must survive ten years remain with the party pseudonymised. GDPR Article 17 against a ten-year retention policy, the hardest real conflict in the reference, and fully reproducible on one machine.
- `recall-a-payment` — Tomas paid the wrong supplier: a `camt.056` cancellation request, a `pacs.004` return, and an audit trail showing who authorised the recall under four eyes.
- `a-tpp-reads-an-account` — Ondrej's read: consent granted, SCA satisfied with dynamic linking, the read scoped to the consent, the whole decision visible in one policy decision log.

The scenario object both `/grand-sim load` and `/uat run` read lives beside the bank
repositories as `scenario.json`:

```json
{
  "name": "bank-month-end",
  "characters": ["retail-customer", "sme-treasurer", "platform-sre"],
  "journeys": ["pay-a-friend", "batch-payroll", "month-end-under-load"],
  "load": {
    "standsFor": "1,000,000 users",
    "envelope": { "accounts": 100000, "paymentsPerMinute": 600, "batchSize": 300, "durationMinutes": 20 },
    "guardrails": { "maxMachineMemoryPct": 60, "maxCpuPct": 70 }
  },
  "acceptance": {
    "dataLoss": 0,
    "p95LatencyMs": 1000,
    "httpReqFailedRate": 0.01,
    "checksRate": 1.0
  }
}
```

`load.envelope` is the operator's open decision 4 written as numbers, corrected on 2026-09-08
against the reference's only real measurement (16.7 requests a second, p95 2.25 s, on a machine
comparable to this one): a hundred thousand accounts and six hundred payments a minute for twenty
minutes exercises queues and async paths without pretending the machine is a data centre. The
acceptance carries the reference's rule verbatim in spirit: a request that did not answer 200
invalidates the percentile, so `checksRate` must be exactly 1.0 and the failed-request rate under
one percent before any latency figure counts. `/uat` L2 for `month-end-under-load` is the load act itself: the driver is the load
generator, the journal is the metrics capture, and the Character judging it is the SRE.

## Who does what, inside the simulation

- The **Architect** scaffolds `uat/` in each bank repository at project creation (an
  `/uat init` run with the roster above, Character count 7) and owns `scenario.json`.
- Each **App Master** holds an `acceptance-certification` charter: after every merged wave it
  runs `/uat run --l1` over its repository's journeys, copies the fixture section from the
  generator, and files the L1 findings as ideas with `origin: uat` so the triage rules see them.
  L2 is serial and expensive, so it runs once per act, dispatched by the Architect.
- **Act 5 (reflection)** reads the drains: `/uat drain` on each repository's latest run is the
  evidence for "did the organisation build what a user could finish".

The `acceptance-certification` charter is a recipe that does not exist yet in the bundle; it is
listed under open work in the plan (G10, second half) and is written once the bank repositories
exist to run it against.
