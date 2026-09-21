//! How the twin's generators are told to write, and the few mechanical tells
//! that are fixed in code rather than asked for in a prompt.
//!
//! Every generator behind the Twin setup (the guided turn, the bio, the style
//! studio's samples and drafts) produces text a person is meant to read as
//! their own or as a colleague's. The operator reported that it reads as
//! machine-written. The prompts explain much of it: they asked for a "warm,
//! efficient interviewer" and a "professional bio", named no language, and
//! said nothing about the tells readers now recognise (a praise opener on a
//! question, clause-joining em dashes, a small set of stock words; see
//! Wikipedia's "Signs of AI writing").
//!
//! The split follows the evidence (see `experience/RESEARCH.md`):
//!
//! - **What to write is said positively, in the prompt**, and the instruction
//!   block is itself written the way the output should read, because a model
//!   imitates the register of its instructions. That is [`plain_voice`].
//! - **What is mechanical is fixed deterministically, after generation**: a
//!   rule decides it with no estimate involved, costs nothing, and cannot be
//!   argued out of by a confident model. That is everything else here. The
//!   dash fix carries a per-person allowance: a person whose own answers use
//!   dashes gets suggestions that may use them too.

/// How the guide and the bio are told to sound. Positive: it names the
/// register to write in, not the one to avoid.
const PLAIN_REGISTER: &str = "Write the way a thoughtful person types to someone they know: plain \
words, short sentences, contractions where they'd use them. Say the thing directly and stop. Keep \
praise, thanks and recaps of what was just said out of it, and don't group things in threes for rhythm.";

/// The tells that hold in every register, including a style that is meant to
/// be loud or long. The closing vocabulary list is the one place a negative
/// list earns its keep: those words are specific, and a positive paraphrase of
/// "don't say delve" does not exist. Source: Wikipedia's "Signs of AI writing".
pub(crate) const MACHINE_TELLS: &str = "Join clauses with commas and full stops rather than dashes. \
Leave out the words people now read as machine-written: delve, tapestry, testament, vibrant, seamless, \
leverage, elevate, unlock, journey, realm, crucial, navigate, and the \"not just X, but Y\" construction.";

/// The whole brief, for text the guide writes and for the bio.
pub(crate) fn plain_voice() -> String {
    format!("{PLAIN_REGISTER} {MACHINE_TELLS}")
}

/// Openers that carry no question and mark a turn as generated. Compared
/// case-insensitively and only as a whole word, so "Nicely" or "Coolant"
/// never match "nice" or "cool".
const FILLER_OPENERS: [&str; 22] = [
    "great",
    "awesome",
    "perfect",
    "love that",
    "love it",
    "nice",
    "got it",
    "thanks",
    "thank you",
    "wonderful",
    "fantastic",
    "amazing",
    "absolutely",
    "that's great",
    "that's helpful",
    "that helps",
    "interesting",
    "excellent",
    "cool",
    "okay",
    "ok",
    "understood",
];

/// Phrases no person writes about themselves. A suggested answer carrying one
/// is dropped rather than rewritten: there is no mechanical fix for a sentence
/// that was written by an assistant about being an assistant.
const ASSISTANT_PHRASES: [&str; 11] = [
    "as an ai",
    "language model",
    "i'd be happy to",
    "i would be happy to",
    "happy to help",
    "i hope this helps",
    "great question",
    "delve",
    "tapestry",
    "i'm just an",
    "feel free to",
];

/// True when any of `texts` uses a clause dash. The allowance that keeps the
/// dash fix from overriding a person's real habit.
pub(crate) fn uses_dashes<'a>(texts: impl IntoIterator<Item = &'a str>) -> bool {
    texts
        .into_iter()
        .any(|t| t.contains('—') || t.contains(" – "))
}

/// Replace clause-joining em and en dashes with a comma. Kept as they are:
/// a dash that opens a line (a sign-off like "— M"), and an en dash between
/// two digits (a range, "9–5"). A dash in front of other punctuation, or at
/// the very end, is dropped.
pub(crate) fn soften_dashes(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c != '—' && c != '–' {
            out.push(c);
            i += 1;
            continue;
        }
        let digit_before = i > 0 && chars[i - 1].is_ascii_digit();
        let digit_after = chars.get(i + 1).is_some_and(|n| n.is_ascii_digit());
        let line_start =
            out.trim_end_matches(' ').is_empty() || out.trim_end_matches(' ').ends_with('\n');
        if (c == '–' && digit_before && digit_after) || line_start {
            out.push(c);
            i += 1;
            continue;
        }
        while out.ends_with(' ') {
            out.pop();
        }
        let mut j = i + 1;
        while j < chars.len() && chars[j] == ' ' {
            j += 1;
        }
        match chars.get(j) {
            None | Some('.' | ',' | '?' | '!' | ';' | ':' | '\n') => {}
            Some(_) => {
                if !out.ends_with(',') {
                    out.push(',');
                }
                out.push(' ');
            }
        }
        i = j;
    }
    out
}

/// Drop a leading praise or filler sentence from a question, when what follows
/// is still a question. "Great, that helps! How do you sign off?" becomes
/// "How do you sign off?". Anything that does not fit that exact shape is
/// returned trimmed and otherwise untouched.
pub(crate) fn strip_filler_opener(question: &str) -> String {
    let trimmed = question.trim();
    let Some(opener) = FILLER_OPENERS.iter().find(|o| {
        trimmed.len() >= o.len()
            && trimmed.is_char_boundary(o.len())
            && trimmed[..o.len()].eq_ignore_ascii_case(o)
            && !trimmed[o.len()..]
                .chars()
                .next()
                .is_some_and(|n| n.is_alphanumeric())
    }) else {
        return trimmed.to_string();
    };

    // The filler runs to the first sentence break that still comes BEFORE the
    // question mark ("Great, that helps! How…?"). With no such break, a comma
    // straight after the opener is the break ("Got it, so how…?"); any later
    // comma belongs to the sentence being asked.
    let after = &trimmed[opener.len()..];
    let question_at = after.find('?');
    let sentence_end = after
        .find(['.', '!'])
        .filter(|&at| question_at.is_some_and(|q| at < q));
    let cut = match sentence_end {
        Some(at) => opener.len() + at + 1,
        None if after.starts_with(',') => opener.len() + 1,
        None => return trimmed.to_string(),
    };
    let rest = trimmed[cut..]
        .trim_start_matches(['.', '!', ',', ' '])
        .trim();
    // A recap sentence can run long; one past this is more likely context the
    // question needs than filler, so it stays.
    let filler_words = trimmed[..cut].split_whitespace().count();
    if rest.is_empty() || !rest.contains('?') || filler_words > 20 {
        return trimmed.to_string();
    }
    let mut chars = rest.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => trimmed.to_string(),
    }
}

/// True when a suggested answer reads as written by an assistant.
pub(crate) fn reads_as_assistant(text: &str) -> bool {
    let lower = text.to_lowercase();
    ASSISTANT_PHRASES.iter().any(|p| lower.contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clause_dashes_become_commas() {
        assert_eq!(
            soften_dashes("I build tools — mostly for designers."),
            "I build tools, mostly for designers."
        );
        assert_eq!(
            soften_dashes("Two things—speed and taste."),
            "Two things, speed and taste."
        );
        assert_eq!(
            soften_dashes("The review — which I hate — is Thursday."),
            "The review, which I hate, is Thursday."
        );
    }

    #[test]
    fn a_dash_that_is_not_a_clause_break_survives() {
        // A sign-off is a person's habit, not a generated tell.
        assert_eq!(soften_dashes("— M"), "— M");
        assert_eq!(soften_dashes("Thanks!\n— Mira"), "Thanks!\n— Mira");
        // An en dash between digits is a range.
        assert_eq!(soften_dashes("I work 9–5."), "I work 9–5.");
        // A dash before punctuation or at the end just goes.
        assert_eq!(soften_dashes("Short —."), "Short.");
        assert_eq!(soften_dashes("Short —"), "Short");
    }

    #[test]
    fn the_dash_allowance_reads_the_persons_own_words() {
        assert!(uses_dashes(["plain", "fair enough — ship it"]));
        assert!(!uses_dashes(["plain", "no dash here - a hyphen"]));
    }

    #[test]
    fn a_praise_opener_is_dropped_when_a_question_follows() {
        assert_eq!(
            strip_filler_opener("Great, that helps! How do you usually sign off in email?"),
            "How do you usually sign off in email?"
        );
        assert_eq!(
            strip_filler_opener("Thanks for sharing that. What do you say when you don't know?"),
            "What do you say when you don't know?"
        );
        assert_eq!(
            strip_filler_opener("Got it, so how long does a Slack reply run?"),
            "So how long does a Slack reply run?"
        );
    }

    #[test]
    fn a_question_without_filler_is_left_alone() {
        let q = "Which is more you: 'Sounds good!', 'sg', or 'Sounds good.'?";
        assert_eq!(strip_filler_opener(q), q);
        // Whole-word match only.
        assert_eq!(
            strip_filler_opener("Nicely put. Or not?"),
            "Nicely put. Or not?"
        );
        // Nothing to keep after the filler: leave it rather than empty it.
        assert_eq!(strip_filler_opener("Great!"), "Great!");
    }

    #[test]
    fn assistant_speak_is_recognised() {
        assert!(reads_as_assistant("I'd be happy to help with that!"));
        assert!(reads_as_assistant("Let's delve into it."));
        assert!(!reads_as_assistant("yep, thursday works"));
    }
}
