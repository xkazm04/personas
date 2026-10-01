//! The three operations behind the commands, synchronous (the commands run
//! them off the IPC worker). Export: build -> hash, seal, sign -> (wrap as
//! CCv3) -> write atomically. Inspect: read, report, write nothing. Import:
//! read, refuse what does not verify, apply in one transaction.

use std::io::Write as _;
use std::path::Path;

use chrono::{SecondsFormat, Utc};
use serde_json::Value;

use super::apply::{self, Conflict, ImportPlan};
use super::build::{self, Want};
use super::ccv3;
use super::envelope;
use super::open::{self, PartReading};
use super::schema;
use super::seal;
use super::sign::{verify_card, SignatureState, Signing};
use super::types::{CardIdentity, CardKnowledge, CardTraining, CardVoice, Part};
use crate::db::models::{
    TwinCardExportOptions, TwinCardExportResult, TwinCardImportResult, TwinCardInspection,
    TwinCardPartitionInfo,
};
use crate::db::DbPool;
use crate::error::AppError;
use crate::validation::require_non_empty;

/// Export `twin_id` to `options.path`.
pub(super) fn export(
    pool: &DbPool,
    twin_id: &str,
    options: &TwinCardExportOptions,
    passphrase: Option<&str>,
    signing: &Signing,
) -> Result<TwinCardExportResult, AppError> {
    let ccv3 = match options.format.as_str() {
        "twin-card" => false,
        "ccv3" => true,
        other => {
            return Err(AppError::Validation(format!(
                "\"{other}\" is not a card format (twin-card or ccv3)."
            )))
        }
    };
    let want = wanted_parts(&options.partitions)?;
    let passphrase = seal::sealing_passphrase(passphrase)?;
    require_non_empty("path", &options.path)?;
    let target = Path::new(&options.path);
    if !target.is_absolute() {
        return Err(AppError::Validation(
            "The export path must be absolute (the save dialog's choice).".into(),
        ));
    }

    let built = build::build_card(pool, twin_id, want)?;
    let exported_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let assembled = envelope::assemble(built, passphrase, signing, &exported_at)?;
    let text = if ccv3 {
        serde_json::to_string_pretty(&ccv3::wrap(&assembled.card)?)
            .map_err(|e| AppError::Internal(format!("twin card: serialize the CCv3 file: {e}")))?
    } else {
        assembled.text
    };
    write_atomically(target, &text)?;
    Ok(TwinCardExportResult {
        path: options.path.clone(),
        partitions: assembled.partitions,
        sealed: assembled.sealed,
        signed: assembled.signed,
        warnings: assembled.warnings,
    })
}

/// Read a card without importing it.
pub(super) fn inspect(
    path: &str,
    passphrase: Option<&str>,
) -> Result<TwinCardInspection, AppError> {
    let opened = open::read_card_file(path)?;
    let mut warnings = Vec::new();
    let valid = if opened.supported {
        let found = schema::violations(&opened.card)?;
        warnings.extend(found.iter().map(|v| format!("Not valid: {v}")));
        found.is_empty()
    } else {
        warnings.push(unsupported(&opened.spec_version));
        false
    };
    let mut readings = open::read_parts(&opened.card, passphrase.filter(|p| !p.is_empty()));
    for reading in &mut readings {
        if let Some(e) = reading.unseal_error.take() {
            warnings.push(error_text(e));
        }
    }
    let signature = verify_card(&opened.card);
    if signature == SignatureState::Unverifiable {
        warnings.push("This card is signed, but this build of Personas cannot check signatures (it was built without P2P), so it is shown as unsigned.".into());
    }
    Ok(TwinCardInspection {
        spec_version: opened.spec_version,
        supported: opened.supported,
        valid,
        name: opened
            .card
            .pointer("/identity/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        partitions: partition_infos(&readings),
        signature: signature.wire().to_string(),
        warnings,
    })
}

/// Import a card as a twin.
pub(super) fn import(
    pool: &DbPool,
    path: &str,
    passphrase: Option<&str>,
    conflict: &str,
) -> Result<TwinCardImportResult, AppError> {
    let conflict = Conflict::parse(conflict)?;
    let opened = open::read_card_file(path)?;
    if !opened.supported {
        return Err(AppError::Validation(format!(
            "{} Nothing was imported.",
            unsupported(&opened.spec_version)
        )));
    }
    if let Some(first) = schema::violations(&opened.card)?.first() {
        return Err(AppError::Validation(format!(
            "This file is not a valid Twin Card ({first}). Nothing was imported."
        )));
    }
    let mut readings = open::read_parts(&opened.card, passphrase.filter(|p| !p.is_empty()));
    // Every sealed part opens before anything is written.
    for reading in &mut readings {
        if reading.sealed && reading.value.is_none() {
            return Err(reading.unseal_error.take().unwrap_or_else(|| {
                AppError::Validation(format!(
                    "The card's {} is sealed. Enter its passphrase to import it.",
                    reading.part.key()
                ))
            }));
        }
    }

    let mut warnings = Vec::new();
    let identity: CardIdentity = match verified(&mut readings, Part::Identity, &mut warnings) {
        Some(value) => typed(value, "identity")?,
        None => {
            return Err(AppError::Validation(
                "The card's identity does not match its integrity hash: the file was changed after it was written. Nothing was imported.".into(),
            ))
        }
    };
    let voice: Option<CardVoice> = verified(&mut readings, Part::Voice, &mut warnings)
        .map(|v| typed(v, "voice"))
        .transpose()?;
    let knowledge: Option<CardKnowledge> = verified(&mut readings, Part::Knowledge, &mut warnings)
        .map(|v| typed(v, "knowledge"))
        .transpose()?;
    let training: Option<CardTraining> = verified(&mut readings, Part::Training, &mut warnings)
        .map(|v| typed(v, "training"))
        .transpose()?;

    let plan = ImportPlan {
        card_id: opened
            .card
            .get("card_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        identity,
        voice,
        knowledge,
        training,
    };
    let applied = apply::apply_card(pool, &plan, conflict)?;
    warnings.extend(applied.warnings);
    Ok(TwinCardImportResult {
        twin_id: applied.twin_id,
        imported: applied.imported,
        warnings,
    })
}

/// The export's optional parts. `voice` is implied; anything outside the
/// four partitions is refused rather than ignored.
fn wanted_parts(partitions: &[String]) -> Result<Want, AppError> {
    let mut want = Want::default();
    for name in partitions {
        match name.as_str() {
            "voice" => {}
            "knowledge" => want.knowledge = true,
            "training" => want.training = true,
            "evidence" => want.evidence = true,
            other => {
                return Err(AppError::Validation(format!(
                    "\"{other}\" is not a card partition (voice, knowledge, training, evidence)."
                )))
            }
        }
    }
    Ok(want)
}

/// The part's plaintext when present and its hash matched. A mismatch is
/// warned about and the part refused (SPEC.md 9); `identity` is the caller's
/// to refuse outright.
fn verified(readings: &mut [PartReading], part: Part, warnings: &mut Vec<String>) -> Option<Value> {
    let reading = readings.iter_mut().find(|r| r.part == part)?;
    if reading.hash_ok == Some(true) {
        return reading.value.take();
    }
    if part != Part::Identity {
        warnings.push(format!(
            "The card's {} was changed after it was written (its hash does not match), so it was not imported.",
            part.key()
        ));
    }
    None
}

fn typed<T: serde::de::DeserializeOwned>(value: Value, part: &str) -> Result<T, AppError> {
    serde_json::from_value(value)
        .map_err(|e| AppError::Validation(format!("The card's {part} cannot be read: {e}")))
}

/// The four partitions as inspect reports them: `voice` stands for identity
/// and voice together, and is intact only when both are.
fn partition_infos(readings: &[PartReading]) -> Vec<TwinCardPartitionInfo> {
    let mut infos: Vec<TwinCardPartitionInfo> = Vec::new();
    for reading in readings {
        let name = reading.part.partition();
        match infos.iter_mut().find(|i| i.name == name) {
            Some(info) => {
                info.sealed |= reading.sealed;
                info.hash_ok = match (info.hash_ok, reading.hash_ok) {
                    (Some(a), Some(b)) => Some(a && b),
                    _ => None,
                };
            }
            None => infos.push(TwinCardPartitionInfo {
                name: name.to_string(),
                sealed: reading.sealed,
                hash_ok: reading.hash_ok,
            }),
        }
    }
    // A card with identity but no voice (or the reverse) is not whole.
    let both = readings
        .iter()
        .filter(|r| matches!(r.part, Part::Identity | Part::Voice))
        .count();
    if both == 1 {
        if let Some(info) = infos.iter_mut().find(|i| i.name == "voice") {
            info.hash_ok = Some(false);
        }
    }
    infos
}

fn unsupported(spec_version: &str) -> String {
    let version = match spec_version {
        "" => "of no stated version",
        stated => stated,
    };
    format!("This card is Twin Card {version}; this app reads version 1.x.")
}

/// An error's own sentence, without the variant's prefix.
fn error_text(e: AppError) -> String {
    match e {
        AppError::Validation(message) | AppError::Internal(message) => message,
        other => other.to_string(),
    }
}

/// Write `text` next to `target` and rename it into place, so a reader
/// never sees half a card and a failed export leaves no partial file.
fn write_atomically(target: &Path, text: &str) -> Result<(), AppError> {
    let dir = target.parent().filter(|d| d.is_dir()).ok_or_else(|| {
        AppError::Validation(format!(
            "The folder for {} does not exist.",
            target.display()
        ))
    })?;
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "twin-card".to_string());
    let temp = dir.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let written = std::fs::File::create(&temp).and_then(|mut file| {
        file.write_all(text.as_bytes())?;
        file.sync_all()
    });
    let renamed = written.and_then(|()| std::fs::rename(&temp, target));
    if let Err(e) = renamed {
        if let Err(cleanup) = std::fs::remove_file(&temp) {
            tracing::debug!(error = %cleanup, "twin card: no temp file to clean up");
        }
        return Err(AppError::Io(e));
    }
    Ok(())
}
