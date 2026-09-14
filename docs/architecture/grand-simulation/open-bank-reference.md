# open-bank-oss as a reference for the Grand Simulation

> Digest written 2026-09-08 against `github.com/JiRaska/open-bank-oss@main`, read through
> `raw.githubusercontent.com` and the GitHub contents API. Every claim below cites the file it
> came from. Where the repository does not state something, this file says "not stated" rather
> than filling the hole. Verbatim quotes keep their original punctuation, including the em
> dashes this repo's house style forbids in its own prose.
>
> Companion to [`../grand-simulation.md`](../grand-simulation.md) (the plan) and
> [`uat-scenario.md`](./uat-scenario.md) (the `/uat` dimension). Nothing here is a decision; it
> is the reference the Architect and the App Masters can hold requirements against.

---

## 1. What it is, and what it is not

**What it is.** `README.md` calls it "a **reference implementation** of a modern retail banking
platform demonstrating domain-driven design, hexagonal microservices, double-entry ledger
accounting, PSD2 compliance, and machine-enforced governance". Kotlin 2.3.20 on Quarkus 3.37,
PostgreSQL 18, Kafka, Temporal, Keycloak, OPA, OpenBao, Next.js 16 admin UI, deployed to a
Kubernetes sandbox on AWS by ArgoCD. The repository root (contents API on `/`) holds **116
top-level entries, of which 74 are `openbank-*` modules**; `README.md` states "**~37
microservices** deployed to AWS sandbox".

**What it is not.** The README's own words: "This project is NOT production-ready and is NOT
licensed to operate as a bank. It is a software platform that someone with the appropriate
banking licence and capital may deploy." The public sandbox "carries no SLA, and must never
receive real personal or payment data."

**Status matrix, condensed from `README.md`.** Implemented and deployed: core (account, ledger,
transaction, balance), intra-bank payments, PSD2 consent/SCA/TPP registry, EUDI PID identity,
cards, disputes, standing orders, Verification of Payee, governance-as-code, supply-chain security,
CI/CD and observability. Partial: interbank rails ("ISO 20022 pipeline wired; live network
pending"), KYC/AML ("real screening logic deployed; vendor feeds are stubs"), SWIFT, AI copilot
("sandbox-only"). Lending is "Sandbox deployment; no live credit bureau".

**Licence split (`README.md`, ADR-0123, ADR-0136).** Platform is **Apache-2.0 + DCO**. The AI
agent / agent-plane services are **AGPL-3.0-only with a commercial licence available**, with the
"authoritative module list in `openbank-libs/governance/rules.yaml`" and identified by an
`SPDX-License-Identifier: AGPL-3.0-only` header. The README's claim: "AGPL does not contaminate
Apache modules (reached over HTTP, not linking)."

**The honest gap list** (`docs/ROADMAP.md` "Known gaps"), quoted in substance: interbank rails are
simulation only, no live SEPA/SWIFT/CERTIS and no net-settlement ledger; the customer app is not
publicly released; KYC/AML vendors are "stubbed with seed lists, not real providers"; regulatory
reports are generated but never submitted; full FIDO2 attestation is incomplete; the AI copilot is
sandbox-only with unhardened abuse guardrails; Pact contract-test coverage is "a known gap" across
the fleet; disaster recovery is unproven. `docs/compliance/finos-ccc-mapping.md` adds four more in
its own voice: "OPA enforce is not fleet-wide", "SBOM-attestation admission is Audit, not
Enforce", "AI gateway topology (ADR-0031) is not deployed", "Automated DR restore-verify is a
skeleton that hard-fails rather than reporting a hollow pass".

**Why this matters to the simulation.** The value of this repository is not its running code, which
the simulation will not reuse. It is that a single maintainer wrote down, in machine-readable form,
what an enterprise-grade banking service has to carry, and then built 217 CI gates that refuse a
service that does not carry it. That is a requirements corpus the Architect can adopt directly.

---

## 2. The service map, and how it maps onto the six projects

### 2.1 The portfolio as the repo declares it

Source: `docs/ARCHITECTURE.md` (service catalog by bounded context, with ports and a money-path
column) and `openbank-libs/governance/rules.yaml` (`money_path_services`). Shared infrastructure is
the same for every service: **PostgreSQL per service** (ADR-0009, database-per-service),
**Kafka + Apicurio** for events, **Keycloak** for identity, **an OPA sidecar per pod**, **OpenBao**
for secrets, **Valkey** for cache, **Temporal** for money-path orchestration (ADR-0101).

| Domain | Services (port) | Money-path | Beyond the shared infra |
|---|---|---|---|
| Core banking | account (8100), ledger (8101), transaction (8102), balance (8103), product-catalog (8104) | ledger, transaction, balance, account | ledger is "the golden source of the booked balance" and balance is a projection of it (ADR-0039); transaction owns the saga |
| Payments | sepa-payment (8115), domestic (8116), sepa-instant (8127), clearing (8124), clearing-simulator (8139), settlement (8138), swift (8122), standing-order (8121), sdd (8129) | all but clearing-simulator | Temporal workflows; ISO 20022 in/out through clearing-simulator; standing-order runs a daily due-date sweep |
| Identity, auth, compliance | pid (8105), party (8111), consent (8106), psd2 (8107), tpp-registry (8108), sca (8110), kyc (8114), aml (8117), sanctions (8123), onboarding (8130) | consent, sca, sanctions, psd2 | sanctions uses `pg_trgm` fuzzy match; sca is passkey + OTP; psd2 is the Berlin Group XS2A surface |
| Risk, ops, AI | fraud (8133), agent (8109), copilot (8131), devops-agent, finops-agent (8141) | fraud | agent-plane services are AGPL; fraud is a "velocity-counter signal plane", no rule engine yet |
| Supporting | notification (8112), audit (8113), card-issuance (8118), fx (8119), interest (8125), lending (8126), billing (8132), dispute (8135), statement (8136), anacredit (8137), finrep (8140), analytics-sink (8134), security-scanner (8120) | fx, interest, lending, billing, card-issuance | audit is the tamper-evident hash chain; statement emits camt.053 / MT940 / PDF |
| Edge and portals | admin-ui (Next.js), customer-edge (Quarkus BFF), developer-portal (static + ModSecurity), api-gateway (Kong config) | customer-edge is the OPA-enforcing BFF | |
| Shared libraries | `openbank-libs-domain` (pure Kotlin, "zero framework imports"), `openbank-libs-runtime` (outbox, idempotency, audit, OPA authz, observability, flags), `openbank-libs-temporal`, `openbank-libs-testing`, `openbank-libs-detekt-rules` | | this split is the single most portable idea in the repo |

`rules.yaml`'s `money_path_services` list is **wider than the ARCHITECTURE.md table**: it also names
`sca`, `consent`, `delegation`, `fraud`, `billing`, `settlement`, `sanctions`, `vop`,
`standing-order`, `psd2` and `card-issuance`. Read `rules.yaml` as authoritative; the prose table
lags it. The root listing also carries services ARCHITECTURE.md does not mention at all
(`openbank-kyb-service`, `openbank-ap2-service`, `openbank-vop-service`, `openbank-document-service`,
`openbank-campaign-service`, `openbank-loyalty-service`, `openbank-referral-service`,
`openbank-incentive-service`, `openbank-engagement-service`, `openbank-tax-reporting-service`,
`openbank-delegation-service`, `openbank-simulation`). The lesson for the Architect is itself a
finding: **at 74 modules the hand-written architecture document had already drifted from the
directory listing**, which is exactly why this repo derives `service-graph.json` and `catalog.json`
in CI and retired its hand-curated `manifest.ts` (ADR-0029 D1/D3).

### 2.2 Proposed mapping onto the simulation's six projects

The plan's projects are `bank-core`, `bank-contracts`, `bank-lending`, `bank-invest`, `bank-edge`,
`bank-platform` (`grand-simulation.md` §2). A defensible allocation of the reference portfolio:

| Simulation project | Owns (reference equivalents) | Money-path | First walking skeleton |
|---|---|---|---|
| **bank-core** | account, ledger, transaction, balance, product-catalog, fx, interest, statement, billing, plus the payment rails (sepa, domestic, instant, sdd, standing-order, clearing, settlement) | yes, the whole project | double-entry ledger + one intra-bank transfer with an outbox event |
| **bank-contracts** | **no direct equivalent.** Nearest: `openbank-document-service` (`dataDomain: platform`, `dataClassification: restricted`, 10-year retention, per its `governance.yaml`), `openbank-document-renderer`, `openbank-consent-service` (customer agreement), `openbank-delegation-service` (acting on behalf of), the SDD **mandate** model (ADR-0036), and the audit hash chain as the immutability mechanism | partly, via consent and delegation | a signed document with a hash anchored in the audit chain |
| **bank-lending** | lending (origination, servicing, collateral, IFRS 9 provisioning per ADR-0028), anacredit, credit-decisioning and ml-decisioning threat models | yes (`openbank-lending-service` is in `money_path_services`) | an application, a decision with its reasons, a disbursement posting to the ledger |
| **bank-invest** | **no equivalent at all.** A grep of `rules.yaml` for `invest`, `fund`, `portfolio`, `custody` and `securities` returns only unrelated hits on the `security:` commit type and the `security` gate group. `docs/strategy/01-bian-service-domain-mapping.md` maps no investment Service Domain | not applicable | this project must be designed from BIAN and regulation, not copied |
| **bank-edge** | psd2, tpp-registry, consent, sca, pid, party, kyc, aml, sanctions, onboarding, customer-edge BFF, developer-portal, api-gateway, admin-ui | consent, sca, sanctions, psd2 | XS2A account-information call behind SCA, gated by OPA |
| **bank-platform** | `openbank-infra` (docker-compose, Makefile, opa policies, gitops, k8s), `openbank-libs-*`, `.github/gates`, `perf/`, `docs/runbooks`, observability stack, audit-service, analytics-sink, security-scanner | audit is money-path adjacent | `make up-infra` equivalent plus the first three gates and one k6 lane |

**Two holes the reference cannot fill.** The plan's *contract exchange* and *investments* domains
have no reference implementation here. For contracts, the reference still supplies the mechanisms
(document service, hash-chained audit, mandate lifecycle, four-eyes, e-sign-adjacent consent), so
the App Master builds from parts rather than from a model. For investments, there is nothing:
no BIAN mapping, no service, no ISO 20022 message, no compliance row. The Architect should treat
`bank-invest` as the project where the organisation has to do original design, which makes it the
most interesting project in the simulation and the one most likely to need a hire.

### 2.3 The declaration a service carries about itself

Every service ships a `governance.yaml` (ADR-0071, schema at
`openbank-libs/governance/governance.schema.json`). `openbank-ledger-service/governance.yaml` in
full is nine curatorial facts plus lineage: `dataDomain: core`,
`primaryDatastore: PostgreSQL`, `databaseName: openbank_ledger`, `dataLineageRole: both`,
`dataClassification: confidential`, `retentionPolicy: 10 years`, `evidenceExported: true`, then
`lineage.upstream` naming `transaction-service` with `relationType: api` and the description
"posts GL", and `databaseLineage.ownedDatabases`. Its header states the rule that makes it
trustworthy: "Declarative, curatorial facts only — derived fields (Flyway/apiVersion) and runtime
drift live elsewhere." The enforced gate `lineage-code-audit` checks that every declared lineage
edge is "backed by code (grep-verifiable @RegisterRestClient or topic overlap) OR allowlisted".

---

## 3. Standards to requirements: what an App Master can hold as acceptance criteria

Everything in this section is what the repository *states*, from `docs/strategy/07-compliance-matrix.md`,
`docs/strategy/04-security-baseline.md`, `docs/compliance/*` and the ADRs. Nothing is inferred.

**ISO 20022** (`docs/compliance/iso-20022-catalog.md`). Implemented: `pacs.008.001.08` (FI-to-FI
customer credit transfer, in/out via clearing-simulator), `pacs.002.001.10` (payment status report),
`pacs.004.001.09` (payment return, outbound via sepa-payment), `camt.053.001.08` (statement),
`camt.054.001.08` (debit/credit notification), `camt.056.001.08` (cancellation request), and the MT
legacy set MT103 / MT202 / MT199 / MT900 / MT910 / MT940 / MT950. Stated gaps: "The MX catalog is
partial and partly scheme-simulated"; `pain.001` / `pain.002` are not messaged at all because
"payment initiation occurs through REST/PSD2 APIs, not messaging"; CBPR+ `camt.110`/`111` are
unimplemented against a 2027-11 deadline. **Checkable requirement:** a payment service must
serialise and parse a named message version, and a statement service must emit camt.053.

**SEPA SCT / SCT Inst / SDD.** SCT Inst is `openbank-sepa-instant` per ADR-0184, with a **10-second
settlement window** (README, ARCHITECTURE). SDD mandates are ADR-0036 with a dedicated
`openbank-sdd-service`. `docs/strategy/06-scalability-targets.md` sets the instant latency budget
at p50 < 3 s, p95 < 7 s, p99 < 9 s. **Checkable:** an instant transfer either settles inside its
window or is rejected with a scheme-shaped reason.

**PSD2 / XS2A.** ADR-0090: "Berlin Group NextGenPSD2 base + ČOBS Czech profile". Requirements as
the compliance matrix states them: AISP/PISP access control per Art. 65-67, "PISP SCA mandatory,
AISP exemptions conditional"; the security baseline adds "FAPI 2.0 baseline for PSD2 endpoints" and
a self-assessment at `docs/compliance/fapi2-self-assessment.md`. A gate,
`psd2-anonymous-grant-stays-behind-eidas-mtls`, enforces that the anonymous PSD2 grant cannot
escape its mTLS boundary.

**SCA.** Compliance matrix, quoted: SCA "requires multi-factor auth (knowledge + possession +
inherence) with cryptographic validation" (Art. 97(1)(b)), and "Dynamic linking for remote
payments" mandates authentication codes "dynamically linked to amount + payee; generated before
authorization" (Art. 97(2) + RTS Art. 5). Agent charters encode the same rule as
`requires_human: - sca: dynamic_linking` on every customer-facing agent (`agents.yaml`).
**Checkable:** the challenge carries the amount and the payee, and is minted before authorisation.

**5AMLD.** Compliance matrix: CDD with identity verification, "beneficial ownership screening
(≥25% threshold), PEP screening" (Art. 13-14); transaction monitoring at "EUR 10,000 (cash), EUR
1,000 (crypto)" (Art. 18); SAR to the FIU "within 5 working days" (Art. 20). Evidence asked for:
"Monitoring rule audit, SAR register, reporting timestamps". Honest caveat from the ROADMAP: the
vendor feeds behind this are seed lists.

**PCI DSS v4.0** (mandatory since 31 Mar 2025). Cardholder data protected by "AES-256 encryption
OR tokenization OR hashing" (Req. 3); "TLS 1.2+" in transit and "MFA for all CDE access"
(Req. 4, 8); annual pen test and authenticated scans (Req. 11). Scope rule from the security
baseline: card data is handled "exclusively by `openbank-card-issuance-service` in segregated
network", every other service is outside the CDE by tokenisation, and an operator must "Engage a
QSA for annual assessment". **Checkable:** raw PAN never persists outside one service.

**GDPR.** Art. 5 principles, Art. 25 privacy by design with a DPIA, Art. 32 "Encryption (AES-256 at
rest, TLS 1.2+ in transit)", Art. 33-34 breach notification "within 72h". **Art. 17** is stated as
an implementation shape: "Right to be forgotten (GDPR Art. 17) — soft-delete in OLTP, crypto-shred
in backups" (security baseline), with ADR-0118 covering "PII classification, retention periods,
erasure model". **Checkable:** an erasure leaves the OLTP row tombstoned and the backup copy
undecryptable.

**DORA** (effective 17 Jan 2025). The compliance matrix names Art. 6 (documented ICT risk framework
with annual review), Art. 17-20 (major incident reporting within "24h"), and Art. 26 (annual
threat-led penetration testing). `docs/compliance/evidence-pack.md` is the article-to-artefact
table: Art. 5-6 to `docs/bcp/dora-ictrm.md` plus `docs/threat-models/`; Art. 8 to per-service SBOMs
and an ICT third-party register; Art. 9 to OPA authz, mTLS Kafka, Keycloak OIDC, secrets and
PR-time CVE gates; Art. 10 and 17 to `docs/bcp/incident-response.md` with P1-P4 tiers; Art. 11 to
`docs/bcp/bcp-policy.md` with T0-T3 recovery tiers; Art. 11(3)(c) to `docs/bcp/dr-test-log.md` and
a `dr-restore-verify.yml` workflow; Art. 12 to "CNPG S3 WAL archiving with 14-day retention and
point-in-time recovery"; Art. 24-27 to DR table-tops and deterministic simulation testing
(ADR-0100). Four declared gaps: no incident-register store, TLPT planned only, automated DR restore
incomplete, Art. 28/30 third-party controls partial. **The lesson for the simulation is the shape,
not the article list: one table, one artefact path per requirement, and a named gap where no
artefact exists.**

**BIAN** (`docs/strategy/01-bian-service-domain-mapping.md`). 25 Service Domains mapped to services
(Current Account to account-service, Position Keeping to ledger, Transaction Engine to transaction,
Customer Position to balance, Party Authentication to sca, Payment Execution to domestic-payment,
and so on), each with a functional pattern (Initiate / Update / Execute / Retrieve / Notify). The
document is explicit that the mapping is "descriptive and uncertified" and that coverage is
"approximately 33% of typical retail bank Service Domains", with Loan Origination, Customer Credit
Rating, Regulatory Reporting and ICT Risk Management named as the critical gaps.
**Checkable:** every service names the BIAN Service Domain it implements and the functional
pattern it exposes, which is a cheap, strong boundary test for the Architect.

**FINOS CCC** (`docs/compliance/finos-ccc-mapping.md`). 14 control families with a status each;
declared coverage "4 implemented, 9 partial, 1 gap". Implemented: authorization / least privilege,
encryption at rest and secrets, logging and audit ("Tamper-evident SHA-256 hash-chain audit trail
with a verify endpoint"), monitoring and detection, configuration and change management,
vulnerability and patch management.

**FINOS AIGF** (same file). 7 AI control areas, "2 implemented, 4 partial, 1 gap". The two
implemented are AI system inventory as code ("Agents declared in `agents.yaml` with charter parity
gate") and human oversight, stated as the rule the whole agent plane is built on: **"Every agent
output is a proposal, never auto-remediation"**. Attribution is implemented via "AI-attributed
entries on the tamper-evident audit chain". Independent review of AI-authored changes is partial
and narrowed: "Restored 2026-08-09, NARROWED (ADR-0251)", covering money-path plus governance
scope only, "~16.3% of fleet PR volume", and "advisory, never required".

**CNB** (Czech National Bank, Act 21/1992). Compliance matrix: minimum capital CZK 500,000,000
(§4), governance framework and control system (§8b), and "Personal data of CZ residents" must be
processed and stored "in CZ or EU" (§12). Reporting evidence: "FINREP/COREP XBRL validation; data
location audit". ADR-0116 adds a "ČNB four-eyes gate" in the KYC engine.

**EU AI Act** (`docs/compliance/eu-ai-act.md`, ADR-0148, ADR-0031). Classification is
**per agent, not blanket**: oversight agents are "likely limited/minimal risk"; high-risk agents
under Annex III (creditworthiness) are "proposal-only" and satisfy Art. 14 (human oversight),
Art. 12 (logging) and Art. 13 (transparency). Two enforced gates police the inventory,
`eu-ai-act-inventory-drift` and `ai-act-high-risk-inventory-vs-code`.

**eIDAS 2.0.** "European Digital Identity Wallet (EUDI Wallet)" support mandatory by
"31 Dec 2026" for KYC and SCA (Art. 5a), with selective disclosure and relying-party
authentication (Art. 5b). Delivered as OpenID4VP and OpenID4VCI flows in `openbank-pid-service`.

**OWASP ASVS.** "OWASP ASVS L3 baseline for all services" (security baseline), with a gate
`asvs-l3-mechanical-subset` and a baseline file `.github/asvs-l3-baseline.txt`. M5 targets
"OWASP ASVS L3 + SLSA L3 supply chain + independent pen-test"; formal attestation is pending.

---

## 4. What one enterprise-grade service must carry

This is the per-service contract, each row with the file or gate that enforces it. Gate ids are
from `.github/gates/gates.yaml`; ADR numbers from `docs/adr/`.

| Obligation | The rule, as stated | Enforced by |
|---|---|---|
| **Hexagonal layout** | `domain/{model,event,service}`, `application/{port/in,port/out,usecase}`, `infrastructure/{persistence,messaging,rest,client,config}`; `domain/` "MUST NOT depend on Quarkus, JPA, Jackson, or any framework annotation" (ADR-0002) | gate `domain-purity-gate`, "domain-purity gate — hexagonal invariant (ADR-0002, enforced)", `min_subjects: 165` with a note "339 measured 2026-09-01; half, so the fleet can shrink without a red" |
| **A published OpenAPI contract** | `src/main/resources/openapi.yaml`, versioned on its own axis; `major(info.version)` must equal `openbank.api.version` and the `/api/v{N}` URL segment (`rules.yaml` API invariant, ADR-0048) | gates `api-contract-gate`, `openapi-route-conformance` ("every route published + every route served"), `openapi-version-not-taken`, `openapi-enum-domain-drift`, `openapi-server-port` |
| **Consumer-driven contract test** | Pact; every consumer publishes expectations, every producer verifies (ADR-0063) | gates `pact-provider-replay-coverage`, `pacticipant-matches-module`, `adversarial-contract-test`. ROADMAP still calls fleet Pact coverage "a known gap" |
| **Flyway migration with a rollback note** | "forward migration + rollback note (`-- Rollback:` in-file)" (`rules.yaml` change triggers) | gates `db-migration-gate`, `flyway-version-commit-order`, `flyway-default-datasource`. Ledger has 27 migrations, `V1__init_ledger.sql` to `V27__synthetic_journal_dimension.sql` |
| **Idempotency on every write** | "Idempotency keys on all write endpoints" (security baseline); resilience design requires `Idempotency-Key` on all external writes with responses cached 24-72 h | gate `idempotency-coverage-money-path`, whose rationale reads: "A duplicate POST on a money-path endpoint is a double debit; without a ratchet, a new endpoint ships without an idempotency key and nothing objects." Plus `idempotency-contract-parity` and `.github/gates/idempotency-parity-baseline.txt` |
| **Transactional outbox** | ADR-0003: state change and `INSERT outbox_event` in one transaction; a poller claims rows `FOR UPDATE SKIP LOCKED`, publishes, stamps `published_at`; a janitor deletes published rows older than 7 days; at-least-once, consumers dedupe on `event.id`. Resilience design: "Every service publishing Kafka events MUST use outbox. Inline `kafkaTemplate.send()` calls are an anti-pattern and a code review blocker." | gates `outbox-dispatch-enabled-guard` (the footgun that `openbank.outbox.dispatch-enabled` defaults to `false`), `outbox-has-writer`, `synthetic-outbox-taint-persistence`, `event-consumer-liveness` ("Kafka topic published requires ≥1 consumer fleet-wide OR allowlisted") |
| **A saga for cross-service writes** | "All cross-service write workflows (e.g. account opening = party + kyc + account + notification) MUST use a saga; ad-hoc multi-call workflows are blocked" (resilience design); Temporal is the engine for money-path orchestration (ADR-0101) | gates `temporal-namespace-registration`, `temporal-worker-switch-naming` |
| **Injected clock, no wall-clock in domain** | money-path only: "no `Instant.now()`, `LocalDateTime.now()`, `System.currentTimeMillis()`, or `Clock.System.now()` in domain/application layers; use injected `java.time.Clock`" (`rules.yaml`) | gates `clock-injection-gate`, `accounting-clock-gate`, `no-epoch-instant-default` with baseline `.github/gates/epoch-instant-default-baseline.txt` |
| **Threat model, money-path** | ADR-0030 D2: a STRIDE/DFD model at `docs/threat-models/<service>.md` is a Definition of Done artefact; the checker "fails CI if any money-path service lacks a *structured* threat model" | gates `threat-model-coverage`, `threat-model-updated-on-trust-boundary-change` (advisory, target 2026-09-15), `threat-model-claims-resolve`, `security-checklist-money-path`. 45 threat models exist today |
| **Four-eyes on privileged verbs** | `rules.yaml` `four_eyes.verbs`: transfer, post, reverse, freeze, release, flip, transitionStatus, recall, settle, disburse, send, credit, debit, collateralRegister, convert, grant, revoke, sweep, clear. Guardrail: "A verb is only safe if every real caller is human; if an M2M caller exists, create a distinct operator-only action instead" | gates `four-eyes-verb-grantable`, `operator-write-naming`, `matrix-write-grants` |
| **OPA authorization on every endpoint** | ADR-0034: one sidecar per pod serving `data.openbank.rest.allow` and `data.openbank.agents.allow`; deny gives 403, sidecar unavailable gives 503 (fail-closed) | gates `authz-enforce-pdp-sidecar-parity`, `authz-enforce-money-path`, `opa-bundle-parses`, `opa-sidecar-bundle-shape`, `rolesallowed-realm-parity` |
| **Coverage floor, ratchet-only** | Kover per module (ADR-0020), extended per-service by ADR-0029 D3; "Coverage only ratchets upward; money-path services require higher thresholds" (CONTRIBUTING) | gate `coverage-floor` in ADR-0029 D4's table, "Per-service Kover ≥ floor, ratchet-only", on failure "Block" |
| **SBOM, signing, provenance** | per release: CycloneDX SBOM as a first-class artefact, `cosign sign`, in-toto/SLSA attestation, and a signed evidence bundle `{version, git commit, SBOM, SLSA provenance, changelog, coverage summary, scan results, test results}` (ADR-0029 D2). Kyverno verifies "a valid Cosign signature on every `…/openbank-*` image" at admission (ADR-0030 D4) | gates in the `supplychain` group (27 of them), plus `release-evidence-coverage`, `vex-overlay-coverage`, `fleet-attestation-classifier` |
| **NetworkPolicy** | "Default-deny NetworkPolicy in K8s" (security baseline); M5 reports NetworkPolicies on 34 services | gates `gen-network-policies-drift-gate`, `netpol-coverage-kpi`, `network-policy-code-edges` |
| **DomainMetrics** | "Domain-level metrics are emitted by every service using a shared pattern in openbank-libs — counter, histogram, and gauge per bounded context" (ARCHITECTURE) | gates `dashboard-metric-emitted`, `alert-metric-emitted`, `gate-observability-declarations` with `.github/gates/observability-baseline.json` |
| **SLO as code** | `rules.yaml` `slo`: availability 99.9% over 30d, latency target 99% under 1 s over 30d, "tighter than 2s HighLatencyP99 alert", reconciled into Prometheus burn-rate rules by Pyrra | gate `slo-registry-consistency` |
| **Runbook** | one per service, drift-checked | gate `service-runbook-drift`; `docs/runbooks/` |
| **Per-service `CLAUDE.md` and `governance.yaml`** | root `CLAUDE.md` is "invariant workflow", per-service is "ports, schema, local quirks"; template at `openbank-libs/governance/CLAUDE.service-template.md` | gate `governance-manifest`; ADR-0071 |
| **`version.txt`** | one version per service, equal to `quarkus.application.version`, the git tag and the image tag (`rules.yaml` release invariant) | gates `version-bump`, `release-registration-consistency`, `admin-ui-version-sync-guard`, `quarkus-application-version-override-guard` |

**What `openbank-ledger-service` actually carries**, as the canonical example (contents API):
`version.txt`, `CHANGELOG.md`, `Dockerfile`, `build.gradle.kts`, `governance.yaml`,
`detekt-baseline.xml`, `ktlint-baseline.xml`, and under `src/main/resources` an `application.yaml`,
`openapi.yaml`, `db/migration/` (27 Flyway files), `diagrams/` and `docs/`. Its Kotlin tree is
`domain/{event,model}` with 11 model files (`GlAccount`, `JournalEntry`, `TrialBalance`,
`ClosedPeriod`, `AccountingDay`, `YearClose`, `TieOutRun`, `FxRevaluationPosting`,
`FxConversionPosting`, `LedgerScope`, `LedgerExceptions`), `application/{port,usecase}`, and
`infrastructure/{persistence,messaging,rest,client,config-equivalents}` plus `outbox/`, `authz/`,
`approval/`, `partition/`, `schedule/`, `observability/` and a `ClockProducer.kt`. It has a threat
model at `docs/threat-models/openbank-ledger-service.md` and a k6 read baseline at
`src/test/k6/ledger-read-baseline.js`. **It has no `README.md`.** The service-level narrative lives
in `CLAUDE.md` and `governance.yaml` instead, which is a deliberate choice worth copying: the
human-readable file that drifts was replaced by machine-readable files that gates check.

---

## 5. Governance as code: how the machinery works

**`gates.yaml` is the manifest.** Measured locally on the downloaded file: **330,097 bytes, 5,139
lines, 217 gate entries**, one top-level key (`gates:`). Distribution by shard:
`gitops` 45, `registry` 30, `kotlin` 30, `lint` 29, `supplychain` 27, `data` 24, `security` 20,
`api` 12. By mode: **212 enforced, 5 advisory**. 13 gates are `when: pull_request`, 11 read
`$PR_DIFF_BASE`, and **187 of 217 declare a `selftest`**.

The file's own header states why it exists and what the contract is: the gates "used to be 79
sequential steps in ci.yml's `validate` job", which was "SERIAL" and "UNADDRESSABLE" because "a
gate WAS a workflow step, so nothing could enumerate the set". Declaring them "makes the set
enumerable, runnable outside CI, and parallelisable" via
`python3 .github/scripts/run-gates.py --list | --group <g> | --only <id> | --all | --self-test`.

The hardest-won rule, quoted from the header:

> `selftest` proof that this gate's RED is reachable — the repo's hardest-won CI rule,
> "a gate that has only ever passed is unfalsified" (#2165, #2154, #2177).
> The runner executes it BEFORE the gate and skips the gate entirely if the verdict is wrong.
> Omit it only when the checker has no `--self-test` mode; never fake one that cannot fail.

And the transcription rule, which reads like this repo's own census doctrine:

> Every entry below was extracted MECHANICALLY from the ci.yml step it replaces — the `run`
> bodies and the rationale comments above them are the originals, not retyped
> (repo lore: a transcription is a different program).

**Representative gate declarations, verbatim.**

```yaml
  - id: domain-purity-gate
    name: "domain-purity gate — hexagonal invariant (ADR-0002, enforced)"
    group: kotlin
    mode: enforced
    min_subjects: 165   # 339 measured 2026-09-01; half, so the fleet can shrink without a red
    selftest_inputs: [".github/scripts/check-domain-purity.py"]
    selftest: |
      python3 .github/scripts/check-domain-purity.py --self-test
    run: |
      python3 .github/scripts/check-domain-purity.py .
```

```yaml
  - id: idempotency-coverage-money-path
    name: "money-path POST endpoints declare a required idempotency key (#8351, enforced)"
    group: api
    mode: enforced
    budget_seconds: 20   # 52 OpenAPI parses via gatelib cache, measured ~2s
    rationale: >-
      A duplicate POST on a money-path endpoint is a double debit; without a ratchet, a new
      endpoint ships without an idempotency key and nothing objects. The gate also prints the
      fleet-wide inventory the M2 exit criterion asks for.
    review_after: 2027-03-05
    min_subjects: 40   # 52 released services with a spec today (2026-09-05); some slack
    selftest: python3 .github/scripts/check-idempotency-coverage.py --self-test
    selftest_expect: pass
```

```yaml
  - id: threat-model-coverage
    name: "threat-model coverage (ADR-0030 D2)"
    group: security
    mode: enforced
    selftest_inputs: ["openbank-infra/scripts/check-threat-models.py"]
    selftest: python3 openbank-infra/scripts/check-threat-models.py --self-test
    selftest_expect: pass
    run: |
      python3 openbank-infra/scripts/check-threat-models.py
```

```yaml
  - id: outbox-dispatch-enabled-guard
    name: "outbox dispatch-enabled guard (footgun check, enforced)"
    group: kotlin
    mode: enforced
    min_subjects: 16   # 33 dispatch-gated services today (2026-08-09)
    selftest: bash .github/scripts/check-outbox-dispatch-enabled.sh --self-test
```

```yaml
  - id: gate-subject-floor
    name: "every gate declares how much it expects to find (#4339, enforced)"
    group: lint
    mode: enforced
    min_subjects: 100   # 130 gates today (2026-08-09)
    run: |
      python3 .github/scripts/check-gate-subject-floor.py --enforce
```

```yaml
  - id: agent-pr-guard
    name: "agent PR guard (autonomous agents may not land protected paths, enforced)"
    group: lint
    mode: enforced
    rationale: >-
      Unattended agents open PRs here around the clock, and the only control keeping them off
      the money path was a PreToolUse hook on one laptop — absent in every environment an
      agent actually runs in, and blind to a merge issued from inside a script (17 PRs merged
      in one session with all of its rules unevaluated). main's ruleset does not supply it:
      0 required approvals, and the admin bypass actor is the identity an agent authenticates
      as. Re-examine when four-eyes is enforced at the ruleset, which would subsume this.
    review_after: "2027-02-22"
    min_subjects: 25   # 33 today: 30 derived+declared service tokens + 3 governance globs
    when: pull_request
```

**Meta-gates.** Three gates in the `lint` shard check the *declarations*, not the code:
`gate-lifecycle-metadata`, `gate-subject-floor` (every gate must declare `min_subjects`) and
`gate-selftest-declaration`. Two more police enforcement itself: `advisory-gate-registration`
(an advisory gate must be registered in `rules.yaml` with a `target_enforce_date`, ADR-0144) and
`gate-graduation-guard`. `gates-not-deregistered` catches silent removal;
`gate-invocation-reachability` and `enforcement-reachability` catch a gate that is declared but
never runs.

**Baseline and ratchet files under `.github`:**

| File | Ratchets |
|---|---|
| `.github/asvs-l3-baseline.txt` | the mechanically checkable ASVS L3 subset |
| `.github/event-contract-baseline.txt` | Kafka event contract coverage (gate `event-contract-coverage-ratchet`) |
| `.github/openapi-route-conformance-baseline.txt` | routes served vs routes published |
| `.github/single-replica-rollout-strategy-baseline.txt` | services still on a single replica |
| `.github/canary-rollout-realisable-baseline.txt` | which rollouts can actually canary |
| `.github/gates/idempotency-parity-baseline.txt` | idempotency declared vs implemented |
| `.github/gates/epoch-instant-default-baseline.txt` | `Instant.EPOCH` sentinel defaults |
| `.github/gates/alert-subject-period-baseline.yaml` | alert window vs subject period |
| `.github/gates/observability-baseline.json` | declared metrics, dashboards and alerts |
| `openbank-libs/governance/testcontainers-evidence-baseline.txt` | integration tests that really start a container |

Several more are per-service and in-tree: `detekt-baseline.xml` and `ktlint-baseline.xml` in each
module, plus `openbank-libs/governance/vex/` for vulnerability exceptions.

**Path-scoped CI.** ARCHITECTURE states "only services with changed files trigger
builds/deployments, reducing CI churn"; ADR-0040 sets the execution model, "CI runs on a shared
pool of four persistent, cache-warm self-hosted runners", with AWS Spot as overflow at
`minRunners=0`.

**Release-please and Conventional Commits.** `rules.yaml` fixes the vocabulary
(`feat`/`fix`/`perf`/`security` carry a bump and a changelog entry; `docs`/`test`/`chore`/`build`/`ci`
carry neither), `scope_required: true`, breaking marked with `!` or a `BREAKING CHANGE:` footer.
release-please runs in **components mode**, one release unit per service, which ADR-0029 chose
explicitly because "a global version file is a guaranteed merge-conflict point for concurrent
agents". Branch protection: `no_direct_commits_to: [main]`, squash-merge only, branch pattern
`^(feat|fix|chore|docs|refactor|test|security|ci|perf)/[a-z0-9-]+$`. Review policy is honest about
its own limits: `money_path_approvals: 2` but `enforcement_status: aspirational_not_enforced`,
`enforcement_blocker: single_write_access_account`.

**Compared to the Personas census.** The two systems solve the same problem and arrived at nearly
the same answer independently. Both keep one declarative registry of many small checkers
(`scripts/census/rules.json`, 204 rules, against `.github/gates/gates.yaml`, 217 gates); both
ratchet against a measured baseline rather than demanding zero; both treat "found nothing" and
"looked at nothing" as different outcomes, which Personas calls the fail-loud contract with its
`floor` and zero-match rules and open-bank calls `min_subjects` plus the "a gate that has only ever
passed is unfalsified" rule; both refuse a stale exemption. Three differences are worth importing.
First, open-bank makes the **self-test mandatory and runs it immediately before the gate, skipping
the gate if the self-test verdict is wrong**, which is strictly stronger than Personas'
`scripts/census/self-test.mjs` proving the engine once. Second, every gate carries **`rationale`,
`review_after` and `min_subjects` inline**, so a rule states its own expiry and its own expected
yield; Personas' rules carry a baseline but no review date. Third, open-bank shards by **wall time
and runs gates in a matrix**, where Personas' census is one multi-minute walk at pre-push, which is
what the gate daemon was built to soften. Going the other way, Personas' census reads `.rs`, `.md`
and `.sql` in one engine, whereas open-bank's gates are 217 separate scripts in Python, Bash and
Kotlin, which is more power and more surface.

---

## 6. How they run AI agents on the repo

**Two prompts, both unattended, both proposal-only.** `.github/agent-prompts/issue-worker.md`:
the worker "picks one unassigned open issue, implements it, and opens a draft PR — then stops".
Its hard constraints: never merge, approve, enable auto-merge, or use administrative overrides;
never close issues; never push to `main`; branch names must start with `agent/`; only modify files
related to the picked issue; "Use explicit `git add <file>` lists, never wildcards"; sign with
`git commit -s`. Its workflow prints a **provisional verdict first**
(`WORKER-VERDICT: BLOCKED run ended before reaching conclusion`) and overwrites it at the end with
one of `OPENED <pr-url>`, `NOTHING QUALIFIED` or `BLOCKED <reason>`. Before writing code it must
run `python3 .github/scripts/check-agent-pr-guard.py --paths <files>`.

`.github/agent-prompts/pr-steward.md` tends exactly one draft PR per run. It must never "Alter a
PR's intended scope or redesign it", never `git add -A` or bare `--force` (only
`--force-with-lease`), never "Delete/weaken failing tests as a workaround", and never "Attempt to
bypass the `agent-pr-guard` check". Same provisional-verdict discipline, verdicts
`STEWARD-VERDICT: TENDED | NOTHING TO TEND | BLOCKED`.

**`agents.yaml` is the charter registry** (`openbank-libs/governance/agents.yaml`, ADR-0031 D1),
"a sibling to `rules.yaml`". **18 agents**: `compliance-officer`, `ledger-domain-engineer`,
`ui-assistant`, `rca-investigator`, `customer-copilot`, `mcp-anonymous`, `ap2-anonymous`,
`finops-agent`, `devops-agent`, `control-liveness-sentinel`, `governance-auditor`,
`release-steward`, `docs-truth-agent`, `authz-policy-auditor`, `flaky-test-hunter`,
`case-coordinator`, `kyb-analyst`, `business-copilot`. Each declares `plane`
(control / development / customer / business), `model`, `charter` (one sentence),
`data_scope.read` with `pii: masked | own | none`, `tools.allow` and `tools.deny`,
`requires_human`, and `limits` with `tokens_per_run`, `runs_per_day` and `kill_switch`.
The governing sentence of ADR-0031: **"Agents propose; governance disposes. An agent never holds
more privilege than a human — it holds less."**

Two charters, quoted, because their shape is the thing to copy:

```yaml
  - id: ledger-domain-engineer
    plane: development
    charter: "Maintains services via skills/rules/ADRs; opens PRs never merges"
    owns: [openbank-ledger-service]
    skills: [ship-check, bump, open-pr, release]
    tools:
      allow: [git.branch, git.commit.signed, gh.pr.open, draft.adr, run.skill, read.governance]
      deny: [gh.pr.merge, gh.pr.approve, "money.*"]
    requires_human:
      - merge: always
      - new_adr: accept
      - threat_model_when: money_path_or_trust_boundary_change
    limits: { tokens_per_run: 300000, runs_per_day: 24 }
```

`governance-auditor` shows the control-plane variant: `plane: control`, a schedule
(`daily: "04:30 UTC"`, `reactive: pr-merged-webhook`), `requires_human` of
`[any_compliance_incident, every: proposal, approver_must_differ_from: author, record: reason]`,
and `limits: { tokens_per_run: 50000, runs_per_day: 24, kill_switch: true }`.

**Policy gating.** ADR-0034: the MCP endpoint enforces OPA before any `tools/call`, deny by
default, at `AGENT_POLICY_ENFORCEMENT=block`. Tools are tiered read / write-proposal / hard-deny,
with "money movement, self-approval" in the hard-deny tier. Agents run as in-cluster workloads with
**300-second-TTL SVIDs from OpenBao PKI**. Audit records carry `actorType = AI_AGENT` with
`model_id`, `model_version`, `prompt_hash`, `tool_calls[]`, `policy_decision`, `human_approver`
and `reason`, hash-chained and cosign-anchored. Gates that police the agent plane:
`agent-charter-registry-parity`, `agent-bounded-write-surface`, `agent-model-parity`,
`agent-case-schema`, `mcp-charter-data-scope-binding`, `mcp-real-port-requires-caller-auth-first`,
`agent-pr-guard`, `agent-review-proof-falsifiable`, `agent-review-scope-falsifiable`.

The `agent-review-proof-falsifiable` comment is the sharpest lesson in the repository for the
simulation, quoted in full:

> ADR-0251. The script this falsifies is the PROOF that an independent review happened, and its
> predecessor is the reason the control was retired: ADR-0154's "Verify the Claude fallback
> actually reviewed" step carried the SAME `if:` as the review it verified, so across 10
> consecutive runs both were `skipped` while every run concluded `success` (#4281). A verifier
> that can be switched off by the thing it verifies is not one.

**Mapping onto Personas charters.** The Personas recipe bundle is
`scripts/templates/_recipe_seeds.json` (`recipe_count: 116`, `version: 3`). Its rows carry `id`,
`name` and `category`, **not slugs**, so the honest answer is that only the five Architect payloads
and the two App Master payloads on disk have slugs (`scripts/templates/_architect/*.json`,
`scripts/templates/_app_master/*.json`); the rest are matched by name.

| open-bank agent | Closest Personas recipe (name, category) | Fit |
|---|---|---|
| `ledger-domain-engineer` | `accepted-idea-delivery` = "Accepted idea delivery to the main branch" (development), plus "Implementation & PR Lifecycle" and "PR Test + Merge" | close; the App Master already is this role |
| `governance-auditor` | "Audit & Reporting" (reporting), "Monthly Deep Audit" (maintenance) | partial; nothing in Personas audits *governance declarations* |
| `docs-truth-agent` | "Skill Audit & Proposal" (development) | weak; the ADR-status-vs-code drift detector has no equivalent |
| `release-steward` | "Release Automation", "Release Management" (development) | close |
| `flaky-test-hunter` | "Codebase Coverage Scan", "Codebase Bug Hunt" (development) | partial; silent-test-failure detection is not covered |
| `devops-agent` | "Daily Digest & Weekly Reliability Report" (reporting), "Infrastructure Metrics Scan" (analysis) | partial |
| `finops-agent` | "Weekly Cost & Resource Report" (analysis) | close |
| `rca-investigator` | "Codebase Root Cause Analysis" (analysis), "Post-Incident Review" (review) | close |
| `compliance-officer` | "knowledge base Publish and Risk Alert" (reporting) | weak; no compliance-oversight recipe exists |
| `case-coordinator` | "Incident Intake & Classification", "Lifecycle Tracking & Escalation" (operations) | partial |
| `authz-policy-auditor` | "On-Demand Security Scan" (security) | weak |
| `control-liveness-sentinel` | "Continuous Monitoring" (monitoring) | weak; the *correlator across liveness mechanisms* has no equivalent |
| `customer-copilot` / `ui-assistant` | not applicable to a build organisation | product features, not charters |

Personas' own Architect charters map onto no single open-bank agent, because open-bank has no
architect agent at all: its architecture decisions are human, recorded as ADRs, and the agents only
detect drift from them. That is a deliberate asymmetry worth noting in the simulation's design.

---

## 7. Milestones M1 to M7, and what one machine can reproduce

From `docs/ROADMAP.md`. The reproducibility column is this digest's judgement, not the repo's.

| Milestone | Repo scope | Repo status | Reproducible on one machine with docker compose |
|---|---|---|---|
| **M1 Foundation hardening** | "Audit-ready, testable, contributor-friendly repo": CI gates fleet-wide (SAST/SBOM/gitleaks/OpenAPI), branch protection, SemVer releases | complete | **fully.** Gates, conventional commits, per-service versions, SBOM generation and signing all run locally. This is the milestone the simulation should copy almost literally |
| **M2 Resilience primitives** | "Outbox + Temporal workflows + idempotency everywhere; coverage ≥ 70%" | in progress; outbox in 31 services | **fully.** Postgres, Kafka and Temporal all run in compose; the outbox and idempotency gates are static checks |
| **M3 Compliance evidence** | "Every regulatory requirement mapped to demonstrable evidence": XS2A portal, GDPR erasure, EUDI/PID, VoP, AnaCredit/FINREP | in progress; live submission pending | **mostly.** Evidence artefacts, mappings and generated reports are all local. Live submission and real vendor feeds are out of scope by definition, which the reference also admits |
| **M4 Observability and ops** | "OTel everywhere; SLOs; chaos engineering begins" | largely done | **mostly.** OTel collector, Prometheus, Loki, Tempo, Grafana and Pyrra all run in compose. GoAlert paging is simulated at best |
| **M5 Security baseline** | "OWASP ASVS L3 + SLSA L3 supply chain + independent pen-test" | in progress; pen-test P0-P2 remediated, attestation pending | **partly.** ASVS mechanical subset, NetworkPolicies, cosign, SLSA provenance and the abuse-smoke k6 lane are local. An independent pen test is not |
| **M6 Multi-region active-passive** | "DR failover within 30 min (RTO ≤ 30m, RPO ≤ 5m)" | not started | **as a drill only.** Two compose stacks and a WAL restore can demonstrate RPO/RTO on one box; multi-region cannot be simulated honestly |
| **M7 Multi-region active-active and scale** | "Sustain Tier-A workload; production chaos" | not started | **no.** Tier-A is 5,000,000 customers and 4,000 peak payment TPS per `06-scalability-targets.md` |

### 7.1 The load envelope, grounded

`docs/strategy/06-scalability-targets.md` states three profiles. **Sandbox:** 1,000 customers,
5,000 daily payments, 10 peak payment TPS. **Tier-B (neobank, year 1-3):** 250,000 customers,
500,000 daily payments, 200 peak payment TPS. **Tier-A:** 5,000,000 customers, 10,000,000 daily
payments, 4,000 peak payment TPS. Tier-B latency budgets: balance query p50 < 50 ms, p95 < 150 ms,
p99 < 300 ms; domestic payment p50 < 200 ms, p95 < 500 ms, p99 < 1 s; SEPA Instant p50 < 3 s,
p95 < 7 s, p99 < 9 s; login + SCA p50 < 1 s, p95 < 3 s, p99 < 5 s. Throughput: account reads 5,000
sustained / 20,000 peak TPS; domestic payment writes 200 sustained / 800 peak; audit ingest 50,000
sustained / 100,000 peak. Infrastructure: Postgres primary under 500 total connections, storage
growth under 100 GB per month, Kafka minimum 3 brokers with 7 to 35 days retention.

**The only real measurement in the repo** is `perf/reports/2026-07-10-money-path-write-benchmark.md`,
on an Apple M2 Max (12 cores, 32 GB) under OrbStack with a dev-mode in-memory Temporal. Run 1:
**2,197 postings, zero failures, about 16.7 req/s, p50 251 ms, p90 345 ms, p95 2.25 s, max 6.35 s.**
Run 2 with trace export on degraded to 469 postings, uncontended p90 6.15 s. Its caveat: "Treat
them as an order-of-magnitude baseline, not a precise SLA figure", the variability blamed on a JDBC
pool `max_size: 5`, Temporal history growth and host contention. It also found five real defects
only because "nobody had run this write path end-to-end on a clean local checkout before": a
missing Temporal container, a sanctions client on the wrong port, 22 of 27 compose blocks with
hardcoded passwords, a missing OPA M2M rule, and hardcoded CZK GL accounts.

`perf/scenarios.yaml` declares 14 k6 lanes, of which **every single one carries a `blocker`**, most
of them a missing isolated target or a `PERF_READ_TOKEN`. The `security-abuse-smoke` lane is the
most transferable: "Every request is invalid by construction ... the rejection path IS the subject.
A 200 or 5xx on any probe is a finding, not a pass", asserting that no-token and malformed-token
probes must 401/403, a NUL-byte query param must 400/401/403 and never 500, an enumeration sweep
must 401/403/404 because "200 = IDOR", and an oversized header must 400/401/431. Every read
baseline carries a rule the load act should adopt verbatim: "`http_req_failed` rate<0.01 and checks
rate==1.0 — a route that did not answer 200 invalidates the percentile."

### 7.2 Proposed act-by-act targets for the simulation

| Act | Reference milestone | Target for the simulation |
|---|---|---|
| **1 Architect** | M1 | six repositories, each with `version.txt`, a `governance.yaml`-shaped self-declaration, a per-project `CLAUDE.md`, conventional commits and a branch pattern; a solution design in `bank-platform` naming bounded contexts, data owners and the async seams; a BIAN Service Domain named per service |
| **2 Hiring** | M1 | one hire per project; `bank-invest` hires first, because it has no reference to copy |
| **3 Build** | M1 + M2 | one walking skeleton per project with the §4 contract on the money-path ones: hexagonal layout with a pure domain, `openapi.yaml`, Flyway V1, idempotency key on every write, transactional outbox, injected clock, one Temporal workflow, a threat model, a NetworkPolicy, domain metrics and a runbook; `docker compose up` brings all six plus Postgres, Kafka, Temporal, Keycloak and OPA |
| **3b Gates** | M1 | a `gates.yaml` in `bank-platform` with at least twelve gates, every one carrying `min_subjects`, `rationale`, `review_after` and a self-test that proves red is reachable |
| **4 Load** | between Sandbox and Tier-B | the plan's §5 proposal (1M accounts, 10k payments/min, p95 200 ms) is far above what the reference measured on a comparable machine (16.7 req/s = 1,000 payments/min, p95 2.25 s). `uat-scenario.md`'s revised envelope (100,000 accounts, 2,000 payments/min, 30 minutes, p99 500 ms) is closer but still 2x the reference's measured rate on an M2 Max. **Recommended envelope: 100,000 seeded accounts, 600 payments per minute sustained for 20 minutes, p95 under 1 s at the gateway, `http_req_failed` under 0.01, checks rate exactly 1.0, machine memory under 60%.** Then state the extrapolation to a million users as arithmetic, the way the reference states Tier-A, rather than claiming to have run it |
| **4b Abuse** | M5 | a `security-abuse-smoke` equivalent per project, where the rejection path is the subject |
| **5 Reflection** | M3 | a compliance matrix per project mapping each cited regulation to a control and an artefact, an ADR index with decision status separate from delivery status, and a `/uat` drain |

---

## 8. Recommended changes to the simulation plan

### 8.1 Edits to `grand-simulation.md` §2

1. **Rename `bank-core` to two projects, or state that it is the biggest project by an order of
   magnitude.** In the reference, core plus payments is 14 of the money-path services and the
   ledger alone carries 27 migrations. A single App Master owning accounts, ledger, transactions,
   balance and nine payment rails is not comparable in size to `bank-invest`. Either split
   `bank-core` into `bank-core` (account, ledger, transaction, balance) and `bank-payments` (the
   rails), giving seven projects, or record explicitly that `bank-core` is expected to hire first
   and most.
2. **Add a "money-path" flag to the project table.** The reference's single strongest structural
   idea is that a subset of services carries stricter rules. In the simulation that becomes: the
   Architect declares which projects and which services are money-path, and the App Master of a
   money-path project holds extra charters (threat model, four-eyes, injected clock).
3. **Make `bank-platform` the owner of the gate manifest, not just of infrastructure.** Its
   deliverable in Act 3 should be a `gates.yaml` the other five projects run, with the self-test
   rule. This is the piece that makes the simulation an *enterprise-grade* build rather than six
   walking skeletons.
4. **Add Act 3b (gates) and Act 4b (abuse) to the act table**, as in §7.2 above, each with a
   measurable end state.
5. **Correct the load envelope in §5** to the measured-grounded figures in §7.2, and record the
   reference measurement (16.7 req/s on an M2 Max with a JDBC pool of 5) as the reason.
6. **Name the two domains with no reference** (`bank-contracts`, `bank-invest`) in §2 as the
   projects where the organisation designs rather than copies, and expect them to produce the most
   interesting hires and the most `responsibility_draft` proposals in Act 5.

### 8.2 Edits to the Architect recipes (`scripts/templates/_architect/*.json`)

All five are `status: "draft"` per their README, so these are edits to drafts, not to shipped
recipes.

- **`enterprise-solution-design.json`.** Its `coreAction` already asks for bounded contexts, data
  owners, integration style and a non-functional envelope. Add two outputs: **a named external
  ontology per context** (the reference uses BIAN Service Domain plus functional pattern, and
  `01-bian-service-domain-mapping.md` shows how cheap and how disciplining that is), and **an
  explicit money-path designation** with the stricter obligations it triggers. Add to `input`: the
  standards the domain is subject to, so the design carries its regulatory frame from the first
  revision rather than acquiring one in Act 5.
- **`project-portfolio-composition.json`.** Its `output` promises projects with repositories,
  App Masters and first goals. Add: **each project ships a self-declaration file** in the shape of
  `governance.yaml` (data domain, datastore, classification, retention, lineage upstream and
  downstream), because that is what makes the portfolio machine-readable and what the reference
  found it could not maintain by hand. Add an activity between `create` and `staff`: *declare*.
- **`goal-direction-and-authority.json`.** Sound as written. One addition to `coreAction`: a
  directive that names an **acceptance criterion drawn from a standard** is stronger than one that
  names an outcome, and the reference's compliance matrix is the model for how to phrase one.
- **`workforce-planning.json`.** Sound as written, and its rule that a need must be "work, evidence
  and acceptance, not a job title" is exactly the shape `agents.yaml` charters take. Add to
  `output`: the **tool allow and deny list** and the **`requires_human` gates** for the role being
  requested, since the reference shows that a role's privilege boundary is part of its
  specification, not a deployment detail.
- **`scope-reflection.json`.** Add one classification outcome alongside "a charter, the design, or
  nothing": **"a gate"**. The reference's whole method is that a lesson which generalises becomes a
  machine check, not a paragraph. This is the single highest-leverage edit in this section.

### 8.3 Edits to the App Master responsibilities

`scripts/templates/_app_master/` holds two payloads today (`accepted-idea-delivery`,
`project-kpi-stewardship`). Four additions, each grounded in a reference obligation:

1. **`service-contract-stewardship`** (money-path projects and non-money-path alike): the App
   Master certifies before every merge wave that each service in its project carries the §4
   contract, and files the missing pieces as ideas. This is the reference's `/ship-check` skill.
2. **`gate-authorship`**: when a defect recurs, the App Master writes a gate for it in
   `bank-platform`'s manifest rather than a note, with `min_subjects`, `rationale`, `review_after`
   and a self-test proving red is reachable.
3. **`threat-and-evidence`** (money-path projects only): maintain `threat-models/<service>.md` and
   update it in the same change that moves a trust boundary.
4. **`acceptance-certification`**: already owed by the plan (G10 second half); the reference
   sharpens its definition of done to "a route that did not answer 200 invalidates the percentile".

### 8.4 New recipes worth writing

| Title | One-line breakdown |
|---|---|
| Money-path service certification | Read one service against a declared per-service contract (layout, contract, migration, idempotency, outbox, clock, threat model, metrics, runbook), file each gap as an idea with the obligation it violates. |
| Gate authorship from a recurring defect | Turn a defect that has now happened twice into a declarative check with an expected yield, a rationale, a review date and a self-test that proves its red state is reachable. |
| Regulatory acceptance mapping | Take a named regulation and produce, per requirement, the control that satisfies it and the artefact that evidences it, refusing any row whose evidence does not exist yet. |
| Threat model for a money path | Produce a STRIDE/DFD model for one service, and re-open it whenever a trust boundary in that service's diff moves. |
| Load envelope authorship | State a load target as seeded data, sustained rate, duration, latency percentile and error ceiling, with the rule that a failed request invalidates the percentile, then run it and report the machine's ceiling alongside the result. |
| Abuse-path smoke | Build a probe suite where every request is invalid by construction and the rejection is the subject, asserting the exact status class each abuse must produce. |
| Service self-declaration and lineage | Maintain a per-service declaration of data domain, datastore, classification, retention and lineage, with the rule that every declared edge must be verifiable in code. |
| Contract-first API stewardship | Keep a service's published contract, its served routes and its release version on their separate axes and in agreement, bumping each on its own trigger. |
| ADR authorship with split status | Record a decision with its decision status and its delivery status tracked independently, so "accepted" never implies "built". |
| Governance drift audit | Compare what the declarations claim (ADR status, charters, manifests, baselines) against what the code does, and propose the correction rather than making it. |

### 8.5 What the reference adds or corrects in `/uat`

**Characters.** The seven in `uat-scenario.md` survive contact with the reference. Two additions
and one correction:

- **Add a TPP developer** (a third-party provider integrating XS2A). The reference makes this a
  first-class actor with its own portal, its own registry service and its own FAPI 2.0 profile, and
  the plan's roster has no one who exercises the `bank-edge` project's main external surface.
- **Add an auditor** distinct from Marek the compliance officer. The reference separates the
  control function (compliance) from the evidence function (DORA evidence pack, ADR delivery
  status, signed release bundles), and the evidence function is the one that catches a green gate
  checking nothing.
- **Correct the fraud analyst's senior bar.** `uat-scenario.md` sets it at "a false positive rate a
  human can live with", but the reference's fraud service is explicitly a "velocity-counter signal
  plane" with no rule engine, and the ROADMAP lists the rule engine as a known gap. Restate Eva's
  bar as: every alert names the signal that fired and the window it fired over.

**Journeys.** Three to add, each mapping to a reference obligation the current eight do not reach:

- `erase-a-customer` (Jana asks to be forgotten): the account is tombstoned in OLTP, the backup
  copy is crypto-shredded, and the ledger entries that must be retained for ten years survive with
  the party pseudonymised. This is GDPR Art. 17 against a 10-year retention policy, which is the
  hardest genuine conflict in the reference and is entirely reproducible on one machine.
- `recall-a-payment` (Tomas paid the wrong supplier): a `camt.056` cancellation request, a
  `pacs.004` return, and an audit trail showing who authorised the recall under four eyes.
- `a-tpp-reads-an-account` (the new TPP developer Character): consent granted, SCA satisfied with
  dynamic linking, the read scoped to the consent, and the whole decision visible in one OPA
  decision log.

**Fixtures.** The reference's own rule belongs in the fixture generator: a fixture that produces a
401 is rejection evidence, not a baseline. `scripts/e2e/sim-uat-fixtures.mjs` should emit, per
fixture line, whether the row is reachable *with the identity the journey will actually use*, not
only that the row exists.

