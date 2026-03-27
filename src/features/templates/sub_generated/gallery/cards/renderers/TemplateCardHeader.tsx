import { useState, useRef } from 'react';
import { MoreVertical, Eye, Trash2, CheckCircle2, XCircle, GraduationCap, Clock } from 'lucide-react';
import { TrustBadge } from '../../../shared/TrustBadge';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import type { readinessTier } from '../../../shared/adoptionReadiness';
import type { DifficultyMeta, SetupMeta } from '../../../shared/templateComplexity';

interface TemplateCardHeaderProps {
  name: string;
  instruction: string;
  verification: TemplateVerification;
  readinessScore: number | null;
  tier: ReturnType<typeof readinessTier> | null;
  motionCss: string;
  onViewDetails: () => void;
  onDelete: () => void;
  difficultyMeta?: DifficultyMeta;
  setupMeta?: SetupMeta;
}

export function TemplateCardHeader({
  name,
  instruction,
  verification,
  readinessScore,
  tier,
  motionCss,
  onViewDetails,
  onDelete,
  difficultyMeta,
  setupMeta,
}: TemplateCardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  return (
    <div className="px-4 pt-4 pb-2.5 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-foreground/90 truncate">
            {name}
          </h3>
          <TrustBadge trustLevel={verification.trustLevel} compact />
          {tier != null && readinessScore != null ? (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono rounded border ${tier.bgClass}`}
              title={`${readinessScore}% of connectors ready`}
            >
              {readinessScore === 100 ? (
                <CheckCircle2 className="w-2.5 h-2.5" />
              ) : (
                <XCircle className="w-2.5 h-2.5" />
              )}
              {readinessScore}%
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono rounded border bg-zinc-500/10 text-muted-foreground/40 border-zinc-500/15">
              --%
            </span>
          )}
          {difficultyMeta && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded border ${difficultyMeta.bgClass}`}
              title={`Difficulty: ${difficultyMeta.label}`}
            >
              <GraduationCap className="w-2.5 h-2.5" />
              {difficultyMeta.label}
            </span>
          )}
          {setupMeta && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded border ${setupMeta.bgClass}`}
              title={`Setup: ${setupMeta.label}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {setupMeta.label}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
          {instruction.length > 120
            ? instruction.slice(0, 120) + '...'
            : instruction}
        </p>
      </div>
      <div ref={menuRef} className="relative flex-shrink-0">
        {menuOpen && <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className={`p-1 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-secondary/60 transition-all ${motionCss}`}
        >
          <MoreVertical className="w-4.5 h-4.5 text-muted-foreground/80" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] py-1.5 bg-background border border-primary/20 rounded-lg shadow-elevation-4 backdrop-blur-sm">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onViewDetails();
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/80 hover:bg-primary/5 transition-colors text-left"
            >
              <Eye className="w-4 h-4" />
              View Details
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left ${BUTTON_VARIANTS.delete.text} ${BUTTON_VARIANTS.delete.hover}`}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
