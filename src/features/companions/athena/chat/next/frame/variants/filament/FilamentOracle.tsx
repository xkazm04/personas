/**
 * Filament · the Oracle — the mock's own markup (`.oracle` / `.rungs` /
 * `.rung` / `.seal` / `.ask` / `.verdict` / `.glyph-art`) driven by the REAL
 * card models (`../c/bodies/model.ts`), so the verbs, the recommendation and
 * the parameter detail are the product's while the look is the contest's.
 *
 * This replaces going through `../c/bodies/CardBody.tsx` → `OracleBody.tsx`
 * for the kinds that have a native body: that path renders Halo's Tailwind
 * presentation (centred heading, pill choice buttons), which is why the
 * triage window read as a different design. Kinds without a native body
 * still fall through to `WorkItemBody` via `CardBody`.
 *
 * TODO(prototype, 2026-10-04): consolidate the Athena chat switcher.
 */

import type { ReactNode } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { PendingApproval } from '@/api/companion';
import type { McpPendingRequest } from '@/features/companions/athena/mcp/mcpRequestStore';
import type { WorkItem, WorkItemKind } from '../../../useWorkforce';
import { CardBody } from '../c/bodies/CardBody';
import {
  hasNativeBody,
  useApprovalItem,
  useApprovalModel,
  useDecisionModel,
  useMcpItem,
  useMcpModel,
  type CardChoice,
  type CardModel,
} from '../c/bodies/model';
import { FILAMENT_COPY as F } from './copy';

/** The mock's line art, one drawing per kind. Not stock icons. */
const ART: Partial<Record<WorkItemKind, ReactNode>> = {
  decision: (
    <>
      <circle className="halo" cx="60" cy="60" r="56" />
      <path pathLength={1} d="M60 16V100M34 100H86M22 34H98M22 34L10 64H34ZM98 34L86 64H110Z" />
      <circle pathLength={1} cx="60" cy="16" r="4" />
    </>
  ),
  approval: (
    <>
      <circle className="halo" cx="60" cy="60" r="56" />
      <path pathLength={1} d="M60 14L96 27V57C96 81 80 96 60 106C40 96 24 81 24 57V27Z" />
      <path pathLength={1} d="M43 60L55 72L79 46" />
    </>
  ),
  session_request: (
    <>
      <circle className="halo" cx="60" cy="60" r="56" />
      <rect pathLength={1} x="16" y="26" width="88" height="68" rx="10" />
      <path pathLength={1} d="M32 50L45 60L32 70M52 74H76" />
    </>
  ),
  failure: (
    <>
      <circle className="halo" cx="60" cy="60" r="56" />
      <path pathLength={1} d="M43 16H77L104 43V77L77 104H43L16 77V43Z" />
      <path pathLength={1} d="M60 38V66" />
      <circle pathLength={1} cx="60" cy="80" r="2.5" />
    </>
  ),
  plan: (
    <>
      <circle className="halo" cx="60" cy="60" r="56" />
      <path pathLength={1} d="M16 30L44 20L76 32L104 22V92L76 102L44 90L16 100ZM44 20V90M76 32V102" />
    </>
  ),
};

function Sigil() {
  return (
    <svg className="sigil" viewBox="0 0 32 32" aria-hidden>
      <circle className="ring" cx="16" cy="16" r="13" />
      <circle className="arc" cx="16" cy="16" r="9" />
      <path className="mark" d="M11 21 L16 10 L21 21 M13 17.5 H19" />
    </svg>
  );
}

/**
 * The product's `question` is not a question: it is `decision.prompt`, a
 * paragraph of markdown (`**bold**`, `` `code` ``, em-dash clauses, absolute
 * paths). Rendered whole at a page-heading token it was ten lines of 700
 * weight with the asterisks showing — which is what made the popup read as
 * low quality. So: take the first clause as the heading, demote the rest to
 * context, and render the inline marks instead of printing them.
 */
function splitPrompt(raw: string): { lead: string; rest: string } {
  const text = raw.trim();
  const at = (() => {
    for (const sep of [' — ', ' - ', '. ', '? ', ': ']) {
      const i = text.indexOf(sep, 24);
      if (i > 0 && i < 150) return i + (sep === '. ' || sep === '? ' ? 1 : 0);
    }
    return -1;
  })();
  if (at < 0) return text.length <= 160 ? { lead: text, rest: '' } : { lead: `${text.slice(0, 150).trimEnd()}…`, rest: text };
  return { lead: text.slice(0, at).trim(), rest: text.slice(at).replace(/^[\s—-]+/, '').trim() };
}

/** `**bold**` and `` `code` `` as real marks, never as literal characters. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="typo-code">{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

function toneOf(choice: CardChoice, kindColor: string): string {
  if (choice.tone === 'danger') return 'var(--status-error)';
  if (choice.tone === 'neutral') return 'var(--foreground)';
  return kindColor;
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** 1-9 pick, 0 ask, Enter confirm her pick, Up/Down walk the rungs. */
function useRungKeys(model: CardModel) {
  useAppKeyboard(
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(document.activeElement)) return false;
      if (/^[1-9]$/.test(e.key)) {
        const choice = model.choices[Number(e.key) - 1];
        if (!choice || model.busy) return false;
        e.preventDefault();
        void choice.run();
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const rungs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-card-choice]')).filter((b) => !b.disabled);
        if (!rungs.length) return false;
        e.preventDefault();
        const at = rungs.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        rungs[at < 0 ? (step > 0 ? 0 : rungs.length - 1) : (at + step + rungs.length) % rungs.length]!.focus();
        return true;
      }
      const rec = model.recommendation;
      if (e.key === '0' && rec?.reveal) {
        e.preventDefault();
        rec.reveal();
        return true;
      }
      if (e.key === 'Enter') {
        const el = document.activeElement;
        if (el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY')) return false;
        const picked = model.choices.find((c) => c.recommended);
        if (picked && !model.busy) {
          e.preventDefault();
          void picked.run();
          return true;
        }
        if (rec && !rec.revealed && rec.reveal) {
          e.preventDefault();
          rec.reveal();
          return true;
        }
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 2 },
  );
}

function Oracle({ model, item, color }: { model: CardModel; item: WorkItem; color: string }) {
  useRungKeys(model);
  const rec = model.recommendation;
  const art = ART[item.kind] ?? ART.plan;
  const { lead, rest } = splitPrompt(model.question);
  return (
    <>
      <svg className="glyph-art" viewBox="0 0 120 120" aria-hidden style={{ ['--c' as string]: color }}>
        {art}
      </svg>
      <div className="oracle" style={{ ['--c' as string]: color }}>
        <p className="typo-eyebrow eyebrow">
          <span className="bead" style={{ ['--c' as string]: color }} aria-hidden />
          {model.eyebrow}
        </p>
        {/* One step down from a page heading and 600, not 700: this sits inside
            a panel, under an eyebrow, above its own context. `text-foreground`
            drops `typo-section-title`'s primary tint, which is for page heads. */}
        <h2 className="typo-section-title text-foreground">{inline(lead)}</h2>
        {rest && <p className="typo-body ctx">{inline(rest)}</p>}
        {model.context && <p className="typo-body ctx">{inline(model.context)}</p>}

        {model.choices.length > 0 && (
          <ol className="rungs">
            {model.choices.map((c, i) => (
              <li key={c.key}>
                <button
                  type="button"
                  className={`rung${c.recommended ? ' rec' : ''}${c.busy ? ' busy' : ''}`}
                  style={{ ['--t' as string]: toneOf(c, color) }}
                  data-card-choice=""
                  data-testid={c.testId}
                  disabled={model.busy}
                  onClick={() => void c.run()}
                >
                  <span className="n typo-data">{i + 1}</span>
                  <span>
                    {/* One emphasis per row: the verb carries the weight, the
                        hint stays body. */}
                    <span className="typo-title text-foreground">{inline(c.label)}</span>
                    {c.hint && <span className="typo-caption hint">{c.hint}</span>}
                  </span>
                  {c.recommended ? <span className="seal typo-label">{F.recommended}</span> : <span />}
                </button>
              </li>
            ))}
          </ol>
        )}

        {model.field && (
          <label className="field">
            <span className="typo-label">{model.field.label}</span>
            <textarea
              className="typo-body"
              rows={3}
              value={model.field.value}
              placeholder={model.field.placeholder}
              disabled={model.field.disabled}
              onChange={(e) => model.field!.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && model.field?.submit?.enabled) {
                  e.preventDefault();
                  void model.field.submit.run();
                }
              }}
            />
            {model.field.submit && (
              <span className="row">
                <button
                  type="button"
                  className="primary typo-label"
                  disabled={!model.field.submit.enabled}
                  onClick={() => void model.field!.submit!.run()}
                >
                  {model.field.submit.label}
                </button>
              </span>
            )}
          </label>
        )}

        {rec && rec.revealed && rec.text ? (
          <div className="verdict" role="status">
            <span className="avatar" aria-hidden>
              <Sigil />
            </span>
            <p className="typo-body-lg">
              <span className="typo-label who">{rec.label}</span>
              <br />
              {rec.text}
            </p>
          </div>
        ) : rec?.composing ? (
          <p className="typo-body" role="status">
            {rec.composing}
          </p>
        ) : rec?.reveal ? (
          <button type="button" className="ask typo-body" onClick={rec.reveal}>
            <span className="avatar" aria-hidden>
              <Sigil />
            </span>
            {F.askAthena}
            <span className="kbd typo-caption">{F.keyAsk}</span>
          </button>
        ) : null}
        {rec?.failed && <p className="problem warn typo-body">{rec.failed}</p>}

        {model.details && (
          <details>
            <summary className="typo-body">{model.details.label}</summary>
            <pre className="typo-code">{model.details.code}</pre>
          </details>
        )}

        {model.error && <p className="problem err typo-body" role="alert">{model.error}</p>}
        {model.warning && <p className="problem warn typo-body" role="alert">{model.warning}</p>}
      </div>
    </>
  );
}

function DecisionOracle({ item, color }: { item: WorkItem; color: string }) {
  const model = useDecisionModel();
  return model ? <Oracle model={model} item={item} color={color} /> : null;
}
function ApprovalOracleInner({ item, color, approval }: { item: WorkItem; color: string; approval: PendingApproval }) {
  return <Oracle model={useApprovalModel(approval)} item={item} color={color} />;
}
function ApprovalOracle({ item, color }: { item: WorkItem; color: string }) {
  const approval = useApprovalItem(item);
  return approval ? <ApprovalOracleInner item={item} color={color} approval={approval} /> : null;
}
function McpOracleInner({ item, color, request }: { item: WorkItem; color: string; request: McpPendingRequest }) {
  return <Oracle model={useMcpModel(request)} item={item} color={color} />;
}
function McpOracle({ item, color }: { item: WorkItem; color: string }) {
  const request = useMcpItem(item);
  return request ? <McpOracleInner key={request.requestId} item={item} color={color} request={request} /> : null;
}

/** The body of one triage item: the mock's Oracle, or the product's own card. */
export function FilamentOracle({
  item,
  color,
  waiting,
  onSend,
}: {
  item: WorkItem;
  color: string;
  waiting: number;
  onSend: (text: string) => void;
}) {
  if (hasNativeBody(item.kind)) {
    if (item.kind === 'decision') return <DecisionOracle item={item} color={color} />;
    if (item.kind === 'approval') return <ApprovalOracle item={item} color={color} />;
    return <McpOracle item={item} color={color} />;
  }
  return <CardBody item={item} color={color} art={null} deckWaiting={waiting} onSend={onSend} />;
}
