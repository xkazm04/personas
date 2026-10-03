import { RefreshCw } from 'lucide-react';

import { Dot, KeyValueGrid, KitButton, Section, Stack } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { HealthAction, hasAction, type HealthActionDeps } from './HealthActions';
import type { HealthRow } from './HealthRows';
import { sectionLabel, statusMark, statusWord, type HealthSectionId } from './healthModel';

/**
 * Layer 2 for ONE check (kit batch home-3): the metadata the overview deliberately does not show,
 * and the action.
 *
 * **`HealthCheckItem.remediation` was NOT unrendered** -- the batch brief's claim that nothing in
 * the tree renders it is wrong. `SectionCard.tsx:98-103` rendered it, as a `typo-caption` line with
 * a wrench glyph, under every failing check's detail sentence. That is precisely why the old card's
 * height was its text's height: `detail` and `remediation` are two paragraphs of prose per check,
 * stacked inside a 280px column. The fix is not to start rendering remediation; it is to stop
 * rendering it on layer 1. Here it has a key of its own, beside the status and the detail, and the
 * row that owns it stays 48px tall.
 *
 * "Check again" re-runs ONE environment, which is the only place a manual re-run still earns its
 * keep: you press it on the thing you just went and fixed. The header's panel-wide re-run button is
 * gone (the owner, 2026-10-03: "Button to rerun checks should not be needed, remove from header"),
 * and the panel still re-runs by itself on an auth change, on an install completing, on a saved key
 * and on an MCP registration.
 */
export function HealthDetail({ row, deps, onRecheck }: {
  row: HealthRow | null;
  deps: HealthActionDeps;
  onRecheck: (id: HealthSectionId) => void;
}) {
  const { t } = useTranslation();
  const s = t.system_health;

  if (!row) {
    return (
      <Section
        level={2}
        title={s.detail_title}
        state="empty"
        empty={{ title: s.detail_none, hint: s.detail_none_hint }}
      />
    );
  }

  const { item, sectionId } = row;
  const mark = statusMark(t, item.status);
  const action = hasAction(item, deps.unavailable) ? <HealthAction item={item} deps={deps} /> : null;

  return (
    <Section
      level={2}
      eyebrow={sectionLabel(t, sectionId)}
      title={item.label}
      actions={
        <KitButton tone="quiet" icon={<RefreshCw />} onClick={() => onRecheck(sectionId)}>
          {s.check_again}
        </KitButton>
      }
    >
      <Stack divided>
        <KeyValueGrid
          min="12rem"
          items={[
            { k: s.col_status, v: statusWord(t, item.status), draw: <Dot tone={mark.tone} glyph={mark.glyph} /> },
            { k: s.col_detail, v: item.detail || null, none: s.detail_absent },
            { k: s.how_to_fix, v: item.remediation || null, none: s.how_to_fix_absent },
          ]}
        />
        {action}
      </Stack>
    </Section>
  );
}
