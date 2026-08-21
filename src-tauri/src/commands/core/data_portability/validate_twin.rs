//! Structural validation of the twin sections of a bundle.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Per-field validation of the twin section.
///
/// Deliberately NOT modelled on the count-only precedent used by
/// `dev_projects` / `workspace_knowledge`: a section that checks array sizes
/// but never string lengths is an unbounded-string import path, and a twin's
/// bundle is mostly free text (communications, memories, KB chunks). Every
/// text column that reaches the DB is bounded here.
pub(crate) fn validate_twins(bundle: &PortabilityBundle) -> Result<(), AppError> {
    const TWIN_STATUSES: [&str; 3] = ["pending", "approved", "rejected"];
    const TWIN_DIRECTIONS: [&str; 2] = ["in", "out"];

    for (i, tw) in bundle.twins.iter().enumerate() {
        let p = format!("twin[{i}]");
        validation::require_non_empty(&format!("{p}.name"), &tw.name)?;
        validation::require_max_len(&format!("{p}.name"), &tw.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(&format!("{p}.bio"), &tw.bio, MAX_DESIGN_CONTEXT_LEN)?;
        validation::require_optional_max_len(&format!("{p}.role"), &tw.role, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(
            &format!("{p}.languages"),
            &tw.languages,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.pronouns"),
            &tw.pronouns,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.training_directives"),
            &tw.training_directives,
            MAX_DESIGN_CONTEXT_LEN,
        )?;

        validation::require_max_count(&format!("{p}.tones"), &tw.tones, MAX_TWIN_TONES)?;
        validation::require_max_count(
            &format!("{p}.communications"),
            &tw.communications,
            MAX_TWIN_COMMUNICATIONS,
        )?;
        validation::require_max_count(
            &format!("{p}.pending_memories"),
            &tw.pending_memories,
            MAX_TWIN_MEMORIES,
        )?;
        validation::require_max_count(
            &format!("{p}.distilled_facts"),
            &tw.distilled_facts,
            MAX_TWIN_FACTS,
        )?;
        validation::require_max_count(&format!("{p}.contacts"), &tw.contacts, MAX_TWIN_CONTACTS)?;
        validation::require_max_count(
            &format!("{p}.reflections"),
            &tw.reflections,
            MAX_TWIN_REFLECTIONS,
        )?;
        validation::require_max_count(&format!("{p}.channels"), &tw.channels, MAX_TWIN_CHANNELS)?;

        for (j, t) in tw.tones.iter().enumerate() {
            let q = format!("{p}.tone[{j}]");
            validation::require_max_len(&format!("{q}.channel"), &t.channel, MAX_SHORT_FIELD_LEN)?;
            validation::require_max_len(
                &format!("{q}.voice_directives"),
                &t.voice_directives,
                MAX_DESIGN_CONTEXT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.examples_json"),
                &t.examples_json,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.constraints_json"),
                &t.constraints_json,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.length_hint"),
                &t.length_hint,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        for (j, c) in tw.communications.iter().enumerate() {
            let q = format!("{p}.communication[{j}]");
            validation::require_max_len(&format!("{q}.channel"), &c.channel, MAX_SHORT_FIELD_LEN)?;
            if !TWIN_DIRECTIONS.contains(&c.direction.as_str()) {
                return Err(AppError::Validation(format!(
                    "{q}.direction must be one of {TWIN_DIRECTIONS:?}, got '{}'",
                    c.direction
                )));
            }
            validation::require_optional_max_len(
                &format!("{q}.contact_handle"),
                &c.contact_handle,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &c.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.summary"),
                &c.summary,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.key_facts_json"),
                &c.key_facts_json,
                MAX_CONFIG_LEN,
            )?;
        }

        for (j, m) in tw.pending_memories.iter().enumerate() {
            let q = format!("{p}.pending_memory[{j}]");
            validation::require_optional_max_len(
                &format!("{q}.channel"),
                &m.channel,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &m.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(&format!("{q}.title"), &m.title, MAX_NAME_LEN)?;
            if !TWIN_STATUSES.contains(&m.status.as_str()) {
                return Err(AppError::Validation(format!(
                    "{q}.status must be one of {TWIN_STATUSES:?}, got '{}'",
                    m.status
                )));
            }
            validation::require_optional_max_len(
                &format!("{q}.reviewer_notes"),
                &m.reviewer_notes,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.source_communication_id"),
                &m.source_communication_id,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        for (j, f) in tw.distilled_facts.iter().enumerate() {
            let q = format!("{p}.distilled_fact[{j}]");
            validation::require_optional_max_len(
                &format!("{q}.contact_handle"),
                &f.contact_handle,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &f.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.sources_json"),
                &f.sources_json,
                MAX_CONFIG_LEN,
            )?;
        }

        for (j, c) in tw.contacts.iter().enumerate() {
            let q = format!("{p}.contact[{j}]");
            validation::require_non_empty(&format!("{q}.handle"), &c.handle)?;
            validation::require_max_len(&format!("{q}.handle"), &c.handle, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{q}.alias"), &c.alias, MAX_NAME_LEN)?;
            validation::require_optional_max_len(
                &format!("{q}.notes"),
                &c.notes,
                MAX_MEMORY_CONTENT_LEN,
            )?;
        }

        for (j, r) in tw.reflections.iter().enumerate() {
            let q = format!("{p}.reflection[{j}]");
            validation::require_max_len(
                &format!("{q}.prompt_seed"),
                &r.prompt_seed,
                MAX_DESCRIPTION_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &r.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
        }

        for (j, c) in tw.channels.iter().enumerate() {
            let q = format!("{p}.channel[{j}]");
            validation::require_non_empty(&format!("{q}.channel_type"), &c.channel_type)?;
            validation::require_max_len(
                &format!("{q}.channel_type"),
                &c.channel_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.credential_id"),
                &c.credential_id,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.persona_id"),
                &c.persona_id,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(&format!("{q}.label"), &c.label, MAX_NAME_LEN)?;
        }

        if let Some(kb) = &tw.knowledge_base {
            let q = format!("{p}.knowledge_base");
            validation::require_non_empty(&format!("{q}.name"), &kb.name)?;
            validation::require_max_len(&format!("{q}.name"), &kb.name, MAX_NAME_LEN)?;
            validation::require_optional_max_len(
                &format!("{q}.description"),
                &kb.description,
                MAX_DESCRIPTION_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.embedding_model"),
                &kb.embedding_model,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_count(
                &format!("{q}.documents"),
                &kb.documents,
                MAX_KB_DOCUMENTS,
            )?;
            validation::require_max_count(&format!("{q}.chunks"), &kb.chunks, MAX_KB_CHUNKS)?;

            for (j, d) in kb.documents.iter().enumerate() {
                let r = format!("{q}.document[{j}]");
                validation::require_max_len(&format!("{r}.title"), &d.title, MAX_NAME_LEN)?;
                validation::require_max_len(
                    &format!("{r}.source_type"),
                    &d.source_type,
                    MAX_SHORT_FIELD_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.source_path"),
                    &d.source_path,
                    MAX_DESCRIPTION_LEN,
                )?;
                validation::require_max_len(
                    &format!("{r}.content_hash"),
                    &d.content_hash,
                    MAX_SHORT_FIELD_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.metadata_json"),
                    &d.metadata_json,
                    MAX_CONFIG_LEN,
                )?;
                validation::require_max_len(
                    &format!("{r}.status"),
                    &d.status,
                    MAX_SHORT_FIELD_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.error_message"),
                    &d.error_message,
                    MAX_DESCRIPTION_LEN,
                )?;
            }

            for (j, c) in kb.chunks.iter().enumerate() {
                let r = format!("{q}.chunk[{j}]");
                validation::require_max_len(
                    &format!("{r}.content"),
                    &c.content,
                    MAX_MEMORY_CONTENT_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.metadata_json"),
                    &c.metadata_json,
                    MAX_CONFIG_LEN,
                )?;
            }
        }
    }

    Ok(())
}
