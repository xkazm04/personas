/**
 * Fusion · a turn's machine rows, summarised. At rest: one short tick per
 * row, coloured by kind (`MACHINE_TONE`), with nothing to read. Pressed, the
 * strip opens IN PLACE into the rows themselves, each through Current's own
 * renderers (`AthenaChatCanvasNote` for a canvas readback, `AthenaChatSystemNote`
 * for a lookup, a fleet event or a dispatcher note), so what she looked up is
 * one click away and never noise in the conversation.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { AthenaChatCanvasNote } from '../../../../AthenaChatCanvasNote';
import { AthenaChatSystemNote } from '../../../../AthenaChatSystemNote';
import { parseCanvasNote } from '../../../../athenaChatCanvasSummary';
import { MACHINE_TONE, type MachineRow } from '../../../exchange';
import { FUSION_COPY as F } from './copy';
import { EASE } from './text';

const SHOWN = 24;

export function MachineFold({ rows, index }: { rows: MachineRow[]; index: number }) {
  const { shouldAnimate } = useMotion();
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SHOWN);
  const extra = rows.length - shown.length;
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="fu-ticks"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? F.hideMachine : F.machine(rows.length)}
        data-testid="companion-fusion-machine"
      >
        {shown.map((m) => (
          <i key={m.id} style={{ ['--c' as string]: MACHINE_TONE[m.kind] }} aria-hidden />
        ))}
        {extra > 0 && <span className="typo-caption">{F.more(extra)}</span>}
        <span className="typo-caption fu-ticks-n">{rows.length}</span>
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            className="fu-machine-rows"
            data-testid="companion-fusion-machine-rows"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.26 : 0, ease: EASE }}
          >
            {rows.map((m, i) => {
              const canvas = m.kind === 'canvas' ? parseCanvasNote(m.content) : null;
              return canvas ? (
                <AthenaChatCanvasNote key={m.id} note={canvas} />
              ) : (
                <AthenaChatSystemNote key={m.id} content={m.content} compact index={index * 100 + i} />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
