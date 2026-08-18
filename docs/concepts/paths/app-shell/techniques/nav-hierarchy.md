---
layer: technique
subject: app-shell
technique: nav-hierarchy
status: forged
laws: []
shared_with: []
---

# Nav hierarchy

How deep the navigation goes, where the second level lives, and what happens
when the user trades label space for content space. The recurring theme:
every level and every pixel of the nav is paid for on every screen, so each
must earn its permanence.

## Level one: flat until proven otherwise

The default navigation is a single flat list of sections. Flat is scannable,
learnable by position, and honest about the product's size. Grouping within
the flat list — visual separators, group headings — is cheap structure that
communicates the product's regions without adding a level of *interaction*:
the user still reaches everything in one click.

Grouping headings are labels, not destinations. A heading that is sometimes
clickable and sometimes not teaches the user that the nav is unpredictable.

## When a second level earns its place

A section earns a sub-nav when it has genuine internal geography: distinct
destinations of the same rank that a user moves *between* while staying in
the section — not merely a long page, and not a workflow (steps are a
page-owned progression, not navigation). The tests:

- **Peer destinations, not detail.** Sub-entries are siblings the user
  chooses among, each independently addressable and independently arrivable.
  A master list and the detail of one item is *not* two nav levels; it is
  one destination with selection state.
- **Stable set.** Sub-destinations come from the product's structure, not
  from the user's data. Entries that appear per user-created entity belong
  in the page (a list, a picker), because the nav's vocabulary must stay
  closed and learnable.
- **Visited repeatedly.** If users pass through a sub-destination once
  during setup and never return, it is a step, not a place.

The second level is **section-scoped**: it renders in the context of its
section — an expanded region under the section's entry, or a secondary rail
that appears when the section is active — and it never becomes a global
directory of every section's children at once. A permanently expanded
everything-tree makes the user scan the whole product to find anything and
surrenders the space economics that make a shell viable.

## Level three does not live in the shell

Depth beyond two levels is page structure leaking upward. Inside a section's
sub-destination, further subdivision belongs to the page: tabs, trees,
master-detail panes. The shell's job ends at delivering the user to a
sub-destination; if a third level of shell nav seems necessary, the actual
problem is usually a section trying to be a product — split it, or push the
depth into the page.

## Collapse: the label level

A persistent nav has two natural postures — expanded (icon + label) and
collapsed (icon only) — because label space is content space, and different
users, tasks, and window sizes price that trade differently.

- **What survives collapse: identity and attention.** Icons survive; badges
  and attention markers survive (they are why the nav exists when you are
  not looking at it); the active highlight survives. Labels move into
  on-demand affordances — a hover or focus reveal that names the entry
  without re-expanding the rail. An icon-only rail with no name reveal is a
  memory test, and it fails for every entry whose icon is not famous.
- **What collapse must not do: reorder or drop.** The collapsed rail is the
  same map at lower resolution — same entries, same order, same gating. If
  an entry is only reachable in one posture, the two postures are two navs.
- **Sub-navs under collapse** degrade to on-demand: the section's children
  appear as an anchored surface (flyout) from the section entry rather than
  inline. Reaching a sub-destination stays a two-interaction affair in both
  postures.

## Posture is the user's setting

The expand/collapse posture belongs to the user, not to the session:

- **Persisted and restored.** The user who collapses the rail finds it
  collapsed tomorrow. A posture that silently resets on relaunch, update,
  or navigation teaches the user their preferences are decorative.
- **Never fought.** The product may *default* the posture (by window width,
  by first-run heuristics) but once the user has expressed a choice, the
  product stops guessing. Automatic responsive collapse below a width floor
  is legitimate as a floor — the window physically cannot hold labels — but
  it is a constraint, not a preference overwrite: restore the user's choice
  when space returns.
- **Transitions are instant-safe.** The posture toggle animates as polish,
  but layout math, content reflow, and the reveal affordances must be
  correct at both endpoints with animation disabled; reduced-motion users
  get the same two postures, settled instantly.

## The prohibitions, collected

1. No nav entry exists in one posture but not the other.
2. No sub-nav goes global — a second level renders only in its section's
   context.
3. No per-user-data entries in the nav vocabulary.
4. No third shell level — depth beyond a sub-destination is page structure.
5. No silent posture resets; the user's expressed choice always wins over
   heuristics once space allows.
6. No icon-only entry without an accessible, discoverable name.
