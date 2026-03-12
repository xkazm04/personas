use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

// -- Enums ---------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AccessLevel {
    Read,
    Execute,
    Fork,
}

impl fmt::Display for AccessLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AccessLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Execute => "execute",
            Self::Fork => "fork",
        }
    }
}

impl FromStr for AccessLevel {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "read" => Ok(Self::Read),
            "execute" => Ok(Self::Execute),
            "fork" => Ok(Self::Fork),
            _ => Err(AppError::Validation(format!(
                "Invalid access_level '{s}': must be 'read', 'execute', or 'fork'"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ResourceType {
    Persona,
    Template,
    ExecutionResult,
    Knowledge,
    Connector,
}

impl fmt::Display for ResourceType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl ResourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Persona => "persona",
            Self::Template => "template",
            Self::ExecutionResult => "execution_result",
            Self::Knowledge => "knowledge",
            Self::Connector => "connector",
        }
    }
}

impl FromStr for ResourceType {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "persona" => Ok(Self::Persona),
            "template" => Ok(Self::Template),
            "execution_result" => Ok(Self::ExecutionResult),
            "knowledge" => Ok(Self::Knowledge),
            "connector" => Ok(Self::Connector),
            _ => Err(AppError::Validation(format!(
                "Invalid resource_type '{s}': must be persona, template, execution_result, knowledge, or connector"
            ))),
        }
    }
}

// -- Exposed Resources ---------------------------------------------------

/// A resource the user has chosen to expose to the P2P network.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExposedResource {
    pub id: String,
    pub resource_type: ResourceType,
    pub resource_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub fields_exposed: String,     // JSON array of field names
    pub access_level: AccessLevel,
    pub requires_auth: bool,
    pub tags: String,               // JSON array of capability tags
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateExposedResourceInput {
    pub resource_type: ResourceType,
    pub resource_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub fields_exposed: Vec<String>,
    pub access_level: AccessLevel,
    pub requires_auth: bool,
    pub tags: Vec<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateExposedResourceInput {
    pub display_name: Option<String>,
    pub description: Option<Option<String>>,
    pub fields_exposed: Option<Vec<String>>,
    pub access_level: Option<AccessLevel>,
    pub requires_auth: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub expires_at: Option<Option<String>>,
}

// -- Exposure Manifest ---------------------------------------------------

/// Full manifest of everything the local instance exposes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExposureManifest {
    pub version: u32,
    pub owner_peer_id: String,
    pub owner_display_name: String,
    pub updated_at: String,
    pub resources: Vec<ExposedResource>,
}

// -- Resource Provenance -------------------------------------------------

/// Tracks where an imported resource originally came from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceProvenance {
    pub resource_type: String,
    pub resource_id: String,
    pub source_peer_id: String,
    pub source_display_name: Option<String>,
    pub imported_at: String,
    pub bundle_hash: Option<String>,
    pub signature_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateProvenanceInput {
    pub resource_type: String,
    pub resource_id: String,
    pub source_peer_id: String,
    pub source_display_name: Option<String>,
    pub bundle_hash: Option<String>,
    pub signature_verified: bool,
}
