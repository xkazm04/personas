import { ArrowRight, Download } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export function FooterActions({
  loading,
  ipcError,
  hasNodeIssue,
  hasClaudeIssue,
  anyInstalling,
  install,
  onNext,
}: {
  loading: boolean;
  ipcError: boolean;
  hasNodeIssue: boolean;
  hasClaudeIssue: boolean;
  anyInstalling: boolean;
  install: (target: 'node' | 'claude_cli' | 'all') => void;
  onNext?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      {!loading && !ipcError && hasNodeIssue && hasClaudeIssue && (
        <Button
          variant="accent"
          accentColor="violet"
          size="md"
          onClick={() => install('all')}
          disabled={anyInstalling}
          icon={<Download className="w-4 h-4" />}
          className="flex-1"
        >
          {t.system_health.install_all}
        </Button>
      )}
      {onNext && (
        <Button
          variant="accent"
          accentColor="violet"
          size="md"
          onClick={onNext}
          disabled={loading}
          iconRight={<ArrowRight className="w-4 h-4" />}
          className="flex-1"
        >
          {t.common.continue}
        </Button>
      )}
    </div>
  );
}
