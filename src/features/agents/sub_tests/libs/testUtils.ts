// Unified scoring utilities — delegates to the eval framework.
// This file re-exports from the single source of truth to maintain backward compatibility.
export { compositeScore, statusBadge, WEIGHT_TOOL_ACCURACY, WEIGHT_OUTPUT_QUALITY, WEIGHT_PROTOCOL_COMPLIANCE } from '@/lib/eval/evalFramework';
