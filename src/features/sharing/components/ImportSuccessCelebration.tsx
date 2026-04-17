import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

const CONFETTI_COLORS = ['#34d399', '#06b6d4', '#10b981', '#22d3ee', '#6ee7b7', '#67e8f9'];

function ConfettiParticle({ index }: { index: number }) {
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const left = 10 + (index * 17) % 80;
  const delay = (index * 70) % 400;
  const size = 4 + (index % 3) * 2;
  const rotation = (index * 47) % 360;

  return (
    <rect
      x={left}
      y={-10}
      width={size}
      height={size * 0.6}
      rx={1}
      fill={color}
      opacity={0.85}
      transform={`rotate(${rotation} ${left + size / 2} ${-10 + size * 0.3})`}
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        values={`0 0; ${(index % 2 ? 8 : -8)} 90; ${(index % 2 ? -4 : 12)} 140`}
        dur="1.2s"
        begin={`${delay}ms`}
        fill="freeze"
        additive="sum"
      />
      <animate
        attributeName="opacity"
        values="0;0.85;0.85;0"
        keyTimes="0;0.1;0.7;1"
        dur="1.2s"
        begin={`${delay}ms`}
        fill="freeze"
      />
      <animateTransform
        attributeName="transform"
        type="rotate"
        values={`0 ${left + size / 2} ${-10 + size * 0.3}; ${360 + rotation} ${left + size / 2} ${60}`}
        dur="1.2s"
        begin={`${delay}ms`}
        fill="freeze"
        additive="sum"
      />
    </rect>
  );
}

function PackageUnwrapSvg() {
  return (
    <svg
      viewBox="0 0 160 120"
      width={160}
      height={120}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mx-auto"
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <ConfettiParticle key={i} index={i} />
      ))}
      <g>
        <rect x="45" y="50" width="70" height="50" rx="6" fill="#064e3b" stroke="#34d399" strokeWidth="1.5">
          <animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze" />
        </rect>
        <rect x="76" y="50" width="8" height="50" fill="#10b981" opacity="0.4">
          <animate attributeName="opacity" values="0;0.4" dur="0.3s" fill="freeze" />
        </rect>
        <rect x="45" y="70" width="70" height="8" fill="#10b981" opacity="0.4">
          <animate attributeName="opacity" values="0;0.4" dur="0.3s" fill="freeze" />
        </rect>
        <circle cx="80" cy="50" r="5" fill="#34d399">
          <animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze" />
        </circle>
      </g>
      <g>
        <rect x="42" y="44" width="76" height="14" rx="4" fill="#065f46" stroke="#34d399" strokeWidth="1.5">
          <animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze" />
          <animateTransform attributeName="transform" type="translate" values="0 0; 0 -18" dur="0.5s" begin="0.15s" fill="freeze" />
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;1" dur="0.6s" begin="0.15s" fill="freeze" />
        </rect>
        <rect x="76" y="44" width="8" height="14" fill="#10b981" opacity="0.4">
          <animateTransform attributeName="transform" type="translate" values="0 0; 0 -18" dur="0.5s" begin="0.15s" fill="freeze" />
          <animate attributeName="opacity" values="0.4;0.4;0" keyTimes="0;0.6;1" dur="0.6s" begin="0.15s" fill="freeze" />
        </rect>
      </g>
      <g>
        <circle cx="80" cy="62" r="14" fill="#059669" opacity="0">
          <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.5;1" dur="0.8s" begin="0.3s" fill="freeze" />
          <animateTransform attributeName="transform" type="translate" values="0 10; 0 -12" dur="0.5s" begin="0.45s" fill="freeze" />
        </circle>
        <path d="M73 62 L78 67 L88 57" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0">
          <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.5;1" dur="0.8s" begin="0.3s" fill="freeze" />
          <animateTransform attributeName="transform" type="translate" values="0 10; 0 -12" dur="0.5s" begin="0.45s" fill="freeze" />
        </path>
      </g>
      {[[50, 30], [110, 28], [35, 55], [125, 52]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={2} fill={i % 2 === 0 ? '#34d399' : '#22d3ee'} opacity="0">
          <animate attributeName="opacity" values="0;0.8;0" dur="0.6s" begin={`${0.5 + i * 0.12}s`} fill="freeze" />
          <animate attributeName="r" values="0;3;1.5" dur="0.6s" begin={`${0.5 + i * 0.12}s`} fill="freeze" />
        </circle>
      ))}
    </svg>
  );
}

export function ImportSuccessCelebration({ importResult }: { importResult: { imported: number; skipped: number; errors: string[] } }) {
  const { t } = useTranslation();
  const st = t.sharing;
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <div
      className="rounded-modal border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3 overflow-hidden"
      style={{
        transform: entered ? 'scale(1)' : 'scale(0.85)',
        opacity: entered ? 1 : 0,
        transition: 'transform 600ms cubic-bezier(0.34,1.56,0.64,1), opacity 400ms ease-out',
      }}
    >
      <PackageUnwrapSvg />
      <div className="text-center space-y-1">
        <div className="typo-body font-medium text-emerald-400">
          {st.import_complete}
        </div>
        <div className="typo-caption text-foreground space-y-0.5">
          <p>{importResult.imported} {importResult.imported !== 1 ? 'resources' : 'resource'} imported</p>
          {importResult.skipped > 0 && (
            <p>{importResult.skipped} skipped (conflicts)</p>
          )}
          {importResult.errors.length > 0 && (
            <div className="mt-2 text-left">
              <p className="text-red-400">{importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}:</p>
              {importResult.errors.map((e, i) => (
                <p key={i} className="text-red-400/80 ml-2">- {e}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
