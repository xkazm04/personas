//! Card parts -> the file: integrity hashes over each part's plaintext
//! (SPEC.md 9), sealing of the personal parts (SPEC.md 11), then the
//! signature over everything else (SPEC.md 10). The order matters: a sealed
//! part is hashed BEFORE it is sealed, and the signature covers the sealed
//! form as written.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use super::build::BuiltCard;
use super::canonical::part_hash;
use super::seal::seal_part;
use super::sign::{sign_card, Signing};
use super::types::{
    generator_version, CardEnvelope, Generator, Integrity, Part, GENERATOR_NAME, SCHEMA_ID, SPEC,
    SPEC_VERSION,
};
use crate::error::AppError;

/// A card ready to write.
#[derive(Debug, Clone)]
pub(super) struct Assembled {
    /// The whole card, as a reader parses it.
    pub card: Value,
    /// The file text, members in SPEC.md 3 order.
    pub text: String,
    /// The partitions written, in file order (`voice` carries identity).
    pub partitions: Vec<String>,
    /// The subset that is sealed.
    pub sealed: Vec<String>,
    pub signed: bool,
    pub warnings: Vec<String>,
}

/// Hash, seal (`passphrase` already checked by `seal::sealing_passphrase`)
/// and sign `built`. `exported_at` is RFC 3339.
pub(super) fn assemble(
    built: BuiltCard,
    passphrase: Option<&str>,
    signing: &Signing,
    exported_at: &str,
) -> Result<Assembled, AppError> {
    let mut warnings = built.warnings;
    let mut hashes: BTreeMap<String, String> = BTreeMap::new();
    let mut partitions = vec![Part::Voice.partition().to_string()];
    let mut sealed: Vec<String> = Vec::new();

    let identity = plain(Part::Identity, &built.identity, &mut hashes)?;
    let voice = plain(Part::Voice, &built.voice, &mut hashes)?;
    let mut personal = |part: Part, value: Option<Value>| -> Result<Option<Value>, AppError> {
        let Some(value) = value else {
            return Ok(None);
        };
        hashes.insert(part.key().to_string(), part_hash(&value));
        partitions.push(part.partition().to_string());
        match passphrase {
            Some(pp) if part.sealable() => {
                sealed.push(part.partition().to_string());
                seal_part(&value, pp).map(Some)
            }
            _ => Ok(Some(value)),
        }
    };
    let knowledge = personal(Part::Knowledge, to_value_opt(built.knowledge.as_ref())?)?;
    let training = personal(Part::Training, to_value_opt(built.training.as_ref())?)?;
    let evidence = personal(Part::Evidence, to_value_opt(built.evidence.as_ref())?)?;
    if passphrase.is_some() && sealed.is_empty() {
        warnings.push(
            "A passphrase was given, but neither self-knowledge nor training was exported, so nothing was sealed."
                .to_string(),
        );
    }

    let mut envelope = CardEnvelope {
        schema: SCHEMA_ID.to_string(),
        spec: SPEC.to_string(),
        spec_version: SPEC_VERSION.to_string(),
        card_id: built.card_id,
        created_at: built.created_at.unwrap_or_else(|| exported_at.to_string()),
        exported_at: exported_at.to_string(),
        generator: Generator {
            name: GENERATOR_NAME.to_string(),
            version: generator_version(),
        },
        identity,
        voice,
        knowledge,
        training,
        evidence,
        integrity: Integrity {
            alg: "sha256".to_string(),
            canonicalization: "rfc8785".to_string(),
            parts: hashes,
        },
        signature: None,
    };

    let signed = match signing {
        Signing::Key(signer) => match sign_card(&to_value(&envelope)?, signer) {
            Ok(signature) => {
                envelope.signature = Some(signature);
                true
            }
            Err(e) => {
                warnings.push(format!(
                    "The device identity could not sign this card ({e}), so it is unsigned."
                ));
                false
            }
        },
        Signing::NoIdentity => false,
        Signing::Failed(reason) => {
            warnings.push(reason.clone());
            false
        }
    };

    Ok(Assembled {
        card: to_value(&envelope)?,
        text: serde_json::to_string_pretty(&envelope)
            .map_err(|e| AppError::Internal(format!("twin card: serialize the file: {e}")))?,
        partitions,
        sealed,
        signed,
        warnings,
    })
}

/// An open part: serialized and hashed.
fn plain<T: Serialize>(
    part: Part,
    value: &T,
    hashes: &mut BTreeMap<String, String>,
) -> Result<Value, AppError> {
    let value = to_value(value)?;
    hashes.insert(part.key().to_string(), part_hash(&value));
    Ok(value)
}

fn to_value<T: Serialize>(value: &T) -> Result<Value, AppError> {
    serde_json::to_value(value)
        .map_err(|e| AppError::Internal(format!("twin card: serialize a part: {e}")))
}

fn to_value_opt<T: Serialize>(value: Option<&T>) -> Result<Option<Value>, AppError> {
    value.map(to_value).transpose()
}
