---
layer: application
subject: supply-chain
technique: archive-extraction-safety
stack: rust
---

# Archive extraction in the sidecar installer: slip guard and sentinel

`extract_selected()` in `src-tauri/src/companion/tts/sherpa_engine.rs`
unpacks a pinned upstream engine release (a `.tar.bz2` from a versioned
URL) and demonstrates two of the technique's defenses in working form —
plus the budgets it does not yet carry.

## The traversal guard: refuse the archive, not the entry

Entry paths are stripped of the expected top-level `prefix/`, filtered
by a `keep(first_component)` predicate — and then, because only the
first component was vetted, every remaining component is checked:

```rust
// Tar-slip guard. Only the FIRST component is vetted above, so an entry
// like `<kept-dir>/../../../evil.dll` would escape `dest_dir` —
// `tar::Entry::unpack` performs no traversal sanitization of its own
// (that is `unpack_in`'s job). Any traversal / absolute / drive-prefix
// component means the archive is not what we pinned: refuse it.
if rel.components().any(|c| {
    !matches!(c, Component::Normal(_) | Component::CurDir)
}) {
    return Err(AppError::Internal(format!(
        "archive entry `{}` escapes the extraction directory — refusing",
    ...
```

Three technique clauses in one site: the comment records that the
format library's per-entry `unpack` does **no** containment of its own
(the library decodes the container, the call site owns the defense);
rejection is structural — `Component::Normal | CurDir` only, which
refuses `..`, absolute roots, *and* Windows drive prefixes in one
match; and a hostile entry aborts the **entire archive** ("the archive
is not what we pinned"), not just the row.

## The sentinel: empty extraction is an error

The function takes a `sentinel: &str` and errors if no unpacked file's
first path component matched it —
`"archive did not contain expected file matching …"`. The doc comment
names the purpose: "guards against silently reporting success on a
truncated/renamed asset." This is the technique's payload assertion,
shipped: a renamed upstream top-level directory or truncated download
becomes a loud error instead of a clean, empty install.

Upstream of extraction, the artifact is version-pinned
(`ENGINE_VERSION`, floor-commented "Never pin below this") with
arch-correct URLs keyed to the *compiled* target, not the possibly
emulated shell — the acquisition side of the pipeline, owned by
sidecar-provisioning's source-pinning and atomic-downloads techniques.

## What the site does not have

Measured against the technique, three gaps (reported, not registered —
this composer's report carries them for the deferred-fixes ledger):

- **No decompression budgets.** No total-bytes, per-entry, or
  entry-count cap; a hostile archive at the pinned URL could expand
  unboundedly. Mitigation today is trust in the pinned upstream, which
  is exactly the trust the budget clause exists to bound.
- **No link-entry policy.** Symlink/hardlink entries are not rejected
  or re-canonicalized; the containment check inspects entry *names*
  only, so the extract-a-link-then-write-through-it sequence is not
  addressed.
- **Direct-to-destination extraction.** Entries unpack into `dest_dir`
  as they stream, not into a quarantine promoted atomically — a failed
  extraction can leave a partial tree at the live path (the sentinel
  error fires, but cleanup is the caller's problem).
