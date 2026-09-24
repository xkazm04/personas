/**
 * RefLink — one reference link inside Athena's prose: the phrase she wrote, in
 * primary tint, with a small glyph for what it opens and a tooltip naming it.
 * It is a real button (keyboard focusable, Enter/Space open it) and stops the
 * click from bubbling, because it can sit inside a clickable preview (the frame
 * top's collapsed reply expands on click).
 */

import type { ReactNode } from 'react';
import {
  Activity,
  Bot,
  Brain,
  FileText,
  LayoutList,
  ShieldCheck,
  Signpost,
  Target,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { resolvableRef } from './openRef';
import { useRefOpener } from './RefOpenerContext';
import type { RefKind } from './refGrammar';

const KIND_ICON: Record<RefKind, LucideIcon> = {
  approval: ShieldCheck,
  card: LayoutList,
  decision: Signpost,
  report: FileText,
  session: Terminal,
  job: Activity,
  memory: Brain,
  goal: Target,
  persona: Bot,
};

export function refKindLabel(t: Translations, kind: RefKind): string {
  const c = t.plugins.companion;
  switch (kind) {
    case 'approval':
      return c.ref_kind_approval;
    case 'card':
      return c.ref_kind_card;
    case 'decision':
      return c.ref_kind_decision;
    case 'report':
      return c.ref_kind_report;
    case 'session':
      return c.ref_kind_session;
    case 'job':
      return c.ref_kind_job;
    case 'memory':
      return c.ref_kind_memory;
    case 'goal':
      return c.ref_kind_goal;
    case 'persona':
      return c.ref_kind_persona;
  }
}

export function RefLink({ kind, handle, children }: { kind: RefKind; handle: string; children: ReactNode }) {
  const { t } = useTranslation();
  const open = useRefOpener();
  // A handle this build cannot open (a memory id of an unknown kind) reads as
  // the phrase, never as a link that does nothing.
  if (!resolvableRef(kind, handle)) return <>{children}</>;
  const Icon = KIND_ICON[kind];
  return (
    <Tooltip content={refKindLabel(t, kind)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open(kind, handle);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="inline text-left text-primary hover:underline underline-offset-2 decoration-primary/50 rounded-interactive focus-ring"
        data-testid="companion-ref-link"
        data-ref-kind={kind}
        data-ref-handle={handle}
      >
        <Icon className="inline-block w-3.5 h-3.5 mr-0.5 align-[-2px]" aria-hidden />
        {children}
      </button>
    </Tooltip>
  );
}
