import { useState } from 'react';
import { Zap } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { testEventFlow } from '@/api/overview/events';
import type { PersonaEvent } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

export function TestTab() {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [testEventType, setTestEventType] = useState('test_event');
  const [testPayload, setTestPayload] = useState('{}');
  const [testResult, setTestResult] = useState<PersonaEvent | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const getPersona = (id: string | null) =>
    id ? personas.find((p) => p.id === id) : null;

  const handleTestFire = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      let payload: string | undefined;
      try {
        const parsed = JSON.parse(testPayload);
        payload = JSON.stringify(parsed);
      } catch {
        payload = undefined;
      }
      const result = await testEventFlow(testEventType, payload);
      setTestResult(result);
    } catch {
      // handled by UI
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6 max-w-xl">
        <div>
          <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-4">
            {t.triggers.publish_test_event}
          </h3>
          <p className="text-sm text-muted-foreground/70 mb-4">
            {t.triggers.publish_test_desc}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">{t.triggers.event_type_form_label}</label>
            <input
              type="text"
              value={testEventType}
              onChange={(e) => setTestEventType(e.target.value)}
              placeholder="e.g. build_complete, deploy, file_changed"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">{t.triggers.payload_json_label}</label>
            <textarea
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
            />
          </div>
          <button
            onClick={handleTestFire}
            disabled={isTesting || !testEventType.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
          >
            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
            {isTesting ? t.triggers.publishing_label : t.triggers.publish_event}
          </button>
        </div>

        {testResult && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-emerald-400">{t.triggers.event_published}</p>
            <div className="text-xs text-muted-foreground/70 space-y-1 font-mono">
              <p>ID: {testResult.id}</p>
              <p>Type: {testResult.event_type}</p>
              <p>Status: {testResult.status}</p>
              {testResult.target_persona_id && (
                <p>Target: {getPersona(testResult.target_persona_id)?.name ?? testResult.target_persona_id}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
