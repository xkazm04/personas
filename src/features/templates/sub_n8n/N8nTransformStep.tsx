import {
  Sparkles,
  User,
  BookOpen,
  Wrench,
  Code,
  AlertTriangle,
  Plus,
  X,
} from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/tauriApi';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import CliOutputPanel from '@/features/shared/components/CliOutputPanel';
import {
  type EditableStructuredPrompt,
  toEditableStructuredPrompt,
  fromEditableStructuredPrompt,
  normalizeDraftFromUnknown,
} from '@/features/templates/sub_n8n/n8nTypes';

interface N8nTransformStepProps {
  parsedResult: DesignAnalysisResult;
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;
  showRawJson: boolean;
  adjustmentRequest: string;
  transforming: boolean;
  confirming: boolean;
  created: boolean;
  transformPhase: CliRunPhase;
  currentTransformId: string | null;
  transformLines: string[];
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  setDraft: (draft: N8nPersonaDraft | null) => void;
  setDraftJson: (json: string) => void;
  setDraftJsonError: (error: string | null) => void;
  setShowRawJson: (show: boolean) => void;
  setAdjustmentRequest: (request: string) => void;
}

export function N8nTransformStep({
  parsedResult,
  draft,
  draftJson,
  draftJsonError,
  showRawJson,
  adjustmentRequest,
  transforming,
  confirming,
  created,
  transformPhase,
  currentTransformId,
  transformLines,
  updateDraft,
  setDraft,
  setDraftJson,
  setDraftJsonError,
  setShowRawJson,
  setAdjustmentRequest,
}: N8nTransformStepProps) {
  const editableStructuredPrompt: EditableStructuredPrompt | null = draft
    ? toEditableStructuredPrompt(draft.structured_prompt)
    : null;

  return (
    <div className="p-4 space-y-3">
      <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
        <Sparkles className="w-3 h-3" />
        Claude Code CLI Transformation
      </h4>
      <p className="text-xs text-muted-foreground/50">
        Static parsing is complete. Claude CLI generates a draft persona. Edit properties below,
        request adjustments, then confirm save. You can leave this tab while processing and resume when done.
      </p>

      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
          Adjustment Request (chat-style)
        </label>
        <textarea
          value={adjustmentRequest}
          onChange={(e) => setAdjustmentRequest(e.target.value)}
          placeholder="Example: Make error handling stricter and add fallback behavior for connector outages"
          className="w-full h-20 p-2 rounded-lg border border-primary/15 bg-background/40 text-xs text-foreground/75 resize-y"
          disabled={transforming || confirming}
        />
      </div>

      {(transformLines.length > 0 || transformPhase !== 'idle') && (
        <CliOutputPanel
          title="Claude CLI Output"
          phase={transformPhase}
          runId={currentTransformId}
          lines={transformLines}
        />
      )}

      {draft && (
        <div className="mt-3 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
              Transformation Draft (editable persona properties)
            </label>
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              disabled={transforming || confirming || created}
              className="px-2.5 py-1 text-[11px] rounded-lg border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 disabled:opacity-50"
            >
              {showRawJson ? 'Hide JSON' : 'Advanced JSON'}
            </button>
          </div>

          {parsedResult && (
            <div className="bg-secondary/30 border border-primary/10 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground/70 tracking-wide">
                <Sparkles className="w-4 h-4 text-violet-400" />
                Transformation Baseline
              </div>
              <p className="text-xs text-muted-foreground/55">{parsedResult.summary}</p>
              <div className="flex flex-wrap gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/45">
                <span className="px-2 py-1 rounded bg-secondary/60 border border-primary/10">Tools {parsedResult.suggested_tools.length}</span>
                <span className="px-2 py-1 rounded bg-secondary/60 border border-primary/10">Triggers {parsedResult.suggested_triggers.length}</span>
                <span className="px-2 py-1 rounded bg-secondary/60 border border-primary/10">Connectors {parsedResult.suggested_connectors?.length ?? 0}</span>
              </div>
            </div>
          )}

          {/* Identity Section */}
          <div className="space-y-3 bg-secondary/20 border border-primary/10 rounded-2xl p-3.5">
            <h5 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
              <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
              <User className="w-3.5 h-3.5" />
              Identity
            </h5>
            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1">Name</label>
              <input
                type="text"
                value={draft.name ?? ''}
                onChange={(e) => updateDraft((curr) => ({ ...curr, name: e.target.value.trim() || null }))}
                disabled={transforming || confirming || created}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1">Description</label>
              <textarea
                value={draft.description ?? ''}
                onChange={(e) =>
                  updateDraft((curr) => ({
                    ...curr,
                    description: e.target.value.trim() ? e.target.value : null,
                  }))
                }
                disabled={transforming || confirming || created}
                rows={2}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1">System Prompt</label>
              <textarea
                value={draft.system_prompt}
                onChange={(e) => updateDraft((curr) => ({ ...curr, system_prompt: e.target.value }))}
                disabled={transforming || confirming || created}
                rows={4}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1">Design Context</label>
              <textarea
                value={draft.design_context ?? ''}
                onChange={(e) =>
                  updateDraft((curr) => ({
                    ...curr,
                    design_context: e.target.value.trim() ? e.target.value : null,
                  }))
                }
                disabled={transforming || confirming || created}
                rows={2}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
              />
            </div>
          </div>

          {/* Structured Prompt Section */}
          {editableStructuredPrompt && (
            <div className="space-y-3 bg-secondary/20 border border-primary/10 rounded-2xl p-3.5">
              <h5 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
                <BookOpen className="w-3.5 h-3.5" />
                Structured Prompt
              </h5>

              {([
                ['identity', 'Identity', User],
                ['instructions', 'Instructions', BookOpen],
                ['toolGuidance', 'Tool Guidance', Wrench],
                ['examples', 'Examples', Code],
                ['errorHandling', 'Error Handling', AlertTriangle],
              ] as const).map(([field, label, Icon]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-foreground/60 mb-1 flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </label>
                  <textarea
                    value={editableStructuredPrompt[field]}
                    onChange={(e) => {
                      const next = { ...editableStructuredPrompt, [field]: e.target.value };
                      updateDraft((curr) => ({
                        ...curr,
                        structured_prompt: fromEditableStructuredPrompt(next),
                      }));
                    }}
                    disabled={transforming || confirming || created}
                    rows={field === 'examples' ? 4 : 3}
                    className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
                  />
                </div>
              ))}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground/60">Custom Sections</label>
                  <button
                    onClick={() => {
                      const next = {
                        ...editableStructuredPrompt,
                        customSections: [
                          ...editableStructuredPrompt.customSections,
                          { key: '', label: 'New Section', content: '' },
                        ],
                      };
                      updateDraft((curr) => ({
                        ...curr,
                        structured_prompt: fromEditableStructuredPrompt(next),
                      }));
                    }}
                    disabled={transforming || confirming || created}
                    className="px-2 py-1 text-[11px] rounded-lg border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add Section
                  </button>
                </div>

                {editableStructuredPrompt.customSections.map((section, index) => (
                  <div key={`${index}-${section.key}-${section.label}`} className="p-2 rounded-lg border border-primary/10 bg-background/30 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={section.key}
                        placeholder="key"
                        onChange={(e) => {
                          const nextSections = editableStructuredPrompt.customSections.map((entry, i) =>
                            i === index ? { ...entry, key: e.target.value } : entry,
                          );
                          const next = { ...editableStructuredPrompt, customSections: nextSections };
                          updateDraft((curr) => ({
                            ...curr,
                            structured_prompt: fromEditableStructuredPrompt(next),
                          }));
                        }}
                        disabled={transforming || confirming || created}
                        className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={section.label}
                          placeholder="label"
                          onChange={(e) => {
                            const nextSections = editableStructuredPrompt.customSections.map((entry, i) =>
                              i === index ? { ...entry, label: e.target.value } : entry,
                            );
                            const next = { ...editableStructuredPrompt, customSections: nextSections };
                            updateDraft((curr) => ({
                              ...curr,
                              structured_prompt: fromEditableStructuredPrompt(next),
                            }));
                          }}
                          disabled={transforming || confirming || created}
                          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        />
                        <button
                          onClick={() => {
                            const next = {
                              ...editableStructuredPrompt,
                              customSections: editableStructuredPrompt.customSections.filter(
                                (_, i) => i !== index,
                              ),
                            };
                            updateDraft((curr) => ({
                              ...curr,
                              structured_prompt: fromEditableStructuredPrompt(next),
                            }));
                          }}
                          disabled={transforming || confirming || created}
                          className="px-2 rounded-lg border border-primary/15 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          title="Remove section"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={section.content}
                      onChange={(e) => {
                        const nextSections = editableStructuredPrompt.customSections.map((entry, i) =>
                          i === index ? { ...entry, content: e.target.value } : entry,
                        );
                        const next = { ...editableStructuredPrompt, customSections: nextSections };
                        updateDraft((curr) => ({
                          ...curr,
                          structured_prompt: fromEditableStructuredPrompt(next),
                        }));
                      }}
                      disabled={transforming || confirming || created}
                      rows={3}
                      placeholder="Section content"
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Runtime Settings Section */}
          <div className="space-y-3 bg-secondary/20 border border-primary/10 rounded-2xl p-3.5">
            <h5 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
              <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
              Runtime Settings
            </h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-foreground/60 mb-1">Icon</label>
                <input
                  type="text"
                  value={draft.icon ?? ''}
                  onChange={(e) => updateDraft((curr) => ({ ...curr, icon: e.target.value.trim() || null }))}
                  disabled={transforming || confirming || created}
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground/60 mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.color ?? '#8b5cf6'}
                    onChange={(e) => updateDraft((curr) => ({ ...curr, color: e.target.value }))}
                    disabled={transforming || confirming || created}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-primary/15 bg-transparent"
                  />
                  <input
                    type="text"
                    value={draft.color ?? ''}
                    onChange={(e) => updateDraft((curr) => ({ ...curr, color: e.target.value.trim() || null }))}
                    disabled={transforming || confirming || created}
                    className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-foreground/60 mb-1">Max Budget (USD)</label>
                <input
                  type="number"
                  value={draft.max_budget_usd ?? ''}
                  onChange={(e) =>
                    updateDraft((curr) => ({
                      ...curr,
                      max_budget_usd: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  min={0}
                  step={0.01}
                  disabled={transforming || confirming || created}
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground/60 mb-1">Max Turns</label>
                <input
                  type="number"
                  value={draft.max_turns ?? ''}
                  onChange={(e) =>
                    updateDraft((curr) => ({
                      ...curr,
                      max_turns:
                        e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
                    }))
                  }
                  min={1}
                  step={1}
                  disabled={transforming || confirming || created}
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1">Model Profile (JSON string)</label>
              <input
                type="text"
                value={draft.model_profile ?? ''}
                onChange={(e) =>
                  updateDraft((curr) => ({
                    ...curr,
                    model_profile: e.target.value.trim() ? e.target.value : null,
                  }))
                }
                disabled={transforming || confirming || created}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>

          {/* Raw JSON Editor */}
          {showRawJson && (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                Advanced JSON Editor
              </label>
              <textarea
                value={draftJson}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftJson(next);
                  try {
                    const parsed = normalizeDraftFromUnknown(JSON.parse(next));
                    if (!parsed) {
                      setDraftJsonError('JSON does not match expected persona draft shape.');
                      return;
                    }
                    setDraft(parsed);
                    setDraftJsonError(null);
                  } catch {
                    setDraftJsonError('Draft JSON is invalid.');
                  }
                }}
                className="w-full h-64 p-3 rounded-lg border border-primary/15 bg-background/40 text-[11px] text-foreground/75 font-mono leading-relaxed resize-y"
                disabled={transforming || confirming || created}
              />
              {draftJsonError && <p className="text-xs text-red-400/80">{draftJsonError}</p>}
            </div>
          )}

          <p className="text-xs text-amber-300/75">
            This draft is not saved yet. Persona is created only after you click confirm.
          </p>
        </div>
      )}
    </div>
  );
}
