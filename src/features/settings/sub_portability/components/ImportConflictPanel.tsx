import { useState } from 'react';
import { AlertTriangle, ChevronDown, Upload } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { ImportConflict } from '@/lib/bindings/ImportConflict';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

type Resolution = 'replace' | 'skip' | 'duplicate';

const RESOLUTIONS: Resolution[] = ['skip', 'duplicate', 'replace'];

/** Pass-2 resolution key. Conflicts span more than one entity table now, so
 *  the bundle id alone is not unique — the backend reads `"<kind>:<id>"`. */
const conflictKey = (c: ImportConflict) => `${c.kind}:${c.bundleId}`;

/** Middle-truncate long filesystem paths so the tail (the distinctive part)
 *  stays readable inside the conflict row. */
function truncateMiddle(value: string, max = 46): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

interface ImportConflictPanelProps {
  conflicts: ImportConflict[];
  busy: boolean;
  onConfirm: (resolutions: Record<string, string>) => void;
  onDismiss: () => void;
}

/** Inline resolution card shown when a workspace-bundle import detects items
 *  that collide with existing ones (pass 1 imported everything else). Covers
 *  dev projects and twins. Mirrors the credential conflict card in
 *  `CredentialPortability`. */
export function ImportConflictPanel({ conflicts, busy, onConfirm, onDismiss }: ImportConflictPanelProps) {
  // Skip is the safest default — an unreviewed row never mutates local data.
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const { t, tx } = useTranslation();
  const s = t.settings.portability;

  const labels: Record<Resolution, string> = {
    skip: s.skip,
    duplicate: s.duplicate,
    replace: s.replace,
  };

  const kindLabel = (kind: ImportConflict['kind']): string =>
    kind === 'twin' ? s.conflict_kind_twin : s.conflict_kind_project;

  const matchedLabel = (matchedBy: string): string => {
    if (matchedBy === 'root_path') return s.matched_by_root_path;
    if (matchedBy === 'slug') return s.matched_by_slug;
    return s.matched_by_name;
  };

  const resolutionOf = (key: string): Resolution => resolutions[key] ?? 'skip';

  const handleConfirm = () => {
    const map: Record<string, string> = {};
    for (const c of conflicts) map[conflictKey(c)] = resolutionOf(conflictKey(c));
    onConfirm(map);
  };

  return (
    <div
      data-testid="portability-conflict-panel"
      className="rounded-card border border-status-warning/20 bg-status-warning/5 p-4 space-y-3"
    >
      <div className="flex items-center gap-2 typo-body text-status-warning">
        <AlertTriangle className="w-4 h-4" />
        {tx(conflicts.length > 1 ? s.items_exist_plural : s.items_exist, { count: conflicts.length })}
      </div>
      <p className="typo-caption text-foreground">{s.import_conflict_hint}</p>

      <div className="space-y-2">
        {conflicts.map((c) => {
          const key = conflictKey(c);
          const current = resolutionOf(key);
          return (
            <div
              key={key}
              data-testid={`portability-conflict-row-${key}`}
              className="flex items-center gap-3 px-3 py-2 rounded-card bg-surface-1 border border-hair"
            >
              <div className="flex-1 min-w-0">
                <span className="typo-body text-foreground truncate block">{c.name}</span>
                {c.detail && (
                  <Tooltip content={c.detail}><span className="typo-caption text-foreground block">
                    {truncateMiddle(c.detail)}
                  </span></Tooltip>
                )}
                <span className="typo-caption text-foreground">
                  {kindLabel(c.kind)} · {matchedLabel(c.matchedBy)}
                </span>
              </div>
              <Listbox
                ariaLabel={s.choose_resolution}
                itemCount={RESOLUTIONS.length}
                onSelectFocused={(i) => {
                  const picked = RESOLUTIONS[i];
                  if (picked) setResolutions((prev) => ({ ...prev, [key]: picked }));
                }}
                className="w-36 flex-shrink-0"
                renderTrigger={({ isOpen, toggle }) => (
                  <Button
                    type="button"
                    data-testid={`portability-conflict-select-${key}`}
                    onClick={toggle}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    iconRight={<ChevronDown className={`w-4 h-4 text-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                  >
                    {labels[current]}
                  </Button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-secondary/95">
                    {RESOLUTIONS.map((option, i) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={current === option}
                        onClick={() => {
                          setResolutions((prev) => ({ ...prev, [key]: option }));
                          close();
                        }}
                        className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${
                          i === focusIndex || current === option
                            ? 'bg-primary/10 text-foreground'
                            : 'text-ink-2 hover:bg-primary/5'
                        }`}
                      >
                        {labels[option]}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          data-testid="portability-conflict-confirm"
          onClick={handleConfirm}
          disabled={busy}
          variant="accent"
          tone="info"
          size="md"
          icon={<Upload className="w-4 h-4" />}
        >
          {s.import_with_resolutions}
        </Button>
        <Button
          type="button"
          data-testid="portability-conflict-cancel"
          onClick={onDismiss}
          disabled={busy}
          variant="ghost"
          size="sm"
        >
          {s.cancel}
        </Button>
      </div>
    </div>
  );
}
