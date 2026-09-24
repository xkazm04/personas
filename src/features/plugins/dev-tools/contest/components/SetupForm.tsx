// Set up a contest: title, project, brief (optionally drafted by Athena),
// seats, variants, time limit, optional LLM judges (OFF by default), data
// folder and start time. Create, or create and queue the seats at once.
import { useEffect, useMemo, useState } from 'react';
import { Rocket, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { createContest, draftContestBrief } from '@/api/contest';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FormField } from '@/features/shared/components/forms/FormField';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { focusContest } from '../focus';
import { primeSummary } from '../hooks/contestStore';
import { useContestEnvironment } from '../hooks/useContests';
import { setupIssueLabel } from '../model/labels';
import {
  TIMEOUT_MIN_DEFAULT,
  TIMEOUT_MIN_MAX,
  TIMEOUT_MIN_MIN,
  VARIANTS_DEFAULT,
  VARIANTS_MAX,
  VARIANTS_MIN,
  parseLocalDateTime,
  validateSetup,
} from '../model/setupValidation';
import { SeatPicker } from './SeatPicker';

export interface SetupFormProps {
  /** Pre-selected project; defaults to the app's active project. */
  defaultProjectId?: string | null;
  /** After a successful create. The new contest is already focused. */
  onCreated?: (summary: ContestSummary, launched: boolean) => void;
  className?: string;
}

export function SetupForm({ defaultProjectId, onCreated, className = '' }: SetupFormProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const { projects, activeProjectId, fetchProjects } = useSystemStore(
    useShallow((st) => ({ projects: st.projects, activeProjectId: st.activeProjectId, fetchProjects: st.fetchProjects })),
  );

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? activeProjectId ?? null);
  const [idea, setIdea] = useState('');
  const [brief, setBrief] = useState('');
  const [seats, setSeats] = useState<ContestSeatSpec[]>([]);
  const [variantsPerSeat, setVariantsPerSeat] = useState<number>(VARIANTS_DEFAULT);
  const [timeoutMin, setTimeoutMin] = useState<number>(TIMEOUT_MIN_DEFAULT);
  const [judgesEnabled, setJudgesEnabled] = useState(false);
  const [judges, setJudges] = useState<ContestSeatSpec[]>([]);
  const [dataDir, setDataDir] = useState('');
  const [startAt, setStartAt] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  const { environment } = useContestEnvironment(projectId);

  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map((p) => ({ value: p.id, label: p.name, description: p.root_path })),
    [projects],
  );

  const notBeforeMs = parseLocalDateTime(startAt);
  const verdict = validateSetup({
    title,
    projectId,
    brief,
    seats,
    variantsPerSeat,
    timeoutMin,
    judgesEnabled,
    judges,
    notBeforeMs,
  });

  const submit = async (launch: boolean) => {
    setAttempted(true);
    if (!verdict.ok || !projectId) return;
    try {
      const summary = await createContest({
        projectId,
        title: title.trim(),
        brief,
        seats,
        variantsPerSeat,
        timeoutMin,
        judgesEnabled,
        judges: judgesEnabled ? judges : [],
        dataDir: dataDir.trim() || null,
        notBeforeMs,
        launch,
      });
      primeSummary(summary);
      useToastStore.getState().addToast(launch ? s.created_and_launched : s.created, 'success');
      focusContest({ projectId: summary.projectId, contestId: summary.contestId });
      onCreated?.(summary, launch);
    } catch (err) {
      toastCatch('contest:create')(err);
    }
  };

  const draft = async () => {
    if (!projectId || !idea.trim()) return;
    try {
      const { brief: drafted } = await draftContestBrief(projectId, idea.trim());
      setBrief(drafted);
    } catch (err) {
      toastCatch('contest:draft-brief')(err);
    }
  };

  const draftBlocked = !projectId ? s.draft_needs_project : !idea.trim() ? s.draft_needs_idea : undefined;

  return (
    <section className={`space-y-4 ${className}`} aria-label={s.setup_title} data-testid="contest-setup-form">
      <h2 className="typo-section-title">{s.setup_title}</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={s.field_title} required>
          {(p) => (
            <input
              {...p}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={s.field_title_placeholder}
              className={INPUT_FIELD}
              data-testid="contest-setup-title"
            />
          )}
        </FormField>
        <FormField label={s.field_project} hint={s.field_project_hint} required>
          {(p) => (
            <ThemedSelect
              id={p.id}
              filterable
              options={projectOptions}
              value={projectId ?? ''}
              onValueChange={(v) => setProjectId(v || null)}
              placeholder={s.field_project_placeholder}
            />
          )}
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={s.draft_idea_label} className="flex-1 min-w-[16rem]">
            {(p) => (
              <input
                {...p}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder={s.draft_idea_placeholder}
                className={INPUT_FIELD}
              />
            )}
          </FormField>
          <AsyncButton
            variant="secondary"
            icon={<Sparkles className="w-3.5 h-3.5" />}
            disabled={!!draftBlocked}
            disabledReason={draftBlocked}
            onClick={draft}
            data-testid="contest-setup-draft"
          >
            {s.draft_with_athena}
          </AsyncButton>
        </div>
        <FormField label={s.field_brief} hint={s.field_brief_hint} required>
          {(p) => (
            <textarea
              {...p}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={14}
              spellCheck={false}
              className={`${INPUT_FIELD} typo-code min-h-[16rem] resize-y`}
              data-testid="contest-setup-brief"
            />
          )}
        </FormField>
      </div>

      <SeatPicker
        value={seats}
        onChange={setSeats}
        environment={environment}
        label={s.seats_label}
        testIdPrefix="contest-seats"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <FormField label={s.field_variants}>
          {(p) => (
            <NumberStepper
              id={p.id}
              value={variantsPerSeat}
              min={VARIANTS_MIN}
              max={VARIANTS_MAX}
              onChange={(v) => setVariantsPerSeat(v ?? VARIANTS_DEFAULT)}
            />
          )}
        </FormField>
        <FormField label={s.field_timeout}>
          {(p) => (
            <NumberStepper
              id={p.id}
              value={timeoutMin}
              min={TIMEOUT_MIN_MIN}
              max={TIMEOUT_MIN_MAX}
              step={5}
              onChange={(v) => setTimeoutMin(v ?? TIMEOUT_MIN_DEFAULT)}
            />
          )}
        </FormField>
        <FormField label={s.field_start_at} hint={s.field_start_at_hint}>
          {(p) => (
            <input
              {...p}
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className={INPUT_FIELD}
            />
          )}
        </FormField>
      </div>

      <FormField label={s.field_data_dir}>
        {(p) => (
          <input
            {...p}
            value={dataDir}
            onChange={(e) => setDataDir(e.target.value)}
            placeholder={s.field_data_dir_placeholder}
            spellCheck={false}
            className={`${INPUT_FIELD} typo-code`}
          />
        )}
      </FormField>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <AccessibleToggle
            checked={judgesEnabled}
            onChange={() => setJudgesEnabled((v) => !v)}
            label={s.field_judges_toggle}
            data-testid="contest-setup-judges-toggle"
          />
          <span className="typo-title">{s.field_judges_toggle}</span>
        </div>
        <p className="typo-caption text-foreground">{s.field_judges_hint}</p>
        {judgesEnabled && (
          <SeatPicker
            value={judges}
            onChange={setJudges}
            environment={environment}
            label={s.judges_label}
            showLineups={false}
            testIdPrefix="contest-judges"
          />
        )}
      </div>

      {/* Always mounted: a live region must exist before its message does. */}
      <ul className="space-y-1" data-testid="contest-setup-issues" aria-live="polite">
          {attempted &&
            verdict.errors.map((issue) => (
              <li key={issue.code} className={`typo-caption ${STATUS_PALETTE.error.text}`}>
                {setupIssueLabel(s, issue, tx)}
              </li>
            ))}
        {verdict.fewSeats && <li className={`typo-caption ${STATUS_PALETTE.warning.text}`}>{s.few_seats_warning}</li>}
      </ul>

      <div className="flex flex-wrap justify-end gap-2">
        <AsyncButton variant="secondary" onClick={() => submit(false)} data-testid="contest-setup-create">
          {s.create}
        </AsyncButton>
        <AsyncButton
          variant="primary"
          icon={<Rocket className="w-3.5 h-3.5" />}
          onClick={() => submit(true)}
          data-testid="contest-setup-create-launch"
        >
          {s.create_and_launch}
        </AsyncButton>
      </div>
    </section>
  );
}
