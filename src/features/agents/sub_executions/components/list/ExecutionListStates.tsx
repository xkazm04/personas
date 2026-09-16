import { AlertCircle, Play, Rocket, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

const ACTION_BTN = 'mt-4 flex items-center gap-2 px-4 py-2 typo-heading rounded-modal bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors';

function StateCard({ icon: Icon, tone, title, body, action }: {
  icon: LucideIcon;
  tone: 'error' | 'neutral';
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  const frame = tone === 'error' ? 'bg-red-500/5 border-red-500/20' : 'bg-secondary/40 backdrop-blur-sm border-primary/20';
  const well = tone === 'error' ? 'bg-red-500/10 border-red-500/20' : 'bg-primary/8 border-primary/20';
  return (
    <div className={`animate-fade-slide-in flex flex-col items-center text-center py-12 px-6 border rounded-modal ${frame}`}>
      <div className={`w-12 h-12 rounded-modal border flex items-center justify-center mb-4 ${well}`}>
        <Icon className={`w-5.5 h-5.5 ${tone === 'error' ? 'text-red-400' : 'text-primary/40'}`} />
      </div>
      <p className="typo-heading text-foreground">{title}</p>
      <p className="typo-body text-foreground mt-1 max-w-[260px]">{body}</p>
      {action}
    </div>
  );
}

/** The run history failed to load and nothing is cached to show instead. */
export function ExecutionListError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <StateCard
      icon={AlertCircle}
      tone="error"
      title={e.load_failed_title}
      body={e.load_failed_body}
      action={<button type="button" onClick={onRetry} className={ACTION_BTN}>{t.common.retry}</button>}
    />
  );
}

/** A persona that has never run: invite the first run instead of an empty ledger. */
export function ExecutionListFirstRun({ onTryIt }: { onTryIt: () => void }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <StateCard
      icon={Rocket}
      tone="neutral"
      title={e.agent_ready}
      body={e.agent_ready_subtitle}
      action={<button type="button" onClick={onTryIt} className={ACTION_BTN}><Play className="w-3.5 h-3.5" />{e.try_it_now}</button>}
    />
  );
}
