/**
 * Type chips + export for the extracted-entity table.
 *
 * The chips drive a server-side filter (`kb_list_entities` has taken an
 * entityType since it shipped; nothing ever passed it), so narrowing to a type
 * returns up to a full page OF THAT TYPE rather than whatever fits in a mixed
 * page. Export takes the visible set out of the modal, which is where the
 * counting actually happens.
 */
import { Download, FileJson } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

export function EntityToolbar({
  types,
  active,
  onSelect,
  onExportCsv,
  onExportJson,
  exportDisabled,
}: {
  types: string[];
  active: string | null;
  onSelect: (type: string | null) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  exportDisabled: boolean;
}) {
  const { t } = useTranslation();
  const sh = t.vault.shared;

  if (types.length === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={sh.extract_filter_label}>
        <TypeChip label={sh.extract_filter_all} active={active === null} onClick={() => onSelect(null)} />
        {types.map((type) => (
          <TypeChip
            key={type}
            label={type}
            active={active === type}
            onClick={() => onSelect(active === type ? null : type)}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="xs"
          icon={<Download className="w-3 h-3" />}
          disabled={exportDisabled}
          onClick={onExportCsv}
          data-testid="entity-export-csv"
        >
          {sh.extract_export_csv}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          icon={<FileJson className="w-3 h-3" />}
          disabled={exportDisabled}
          onClick={onExportJson}
          data-testid="entity-export-json"
        >
          {sh.extract_export_json}
        </Button>
      </div>
    </div>
  );
}

function TypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`entity-type-chip-${label}`}
      className={[
        'px-2 py-0.5 rounded-interactive typo-caption font-mono transition-colors focus-ring',
        active
          ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
          : 'bg-secondary/40 text-foreground border border-border/40 hover:bg-secondary/70',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
