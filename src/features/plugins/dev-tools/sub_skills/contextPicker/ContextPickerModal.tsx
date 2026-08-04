// Full-page context picker for skill dispatch — replaces the "This one"
// dropdown in UseSkillDialog for context-tracked skills (a flat select does
// not survive 600-800 contexts). Multi-select: each chosen context becomes
// one dispatched session.
//
// PROTOTYPE: two directional variants behind a throwaway SegmentedTabs switch
// (Roster+ tiles vs Cross-tab lens grid). The switcher is deleted at
// consolidation — see .claude/skills/prototype.
import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

import { ContextPickerCrossTab } from './ContextPickerCrossTab';
import { ContextPickerRoster } from './ContextPickerRoster';
import { filterPickerGroups, useContextPickerData } from './useContextPickerData';

export function ContextPickerModal({ skillName, projectId, initial, onConfirm, onClose }: {
  skillName: string;
  projectId: string;
  /** Context NAMES already chosen (dialog round-trips the picker). */
  initial: string[];
  onConfirm: (contextNames: string[]) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { groups, loading, totalContexts } = useContextPickerData(projectId, skillName);
  const [variant, setVariant] = useState<'roster' | 'crosstab'>('roster');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));

  const filtered = useMemo(() => filterPickerGroups(groups, query), [groups, query]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="ctx-picker-title" size="6xl" portal staggerChildren={false}>
      <div className="flex flex-col h-[80vh]" data-testid="context-picker-modal">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
          <SlidersHorizontal className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="ctx-picker-title" className="typo-title truncate">
            {tx(d.ctx_picker_title, { name: skillName })}
          </span>
          <span className="typo-caption text-foreground/50 tabular-nums flex-shrink-0">
            {tx(d.ctx_picker_selected, { n: selected.size, total: totalContexts })}
          </span>
          {/* PROTOTYPE SWITCHER — deleted at consolidation */}
          <span className="ml-auto flex-shrink-0">
            <SegmentedTabs
              tabs={[
                { id: 'roster', label: 'Roster+' },
                { id: 'crosstab', label: 'Cross-tab' },
              ]}
              activeTab={variant}
              onTabChange={(v) => setVariant(v as 'roster' | 'crosstab')}
              variant="segment"
              size="sm"
              fullWidth={false}
              ariaLabel="Prototype variant"
            />
          </span>
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={d.context_search_placeholder}
              aria-label={d.context_search_placeholder}
              className={`${INPUT_FIELD} !py-1 !pl-8 !text-sm`}
              autoFocus
            />
          </div>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {d.ctx_picker_clear}
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-4 pb-2">
          {loading ? (
            <div className="py-16"><LoadingSpinner label={d.skills_loading} /></div>
          ) : variant === 'roster' ? (
            <ContextPickerRoster groups={filtered} selected={selected} onToggle={toggle} />
          ) : (
            <ContextPickerCrossTab groups={filtered} selected={selected} onToggle={toggle} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => onConfirm([...selected])}
            data-testid="ctx-picker-confirm"
          >
            {tx(d.ctx_picker_confirm, { n: selected.size })}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
