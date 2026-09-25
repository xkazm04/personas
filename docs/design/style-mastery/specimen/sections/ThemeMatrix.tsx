// Every theme at once: the bound value of each status colour and each
// proposed role, with its contrast on the theme's canvas and on its own chip.
// Data, not rendering: the values come from contrast.generated.json, which
// contrast.mjs computes from globals.css and accent-roles.proposed.css with
// check-themes' maths. The live section above is the rendering proof.
import contrast from '../contrast.generated.json';
import { ROLES, STATUSES } from '../specimenData';

interface Graded { hex: string; onBg: number; onChip: number; onCard: number; pass?: boolean }

function Cell({ g, bar }: { g: Graded | null | undefined; bar: number }) {
  if (!g) return <td className="typo-caption">n/a</td>;
  const low = Math.min(g.onBg, g.onChip) < bar;
  return (
    <td className="typo-data tabular-nums text-foreground" data-low={low || undefined}>
      <span className="sp-dot" style={{ background: g.hex }} />
      {g.onBg}
      <span className="typo-caption"> / {g.onChip}</span>
      {low && <span className="text-status-error"> low</span>}
    </td>
  );
}

export function ThemeMatrix() {
  const themes = Object.entries(contrast.themes);
  return (
    <div className="sp-col" style={{ marginTop: '1.5rem', overflowX: 'auto' }} data-matrix="themes">
      <div className="sp-col-head">
        <span className="typo-heading text-foreground">All eleven themes</span>
        <span className="typo-caption">
          text on canvas / on its own 10% chip. Status bar (check-themes) {contrast.bars.status}:1; roles are held to {contrast.bars.text}:1.
          Roles below bar: {contrast.rolesBelowTextBar}.
        </span>
      </div>
      <table className="sp-matrix">
        <thead>
          <tr>
            <th className="typo-label text-foreground">theme</th>
            {STATUSES.map((s) => <th key={s} className="typo-label text-foreground">status-{s}</th>)}
            {ROLES.map((r) => <th key={r.id} className="typo-label text-foreground">role-{r.id}</th>)}
            <th className="typo-label text-foreground">ink-muted</th>
          </tr>
        </thead>
        <tbody>
          {themes.map(([id, t]) => (
            <tr key={id} data-theme-row={id}>
              <td className="typo-heading text-foreground">
                <span className="sp-dot" style={{ background: t.bg, outline: '1px solid var(--border)' }} />
                {id}
              </td>
              {STATUSES.map((s) => <Cell key={s} g={(t.status as Record<string, Graded | undefined>)[s]} bar={contrast.bars.status} />)}
              {ROLES.map((r) => <Cell key={r.id} g={(t.roles as Record<string, Graded | null>)[r.id]} bar={contrast.bars.text} />)}
              <td className="typo-data tabular-nums text-foreground">{t.muting['proposed ink-muted on canvas']}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
