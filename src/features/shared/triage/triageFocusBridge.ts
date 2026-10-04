// triageFocusBridge — the ONE door between the shared TriageFocus component
// and the feature that owns the triage model.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT IN `components/`.
// `src/features/shared/components/**` is the domain-agnostic primitive catalog,
// and the repo enforces that twice: ESLint `no-restricted-imports`
// (`eslint.config.js:200-203`, advisory) and census `catalog-boundary-escape`
// (a RATCHET that fails `npm run check` and pre-push, baseline 3 files / 13
// matches). `TriageFocus` renders ONE domain model, so it cannot be
// domain-agnostic; importing `TriageItem` from six of its files would have
// raised that ratchet by 11.
//
// `src/features/shared/**` OUTSIDE `components/` is a different layer with a
// different contract: it is shared-across-features code that may name a
// feature (see the sibling `shared/dispatch/`, which does exactly this), and
// neither the lint pattern nor the census rule reaches it — the lint group is
// `["@/features/*/**", "!@/features/shared/**"]` and the census root is
// `src/features/shared/components` alone. So the seam lives in the layer that
// is allowed to hold it, and the catalog files import only `@/features/shared/…`.
// That is the layering's own answer, not a dodge of the rule: the rule says a
// CATALOG PRIMITIVE must not name a feature, and after this move none does.
//
// The real repair is upstream and out of this package's scope: `triageTypes.ts`
// is already React-free and store-free by its own module contract and belongs
// in `src/lib/`, at which point this file shrinks to the two component
// re-exports. Recorded here so the next package does not rediscover it.
//
// NOTHING from `overview/sub_manual-review/libs/` is imported, deliberately:
// that is a feature's brand-new private code and a shared component binding to
// it mid-flight is how a module becomes unshareable.
export { PersonaIcon } from '@/features/agents/components/PersonaIcon';
export {
  Chip,
  Kbd,
  TONE_FILL,
  TONE_TEXT,
} from '@/features/agents/quick-answer/triage/deck/DeckChips';
export { TriageCardBody } from '@/features/agents/quick-answer/triage/deck/TriageCardBody';
export type {
  TriageBranch,
  TriageDecision,
  TriageDecisionOption,
  TriageItem,
  TriageTone,
  TriageVerdict,
} from '@/features/agents/quick-answer/triage/triageTypes';
