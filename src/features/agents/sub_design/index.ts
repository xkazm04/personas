export { DesignHub } from './DesignHub';

// The LLM design-wizard chrome (`DesignTab`, `DesignQuestionPanel`,
// `PhaseIndicator`, `IntentResultExtras`, `DesignPhasePanel` and the whole
// `phases/` tree) was retired with the agent-manifest rebase (2026-09-04)
// together with the `prompt` sub-tab that was its only mount point. Nothing
// outside this folder ever imported it — `EditorLazyTabs`' `DesignTab` is an
// alias for `DesignHub`, not for the deleted wizard.
