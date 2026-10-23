import { Component, type ReactNode } from 'react';

import { Tile } from '@/features/shared/components/kit';
import { createLogger } from '@/lib/log';
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger('cockpit-widget-boundary');

interface CatchProps {
  kind: string;
  /** What to show once the child has thrown. */
  fallback: ReactNode;
  /** The config the child rendered; a new one gives a failed widget another try. */
  resetKey: unknown;
  children: ReactNode;
}

class Catch extends Component<CatchProps, { failed: boolean; seen: unknown }> {
  state = { failed: false, seen: this.props.resetKey };

  static getDerivedStateFromProps(props: CatchProps, state: { failed: boolean; seen: unknown }) {
    return props.resetKey === state.seen ? null : { failed: false, seen: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    logger.error('Widget threw while rendering', { kind: this.props.kind, error: error.message });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * One Athena-composed widget behind its own boundary: a config the widget cannot render degrades
 * to an error Tile in that widget's place instead of unmounting the grid or the chat column it
 * sits in. The widgets narrow their config themselves (`widgets/narrow.ts`); this is the net for
 * the shape nobody anticipated.
 */
export function WidgetBoundary({ kind, span, resetKey, children }: {
  kind: string;
  span?: number;
  resetKey: unknown;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Catch
      kind={kind}
      resetKey={resetKey}
      fallback={<Tile span={span} error={{ title: t.common.error_boundary_title, hint: kind }} />}
    >
      {children}
    </Catch>
  );
}
