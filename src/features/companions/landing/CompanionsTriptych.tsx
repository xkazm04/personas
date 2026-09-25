// The triptych: three companions, three columns, three lamps.
//
// Presentational on purpose - it takes status and handlers and nothing else,
// so the shot harness can drive it with the contest's own scenarios while the
// page binds it to the live read. Keyboard goes through the app's registry at
// the route rung; Enter and Space are the button's own.
import { useCallback, useMemo, useRef } from 'react';

import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import { CompanionColumn, CompanionColumnGhost } from './CompanionColumn';
import { columnsOf, type CompanionColumnView } from './landingModel';
import { COMPANION_IDS, type CompanionStatusDto } from '../types';
import './heartlight.css';
import './heartlight-copy.css';

export interface CompanionsTriptychProps {
  /** One entry per companion, in category order. Null while the first read is in flight. */
  companions: CompanionStatusDto[] | null;
  loading: boolean;
  error?: string | null;
  onOpen: (view: CompanionColumnView) => void;
  onRetry?: () => void;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || TYPING_TAGS.has(el.tagName));
}

export function CompanionsTriptych({
  companions,
  loading,
  error,
  onOpen,
  onRetry,
}: CompanionsTriptychProps) {
  const { t } = useTranslation();
  const columnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusedRef = useRef(0);
  const pageRef = useRef<HTMLDivElement>(null);

  const views = useMemo(
    () => (companions && companions.length > 0 ? columnsOf(companions, t.companions) : null),
    [companions, t.companions],
  );

  const focusColumn = useCallback((index: number) => {
    const count = columnRefs.current.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    columnRefs.current[next]?.focus();
  }, []);

  useAppKeyboard(
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        focusColumn(Number(event.key) - 1);
        event.preventDefault();
        return true;
      }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (!pageRef.current?.contains(document.activeElement)) return;
      focusColumn(focusedRef.current + (event.key === 'ArrowRight' ? 1 : -1));
      event.preventDefault();
      return true;
    },
    { priority: ROUTE_DECISION_PRIORITY, enabled: !!views },
  );

  const rememberFocus = useCallback((index: number) => {
    focusedRef.current = index;
  }, []);

  // `role="group"` on the page so its label is exposed: an aria-label on a
  // generic div is ignored by assistive tech, and the three doors belong
  // together.
  return (
    <div ref={pageRef} className="hl-page" data-role="page" role="group" aria-label={t.companions.landing.title}>
      {error ? (
        <div className="hl-error">
          <InlineErrorBanner compact message={error} onRetry={onRetry} />
        </div>
      ) : null}

      {views
        ? views.map((view, index) => (
            <CompanionColumn
              key={view.id}
              view={view}
              onOpen={onOpen}
              onFocus={rememberFocus}
              ref={(node) => {
                columnRefs.current[index] = node;
              }}
            />
          ))
        : COMPANION_IDS.map((id, index) => (
            <CompanionColumnGhost key={id} id={id} index={index + 1} />
          ))}

      <span className="sr-only" aria-live="polite">
        {loading && !views ? t.companions.state.loading : ''}
      </span>
    </div>
  );
}
