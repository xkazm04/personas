// Design hooks - core
export * from "./design/core/useDesignAnalysis";
export * from "./design/core/usePersonaCompiler";
export * from "./design/core/useAiSearch";
export * from "./design/core/useTauriStream";
export * from "./design/core/useAiArtifactTask";
export * from "./design/core/useAutomationDesign";
export * from "./design/core/useBackgroundRebuild";
export * from "./design/core/useBackgroundPreview";
export * from "./design/core/useDesignContextMutator";
export * from "./design/core/useDesignConversation";
export * from "./design/core/playbookCache";

// Design hooks - oauth
export * from "./design/oauth/useOAuthPolling";
export * from "./design/oauth/useOAuthProtocol";
export * from "./design/oauth/useOAuthConsent";
export * from "./design/oauth/useUniversalOAuth";

// Design hooks - credential
export * from "./design/credential/useCredentialDesign";
export * from "./design/credential/useCredentialNegotiator";
export * from "./design/credential/useCredentialForaging";
export * from "./design/credential/negotiatorStepGraph";
export * from "./design/credential/applyDesignResult";

// Design hooks - template
export * from "./design/template/useTemplateGallery";
export * from "./design/template/useGalleryQuery";
export * from "./design/template/useDesignReviews";
export * from "./design/template/useRecipeExecution";
export * from "./design/template/useRecipeVersioning";
export * from "./design/template/useRecipeGenerator";
export * from "./design/template/useAiArtifactFlow";

// Execution hooks
export * from "./execution/usePersonaExecution";
export * from "./execution/useCorrelatedCliStream";
export * from "./execution/useActivityMonitor";
export * from "./execution/useFileChanges";
export { useStructuredStream, type StreamHandlers } from "./execution/useStructuredStream";

// Realtime hooks
export * from "./realtime/useRealtimeEvents";
export * from "./realtime/useMessageCreatedListener";

// Database hooks
export * from "./database/useTableIntrospection";

// Lab hooks
export * from "./lab/useLabEvents";

// Step progress
export * from "./useStepProgress";

// Utility hooks - timing
export * from "./utility/timing/useAnimatedNumber";
export * from "./utility/timing/useElapsedTimer";
export * from "./utility/timing/useDebouncedSave";
export * from "./utility/timing/usePolling";
export * from "./utility/timing/useDebounce";

// Utility hooks - interaction
export * from "./utility/data/useAutoInstaller";
export * from "./utility/interaction/useToggleSet";
export * from "./utility/interaction/useCopyToClipboard";
export * from "./utility/interaction/useClickOutside";
export * from "./utility/interaction/useViewportClamp";
export * from "./utility/interaction/useMotion";
export * from "./utility/interaction/useMobilePreview";
export * from "./utility/interaction/useVirtualList";

// Utility hooks - data
export * from "./utility/data/useAutoUpdater";
export * from "./utility/data/useAppSetting";
export * from "./utility/data/useEngineCapabilities";
export * from "./utility/data/useBackgroundSnapshot";
export * from "./utility/data/useModuleSubscription";
export * from "./utility/data/usePersistedContext";
export * from "./utility/data/useFilteredCollection";
