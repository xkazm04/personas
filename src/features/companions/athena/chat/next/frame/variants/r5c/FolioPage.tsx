/**
 * Folio · the recto: one item waiting on you, as a page. Decisions, approvals
 * and session requests are set natively (`FolioText`) from the product's own
 * card models, so every verb is the product's; other kinds (a plan, a nudge,
 * an assignment) print the product's own body (`WorkItemBody`) on the page.
 */

import type { PendingApproval } from '@/api/companion';
import type { McpPendingRequest } from '@/features/companions/athena/mcp/mcpRequestStore';
import { useTranslation } from '@/i18n/useTranslation';
import { NEXT_COPY as N } from '../../../nextCopy';
import { WorkItemBody } from '../../../WorkItemBody';
import type { WorkItem } from '../../../useWorkforce';
import {
  hasNativeBody,
  useApprovalItem,
  useApprovalModel,
  useDecisionModel,
  useMcpItem,
  useMcpModel,
} from '../c/bodies/model';
import { Eyebrow, FolioText } from './FolioText';
import { footnoteMark, itemTitle, kindInk } from './marks';

function DecisionText({ item, mark }: { item: WorkItem; mark: string }) {
  const model = useDecisionModel();
  return model ? <FolioText model={model} item={item} mark={mark} /> : null;
}
function ApprovalModelText({ item, approval, mark }: { item: WorkItem; approval: PendingApproval; mark: string }) {
  return <FolioText model={useApprovalModel(approval)} item={item} mark={mark} />;
}
function ApprovalText({ item, mark }: { item: WorkItem; mark: string }) {
  const approval = useApprovalItem(item);
  return approval ? <ApprovalModelText item={item} approval={approval} mark={mark} /> : null;
}
function McpModelText({ item, request, mark }: { item: WorkItem; request: McpPendingRequest; mark: string }) {
  return <FolioText model={useMcpModel(request)} item={item} mark={mark} />;
}
function McpText({ item, mark }: { item: WorkItem; mark: string }) {
  const request = useMcpItem(item);
  return request ? <McpModelText key={request.requestId} item={item} request={request} mark={mark} /> : null;
}

export function FolioPage({ item, mark, onSend }: { item: WorkItem; mark: number; onSend: (text: string) => void }) {
  const { t } = useTranslation();
  const ink = kindInk(item.kind);
  const glyph = footnoteMark(Math.max(0, mark));
  return (
    <div className="r5c-page" style={{ ['--ink' as string]: ink }} data-testid="companion-r5c-decision">
      {hasNativeBody(item.kind) ? (
        item.kind === 'decision' ? (
          <DecisionText item={item} mark={glyph} />
        ) : item.kind === 'approval' ? (
          <ApprovalText item={item} mark={glyph} />
        ) : (
          <McpText item={item} mark={glyph} />
        )
      ) : (
        <>
          {/* The product's own card carries its title; the page adds only its head. */}
          <Eyebrow mark={glyph} text={N.kind[item.kind]} project={item.project} />
          <h2 className="sr-only">{itemTitle(t, item)}</h2>
          <div className="r5c-page-product">
            <WorkItemBody item={item} onSend={onSend} />
          </div>
        </>
      )}
    </div>
  );
}
