#[cfg(test)]
use crate::db::models::{CreatePersonaInput, Persona};
#[cfg(test)]
use crate::db::repos::core::personas;
#[cfg(test)]
use crate::db::DbPool;

#[cfg(test)]
pub fn create_test_persona(pool: &DbPool, name: &str, system_prompt: &str) -> Persona {
    personas::create(
        pool,
        CreatePersonaInput {
            name: name.into(),
            system_prompt: system_prompt.into(),
            project_id: None,
            description: None,
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            group_id: None,
            notification_channels: None,
        },
    )
    .unwrap()
}

#[cfg(test)]
pub fn create_test_persona_id(pool: &DbPool, name: &str, system_prompt: &str) -> String {
    create_test_persona(pool, name, system_prompt).id
}
