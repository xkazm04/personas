import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChevronDown, ChevronRight, Plus, Zap, Sparkles } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import type { TriageRule } from '@/lib/bindings/TriageRule';
import { suggestTriageRules, type RuleSuggestion } from './triageRuleSuggestions';
import { useOriginLabel } from './findings/findingOrigins';
import { RuleRow, SuggestionRow } from './TriageRuleRows';
import { TriageRuleForm } from './TriageRuleForm';
import { TONE_CHIP } from './triageTones';
import { PrimarySoftButton } from './PrimarySoftButton';

interface TriageRulesPanelProps {
  projectId: string;
}

export function TriageRulesPanel({ projectId }: TriageRulesPanelProps) {
  const { t, tx } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [runResult, setRunResult] = useState<{ applied: number; ideas_affected: number } | null>(null);

  const rules = useSystemStore((s) => s.triageRules);
  const ideas = useSystemStore((s) => s.ideas);
  const fetchTriageRules = useSystemStore((s) => s.fetchTriageRules);
  const createTriageRule = useSystemStore((s) => s.createTriageRule);
  const updateTriageRule = useSystemStore((s) => s.updateTriageRule);
  const deleteTriageRule = useSystemStore((s) => s.deleteTriageRule);
  const runTriageRules = useSystemStore((s) => s.runTriageRules);
  const originLabel = useOriginLabel();

  useEffect(() => {
    if (projectId) fetchTriageRules(projectId);
  }, [projectId, fetchTriageRules]);

  // Rules implied by the user's own accept/reject history — already-covered
  // patterns are filtered out, so adding one makes its suggestion disappear.
  const suggestions = useMemo(() => suggestTriageRules(ideas, rules), [ideas, rules]);

  const suggestionName = (s: RuleSuggestion): string => {
    const dtr = t.plugins.dev_triage;
    switch (s.kind) {
      case 'reject_heavy': return dtr.suggestion_name_reject_heavy;
      case 'accept_quick': return dtr.suggestion_name_accept_quick;
      case 'reject_risky': return dtr.suggestion_name_reject_risky;
      case 'reject_category': return tx(dtr.suggestion_name_reject_category, { category: s.category ?? '' });
      // B3 — a sensor whose findings keep getting rejected is mis-thresholded.
      case 'reject_origin': return tx(dtr.suggestion_name_reject_origin, {
        origin: originLabel(s.origin ?? ''),
      });
    }
  };

  const handleAddSuggestion = async (s: RuleSuggestion) => {
    await createTriageRule(suggestionName(s), JSON.stringify(s.conditions), s.action, projectId);
  };

  const handleRun = async () => {
    const result = await runTriageRules(projectId);
    setRunResult(result);
    setTimeout(() => setRunResult(null), 5000);
  };

  const handleToggle = async (rule: TriageRule) => {
    await updateTriageRule(rule.id, { enabled: !rule.enabled });
  };

  return (
    <div className="border border-border/20 rounded-modal bg-secondary/20 overflow-hidden">
      {/* A disclosure header, not a Button: a full-width row that opens the panel body. */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        data-testid="triage-rules-toggle"
        className="flex items-center gap-2 w-full px-3 py-2 typo-caption text-foreground transition-colors focus-ring"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Zap className="w-3 h-3" />
        {t.plugins.dev_triage.auto_triage_rules}
        {rules.length > 0 && (
          <span className="ml-auto text-foreground">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/15 pt-2">
          {rules.map(rule => (
            <RuleRow key={rule.id} rule={rule} onToggle={handleToggle} onDelete={deleteTriageRule} />
          ))}

          {/* Suggested rules — mined from the user's accept/reject history */}
          {suggestions.length > 0 && !creating && (
            <div className="space-y-1.5">
              <p className="typo-eyebrow text-primary flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {t.plugins.dev_triage.suggested_rules_label}
              </p>
              {suggestions.map((s) => (
                <SuggestionRow
                  key={`${s.kind}-${s.category ?? ''}`}
                  suggestion={s}
                  name={suggestionName(s)}
                  onAdd={handleAddSuggestion}
                />
              ))}
            </div>
          )}

          {creating ? (
            <TriageRuleForm projectId={projectId} onClose={() => setCreating(false)} />
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" data-testid="triage-rules-new" onClick={() => setCreating(true)} icon={<Plus className="w-3 h-3" />} className="typo-caption">
                {t.plugins.dev_triage.new_rule}
              </Button>
              {rules.length > 0 && (
                <PrimarySoftButton data-testid="triage-rules-run" onClick={() => void handleRun()} icon={<Zap className="w-3 h-3" />}>
                  {t.plugins.dev_triage.run_rules}
                </PrimarySoftButton>
              )}
            </div>
          )}

          {/* The run's outcome: rules that fired are a success. */}
          {runResult && (
            <div className={`px-2.5 py-1.5 typo-caption rounded-interactive border ${TONE_CHIP.success}`}>
              Applied {runResult.applied} rule{runResult.applied !== 1 ? 's' : ''} -- {runResult.ideas_affected} idea{runResult.ideas_affected !== 1 ? 's' : ''} triaged
            </div>
          )}
        </div>
      )}
    </div>
  );
}
