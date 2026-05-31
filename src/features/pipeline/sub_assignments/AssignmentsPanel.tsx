import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Play, XCircle, ListChecks, Trash2, CircleDot, CircleCheck, CircleX, Loader2, CircleDashed, CircleSlash, Edit3, UserCog, SkipForward, Sparkles, BookMarked } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useAgentStore } from '@/stores/agentStore';
import type { Persona } from '@/lib/bindings/Persona';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import type { CreateTeamAssignmentInput } from '@/lib/bindings/CreateTeamAssignmentInput';
import { decomposeTeamAssignmentGoal } from '@/api/pipeline/assignments';
import * as devApi from '@/api/devTools/devTools';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { useAssignmentProgressListener } from './useAssignmentProgressListener';
import { Slider } from '@/features/shared/components/forms/Slider';

interface AssignmentsPanelProps {
  teamId: string;
  teamMemberPersonaIds: string[];
  onClose: () => void;
}

interface ComposerStepDraft {
  id: string; // local UI id only
  title: string;
  description: string;
  personaId: string | null;
  useCaseId: string | null;
}

const MAX_PARALLEL_MIN = 1;
const MAX_PARALLEL_MAX = 8;

export default function AssignmentsPanel({ teamId, teamMemberPersonaIds, onClose }: AssignmentsPanelProps) {
  const { t } = useTranslation();
  const a = t.pipeline.assignments;
  const assignments = usePipelineStore((s) => s.assignmentsByTeam[teamId] ?? []);
  const fetchTeamAssignments = usePipelineStore((s) => s.fetchTeamAssignments);
  const createAssignment = usePipelineStore((s) => s.createTeamAssignment);
  const startAssignment = usePipelineStore((s) => s.startAssignment);
  const abortAssignment = usePipelineStore((s) => s.abortAssignment);
  const deleteAssignment = usePipelineStore((s) => s.deleteAssignment);
  const templates = usePipelineStore((s) => s.assignmentTemplatesByTeam[teamId] ?? []);
  const fetchTemplates = usePipelineStore((s) => s.fetchAssignmentTemplates);
  const saveTemplate = usePipelineStore((s) => s.saveAssignmentTemplate);
  const deleteTemplate = usePipelineStore((s) => s.deleteAssignmentTemplate);
  const instantiateTemplate = usePipelineStore((s) => s.instantiateTemplate);

  const personas = useAgentStore((s) => s.personas) as Persona[];
  const teamPersonas = useMemo(
    () => personas.filter((p) => teamMemberPersonaIds.includes(p.id)),
    [personas, teamMemberPersonaIds],
  );

  useAssignmentProgressListener(teamId);

  useEffect(() => {
    void fetchTeamAssignments(teamId);
    void fetchTemplates(teamId);
  }, [teamId, fetchTeamAssignments, fetchTemplates]);

  const [composerOpen, setComposerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="animate-fade-slide-in absolute bottom-3 left-3 z-30 flex flex-col w-[420px] max-h-[80vh] rounded-modal bg-secondary/95 backdrop-blur-lg border border-primary/20 shadow-elevation-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-orange-400" />
          <h3 className="typo-heading font-semibold text-foreground/90">{a.title}</h3>
          <span className="typo-caption text-foreground/60">{assignments.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setComposerOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive hover:bg-primary/10 text-foreground/80 transition-colors"
            title={a.new_assignment}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="typo-caption">{a.new_assignment}</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-interactive hover:bg-secondary/50 text-foreground/60"
            aria-label={a.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Composer */}
      {composerOpen && (
        <AssignmentComposer
          teamId={teamId}
          teamPersonas={teamPersonas}
          onCreated={async (created) => {
            setComposerOpen(false);
            if (created) {
              await startAssignment(created.id);
              setExpandedId(created.id);
            }
          }}
          onCancel={() => setComposerOpen(false)}
          createAssignment={createAssignment}
          saveTemplate={saveTemplate}
        />
      )}

      {/* Templates strip — saved, reusable assignment shapes for this team */}
      {!composerOpen && templates.length > 0 && (
        <div className="border-b border-primary/10 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 typo-caption font-medium text-foreground/60">
            <BookMarked className="w-3.5 h-3.5 text-violet-400" />
            {a.templates_label}
          </div>
          <div className="flex flex-wrap gap-1">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="group inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-interactive bg-violet-500/10 border border-violet-500/20 hover:border-violet-500/40 transition-colors"
              >
                <button
                  onClick={async () => {
                    const created = await instantiateTemplate(teamId, tpl.id);
                    if (created) setExpandedId(created.id);
                  }}
                  className="typo-caption text-violet-200 max-w-[140px] truncate"
                  title={tpl.goal}
                >
                  {tpl.title}
                </button>
                <button
                  onClick={() => deleteTemplate(teamId, tpl.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded-interactive hover:bg-rose-500/20 text-foreground/40 hover:text-rose-400"
                  aria-label={a.delete_template}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {assignments.length === 0 && !composerOpen ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ListChecks className="w-10 h-10 text-foreground/30 mb-3" />
            <p className="typo-body text-foreground/70">{a.empty_title}</p>
            <p className="typo-caption text-foreground/50 mt-1 max-w-[260px]">{a.empty_hint}</p>
          </div>
        ) : (
          assignments.map((row) => (
            <AssignmentRow
              key={row.id}
              assignment={row}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
              onAbort={() => abortAssignment(row.id)}
              onDelete={() => deleteAssignment(row.id)}
              teamPersonas={teamPersonas}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Composer
// ============================================================================

interface ComposerProps {
  teamId: string;
  teamPersonas: Persona[];
  onCreated: (created: TeamAssignment | null) => void;
  onCancel: () => void;
  createAssignment: (input: CreateTeamAssignmentInput) => Promise<TeamAssignment | null>;
  saveTemplate: (
    input: import('@/lib/bindings/CreateTeamAssignmentTemplateInput').CreateTeamAssignmentTemplateInput,
  ) => Promise<import('@/lib/bindings/TeamAssignmentTemplate').TeamAssignmentTemplate | null>;
}

type MatchStrategy = 'manual' | 'embedding' | 'llm_eval';

function AssignmentComposer({ teamId, teamPersonas, onCreated, onCancel, createAssignment, saveTemplate }: ComposerProps) {
  const { t } = useTranslation();
  const a = t.pipeline.assignments;
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [strategy, setStrategy] = useState<MatchStrategy>('manual');
  const [maxParallel, setMaxParallel] = useState(3);
  const [steps, setSteps] = useState<ComposerStepDraft[]>([
    { id: crypto.randomUUID(), title: '', description: '', personaId: null, useCaseId: null },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Goals hub: optionally link this assignment to a dev goal so its step
  // transitions advance the goal. Scoped to the dev project bound to this team.
  const [linkedGoalId, setLinkedGoalId] = useState<string | null>(null);
  const [goalOptions, setGoalOptions] = useState<DevGoal[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await devApi.listProjects();
        const proj = projects.find((p) => p.team_id === teamId);
        if (!proj) { if (!cancelled) setGoalOptions([]); return; }
        const goals = await devApi.listGoals(proj.id);
        if (!cancelled) setGoalOptions(goals);
      } catch { if (!cancelled) setGoalOptions([]); }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  const personaRequired = strategy === 'manual';

  const saveAsTemplate = async () => {
    setError(null);
    if (!title.trim()) {
      setError(a.error_title_required);
      return;
    }
    if (!goal.trim()) {
      setError(a.error_goal_required);
      return;
    }
    if (steps.some((s) => !s.title.trim())) {
      setError(a.error_step_title_required);
      return;
    }
    setSavingTemplate(true);
    try {
      const tpl = await saveTemplate({
        teamId,
        title: title.trim(),
        goal: goal.trim(),
        matchStrategy: strategy,
        maxParallelSteps: maxParallel,
        steps: steps.map((s) => ({
          title: s.title.trim(),
          description: s.description.trim() ? s.description.trim() : null,
          assignedPersonaId: s.personaId,
          assignedUseCaseId: s.useCaseId,
          dependsOnIndices: null,
        })),
      });
      if (tpl) {
        setTemplateSaved(true);
        setTimeout(() => setTemplateSaved(false), 2000);
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  const autoDecompose = async () => {
    setError(null);
    if (!goal.trim()) {
      setError(a.error_goal_required);
      return;
    }
    setDecomposing(true);
    try {
      const proposed = await decomposeTeamAssignmentGoal(teamId, goal.trim());
      if (proposed.length === 0) {
        setError(a.decompose_empty);
        return;
      }
      setSteps(
        proposed.map((s) => ({
          id: crypto.randomUUID(),
          title: s.title,
          description: s.description,
          personaId: s.suggestedPersonaId,
          useCaseId: s.suggestedUseCaseId,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : a.decompose_failed);
    } finally {
      setDecomposing(false);
    }
  };

  const addStep = () =>
    setSteps((rows) => [...rows, { id: crypto.randomUUID(), title: '', description: '', personaId: null, useCaseId: null }]);

  const updateStep = (id: string, patch: Partial<ComposerStepDraft>) =>
    setSteps((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeStep = (id: string) =>
    setSteps((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.id !== id)));

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError(a.error_title_required);
      return;
    }
    if (!goal.trim()) {
      setError(a.error_goal_required);
      return;
    }
    if (steps.some((s) => !s.title.trim())) {
      setError(a.error_step_title_required);
      return;
    }
    if (personaRequired && steps.some((s) => !s.personaId)) {
      setError(a.error_step_persona_required);
      return;
    }
    setSubmitting(true);
    try {
      const created = await createAssignment({
        teamId,
        title: title.trim(),
        goal: goal.trim(),
        matchStrategy: strategy,
        maxParallelSteps: maxParallel,
        source: 'team_ui',
        companionOpId: null,
        goalId: linkedGoalId,
        steps: steps.map((s) => ({
          title: s.title.trim(),
          description: s.description.trim() ? s.description.trim() : null,
          assignedPersonaId: personaRequired ? s.personaId : s.personaId,
          assignedUseCaseId: personaRequired ? s.useCaseId : s.useCaseId,
          dependsOnIndices: null,
        })),
      });
      onCreated(created);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-b border-primary/10 px-3 py-3 space-y-2.5 bg-primary/[0.02]">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={a.title_placeholder}
        className="w-full px-2.5 py-1.5 rounded-input bg-secondary/50 border border-primary/15 typo-body text-foreground placeholder-foreground/40 focus:outline-none focus:border-orange-500/40"
      />
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder={a.goal_placeholder}
        rows={2}
        className="w-full px-2.5 py-1.5 rounded-input bg-secondary/50 border border-primary/15 typo-body text-foreground placeholder-foreground/40 focus:outline-none focus:border-orange-500/40 resize-none"
      />
      <div className="flex justify-end">
        <button
          onClick={autoDecompose}
          disabled={decomposing || !goal.trim()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 typo-caption disabled:opacity-50"
          title={a.auto_decompose_hint}
        >
          {decomposing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {decomposing ? a.auto_decomposing : a.auto_decompose}
        </button>
      </div>

      {goalOptions.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <label className="typo-caption font-medium text-foreground/70">{a.link_goal_label}</label>
          <select
            value={linkedGoalId ?? ''}
            onChange={(e) => setLinkedGoalId(e.target.value || null)}
            className="flex-1 px-2 py-1 rounded-input bg-secondary/50 border border-primary/15 typo-caption text-foreground focus:outline-none focus:border-orange-500/40"
          >
            <option value="">{a.link_goal_none}</option>
            {goalOptions.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <label className="typo-caption font-medium text-foreground/70">{a.strategy_label}</label>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as MatchStrategy)}
          className="flex-1 px-2 py-1 rounded-input bg-secondary/50 border border-primary/15 typo-caption text-foreground focus:outline-none focus:border-orange-500/40"
        >
          <option value="manual">{a.strategy_manual}</option>
          <option value="embedding">{a.strategy_embedding}</option>
          <option value="llm_eval">{a.strategy_llm_eval}</option>
        </select>
      </div>
      <p className="typo-caption text-foreground/50 -mt-1">
        {strategy === 'manual' && a.strategy_manual_hint}
        {strategy === 'embedding' && a.strategy_embedding_hint}
        {strategy === 'llm_eval' && a.strategy_llm_eval_hint}
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="typo-caption font-medium text-foreground/70">{a.steps_label}</span>
          <button
            onClick={addStep}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive hover:bg-primary/10 typo-caption text-foreground/70"
          >
            <Plus className="w-3 h-3" /> {a.add_step}
          </button>
        </div>
        {steps.map((step, idx) => (
          <ComposerStepRow
            key={step.id}
            step={step}
            index={idx}
            teamPersonas={teamPersonas}
            personaRequired={personaRequired}
            onChange={(patch) => updateStep(step.id, patch)}
            onRemove={steps.length > 1 ? () => removeStep(step.id) : null}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <label className="flex items-center gap-2 typo-caption text-foreground/70">
          {a.max_parallel_label}
          <Slider
            min={MAX_PARALLEL_MIN}
            max={MAX_PARALLEL_MAX}
            value={maxParallel}
            onChange={(v) => setMaxParallel(v)}
            ariaLabel={a.max_parallel_label}
            showBubble={false}
            className="w-20"
          />
          <span className="w-4 text-foreground font-medium">{maxParallel}</span>
        </label>
      </div>

      {error && <p className="typo-caption text-rose-400">{error}</p>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          onClick={saveAsTemplate}
          disabled={savingTemplate}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 typo-caption disabled:opacity-50"
          title={a.save_template_hint}
        >
          {templateSaved ? <CircleCheck className="w-3 h-3" /> : <BookMarked className="w-3 h-3" />}
          {templateSaved ? a.template_saved : savingTemplate ? a.saving_template : a.save_template}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 rounded-interactive hover:bg-secondary/60 typo-caption text-foreground/70"
          >
            {a.cancel}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1 rounded-interactive bg-orange-500/90 hover:bg-orange-500 text-foreground typo-caption font-medium disabled:opacity-50"
          >
            {submitting ? a.submitting : a.create_and_start}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ComposerStepRowProps {
  step: ComposerStepDraft;
  index: number;
  teamPersonas: Persona[];
  personaRequired: boolean;
  onChange: (patch: Partial<ComposerStepDraft>) => void;
  onRemove: (() => void) | null;
}

function ComposerStepRow({ step, index, teamPersonas, personaRequired, onChange, onRemove }: ComposerStepRowProps) {
  const { t } = useTranslation();
  const a = t.pipeline.assignments;
  const selectedPersona = teamPersonas.find((p) => p.id === step.personaId) ?? null;
  const useCases = useMemo(() => {
    if (!selectedPersona) return [] as { id: string; title: string }[];
    try {
      const ctx = selectedPersona.design_context ? JSON.parse(selectedPersona.design_context) : null;
      const ucs = (ctx?.use_cases ?? ctx?.useCases ?? []) as Array<{ id: string; title: string; enabled?: boolean }>;
      return ucs.filter((u) => u.enabled !== false).map((u) => ({ id: u.id, title: u.title }));
    } catch {
      return [];
    }
  }, [selectedPersona]);

  return (
    <div className="space-y-1.5 px-2 py-1.5 rounded-card bg-secondary/40 border border-primary/10">
      <div className="flex items-center gap-2">
        <span className="typo-caption text-foreground/50 w-5 text-center">{index + 1}.</span>
        <input
          value={step.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={a.step_title_placeholder}
          className="flex-1 px-2 py-1 rounded-input bg-background/50 border border-primary/10 typo-caption text-foreground placeholder-foreground/40 focus:outline-none focus:border-orange-500/30"
        />
        {onRemove && (
          <button
            onClick={onRemove}
            className="p-1 rounded-interactive hover:bg-rose-500/20 text-foreground/50 hover:text-rose-400"
            aria-label={a.remove_step}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <textarea
        value={step.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder={a.step_description_placeholder}
        rows={1}
        className="w-full px-2 py-1 rounded-input bg-background/50 border border-primary/10 typo-caption text-foreground placeholder-foreground/40 focus:outline-none focus:border-orange-500/30 resize-none"
      />
      <div className="flex items-center gap-1.5">
        <select
          value={step.personaId ?? ''}
          onChange={(e) => onChange({ personaId: e.target.value || null, useCaseId: null })}
          className="flex-1 px-2 py-1 rounded-input bg-background/50 border border-primary/10 typo-caption text-foreground focus:outline-none focus:border-orange-500/30"
        >
          <option value="">{personaRequired ? a.pick_persona : a.auto_match_persona}</option>
          {teamPersonas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={step.useCaseId ?? ''}
          onChange={(e) => onChange({ useCaseId: e.target.value || null })}
          disabled={useCases.length === 0}
          className="flex-1 px-2 py-1 rounded-input bg-background/50 border border-primary/10 typo-caption text-foreground focus:outline-none focus:border-orange-500/30 disabled:opacity-40"
        >
          <option value="">{a.any_use_case}</option>
          {useCases.map((u) => (
            <option key={u.id} value={u.id}>{u.title}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ============================================================================
// Assignment row + checklist
// ============================================================================

interface AssignmentRowProps {
  assignment: TeamAssignment;
  expanded: boolean;
  onToggle: () => void;
  onAbort: () => void;
  onDelete: () => void;
  teamPersonas: Persona[];
}

function AssignmentRow({ assignment, expanded, onToggle, onAbort, onDelete, teamPersonas }: AssignmentRowProps) {
  const { t } = useTranslation();
  const a = t.pipeline.assignments;
  const fetchDetail = usePipelineStore((s) => s.fetchAssignmentDetail);
  const startAssignment = usePipelineStore((s) => s.startAssignment);
  const detail = usePipelineStore((s) => s.assignmentDetails[assignment.id]);

  useEffect(() => {
    if (expanded && !detail) {
      void fetchDetail(assignment.id);
    }
  }, [expanded, detail, fetchDetail, assignment.id]);

  const inFlight = assignment.status === 'running' || assignment.status === 'queued';
  const canStart = assignment.status === 'queued' || assignment.status === 'awaiting_review';

  return (
    <div className="rounded-card border border-primary/10 bg-secondary/30 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-primary/5 transition-colors text-left"
      >
        <StatusDot status={assignment.status} />
        <div className="flex-1 min-w-0">
          <p className="typo-body font-medium text-foreground/90 truncate">{assignment.title}</p>
          <p className="typo-caption text-foreground/50 truncate">{assignment.goal}</p>
        </div>
        <span className="typo-caption text-foreground/50 capitalize">{a[`status_${assignment.status}` as 'status_running'] ?? assignment.status}</span>
      </button>

      {expanded && (
        <div className="border-t border-primary/10 px-2.5 py-2 space-y-1.5">
          {canStart && (
            <button
              onClick={() => startAssignment(assignment.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 typo-caption"
            >
              <Play className="w-3 h-3" /> {a.start}
            </button>
          )}
          {inFlight && (
            <button
              onClick={onAbort}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 typo-caption"
            >
              <XCircle className="w-3 h-3" /> {a.abort}
            </button>
          )}
          {!inFlight && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive hover:bg-primary/10 text-foreground/50 typo-caption"
            >
              <Trash2 className="w-3 h-3" /> {a.delete}
            </button>
          )}

          {assignment.errorMessage && (
            <p className="typo-caption text-rose-400 px-1">{assignment.errorMessage}</p>
          )}

          {detail && (
            <ol className="space-y-1 pt-1">
              {detail.steps.map((step, idx) => (
                <StepRow key={step.id} step={step} index={idx} teamPersonas={teamPersonas} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

interface StepRowProps {
  step: TeamAssignmentStep;
  index: number;
  teamPersonas: Persona[];
}

function StepRow({ step, index, teamPersonas }: StepRowProps) {
  const { t } = useTranslation();
  const a = t.pipeline.assignments;
  const resolveReview = usePipelineStore((s) => s.resolveAssignmentReview);
  const persona = teamPersonas.find((p) => p.id === step.assignedPersonaId);
  const [reviewMode, setReviewMode] = useState<'edit' | 'reassign' | null>(null);
  const [draftDescription, setDraftDescription] = useState(step.description ?? '');
  const [draftPersonaId, setDraftPersonaId] = useState<string | null>(step.assignedPersonaId);
  const canReview = step.status === 'failed' || step.status === 'awaiting_review';

  const startEdit = () => {
    setDraftDescription(step.description ?? '');
    setReviewMode('edit');
  };
  const startReassign = () => {
    setDraftPersonaId(step.assignedPersonaId);
    setReviewMode('reassign');
  };
  const cancel = () => setReviewMode(null);

  const saveEdit = async () => {
    await resolveReview(step.id, { action: 'edit_requirement', data: { description: draftDescription.trim() } });
    setReviewMode(null);
  };
  const saveReassign = async () => {
    if (!draftPersonaId) return;
    await resolveReview(step.id, { action: 'reassign', data: { persona_id: draftPersonaId, use_case_id: step.assignedUseCaseId } });
    setReviewMode(null);
  };
  const skip = async () => {
    await resolveReview(step.id, { action: 'skip' });
  };

  return (
    <li className="flex items-start gap-2 px-2 py-1 rounded-card bg-background/40">
      <StatusDot status={step.status} />
      <div className="flex-1 min-w-0">
        <p className="typo-caption font-medium text-foreground/90 truncate">
          <span className="text-foreground/40 mr-1">{index + 1}.</span>
          {step.title}
        </p>
        {persona && (
          <p className="typo-caption text-foreground/50 truncate">
            {persona.name}
            {step.matchConfidence != null && step.status !== 'pending' && (
              <span className="text-foreground/40 ml-1.5">
                · {a.match_confidence_label} {Math.round(step.matchConfidence * 100)}%
              </span>
            )}
          </p>
        )}
        {step.matchRationale && step.status !== 'pending' && (
          <p className="typo-caption text-foreground/40 truncate italic">
            {a.match_rationale_prefix} {step.matchRationale}
          </p>
        )}
        {step.errorMessage && (
          <p className="typo-caption text-rose-400 truncate">{step.errorMessage}</p>
        )}
        {step.outputSummary && step.status === 'done' && (
          <p className="typo-caption text-foreground/60 line-clamp-2 italic">{step.outputSummary}</p>
        )}

        {canReview && !reviewMode && (
          <div className="flex flex-wrap gap-1 mt-1">
            <button
              onClick={startEdit}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 typo-caption"
            >
              <Edit3 className="w-3 h-3" /> {a.edit_requirement}
            </button>
            <button
              onClick={startReassign}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 typo-caption"
            >
              <UserCog className="w-3 h-3" /> {a.reassign}
            </button>
            <button
              onClick={skip}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive hover:bg-primary/10 text-foreground/60 typo-caption"
            >
              <SkipForward className="w-3 h-3" /> {a.skip_step}
            </button>
          </div>
        )}

        {reviewMode === 'edit' && (
          <div className="mt-1 space-y-1">
            <textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={2}
              className="w-full px-2 py-1 rounded-input bg-background/60 border border-amber-500/30 typo-caption text-foreground focus:outline-none focus:border-amber-500/60 resize-none"
            />
            <div className="flex justify-end gap-1">
              <button onClick={cancel} className="px-2 py-0.5 typo-caption text-foreground/60 hover:text-foreground/90">{a.cancel}</button>
              <button onClick={saveEdit} className="px-2 py-0.5 rounded-interactive bg-amber-500/90 text-foreground typo-caption font-medium">{a.edit_requirement_save}</button>
            </div>
          </div>
        )}

        {reviewMode === 'reassign' && (
          <div className="mt-1 space-y-1">
            <select
              value={draftPersonaId ?? ''}
              onChange={(e) => setDraftPersonaId(e.target.value || null)}
              className="w-full px-2 py-1 rounded-input bg-background/60 border border-amber-500/30 typo-caption text-foreground focus:outline-none focus:border-amber-500/60"
            >
              <option value="">{a.pick_persona}</option>
              {teamPersonas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-1">
              <button onClick={cancel} className="px-2 py-0.5 typo-caption text-foreground/60 hover:text-foreground/90">{a.cancel}</button>
              <button
                onClick={saveReassign}
                disabled={!draftPersonaId}
                className="px-2 py-0.5 rounded-interactive bg-amber-500/90 text-foreground typo-caption font-medium disabled:opacity-50"
              >
                {a.reassign_save}
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ============================================================================
// Status dot
// ============================================================================

function StatusDot({ status }: { status: string }) {
  const Icon = ICON_FOR_STATUS[status] ?? CircleDot;
  const color = COLOR_FOR_STATUS[status] ?? 'text-foreground/40';
  const spin = status === 'running' || status === 'matching';
  return <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color} ${spin ? 'animate-spin' : ''}`} />;
}

const ICON_FOR_STATUS: Record<string, typeof CircleDot> = {
  queued: CircleDashed,
  pending: CircleDashed,
  matching: Loader2,
  running: Loader2,
  awaiting_review: CircleX,
  done: CircleCheck,
  failed: CircleX,
  skipped: CircleSlash,
  aborted: CircleX,
};

const COLOR_FOR_STATUS: Record<string, string> = {
  queued: 'text-foreground/40',
  pending: 'text-foreground/40',
  matching: 'text-orange-400',
  running: 'text-orange-400',
  awaiting_review: 'text-amber-400',
  done: 'text-emerald-400',
  failed: 'text-rose-400',
  skipped: 'text-foreground/30',
  aborted: 'text-rose-400',
};
