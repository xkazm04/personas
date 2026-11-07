import { useState, useRef } from 'react';
import { MoreVertical, Eye, Trash2, CheckCircle2, XCircle, GraduationCap, Clock } from 'lucide-react';
import { TrustBadge } from '../../../shared/TrustBadge';
import { useTranslation } from '@/i18n/useTranslation';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import type { readinessTier } from '../../../shared/adoptionReadiness';
import type { DifficultyLevel, DifficultyMeta, SetupMeta } from '../../../shared/templateComplexity';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import Button from '@/features/shared/components/buttons/Button';

interface TemplateCardHeaderProps {
  name: string;
  goal?: string | null;
  instruction: string;
  verification: TemplateVerification;
  readinessScore: number | null;
  tier: ReturnType<typeof readinessTier> | null;
  motionCss: string;
  onViewDetails: () => void;
  onDelete: () => void;
  difficulty?: DifficultyLevel;
  difficultyMeta?: DifficultyMeta;
  setupMeta?: SetupMeta;
  setupMinutes?: number;
}

export function TemplateCardHeader({
  name,
  goal,
  instruction,
  verification,
  readinessScore,
  tier,
  motionCss,
  onViewDetails,
  onDelete,
  difficulty,
  difficultyMeta,
  setupMinutes,
}: TemplateCardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t: tMain } = useTranslation();
  const t = tMain.templates;

  return (
    <div className="px-4 pt-4 pb-2.5 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="typo-body-lg text-ink-1 truncate">
            {name}
          </h3>
          <TrustBadge trustLevel={verification.trustLevel} compact />
          {tier != null && readinessScore != null ? (
            <Tooltip content={`${readinessScore}% of connectors ready`}><span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 typo-caption font-mono rounded-interactive border ${tier.bgClass}`}
            >
              {readinessScore === 100 ? (
                <CheckCircle2 className="w-2.5 h-2.5" />
              ) : (
                <XCircle className="w-2.5 h-2.5" />
              )}
              {readinessScore}%
            </span></Tooltip>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-caption font-mono rounded-interactive border bg-zinc-500/10 text-foreground border-zinc-500/15">
              --%
            </span>
          )}
          {difficultyMeta && difficulty && (
            <Tooltip content={`${t.complexity[difficulty]}${setupMinutes ? ` · ${t.complexity.minuteSetup.replace('{minutes}', String(setupMinutes))}` : ''}`}><span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 typo-label rounded-interactive border ${difficultyMeta.bgClass}`}
            >
              <GraduationCap className="w-2.5 h-2.5" />
              {t.complexity[difficulty]}
              {setupMinutes != null && (
                <>
                  <span className="opacity-50">·</span>
                  <Clock className="w-2.5 h-2.5" />
                  {t.complexity.minuteShort.replace('{minutes}', String(setupMinutes))}
                </>
              )}
            </span></Tooltip>
          )}
        </div>
        {goal ? (
          <p className="typo-body text-ink-1 mt-1 line-clamp-2 italic">
            {goal}
          </p>
        ) : (
          <p className="typo-body text-foreground mt-1 line-clamp-2">
            {instruction.length > 120
              ? instruction.slice(0, 120) + '...'
              : instruction}
          </p>
        )}
      </div>
      <div ref={menuRef} className="relative flex-shrink-0">
        {menuOpen && <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className={`opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${motionCss}`}
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </Button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] py-1.5 bg-background border border-hair rounded-card shadow-elevation-4 backdrop-blur-sm">
            <PressSurface
              onPress={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onViewDetails();
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 typo-body text-ink-1"
            >
              <Eye className="w-4 h-4" />
              {tMain.templates.actions.view_details}
            </PressSurface>
            <PressSurface
              onPress={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 typo-body ${BUTTON_VARIANTS.delete.text}`}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </PressSurface>
          </div>
        )}
      </div>
    </div>
  );
}
