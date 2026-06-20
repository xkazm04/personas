// ExportSelectionModal — "Manifest" layout (consolidated production component).
// ---------------------------------------------------------------------------
// A near-full-app, three-pane export picker built to handpick among 100+
// personas: a scope rail (Personas / Teams / Credentials) → a search-first,
// filterable list → a live "manifest" cart that tallies exactly what ships,
// its encryption state, and the export CTA. KPIs are not a standalone scope —
// they ride along with their team via the all-or-none "Include KPI setup"
// control in the cart.
import { useMemo, useState } from 'react';
import { Search, X, CheckCheck, HardDriveDownload } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { useExportPicker } from './export-prototype/useExportPicker';
import { ScopeRail } from './export-prototype/ScopeRail';
import { ManifestCart } from './export-prototype/ManifestCart';
import { PersonaPickRow, TeamPickRow, CredentialRow } from './export-prototype/rows';
import type { ExportKind } from './export-prototype/types';

interface ExportSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (
    personaIds: string[],
    teamIds: string[],
    credentialIds: string[],
    includeMemories: boolean,
    includeKpis: boolean,
    passphrase?: string,
  ) => void;
  exporting: boolean;
}

type PersonaFilter = 'all' | 'teamed' | 'unteamed' | 'enabled' | 'starred';

export function ExportSelectionModal({ isOpen, onClose, onExport, exporting }: ExportSelectionModalProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.portability;
  const p = s.proto;
  const picker = useExportPicker(isOpen, onExport);
  const { inv } = picker;

  const [scope, setScope] = useState<ExportKind>('personas');
  const [query, setQuery] = useState('');
  const [personaFilter, setPersonaFilter] = useState<PersonaFilter>('all');
  const q = query.trim().toLowerCase();

  // Filtered ids for the active scope (drives "select shown" + the list).
  const shownIds = useMemo(() => {
    if (scope === 'personas') {
      return inv.personas
        .filter((person) => {
          const teams = inv.personaTeams.get(person.id) ?? [];
          if (personaFilter === 'teamed' && teams.length === 0) return false;
          if (personaFilter === 'unteamed' && teams.length > 0) return false;
          if (personaFilter === 'enabled' && !person.enabled) return false;
          if (personaFilter === 'starred' && !person.starred) return false;
          if (!q) return true;
          return (
            person.name.toLowerCase().includes(q) ||
            (person.description ?? '').toLowerCase().includes(q) ||
            (person.model_profile ?? '').toLowerCase().includes(q) ||
            teams.some((tm) => tm.name.toLowerCase().includes(q))
          );
        })
        .map((x) => x.id);
    }
    if (scope === 'teams') {
      return inv.teams.filter((tm) => !q || tm.name.toLowerCase().includes(q)).map((x) => x.id);
    }
    return inv.credentials
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.serviceType.toLowerCase().includes(q))
      .map((x) => x.id);
  }, [scope, q, personaFilter, inv]);

  const shownSet = useMemo(() => new Set(shownIds), [shownIds]);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => picker.isSelected(scope, id));

  const filterChips: { key: PersonaFilter; label: string }[] = [
    { key: 'all', label: p.filter_all },
    { key: 'teamed', label: p.filter_teamed },
    { key: 'unteamed', label: p.filter_unteamed },
    { key: 'enabled', label: p.filter_enabled },
    { key: 'starred', label: p.filter_starred },
  ];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="export-selection-title"
      maxWidthClass="max-w-[1600px]"
      staggerChildren={false}
      panelClassName="relative w-full flex flex-col h-[88vh] bg-background rounded-2xl shadow-elevation-4 overflow-hidden border border-primary/15"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-card flex items-center justify-center bg-emerald-500/10 text-emerald-300 flex-shrink-0">
            <HardDriveDownload className="w-4.5 h-4.5" />
          </span>
          <div className="min-w-0">
            <h2 id="export-selection-title" className="typo-heading-lg font-semibold text-foreground">
              {s.export_title}
            </h2>
            <p className="typo-caption text-foreground">{s.export_subtitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={s.close}
          className="p-1.5 rounded-card text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors flex-shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {inv.loading ? (
        <div className="flex flex-1 items-center justify-center gap-3 text-foreground">
          <LoadingSpinner />
          <span className="typo-body">{s.loading_data}</span>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <ScopeRail scope={scope} onScope={(k) => { setScope(k); setQuery(''); }} picker={picker} />

          {/* Picker list */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 pt-3 pb-2.5 border-b border-primary/8 space-y-2.5 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={p.search_placeholder}
                  aria-label={p.search_placeholder}
                  className="w-full pl-9 pr-9 py-2 rounded-card border border-primary/10 bg-secondary/20 typo-body text-foreground placeholder:text-foreground/40 outline-none focus-visible:border-primary/30"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    aria-label={s.cancel}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {scope === 'personas' &&
                  filterChips.map((chip) => (
                    <button
                      key={chip.key}
                      onClick={() => setPersonaFilter(chip.key)}
                      className={`px-2.5 py-1 rounded-input typo-caption font-medium border transition-colors ${
                        personaFilter === chip.key
                          ? 'bg-primary/15 border-primary/25 text-foreground'
                          : 'bg-secondary/20 border-primary/10 text-foreground hover:text-foreground'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                <span className="ml-auto typo-caption text-foreground tabular-nums">
                  {tx(p.results_count, { count: shownIds.length })}
                </span>
                <button
                  onClick={() => picker.setMany(scope, shownIds, !allShownSelected)}
                  disabled={shownIds.length === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption font-medium border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {allShownSelected
                    ? tx(p.deselect_filtered, { count: shownIds.length })
                    : tx(p.select_filtered, { count: shownIds.length })}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
              {shownIds.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-20 gap-1.5">
                  <Search className="w-7 h-7 text-foreground" />
                  <p className="typo-body font-medium text-foreground">{p.no_results_title}</p>
                  <p className="typo-caption text-foreground">{p.no_results_hint}</p>
                </div>
              ) : scope === 'personas' ? (
                inv.personas
                  .filter((person) => shownSet.has(person.id))
                  .map((person) => (
                    <PersonaPickRow
                      key={person.id}
                      persona={person}
                      teams={inv.personaTeams.get(person.id) ?? []}
                      selected={picker.isSelected('personas', person.id)}
                      onToggle={() => picker.toggle('personas', person.id)}
                    />
                  ))
              ) : scope === 'teams' ? (
                inv.teams
                  .filter((tm) => shownSet.has(tm.id))
                  .map((tm) => (
                    <TeamPickRow
                      key={tm.id}
                      team={tm}
                      memberCount={inv.teamMemberCount.get(tm.id) ?? 0}
                      kpiCount={inv.teamKpiCount.get(tm.id) ?? 0}
                      offTrackCount={inv.teamOffTrackCount.get(tm.id) ?? 0}
                      selected={picker.isSelected('teams', tm.id)}
                      onToggle={() => picker.toggle('teams', tm.id)}
                    />
                  ))
              ) : (
                inv.credentials
                  .filter((c) => shownSet.has(c.id))
                  .map((c) => (
                    <CredentialRow
                      key={c.id}
                      credential={c}
                      selected={picker.isSelected('credentials', c.id)}
                      onToggle={() => picker.toggle('credentials', c.id)}
                    />
                  ))
              )}
            </div>
          </div>

          <ManifestCart picker={picker} exporting={exporting} onCancel={onClose} />
        </div>
      )}
    </BaseModal>
  );
}
