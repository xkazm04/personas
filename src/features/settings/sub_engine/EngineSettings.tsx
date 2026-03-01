import { useEffect, useRef, useCallback, useState } from 'react';
import { Cpu, Check, AlertTriangle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useAppSetting } from '@/hooks/utility/useAppSetting';
import { systemHealthCheck } from '@/api';
import type { CliEngine } from '@/lib/types/types';

interface EngineOption {
  id: CliEngine;
  name: string;
  description: string;
  contextFile: string;
}

const ENGINES: EngineOption[] = [
  {
    id: 'claude_code',
    name: 'Claude Code CLI',
    description: "Anthropic's agentic coding CLI. Best protocol compliance and session resume support.",
    contextFile: 'CLAUDE.md',
  },
  {
    id: 'codex_cli',
    name: 'Codex CLI',
    description: "OpenAI's coding agent. Requires an OpenAI API key.",
    contextFile: 'AGENTS.md',
  },
  {
    id: 'gemini_cli',
    name: 'Gemini CLI',
    description: "Google's Gemini agent. Free tier available with 1M token context window.",
    contextFile: 'GEMINI.md',
  },
];

export default function EngineSettings() {
  const setting = useAppSetting('cli_engine', 'claude_code');
  const hasLoadedOnce = useRef(false);
  const [healthStatus, setHealthStatus] = useState<Record<string, { status: string; detail?: string }>>({});

  // Auto-save whenever value changes (skip the initial load)
  useEffect(() => {
    if (!setting.loaded) return;
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      return;
    }
    setting.save();
  }, [setting.value]);

  // Load health status for each engine
  useEffect(() => {
    systemHealthCheck().then((report) => {
      const localSection = report.sections.find((s) => s.id === 'local');
      if (!localSection) return;

      const statusMap: Record<string, { status: string; detail?: string }> = {};
      for (const item of localSection.items) {
        if (item.id === 'claude_cli') {
          statusMap['claude_code'] = { status: item.status, detail: item.detail ?? undefined };
        } else if (item.id === 'codex_cli') {
          statusMap['codex_cli'] = { status: item.status, detail: item.detail ?? undefined };
        } else if (item.id === 'gemini_cli') {
          statusMap['gemini_cli'] = { status: item.status, detail: item.detail ?? undefined };
        }
      }
      setHealthStatus(statusMap);
    }).catch(() => {});
  }, [setting.value]);

  const selectEngine = useCallback((id: CliEngine) => {
    setting.setValue(id);
  }, [setting]);

  const activeEngine = (setting.value || 'claude_code') as CliEngine;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cpu className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Engine"
        subtitle="Select which CLI agent engine powers your personas"
      />

      <ContentBody centered>
        <div className="space-y-4">
          {/* Engine selector cards */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Active Engine</h2>

            <div className="space-y-3">
              {ENGINES.map((engine) => {
                const isActive = activeEngine === engine.id;
                const health = healthStatus[engine.id];
                const isInstalled = health?.status === 'ok';
                const isError = health?.status === 'error' || health?.status === 'warn';

                return (
                  <button
                    key={engine.id}
                    onClick={() => selectEngine(engine.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        isActive
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground/30'
                      }`}>
                        {isActive && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {engine.name}
                          </span>
                          {health && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              isInstalled
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                : isError
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                                  : 'bg-secondary/50 text-muted-foreground/70 border border-primary/10'
                            }`}>
                              {isInstalled ? 'Installed' : isError ? 'Not found' : 'Not installed'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          {engine.description}
                        </p>
                        <p className="text-xs text-muted-foreground/50 mt-0.5">
                          Context file: <code className="text-xs">{engine.contextFile}</code>
                        </p>
                        {health?.detail && isInstalled && (
                          <p className="text-xs text-muted-foreground/50 mt-0.5">{health.detail}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Warning note */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground/80">
              <p className="font-medium text-amber-400/90 mb-1">Protocol Compatibility</p>
              <p>
                Communication protocols (agent memory, manual review, execution flow tracking, outcome assessment)
                are optimized for Claude Code CLI. Other engines may have reduced protocol compliance, which can affect
                features like memory persistence and execution status tracking.
              </p>
            </div>
          </div>

          {setting.saved && (
            <p className="text-xs text-emerald-400 text-center">Engine setting saved</p>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
