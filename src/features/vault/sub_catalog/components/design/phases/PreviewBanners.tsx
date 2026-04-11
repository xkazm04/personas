import { Plug, ListChecks, KeyRound, CircleHelp, PackagePlus, PenLine } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

const INFO_STATUS = STATUS_COLORS.info!;
const AI_STATUS = STATUS_COLORS.ai!;

interface PreviewBannersProps {
  result: CredentialDesignResult;
  fields: CredentialTemplateField[];
  requiredCount: number;
  optionalCount: number;
  onRefine?: () => void;
}

export function PreviewBanners({ result, fields, requiredCount, optionalCount, onRefine }: PreviewBannersProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Match existing banner */}
      {result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl ${INFO_STATUS.bg} ${INFO_STATUS.border}`}>
          <Plug className={`w-4 h-4 mt-0.5 shrink-0 ${INFO_STATUS.text}`} />
          <div className="text-sm">
            <span className={`${INFO_STATUS.text} font-medium`}>{t.vault.design_phases.existing_connector}</span>
            <span className={INFO_STATUS.text}>{result.match_existing}</span>
            <p className="text-foreground/70 text-sm mt-1">
              Your credential will be linked to the existing connector definition.
            </p>
          </div>
        </div>
      )}

      {/* New connector discovery banner */}
      {!result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl ${AI_STATUS.bg} ${AI_STATUS.border}`}>
          <PackagePlus className={`w-4 h-4 mt-0.5 shrink-0 ${AI_STATUS.text}`} />
          <div className="text-sm">
            <span className={`${AI_STATUS.text} font-medium`}>{t.vault.design_phases.new_connector}</span>
            <span className="text-foreground/80">
              -- no existing <span className="font-mono text-foreground/90">{result.connector.name}</span> connector was found in your catalog.
            </span>
            <p className="text-foreground/70 text-sm mt-1">
              When you save this credential, the AI-generated connector definition will be
              automatically registered in your connector catalog -- making it reusable for
              other personas and template adoption.
            </p>
          </div>
        </div>
      )}

      {/* Connector preview */}
      <div className="flex items-center gap-3 px-4 py-3 bg-secondary/40 border border-primary/10 rounded-xl">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: `${result.connector.color}15`,
            borderColor: `${result.connector.color}30`,
          }}
        >
          <Plug className="w-5 h-5" style={{ color: result.connector.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-foreground text-sm">{result.connector.label}</h4>
          <p className="text-sm text-muted-foreground/80">{result.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <ListChecks className="w-3 h-3" />
            {fields.length}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <KeyRound className="w-3 h-3" />
            {requiredCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <CircleHelp className="w-3 h-3" />
            {optionalCount}
          </span>
        </div>
        <span className="px-2 py-0.5 bg-primary/10 text-primary/70 text-sm rounded-lg font-mono">
          {result.connector.category}
        </span>
      </div>

      {/* Refine request */}
      {onRefine && (
        <button
          onClick={onRefine}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/90 hover:text-primary/70 transition-colors"
        >
          <PenLine className="w-3 h-3" />
          Not quite right? Refine your request
        </button>
      )}
    </>
  );
}
