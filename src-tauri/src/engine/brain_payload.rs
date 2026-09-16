//! Director Brain payload composition: turns what a persona's vault folder holds
//! into the evaluator's "prior coaching" block, and names every stored review
//! that block does not carry.
//!
//! Pure `std` with no crate imports, so the loss accounting is testable on its
//! own (`rustc --edition 2021 --test brain_payload.rs`).
//!
//! Three things keep a stored review out of the evaluator's view, and each one
//! is announced *inside* the block instead of being left for the model to infer:
//!
//!   1. a note inside the read window that could not be read;
//!   2. notes kept on disk that are older than the read window but have not yet
//!      been rolled into the digest (the folder cap only digests past 12 and the
//!      window reads 3, so up to 9 reviews sit in between, more if compaction
//!      failed);
//!   3. the character cap cutting the composed block, which on a heavy coaching
//!      history removes the digest before anything else.
//!
//! The evaluator is told to "build on past advice and avoid repeating yourself".
//! A block with an unannounced hole reads as complete, so the hole reads as "no
//! such advice was given", which is the inference that makes it repeat advice the
//! user already rejected.

/// Section header placed before the rolled-up digest of compacted notes.
pub(crate) const DIGEST_HEADER: &str = "## Older reviews (rolled-up digest)";

/// Separator between composed sections (unchanged from the original layout).
const SEP: &str = "\n\n---\n\n";

/// Heading every rendered Director review note starts with.
const NOTE_HEADING: &str = "## Director review";

/// Opening of every in-band notice this module writes.
const NOTICE_OPEN: &str = "_[Memory notice:";

/// What the read path found in a persona's vault folder.
pub(crate) struct HistoryParts<'a> {
    /// Readable notes inside the read window, newest first.
    pub recent: &'a [String],
    /// Notes inside the read window that exist and could not be read.
    pub unreadable_recent: usize,
    /// Notes on disk outside the read window that are not in the digest yet.
    pub not_in_window: usize,
    /// The rolled-up digest body, when present and non-empty.
    pub digest: Option<&'a str>,
}

fn plural(n: usize, one: &str, many: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {many}")
    }
}

/// Compose the history block. Returns `None` only when the folder holds nothing
/// at all; a folder whose every note failed to read still says so.
///
/// When nothing is missing the output is byte-identical to the layout the
/// evaluator has always received.
pub(crate) fn compose_history(p: &HistoryParts<'_>) -> Option<String> {
    if p.recent.is_empty() && p.digest.is_none() && p.unreadable_recent == 0 && p.not_in_window == 0
    {
        return None;
    }
    // Notices follow the notes they qualify, so a cap fold never spends the
    // freshest coaching's budget on them (the fold carries them past its cut).
    let mut sections: Vec<String> = p.recent.to_vec();
    if p.unreadable_recent > 0 {
        sections.push(format!(
            "{NOTICE_OPEN} {} unreadable, not shown.]_",
            plural(p.unreadable_recent, "recent review", "recent reviews"),
        ));
    }
    if p.not_in_window > 0 {
        sections.push(format!(
            "{NOTICE_OPEN} {} stored but not shown{}.]_",
            plural(p.not_in_window, "older review", "older reviews"),
            if p.digest.is_some() {
                ", nor in the digest below"
            } else {
                ""
            },
        ));
    }
    let mut out = sections.join(SEP);
    if let Some(d) = p.digest {
        if !out.is_empty() {
            out.push_str(SEP);
        }
        out.push_str(DIGEST_HEADER);
        out.push_str("\n\n");
        out.push_str(d.trim());
    }
    Some(out)
}

/// Byte offset of the `n`th char, or `s.len()` when `s` is shorter.
fn byte_at_char(s: &str, n: usize) -> usize {
    s.char_indices().nth(n).map_or(s.len(), |(i, _)| i)
}

/// Fold a composed history into at most `cap` characters of content, then name
/// what the cut removed. Under the cap the history is returned unchanged. Over
/// it, the kept head is exactly what a plain char-safe cut keeps (so the
/// freshest coaching is never displaced by a notice), followed by one notice
/// naming the omitted reviews and digest entries, then any notice the cut
/// removed.
pub(crate) fn fold_history(history: &str, cap: usize) -> String {
    let total = history.chars().count();
    if total <= cap {
        return history.to_string();
    }
    let cut = byte_at_char(history, cap);
    let mut out = String::with_capacity(cut + 400);
    out.push_str(&history[..cut]);
    out.push('…');

    let digest_at = history.find(DIGEST_HEADER);
    let notes_end = digest_at.unwrap_or(history.len());

    // Whole notes that start after the cut, and whether the cut fell inside one.
    let note_starts: Vec<usize> = history[..notes_end]
        .match_indices(NOTE_HEADING)
        .map(|(i, _)| i)
        .collect();
    let whole_notes = note_starts.iter().filter(|&&i| i >= cut).count();
    let partial_note = note_starts
        .iter()
        .rev()
        .find(|&&i| i < cut)
        .is_some_and(|&start| {
            // A note ends at the next note, the first notice after it, or the digest.
            let next_note = note_starts.iter().copied().find(|&i| i > start);
            let next_notice = history[start..notes_end]
                .find(NOTICE_OPEN)
                .map(|o| start + o);
            let end = [next_note, next_notice]
                .into_iter()
                .flatten()
                .min()
                .unwrap_or(notes_end);
            cut < end
        });

    let mut parts: Vec<String> = Vec::new();
    if partial_note {
        parts.push("the rest of one review".to_string());
    }
    if whole_notes > 0 {
        parts.push(plural(whole_notes, "whole review", "whole reviews"));
    }
    if let Some(d) = digest_at {
        let entries: Vec<usize> = history[d..]
            .match_indices("\n- **")
            .map(|(i, _)| d + i + 1)
            .collect();
        let total_entries = entries.len();
        if d >= cut {
            parts.push(format!(
                "the digest ({})",
                plural(total_entries, "older review", "older reviews")
            ));
        } else {
            // An entry is kept only when it ends before the cut; a half-kept
            // entry counts as not shown.
            let omitted = (0..total_entries)
                .filter(|&k| entries.get(k + 1).copied().unwrap_or(history.len()) > cut)
                .count();
            if omitted > 0 {
                parts.push(format!("{omitted} of {total_entries} digest entries"));
            }
        }
    }
    if parts.is_empty() {
        parts.push("the end of the history".to_string());
    }
    out.push_str(&format!(
        "\n\n{NOTICE_OPEN} cut at {cap} of {total} chars; not shown: {}. \
         Past coaching not visible here may exist.]_",
        parts.join("; ")
    ));
    // A notice the cut removed is itself a loss; carry it past the cut.
    for (i, _) in history.match_indices(NOTICE_OPEN) {
        if i + NOTICE_OPEN.len() > cut {
            if let Some(end) = history[i..].find("]_") {
                out.push('\n');
                out.push_str(&history[i..i + end + 2]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(i: usize, body_len: usize) -> String {
        format!(
            "{NOTE_HEADING} — ★★★☆☆ (3/5)\n\nN{i} {}",
            "x".repeat(body_len)
        )
    }

    fn parts<'a>(
        recent: &'a [String],
        unreadable_recent: usize,
        not_in_window: usize,
        digest: Option<&'a str>,
    ) -> HistoryParts<'a> {
        HistoryParts {
            recent,
            unreadable_recent,
            not_in_window,
            digest,
        }
    }

    #[test]
    fn nothing_missing_keeps_the_original_layout() {
        let recent = vec![note(3, 10), note(2, 10)];
        let got = compose_history(&parts(&recent, 0, 0, Some("- **d** — x\n"))).unwrap();
        let want = format!(
            "{}{SEP}{}{SEP}{DIGEST_HEADER}\n\n- **d** — x",
            recent[0], recent[1]
        );
        assert_eq!(got, want);
    }

    #[test]
    fn empty_folder_is_none() {
        assert!(compose_history(&parts(&[], 0, 0, None)).is_none());
    }

    #[test]
    fn unreadable_only_folder_still_speaks() {
        let got = compose_history(&parts(&[], 2, 0, None))
            .expect("a folder whose notes failed to read is not an empty folder");
        assert!(got.contains("2 recent reviews unreadable"), "{got}");
    }

    #[test]
    fn notes_between_window_and_digest_are_named_where_the_hole_is() {
        let recent = vec![note(12, 10)];
        let got = compose_history(&parts(&recent, 0, 9, Some("- **d** — x"))).unwrap();
        let notice = got
            .find("9 older reviews stored but not shown")
            .expect(&got);
        assert!(notice > got.find("N12").unwrap());
        assert!(notice < got.find(DIGEST_HEADER).unwrap());
    }

    #[test]
    fn a_notice_the_cut_removes_is_carried_past_it() {
        let recent = vec![note(3, 3990)];
        let h = compose_history(&parts(&recent, 0, 9, Some("- **a** — 1"))).unwrap();
        let got = fold_history(&h, 4000);
        assert!(
            got.contains("9 older reviews stored but not shown"),
            "{got}"
        );
        assert!(got.contains("the digest (1 older review)"), "{got}");
    }

    #[test]
    fn under_cap_is_untouched() {
        assert_eq!(fold_history("short", 4000), "short");
    }

    #[test]
    fn cut_keeps_the_same_head_and_names_the_digest() {
        let recent = vec![note(3, 1500), note(2, 1500), note(1, 1500)];
        let digest = "- **a** — 3/5\n- **b** — 2/5\n- **c** — 4/5";
        let h = compose_history(&parts(&recent, 0, 0, Some(digest))).unwrap();
        let got = fold_history(&h, 4000);
        let head: String = h.chars().take(4000).collect();
        assert!(got.starts_with(&head), "head displaced");
        assert!(got.contains("the rest of one review"), "{got}");
        assert!(got.contains("the digest (3 older reviews)"), "{got}");
    }

    #[test]
    fn cut_inside_digest_counts_entries() {
        let h = format!(
            "{}{SEP}{DIGEST_HEADER}\n\n- **a** — 1\n- **b** — 2\n- **c** — 3",
            note(1, 20)
        );
        let cap = h[..h.find("- **b**").unwrap()].chars().count() + 2;
        let got = fold_history(&h, cap);
        assert!(got.contains("2 of 3 digest entries"), "{got}");
        assert!(!got.contains("the rest of one review"), "{got}");
    }

    #[test]
    fn cut_is_char_safe_on_multibyte() {
        let h = "★".repeat(50);
        let got = fold_history(&h, 10);
        assert!(got.starts_with(&"★".repeat(10)));
        assert!(got.contains("cut at 10 of 50 chars"));
    }
}
