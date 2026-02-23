pub mod cli_runner;
pub mod confirmation;
pub mod job_state;
mod prompts;
mod types;

// Re-export shared utilities used by template_adopt
pub use cli_runner::{
    extract_first_json_object,
    extract_questions_output,
    parse_persona_output,
    run_claude_prompt_text,
    run_claude_prompt_text_inner,
};
pub use types::{normalize_n8n_persona_draft, N8nPersonaOutput};
