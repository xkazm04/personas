// Passport variant — "Focus". Instead of reading every project side-by-side in
// a narrow-column matrix, this renders ONE project full-width with spread
// spacing: a hero band (identity + both readiness axes + golden gauge + trend),
// a prominent "why it's not ready" panel, then the readiness sections as roomy
// two-column cards where each dimension gets a full label + value line (and the
// improvable ones keep their inline improve popover). A wrapping project picker
// switches focus. The trade-off vs the baseline: depth-per-project over
// at-a-glance cross-project comparison.
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ArrowUpRight, FileDown } from 'lucide-react';

import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { passportToMarkdown } from './passportExport';
import { SECTIONS } from './passportRows';
import {
  scoreTint, ARCHETYPE_LABEL, LIFECYCLE_LABEL, CRITICALITY_LABEL,
} from './passportModel';
import { ScoreBar, Chip, SectionIcon } from './passportWidgets';
import { GoldenGauge } from './improve/GoldenGauge';
import { ReadinessTrend } from './ReadinessTrend';
import { WarningBadge } from './WarningBadge';
import { StandardsScan } from './improve/StandardsScan';
import { ImproveCell } from './improve/ImproveCell';
import { WallCell, IMPROVABLE_ROWS, type PassportViewProps } from './ProjectsPassportWall';

const COPY = {
  blockersTitle: 'Why it’s not ready',
  clear: 'Ready — no blockers found',
  automation: 'Automation',
  production: 'Production',
  pick: 'Focus',
};

export function ProjectsPassportFocus({
  passports,
  openSlugs,
  onOpen,
  attentionByProject,
  onJumpKpi,
}: PassportViewProps) {
  const reduce = useReducedMotion();
  const [slug, setSlug] = useState<string>(passports[0]?.identity.slug ?? '');
  const p = passports.find((x) => x.identity.slug === slug) ?? passports[0];

  if (!p) {
    return <div className="py-16 text-center typo-body text-foreground/50">No projects to show.</div>;
  }

  const openable = Boolean(openSlugs?.has(p.identity.slug) && onOpen);
  const critical = p.identity.criticality === 'mission-critical';
  const tint = scoreTint(p.automationReadiness.score);
  const blockers = [...p.productionReadiness.blockers, ...p.automationReadiness.blockers];
  const attention = attentionByProject?.get(p.identity.slug) ?? [];
  // Cover carries the two headline seals — don't repeat them as rows.
  const bodySections = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => !r.headline) }));

  return (
    <div className="space-y-4">
      {/* Project picker — a wrapping row; each carries its automation-readiness dot. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="typo-label text-foreground/40 mr-1">{COPY.pick}</span>
        {passports.map((x) => {
          const active = x.identity.slug === p.identity.slug;
          const t = scoreTint(x.automationReadiness.score);
          return (
            <button
              key={x.identity.slug}
              type="button"
              onClick={() => setSlug(x.identity.slug)}
              aria-current={active ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive border typo-caption transition-colors ${
                active
                  ? 'border-primary/30 bg-primary/10 text-foreground'
                  : 'border-primary/10 text-foreground/60 hover:text-foreground hover:bg-primary/5'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: t.hex }} />
              <span className="truncate max-w-[160px]">{x.identity.name}</span>
            </button>
          );
        })}
      </div>

      <motion.div
        key={p.identity.slug}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.22 }}
        className="space-y-4"
      >
        {/* Hero — identity + both readiness axes, full width */}
        <div
          className="relative overflow-hidden rounded-modal border border-primary/10 p-5"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${tint.hex} 8%, transparent), transparent 60%)`,
            borderTop: `2px solid color-mix(in srgb, ${tint.hex} 40%, transparent)`,
          }}
        >
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {openable ? (
                  <button type="button" onClick={() => onOpen!(p.identity.slug)} className="group/f inline-flex items-center gap-1 min-w-0 text-left">
                    <span className="typo-hero truncate group-hover/f:text-primary transition-colors">{p.identity.name}</span>
                    <ArrowUpRight className="w-4 h-4 flex-shrink-0 opacity-0 group-hover/f:opacity-100 text-primary/70 transition-opacity" aria-hidden />
                  </button>
                ) : (
                  <span className="typo-hero truncate block">{p.identity.name}</span>
                )}
                <WarningBadge projectName={p.identity.name} items={attention} onJump={(g, k) => onJumpKpi?.(p.identity.slug, g, k)} />
                <StandardsScan slug={p.identity.slug} projectName={p.identity.name} />
                <CopyButton
                  text={passportToMarkdown(p, Date.now())}
                  icon={<FileDown className="w-3.5 h-3.5" />}
                  tooltip="Copy readiness report (markdown)"
                  className="flex-shrink-0 p-0.5 text-foreground/45 hover:text-primary"
                />
              </div>
              <p className="typo-body text-foreground mt-1.5 max-w-2xl">{p.identity.purpose}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Chip label={ARCHETYPE_LABEL[p.identity.archetype]} />
                <Chip label={LIFECYCLE_LABEL[p.identity.lifecycle]} />
                <span className={`typo-label ${critical ? 'text-red-300' : 'text-foreground/40'}`}>{CRITICALITY_LABEL[p.identity.criticality]}</span>
              </div>
            </div>

            {/* Readiness axes — given real room here, side by side. */}
            <div className="flex items-start gap-6 flex-wrap">
              <div className="w-[220px] space-y-2.5">
                <ScoreBar label={COPY.automation} kind="level" level={p.automationReadiness.level} score={p.automationReadiness.score} />
                <ScoreBar label={COPY.production} kind="band" band={p.productionReadiness.band} score={p.productionReadiness.score} />
              </div>
              <div className="flex items-center gap-4">
                <GoldenGauge passport={p} />
                <ReadinessTrend slug={p.identity.slug} />
              </div>
            </div>
          </div>
        </div>

        {/* Blockers — the signature payload, front and centre in Focus. */}
        <div className={`rounded-modal border p-4 ${blockers.length === 0 ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-red-500/20 bg-red-500/[0.04]'}`}>
          {blockers.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 typo-caption text-emerald-300">
              <CheckCircle2 className="w-4 h-4" aria-hidden /> {COPY.clear}
            </span>
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 typo-label text-red-300/90 mb-2.5">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                {COPY.blockersTitle}
                <span className="text-foreground/40">· {blockers.length}</span>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {blockers.map((b, i) => (
                  <li key={i} className="flex gap-2 typo-caption text-foreground">
                    <span className="mt-2 w-1 h-1 rounded-full bg-red-400 flex-shrink-0" aria-hidden />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Readiness sections — roomy two-column cards; each row a full label+value line. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bodySections.map((section) => (
            <div key={section.key} className="rounded-modal border border-primary/10 bg-secondary/[0.03] p-4">
              <div className="inline-flex items-center gap-1.5 typo-label text-foreground/70 mb-3">
                <SectionIcon name={section.icon} className="w-3.5 h-3.5 text-primary/70" />
                {section.label}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                {section.rows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-3 py-1.5 border-b border-primary/[0.06] last:border-b-0">
                    <span className="typo-caption text-foreground/60 pt-0.5">{row.label}</span>
                    <span className="text-right min-w-0">
                      {IMPROVABLE_ROWS.has(row.key) ? (
                        <ImproveCell slug={p.identity.slug} rowKey={row.key} passport={p}>
                          <WallCell value={row.get(p)} />
                        </ImproveCell>
                      ) : (
                        <WallCell value={row.get(p)} />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
