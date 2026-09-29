// Level 3, one variant: the live page in its sandboxed frame (pin mode drops a
// numbered note on it), a film strip of every variant, and beside it the facts,
// the trays, the owner's note, the pins and the whole-field note.
import { useRef, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Trash2 } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { formatCount } from '@/lib/utils/formatters';

import { VariantFrame } from '../components/VariantFrame';
import type { ReviewDraft } from '../hooks/useReviewDraft';
import { makerSpec, recordedBucket, variantName } from '../model/contestModel';
import { bucketLabel, phaseLabel, type ContestStrings } from '../model/labels';
import { DESIGN_HEIGHT, DESIGN_WIDTHS, type DesignWidth } from '../model/pinMath';
import { addPin, removePin, setNote, updatePin, variantReview } from '../model/reviewModel';
import { shortTitle } from './ledgerModel';
import { BUCKET_ICON, BUCKET_KEY, FieldNote, isEditable, lockText, SaveState } from './ContestLevel';
import { bucketColor, cssVars, formatBytes, Kbd, Seat, Still, stillOf, useBoxSize } from './parts';

/** Tray buttons in the order their keys run, 1 to 4. */
const SORT_ORDER: readonly ContestReviewBucket[] = ['winner', 'shortlist', 'impractical', 'failure'];

export interface VariantLevelProps {
  summary: ContestSummary;
  detail: ContestDetail;
  draft: ReviewDraft;
  vkey: string;
  width: DesignWidth;
  pinMode: boolean;
  onWidth: (w: DesignWidth) => void;
  onPinMode: (on: boolean) => void;
  onStep: (delta: 1 | -1) => void;
  onSelect: (vkey: string) => void;
  onSort: (vkey: string, bucket: ContestReviewBucket | null) => void;
  onBackToContest: () => void;
  onBackToLedger: () => void;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  s: ContestStrings;
}

export function VariantLevel(props: VariantLevelProps) {
  const { summary, detail, draft, vkey, width, pinMode, onWidth, onPinMode, onStep, onSelect, onSort, s } = props;
  const { tx, language } = useTranslation();
  const L = s.ledger;
  const variants = detail.variants;
  const i = Math.max(0, variants.findIndex((v) => v.key === vkey));
  const v = variants[i]!;
  const bucket = recordedBucket(draft.review, summary, v.key);
  const vr = draft.review ? variantReview(draft.review, v.key) : null;
  const maker = makerSpec(detail, v);
  const editable = isEditable(summary);
  const score = detail.scoreboard?.rows.find((r) => r.key === v.key) ?? null;
  const pins = vr?.pins ?? [];
  const here = pins.filter((p) => (p.width || 1280) === width).length;

  // The frame fits the stage both ways: as wide as the stage, or as tall.
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useBoxSize(stageRef);
  const aspect = width / DESIGN_HEIGHT[width];
  const frameW = Math.max(200, Math.floor(Math.min(stage.width, stage.height * aspect)));

  return (
    <>
      <div className="crumbs">
        <div className="cc">
          <nav className="crumb-path" aria-label={L.crumb_label}>
            <Button variant="ghost" className="crumb" onClick={props.onBackToLedger}>
              {L.crumb_all}
            </Button>
            <span className="slash">/</span>
            <Button variant="ghost" className="crumb" onClick={props.onBackToContest}>
              {shortTitle(summary.title)}
            </Button>
            <span className="slash">/</span>
            <span className="cur" data-testid="ledger-variant-title">
              {v.key} {variantName(v)}
            </span>
          </nav>
          <div className="crumb-meta">
            <span className="inline-flex items-center gap-1.5">
              {L.made_by}
              {maker ? <Seat spec={maker} quiet /> : '—'}
            </span>
            <span className="sep">·</span>
            {tx(L.counter, { i: i + 1, n: variants.length })}
            <span className="sep">·</span>
            <span style={{ color: bucketColor(bucket) }}>{bucket ? bucketLabel(s, bucket) : s.bucket_none}</span>
            <span className="sep">·</span>
            {phaseLabel(s, summary.phase)}
          </div>
        </div>
        <div className="acts">
          <Button variant="secondary" className="cl-btn" icon={<ChevronLeft className="w-4 h-4" />} aria-label={L.lightbox_prev} onClick={() => onStep(-1)} disabled={variants.length < 2}>
            {L.prev}
          </Button>
          <Button variant="secondary" className="cl-btn" iconRight={<ChevronRight className="w-4 h-4" />} aria-label={L.lightbox_next} onClick={() => onStep(1)} disabled={variants.length < 2}>
            {L.next}
          </Button>
        </div>
      </div>
      <div className="l3body">
        <div className="viewer">
          <div className="vtools">
            <div className="segc" role="group" aria-label={s.frame_width_label}>
              {DESIGN_WIDTHS.map((w) => (
                <Button key={w} variant="ghost" className={`cl-seg${w === width ? ' on' : ''}`} aria-pressed={w === width} onClick={() => onWidth(w)}>
                  {w}
                </Button>
              ))}
            </div>
            <Kbd>W</Kbd>
            <Button
              variant="secondary"
              size="sm"
              className={`cl-btn cl-sm pinbtn${pinMode ? ' on' : ''}`}
              icon={<MapPin className="w-3.5 h-3.5" />}
              aria-pressed={pinMode}
              disabled={!editable}
              onClick={() => onPinMode(!pinMode)}
              data-testid="ledger-pin-mode"
            >
              {s.frame_pin_mode}
              <Kbd>P</Kbd>
            </Button>
            <span className="mu" style={{ marginLeft: 6 }}>
              {pinMode ? s.frame_pin_mode_hint : tx(here === 1 ? L.pins_here_one : L.pins_here_other, { count: here })}
            </span>
            <span className="mu" style={{ marginLeft: 'auto' }}>
              {tx(L.counter, { i: i + 1, n: variants.length })}
            </span>
          </div>
          <div className="vstage" ref={stageRef}>
            <div style={{ width: frameW }}>
              <VariantFrame
                key={v.key}
                variant={v}
                pins={pins}
                showControls={false}
                width={width}
                onWidthChange={onWidth}
                pinMode={pinMode && editable}
                onPinModeChange={onPinMode}
                onAddPin={editable ? (pin) => draft.apply((r) => addPin(r, v.key, pin)) : undefined}
              />
            </div>
          </div>
          <div className="film" role="listbox" aria-label={L.film_label}>
            {variants.map((x) => {
              const b = recordedBucket(draft.review, summary, x.key);
              return (
                <Button
                  key={x.key}
                  variant="ghost"
                  role="option"
                  aria-selected={x.key === v.key}
                  className={`fs${x.key === v.key ? ' cur' : ''}`}
                  onClick={() => onSelect(x.key)}
                  data-testid={`ledger-film-${x.key}`}
                >
                  <span className="fi">
                    <Still src={stillOf(x.screenshots)} label={x.key} />
                    {b && <i className="bbar" style={cssVars({ '--b': bucketColor(b) })} />}
                  </span>
                  <span className="fk">
                    {x.key} {variantName(x)}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
        <aside className="vside" aria-label={tx(L.variant_key, { key: v.key })}>
          <div>
            <div className="sect-h" style={{ marginBottom: 6 }}>
              {tx(L.variant_key, { key: v.key })}
              <span className="r">
                <SaveState draft={draft} s={s} />
              </span>
            </div>
            <dl className="facts">
              <dt>{L.made_by}</dt>
              <dd>{maker ? <Seat spec={maker} /> : '—'}</dd>
              <dt>{s.variant_concept}</dt>
              <dd>{v.concept || '—'}</dd>
              <dt>{s.variant_title}</dt>
              <dd>{v.title || '—'}</dd>
              <dt>{s.variant_size}</dt>
              <dd className="tab">
                {formatBytes(v.bytes, language)}
                {v.hasNotes && ` · ${s.variant_has_notes}`}
              </dd>
              {score && (
                <>
                  <dt>{L.facts_judges}</dt>
                  <dd>
                    {score.broken ? (
                      <span className="chip" style={cssVars({ '--c': 'var(--status-error)' })}>{L.score_broken}</span>
                    ) : (
                      tx(L.facts_mean, { mean: formatCount(score.mean, { precision: 1 }), spread: formatCount(score.spread) })
                    )}
                  </dd>
                </>
              )}
            </dl>
          </div>
          <div>
            <div className="sect-h">
              {L.sort_label}
              <span className="r">
                <Kbd>0</Kbd> {L.clears}
              </span>
            </div>
            <div className="sortbtns">
              {SORT_ORDER.map((b) => {
                const Icon = BUCKET_ICON[b];
                return (
                  <Button
                    key={b}
                    variant="ghost"
                    className={`cl-sort${bucket === b ? ' on' : ''}`}
                    style={cssVars({ '--b': bucketColor(b) })}
                    aria-pressed={bucket === b}
                    disabled={!editable}
                    onClick={() => onSort(v.key, bucket === b ? null : b)}
                    data-testid={`ledger-sort-${b}`}
                  >
                    <Icon className="ic w-4 h-4" aria-hidden />
                    {bucketLabel(s, b)}
                    <Kbd>{BUCKET_KEY[b]}</Kbd>
                  </Button>
                );
              })}
            </div>
            {!editable && <div className="hint" style={{ marginTop: 6 }}>{lockText(L, s, summary, tx)}</div>}
          </div>
          <div>
            <div className="sect-h">
              {L.note_title}
              <span className="r">
                <Kbd>N</Kbd>
              </span>
            </div>
            <textarea
              ref={props.noteRef}
              className="ta"
              rows={3}
              value={vr?.note ?? ''}
              placeholder={s.note_placeholder}
              aria-label={s.note_label}
              readOnly={!editable}
              onChange={(e) => {
                const note = e.target.value;
                draft.apply((r) => setNote(r, v.key, note));
              }}
              data-testid="ledger-variant-note"
            />
          </div>
          <div>
            <div className="sect-h">
              {s.pins_label}
              <span className="n">{pins.length}</span>
            </div>
            <div className="pins">
              {pins.length === 0 && <div className="hint">{s.pins_empty}</div>}
              {pins.map((p, n) => (
                <div key={n} className="pinrow">
                  <span className="pn">{n + 1}</span>
                  <input
                    value={p.note}
                    placeholder={s.pin_note_placeholder}
                    aria-label={tx(s.pin_note_aria, { n: n + 1 })}
                    readOnly={!editable}
                    onChange={(e) => {
                      const note = e.target.value;
                      draft.apply((r) => updatePin(r, v.key, n, { note }));
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tx(s.pin_remove, { n: n + 1 })}
                    disabled={!editable}
                    onClick={() => draft.apply((r) => removePin(r, v.key, n))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <FieldNote draft={draft} s={s} rows={3} />
        </aside>
      </div>
    </>
  );
}

