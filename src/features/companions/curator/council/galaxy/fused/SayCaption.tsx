// What a control will do, said before it is pressed. One caption for every
// command, mode segment and the dock's spread button, placed above the
// control it describes; after `M` it names the mode it landed on and the
// one `M` goes to next.
import { useLayoutEffect, useRef, type RefObject } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import { useCouncilStore } from '../../councilStore';
import { cycleMode, type HudMode } from './hudMode';
import { useFusedStore } from './fusedStore';
import { useFusedStrings, type FusedStrings } from './fusedStrings';

interface Props {
  stageRef: RefObject<HTMLElement | null>;
  where: string | null;
  names: number;
  techniques: number;
  spreadHeight: number;
}

function sayText(s: FusedStrings, kind: string, mode: HudMode, ctx: Props & { lensOn: boolean; spread: boolean; lit: number | null }): string {
  const f = s.f;
  const next = s.modeName(cycleMode(mode, 1));
  if (kind === 'flash') return tx(f.say_flash, { name: s.modeName(mode), next });
  if (kind.startsWith('mode:')) {
    const m = kind.slice(5) as HudMode;
    if (m === mode) return tx(f.say_mode_on, { name: s.modeName(m), next });
    if (m === 'lens') return tx(f.say_mode_lens, { count: s.n(ctx.techniques) });
    if (m === 'bar') return ctx.spread ? f.say_mode_bar_spread : f.say_mode_bar_care;
    return f.say_mode_none;
  }
  if (kind === 'fit') {
    const where = ctx.where ?? (ctx.lit != null ? tx(f.say_fit_where_lit, { count: ctx.lit }) : f.say_fit_where_sky);
    return tx(f.say_fit, { where });
  }
  if (kind === 'lens') return ctx.lensOn ? f.say_lens_on : f.say_lens_off;
  if (kind === 'find') return tx(f.say_find, { count: s.n(ctx.names) });
  if (kind === 'spread') return ctx.spread ? f.say_fold : tx(f.say_spread, { height: Math.round(ctx.spreadHeight / 10) * 10 });
  return '';
}

export function SayCaption(props: Props) {
  const s = useFusedStrings();
  const say = useFusedStore((st) => st.say);
  const mode = useFusedStore((st) => st.mode);
  const lensOn = useFusedStore((st) => st.lensOn);
  const spread = useFusedStore((st) => st.spread);
  const focus = useCouncilStore((st) => st.focus);
  const ref = useRef<HTMLDivElement | null>(null);
  const lit = focus.kind === 'council' ? focus.registrySubjects.length : null;
  const text = say ? sayText(s, say.kind, mode, { ...props, lensOn, spread, lit }) : '';

  useLayoutEffect(() => {
    const el = ref.current;
    const stage = props.stageRef.current;
    if (!el || !stage || !say) return;
    const base = stage.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = say.rect;
    let x = r.left - base.left;
    if (say.kind === 'spread') x = r.right - base.left - w;
    if (say.kind === 'flash' || say.kind.startsWith('mode:')) x = r.left - base.left + r.width / 2 - w / 2;
    el.style.left = `${Math.max(8, Math.min(base.width - w - 8, x))}px`;
    el.style.top = `${Math.max(8, r.top - base.top - h - 8)}px`;
  }, [say, text, props.stageRef]);

  if (!say || !text) return null;
  return (
    <div ref={ref} className="fz-say">
      {text}
    </div>
  );
}

export default SayCaption;
