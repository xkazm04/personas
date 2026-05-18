import { lazy, Suspense, useState } from 'react';
import { Sparkles, Archive } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { silentCatch } from '@/lib/silentCatch';

const VoiceAtelier = lazy(() => import('./VoiceAtelier'));
const VoiceBaseline = lazy(() => import('./VoiceBaseline'));

type VoiceVariant = 'atelier' | 'baseline';
const STORAGE_KEY = 'twin-voice-variant';

export default function VoicePage() {
  const t = useTranslation().t.twin;
  const [variant, setVariant] = useState<VoiceVariant>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'atelier' || raw === 'baseline') return raw;
    } catch (err) {
      silentCatch('twin-voice:read-variant')(err);
    }
    return 'atelier';
  });

  const select = (id: VoiceVariant) => {
    setVariant(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch (err) { silentCatch('twin-voice:write-variant')(err); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/10 bg-card/40 backdrop-blur">
        <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium mr-1 hidden sm:inline">
          {t.variantTabs.prototype}
        </span>
        <div className="flex items-center gap-1 rounded-full border border-primary/15 bg-secondary/30 p-0.5">
          <VariantBtn
            id="atelier"
            label={t.voice.atelierVariantLabel}
            icon={Sparkles}
            isActive={variant === 'atelier'}
            onClick={() => select('atelier')}
          />
          <VariantBtn
            id="baseline"
            label={t.voice.currentVariantLabel}
            icon={Archive}
            isActive={variant === 'baseline'}
            onClick={() => select('baseline')}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' ? <VoiceAtelier /> : <VoiceBaseline />}
        </Suspense>
      </div>
    </div>
  );
}

interface VariantBtnProps {
  id: VoiceVariant;
  label: string;
  icon: typeof Sparkles;
  isActive: boolean;
  onClick: () => void;
}
function VariantBtn({ label, icon: Icon, isActive, onClick }: VariantBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all',
        isActive
          ? 'bg-violet-500/20 text-violet-300 shadow-elevation-1'
          : 'text-foreground/60 hover:text-foreground hover:bg-secondary/50',
      ].join(' ')}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
    </button>
  );
}
