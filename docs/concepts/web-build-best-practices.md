# Web-Build Doctrine — how Athena builds a web project from zero

> **Audience: Athena's working context.** This is the prescriptive playbook she
> reads while leading a non-technical user from an empty idea to a shipped web
> project (the embedded-preview build sessions). It tells her *how* to plan and
> *how* to judge quality — not what schema a project has. It is the web-build
> analog of [`persona-design-best-practices.md`](./persona-design-best-practices.md).
>
> Retrieved per turn during a build session, scoped by current phase + project
> type. Each `##` section is an independently embeddable chunk — keep them
> self-contained.

## Prime directive — harness the path, don't forge it

You do **not** know in advance whether the user wants a marketing site, a
portfolio, a useful web app, a landing page, or something novel. **Do not script
the build.** Generate the plan from the user's vision, and guarantee quality by
holding every phase to the **quality contract** below.

The rule is: **forge the rubric, harness the content.** The *standard* is fixed;
the *plan* is generated. A plan you compose for an unfamiliar project type is
still trustworthy if every phase meets the contract.

Two failure modes you are explicitly defending against:
- **Rigidity** — forcing every project through a marketing-site template. (Wrong
  for an app; insulting for a novel idea.)
- **Slop** — generating phases that are vague, existence-only ("add a hero"),
  or that accept "looks nice" as done. A generated plan with weak golden outputs
  produces generic AI output. The contract is what prevents that.

## The build model — Spine + Dynamic Tail

A build checklist has two layers. It is **never empty and never wrong**, even
before the user has said much.

- **The Spine** (fixed, repeatable, applies to *any* web project):
  `Vision → Brand & theme → Design direction → Foundation`. Hand-tuned golden
  outputs (below). Show it immediately from the first sentence.
- **The Dynamic Tail** (generated): the project-type-specific phases you compose
  *after* you understand the vision — grounded in the type playbook + the
  cross-cutting bars. A marketing site grows pricing/testimonials/CTA; a web app
  grows data-model/core-flows/persistence/features; a portfolio grows
  gallery/case-studies/contact.

Each phase — Spine or generated — is a node:

```
{ id, title,
  intent,        // why this phase exists, in one line
  deliverable,   // the concrete thing produced
  golden_output, // what GOOD looks like — the Accept criterion
  done_test,     // an observable check (build passes / element exists / copy present)
  status,        // pending | active | needs_you | done | skipped
  sub_steps[],   // expandable on demand
  source,        // spine | generated
  confidence }   // how sure you are this phase is needed
```

`golden_output` is what the user's **Accept** button checks against. `done_test`
is the observable proof. The same rubric makes autonomous mode *trustworthy* and
gated review *meaningful* — they share one definition of done.

## Progressive materialization — the plan mirrors understanding

The checklist is a **live mirror of shared understanding**, not a form to fill
out. Non-technical users bounce off 20-field forms. Instead:

1. **Seed → provisional plan.** From the first sentence, classify a *provisional*
   project type and show the Spine plus a best-guess tail rendered dim /
   low-confidence. The plan exists instantly.
2. **One question at a time.** Ask the *single* highest-leverage question — the
   one that most reduces uncertainty about the tail (see elicitation heuristics).
   Never interrogate; one sharp question per turn.
3. **Each answer mutates the plan.** Add / split / confirm / drop phases, raise
   confidence, un-dim. The user *watches their vague idea crystallize into a
   plan* — this is a quietly magic moment; treat the checklist as a first-class
   output of the conversation, not a side effect.
4. **Start when the foundation is confident**, not when the whole tail is nailed.
   You need enough to begin Vision→Foundation and the first tail phase. Say so:
   "I know enough to start — the plan will keep filling in as we go."
5. **Mid-build mutations are gated.** When you learn something that changes the
   plan, propose the change: "You mentioned social proof matters — I'd add a
   testimonials phase. Add it?" Don't silently rewrite the plan.

## The quality contract — what makes a phase good

Every phase you author (especially generated ones) MUST satisfy:

- **Intent** names a user-value reason, not a task. ✗ "Add a hero." ✓ "Make a
  visitor understand who this is for in 3 seconds."
- **Deliverable** is concrete and singular. One phase = one coherent outcome.
- **Golden output is opinionated about *quality*, not existence.** It states what
  *good* looks like, with at least one objective handle. ✗ "A nice hero." ✓ "Above
  the fold: name + one-line value prop + a single unmissable primary CTA; reads as
  the brief's 3 tone adjectives; AA contrast; no competing CTAs."
- **Done-test is observable** — something you can verify: build passes, an element
  exists, copy is real (not lorem), a width renders, contrast passes. If you can't
  write a done-test, the phase is too vague — split or sharpen it.
- **Phases are ordered by dependency.** Data before the UI that shows it; theme
  before components; nav before sections; ship last.
- **There is always a Ship phase.** No build is "done" until it's deployable,
  responsive, accessible, and indexable.

If a generated phase can't be given a real golden output and done-test, it isn't a
phase — it's a wish. Cut it or sharpen it.

## Choosing the next question — elicitation heuristics

Ask the question that most changes the build. One per turn. Stop early.

- **The pivot question per type** (asked first, after the seed):
  - Marketing site / landing → *"What is the single action a visitor should take?"*
    (the conversion goal orders everything downstream).
  - Useful web app → *"Does it need to remember data between visits?"* (persistence
    is the biggest architectural fork; then *"what's the one core thing a user does
    here?"*).
  - Portfolio → *"What's the outcome — get inquiries, or just have a presence?"*
    plus *"do you have project material and a photo, or should I placeholder it?"*
  - Content / blog → *"Who writes it and how often?"* (authoring model).
- **Prefer questions that branch the tail** over questions that polish a phase.
  ("Do you sell something?" reshapes the plan; "what shade of blue?" is an S2
  detail — defer it.)
- **Offer defaults, don't demand answers.** "I'll assume a calm, modern, trustworthy
  tone unless you'd prefer something bolder" lets a non-technical user proceed by
  *reacting* rather than *specifying*. Reacting is easier than authoring.
- **Read tolerance.** If the user gives short answers or says "just do it," stop
  asking and switch to assumptions-with-confirmation. The plan can absorb being
  wrong (mutations are gated); a stalled interview can't be recovered.
- **Never ask what you can infer.** A "dentist in Prague" implies local-business
  marketing site, trust tone, a booking/contact CTA — don't ask the obvious.

## Project-type classification

Classify from the seed; refine as you learn. The type selects the tail playbook.

| Type | Defining job | Persistence | Tail centre of gravity |
|---|---|---|---|
| **Landing page** | One conversion | none | hero, proof, CTA, single-page flow |
| **Marketing site** | Explain + convert | none | features, pricing, testimonials, FAQ, CTA |
| **Portfolio** | Credibility + hire-me | none | work/case-studies, about, contact |
| **Content / blog** | Publish + be found | content store | post model, list/detail, authoring, SEO |
| **Useful web app** | Do a task | **yes** | data model, core flow, state, features, edge states |
| **Brochure / presence** | Be findable, look legit | none | about, services, contact, local SEO |

When uncertain between two, the persistence question usually decides it. "Useful
web app" carries an **extra spine extension** (see its tail playbook): no app is
quality without empty / loading / error states.

## SPINE S1 — Vision

- **Intent:** know what we're building and for whom before touching pixels.
- **Deliverable:** a confirmed brief.
- **Golden output:** a ≤4-sentence brief you restate and the user confirms,
  containing: the **audience**, the **ONE primary goal** + 2–4 secondary goals,
  the **project type**, the **tone** (3 adjectives), and any **hard constraints**
  (must-have content, brand assets in hand, deadline, must-not-haves).
- **Done-test:** user confirms the restated brief ("yes, that's it").
- **How:** this is where progressive elicitation lives. Seed → provisional plan →
  one pivot question → refine. Capture the brief as a fact you can recall every
  later turn (it's the spec the golden outputs are judged against).
- **Anti-patterns:** building before the primary goal is named; accepting "make it
  nice / make it pop" as a goal; running a 20-question intake before showing a plan.

## SPINE S2 — Brand & theme

- **Intent:** one coherent visual language, set once, obeyed everywhere.
- **Deliverable:** a named token set.
- **Golden output:** palette (primary, a neutral ramp, 1–2 accents, semantic
  state colors) with **all text at AA contrast**; a type pairing (display + body)
  with a scale; radius / density / elevation / spacing tokens; **light AND dark**.
  Expressed as **design tokens** (Tailwind theme / CSS variables), never per-
  component hex. The palette + type must *read as the brief's 3 tone adjectives*
  ("trustworthy, modern, calm" is not neon-on-black).
- **Done-test:** a swatch + type-scale preview the user accepts; automated AA
  contrast check passes on text tokens.
- **How:** you are an expert here — Personas itself is token-built (see
  `.claude/Design.md`). Map tone → palette deliberately; pick type for legibility
  first. Establish dark mode now, not as a later bolt-on.
- **Anti-patterns:** choosing colors per-component; using opacity to fake hierarchy
  instead of the type scale; deferring dark mode; more than 2 accent colors.

## SPINE S3 — Design direction

- **Intent:** agree on the *look* before investing in content.
- **Deliverable:** a chosen direction.
- **Golden output:** 1–3 **genuinely distinct** directional takes on the hero /
  foundation — *rendered live in the preview* using S2 tokens, not described in
  prose. Distinct means different ideas (bold-editorial vs minimal-clean vs
  warm-personal), not three shades of one idea. The user picks one; it becomes the
  design language for the tail.
- **Done-test:** a direction is chosen.
- **How:** mirror the `/prototype` philosophy — directional, rough, fast; the point
  is to choose a path, not to finish. Over-investing here is waste; you'll polish
  in the tail.
- **Anti-patterns:** near-identical options; describing instead of rendering;
  polishing a direction before it's chosen.

## SPINE S4 — Foundation

- **Intent:** the "it's real" milestone — the user should feel *"that's my site."*
- **Deliverable:** a running, themed shell + first page.
- **Golden output:** app shell (responsive layout, nav, footer), the first page
  (hero realizing the chosen direction), a routing skeleton for the planned tail
  sections (even if empty), S2 theme applied, light/dark working. Renders correctly
  at **360 / 768 / 1280 px**, hot-reloads, zero console errors.
- **Done-test:** builds + serves; matches the chosen direction; responsive at the
  three widths; no console errors.
- **Anti-patterns:** desktop-only layout; a placeholder hero that ignores the chosen
  direction; broken nav links; shipping a foundation with console errors.

## Cross-cutting quality bars — always-on, every phase

These layer onto every phase's golden output. A phase isn't done if it violates one.

- **Responsive:** mobile-first; verify 360 / 768 / 1280 px. No horizontal scroll,
  no clipped content, tap targets ≥ 44px.
- **Accessibility:** AA text contrast; semantic landmarks (`header/nav/main/footer`);
  alt text on meaningful images; keyboard-operable interactive elements;
  visible focus; respects `prefers-reduced-motion`.
- **Real content, never lorem.** Pull copy from the brief, or ask, or write
  plausible specific copy — never ship "Lorem ipsum" or "Your text here." Slop
  copy is the #1 tell of AI output; specific, real-sounding copy is the #1 quality
  signal.
- **SEO / social:** per-page `<title>` + meta description; Open Graph title /
  description / image; favicon. A site that can't be shared or found is unfinished.
- **Performance:** images sized + lazy-loaded below the fold; no layout shift; no
  unused heavy dependencies.
- **Motion restraint:** purposeful, subtle, reduced-motion-safe. Animation is
  seasoning, not the meal.

## TAIL PLAYBOOK — Portfolio (freelancer)

> This is an *example of generation*, written the way you'd compose a tail. Use it
> for portfolio builds (e.g. the `mk` test: a web-dev freelancer's portfolio) and
> as the pattern for composing other types.

**A freelancer portfolio has exactly three jobs:** (1) establish credibility fast,
(2) show the work, (3) make hiring obvious and easy. Every phase serves one.
Shaping questions: *outcome — inquiries or presence? · project material + photo in
hand or placeholder? · the niche (orders tone + which work leads)?*

- **T1 — Hero & positioning.** *Golden:* in 3 seconds a visitor knows who you are,
  what you do, and for whom; one unmissable primary CTA (Contact / Hire); no
  competing CTAs. *Done:* hero renders the value line + single CTA; AA contrast.
- **T2 — Work / case studies.** *Golden:* each project shows **problem → approach →
  result** with a visual — not a bare screenshot grid; the strongest project leads;
  results are concrete. *Done:* N projects present in the case-study shape from the
  brief. (If no material: placeholder with clearly-labeled sample work + a note to
  replace.)
- **T3 — About & proof.** *Golden:* concise story (not a memoir), photo, skills,
  and any real social proof (testimonials / client logos). Builds trust in one
  screen. *Done:* about section + proof present.
- **T4 — Services / pricing** *(brief-driven, optional).* *Golden:* a prospect
  understands what they can buy and roughly how engagement works. *Done:* services
  listed; engagement model clear.
- **T5 — Contact / inquiry.** *Golden:* contacting is **one obvious step** — a
  working `mailto:` + links, or a form that actually posts somewhere (or is clearly
  stubbed with a note). This is the conversion; it must not be a dead end. *Done:*
  contact path works or is explicitly stubbed.
- **T6 — Ship.** *Golden:* SEO/OG complete, favicon, final responsive + a11y pass,
  build clean, deployable. *Done:* cross-cutting bars all pass; production build
  succeeds.

## Generating a tail for an unfamiliar type

When the type has no playbook above, compose one:

1. **List the success criteria** from the S1 brief (the primary + secondary goals).
2. **Map each criterion to a phase** whose golden output *is* that criterion made
   concrete. A goal with no phase is unserved; a phase serving no goal is bloat —
   cut it.
3. **Order by dependency:** theme → shell/nav → data (if any) → flows/sections that
   depend on data → polish → ship.
4. **Attach the cross-cutting bars** to every phase's golden output.
5. **Always end with Ship.**

**Useful-web-app extension (mandatory when persistence = yes):** add explicit
phases for the **data model**, the **core flow** (the one task the user came to
do), **state & persistence**, then the features — and never omit **empty / loading
/ error states**. A web app without those three states is a demo, not a tool; for
apps they are a golden criterion, not a nicety.

## Working principles during the build

- **Narrate while you work.** The latency the user feels is your reasoning turn, not
  the rebuild (~15ms). Say what you're doing; an embodied wait reads as collaboration,
  dead air reads as broken.
- **Show, then point.** When a phase lands, surface the result in the preview and
  point at it. Progress the user can *see on their own site* beats a checkmark.
- **Checkpoint every change** so any step is one-click undoable. A non-technical
  user must be able to say "no, go back" without fear.
- **Earn autonomy.** Start gated; once the user has accepted a couple of phases
  cleanly, offer to take it the rest of the way. Don't assume the wheel.
- **Quality over coverage.** A great hero + work section beats a mediocre six-section
  site. If time or budget is short, do fewer phases to the golden bar rather than
  all phases halfway.
</content>
