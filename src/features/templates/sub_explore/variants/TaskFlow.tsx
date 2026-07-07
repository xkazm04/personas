/**
 * Explore Variant 2 — "Task Flow" (job-to-be-done first).
 *
 * Hypothesis: users know the OUTCOME they want ("watch something", "draft
 * something") before they know a category or their own vertical. Pick a job →
 * answer two quick qualifiers (how hands-on, how deep) → get a short RANKED
 * shortlist with a "why this fits" line, not a grid dump. Progressive
 * disclosure keeps cognitive load to ~3 clicks and ~5 results.
 *
 * PROTOTYPE: hardcoded English, mock data.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { TASKS, itemsForTask, taskById, type ExploreItem } from '../exploreMockData';
import { ExploreItemCard } from '../shared/ExploreItemCard';

type Autonomy = 'assistive' | 'balanced' | 'autonomous';
type Depth = 'quick' | 'thorough';

export function TaskFlow({ onSelect }: { onSelect?: (i: ExploreItem) => void }) {
  const [task, setTask] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy>('balanced');
  const [depth, setDepth] = useState<Depth>('quick');

  const ranked = useMemo(() => {
    if (!task) return [];
    const wantAuto = autonomy === 'assistive' ? 0.2 : autonomy === 'balanced' ? 0.5 : 0.85;
    const wantDepth = depth === 'quick' ? 0.35 : 0.85;
    return itemsForTask(task)
      .map((i) => {
        const fit = 1 - (Math.abs(i.traits.autonomy - wantAuto) * 0.6 + Math.abs(i.traits.depth - wantDepth) * 0.4);
        return { i, fit: fit + (i.popularity / 320) * 0.15 };
      })
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 6);
  }, [task, autonomy, depth]);

  if (!task) {
    return (
      <div className="space-y-4">
        <h2 className="typo-heading-lg font-semibold text-foreground">What do you want to get done?</h2>
        <p className="typo-body text-foreground opacity-80">Start from the job — not a category. We'll shortlist the best fits.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TASKS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTask(t.id)}
                className="group text-left rounded-2xl border border-primary/10 hover:border-primary/25 p-5 transition-all flex flex-col gap-3 min-h-[150px]"
                style={{ background: `linear-gradient(155deg, ${t.color}18, transparent 65%)` }}
              >
                <div className="w-11 h-11 rounded-modal flex items-center justify-center" style={{ backgroundColor: `${t.color}22` }}>
                  <Icon className="w-6 h-6" style={{ color: t.color }} />
                </div>
                <div>
                  <div className="typo-heading font-semibold text-foreground">{t.label}</div>
                  <p className="typo-caption text-foreground opacity-80 mt-1">{t.blurb}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const t = taskById(task)!;
  const Icon = t.icon;

  return (
    <div className="space-y-5">
      <button onClick={() => setTask(null)} className="inline-flex items-center gap-1.5 typo-body text-foreground opacity-70 hover:opacity-100">
        <ChevronLeft className="w-4 h-4" /> All jobs
      </button>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-modal flex items-center justify-center" style={{ backgroundColor: `${t.color}22` }}>
          <Icon className="w-6 h-6" style={{ color: t.color }} />
        </div>
        <div>
          <div className="typo-heading-lg font-semibold text-foreground">{t.label}</div>
          <div className="typo-caption text-foreground opacity-80">{t.blurb}</div>
        </div>
      </div>

      {/* Two quick qualifiers that re-rank live */}
      <div className="flex flex-wrap gap-6 rounded-modal border border-primary/10 bg-secondary/10 p-4">
        <Segmented label="How hands-on?" value={autonomy} accent={t.color}
          options={[['assistive', 'Assistive'], ['balanced', 'Balanced'], ['autonomous', 'Autonomous']]}
          onChange={(v) => setAutonomy(v as Autonomy)} />
        <Segmented label="How deep?" value={depth} accent={t.color}
          options={[['quick', 'Quick'], ['thorough', 'Thorough']]}
          onChange={(v) => setDepth(v as Depth)} />
      </div>

      <div className="space-y-2">
        <div className="typo-body font-medium text-foreground">Top {ranked.length} for you</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {ranked.map(({ i, fit }, idx) => (
            <ExploreItemCard
              key={i.id}
              item={i}
              accent={t.color}
              reason={idx === 0 ? 'Best match for how you want to work' : `${Math.round(Math.max(0, fit) * 100)}% fit`}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Segmented({ label, value, options, onChange, accent }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void; accent: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="typo-caption text-foreground opacity-70">{label}</div>
      <div className="inline-flex rounded-input border border-primary/10 p-0.5 bg-background/40">
        {options.map(([val, lbl]) => {
          const active = val === value;
          return (
            <button
              key={val}
              onClick={() => onChange(val)}
              className="px-3 py-1 rounded-input typo-caption transition-colors"
              style={active ? { backgroundColor: `${accent}26`, color: accent } : undefined}
            >
              <span className={active ? '' : 'text-foreground opacity-70'}>{lbl}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
