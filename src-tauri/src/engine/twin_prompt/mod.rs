//! One twin prompt compiler for every drafting lane (spark
//! `twin-portable-blueprint`, WP2).
//!
//! Reply drafts, browser page drafts, training answer simulation and the
//! setup guide's suggested answers each used to build their own prompt, and
//! they drifted: the page lane showed the model no exemplars and no rules,
//! the answer and page lanes presented facts about contacts as facts about
//! the person, and only the bio, setup and style generators carried the
//! plain-voice quality rules. Every lane now embeds the same core block
//! ([`compile_twin_core`]) and keeps only its own task framing around it
//! (the message being answered, the fenced page, the question).
//!
//! The compiler is also the reference renderer of Twin Card 1.0
//! (`docs/standards/twin-card/1.0/RENDERER.md`, contract
//! `twin-card.render/1`). [`TwinPromptInput::from_db`] and
//! `TwinPromptInput::from_card` build the same view for the same twin, so a
//! card exported from Personas renders the same block in Personas.
//!
//! Layout: [`input`] (the view and the database door), [`card`] (the card
//! view and its door), [`compile`] (the sections, their order and limits).

pub mod card;
pub mod compile;
pub mod input;

#[cfg(test)]
pub(crate) mod fixture;
#[cfg(test)]
mod tests;

pub use compile::compile_twin_core;
pub use input::{TwinPromptInput, DEFAULT_CHANNEL};
