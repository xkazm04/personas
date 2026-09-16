/**
 * The band that appears when the guide could not draft a turn.
 *
 * It is a CALM NOTICE, not an error state: the slot it was working stays
 * exactly as incomplete as it was, nothing below it is blocked, and the one
 * action it offers is the way forward that does not need the generator at all.
 * Since 2026-09-16 that action switches the body to the Fields mode rather than
 * opening a drawer over it.
 */

import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

interface SetupGeneratorNoticeProps {
  onOpenFields: () => void;
}

export function SetupGeneratorNotice({ onOpenFields }: SetupGeneratorNoticeProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup.generatorError;

  return (
    <div
      className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-status-warning/25 bg-status-warning/8"
      data-testid="setup-generator-error"
    >
      <TriangleAlert className="w-4 h-4 text-status-warning flex-shrink-0" />
      <span className="typo-caption min-w-0 truncate">{ts.title}</span>
      <Button variant="ghost" size="xs" className="ml-auto" onClick={onOpenFields}>
        {ts.action}
      </Button>
    </div>
  );
}

export default SetupGeneratorNotice;
