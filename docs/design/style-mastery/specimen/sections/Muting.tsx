// Section b: the muting forms the app writes today, then the one proposed
// level. Ratios are the canvas contrast for the active theme (contrast.mjs).
import { Section, Split, type View } from '../parts';
import { SAMPLE, type ThemeName } from '../specimenData';
import contrast from '../contrast.generated.json';
import measure from '../measure.generated.json';

type MutingKey = keyof (typeof contrast.themes)['dark-midnight']['muting'];

const m = measure.muting;
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

const CURRENT: { cls: string; label: string; ratio: MutingKey; count: string }[] = [
  { cls: 'typo-caption', label: 'typo-caption (foreground 70%, @layer base)', ratio: 'typo-caption (70%)', count: `${m.caption} uses` },
  { cls: 'typo-body text-foreground/60', label: 'text-foreground/N (shown at /60)', ratio: 'text-foreground/60', count: `${m.fgSlashTotal} uses across ${Object.keys(m.fgSlash).length} values of N` },
  { cls: 'typo-body text-foreground/40', label: 'text-foreground/N (shown at /40)', ratio: 'text-foreground/40', count: `${(m.fgSlash as Record<string, number>)['40'] ?? 0} at /40` },
  { cls: 'typo-body text-foreground opacity-60', label: 'text-foreground + opacity-NN', ratio: 'text-foreground opacity-60', count: `${m.fgOpacityUnits} class strings` },
  { cls: 'typo-body text-muted-foreground', label: 'text-muted-foreground', ratio: 'text-muted-foreground', count: `${sum(m.mutedForeground)} uses (+ text-muted ${m.textMuted}, text-muted-dark ${m.textMutedDark})` },
];

export function Muting({ view, theme }: { view: View; theme: ThemeName }) {
  const ratios = contrast.themes[theme].muting;
  return (
    <Section id="muting" title="Muting" note="Contrast on the canvas of the active theme; AA body text needs 4.5:1.">
      <Split view={view}>
        {(mode) => mode === 'current' ? (
          <div className="sp-stack-lg">
            {CURRENT.map((f) => (
              <div key={f.cls} className="sp-stack">
                <div className="typo-label text-foreground">{f.label}</div>
                <div className={f.cls}>{SAMPLE.sentence}</div>
                <div className="typo-caption tabular-nums">{ratios[f.ratio]}:1 on canvas. {f.count}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="sp-stack-lg">
            <div className="sp-stack">
              <div className="typo-label text-foreground">ONE level: --ink-muted, foreground at 70%</div>
              <div className="typo-title text-foreground">{SAMPLE.agent}</div>
              <div className="typo-caption">{SAMPLE.sentence}</div>
              <div className="typo-caption tabular-nums">
                {ratios['proposed ink-muted on canvas']}:1 on canvas, {ratios['proposed ink-muted on card']}:1 on a card
              </div>
            </div>
            <div className="sp-stack">
              <div className="typo-label text-foreground">Carried by typo-caption; text-ink-muted for anything that is not a caption</div>
              <div className="typo-data">{SAMPLE.metric} <span className="text-ink-muted">runs this week</span></div>
            </div>
            <div className="sp-stack">
              <div className="typo-label text-foreground">A colour beside the caption still wins (the caption colour is a layered default)</div>
              <div className="typo-caption text-status-error">Could not reach the invoice mailbox. Retrying in 30 seconds.</div>
              <div className="typo-caption text-role-agent">Drafted by the agent, waiting for your review.</div>
            </div>
            <div className="sp-stack">
              <div className="typo-label text-foreground">Never: opacity or a /N below the level</div>
              <div className="typo-caption">Every text-foreground/N, opacity-NN and text-muted-foreground maps to this one level (migration-map.md).</div>
            </div>
          </div>
        )}
      </Split>
    </Section>
  );
}
