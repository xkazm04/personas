# Browser

A sidebar group under Projects, below Development, with two surfaces that let
Athena and your personas open and control web pages the way you would: inside
the app, on websites you have allowed, with every write passing your orb first.

Design record and the migration analysis from `athena-portable`:
[`docs/architecture/browser-control.md`](../architecture/browser-control.md).

> **Status (2026-09-15):** the group and both routes ship with their empty
> states (WP0). The Whitelist table, the controllability scan, the embedded
> page host and the Athena ops land in the follow-on packages of the same spark;
> each section below says which.

## Whitelist

The list of websites agents may open and control. Nothing outside it is
reachable from any browser backend: an agent asking for a page that is not
listed is refused with an error that names this surface, and may ask you once,
through the orb, to add it.

Each row is one origin (`https://app.example.com`) and carries:

- **Enabled** — a paused site stays listed but refuses everything.
- **Control tier** — what the controllability scan found: `0` read-only, `1`
  generic hands (click, fill, select, submit by reference), `2` the page
  publishes its own tools (WebMCP).
- **Overrides** — per tool, you may force a class to *ask first*. You can never
  loosen a class below what the page's own manifest implies.
- **Budget** — how many calls an agent may make on this site in one turn.
- **Credential** — optionally a vault credential the app can use to log in for
  the agent. The values never reach the model, a snapshot or a screenshot.

**Controllability scan** (WP3): *Scan* runs a background agent that opens the
site in the Webview with read-only tools, looks for a WebMCP manifest, landmarks,
forms, operable elements, a login form and blockers such as a CAPTCHA, and files
its findings as a proposal. Nothing is enabled by a scan; you confirm it.

Three layouts are available from the switcher at the top while the design
settles (WP4): a ledger table, site cards with a control meter, and a
master-detail view with the scan report beside the list.

## Webview

An embedded browser you and your agents share. You get tabs, an address bar and
back/forward; an agent that acts on a tab takes a visible lease on it, which you
can revoke. Only whitelisted origins load. When an agent's write on a tab is
waiting for your decision, the tab says so and points at the orb.

Screenshots for decision cards are Windows-only in this version; elsewhere the
card carries the snapshot text instead.

## How agents reach it

- **Athena** proposes `browser_act` (a click, fill, select, submit or page-tool
  call), `browser_login` and `browser_request_site`; each is a decision on the
  orb. Reading a page and navigating within the Whitelist need no approval.
- **Personas and fleet sessions** bind the builtin **browser** connector; their
  runs then see the `browser_*` tools and the same gate.
- **The paired Chrome extension** remains available for work that needs your
  real Chrome session; the Whitelist and the orb apply there too.

Which browser to tell an agent to use, including how Claude Code's own Chrome
tool differs, is covered in the design record linked above.
