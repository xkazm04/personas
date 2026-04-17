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
  const { t, tx } = useTranslation();
  const dp = t.vault.design_phases;
  return (
    <>
      {/* Match existing banner */}
      {result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-modal ${INFO_STATUS.bg} ${INFO_STATUS.border}`}>
          <Plug className={`w-4 h-4 mt-0.5 shrink-0 ${INFO_STATUS.text}`} />
          <div className="typo-body">
            <span className={`${INFO_STATUS.text} font-medium`}>{dp.existing_connector}</span>
            <span className={INFO_STATUS.text}>{result.match_existing}</span>
            <p className="text-foreground typo-body mt-1">
              {dp.linked_to_existing}
            </p>
          </div>
        </div>
      )}

      {/* New connector discovery banner */}
      {!result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-modal ${AI_STATUS.bg} ${AI_STATUS.border}`}>
          <PackagePlus className={`w-4 h-4 mt-0.5 shrink-0 ${AI_STATUS.text}`} />
          <div className="typo-body">
            <span className={`${AI_STATUS.text} font-medium`}>{dp.new_connector}</span>
            <span className="text-foreground">
              {tx(dp.no_existing_connector, { name: result.connector.name })}
            </span>
            <p className="text-foreground typo-body mt-1">
              {dp.new_connector_will_be_registered}
            </p>
          </div>
        </div>
      )}

      {/* Connector preview */}
      <div className="flex items-center gap-3 px-4 py-3 bg-secondary/40 border border-primary/10 rounded-modal">
        <div
          className="w-10 h-10 rounded-modal flex items-center justify-center border"
          style={{
            backgroundColor: `${result.connector.color}15`,
            borderColor: `${result.connector.color}30`,
          }}
        >
          <Plug className="w-5 h-5" style={{ color: result.connector.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-foreground typo-body">{result.connector.label}</h4>
          <p className="typo-body text-foreground">{result.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-card bg-secondary/50 border border-primary/10 typo-body text-foreground/85">
            <ListChecks className="w-3 h-3" />
            {fields.length}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-card bg-secondary/50 border border-primary/10 typo-body text-foreground/85">
            <KeyRound className="w-3 h-3" />
            {requiredCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-card bg-secondary/50 border border-primary/10 typo-body text-foreground/85">
            <CircleHelp className="w-3 h-3" />
            {optionalCount}
          </span>
        </div>
        <span className="px-2 py-0.5 bg-primary/10 text-primary/70 typo-code rounded-card font-mono">
          {result.connector.category}
        </span>
      </div>

      {/* Refine request */}
      {onRefine && (
        <button
          onClick={onRefine}
          className="flex items-center gap-1.5 typo-body text-foreground hover:text-primary/70 transition-colors"
        >
          <PenLine className="w-3 h-3" />
          {dp.refine_request}
        </button>
      )}
    </>
  );
}
