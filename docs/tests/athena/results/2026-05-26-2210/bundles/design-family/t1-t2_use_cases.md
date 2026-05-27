# Athena Quality Bundle — `design-family` / turn `t2_use_cases`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 2 of 6
- Hard-assertion status: **PASS**
- Wall time: 46087ms

## User said

```
Good. What use cases should it handle?
```

## Athena's reply

```
Here's a starter set — five cases that map the space without bloating it. The principle: goldens prove it works on the common stuff, variants prove it doesn't fall over on the edges, out-of-scope prevents it from scope-creeping into a reply-drafter.


Two notes once you've looked:

- The **out-of-scope** entry is the load-bearing one. Most triage personas die because they slowly become "respond to anything in the inbox." Pinning spam / non-support as explicitly *not* this persona's job keeps it honest.
- The **thread-continuation** variant depends on which inbox you settle on — Gmail threads cleanly, Outlook is messier, help desks usually handle this for you. So that one will firm up once you tell me the source.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `use_case_set`

  Card config keys:
  - `use_case_set` — keys: ['intent', 'use_cases']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ["Looks right — let's pick the model tier", 'Add a use case for VIP/named-customer routing', 'Drop the thread-continuation one for now', 'Pick the email source first']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

- ✅ `expect_card[use_case_set]` — card kinds seen: ['use_case_set']

## Judge rubric (this turn)

**Axes to score:** useful, grounded, op_correctness

**Surface map:**
- _"what use cases?"_ → show_use_case_set with 3-5 cases tagged golden/variant/out_of_scope

**Anti-patterns to flag explicitly:**
- Returned generic 'respond to user' use cases not tied to the email intent
- Skipped variant or out_of_scope role entirely (best-practice violation)
- Returned use cases in prose instead of the card

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2156/verdicts/design-family/t1-t2_use_cases.json

matching the schema in the playbook §"Verdict file format".
