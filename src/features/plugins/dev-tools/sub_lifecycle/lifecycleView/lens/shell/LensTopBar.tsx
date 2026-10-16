/**
 * The Lens top bar, one fixed row: the trail of planes (each a door back up),
 * the depth indicator and the keys this plane answers to. On a narrow stage
 * the keys and then the depth's words step aside (`lens.css`), never the trail.
 */
import { memo } from 'react';

import { Crumbs, type Crumb } from '@/features/shared/components/kit';

import type { Dl } from '../model/lensWords';

const KEYS = {
  field: [['←', '→'], ['↑', '↓'], ['Enter']] as const,
  detail: [['←', '→'], ['[', ']'], ['Esc']] as const,
};

export const LensTopBar = memo(function LensTopBar({ dl, crumbs, depth, depthLabel, keys }: {
  dl: Dl;
  crumbs: Crumb[];
  depth: 0 | 1 | 2;
  depthLabel: string;
  keys: 'portfolio' | 'project' | 'detail';
}) {
  const words = keys === 'detail'
    ? [dl.lens_keys_step, dl.lens_keys_project, dl.lens_keys_back]
    : [dl.lens_keys_step, dl.lens_keys_item, dl.lens_keys_open];
  const glyphs = keys === 'detail' ? KEYS.detail : KEYS.field;
  return (
    <div className="lens-top" data-testid="lens-top">
      <span className="lens-top-mark" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
          <path d="M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0M15 15l5 5M8 10.5h5" />
        </svg>
      </span>
      <Crumbs items={crumbs} label={dl.lens_crumb_root} testId="lens-crumbs" />
      <span className="lens-depth" aria-hidden>
        {[0, 1, 2].map((d) => <i key={d} className={d === depth ? 'is-on' : undefined} />)}
      </span>
      <span className="lens-depth-label typo-caption" data-testid="lens-depth-label">{depthLabel}</span>
      <span className="lens-keys typo-caption" aria-hidden>
        {glyphs.map((g, i) => (
          <span key={i}>{g.map((k) => <kbd key={k}>{k}</kbd>)} {words[i]}</span>
        ))}
      </span>
    </div>
  );
});
