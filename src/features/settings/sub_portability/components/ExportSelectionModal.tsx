import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Download,
  ChevronRight,
  Bot,
  Users,
  Key,
  KeyRound,
  Info,
  Check,
  Minus,
} from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { listPersonas } from '@/api/agents/personas';
import { listTeams } from '@/api/pipeline/teams';
import { listCredentials } from '@/api/vault/credentials';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportableItem {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
}

interface CategoryConfig {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  items: ExportableItem[];
  autoIncluded?: boolean;
  autoIncludedNote?: string;
}

interface ExportSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (personaIds: string[], teamIds: string[], credentialIds: string[], passphrase?: string) => void;
  exporting: boolean;
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

function ExportCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      onClick={onChange}
      className={`w-[18px] h-[18px] rounded-input flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${
        checked || indeterminate
          ? 'bg-emerald-500 border border-emerald-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      {checked && !indeterminate && (
        <div className="animate-fade-slide-in">
          <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
        </div>
      )}
      {indeterminate && (
        <div className="animate-fade-slide-in">
          <Minus className="w-3 h-3 text-foreground" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

function CategorySection({
  config,
  selectedIds,
  onToggleAll,
  onToggleItem,
}: {
  config: CategoryConfig;
  selectedIds: Set<string>;
  onToggleAll: () => void;
  onToggleItem: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (expanded && contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, config.items.length]);

  const allSelected = config.items.length > 0 && config.items.every((i) => selectedIds.has(i.id));
  const someSelected = config.items.some((i) => selectedIds.has(i.id));
  const indeterminate = someSelected && !allSelected;
  const count = config.items.filter((i) => selectedIds.has(i.id)).length;

  if (config.items.length === 0) return null;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/5 overflow-hidden">
      {/* Category header */}
      <div className="flex items-center gap-4 px-5 py-4">
        <ExportCheckbox
          checked={allSelected}
          indeterminate={indeterminate}
          onChange={onToggleAll}
        />

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 min-w-0 group"
        >
          <div className={`w-8 h-8 rounded-card flex items-center justify-center ${config.color}`}>
            {config.icon}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-semibold text-foreground/90">{config.label}</div>
            <div className="text-xs text-muted-foreground/60">
              {count} of {config.items.length} selected
            </div>
          </div>
          <div className="text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
            <ChevronRight
              className={`w-4 h-4 transition-transform duration-250 ease-out ${
                expanded ? 'rotate-90' : 'rotate-0'
              }`}
            />
          </div>
        </button>
      </div>

      {/* Animated item list */}
      <div
        className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
        style={{
          maxHeight: expanded ? contentHeight : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <div ref={contentRef} className="border-t border-primary/8 px-5 py-3 space-y-1">
          {config.items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-4 px-3 py-2.5 rounded-card hover:bg-secondary/15
                cursor-pointer transition-colors"
            >
              <ExportCheckbox
                checked={selectedIds.has(item.id)}
                onChange={() => onToggleItem(item.id)}
              />
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {item.icon && (
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                )}
                <div className="min-w-0">
                  <div className="text-sm text-foreground/85 truncate">{item.name}</div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground/50 truncate">
                      {item.description}
                    </div>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function ExportSelectionModal({
  isOpen,
  onClose,
  onExport,
  exporting,
}: ExportSelectionModalProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [teams, setTeams] = useState<PersonaTeam[]>([]);
  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [selectedCredentialIds, setSelectedCredentialIds] = useState<Set<string>>(new Set());
  const [exportPassphrase, setExportPassphrase] = useState('');
  const { t, tx } = useTranslation();
  const s = t.settings.portability;

  // Load data when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setExportPassphrase('');
    Promise.all([listPersonas(), listTeams(), listCredentials()])
      .then(([p, t, c]) => {
        setPersonas(p);
        setTeams(t);
        setCredentials(c);
        // Select all by default
        setSelectedPersonaIds(new Set(p.map((x) => x.id)));
        setSelectedTeamIds(new Set(t.map((x) => x.id)));
        setSelectedCredentialIds(new Set(c.map((x) => x.id)));
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Build category configs
  const categories: CategoryConfig[] = useMemo(
    () => [
      {
        key: 'personas',
        label: 'Personas',
        icon: <Bot className="w-4 h-4" />,
        color: 'bg-violet-500/15 text-violet-400',
        items: personas.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          icon: p.icon,
          color: p.color,
        })),
      },
      {
        key: 'teams',
        label: 'Teams',
        icon: <Users className="w-4 h-4" />,
        color: 'bg-blue-500/15 text-blue-400',
        items: teams.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          icon: t.icon,
          color: t.color,
        })),
      },
      {
        key: 'credentials',
        label: 'Credentials',
        icon: <Key className="w-4 h-4" />,
        color: 'bg-amber-500/15 text-amber-400',
        items: credentials.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.service_type,
        })),
      },
    ],
    [personas, teams, credentials],
  );

  // Selection helpers
  const stateMap: Record<string, [Set<string>, React.Dispatch<React.SetStateAction<Set<string>>>]> = {
    personas: [selectedPersonaIds, setSelectedPersonaIds],
    teams: [selectedTeamIds, setSelectedTeamIds],
    credentials: [selectedCredentialIds, setSelectedCredentialIds],
  };

  const toggleAll = useCallback(
    (key: string, items: ExportableItem[]) => {
      const [selected, setSelected] = stateMap[key]!;
      const allSelected = items.every((i) => selected.has(i.id));
      if (allSelected) {
        setSelected(new Set());
      } else {
        setSelected(new Set(items.map((i) => i.id)));
      }
    },
    [selectedPersonaIds, selectedTeamIds, selectedCredentialIds],
  );

  const toggleItem = useCallback(
    (key: string, id: string) => {
      const [selected, setSelected] = stateMap[key]!;
      const next = new Set(selected);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setSelected(next);
    },
    [selectedPersonaIds, selectedTeamIds, selectedCredentialIds],
  );

  // Global select/deselect all
  const totalItems = personas.length + teams.length + credentials.length;
  const totalSelected = selectedPersonaIds.size + selectedTeamIds.size + selectedCredentialIds.size;
  const allGlobalSelected = totalItems > 0 && totalSelected === totalItems;
  const someGlobalSelected = totalSelected > 0;

  const toggleGlobalAll = useCallback(() => {
    if (allGlobalSelected) {
      setSelectedPersonaIds(new Set());
      setSelectedTeamIds(new Set());
      setSelectedCredentialIds(new Set());
    } else {
      setSelectedPersonaIds(new Set(personas.map((p) => p.id)));
      setSelectedTeamIds(new Set(teams.map((t) => t.id)));
      setSelectedCredentialIds(new Set(credentials.map((c) => c.id)));
    }
  }, [allGlobalSelected, personas, teams, credentials]);

  const handleExport = () => {
    onExport(
      Array.from(selectedPersonaIds),
      Array.from(selectedTeamIds),
      Array.from(selectedCredentialIds),
      exportPassphrase.length >= 8 ? exportPassphrase : undefined,
    );
  };

  const passphraseValid = exportPassphrase.length === 0 || exportPassphrase.length >= 8;

  const isFullExport =
    totalItems > 0 &&
    selectedPersonaIds.size === personas.length &&
    selectedTeamIds.size === teams.length &&
    selectedCredentialIds.size === credentials.length;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="export-selection-title" size="lg">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-primary/10">
        <div>
          <h2 id="export-selection-title" className="text-lg font-semibold text-foreground/90">
            {s.export_title}
          </h2>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            {s.export_subtitle}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Button>
      </div>

      {/* Body */}
      <div className="px-6 py-5 overflow-y-auto max-h-[60vh] space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground/60">
            <LoadingSpinner />
            <span className="text-sm">{s.loading_data}</span>
          </div>
        ) : (
          <>
            {/* Global select all */}
            <div className="flex items-center gap-4 px-1">
              <ExportCheckbox
                checked={allGlobalSelected}
                indeterminate={someGlobalSelected && !allGlobalSelected}
                onChange={toggleGlobalAll}
              />
              <span className="text-sm font-medium text-foreground/80">
                {allGlobalSelected ? s.deselect_all : s.select_all}
              </span>
              <span className="text-xs text-muted-foreground/50 ml-auto">
                {tx(s.items_selected, { selected: totalSelected, total: totalItems })}
              </span>
            </div>

            {/* Category sections */}
            <div className="space-y-3">
              {categories.map((cat) => (
                <CategorySection
                  key={cat.key}
                  config={cat}
                  selectedIds={stateMap[cat.key]![0]}
                  onToggleAll={() => toggleAll(cat.key, cat.items)}
                  onToggleItem={(id) => toggleItem(cat.key, id)}
                />
              ))}
            </div>

            {/* Passphrase for credential encryption */}
            <div className="rounded-modal border border-primary/10 bg-secondary/5 px-5 py-4 space-y-2.5">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                <KeyRound className="w-4 h-4 text-amber-400/70" />
                {s.encrypt_passphrase}
                <span className="text-xs font-normal text-muted-foreground/50 ml-1">{s.optional}</span>
              </label>
              <input
                type="password"
                placeholder={s.passphrase_placeholder}
                value={exportPassphrase}
                onChange={(e) => setExportPassphrase(e.target.value)}
                className={`px-3 py-2 rounded-card border bg-secondary/20 text-sm
                  text-foreground/90 placeholder:text-muted-foreground/40 outline-none w-full
                  ${!passphraseValid
                    ? 'border-red-500/30 focus-visible:border-red-500/50'
                    : 'border-primary/10 focus-visible:border-amber-500/30'
                  }`}
              />
              {!passphraseValid && (
                <p className="text-xs text-red-400/80">{s.passphrase_too_short}</p>
              )}
              <p className="text-xs text-muted-foreground/50">
                {s.passphrase_note}
              </p>
            </div>

            {/* Auto-included note */}
            <div className="flex items-start gap-2.5 px-2 py-3 rounded-card bg-blue-500/5 border border-blue-500/10">
              <Info className="w-4 h-4 text-blue-400/70 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                {s.auto_included_note}{!exportPassphrase ? s.no_passphrase_note : ''}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-primary/10 bg-secondary/5">
        <button
          onClick={onClose}
          disabled={exporting}
          className="px-4 py-2.5 rounded-modal text-sm font-medium text-muted-foreground/70
            hover:text-foreground/80 transition-colors disabled:opacity-50"
        >
          {s.cancel}
        </button>
        <button
          onClick={handleExport}
          disabled={exporting || totalSelected === 0 || !passphraseValid}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-modal text-sm font-medium
            bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20
            transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <LoadingSpinner />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {exporting
            ? s.exporting
            : isFullExport
              ? s.export_all
              : tx(totalSelected !== 1 ? s.export_items_plural : s.export_items, { count: totalSelected })}
        </button>
      </div>
    </BaseModal>
  );
}
