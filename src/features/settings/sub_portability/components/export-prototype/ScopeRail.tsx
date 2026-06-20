import { Bot, Users, KeyRound, Boxes, Eraser, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExportKind, ExportPicker } from './types';

export const SCOPES: { key: ExportKind; icon: LucideIcon; accent: string }[] = [
  { key: 'personas', icon: Bot, accent: 'bg-violet-500/10 text-violet-300' },
  { key: 'teams', icon: Users, accent: 'bg-sky-500/10 text-sky-300' },
  { key: 'credentials', icon: KeyRound, accent: 'bg-amber-500/10 text-amber-300' },
];

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
  const { inv } = picker;

  const scopeLabel = (k: ExportKind) =>
    k === 'personas' ? p.scope_personas : k === 'teams' ? p.scope_teams : p.scope_credentials;

  const setAll = (on: boolean) => {
    picker.setMany('personas', inv.personas.map((x) => x.id), on);
    picker.setMany('teams', inv.teams.map((x) => x.id), on);
    picker.setMany('credentials', inv.credentials.map((x) => x.id), on);
  };

  return (
    <nav className="w-56 flex-shrink-0 border-r border-primary/10 bg-secondary/5 p-3 flex flex-col gap-1 overflow-y-auto">
      {SCOPES.map(({ key, icon: Icon, accent }) => {
        const c = picker.counts[key];
        const active = scope === key;
        return (
          <button
            key={key}
            onClick={() => onScope(key)}
            aria-current={active}
            className={`relative flex items-center gap-2.5 pl-3 pr-2.5 py-2.5 rounded-card text-left transition-colors ${
              active ? 'bg-primary/10 border border-primary/20' : 'border border-transparent hover:bg-secondary/20'
            }`}
          >
            {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
            <span className={`w-8 h-8 rounded-card flex items-center justify-center flex-shrink-0 ${accent}`}>
              <Icon className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="typo-body font-medium text-foreground block truncate">{scopeLabel(key)}</span>
              <span className="typo-caption text-foreground tabular-nums">
                {tx(p.selected_of, { selected: c.selected, total: c.total })}
              </span>
            </span>
          </button>
        );
      })}

      <div className="mt-auto pt-3 space-y-1">
        <button
          onClick={() => setAll(true)}
          className="w-full inline-flex items-center gap-2 px-2.5 py-1.5 rounded-card typo-caption font-medium text-foreground hover:bg-secondary/25 transition-colors"
        >
          <Boxes className="w-3.5 h-3.5" /> {p.select_everything}
        </button>
        <button
          onClick={() => setAll(false)}
          className="w-full inline-flex items-center gap-2 px-2.5 py-1.5 rounded-card typo-caption font-medium text-foreground hover:bg-secondary/25 transition-colors"
        >
          <Eraser className="w-3.5 h-3.5" /> {p.clear_all}
        </button>
      </div>
    </nav>
  );
}
