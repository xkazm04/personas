/* eslint-disable custom/enforce-base-modal --
 * An anchored options popup under its header key, not a centred modal: a
 * BaseModal backdrop would cover the header it belongs to. role="dialog" +
 * aria-label give it the right semantics; Esc, outside press and focus are
 * handled below. */
/**
 * AthenaAutonomyOption — Athena's quick behaviour setup behind ONE header key,
 * shared by the Current header and the Halo frame's keys.
 *
 * The key shows the autonomy state (the host's active look while autonomous
 * mode is on). A click opens a small anchored popup with three buttons:
 * Power (autonomous mode on/off), Cadence and Boldness. Cadence and Boldness
 * each reveal their controls inside the popup, one at a time. While autonomous
 * mode is off both read as dormant and say why; they apply only while it runs.
 *
 * Esc or a press outside closes it (`useAppKeyboard` at the overlay rung).
 * Focus moves to the Power button on open, Tab cycles inside the popup, and
 * focus returns to the key on close.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Gauge, Infinity as InfinityIcon, Power, Timer } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useAnchoredPortalPosition } from '@/features/shared/components/forms/useAnchoredPortalPosition';
import { FleetBoldnessDial, useFleetBoldness } from '../FleetBoldnessDial';
import { WakeCadence, useWakeCadence } from '../WakeCadence';
import { setAutonomousMode } from './athenaChatActions';

/** How a host header draws its keys; the option key wears the same shape. */
export interface HeaderKeyLook {
  button: string;
  active: string;
  icon: string;
  stroke?: number;
}

type Section = 'cadence' | 'boldness';

const POPUP_WIDTH = 344;
const EDGE = 8;

export function AthenaAutonomyOption({ look }: { look: HeaderKeyLook }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const autonomous = useSystemStore((s) => s.companionAutonomousMode);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = `${c.autonomy_options} · ${autonomous ? c.autonomy_on : c.autonomy_off}`;

  return (
    <>
      <Tooltip content={label} placement={open ? 'top' : 'bottom'}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="companion-autonomy-options"
          data-autonomous={autonomous ? 'true' : 'false'}
          className={`grid place-items-center shrink-0 transition-colors focus-ring ${look.button} ${
            autonomous ? look.active : ''
          }`}
        >
          <InfinityIcon className={look.icon} strokeWidth={look.stroke} />
        </button>
      </Tooltip>
      {open && <AutonomyPopup anchorRef={triggerRef} onClose={() => setOpen(false)} />}
    </>
  );
}

function AutonomyPopup({
  anchorRef,
  onClose,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const reduceMotion = useReducedMotion();
  const autonomous = useSystemStore((s) => s.companionAutonomousMode);
  const [section, setSection] = useState<Section | null>(null);
  const hintId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const powerRef = useRef<HTMLButtonElement>(null);
  const pos = useAnchoredPortalPosition(anchorRef, true, { flip: true, maxMenuHeight: 320, gap: 8 });
  const cadence = useWakeCadence(true);
  const boldness = useFleetBoldness(true);

  const close = useCallback(() => onClose(), [onClose]);
  useClickOutside([anchorRef, panelRef], true, close);
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      close();
      return true;
    },
    { priority: OVERLAY_DISMISS_PRIORITY },
  );

  const placed = pos !== null;
  useEffect(() => {
    if (placed) powerRef.current?.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    const anchor = anchorRef.current;
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && anchor && document.contains(anchor)) anchor.focus({ preventScroll: true });
    };
  }, [anchorRef]);

  // Turning autonomy off folds the open control: it no longer applies.
  useEffect(() => {
    if (!autonomous) setSection(null);
  }, [autonomous]);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = [
      ...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'),
    ].filter((el) => el.tabIndex >= 0);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!pos) return null;
  const left = Math.max(EDGE, Math.min(pos.left + pos.width - POPUP_WIDTH, window.innerWidth - POPUP_WIDTH - EDGE));

  return createPortal(
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label={c.autonomy_options}
      data-testid="companion-autonomy-popup"
      onKeyDown={trapTab}
      initial={reduceMotion ? false : { opacity: 0, y: pos.flipUp ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{
        top: pos.flipUp ? undefined : pos.top,
        bottom: pos.flipUp ? window.innerHeight - pos.top : undefined,
        left,
        width: POPUP_WIDTH,
      }}
      className="fixed z-[9995] rounded-card border border-primary/20 bg-background shadow-elevation-4 p-3"
    >
      <div className="px-0.5">
        <p className="typo-label uppercase tracking-wider text-primary">{c.autonomy_options}</p>
        <p className="mt-0.5 typo-caption text-foreground">
          {autonomous ? c.autonomy_status_on : c.autonomy_status_off}
        </p>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Tile
          buttonRef={powerRef}
          icon={Power}
          label={c.autonomy_power}
          value={autonomous ? c.autonomy_on : c.autonomy_off}
          pressed={autonomous}
          lit={autonomous}
          onClick={() => setAutonomousMode(!autonomous)}
          testId="companion-toggle-autonomous"
        />
        <Tile
          icon={Timer}
          label={c.autonomy_cadence}
          value={cadence.windowMinutes === null ? null : cadence.labelFor(cadence.windowMinutes)}
          expanded={section === 'cadence'}
          dormant={!autonomous}
          describedBy={autonomous ? undefined : hintId}
          onClick={() => setSection((s) => (s === 'cadence' ? null : 'cadence'))}
          testId="companion-autonomy-cadence"
        />
        <Tile
          icon={Gauge}
          label={c.boldness_label}
          value={boldness.labelFor(boldness.level)}
          expanded={section === 'boldness'}
          dormant={!autonomous}
          describedBy={autonomous ? undefined : hintId}
          onClick={() => setSection((s) => (s === 'boldness' ? null : 'boldness'))}
          testId="companion-autonomy-boldness"
        />
      </div>

      {!autonomous && (
        <p
          id={hintId}
          className="mt-2.5 px-0.5 typo-caption text-foreground"
          data-testid="companion-autonomy-needs-power"
        >
          {c.autonomy_needs_power}
        </p>
      )}

      <Collapse open={autonomous && section === 'cadence'} unmountWhenClosed>
        <div className="mt-3 border-t border-primary/10 pt-3">
          <WakeCadence cadence={cadence} />
        </div>
      </Collapse>
      <Collapse open={autonomous && section === 'boldness'} unmountWhenClosed>
        <div className="mt-3 border-t border-primary/10 pt-3">
          <FleetBoldnessDial boldness={boldness} />
        </div>
      </Collapse>
    </motion.div>,
    document.body,
  );
}

function Tile({
  buttonRef,
  icon: Icon,
  label,
  value,
  describedBy,
  pressed,
  expanded,
  lit = false,
  dormant = false,
  onClick,
  testId,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** Null until it has been read: the tile shows a dash, never a made-up value. */
  value: string | null;
  /** The dormant explanation, for assistive tech. */
  describedBy?: string;
  pressed?: boolean;
  expanded?: boolean;
  lit?: boolean;
  /** Autonomy is off: the control does not apply, so the tile reads dormant and does nothing. */
  dormant?: boolean;
  onClick: () => void;
  testId: string;
}) {
  const on = lit || expanded;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={dormant ? undefined : onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-disabled={dormant || undefined}
      aria-describedby={describedBy}
      data-testid={testId}
      className={`w-full flex flex-col items-center gap-1 rounded-interactive border px-2 py-2.5 transition-colors focus-ring ${
        dormant
          ? 'cursor-not-allowed border-foreground/10 text-foreground/55'
          : on
            ? 'border-primary/40 bg-primary/15 text-primary'
            : 'border-foreground/12 text-foreground hover:bg-secondary/50'
      }`}
    >
      <span
        className={`grid place-items-center w-8 h-8 rounded-full ${
          lit ? 'bg-primary text-background' : dormant ? 'bg-foreground/[0.06]' : 'bg-primary/10 text-primary'
        }`}
        aria-hidden
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="typo-caption">{label}</span>
      <span className={`typo-caption tabular-nums ${dormant ? '' : 'text-foreground/75'}`}>{value ?? '—'}</span>
    </button>
  );
}
