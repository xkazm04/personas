import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  ScrollText,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionListDesignDecisions,
  type CompanionDesignDecision,
} from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Footer chip on the persona editor showing Athena's design decisions
 * for the currently-open persona. Collapsed by default to avoid
 * crowding the editor; click to expand the recent decisions inline.
 * "Open full audit" link routes the user to the Companion plugin's
 * Decisions sub-tab pre-filtered to this persona.
 *
 * Renders nothing when there are no decisions logged for this persona.
 * That's the common case for personas built before the design-decision
 * persistence shipped — silent rather than cluttering with "no
 * decisions yet" empty state on every editor mount.
 */
export function PersonaDecisionsFooter({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const [decisions, setDecisions] = useState<CompanionDesignDecision[] | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!personaId) {
      setDecisions(null);
      return;
    }
    let cancelled = false;
    companionListDesignDecisions(personaId, 20)
      .then((rows) => {
        if (cancelled) return;
        setDecisions(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDecisions([]);
        silentCatch('companion_list_design_decisions:persona_footer')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  if (decisions === null) return null; // initial fetch in flight
  if (decisions.length === 0) return null; // common silent case

  const Chevron = open ? ChevronDown : ChevronRight;
  const visible = open ? decisions : decisions.slice(0, 0);

  const handleOpenFullAudit = () => {
    const sys = useSystemStore.getState();
    sys.setSidebarSection('plugins');
    sys.setPluginTab('companion');
    sys.setCompanionPluginTab('decisions');
  };

  return (
    <div
      className="border-t border-foreground/10 bg-secondary/30 px-6 py-2"
      data-testid="persona-decisions-footer"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground/90 rounded-interactive"
          aria-expanded={open}
        >
          <Chevron className="w-3 h-3" />
          <ScrollText className="w-3 h-3 text-fuchsia-400/85" />
          <span>
            {decisions.length === 1
              ? t.agents.persona_decisions_footer_one
              : t.agents.persona_decisions_footer_many.replace(
                  '{count}',
                  String(decisions.length),
                )}
          </span>
        </button>
        <button
          type="button"
          onClick={handleOpenFullAudit}
          className="ml-auto inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground/80 rounded-interactive"
          title={t.agents.persona_decisions_footer_open_audit}
        >
          <ExternalLink className="w-3 h-3" />
          <span>{t.agents.persona_decisions_footer_open_audit}</span>
        </button>
      </div>
      {open && (
        <ol className="mt-2 space-y-1.5 pl-5 border-l border-fuchsia-500/20">
          {visible.map((d) => (
            <li key={d.id} className="space-y-0.5">
              <div className="flex items-baseline gap-1.5 typo-caption text-foreground/85">
                <span className="font-medium">{d.label}</span>
                <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
                <span>{d.choice}</span>
              </div>
              <div className="flex items-baseline gap-1.5 typo-caption text-foreground pl-1">
                <GitBranch className="w-3 h-3 text-foreground shrink-0" />
                <span className="leading-snug">{d.rationale}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
