import { lazy, Suspense, useState } from 'react';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useTranslation } from '@/i18n/useTranslation';
import { useCreateAthenaEngine } from './engine/useCreateAthenaEngine';

// TODO(prototype, 2026-09-17): three design variants behind a switcher so
// the operator can compare them in the running app. Consolidate the winner
// and delete the switcher + losing variants in a follow-up session
// (`.claude/skills/prototype/SKILL.md` Phase 5).
const CreateAthenaConversation = lazy(() => import('./variants/CreateAthenaConversation'));
const CreateAthenaStage = lazy(() => import('./variants/CreateAthenaStage'));
const CreateAthenaScenes = lazy(() => import('./variants/CreateAthenaScenes'));

type VariantId = 'conversation' | 'stage' | 'scenes';
const TABS_ID = 'create-athena-variant';

/**
 * Create Athena — the chat-driven onboarding wizard (Plugins → Companion →
 * Create Athena). One engine (`useCreateAthenaEngine`) drives whichever
 * shell is active; the shells share no state of their own.
 */
export default function CreateAthenaPanel() {
  const { t } = useTranslation();
  const [variant, setVariant] = useState<VariantId>('conversation');
  const engine = useCreateAthenaEngine();
  const c = t.plugins.companion;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="create-athena-panel">
      <div className="flex justify-end shrink-0 pb-3">
        <SegmentedTabs<VariantId>
          size="sm"
          idPrefix={TABS_ID}
          ariaLabel={c.create_switcher_label}
          activeTab={variant}
          onTabChange={setVariant}
          tabs={[
            { id: 'conversation', label: c.create_variant_conversation, testId: 'create-athena-variant-conversation' },
            { id: 'stage', label: c.create_variant_stage, testId: 'create-athena-variant-stage' },
            { id: 'scenes', label: c.create_variant_scenes, testId: 'create-athena-variant-scenes' },
          ]}
        />
      </div>
      <div className="flex-1 min-h-0" {...segmentedTabPanelProps(TABS_ID, variant)}>
        <Suspense fallback={<RouteChunkSkeleton />}>
          {variant === 'conversation' && <CreateAthenaConversation engine={engine} />}
          {variant === 'stage' && <CreateAthenaStage engine={engine} />}
          {variant === 'scenes' && <CreateAthenaScenes engine={engine} />}
        </Suspense>
      </div>
    </div>
  );
}
