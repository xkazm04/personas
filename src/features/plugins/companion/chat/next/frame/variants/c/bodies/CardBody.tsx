/**
 * CardBody — what the Spread card shows INSIDE its frame, with no inner card:
 * for a decision, an approval or a session request, the Oracle treatment over
 * the shared `CardModel`; for every other kind, the product's own `WorkItemBody` for now.
 *
 * Keys (above the stage's own keys): 1-9 pick that option, Up / Down move
 * focus between the options (Enter then picks the focused one), 0 asks Athena
 * (reveals her recommendation), Enter confirms the recommended option once
 * shown, or asks for it first. Left / Right, Space, Esc and Alt+W stay the
 * stage's (walk the queue, set aside, return the spread).
 *
 * TODO(prototype, 2026-09-24): consolidate the Athena chat switcher.
 */

import type { ReactNode } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { PendingApproval } from '@/api/companion';
import type { McpPendingRequest } from '@/features/plugins/companion/mcp/mcpRequestStore';
import { WorkItemBody } from '../../../../WorkItemBody';
import type { WorkItem } from '../../../../useWorkforce';
import {
  hasNativeBody,
  useApprovalItem,
  useApprovalModel,
  useDecisionModel,
  useMcpItem,
  useMcpModel,
  type CardModel,
} from './model';
import { OracleBody } from './OracleBody';

export interface BodyProps {
  model: CardModel;
  item: WorkItem;
  /** The card's kind colour (a CSS variable). */
  color: string;
  /** The card's art window; a treatment places it (or leaves it out). */
  art: ReactNode;
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function useCardKeys(model: CardModel) {
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
        const plates = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-card-choice]')).filter((b) => !b.disabled);
        if (!plates.length) return false;
        e.preventDefault();
        const at = plates.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : plates.length - 1) : (at + step + plates.length) % plates.length;
        plates[next]!.focus();
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
        // Enter on a focused control inside the card belongs to that control.
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

function View({ model, ...rest }: { model: CardModel; item: WorkItem; color: string; art: ReactNode }) {
  useCardKeys(model);
  return <OracleBody model={model} {...rest} />;
}

interface Common {
  item: WorkItem;
  color: string;
  art: ReactNode;
  /** Cards still in the deck, shown when the model has no queue of its own. */
  deckWaiting: number;
}

function DecisionCardBody(p: Common) {
  const model = useDecisionModel();
  if (!model) return null;
  return <View {...p} model={model.waiting > 0 ? model : { ...model, waiting: p.deckWaiting }} />;
}

function ApprovalModelBody({ approval, ...p }: Common & { approval: PendingApproval }) {
  const model = useApprovalModel(approval);
  return <View {...p} model={{ ...model, waiting: p.deckWaiting }} />;
}
function ApprovalCardBody(p: Common) {
  const approval = useApprovalItem(p.item);
  return approval ? <ApprovalModelBody {...p} approval={approval} /> : null;
}

function McpModelBody({ request, ...p }: Common & { request: McpPendingRequest }) {
  const model = useMcpModel(request);
  return <View {...p} model={{ ...model, waiting: p.deckWaiting }} />;
}
function McpCardBody(p: Common) {
  const request = useMcpItem(p.item);
  return request ? <McpModelBody key={request.requestId} {...p} request={request} /> : null;
}

/** The body of one Spread card. */
export function CardBody({ onSend, ...p }: Common & { onSend: (text: string) => void }) {
  if (hasNativeBody(p.item.kind)) {
    if (p.item.kind === 'decision') return <DecisionCardBody {...p} />;
    if (p.item.kind === 'approval') return <ApprovalCardBody {...p} />;
    return <McpCardBody {...p} />;
  }
  // Other kinds keep the product's own card for now, flat inside the frame.
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {p.art}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 pt-3 pb-2">
        <WorkItemBody item={p.item} onSend={onSend} />
      </div>
    </div>
  );
}
