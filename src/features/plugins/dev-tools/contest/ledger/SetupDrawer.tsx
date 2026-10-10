// New contest: the form and its receipt. Seats are typed ("opus x", "sol
// high") or clicked from the model grid, a saved line-up or a recent panel
// fills the panel in one click, and the receipt prices every seat from this
// machine's past runs before anything is spent. Esc closes and keeps the input
// (the module draft slot); Create or Clear empties it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bookmark, Check, Minus, Play, Plus, Sparkles, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { createContest, draftContestBrief } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestEffort } from '@/lib/bindings/ContestEffort';
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { BaseModal } from '@/lib/ui/BaseModal';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { primeSummary } from '../hooks/contestStore';
import { useContestLineups } from '../hooks/useContestLineups';
import { effortLabel, engineLabel, setupIssueLabel, type ContestStrings } from '../model/labels';
import { addSeat, CONTEST_EFFORTS, CONTEST_ENGINES, CONTEST_MODEL_CATALOG, DEFAULT_SEAT_EFFORT, formatSeatSpec, modelDisplayName, specsFromLineup } from '../model/seatCatalog';
import { blankSetupDraft, clearSetupDraft, patchSetupDraft, readSetupDraft, writeSetupDraft, type SetupDraft } from '../model/setupDraft';
import { parseLocalDateTime, validateSetup, VARIANTS_MAX, VARIANTS_MIN } from '../model/setupValidation';
import { panelEstimate, recentPanels, seatEstimate, seatSuggestions, type SeatSuggestion } from './ledgerModel';
import { drawerPanelClass, engineColor, formatUsd, Kbd, Seat } from './parts';

const TITLE_ID = 'ledger-setup-title';

export interface SetupDrawerProps {
  contests: ContestSummary[];
  defaultProjectId: string | null;
  wide: boolean;
  onClose: () => void;
  onCreated: (summary: ContestSummary) => void;
}

export function SetupDrawer({ contests, defaultProjectId, wide, onClose, onCreated }: SetupDrawerProps) {
  const { t, tx, language } = useTranslation();
  const s = t.plugins.contest;
  const L = s.ledger;
  const { projects, fetchProjects } = useSystemStore(useShallow((st) => ({ projects: st.projects, fetchProjects: st.fetchProjects })));
  const lineups = useContestLineups();
  const [draft, setDraft] = useState<SetupDraft>(() => {
    const kept = readSetupDraft();
    return kept ? { ...kept, projectId: kept.projectId ?? defaultProjectId } : blankSetupDraft(defaultProjectId);
  });
  const [lineupName, setLineupName] = useState('');
  const [other, setOther] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => writeSetupDraft(draft), [draft]);
  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);
  useEffect(() => {
    const id = window.setTimeout(() => titleRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  const patch = (p: Partial<SetupDraft>) => setDraft((d) => ({ ...d, ...p }));
  const effortWords = useMemo(
    () => Object.fromEntries(CONTEST_EFFORTS.map((e) => [e, effortLabel(s, e)])) as Record<ContestEffort, string>,
    [s],
  );
  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map((p) => ({ value: p.id, label: p.name, description: p.root_path })),
    [projects],
  );
  const notBeforeMs = parseLocalDateTime(draft.startAt);
  const verdict = validateSetup({ ...draft, notBeforeMs });
  const recent = useMemo(() => recentPanels(contests), [contests]);

  const create = async (launch: boolean) => {
    if (!verdict.ok || !draft.projectId) return;
    try {
      const summary = await createContest({
        projectId: draft.projectId,
        title: draft.title.trim(),
        brief: draft.brief,
        seats: draft.seats,
        variantsPerSeat: draft.variantsPerSeat,
        timeoutMin: draft.timeoutMin,
        judgesEnabled: draft.judgesEnabled,
        judges: draft.judgesEnabled ? draft.judges : [],
        dataDir: draft.dataDir.trim() || null,
        notBeforeMs,
        launch,
      });
      primeSummary(summary);
      clearSetupDraft();
      useToastStore.getState().addToast(launch ? s.created_and_launched : s.created, 'success');
      onCreated(summary);
    } catch (err) {
      toastCatch('contest:ledger-create')(err);
    }
  };

  const runDraft = async () => {
    if (!draft.projectId || !draft.idea.trim()) return;
    try {
      const { brief } = await draftContestBrief(draft.projectId, draft.idea.trim());
      // Into the kept draft too: a drawer closed mid-call still gets the paid draft.
      patchSetupDraft({ brief });
      setDraft((d) => ({ ...d, brief }));
    } catch (err) {
      toastCatch('contest:ledger-draft-brief')(err);
    }
  };
  const draftBlocked = !draft.projectId ? s.draft_needs_project : !draft.idea.trim() ? s.draft_needs_idea : undefined;

  const saveLineup = async () => {
    const name = lineupName.trim();
    if (!name || !draft.seats.length) return;
    try {
      await lineups.upsert({ name, seats: draft.seats.map(formatSeatSpec) });
      setLineupName('');
      useToastStore.getState().addToast(s.lineup_saved, 'success');
    } catch (err) {
      toastCatch('contest:ledger-lineup-save')(err);
    }
  };
  const applyLineup = (seats: readonly string[]) => {
    const r = specsFromLineup(seats);
    patch({ seats: r.specs });
    if (r.dropped) useToastStore.getState().addToast(tx(s.lineup_dropped, { count: r.dropped }), 'warning');
  };

  const messages = verdict.errors.map((e) => setupIssueLabel(s, e, tx));

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal panelClassName={drawerPanelClass(wide)}>
      <div className={`contest-ledger sl-drawer${wide ? ' wide' : ''}`} data-testid="ledger-setup">
        <div className="dr-h">
          <div className="hx">
            <h2 id={TITLE_ID}>{s.setup_title}</h2>
            <p>{L.setup_hint}</p>
          </div>
          <Kbd>Esc</Kbd>
          <Button variant="secondary" size="icon-sm" aria-label={L.setup_close} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="dr-body setup">
          <div className="form">
            <div className="frow">
              <div className="fld">
                <label htmlFor="ledger-f-title">{s.field_title}</label>
                <input ref={titleRef} id="ledger-f-title" className="in" value={draft.title} placeholder={s.field_title_placeholder} onChange={(e) => patch({ title: e.target.value })} data-testid="ledger-setup-title" />
              </div>
              <div className="fld">
                <label htmlFor="ledger-f-project">{s.field_project}</label>
                <ThemedSelect id="ledger-f-project" filterable options={projectOptions} value={draft.projectId ?? ''} onValueChange={(v) => patch({ projectId: v || null })} placeholder={s.field_project_placeholder} />
              </div>
            </div>
            <div className="fld">
              <label htmlFor="ledger-f-idea">{s.draft_idea_label}</label>
              <div className="idea">
                <input id="ledger-f-idea" className="in" value={draft.idea} placeholder={s.draft_idea_placeholder} onChange={(e) => patch({ idea: e.target.value })} />
                <Tooltip content={draftBlocked ?? s.draft_with_athena}>
                  <AsyncButton
                    variant="secondary"
                    className="cl-btn"
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                    disabled={!!draftBlocked}
                    onClick={async () => {
                      if (draft.brief.trim()) setConfirmReplace(true);
                      else await runDraft();
                    }}
                    data-testid="ledger-setup-draft"
                  >
                    {s.draft_with_athena}
                  </AsyncButton>
                </Tooltip>
              </div>
            </div>
            <div className="fld">
              <label htmlFor="ledger-f-brief">{s.field_brief}</label>
              <textarea id="ledger-f-brief" className="ta" rows={5} value={draft.brief} placeholder={s.field_brief_hint} spellCheck={false} onChange={(e) => patch({ brief: e.target.value })} data-testid="ledger-setup-brief" />
            </div>

            <div className="fld">
              <div className="lab">
                {s.seats_label}
                {draft.seats.length > 0 && <span className="opt">{tx(draft.seats.length === 1 ? L.seats_count_one : L.seats_count_other, { count: draft.seats.length })}</span>}
              </div>
              <SeatCommand
                placeholder={L.seat_command_placeholder}
                label={L.seat_command_label}
                effortWords={effortWords}
                contests={contests}
                draft={draft}
                s={s}
                onPick={(spec) => patch({ seats: addSeat(draft.seats, spec) })}
                testId="ledger-seat-command"
              />
              <div className="seatlines">
                {draft.seats.length === 0 ? (
                  <div className="hint">{L.seats_empty}</div>
                ) : (
                  draft.seats.map((spec, i) => (
                    <SeatLine key={`${formatSeatSpec(spec)}-${i}`} spec={spec} s={s} onEffort={(e) => patch({ seats: draft.seats.map((x, j) => (j === i ? { ...x, effort: e } : x)) })} onRemove={() => patch({ seats: draft.seats.filter((_, j) => j !== i) })} />
                  ))
                )}
              </div>
              <div className="grid-pick">
                {CONTEST_ENGINES.map((engine) => (
                  <div key={engine} className="gp-row">
                    <span className="eng">
                      <i className="edot" style={{ background: engineColor(engine) }} aria-hidden />
                      {engineLabel(s, engine)}
                    </span>
                    {CONTEST_MODEL_CATALOG[engine].map((model) => (
                      <Button
                        key={model}
                        variant="ghost"
                        className="chipbtn"
                        icon={<Plus className="w-3 h-3" />}
                        onClick={() => patch({ seats: addSeat(draft.seats, { engine, model, effort: DEFAULT_SEAT_EFFORT, label: null }) })}
                        data-testid={`ledger-add-${engine}-${model}`}
                      >
                        {modelDisplayName(model)}
                      </Button>
                    ))}
                  </div>
                ))}
                <div className="gp-row">
                  <input className="in other" value={other} placeholder={s.picker_custom_model_placeholder} aria-label={s.picker_custom_model_placeholder} onChange={(e) => setOther(e.target.value)} />
                  <span className="mu">{L.add_on}</span>
                  {CONTEST_ENGINES.map((engine) => (
                    <Button
                      key={engine}
                      variant="ghost"
                      className="chipbtn"
                      aria-label={tx(s.picker_custom_model_aria, { engine: engineLabel(s, engine) })}
                      disabled={!other.trim()}
                      onClick={() => {
                        patch({ seats: addSeat(draft.seats, { engine, model: other.trim(), effort: DEFAULT_SEAT_EFFORT, label: null }) });
                        setOther('');
                      }}
                    >
                      <i className="edot" style={{ background: engineColor(engine) }} aria-hidden />
                      {engineLabel(s, engine)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="fld">
              <div className="lab">
                {L.tickets_title}
                <span className="opt">{L.tickets_hint}</span>
              </div>
              <div className="tickets">
                {lineups.error != null && lineups.lineups.length === 0 ? (
                  <span className="hint">{s.lineups_load_failed}</span>
                ) : lineups.lineups.length === 0 ? (
                  <span className="hint">{s.lineups_empty}</span>
                ) : (
                  lineups.lineups.map((l) => (
                    <span key={l.name} className="ticket">
                      <Button variant="ghost" className="cl-tk" icon={<Bookmark className="w-3.5 h-3.5" />} aria-label={tx(s.lineup_apply, { name: l.name })} onClick={() => applyLineup(l.seats)} data-testid={`ledger-lineup-${l.name}`}>
                        {l.name}
                        <span className="sm">{tx(l.seats.length === 1 ? L.seats_count_one : L.seats_count_other, { count: l.seats.length })}</span>
                      </Button>
                      <AsyncButton variant="ghost" className="cl-tk del" aria-label={tx(s.lineup_delete, { name: l.name })} onClick={() => lineups.remove(l.name).catch(toastCatch('contest:ledger-lineup-delete'))}>
                        <X className="w-3 h-3" />
                      </AsyncButton>
                    </span>
                  ))
                )}
              </div>
              <div className="saveline">
                <input className="in" value={lineupName} placeholder={s.lineup_name_placeholder} aria-label={s.lineup_name_label} onChange={(e) => setLineupName(e.target.value)} />
                <Tooltip content={lineups.lineups.some((l) => l.name === lineupName.trim()) ? s.lineup_name_taken : s.lineup_save_title}>
                  <AsyncButton variant="secondary" size="sm" className="cl-btn cl-sm" icon={<Bookmark className="w-3.5 h-3.5" />} disabled={!draft.seats.length || !lineupName.trim()} onClick={saveLineup} data-testid="ledger-lineup-save">
                    {s.lineup_save}
                  </AsyncButton>
                </Tooltip>
              </div>
              {recent.length > 0 && (
                <>
                  <div className="lab" style={{ marginTop: 4 }}>
                    {L.recent_title}
                    <span className="opt">{L.recent_hint}</span>
                  </div>
                  <div className="tickets">
                    {recent.map((p) => (
                      <span key={p.seats.join('|')} className="ticket">
                        <Tooltip content={tx(L.recent_from, { title: p.from.title })}>
                          <Button variant="ghost" className="cl-tk" onClick={() => applyLineup(p.seats)}>
                            {p.seats.map((sp, i) => (
                              <span key={sp} className="inline-flex items-center gap-1.5">
                                {i > 0 && <span className="mu">+</span>}
                                <Seat spec={sp} hideEffort />
                              </span>
                            ))}
                          </Button>
                        </Tooltip>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="frow3">
              <div className="fld">
                <div className="lab">{s.field_variants}</div>
                <div className="segc" role="group" aria-label={s.field_variants}>
                  <Button variant="ghost" size="icon-sm" aria-label={L.fewer_variants} disabled={draft.variantsPerSeat <= VARIANTS_MIN} onClick={() => patch({ variantsPerSeat: Math.max(VARIANTS_MIN, draft.variantsPerSeat - 1) })}>
                    <Minus className="w-3.5 h-3.5" />
                  </Button>
                  <span className="tab inline-grid place-items-center min-w-[30px] font-semibold" data-testid="ledger-setup-variants">{draft.variantsPerSeat}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={L.more_variants} disabled={draft.variantsPerSeat >= VARIANTS_MAX} onClick={() => patch({ variantsPerSeat: Math.min(VARIANTS_MAX, draft.variantsPerSeat + 1) })}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="fld">
                <label htmlFor="ledger-f-timeout">{L.time_limit}</label>
                <div className="flex items-center gap-2">
                  <input id="ledger-f-timeout" type="number" className="in w-[84px]" min={5} max={600} value={draft.timeoutMin} onChange={(e) => patch({ timeoutMin: Number.parseInt(e.target.value, 10) || 0 })} />
                  <span className="mu">{L.min_per_seat}</span>
                </div>
              </div>
              <div className="fld">
                <label htmlFor="ledger-f-start">
                  {L.start_at} <span className="opt">{L.optional}</span>
                </label>
                <input id="ledger-f-start" type="datetime-local" className="in" value={draft.startAt} onChange={(e) => patch({ startAt: e.target.value })} />
              </div>
            </div>

            <div className="fld">
              <div className="toggle-row">
                <AccessibleToggle checked={draft.judgesEnabled} onChange={() => patch({ judgesEnabled: !draft.judgesEnabled })} label={s.field_judges_toggle} data-testid="ledger-setup-judges" />
                <span>{s.field_judges_toggle}</span>
              </div>
              <div className="sub">{s.field_judges_hint}</div>
              {draft.judgesEnabled && (
                <div className="judgebox">
                  <SeatCommand
                    placeholder={L.judge_command_placeholder}
                    label={L.judge_command_label}
                    effortWords={effortWords}
                    contests={contests}
                    draft={draft}
                    s={s}
                    onPick={(spec) => patch({ judges: addSeat(draft.judges, spec) })}
                    testId="ledger-judge-command"
                  />
                  <div className="seatlines">
                    {draft.judges.map((spec, i) => (
                      <SeatLine key={`${formatSeatSpec(spec)}-${i}`} spec={spec} s={s} onEffort={(e) => patch({ judges: draft.judges.map((x, j) => (j === i ? { ...x, effort: e } : x)) })} onRemove={() => patch({ judges: draft.judges.filter((_, j) => j !== i) })} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="fld">
              <label htmlFor="ledger-f-data">{s.field_data_dir}</label>
              <input id="ledger-f-data" className="in" value={draft.dataDir} placeholder={s.field_data_dir_placeholder} spellCheck={false} onChange={(e) => patch({ dataDir: e.target.value })} />
            </div>
          </div>
          <Receipt draft={draft} contests={contests} s={s} language={language} notBeforeMs={notBeforeMs} />
        </div>
        <div className="dr-foot">
          <div className="issues" aria-live="polite" data-testid="ledger-setup-issues">
            {messages.slice(0, 2).map((m) => (
              <div key={m} className="e">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                {m}
              </div>
            ))}
            {messages.length > 2 && <div className="e mu">{tx(L.issues_more, { count: messages.length - 2 })}</div>}
            {verdict.fewSeats && (
              <div className="w">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                {s.few_seats_warning}
              </div>
            )}
            {verdict.ok && !verdict.fewSeats && (
              <div className="okl">
                <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />
                {L.ready_to_create}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            className="cl-btn"
            onClick={() => {
              clearSetupDraft();
              setDraft(blankSetupDraft(draft.projectId));
            }}
            data-testid="ledger-setup-clear"
          >
            {s.setup_clear}
          </Button>
          <AsyncButton variant="secondary" className="cl-btn" disabled={!verdict.ok} onClick={() => create(false)} data-testid="ledger-setup-create">
            {s.create}
          </AsyncButton>
          <AsyncButton variant="primary" className="cl-btn cl-primary" icon={<Play className="w-3.5 h-3.5" />} disabled={!verdict.ok} onClick={() => create(true)} data-testid="ledger-setup-create-launch">
            {s.create_and_launch}
          </AsyncButton>
        </div>
      </div>
      {confirmReplace && (
        <ConfirmDialog
          title={s.draft_replace_title}
          body={s.draft_replace_body}
          confirmLabel={s.draft_replace_confirm}
          onCancel={() => setConfirmReplace(false)}
          onConfirm={async () => {
            await runDraft();
            setConfirmReplace(false);
          }}
        />
      )}
    </BaseModal>
  );
}

function SeatLine({ spec, s, onEffort, onRemove }: { spec: ContestSeatSpec; s: ContestStrings; onEffort: (e: ContestEffort) => void; onRemove: () => void }) {
  const { tx } = useTranslation();
  const text = formatSeatSpec(spec);
  return (
    <div className="sline" data-testid={`ledger-seatline-${text}`}>
      <Seat spec={text} hideEffort />
      <span className="effseg" role="radiogroup" aria-label={tx(s.seat_effort_aria, { spec: modelDisplayName(spec.model) })}>
        {CONTEST_EFFORTS.map((e) => (
          <Button key={e} variant="ghost" role="radio" aria-checked={spec.effort === e} className={`cl-eff${spec.effort === e ? ' on' : ''}`} onClick={() => onEffort(e)}>
            {effortLabel(s, e)}
          </Button>
        ))}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label={tx(s.seat_remove, { spec: modelDisplayName(spec.model) })} onClick={onRemove}>
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

/** Type a seat: "opus x" → Opus 5.5 at Extra high, priced from past runs. */
function SeatCommand({ placeholder, label, effortWords, contests, draft, s, onPick, testId }: {
  placeholder: string;
  label: string;
  effortWords: Record<ContestEffort, string>;
  contests: ContestSummary[];
  draft: SetupDraft;
  s: ContestStrings;
  onPick: (spec: ContestSeatSpec) => void;
  testId: string;
}) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const items = useMemo(() => seatSuggestions(query, effortWords), [query, effortWords]);
  const listId = `${testId}-list`;
  const pick = (it: SeatSuggestion) => {
    onPick({ engine: it.engine, model: it.model, effort: it.effort, label: null });
    setQuery('');
    setHi(0);
  };
  const right = (it: SeatSuggestion) => {
    if (it.custom) return tx(L.custom_model, { model: it.model, engine: engineLabel(s, it.engine) });
    const e = seatEstimate(formatSeatSpec(it), contests, draft.variantsPerSeat, draft.timeoutMin);
    const runs = tx(e.runs === 1 ? L.sugg_runs_one : L.sugg_runs_other, { count: e.runs }) + (e.basis === 'model' ? ` ${L.sugg_other_effort}` : '');
    if (e.cost !== null) return tx(L.sugg_price, { amount: formatUsd(e.cost), runs });
    return e.runs ? tx(L.sugg_no_cost, { runs }) : L.sugg_never;
  };
  const shown = open && items.length > 0;
  return (
    <div className="cmd">
      <Plus className="ic w-4 h-4" aria-hidden />
      <input
        className="in"
        value={query}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setHi((h) => (h + 1) % items.length);
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setHi((h) => (h - 1 + items.length) % items.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const it = items[hi];
            if (it) pick(it);
          } else if (e.key === 'Escape' && shown) {
            e.preventDefault();
            e.stopPropagation();
            setQuery('');
          }
        }}
        data-testid={testId}
      />
      {shown && (
        <div className="sugg" id={listId} role="listbox" aria-label={label}>
          {items.map((it, i) => (
            <div
              key={`${it.engine}:${it.model}@${it.effort}${it.custom ? '*' : ''}`}
              className={`sg${i === hi ? ' on' : ''}`}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
            >
              <Seat spec={formatSeatSpec(it)} />
              <span className="r">{right(it)}</span>
              {i === hi && <Kbd>↵</Kbd>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Receipt({ draft, contests, s, language, notBeforeMs }: { draft: SetupDraft; contests: ContestSummary[]; s: ContestStrings; language: string; notBeforeMs: number | null }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const est = panelEstimate(draft.seats, contests, draft.variantsPerSeat, draft.timeoutMin);
  const today = new Date().toLocaleDateString(language, { month: 'short', day: 'numeric' });
  const over = est.wallS !== null && est.wallS >= draft.timeoutMin * 60 * 0.95;
  return (
    <div className="receipt" data-testid="ledger-receipt">
      <div className="rc-paper">
        <div className="rc-h">
          <span>{L.receipt_title}</span>
          <span>{today}</span>
        </div>
        {draft.seats.length === 0 && <div className="rc-empty">{L.receipt_empty}</div>}
        {est.seats.map((e, i) => {
          const cost = e.cost !== null ? tx(L.price_about, { amount: formatUsd(e.cost) }) : e.reportsCost ? L.receipt_no_history : L.receipt_no_cost;
          const bits = [
            e.wallS !== null ? tx(L.receipt_minutes, { count: Math.round(e.wallS / 60) }) : L.receipt_time_unknown,
            e.runs ? tx(e.runs === 1 ? L.receipt_runs_one : L.receipt_runs_other, { count: e.runs }) + (e.basis === 'model' ? ` ${L.receipt_other_effort}` : '') : L.receipt_never,
          ];
          return (
            <div key={`${e.spec}-${i}`} className="rc-item">
              <div className="a">
                <Seat spec={e.spec} />
              </div>
              <div className="b">
                <span className="p">{cost}</span> · {bits.join(' · ')}
                {e.failures > 0 && (
                  <>
                    {' · '}
                    <span className="bad">{tx(L.receipt_failed, { count: e.failures })}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {draft.seats.length > 0 && (
          <>
            <div className="rc-line">
              <span>{L.receipt_variants}</span>
              <b>{tx(L.receipt_variants_value, { per: draft.variantsPerSeat, seats: draft.seats.length, total: draft.variantsPerSeat * draft.seats.length })}</b>
            </div>
            <div className={`rc-line${over ? ' over' : ''}`}>
              <span>{L.receipt_time}</span>
              <b>{est.wallS !== null ? tx(L.receipt_time_value, { likely: Math.round(est.wallS / 60), limit: draft.timeoutMin }) : tx(L.receipt_time_upto, { limit: draft.timeoutMin })}</b>
            </div>
            {draft.judgesEnabled && (
              <div className="rc-line">
                <span>{L.receipt_judges}</span>
                <b>{draft.judges.length ? draft.judges.map((j) => modelDisplayName(j.model)).join(', ') : L.receipt_judges_none}</b>
              </div>
            )}
            {notBeforeMs !== null && (
              <div className="rc-line">
                <span>{L.receipt_starts}</span>
                <b>{new Date(notBeforeMs).toLocaleString(language, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b>
              </div>
            )}
            {est.unpriced > 0 && (
              <div className="rc-line">
                <span>{L.receipt_unpriced}</span>
                <b>{est.unpriced}</b>
              </div>
            )}
            <div className="rc-total">
              <span>{L.receipt_total}</span>
              <b>
                {est.cost !== null ? tx(L.price_about, { amount: formatUsd(est.cost) }) : '—'}
                {est.costLow !== null && est.costHigh !== null && Math.round(est.costLow) !== Math.round(est.costHigh) && (
                  <span className="range">({Math.round(est.costLow)}–{Math.round(est.costHigh)})</span>
                )}
              </b>
            </div>
            <div className="rc-foot">{tx(L.receipt_foot, { count: est.runs })}</div>
          </>
        )}
      </div>
    </div>
  );
}
