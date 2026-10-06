/**
 * Fusion · one waiting item on the decision stage, driven by the product's
 * own card models (`../c/bodies/model.ts`: `useDecisionCard`,
 * `useApprovalCard`, `useMcpRequestCard` -> `CardModel`), so every verb, the
 * recommendation and its reveal rule, and the parameter detail are the
 * product's. Kinds without a native body (plans, nudges, assignments, ...)
 * render the product's own card (`WorkItemBody`) as their one answer card,
 * under a question strip that carries the queue and the keys.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useEffect, useRef } from 'react';
import type { PendingApproval } from '@/api/companion';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import type { McpPendingRequest } from '@/features/companions/athena/mcp/mcpRequestStore';
import { WorkItemBody } from '../../../WorkItemBody';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import {
  hasNativeBody,
  useApprovalItem,
  useApprovalModel,
  useDecisionModel,
  useMcpItem,
  useMcpModel,
  type CardModel,
} from '../c/bodies/model';
import { AnswerCards, useFlight } from './AnswerCards';
import type { QueueNav } from './DecisionStage';
import { QuestionBlock } from './QuestionBlock';
import { useAnswerKeys } from './useAnswerKeys';

function View({ model, item, nav }: { model: CardModel; item: WorkItem; nav: QueueNav }) {
  useAnswerKeys(model);
  const announce = useAnnounce();
  const rec = model.recommendation;
  const spoken = rec?.revealed && rec.text ? rec.text : (rec?.composing ?? '');
  useEffect(() => {
    if (spoken) announce(spoken);
  }, [spoken, announce]);
  return (
    <>
      <QuestionBlock model={model} item={item} nav={nav} />
      <AnswerCards model={model} herOwn={item.kind === 'decision'} />
    </>
  );
}

function DecisionItem({ item, nav }: { item: WorkItem; nav: QueueNav }) {
  const model = useDecisionModel();
  return model ? <View model={model} item={item} nav={nav} /> : null;
}
function ApprovalInner({ item, nav, approval }: { item: WorkItem; nav: QueueNav; approval: PendingApproval }) {
  return <View model={useApprovalModel(approval)} item={item} nav={nav} />;
}
function ApprovalItem({ item, nav }: { item: WorkItem; nav: QueueNav }) {
  const approval = useApprovalItem(item);
  return approval ? <ApprovalInner item={item} nav={nav} approval={approval} /> : null;
}
function McpInner({ item, nav, request }: { item: WorkItem; nav: QueueNav; request: McpPendingRequest }) {
  return <View model={useMcpModel(request)} item={item} nav={nav} />;
}
function McpItem({ item, nav }: { item: WorkItem; nav: QueueNav }) {
  const request = useMcpItem(item);
  return request ? <McpInner key={request.requestId} item={item} nav={nav} request={request} /> : null;
}

/**
 * The product's own card for a kind with no native body. It is a card already,
 * so it lands as its OWN piece under the question strip - flown in like an
 * answer - never wrapped inside the question block (no card inside a card).
 */
function NativeCard({ item, onSend }: { item: WorkItem; onSend: (text: string) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  useFlight(listRef, 1);
  return (
    <ol ref={listRef} className="fu-answers" style={{ ['--n' as string]: 1 }} data-testid="companion-fusion-native">
      <li className="fu-answer-slot is-wide">
        <div className="fu-native" style={{ ['--c' as string]: KIND_VAR[item.kind] }}>
          <WorkItemBody item={item} onSend={onSend} />
        </div>
      </li>
    </ol>
  );
}

export function ItemSurface({ item, nav, onSend }: { item: WorkItem; nav: QueueNav; onSend: (text: string) => void }) {
  if (hasNativeBody(item.kind)) {
    if (item.kind === 'decision') return <DecisionItem item={item} nav={nav} />;
    if (item.kind === 'approval') return <ApprovalItem item={item} nav={nav} />;
    return <McpItem item={item} nav={nav} />;
  }
  return (
    <>
      <QuestionBlock model={null} item={item} nav={nav} />
      <NativeCard item={item} onSend={onSend} />
    </>
  );
}
