import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, AlertCircle, Pause,
} from 'lucide-react';
import type { AutomationDeploymentStatus } from '@/lib/bindings/PersonaAutomation';
import { AUTOMATION_STATUS_CONFIG } from '../../libs/automationTypes';

const STATUS_ICON = {
  active: CheckCircle2, draft: AlertCircle, paused: Pause, error: XCircle,
} as const;

const springTransition = { type: 'spring' as const, stiffness: 300, damping: 25, duration: 0.3 };

const pulseKeyframes = { scale: [1, 1.15, 1] };
const pulseDuration = 0.4;

interface ConfettiDot {
  id: number;
  x: number;
  y: number;
  delay: number;
}

function ConfettiBurst() {
  const [dots] = useState<ConfettiDot[]>(() => {
    const count = 3 + Math.floor(Math.random() * 3); // 3-5 dots
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 40,
      y: -(10 + Math.random() * 20),
      delay: Math.random() * 0.1,
    }));
  });

  return (
    <AnimatePresence>
      {dots.map((dot) => (
        <motion.span
          key={dot.id}
          className="absolute w-1.5 h-1.5 rounded-full bg-brand-emerald"
          style={{ top: '50%', left: '50%' }}
          initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          animate={{ opacity: 0, x: dot.x, y: dot.y, scale: 0.3 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, delay: dot.delay, ease: 'easeOut' }}
        />
      ))}
    </AnimatePresence>
  );
}

interface AutomationStatusBadgeProps {
  automationId: string;
  status: AutomationDeploymentStatus;
}

export function AutomationStatusBadge({ automationId, status }: AutomationStatusBadgeProps) {
  const prevStatusRef = useRef(status);
  const [shouldPulse, setShouldPulse] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const hasBeenActiveRef = useRef(status === 'active');

  const statusConfig = AUTOMATION_STATUS_CONFIG[status] ?? AUTOMATION_STATUS_CONFIG.draft;
  const StatusIcon = STATUS_ICON[status] ?? AlertCircle;

  const triggerPulse = useCallback(() => {
    setShouldPulse(true);
    const timer = setTimeout(() => setShouldPulse(false), pulseDuration * 1000 + 50);
    return timer;
  }, []);

  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev !== status) {
      // Status actually changed
      const timer = triggerPulse();

      // Confetti on first-ever activation
      if (status === 'active' && !hasBeenActiveRef.current) {
        hasBeenActiveRef.current = true;
        setShowConfetti(true);
        const confettiTimer = setTimeout(() => setShowConfetti(false), 800);
        prevStatusRef.current = status;
        return () => { clearTimeout(timer); clearTimeout(confettiTimer); };
      }

      prevStatusRef.current = status;
      return () => clearTimeout(timer);
    }
  }, [status, triggerPulse]);

  return (
    <motion.span
      layoutId={`automation-status-${automationId}`}
      className={`relative inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border ${statusConfig.bg} ${statusConfig.color}`}
      transition={springTransition}
      animate={shouldPulse ? pulseKeyframes : { scale: 1 }}
      // @ts-expect-error framer-motion animate duration
      transitionDuration={shouldPulse ? pulseDuration : undefined}
    >
      <StatusIcon className="w-2.5 h-2.5" /> {statusConfig.label}
      {showConfetti && <ConfettiBurst />}
    </motion.span>
  );
}
