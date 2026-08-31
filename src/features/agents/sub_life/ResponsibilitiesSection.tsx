import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import {
  listPersonaResponsibilities,
  retirePersonaResponsibility,
} from '@/api/agents/responsibilities';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Numeric } from '@/features/shared/components/display/Numeric';
import Button from '@/features/shared/components/buttons/Button';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { responsibilitiesCache } from './lifeCache';
import { STATUS_VARIANT } from './responsibilityMeta';
import { ResponsibilityEditor } from './ResponsibilityEditor';
import { AttentionLedgerStrip } from './AttentionLedgerStrip';

type EditorState = { mode: 'create' } | { mode: 'edit'; resp: PersonaResponsibility } | null;

/**
 * Standing charters a persona holds: the table, a section editor for
 * create/update, a Retire door, and the attention-ledger strip.
 */
export function ResponsibilitiesSection({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [items, setItems] = useState<PersonaResponsibility[]>(
    () => responsibilitiesCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!responsibilitiesCache.has(personaId));
  const [editor, setEditor] = useState<EditorState>(null);
  const [retireTarget, setRetireTarget] = useState<PersonaResponsibility | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listPersonaResponsibilities(personaId);
      responsibilitiesCache.set(personaId, rows);
      setItems(rows);
    } catch (err) {
      silentCatch('life:listResponsibilities')(err);
    } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setItems(responsibilitiesCache.get(personaId) ?? []);
    setEditor(null);
    void load();
  }, [personaId, load]);

  const scopeLabels: Record<number, string> = {
    0: life.resp_scope_0,
    1: life.resp_scope_1,
    2: life.resp_scope_2,
  };
  const statusLabels: Record<string, string> = {
    draft: life.resp_status_draft,
    active: t.common.active,
    suspended: life.resp_status_suspended,
    retired: life.resp_status_retired,
  };

  const columns: TableColumn<PersonaResponsibility>[] = [
    {
      key: 'title',
      label: life.resp_title_label,
      width: 'minmax(160px, 1.4fr)',
      sortable: true,
      render: (r) => <span className="typo-body text-foreground/90 truncate">{r.title}</span>,
    },
    {
      key: 'domain',
      label: life.resp_domain_label,
      width: '130px',
      render: (r) => <StatusBadge size="sm" accent="slate">{r.domain}</StatusBadge>,
    },
    {
      key: 'scope',
      label: life.resp_scope_label,
      width: '150px',
      render: (r) => (
        <StatusBadge size="sm" accent="cyan">{scopeLabels[r.scopeRung] ?? String(r.scopeRung)}</StatusBadge>
      ),
    },
    {
      key: 'objectives',
      label: life.resp_objectives_label,
      width: '90px',
      align: 'right',
      render: (r) => <Numeric value={r.objectives.length} align="right" />,
    },
    {
      key: 'budget',
      label: life.resp_budget_label,
      width: '110px',
      align: 'right',
      render: (r) =>
        r.budgetMonthlyUsd != null ? <Numeric value={r.budgetMonthlyUsd} unit="usd" align="right" /> : <span className="text-foreground/85">-</span>,
    },
    {
      key: 'status',
      label: t.common.status,
      width: '110px',
      render: (r) => (
        <StatusBadge size="sm" variant={STATUS_VARIANT[r.status] ?? 'neutral'}>
          {statusLabels[r.status] ?? r.status}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r) =>
        r.status !== 'retired' ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setRetireTarget(r);
            }}
            data-testid={`life-resp-retire-${r.id}`}
          >
            {life.resp_retire}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4" data-testid="life-resp">
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setEditor({ mode: 'create' })}
          data-testid="life-resp-new"
        >
          {life.resp_new}
        </Button>
      </div>

      <UnifiedTable<PersonaResponsibility>
        columns={columns}
        data={items}
        getRowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => setEditor({ mode: 'edit', resp: r })}
        emptyTitle={life.resp_empty_title}
        emptyDescription={life.resp_empty_body}
        density="compact"
        rowHeight={48}
        className="max-h-[32rem]"
      />

      {editor && (
        <ResponsibilityEditor
          key={editor.mode === 'edit' ? editor.resp.id : 'create'}
          personaId={personaId}
          existing={editor.mode === 'edit' ? editor.resp : undefined}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
          onCancel={() => setEditor(null)}
        />
      )}

      <AttentionLedgerStrip personaId={personaId} />

      {retireTarget && (
        <ConfirmDialog
          title={life.resp_retire_confirm_title}
          body={life.resp_retire_confirm_body}
          danger
          confirmLabel={life.resp_retire}
          onConfirm={async () => {
            try {
              await retirePersonaResponsibility(retireTarget.id);
              setRetireTarget(null);
              await load();
            } catch (err) {
              toastCatch('life:retireResponsibility', life.save_failed)(err);
            }
          }}
          onCancel={() => setRetireTarget(null)}
        />
      )}
    </div>
  );
}
