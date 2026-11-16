// COMPARE — the row-aligned dimension matrix: sticky label rail (labels open
// meaning popups), one column per project, every passport dimension in Focus
// ink (healthy rows RECEDE so deficiencies stand), the "Why it's not ready"
// blockers band, and the improve machinery per row class: unified rows get the
// setup gear / live fleet-terminal icon, improvable rows wrap in ImproveCell,
// `llmtracking` renders live wiring instead of the scan's generic "connected".
import { Fragment, type RefObject } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Settings2, TerminalSquare } from 'lucide-react';

import type { FleetSession } from '@/lib/bindings/FleetSession';
import { SECTIONS } from './passportRows';
import type { AppPassport } from './passportModel';
import { INK, inkKindOf, scoreInk } from './passportInk';
import { SectionIcon, RowInfoLabel } from './passportWidgets';
import { ImproveCell } from './improve/ImproveCell';
import { LlmTrackingCell } from './LlmTrackingCell';
import { PASSPORT_FLEET_INK, passportDispatchKey } from './passportFleet';
import { CoverBody, type CoverBodyProps } from './CoverBody';
import { InkWallCell } from './InkWallCell';
import { COPY, IMPROVABLE_ROWS, UNIFIED_ROWS, coverMotion } from './wallConfig';

export interface WallSetupTarget { rowKey: string; rowLabel: string; passport: AppPassport; currentLabel: string }

// The cover already carries the two headline seals — don't repeat them as rows.
const BODY_SECTIONS = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => !r.headline) }));

const RAIL = 'sticky left-0 z-20 bg-background';
const COL_CHROME = 'border-l border-hair';

export function WallCompareTable({
  columns, reduce, coverProps, scrollRef, fleetSessions, onOpenSetup, onOpenTerminal, renderActions,
}: {
  columns: AppPassport[];
  reduce: boolean | null;
  coverProps: (p: AppPassport) => CoverBodyProps;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Live fleet sessions per dispatch key — drives the unified rows' terminal icon. */
  fleetSessions: Map<string, FleetSession>;
  onOpenSetup: (target: WallSetupTarget) => void;
  onOpenTerminal: (dispatchKey: string) => void;
  /** Per-project action buttons rendered on the FIRST group's header line
   *  (the "Stack" band) — the wall's consent-gated action row. */
  renderActions?: (p: AppPassport) => React.ReactNode;
}) {
  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-modal border border-hair bg-surface-1 shadow-elevation-1">
      <table className="border-separate border-spacing-0">
        {/* passport covers */}
        <thead>
          <tr>
            <th className={`${RAIL} w-[190px] min-w-[190px] px-3 py-3 text-left align-bottom border-b-2 border-hair`}>
              <span className="typo-label text-ink-3">{COPY.compare}</span>
            </th>
            {columns.map((p) => (
              <motion.th
                key={p.identity.slug}
                {...coverMotion(p.identity.slug, reduce)}
                className={`min-w-[236px] w-[236px] px-3 py-3 text-left align-top border-b-2 border-hair ${COL_CHROME}`}
                style={{ borderTop: `2px solid ${scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score))}55` }}
              >
                <CoverBody {...coverProps(p)} />
              </motion.th>
            ))}
          </tr>
        </thead>

        <motion.tbody
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: reduce ? 0 : 0.12 }}
        >
          {BODY_SECTIONS.map((section, sectionIdx) => (
            <Fragment key={section.key}>
              {sectionIdx === 0 && renderActions ? (
                <tr>
                  {/* the FIRST group header doubles as the ACTIONS row — the
                      section label keeps the rail, each project column gets its
                      consent-gated action buttons, well visible up top */}
                  <td className={`${RAIL} px-3 py-1.5 border-t border-hair bg-surface-1 align-middle`}>
                    <span className="inline-flex items-center gap-1.5 typo-label text-ink-2 whitespace-nowrap">
                      <SectionIcon name={section.icon} className="w-3.5 h-3.5 text-primary/70" />
                      {section.label}
                    </span>
                  </td>
                  {columns.map((p) => (
                    <td key={p.identity.slug} className={`px-3 py-1 border-t border-hair bg-surface-1 align-middle ${COL_CHROME}`}>
                      {renderActions(p)}
                    </td>
                  ))}
                </tr>
              ) : (
                <tr>
                  {/* full-width band so the section name spreads across the row instead of wrapping in the narrow rail */}
                  <td colSpan={columns.length + 1} className="border-t border-hair bg-surface-1 p-0">
                    <span className="sticky left-0 z-10 inline-flex items-center gap-1.5 typo-label text-ink-2 whitespace-nowrap px-3 py-1.5">
                      <SectionIcon name={section.icon} className="w-3.5 h-3.5 text-primary/70" />
                      {section.label}
                    </span>
                  </td>
                </tr>
              )}
              {section.rows.map((row) => (
                <tr key={row.key} className="hover:bg-primary/[0.02] transition-colors">
                  <td className={`${RAIL} px-3 py-2 border-t border-hair align-top`}>
                    <RowInfoLabel label={row.label} info={row.info} />
                  </td>
                  {columns.map((p) => {
                    const value = row.get(p);
                    const kind = inkKindOf(value);
                    // Healthy/informational cells recede; deficiencies and
                    // setup invitations keep full ink.
                    const recede = kind === 'good' || kind === 'info';
                    const cell =
                      row.key === 'llmtracking' ? (
                        <LlmTrackingCell slug={p.identity.slug} label={value.kind === 'present' ? value.label : null} />
                      ) : (
                        <InkWallCell value={value} />
                      );
                    return (
                      <td key={p.identity.slug} className={`px-3 py-2 align-top border-t border-hair ${COL_CHROME} ${recede ? 'opacity-45' : ''}`}>
                        {UNIFIED_ROWS.has(row.key) ? (() => {
                          const dk = passportDispatchKey(row.key, p.identity.slug);
                          const fl = fleetSessions.get(dk);
                          const currentLabel = value.kind === 'ordinal' ? value.label : value.kind === 'present' ? (value.label ?? 'not set') : '';
                          return (
                            <span className="group/uni relative flex items-start w-full gap-1" data-testid={`unified-${row.key}-${p.identity.slug}`}>
                              <span className="min-w-0 flex-1">{cell}</span>
                              {fl ? (
                                <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onOpenTerminal(dk)} tooltip={`Fleet is working this row: ${String(fl.state).replace('_', ' ')} (click to open the terminal)`} data-testid={`unified-fleet-${row.key}-${p.identity.slug}`}>
                                  <TerminalSquare
                                    className={`w-3.5 h-3.5 ${fl.state === 'running' || fl.state === 'spawning' ? 'animate-pulse' : ''}`}
                                    style={{ color: PASSPORT_FLEET_INK[String(fl.state)] ?? INK.violet }}
                                    aria-hidden
                                  />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon-sm" className="shrink-0 transition-opacity" onClick={() => onOpenSetup({ rowKey: row.key, rowLabel: row.label, passport: p, currentLabel })} tooltip={`Set up ${row.label}`} data-testid={`unified-setup-${row.key}-${p.identity.slug}`}>
                                  <Settings2 className="w-3.5 h-3.5" style={{ color: INK.teal }} aria-hidden />
                                </Button>
                              )}
                            </span>
                          );
                        })() : IMPROVABLE_ROWS.has(row.key) ? (
                          <ImproveCell slug={p.identity.slug} rowKey={row.key} passport={p}>{cell}</ImproveCell>
                        ) : (
                          cell
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}

          {/* the deficiency band — the Wall's signature payload */}
          <tr>
            <td className={`${RAIL} px-3 py-2 border-t-2 border-dashed border-hair align-top`}>
              <span className="inline-flex items-center gap-1.5 typo-label text-status-error">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                {COPY.blockersTitle}
              </span>
            </td>
            {columns.map((p) => {
              const blockers = [...p.productionReadiness.blockers, ...p.automationReadiness.blockers];
              return (
                <td key={p.identity.slug} className={`px-3 py-2 align-top border-t-2 border-dashed border-hair ${COL_CHROME}`}>
                  {blockers.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 typo-caption text-status-success">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> {COPY.clear}
                    </span>
                  ) : (
                    <ul className="space-y-1">
                      {blockers.map((b, i) => (
                        <li key={i} className="flex gap-1.5 typo-caption text-ink-2">
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-status-error flex-shrink-0" aria-hidden />
                          <span style={{ fontWeight: 400 }}>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              );
            })}
          </tr>
        </motion.tbody>
      </table>
    </div>
  );
}
