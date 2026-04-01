const RING_SIZE = 36;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function RotationCountdownRing({
  countdown,
  nextRotationAt,
  intervalDays,
}: {
  countdown: string;
  nextRotationAt: string;
  intervalDays: number;
}) {
  const totalSeconds = intervalDays * 86400;
  const remainingSeconds = Math.max(0, (new Date(nextRotationAt).getTime() - Date.now()) / 1000);
  const fraction = Math.min(1, remainingSeconds / totalSeconds);
  const dashoffset = RING_CIRCUMFERENCE * (1 - fraction);
  const cx = RING_SIZE / 2;
  const cy = RING_SIZE / 2;

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      className="shrink-0"
      role="img"
      aria-label={`Rotation in ${countdown}`}
    >
      {/* Track */}
      <circle
        cx={cx}
        cy={cy}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        className="text-cyan-500/10"
        strokeWidth={RING_STROKE}
      />
      {/* Progress arc -- starts from 12 o'clock */}
      <circle
        cx={cx}
        cy={cy}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        className="text-cyan-400"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashoffset}
        style={{
          transform: 'rotate(-90deg)',
          transformOrigin: 'center',
          transition: 'stroke-dashoffset 0.6s ease',
        }}
      />
      {/* Countdown text centered inside the ring */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-muted-foreground/90"
        style={{ fontSize: '9px', fontFamily: 'ui-monospace, monospace' }}
      >
        {countdown}
      </text>
    </svg>
  );
}
