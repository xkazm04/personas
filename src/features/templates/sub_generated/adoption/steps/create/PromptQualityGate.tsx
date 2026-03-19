/**
 * Prompt Quality Gate — evaluates draft persona quality before creation.
 * Scores dimensions and flags weak areas with actionable recommendations.
 */
import { useMemo } from 'react';
import { AlertTriangle, XCircle, TrendingUp } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

interface DimensionScore {
  key: string;
  label: string;
  score: number; // 0-100
  status: 'good' | 'warning' | 'weak';
  recommendation?: string;
}

function scoreDimension(key: string, label: string, content: string | undefined, minLength: number, recommendations: string): DimensionScore {
  const len = content?.trim().length ?? 0;
  if (len === 0) return { key, label, score: 0, status: 'weak', recommendation: `Missing ${label.toLowerCase()} section. ${recommendations}` };
  if (len < minLength * 0.3) return { key, label, score: 25, status: 'weak', recommendation: `${label} is too brief (${len} chars). ${recommendations}` };
  if (len < minLength * 0.7) return { key, label, score: 55, status: 'warning', recommendation: `${label} could be more detailed. ${recommendations}` };
  if (len < minLength) return { key, label, score: 75, status: 'warning' };
  return { key, label, score: 95, status: 'good' };
}

function evaluateDraft(draft: N8nPersonaDraft): { dimensions: DimensionScore[]; overallScore: number; canCreate: boolean } {
  const sp = draft.structured_prompt as Record<string, unknown> | null;
  const identity = sp?.identity as string | undefined;
  const instructions = sp?.instructions as string | undefined;
  const toolGuidance = sp?.toolGuidance as string | undefined;
  const examples = sp?.examples as string | undefined;
  const errorHandling = sp?.errorHandling as string | undefined;
  const customSections = sp?.customSections as Array<{ title: string; content: string }> | undefined;

  const dimensions: DimensionScore[] = [
    scoreDimension('identity', 'Identity', identity, 200, 'Should describe the persona\'s role, expertise, and perspective.'),
    scoreDimension('instructions', 'Instructions', instructions, 500, 'Should include step-by-step workflow with protocol messages.'),
    scoreDimension('toolGuidance', 'Tool Guidance', toolGuidance, 200, 'Should document API endpoints, auth patterns, and tool usage.'),
    scoreDimension('examples', 'Examples', examples, 150, 'Should show concrete input/output scenarios.'),
    scoreDimension('errorHandling', 'Error Handling', errorHandling, 100, 'Should define failure recovery and escalation paths.'),
    scoreDimension('systemPrompt', 'System Prompt', draft.system_prompt, 500, 'Core prompt should be comprehensive and actionable.'),
  ];

  // Check for protocol patterns
  const allText = [draft.system_prompt, identity, instructions, toolGuidance, errorHandling].filter(Boolean).join(' ');
  const hasManualReview = allText.includes('manual_review');
  const hasMemory = allText.includes('agent_memory');
  const hasUserMessage = allText.includes('user_message');

  if (!hasManualReview && !hasMemory && !hasUserMessage) {
    dimensions.push({
      key: 'protocols',
      label: 'Protocol Integration',
      score: 20,
      status: 'weak',
      recommendation: 'No protocol messages found. Add manual_review, agent_memory, or user_message patterns.',
    });
  } else {
    const protocolCount = [hasManualReview, hasMemory, hasUserMessage].filter(Boolean).length;
    dimensions.push({
      key: 'protocols',
      label: 'Protocol Integration',
      score: protocolCount >= 2 ? 90 : 60,
      status: protocolCount >= 2 ? 'good' : 'warning',
      recommendation: protocolCount < 2 ? 'Consider adding more protocol patterns for richer behavior.' : undefined,
    });
  }

  // Check for custom sections (human-in-the-loop, memory strategy)
  const hasHitlSection = customSections?.some(s =>
    s.title?.toLowerCase().includes('human') || s.title?.toLowerCase().includes('approval')
  );
  const hasMemorySection = customSections?.some(s =>
    s.title?.toLowerCase().includes('memory') || s.title?.toLowerCase().includes('learning')
  );

  if (!hasHitlSection && !hasMemorySection) {
    dimensions.push({
      key: 'customSections',
      label: 'Custom Sections',
      score: 30,
      status: 'warning',
      recommendation: 'Missing Human-in-the-Loop or Memory Strategy custom sections.',
    });
  }

  const overallScore = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
  const weakCount = dimensions.filter(d => d.status === 'weak').length;
  const canCreate = weakCount <= 1 && overallScore >= 30;

  return { dimensions, overallScore, canCreate };
}

export function PromptQualityGate({ draft }: { draft: N8nPersonaDraft }) {
  const { dimensions, overallScore, canCreate } = useMemo(() => evaluateDraft(draft), [draft]);

  const weakDimensions = dimensions.filter(d => d.status === 'weak');
  const warningDimensions = dimensions.filter(d => d.status === 'warning');

  if (overallScore >= 80 && weakDimensions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
        <TrendingUp className="w-4 h-4 text-emerald-400/70 flex-shrink-0" />
        <span className="text-sm text-emerald-300/70">
          Prompt quality: <strong>{overallScore}</strong>/100 — Ready to create
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Score header */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
        !canCreate ? 'bg-red-500/5 border-red-500/15' :
        weakDimensions.length > 0 ? 'bg-amber-500/5 border-amber-500/15' :
        'bg-emerald-500/5 border-emerald-500/15'
      }`}>
        {!canCreate ? (
          <XCircle className="w-4 h-4 text-red-400/70 flex-shrink-0" />
        ) : weakDimensions.length > 0 ? (
          <AlertTriangle className="w-4 h-4 text-amber-400/70 flex-shrink-0" />
        ) : (
          <TrendingUp className="w-4 h-4 text-emerald-400/70 flex-shrink-0" />
        )}
        <span className={`text-sm ${!canCreate ? 'text-red-300/70' : weakDimensions.length > 0 ? 'text-amber-300/70' : 'text-emerald-300/70'}`}>
          Prompt quality: <strong>{overallScore}</strong>/100
          {!canCreate && ' — Improve weak areas before creating'}
          {canCreate && weakDimensions.length > 0 && ' — Usable but could be improved'}
        </span>
      </div>

      {/* Dimension breakdown for weak/warning items */}
      {(weakDimensions.length > 0 || warningDimensions.length > 0) && (
        <div className="space-y-1.5">
          {weakDimensions.map(d => (
            <div key={d.key} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-red-500/5 border border-red-500/10">
              <XCircle className="w-3.5 h-3.5 text-red-400/60 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-red-300/70">{d.label}</span>
                {d.recommendation && (
                  <p className="text-xs text-red-300/50 mt-0.5">{d.recommendation}</p>
                )}
              </div>
            </div>
          ))}
          {warningDimensions.map(d => (
            <div key={d.key} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-amber-300/70">{d.label}</span>
                {d.recommendation && (
                  <p className="text-xs text-amber-300/50 mt-0.5">{d.recommendation}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
