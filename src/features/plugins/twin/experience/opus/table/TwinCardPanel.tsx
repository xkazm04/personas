/**
 * The twin's own card, filling in as the person plays. It reads only what is
 * STORED (`session.values`, readiness), so every number on it moved because
 * something was kept — a kept offer lands here, and the stat it changed pops.
 *
 * It is the ONE permanent panel beside the table: the reward loop. What used
 * to be two more panels below it (style, played pile) now come in as `footer`
 * rows of this same card — see `SideRows`.
 */

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { MessageSquareQuote, ShieldCheck, Sparkles } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { safeJsonParse } from '@/lib/utils/parseJson';
import { useSystemStore } from '@/stores/systemStore';
import { genderDefFromPronouns } from '../../../shared/gender';
import type { SetupSessionApi } from '../../../setup/setupContract';
import { channelName } from '../suits';

/** Items in a stored JSON-array column; anything else counts as one if present. */
function countItems(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return 0;
  const [parsed] = safeJsonParse(trimmed);
  return Array.isArray(parsed) ? parsed.length : 1;
}

/** A number that pops when it changes. */
function Stat({ value }: { value: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      key={value}
      initial={reduced ? false : { scale: 1.5 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="inline-block tabular-nums typo-data text-foreground"
    >
      {value}
    </motion.span>
  );
}

export function TwinCardPanel({ session, footer }: { session: SetupSessionApi; footer?: ReactNode }) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus.twinCard;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const pronouns = useSystemStore(
    (s) => s.twinProfiles.find((p) => p.id === activeTwinId)?.pronouns ?? null,
  );
  const sigil = genderDefFromPronouns(pronouns);
  const { values } = session;
  const memories = session.checklist.find((c) => c.id === 'memories')?.detail ?? '';

  return (
    <section
      className="xo-suit-identity xo-card xo-card-raised xo-foil xo-glow rounded-modal overflow-hidden"
      aria-label={xo.label}
      data-testid="xo-twin-card"
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-[color-mix(in_oklab,var(--xo-hue)_12%,transparent)]">
        <span
          aria-hidden
          className={`w-11 h-11 flex-shrink-0 rounded-card flex items-center justify-center bg-gradient-to-br ${sigil.tint}`}
        >
          <span className={`typo-heading-lg ${sigil.color}`}>{sigil.glyph}</span>
        </span>
        <div className="min-w-0">
          <p className="typo-title-lg text-foreground truncate">{values.name || xo.unnamed}</p>
          <p className="typo-caption truncate">{values.role || xo.noRole}</p>
        </div>
      </div>

      <p className="px-4 py-3 typo-body text-foreground line-clamp-4 border-b border-primary/10">
        {values.bio || xo.noBio}
      </p>

      <ul className="px-4 py-3 space-y-2" aria-label={xo.voices}>
        {session.toneChannels.map((channel) => {
          const samples = countItems(values[`tone:${channel}:examples`]);
          const rules = countItems(values[`tone:${channel}:constraints`]);
          return (
            <li key={channel} className="flex items-center gap-2 typo-caption">
              <span className="min-w-0 flex-1 truncate text-foreground">
                {channelName(channel, xo.everywhere)}
                {!values[`tone:${channel}`] && <span className="ml-1.5">{xo.noVoice}</span>}
              </span>
              <span className="sr-only">{tx(xo.samplesAndRules, { samples, rules })}</span>
              <span aria-hidden className="inline-flex items-center gap-1">
                <MessageSquareQuote className="w-3.5 h-3.5 text-primary" />
                <Stat value={samples} />
              </span>
              <span aria-hidden className="inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <Stat value={rules} />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-primary/10 typo-caption">
        <Sparkles className="w-3.5 h-3.5 text-primary" aria-hidden />
        <span className="flex-1">{tx(xo.memories, { detail: memories })}</span>
      </div>

      {footer}
    </section>
  );
}

export default TwinCardPanel;
