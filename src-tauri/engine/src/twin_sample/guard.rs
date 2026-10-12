//! The self-reinforcement guard: a twin never learns from its own writing.
//!
//! A draft the twin placed into a page box, or a reply it wrote that the
//! operator approved in the outbox, is the twin's output. Learning from it
//! would feed the twin's style back into the twin as if it were the person's,
//! the "self-reinforcing corruption loop" the outbox already refuses to make
//! into memory (`ReplyOutbox.tsx`, `createMemory: false`). The person may well
//! have edited and sent such a draft, and then selected their sent message:
//! that is exactly the case the containment rule catches.
//!
//! Matching is on normalized text (whitespace collapsed, lowercased), exact or
//! either one containing the other. Containment only counts when the shorter
//! side carries at least [`MIN_CONTAINED_CHARS`]: a twin that once placed
//! "Thanks!" must not make every sample that says thanks unlearnable.

/// The shortest normalized text whose containment in the other side counts
/// as a match. Exact equality counts at any length.
pub const MIN_CONTAINED_CHARS: usize = 20;

/// The reason a refused sample carries (shown to the person as
/// "Not learned: <reason>").
pub const SELF_AUTHORED_REASON: &str =
    "it matches a draft your twin wrote, and a twin does not learn from its own writing";

/// Whitespace collapsed to single spaces, trimmed, lowercased.
pub fn normalize(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Whether two normalized texts match: equal, or the longer contains the
/// shorter and the shorter is at least [`MIN_CONTAINED_CHARS`] long.
fn matches(a: &str, b: &str) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a == b {
        return true;
    }
    let (short, long) = if a.chars().count() <= b.chars().count() {
        (a, b)
    } else {
        (b, a)
    };
    short.chars().count() >= MIN_CONTAINED_CHARS && long.contains(short)
}

/// `Some(reason)` when `sample` matches any of the twin's own texts.
pub fn self_authored<'a>(
    sample: &str,
    twin_texts: impl IntoIterator<Item = &'a str>,
) -> Option<&'static str> {
    let sample = normalize(sample);
    twin_texts
        .into_iter()
        .any(|text| matches(&sample, &normalize(text)))
        .then_some(SELF_AUTHORED_REASON)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DRAFT: &str = "Thanks for the write-up, I agree the rollout should wait a week.";

    #[test]
    fn an_exact_match_is_refused_through_whitespace_and_case() {
        let sample = "  thanks for the WRITE-UP,\n I agree the rollout should wait a week. ";
        assert_eq!(self_authored(sample, [DRAFT]), Some(SELF_AUTHORED_REASON));
    }

    #[test]
    fn a_sent_message_containing_the_placed_draft_is_refused() {
        let sent = format!("Hi Jo,\n\n{DRAFT}\n\nBest,\nAda");
        assert!(self_authored(&sent, [DRAFT]).is_some());
    }

    #[test]
    fn a_fragment_of_a_twin_draft_is_refused() {
        assert!(self_authored("I agree the rollout should wait a week", [DRAFT]).is_some());
    }

    #[test]
    fn a_short_twin_phrase_does_not_poison_every_sample() {
        let own = "Thanks! I'll send the deck over on Monday morning.";
        assert_eq!(self_authored(own, ["Thanks!"]), None);
        // ...but the exact short text is still the twin's.
        assert!(self_authored("thanks!", ["Thanks!"]).is_some());
    }

    #[test]
    fn unrelated_text_and_empty_inputs_pass() {
        assert_eq!(
            self_authored("Totally different words here, my own.", [DRAFT]),
            None
        );
        assert_eq!(self_authored("anything", ["   "]), None);
        assert_eq!(self_authored("anything", Vec::<&str>::new()), None);
    }
}
