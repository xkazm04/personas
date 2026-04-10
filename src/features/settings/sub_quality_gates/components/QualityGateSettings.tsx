import { useCallback, useEffect, useState } from 'react';
import { Shield, Brain, FileSearch, RotateCcw, Ban, Tag, AlertTriangle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getQualityGateConfig, resetQualityGateConfig } from '@/api/system/settings';
import type { QualityGateConfig } from '@/lib/bindings/QualityGateConfig';
import type { QualityGateRule } from '@/lib/bindings/QualityGateRule';
import type { FilterAction } from '@/lib/bindings/FilterAction';

const ACTION_LABELS: Record<FilterAction, { label: string; color: string; icon: typeof Ban }> = {
  reject: { label: 'Reject', color: 'text-red-400', icon: Ban },
  tag:    { label: 'Tag',    color: 'text-amber-400', icon: Tag },
  warn:   { label: 'Warn',   color: 'text-blue-400', icon: AlertTriangle },
};

function RuleRow({ rule }: { rule: QualityGateRule }) {
  const action = ACTION_LABELS[rule.action];
  const ActionIcon = action.icon;
  return (
    <div className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-white/[0.03] transition-colors">
      <ActionIcon size={13} className={`shrink-0 ${action.color}`} />
      <code className="text-xs font-mono text-white/70 bg-white/[0.05] px-1.5 py-0.5 rounded min-w-0 truncate">
        {rule.pattern}
      </code>
      <span className="text-[11px] text-white/40 shrink-0 ml-auto">
        {rule.label}
      </span>
      <span className={`text-[10px] font-medium uppercase ${action.color} shrink-0`}>
        {action.label}
      </span>
    </div>
  );
}

function RuleSection({ title, icon: Icon, description, rules, categories }: {
  title: string;
  icon: typeof Brain;
  description: string;
  rules: QualityGateRule[];
  categories?: string[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-white/50" />
        <h3 className="text-sm font-medium text-white/80">{title}</h3>
        <span className="text-[10px] text-white/30 bg-white/[0.05] px-1.5 py-0.5 rounded">
          {rules.length} rule{rules.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-[11px] text-white/40 pl-[22px]">{description}</p>

      {categories && categories.length > 0 && (
        <div className="pl-[22px] space-y-1">
          <span className="text-[10px] text-white/30 uppercase tracking-wide">Rejected categories</span>
          <div className="flex gap-1.5 flex-wrap">
            {categories.map((cat) => (
              <span key={cat} className="text-[10px] font-mono text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="pl-[22px] space-y-0.5">
        {rules.map((rule, i) => (
          <RuleRow key={`${rule.pattern}-${i}`} rule={rule} />
        ))}
      </div>
    </div>
  );
}

export default function QualityGateSettings() {
  const [config, setConfig] = useState<QualityGateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getQualityGateConfig();
      setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleReset = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    try {
      const cfg = await resetQualityGateConfig();
      setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [confirmReset]);

  const totalRules = config
    ? config.memoryRules.length + config.reviewRules.length + config.memoryRejectCategories.length
    : 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-violet-400" />}
        title="Quality Gates"
        subtitle={
          loading ? 'Loading...'
            : error ? 'Error loading config'
            : `${totalRules} active filter rules`
        }
      />
      <ContentBody>
        {error && (
          <div className="text-xs text-red-400 bg-red-400/10 rounded p-2 mb-3">
            {error}
          </div>
        )}

        {loading && !config && (
          <div className="text-xs text-white/40 py-8 text-center">Loading quality gate configuration...</div>
        )}

        {config && (
          <div className="space-y-6">
            <div className="text-[11px] text-white/40 bg-white/[0.03] rounded p-3 leading-relaxed">
              Quality gates filter AI-generated memories and reviews during execution dispatch.
              Patterns are matched as substrings against the combined title and content of each
              submission. When a pattern matches, the configured action is applied. These rules
              prevent operational noise (credential errors, stack traces, empty workspace reports)
              from polluting your knowledge base.
            </div>

            <RuleSection
              title="Memory Filters"
              icon={Brain}
              description="Applied to AgentMemory submissions. Blocks operational failures and credential leaks from being stored as persona memories."
              rules={config.memoryRules}
              categories={config.memoryRejectCategories}
            />

            <div className="border-t border-white/[0.06]" />

            <RuleSection
              title="Review Filters"
              icon={FileSearch}
              description="Applied to ManualReview submissions. Filters infrastructure errors so only genuine business decisions reach the review queue."
              rules={config.reviewRules}
            />

            <div className="border-t border-white/[0.06]" />

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-white/30">
                Rules are loaded from the database on each dispatch. Changes take effect immediately.
              </span>
              <button
                onClick={handleReset}
                className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                  confirmReset
                    ? 'text-red-400 hover:text-red-300'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {confirmReset ? (
                  <>
                    <AlertTriangle size={12} />
                    Confirm reset?
                  </>
                ) : (
                  <>
                    <RotateCcw size={12} />
                    Reset to defaults
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
