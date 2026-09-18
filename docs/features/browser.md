# Browser

A sidebar group under Projects, below Development, with two surfaces that let
Athena and your personas open and control web pages the way you would: inside
the app, on websites you have allowed, with every write passing your orb first.

Design record and the migration analysis from `athena-portable`:
[`docs/architecture/browser-control.md`](../architecture/browser-control.md).

## Whitelist

The list of websites agents may open and control. Nothing outside it is
reachable from any browser backend: an agent asking for a page that is not
listed is refused with an error that names this surface, and may ask you once,
through the orb, to add it. Approving that card is what creates the row *and*
enables it, because a site you just said yes to arriving paused would make you
say yes twice. A row you add by hand starts paused until you switch it on.

Each row is one origin (`https://app.example.com`) and carries:

- **Enabled** — a paused site stays listed but refuses everything.
- **Control tier** — what the controllability scan found: `0` read-only, `1`
  generic hands (click, fill, select, submit by reference), `2` the page
  publishes its own tools (WebMCP).
- **Overrides** — per tool, you may force a class to *ask first*. You can never
  loosen a class below what the page's own manifest implies; the repo answers a
  loosening attempt with `refused_loosening`, and the UI offers no control that
  would produce one. Clearing an override restores the derived class, which is
  a reset rather than a loosening.
- **Budget** — how many calls an agent may make on this site in one turn.
- **Credential** — optionally a vault credential the app can use to log in for
  the agent. The values never reach the model, a snapshot or a screenshot.

**Controllability scan.** *Scan* runs a background agent that opens the site in
the Webview with read-only tools, looks for a WebMCP manifest, landmarks,
forms, operable elements, a login form and blockers such as a CAPTCHA, and
files its findings as a proposal. Nothing is enabled by a scan; you confirm it.
While a scan runs the row says so and the page re-reads the rows until it
settles.

**Adding a site.** *Add site* takes an origin — scheme and host with an
optional port, no path and no query — and an optional name. "Scan now" is on by
default, because a site with no scan is a site nobody knows anything about.

**Wildcards.** An address may also be a pattern, and a row that is one is
marked *pattern* beside its address in every layout:

- `https://*.example.com` — the site itself and every subdomain under it, at any
  depth. It matches on a label boundary, so `evil-example.com` and
  `example.com.evil` are outside it.
- `http://localhost:*` — that host on any port, and on no port.

The `*` is allowed in exactly those two places: as a single leading `*.` label
on the host, or as the whole port. A bare `*` host, a `*` inside a label, a path
or a query are refused, and the form says which of the two mistakes was made
before you submit. A wildcard is a policy decision, not a shortcut: every
subdomain the site ever publishes becomes reachable by an agent without you
seeing it appear.

One pattern row is there when you first open the page —
`http://localhost:3000`, named *Local dev (example)* and enabled — so the shape
is visible rather than described. It is an ordinary row: rename it, pause it or
remove it like any other.

### Three layouts

A switcher at the top of the page picks one while the design settles. All three
show the same rows and offer the same actions; your choice is remembered.

- **Ledger** — one dense row per site, sortable: tier, scan state, write policy,
  credential, the enabled switch and the row actions. The view for auditing the
  gate across every site at once.
- **Cards** — one tile per site, led by a three-segment control meter and the
  scan findings inline. The view for "how much can an agent actually do here?".
- **Detail** — a thin list on the left, and on the right five tabs for one site:
  *Overview* (the scan report), *Page tools* (what the page publishes, with the
  class the policy derived and the manifest's own claims beside it), *Hands*
  (what the generic hands can do and the per-turn budget), *Sign in* (bind a
  vault credential), *Policy* (force tools to ask first; set the budget). The
  view for deciding about one site.

## Webview

An embedded browser you and your agents share. You get tabs, an address bar and
back/forward; an agent that acts on a tab takes a visible lease on it, which you
can revoke. Only whitelisted origins load.

The page itself is a separate operating-system window drawn above the app's
interface, positioned from the rectangle the page area measures and reports.
Two consequences are worth knowing:

- Leaving the route hides the page and keeps every tab. Coming back shows the
  same pages, still where you left them.
- Nothing can be drawn on top of the page, so this route opens no dialogs of
  its own. Everything that needs one — adding a site, editing policy — lives on
  the Whitelist.

The address bar suggests as you type. The list is the Whitelist and nothing
else — no history, no search — ranked by how well what you typed matches the
address, the name, or the letters of the host in order; a pattern row is offered
as a concrete address (`https://*.example.com` as `https://example.com`, and
`http://localhost:*` as whatever port you typed). A paused site is listed so you
know it exists, greyed and not selectable, because opening it would be refused.
While the list is open the page steps aside and comes straight back when it
closes: the page is drawn above everything the app paints, so a list over it
would be invisible. Your tabs are untouched.

A navigation the gate refuses is reported under the address bar, not as a
notification: leaving the whitelist is an ordinary event (a link, a redirect, a
typo) and a notification per refusal would be noise.

When an agent's write on a tab is waiting for your decision, a thin amber bar
names it and points at the orb. It carries no buttons, because the orb is where
that decision is answered and the same question must not have two answers.

Screenshots for decision cards are Windows-only in this version; elsewhere the
card carries the snapshot text instead.

### Twin toolbar

Your twin can write into a box on the page for you. Arm the toolbar, then click
the box on the page — a comment field, a reply, any text input — and the page
outlines writable boxes as you hover so you can see what counts. On the click
the box focuses as it always would, the twin reads what sits around it (the
comment above, the thread before it, the page's main text, anything you had
selected) and drafts a reply into the box. Edit it there and send it the way the
site sends — or use the toolbar's Submit, which submits the form the box sits
in. Steer chips (shorter, warmer, formal, ask a question) and Regenerate redraft
into the same box. Nothing is sent until you send it; the pick itself changes
nothing on the page, and Cancel disarms it. The toolbar runs as you, through
the same gate the address bar does: a paused site or a tab an agent holds
refuses it.

## How agents reach it

Three callers, one vocabulary, one gate. Every one of them holds a **session**, and
every tool call on that session runs the same five rules in the same fixed order,
first refusal winning: the origin has a row, the row is not paused, a per-origin
override may only tighten a tool's class, the per-turn budget is not spent, the tab
is free or already this principal's. Only then does a backend see the action.

### Athena, from chat

Four ops, taught in her constitution (section "Driving a web app"):

| op | kind | what it is |
|---|---|---|
| `browser_status` | read, auto-fires | Which backend is up, which tabs are leased and by whom, and the Whitelist itself (enabled, tier, scan status, budget, whether a credential is bound). She reads it before proposing a write, because every refusal the gate can give is visible here first. It does not carry the open-tab list; that reaches her through the MCP tool of the same name inside a browser turn. |
| `browser_act` | approval | One page write: `browser_click`, `browser_type`, `browser_select`, `browser_submit` or `browser_call_page_tool`, validated at the dispatcher and again at the executor. Navigation inside the Whitelist is not among them; it auto-fires. The executor photographs the page before acting and attaches the capture to the card. |
| `browser_login` | approval | Executed by Rust. The op carries no credential material and its grammar has no field one could ride in; a proposal that invents one is rejected with a message she reads next turn, never quietly stripped. |
| `browser_request_site` | approval | The one move available when a page is off the list. Your approval creates and enables the row. |

Under autonomous mode Athena's other approvals may fire on their own; these four
never do. A browser write always waits for the orb.

The constitution paragraph she reads, in short: reading is the agent's and happens
without asking; writing is never the agent's and happens because you said yes, not
because the agent was confident; a credential is not something an agent handles at
all; and when the page it needs is not on the list it asks once. Agents unblock
themselves through the operator, never around them.

### A persona or a fleet session, through the `browser` connector

The builtin **browser** connector (category `browser_automation`, no fields, the
Whitelist is the credential) is bound like any other. When the runner sees the
binding it opens a bridge session for that execution, writes a second MCP config
next to the run and appends it to the spawn; `--strict-mcp-config` still holds, so
the Personas sidecar and this file are the only tool sources the turn has. The
binding is detected the way every connector's is, by declared services, never by a
`browser_` name prefix. The session and its config file are owned by a guard that
revokes them on every exit path, so an execution's reach into your web apps never
outlives the execution.

### The controllability scan

*Scan* marks the row running and returns at once; a background turn surveys the site
with the bridge and nothing else (its own session, no shell, no fetch, no files) and
the result lands as a proposal. The prompt states the read-only rule and the gate
independently classes every write as ask-first, because a prompt is a request and a
gate is a rule. With no `claude` CLI on the machine the scan degrades to a probe
(page tools and a ref count through the backend) and says so in its notes, because a
tier that looks measured when it was assumed is the worse failure. Confirming a scan
never enables the site: agreeing with what a survey found and granting reach are two
decisions.

### Three browsers, one instruction

**The Personas browser** (the embedded Webview) is the default and the only one a
persona or a fleet session can reach: Whitelist, orb approvals, screenshots, audit
trail. **Your Chrome** through the paired extension is the same gate against your
real logged-in session and expects you to be present. **Claude Code's own Chrome
tool** is a developer's tool inside an interactive Claude Code session: no Whitelist,
no orb, no audit, and no persona can reach it. Never instruct a persona or a
dispatched session to "use the Chrome tools"; those sessions never see that server,
and the instruction fails silently as a tool the model cannot find. The full
comparison is in the design record linked at the top.

## Known limits in this version

- Screenshots for decision cards are Windows-only; elsewhere the card carries the
  snapshot text.
- The page-side channel that returns hand results runs inside the page, so a site
  with a strict `connect-src` policy times out its hands. Navigation, tabs and
  screenshots are unaffected; the scan records the blocker.
- The pending card shows the capture the executor took at approval time, not a
  live preview at proposal time.
- The twin toolbar can pick only boxes in the page's top frame: a comment box
  inside an embedded iframe (a third-party comment widget, for instance) cannot
  be picked. And because the pick is a page-side hand, a site with a strict
  `connect-src` policy times the pick out like every other hand — the toolbar
  reports it; nothing on the page is changed.
