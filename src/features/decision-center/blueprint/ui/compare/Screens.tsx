import { useState } from 'react';
import type { Comparison, ShotPair } from '@/lib/lensScan/compare';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useSheet } from '../../controller/SheetContext';
import type { BpText } from '../../controller/useBlueprintText';
import { Press } from '../Press';
import { ShotFrame, ShotImg, SliderFrame } from './ShotFrame';

type Theme = 'light' | 'dark' | 'both';
type Mode = 'side' | 'slider';

/** The pairs a theme choice shows: that theme's, every pair for `both`, and every pair when none has the theme. */
export function shownPairs(pairs: readonly ShotPair[], theme: Theme): ShotPair[] {
  const pick = pairs.filter((s) => theme === 'both' || s.theme === theme);
  return pick.length ? pick : [...pairs];
}

const themeWord = (B: BpText, t: string | undefined): string => (t === 'light' ? B.cmp_theme_light : t === 'dark' ? B.cmp_theme_dark : t ?? B.cmp_screen);

function Pair({ s, mode }: { s: ShotPair; mode: Mode }) {
  const { B, tx } = useSheet().text;
  const theme = themeWord(B, s.theme);
  const minText = (shot: ShotPair['before']) => { const v = shot?.report?.minTextPx; return typeof v === 'number' ? tx(B.cmp_shot_min_text, { px: v }) : undefined; };
  if (mode === 'slider' && s.before && s.after) return <div className="bp-pair bp-one"><SliderFrame before={s.before} after={s.after} theme={theme} /></div>;
  return (
    <div className="bp-pair">
      <ShotFrame cap={tx(B.cmp_shot_before, { theme })} aside={minText(s.before)}><ShotImg shot={s.before} alt={tx(B.cmp_shot_before, { theme })} /></ShotFrame>
      <ShotFrame cap={tx(B.cmp_shot_after, { theme })} aside={minText(s.after)}><ShotImg shot={s.after} alt={tx(B.cmp_shot_after, { theme })} /></ShotFrame>
    </div>
  );
}

/**
 * The screens (bp Screens): the item's before/after captures, paired by theme and size (compare.ts compareOf, the latest
 * of each phase), in light, dark or both, side by side or as a slider. Only the shown pairs mount images, each asking
 * the seam for its URL. The theme starts at the app's own. bp's blink and change map are not ported (PARITY.md).
 */
export function Screens({ c }: { c: Comparison }) {
  const s = useSheet();
  const { B } = s.text;
  const dark = useIsDarkTheme();
  const [theme, setTheme] = useState<Theme>(dark ? 'dark' : 'light');
  const [mode, setMode] = useState<Mode>('side');
  const show = shownPairs(c.shots, theme);
  const seg = <T extends string>(label: string, opts: readonly [T, string][], value: T, set: (v: T) => void) => (
    <span className="bp-seg" role="group" aria-label={label}>
      {opts.map(([v, word]) => <Press key={v} tone="bp-seg-b typo-code" on={value === v} onClick={() => set(v)}>{word}</Press>)}
    </span>
  );
  return (
    <section className="bp-cmp-sec" data-testid="blueprint-screens">
      <div className="bp-eyebrow bp-scr-head">
        <h4 className="typo-eyebrow">{B.cmp_screens}</h4>
        {c.shots.length ? (
          <span className="bp-scr-ctl">
            {seg(B.cmp_theme_group, [['light', B.cmp_theme_light], ['dark', B.cmp_theme_dark], ['both', B.cmp_theme_both]], theme, setTheme)}
            {seg(B.cmp_mode_group, [['side', B.cmp_mode_side], ['slider', B.cmp_mode_slider]], mode, setMode)}
          </span>
        ) : null}
      </div>
      {!c.shots.length ? <p className="bp-empty typo-body">{B.cmp_shots_none}</p> : (
        <div className="bp-pairs">{show.map((p) => <Pair key={(p.theme ?? '') + '|' + (p.size ?? '')} s={p} mode={mode} />)}</div>
      )}
    </section>
  );
}
