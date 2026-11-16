import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { Bot, Users, KeyRound, FolderGit2, BookOpen, Fingerprint, Sparkles, Boxes, Eraser, Lock, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExportKind, ExportPicker } from './types';
import { ENCRYPTED_SCOPES } from './types';
import Button from '@/features/shared/components/buttons/Button';

/** Icon + accent per scope. A total `Record` on purpose — an eighth
 *  `ExportKind` without an entry here fails typecheck instead of rendering
 *  an undefined icon. */
export const SCOPE_META: Record<ExportKind, { icon: LucideIcon; accent: string }> = {
  personas: { icon: Bot, accent: 'bg-role-agent/10 text-role-agent' },
  teams: { icon: Users, accent: 'bg-status-info/10 text-status-info' },
  credentials: { icon: KeyRound, accent: 'bg-status-warning/10 text-status-warning' },
  projects: { icon: FolderGit2, accent: 'bg-status-success/10 text-status-success' },
  knowledge: { icon: BookOpen, accent: 'bg-role-agent/10 text-role-agent' },
  twins: { icon: Fingerprint, accent: 'bg-status-error/10 text-status-error' },
  athena: { icon: Sparkles, accent: 'bg-role-agent/10 text-role-agent' },
};

/** Rail order (also the tab order of the picker). */
export const SCOPES: ExportKind[] = [
  'personas',
  'teams',
  'credentials',
  'projects',
  'knowledge',
  'twins',
  'athena',
];

const ENCRYPTED = new Set<string>(ENCRYPTED_SCOPES);

export function ScopeRail({
  scope,
  onScope,
  picker,
}: {
  scope: ExportKind;
  onScope: (k: ExportKind) => void;
  picker: ExportPicker;
}) {
  const { t, tx } = useTranslation();
  const p = t.settings.portability.proto;

  // Exhaustive switch — the old ternary chain fell through to the knowledge
  // label, so a new scope would have silently rendered "Knowledge".
  const scopeLabel = (k: ExportKind): string => {
    switch (k) {
      case 'personas': return p.scope_personas;
      case 'teams': return p.scope_teams;
      case 'credentials': return p.scope_credentials;
      case 'projects': return p.scope_projects;
      case 'knowledge': return p.scope_knowledge;
      case 'twins': return p.scope_twins;
      case 'athena': return p.scope_athena;
      default: {
        const _exhaustive: never = k;
        return _exhaustive;
      }
    }
  };

  const setAll = (on: boolean) => {
    for (const k of SCOPES) picker.setMany(k, picker.allIds[k], on);
  };

  return (
    <nav className="w-56 flex-shrink-0 border-r border-hair bg-secondary/5 p-3 flex flex-col gap-1 overflow-y-auto">
      {SCOPES.map((key) => {
        const { icon: Icon, accent } = SCOPE_META[key];
        const c = picker.counts[key];
        const active = scope === key;
        return (
          <PressSurface key={key} onPress={() => onScope(key)} aria-current={active} aria-pressed={undefined} selected={active} data-testid={`portability-scope-${key}`} className="relative flex items-center gap-2.5 pl-3 pr-2.5 py-2.5 rounded-card">
            {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
            <span className={`w-8 h-8 rounded-card flex items-center justify-center flex-shrink-0 ${accent}`}>
              <Icon className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="typo-body text-foreground block truncate">{scopeLabel(key)}</span>
              <span className="typo-caption text-foreground tabular-nums">
                {tx(p.selected_of, { selected: c.selected, total: c.total })}
              </span>
            </span>
            {ENCRYPTED.has(key) && (
              <Lock className="w-3 h-3 text-status-warning flex-shrink-0" aria-label={p.encrypted_scope} />
            )}
          </PressSurface>
        );
      })}

      <div className="mt-auto pt-3 space-y-1">
        <Button
          type="button"
          onClick={() => setAll(true)}
          data-testid="portability-select-everything"
          variant="ghost"
          size="sm"
          className="w-full"
          icon={<Boxes className="w-3.5 h-3.5" />}
        >
           {p.select_everything}
        </Button>
        <Button
          type="button"
          onClick={() => setAll(false)}
          data-testid="portability-clear-all"
          variant="ghost"
          size="sm"
          className="w-full"
          icon={<Eraser className="w-3.5 h-3.5" />}
        >
           {p.clear_all}
        </Button>
      </div>
    </nav>
  );
}
