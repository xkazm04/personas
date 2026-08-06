import { useState } from 'react';
import { AlertTriangle, ChevronDown, Upload } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { ImportConflict } from '@/lib/bindings/ImportConflict';
import { useTranslation } from '@/i18n/useTranslation';

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
      className="rounded-card border border-amber-500/20 bg-amber-500/5 p-4 space-y-3"
    >
      <div className="flex items-center gap-2 typo-body font-medium text-amber-400">
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
              className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/20 border border-primary/10"
            >
              <div className="flex-1 min-w-0">
                <span className="typo-body font-medium text-foreground truncate block">{c.name}</span>
                {c.detail && (
                  <span className="typo-caption text-foreground block" title={c.detail}>
                    {truncateMiddle(c.detail)}
                  </span>
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
                  <button
                    type="button"
                    data-testid={`portability-conflict-select-${key}`}
                    onClick={toggle}
                    className="w-full inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-input typo-body
                      bg-secondary/20 border border-primary/15 text-foreground hover:border-primary/30 transition-colors"
                  >
                    {labels[current]}
                    <ChevronDown className={`w-4 h-4 text-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
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
                            : 'text-foreground/80 hover:bg-primary/5'
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
        <button
          type="button"
          data-testid="portability-conflict-confirm"
          onClick={handleConfirm}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-modal typo-body font-medium
            bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
            transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {s.import_with_resolutions}
        </button>
        <button
          type="button"
          data-testid="portability-conflict-cancel"
          onClick={onDismiss}
          disabled={busy}
          className="typo-caption text-foreground hover:text-muted-foreground/80 transition-colors disabled:opacity-40"
        >
          {s.cancel}
        </button>
      </div>
    </div>
  );
}
