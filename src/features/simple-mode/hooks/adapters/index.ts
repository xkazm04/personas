/**
 * Barrel for the three Simple-mode inbox adapters. Each adapter is a pure
 * function mapping a source-specific store record + resolved persona summary
 * into a `UnifiedInboxItem` of the matching kind.
 */
export { adaptApproval } from './approvalAdapter';
export { adaptMessage } from './messageAdapter';
export { adaptHealing } from './healingAdapter';
