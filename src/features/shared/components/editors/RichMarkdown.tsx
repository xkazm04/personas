/**
 * @catalog RichMarkdown — markdown with custom tags for rich blocks: a SurfaceSpec block (`:::stats`, `:::table`, `:::decisions`, `:::terminal`, `::gauge`, `::progress`) or a piece of the execution-detail content grammar (`:::card`, `:::well`, `::eyebrow`, `:pill[...]`) written straight into the prose. Use it wherever an AGENT or a person authors markdown the app displays; plain `MarkdownRenderer` stays right for fixed app copy. Tag reference: `surface/SPEC.md` § "In markdown".
 *
 * One vocabulary, two spellings. SurfaceSpec is the typed grammar agents use
 * to emit UI instead of prose; this is the same grammar inside a document, so
 * a KPI description, a director review or a run summary can carry a table or a
 * gauge without the app inventing a second format. Every block goes through the
 * SurfaceSpec schema and the SurfaceSpec renderer, and every action it carries
 * goes through the same consent dialogs (`useSurfaceActions`): a document can
 * propose work, never start it.
 *
 * Nothing is dropped. An unknown tag, or a block whose body fails its schema,
 * is shown as written with the reason beside it.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import remarkDirective from 'remark-directive';

import { ContentCard } from '@/features/shared/components/content/ContentCard';
import { ContentEyebrow, ContentPill, ContentWell } from '@/features/shared/components/content/ContentBits';
import { CONTENT_TONES, type ContentTone } from '@/features/shared/components/content/contentTones';
import {
  SurfaceBlockView,
  useSurfaceActions,
  type SurfaceRenderContext,
} from '@/features/shared/components/surface/SurfaceRenderer';
import type { SurfaceAction } from '@/features/shared/components/surface/surfaceSpec';
import type { DecisionAction } from '@/features/shared/components/decisions/decisionTypes';
import { useTranslation } from '@/i18n/useTranslation';

import { MarkdownRenderer } from './MarkdownRenderer';
import type { MarkdownVariant } from './markdownVariants';
import { readRichBlock } from './richBlocks';
import { readAttrs, remarkRichDirectives, RICH_UNKNOWN } from './richDirectives';

type ToAction = (action: SurfaceAction, keyPrefix: string) => DecisionAction;

/** Module-level: the plugin list never changes, so MarkdownRenderer's memo
 *  holds and the pipeline is not rebuilt per render. */
const RICH_REMARK = [remarkDirective, remarkRichDirectives];

function toneOf(raw: string | undefined, fallback: ContentTone): ContentTone {
  return raw && raw in CONTENT_TONES ? (raw as ContentTone) : fallback;
}

/** Props a rewritten element carries; see `richDirectives.ts`. */
interface RichProps {
  children?: ReactNode;
  'data-attrs'?: string;
  'data-body'?: string;
  'data-source'?: string;
  'data-name'?: string;
}

function Unreadable({ name, reason, source }: { name: string; reason: string | null; source: string }) {
  const { t, tx } = useTranslation();
  const r = t.shared.rich_markdown;
  return (
    <div className="my-3 space-y-1.5" data-testid="rich-unreadable">
      <p className="typo-caption text-status-warning">
        {reason ? tx(r.invalid_block, { name, reason }) : tx(r.unknown_block, { name })}
      </p>
      <ContentWell pre>{source}</ContentWell>
    </div>
  );
}

function blockRenderer(name: string, toAction: { current: ToAction }) {
  return function RichBlock(props: RichProps) {
    const attrs = readAttrs(props['data-attrs']);
    const result = readRichBlock(name, attrs, props['data-body'] ?? '');
    if (!result.ok) {
      return <Unreadable name={name} reason={result.reason} source={props['data-source'] ?? ''} />;
    }
    return (
      <div className="my-3" data-testid={`rich-${name}`}>
        <SurfaceBlockView block={result.block} index={0} toDecisionAction={(a, k) => toAction.current(a, k)} />
      </div>
    );
  };
}

function buildRichComponents(toAction: { current: ToAction }): Components {
  const map: Record<string, (props: RichProps) => ReactNode> = {
    'rich-card': (props) => {
      const attrs = readAttrs(props['data-attrs']);
      return (
        <ContentCard
          className="my-3"
          tone={toneOf(attrs.tone, 'primary')}
          title={attrs.title || undefined}
          variant={attrs.variant === 'framed' ? 'framed' : 'tinted'}
          data-testid="rich-card"
        >
          {props.children}
        </ContentCard>
      );
    },
    'rich-well': (props) => (
      <div className="my-3">
        <ContentWell pre>{props.children}</ContentWell>
      </div>
    ),
    'rich-eyebrow': (props) => {
      const attrs = readAttrs(props['data-attrs']);
      return (
        <div className="mb-1.5 mt-3">
          <ContentEyebrow>{attrs.title || props.children}</ContentEyebrow>
        </div>
      );
    },
    'rich-pill': (props) => {
      const attrs = readAttrs(props['data-attrs']);
      return <ContentPill tone={toneOf(attrs.tone, 'amber')}>{props.children}</ContentPill>;
    },
    'rich-stats': blockRenderer('stats', toAction),
    'rich-table': blockRenderer('table', toAction),
    'rich-decisions': blockRenderer('decisions', toAction),
    'rich-terminal': blockRenderer('terminal', toAction),
    'rich-gauge': blockRenderer('gauge', toAction),
    'rich-progress': blockRenderer('progress', toAction),
    [RICH_UNKNOWN]: (props) => (
      <Unreadable name={props['data-name'] ?? '?'} reason={null} source={props['data-source'] ?? ''} />
    ),
  };
  // The element names are custom (`rich-*`), which react-markdown's
  // `Components` type does not enumerate; they are real hast element names
  // produced by `remarkRichDirectives`, so the renderer does receive them.
  return map as unknown as Components;
}

export interface RichMarkdownProps {
  content: string;
  className?: string;
  variant?: MarkdownVariant;
  onLinkClick?: (href: string) => boolean;
  /** What the blocks' actions may target; without it they render disabled. */
  context?: SurfaceRenderContext;
}

export function RichMarkdown({ content, className, variant, onLinkClick, context }: RichMarkdownProps) {
  const { toDecisionAction, consent } = useSurfaceActions(context);
  // The action mapper closes over consent state and so changes identity on
  // every render. The components must NOT: a new component function per
  // render would remount every block (a table would lose its sort). They read
  // the latest mapper through a ref instead.
  const actionRef = useRef<ToAction>(toDecisionAction);
  actionRef.current = toDecisionAction;
  const components = useMemo(() => buildRichComponents(actionRef), []);

  return (
    <>
      <MarkdownRenderer
        content={content}
        className={className}
        variant={variant}
        onLinkClick={onLinkClick}
        remarkPlugins={RICH_REMARK}
        components={components}
      />
      {consent}
    </>
  );
}
