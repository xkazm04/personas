/// Coarse pipeline stage boundaries inside `run_execution`.
///
/// This small type is the first compile-checkable step toward splitting the
/// runner into stage modules. It centralizes labels/trace keys before any
/// state movement happens, so later extraction can replace each stage body
/// without changing trace semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RunnerStage {
    Validate,
    SpawnEngine,
    StreamOutput,
    FinalizeStatus,
}

impl RunnerStage {
    pub(super) fn key(self) -> &'static str {
        match self {
            Self::Validate => "validate",
            Self::SpawnEngine => "spawn_engine",
            Self::StreamOutput => "stream_output",
            Self::FinalizeStatus => "finalize_status",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Validate => "Pipeline: Validate",
            Self::SpawnEngine => "Pipeline: Spawn Engine",
            Self::StreamOutput => "Pipeline: Stream Output",
            Self::FinalizeStatus => "Pipeline: Finalize Status",
        }
    }

    pub(super) fn boundary(self) -> &'static str {
        match self {
            Self::Validate => "Command -> DB reads",
            Self::SpawnEngine => "Engine -> Tokio task",
            Self::StreamOutput => "Runner -> Tauri events",
            Self::FinalizeStatus => "Runner -> DB + events",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_keys_are_stable_for_trace_queries() {
        assert_eq!(RunnerStage::Validate.key(), "validate");
        assert_eq!(RunnerStage::SpawnEngine.key(), "spawn_engine");
        assert_eq!(RunnerStage::StreamOutput.key(), "stream_output");
        assert_eq!(RunnerStage::FinalizeStatus.key(), "finalize_status");
    }
}
