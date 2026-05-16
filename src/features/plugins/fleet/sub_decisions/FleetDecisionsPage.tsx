import { useState, useMemo, useCallback, useEffect } from 'react';
import { Send, MessageSquare, CheckSquare, Square, History, Hourglass, X } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { writeInput } from '@/api/fleet/fleet';
import { FleetStatusBadge } from '../FleetStatusBadge';

interface DecisionHistoryEntry {
  text: string;
  sentAt: number;
  targets: string[];
  results: Array<{ sessionId: string; ok: boolean; error?: string }>;
}

const HISTORY_KEY = 'fleet-decision-history';
const HISTORY_MAX = 20;

function loadHistory(): DecisionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: DecisionHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // Quota exceeded or storage disabled — silent.
  }
}

export default function FleetDecisionsPage() {
  const sessions = useSystemStore((s) => s.fleetSessions);
  const refresh = useSystemStore((s) => s.fleetRefresh);

  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pressEnter, setPressEnter] = useState(true);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<DecisionHistoryEntry[]>(() => loadHistory());

  useEffect(() => {
    refresh();
  }, [refresh]);

  const targetable = useMemo(
    () => sessions.filter((s) => s.state !== 'exited'),
    [sessions],
  );
  const waiting = useMemo(
    () => targetable.filter((s) => s.state === 'awaiting_input'),
    [targetable],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectWaiting = useCallback(() => {
    setSelected(new Set(waiting.map((s) => s.id)));
  }, [waiting]);

  const selectAll = useCallback(() => {
    setSelected(new Set(targetable.map((s) => s.id)));
  }, [targetable]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleSend = useCallback(async () => {
    if (!text.trim() || selected.size === 0 || sending) return;
    setSending(true);
    const payload = pressEnter ? `${text}\r` : text;
    const results: DecisionHistoryEntry['results'] = [];
    for (const sid of selected) {
      try {
        await writeInput(sid, payload);
        results.push({ sessionId: sid, ok: true });
      } catch (e) {
        results.push({
          sessionId: sid,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      toastCatch(
        'FleetDecisionsPage:send',
        `Failed to deliver to ${failed} session${failed === 1 ? '' : 's'}`,
      )(new Error('partial delivery'));
    }
    const entry: DecisionHistoryEntry = {
      text,
      sentAt: Date.now(),
      targets: [...selected],
      results,
    };
    const nextHistory = [entry, ...history].slice(0, HISTORY_MAX);
    setHistory(nextHistory);
    saveHistory(nextHistory);
    setText('');
    setSending(false);
  }, [text, selected, sending, pressEnter, history]);

  const handleReuse = useCallback((entry: DecisionHistoryEntry) => {
    setText(entry.text);
    // Keep only still-existing targets.
    const stillExisting = new Set(
      entry.targets.filter((t) => targetable.some((s) => s.id === t)),
    );
    setSelected(stillExisting);
  }, [targetable]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<MessageSquare className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Fleet — Decisions"
        subtitle="Broadcast one prompt to many sessions at once"
      />
      <ContentBody>
        <div data-testid="fleet-decisions-page" />
        <div className="grid grid-cols-12 gap-4">
          {/* Composer (left) */}
          <div className="col-span-7 space-y-3">
            <label className="block">
              <span className="typo-caption font-medium text-foreground mb-1.5 block">Message</span>
              <textarea
                data-testid="fleet-decision-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type the decision to broadcast — e.g. an approval, a clarification, the next task…"
                rows={6}
                className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30 resize-none font-mono"
              />
            </label>

            <label className="flex items-center gap-2 typo-caption text-foreground/80 cursor-pointer">
              <input
                type="checkbox"
                checked={pressEnter}
                onChange={(e) => setPressEnter(e.target.checked)}
                className="rounded"
              />
              Append <code className="font-mono">↵</code> so Claude submits immediately
            </label>

            <ActionRow>
              <Button
                variant="accent"
                accentColor="amber"
                size="sm"
                icon={<Send className="w-3.5 h-3.5" />}
                disabled={!text.trim() || selected.size === 0 || sending}
                onClick={handleSend}
              >
                {sending
                  ? 'Sending…'
                  : `Send to ${selected.size} session${selected.size === 1 ? '' : 's'}`}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Hourglass className="w-3.5 h-3.5" />}
                disabled={waiting.length === 0}
                onClick={selectWaiting}
              >
                Select waiting ({waiting.length})
              </Button>
              <Button variant="ghost" size="sm" icon={<CheckSquare className="w-3.5 h-3.5" />} onClick={selectAll}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" icon={<Square className="w-3.5 h-3.5" />} onClick={clearSelection}>
                Clear
              </Button>
            </ActionRow>
          </div>

          {/* Target selector (right) */}
          <div className="col-span-5">
            <span className="typo-caption font-medium text-foreground mb-1.5 block">Targets</span>
            <div className="space-y-1 max-h-[400px] overflow-y-auto border border-primary/10 rounded-modal p-2 bg-secondary/20">
              {targetable.length === 0 ? (
                <p className="text-[11px] text-foreground/50 text-center py-4">No active sessions</p>
              ) : (
                targetable.map((s) => {
                  const isSelected = selected.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-start gap-2 p-2 rounded-card cursor-pointer transition-colors ${
                        isSelected ? 'bg-amber-500/10 border border-amber-500/30' : 'hover:bg-secondary/40 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(s.id)}
                        className="mt-0.5 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <FleetStatusBadge state={s.state} reason={s.stateReason} />
                        </div>
                        <p className="typo-caption font-medium truncate">{s.projectLabel}</p>
                        <p className="text-[10px] font-mono text-foreground/50 truncate" title={s.cwd}>
                          {s.cwd}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="mt-6">
            <h4 className="typo-label uppercase tracking-wider text-foreground/50 flex items-center gap-1.5 mb-2">
              <History className="w-3 h-3" />
              Recent decisions
            </h4>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {history.map((entry, i) => {
                const okCount = entry.results.filter((r) => r.ok).length;
                const failCount = entry.results.length - okCount;
                return (
                  <div
                    key={`${entry.sentAt}-${i}`}
                    className="border border-primary/10 rounded-card p-2 bg-secondary/10"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-foreground/50">
                        {new Date(entry.sentAt).toLocaleTimeString()}
                      </span>
                      <span className="text-[10px] text-emerald-400">{okCount} ok</span>
                      {failCount > 0 && (
                        <span className="text-[10px] text-red-400">{failCount} failed</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        title="Reuse — load text and targets back into composer"
                        onClick={() => handleReuse(entry)}
                      >
                        <Send className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-[11px] font-mono text-foreground/80 truncate">{entry.text}</p>
                  </div>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => {
                  setHistory([]);
                  saveHistory([]);
                }}
              >
                Clear history
              </Button>
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
