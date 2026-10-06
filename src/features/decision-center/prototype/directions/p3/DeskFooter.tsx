/**
 * The decision footer: the key legend on the left, the verdicts on the right.
 * Every verdict button prints its key; an ARMED verdict turns into its own
 * confirmation ("↵ confirm"), so the second press is on the same spot.
 */
import { Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Kbd, KeyLegend, type KeyHint } from './parts';
import type { DeskCtl } from './useDesk';

function legendFor(ctl: DeskCtl): KeyHint[] {
  const walk: KeyHint = { keys: ['←', '→'], label: 'walk' };
  const back: KeyHint = { keys: ['Esc'], label: 'back' };
  if (ctl.type === 'chat') return [walk, { keys: ['Space'], label: 'reply' }, { keys: ['D'], label: 'done' }, back];
  if (ctl.type === 'report') {
    return ctl.item?.kind === 'council'
      ? [walk, { keys: ['↑', '↓'], label: 'scroll' }, { keys: ['A'], label: 'approve' }, { keys: ['R'], label: 'send back' }, back]
      : [walk, { keys: ['↑', '↓'], label: 'scroll' }, { keys: ['D'], label: 'read' }, { keys: ['⇧1-5'], label: 'rate' }, back];
  }
  const n = ctl.item?.branches.length ?? 0;
  const branches = n ? [{ keys: [n === 1 ? '1' : `1-${n}`], label: n === 1 ? 'option' : 'options' }] : [];
  return [walk, { keys: ['A'], label: 'accept' }, { keys: ['R'], label: 'reject' }, ...branches, { keys: ['S'], label: 'skip' }, back];
}

function Verdict({ k, label, tone, armed, onPress }: {
  k: string; label: string; tone: 'success' | 'error' | 'info' | 'highlight'; armed?: boolean; onPress: () => void;
}) {
  return (
    <Button variant="accent" tone={tone} size="md" onClick={onPress}
      className={armed ? 'motion-safe:animate-pulse ring-2 ring-current' : ''} data-testid={`p3-verdict-${k}`}>
      <span className="inline-flex items-center gap-2">
        <Kbd>{armed ? '↵' : k}</Kbd>
        {armed ? `Confirm: ${label}` : label}
      </span>
    </Button>
  );
}

export function DeskFooter({ ctl }: { ctl: DeskCtl }) {
  const item = ctl.item;
  if (!item) return null;
  const labels = item.verdictLabels;
  const armedReject = ctl.armed === 'reject';
  const armedAccept = ctl.armed === 'accept';
  const onReject = () => (armedReject ? ctl.confirm() : ctl.reject());
  const onAccept = () => (armedAccept ? ctl.confirm() : ctl.accept());
  let actions;
  if (ctl.type === 'chat') {
    actions = <Verdict k="D" label="Done" tone="info" onPress={ctl.done} />;
  } else if (item.kind === 'report') {
    actions = (
      <>
        <span className="flex items-center gap-0.5" role="radiogroup" aria-label="Rate this report">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button key={n} variant="ghost" size="icon-sm" role="radio" aria-checked={ctl.rating === n}
              aria-label={`${n} of 5`} onClick={() => ctl.setRating(n)}>
              <Star className={`h-4 w-4 ${ctl.rating && n <= ctl.rating ? 'fill-current text-status-warning' : 'text-muted-foreground'}`} aria-hidden />
            </Button>
          ))}
        </span>
        {item.branches.map((b, i) => (
          <Verdict key={b.id} k={String(i + 1)} label={b.label} tone="highlight" onPress={() => ctl.branch(i)} />
        ))}
        <Verdict k="D" label="Done — mark read" tone="success" onPress={ctl.done} />
      </>
    );
  } else {
    actions = (
      <>
        {item.kind !== 'council' && (
          <Button variant="ghost" size="md" onClick={ctl.skip}>
            <span className="inline-flex items-center gap-2"><Kbd>S</Kbd>{labels.skip}</span>
          </Button>
        )}
        <Verdict k="R" label={labels.reject} tone="error" armed={armedReject} onPress={onReject} />
        {ctl.type === 'backlog' && item.branches.map((b, i) => (
          <Verdict key={b.id} k={String(i + 1)} label={b.label} tone="highlight" onPress={() => ctl.branch(i)} />
        ))}
        <Verdict k="A" label={labels.accept} tone="success" armed={armedAccept} onPress={onAccept} />
      </>
    );
  }
  return (
    <footer className="p3-footer flex items-center gap-4 px-6 py-3" data-testid="p3-footer">
      <KeyLegend hints={legendFor(ctl)} />
      <div className="ml-auto flex flex-shrink-0 items-center gap-2">{actions}</div>
    </footer>
  );
}
