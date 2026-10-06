# Browser

A sidebar group under Projects, below Development, with two surfaces:
**Server control**, where you run your projects' dev servers and choose which
websites agents may open, and
the **Webview**, where Athena and your personas open and control web pages the
way you would: inside the app, on websites you have allowed, with every write
passing your orb first.

Design record and the migration analysis from `athena-portable`:
[`docs/architecture/browser-control.md`](../architecture/browser-control.md).

## Server control

One page, two sections (the sidebar item is **Server control**; it used to be
called Whitelist):

1. **App servers** at the top: one row per dev project that has a port, with a
   switch to start and stop its dev server.
2. **Allowed websites** below it: the whitelist ledger, the origin gate every
   browser backend consults.

### App servers

Each server is one dev project with a **dev command** and a **port**. The
section shows its state, which Rust derives and announces on every change:

| state | meaning |
|---|---|
| Running | Personas started it and it answers HTTP on its port. |
| Starting | Personas started it and it has not answered yet (it has 120 seconds). |
| Running outside Personas | Something Personas did not start holds the port, for example a terminal you ran `npm run dev` in. Its PID is shown. |
| Stopping | A stop is in flight. |
| Failed | It exited before answering, never answered within 120 seconds, or its scan failed. The reason is shown until the next Start or Stop. |
| Scanning | Claude is reading the repository (see *Add app*). |
| Stopped | Configured and not running. |
| Not configured | The project has a port but no dev command yet. |

Servers show as **live tiles** grouped by workspace (a heading in the
workspace's colour with its app and live counts): each tile carries the name,
the port, the tech-stack icons and the dev command, and a state block at its
foot. A running tile's top edge pulses in the theme colour, the same motif as a
Fleet Monitor bay. (Live tiles won a four-way prototype round on 2026-10-06
over Rack, Port map and Switchboard, which were removed.)

**Right-click a server** for its menu: *Start* or *Stop*, *Restart*, *Open in
Webview* (opens `http://localhost:<port>` in the embedded browser and switches to
it), *Edit*, *Rescan with AI* and *Remove from view*. *Stop* on a server running
outside Personas stops that process tree too. *Remove from view* takes the
project out of this section and never deletes the project; it is disabled while
the server holds its port, so stop it first. The Fleet Monitor's Activity bays
offer the same run and stop items for their project's server.

**Add app** (the page header, or the empty state) lists your code projects
that are not in Server control yet, grouped by workspace and searchable; pick
one. A repository that is not a project yet is created with **New project**,
the same dialog the Projects manager uses, and added in the same step. Personas
gives the project the first free port from 3000 up, and starts a one-shot Claude scan in the repository that picks the dev
command, a port and the tech stack. The server appears at once in *Scanning* and
fills in when the scan lands (up to two minutes). A scan that fails leaves the
server in the view with no command and the reason shown. *Rescan with AI* runs
the same scan again.

**Edit** sets the dev command and the port by hand. A command is one program
invocation: at most 200 characters, and none of `&`, `|`, `;`, `<`, `>`, a
backtick, `$`, `(`, `)`, `%` (Windows would expand `%NAME%` from the app's
environment) or a line break. `{port}` is the only placeholder and is
replaced by the port; `PORT` is also set in the environment, which is what
Next.js reads. A blank command leaves the server not configured.

Saving a port by hand, adding an app and a scan that picks a port all add
`http://localhost:<port>` to the allowed websites if it is not there yet,
enabled, so *Open in Webview* works on the first try.

**Servers outlive Personas.** A server Personas started keeps running when you
close the app, and the next start picks it up again by its process id. Studio's
live preview servers are the exception: they are stopped when the app exits.

**The server serving Personas itself** (when you run Personas from a dev build,
the Vite server on the window's own port) cannot be stopped or restarted from
here: its *Stop* and *Restart* are disabled with a note saying why, because
stopping it would take this window down.

### Allowed websites

The list of websites agents may open and control. Nothing outside it is
reachable from any browser backend: an agent asking for a page that is not
listed is refused with an error that names this surface, and may ask you once,
through the orb, to add it. Approving that card is what creates the row *and*
enables it, because a site you just said yes to arriving paused would make you
say yes twice. A row you add by hand starts paused until you switch it on.

Each row is one origin (`https://app.example.com`) and carries:

- **Enabled**: a paused site stays listed but refuses everything.
- **Control tier**: what the controllability scan found: `0` read-only, `1`
  generic hands (click, fill, select, submit by reference), `2` the page
  publishes its own tools (WebMCP).
- **Overrides**: per tool, you may force a class to *ask first*. You can never
  loosen a class below what the page's own manifest implies; the repo answers a
  loosening attempt with `refused_loosening`, and the UI offers no control that
  would produce one. Clearing an override restores the derived class, which is
  a reset rather than a loosening.
- **Budget**: how many calls an agent may make on this site in one turn.
- **Credential**: optionally a vault credential the app can use to log in for
  the agent. The values never reach the model, a snapshot or a screenshot.

The ledger shows one dense, sortable row per site: tier, scan state, write
policy, credential, the enabled switch and the row actions (*Scan* or *Rescan*,
*Confirm* when a scan is waiting for you, *Open*, *Edit*, *Remove*).

**Controllability scan.** *Scan* runs a background agent that opens the site in
the Webview with read-only tools, looks for a WebMCP manifest, landmarks,
forms, operable elements, a login form and blockers such as a CAPTCHA, and
files its findings as a proposal. Nothing is enabled by a scan; you confirm it.
While a scan runs the row says so and the page re-reads the rows until it
settles.

**Adding a site.** *Add site* (the section head) takes an origin: scheme and
host with an optional port, no path and no query, and an optional name. "Scan
now" is on by default, because a site with no scan is a site nobody knows
anything about.

**Editing a site.** *Edit* opens the same dialog with the address read-only
(changing it would be adding a different site) and everything you may change
about the site in one place: its name, the sign-in credential (and whether the
scan found a sign-in form to use it on), which of the page's own tools must ask
first, and the per-turn budget. Nothing is written until *Save*, and then only
what you changed.

**Wildcards.** An address may also be a pattern, and a row that is one is
marked *pattern* beside its address:

- `https://*.example.com`: the site itself and every subdomain under it, at any
  depth. It matches on a label boundary, so `evil-example.com` and
  `example.com.evil` are outside it.
- `http://localhost:*`: that host on any port, and on no port.

The `*` is allowed in exactly those two places: as a single leading `*.` label
on the host, or as the whole port. A bare `*` host, a `*` inside a label, a path
or a query are refused, and the form says which of the two mistakes was made
before you submit. A wildcard is a policy decision, not a shortcut: every
subdomain the site ever publishes becomes reachable by an agent without you
seeing it appear.

One pattern row is there when you first open the page,
`http://localhost:3000`, named *Local dev (example)* and enabled, so the shape
is visible rather than described. It is an ordinary row: rename it, pause it or
remove it like any other.

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
  its own. Everything that needs one (adding a site, editing policy) lives on
  Server control. The one exception is the twin forge that Learn's **New twin**
  opens: while it is up the page steps aside, exactly as it does for the
  address suggestions, and comes back when the forge closes.

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

The toolbar's third icon, **Learn**, teaches your twin from your own writing.
Highlight something you wrote on the page (a sent mail, a post, a comment) and
press Learn. The twin reads the selection; when the page cannot be read (a
strict mail client blocks the page channel, the site is not whitelisted) or
nothing is selected, it reads what you last copied instead, once, because you
pressed the icon. The clipboard is never watched. Samples are capped at 8,000
characters. The line under the address bar then says how many words it has and
from where ("120 words from mail.example.com" or "from the clipboard") and
offers three choices:

- **Teach <your twin>** (shown when a twin is active) stores the sample and
  analyses it in the background. The line says "Learning in the background",
  then "3 proposals waiting" with **Open Hub**, or why nothing was learned. The
  twin refuses a sample that is one of its own placed drafts.
- **New twin** opens the twin forge on top of the app with the sample attached;
  once you name and create the twin, it learns from the sample right away.
- **Cancel** drops the sample.

Learning changes nothing by itself. The analysis files proposals (a writing
sample for the channel, a voice rule, a do or don't, a length hint, a style
setting) that wait in Twin > Hub's queue for Keep, Edit or Dismiss, and any
facts about you it noticed join the queue as memories to review. If both the
page and the clipboard come back empty the line says so; if the page could not
be read, it asks you to copy the text and press Learn again.

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
