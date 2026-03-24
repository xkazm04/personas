import { useEffect, useRef } from 'react';
/* -- AI-generated celebration illustration ------------------------ */
export function CelebrationIllustration({ icon: _icon, color: _color }: { icon: string; color: string }) {
  return (
    <div
      className="animate-fade-slide-in w-40 h-30 mx-auto flex items-center justify-center"
    >
      <img
        src="/illustrations/adopt-celebration.png"
        alt=""
        aria-hidden="true"
        width={160}
        height={120}
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}

/* -- CSS-only confetti burst -------------------------------------- */

const CONFETTI_COUNT = 18;
const COLORS = [
  'rgb(52,211,153)',   // emerald-400
  'rgb(139,92,246)',   // violet-500
  'rgb(96,165,250)',   // blue-400
  'rgb(251,191,36)',   // amber-400
  'rgb(16,185,129)',   // emerald-500
  'rgb(167,139,250)',  // violet-400
];

function generateParticles() {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const angle = (i / CONFETTI_COUNT) * 360 + (Math.random() * 30 - 15);
    const distance = 50 + Math.random() * 50;
    const rad = (angle * Math.PI) / 180;
    const tx = Math.cos(rad) * distance;
    const ty = Math.sin(rad) * distance - 20; // bias upward
    const size = 3 + Math.random() * 4;
    const color = COLORS[i % COLORS.length];
    const delay = Math.random() * 0.15;
    const rotation = Math.random() * 360;
    const isRect = i % 3 !== 0;
    return { tx, ty, size, color, delay, rotation, isRect };
  });
}

export function ConfettiBurst() {
  const particles = useRef(generateParticles());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Remove confetti after animation completes to avoid lingering DOM nodes
    const timer = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.style.display = 'none';
      }
    }, 1400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
    >
      <style>{`
        @keyframes confetti-burst {
          0% {
            transform: translate(0, 0) rotate(0deg) scale(1);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .confetti-particle { animation: none !important; opacity: 0 !important; }
        }
      `}</style>
      <div className="relative w-full h-full flex items-center justify-center">
        {particles.current.map((p, i) => (
          <span
            key={i}
            className="confetti-particle absolute"
            style={{
              width: p.isRect ? p.size : p.size * 0.8,
              height: p.isRect ? p.size * 0.6 : p.size * 0.8,
              borderRadius: p.isRect ? '1px' : '50%',
              backgroundColor: p.color,
              ['--tx' as string]: `${p.tx}px`,
              ['--ty' as string]: `${p.ty}px`,
              ['--rot' as string]: `${p.rotation}deg`,
              animation: `confetti-burst 1.1s ${p.delay}s cubic-bezier(0.22, 1, 0.36, 1) forwards`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
