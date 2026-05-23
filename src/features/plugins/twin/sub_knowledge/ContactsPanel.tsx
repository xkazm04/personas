import { useEffect, useMemo, useState } from 'react';
import { Users, Edit2, Save, X, Clock } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { Button } from '@/features/shared/components/buttons';
import type { TwinContact } from '@/lib/bindings/TwinContact';

const SPARKLINE_DAYS = 7;

/**
 * Buckets the active twin's communications into `SPARKLINE_DAYS` daily bins
 * per contact-handle (case-insensitive). Bin 0 = oldest day, bin 6 = today.
 * Empty histograms get a 0-filled array so the sparkline renderer can stay
 * dumb about the absent-data case.
 */
function useContactSparklines(twinId: string): Map<string, number[]> {
  const twinCommunications = useSystemStore((s) => s.twinCommunications);
  return useMemo(() => {
    const map = new Map<string, number[]>();
    if (!twinId) return map;
    const dayMs = 86_400_000;
    const todayStart = Math.floor(Date.now() / dayMs) * dayMs;
    const cutoff = todayStart - (SPARKLINE_DAYS - 1) * dayMs;
    for (const c of twinCommunications) {
      if (c.twin_id !== twinId) continue;
      if (!c.contact_handle) continue;
      const occurredMs = Date.parse(c.occurred_at);
      if (Number.isNaN(occurredMs) || occurredMs < cutoff) continue;
      const bin = Math.min(
        SPARKLINE_DAYS - 1,
        Math.max(0, Math.floor((occurredMs - cutoff) / dayMs)),
      );
      const key = c.contact_handle.toLowerCase();
      const bins = map.get(key) ?? new Array<number>(SPARKLINE_DAYS).fill(0);
      bins[bin] = (bins[bin] ?? 0) + 1;
      map.set(key, bins);
    }
    return map;
  }, [twinId, twinCommunications]);
}

interface SparklineProps {
  bins: number[];
  label: string;
}

function Sparkline({ bins, label }: SparklineProps) {
  const max = bins.reduce((m, n) => (n > m ? n : m), 0);
  if (max === 0) return null;
  const barW = 3;
  const gap = 1;
  const h = 12;
  const w = bins.length * barW + (bins.length - 1) * gap;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="flex-shrink-0 text-violet-400/85"
    >
      {bins.map((n, i) => {
        const bh = max === 0 ? 0 : Math.max(1, Math.round((n / max) * h));
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={h - bh}
            width={barW}
            height={bh}
            rx={0.5}
            fill="currentColor"
            opacity={n === 0 ? 0.15 : 0.85}
          />
        );
      })}
    </svg>
  );
}

/**
 * Cycle 14 Stage 1 — durable per-contact register. The backend auto-upserts
 * any new handles seen in twin_communications, so this panel lights up as
 * soon as a twin starts receiving inbound messages. Each row carries the
 * derived message count + last_seen_at; alias + notes are operator-edited
 * and persist across communications.
 *
 * Stage 2 will use the (twin_id, contact_handle) tuple as the scope key for
 * per-contact distilled facts + reflection journals + proactive nudges.
 */

interface Props {
  twinId: string;
}

function relativeAge(t: ReturnType<typeof useTranslation>['t'], iso: string | null, now = Date.now()): string {
  if (!iso) return t.twin.contacts.neverBridged;
  const ms = Math.max(0, now - new Date(iso).getTime());
  if (ms < 60_000) return t.twin.contacts.justNow;
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
  return `${Math.max(1, Math.round(ms / 86_400_000))}d`;
}

export function ContactsPanel({ twinId }: Props) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const [contacts, setContacts] = useState<TwinContact[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftAlias, setDraftAlias] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const fetchTwinCommunications = useSystemStore((s) => s.fetchTwinCommunications);
  const sparklines = useContactSparklines(twinId);

  useEffect(() => {
    if (!twinId) return;
    twinApi
      .listTwinContacts(twinId)
      .then(setContacts)
      .catch(() => setContacts([]));
    // Pull a recent slice of communications to feed the per-contact 7d
    // sparkline. Idempotent against the slice — other Brain panels load
    // this too.
    void fetchTwinCommunications(twinId, undefined, 200);
  }, [twinId, fetchTwinCommunications]);

  const startEdit = (c: TwinContact) => {
    setEditingId(c.id);
    setDraftAlias(c.alias ?? '');
    setDraftNotes(c.notes ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftAlias('');
    setDraftNotes('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const updated = await twinApi.updateTwinContact(
        editingId,
        draftAlias.trim() || undefined,
        draftNotes.trim() || undefined,
      );
      setContacts((prev) =>
        prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev,
      );
      cancelEdit();
    } catch (e) {
      toastCatch('twin:update-contact')(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="p-4 rounded-card border border-primary/10 bg-card/40">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-4 h-4 text-violet-400" />
        <h2 className="typo-section-title">{t.contacts.title}</h2>
        {contacts && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-secondary/40 text-foreground">
            {contacts.length}
          </span>
        )}
      </div>
      <p className="typo-caption text-foreground mb-3">{t.contacts.subtitle}</p>

      {contacts === null ? (
        <p className="typo-caption text-foreground py-2">{t.contacts.loading}</p>
      ) : contacts.length === 0 ? (
        <div className="py-6 text-center">
          <Users className="w-7 h-7 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">{t.contacts.emptyTitle}</p>
          <p className="typo-caption text-foreground mt-1">{t.contacts.emptyBody}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => {
            const editing = editingId === c.id;
            const display = c.alias?.trim() ? c.alias : c.handle;
            return (
              <li key={c.id} className="p-3 rounded-card border border-primary/10 bg-background/40">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {editing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder={t.contacts.aliasPlaceholder}
                          value={draftAlias}
                          onChange={(e) => setDraftAlias(e.target.value)}
                          className={INPUT_FIELD}
                        />
                        <textarea
                          rows={2}
                          placeholder={t.contacts.notesPlaceholder}
                          value={draftNotes}
                          onChange={(e) => setDraftNotes(e.target.value)}
                          className={`${INPUT_FIELD} resize-y`}
                        />
                      </div>
                    ) : (
                      <>
                        <p className="typo-body text-foreground font-medium truncate">{display}</p>
                        {c.alias && (
                          <p className="text-[10px] text-foreground font-mono truncate">{c.handle}</p>
                        )}
                        {c.notes && (
                          <p className="typo-caption text-foreground mt-1 italic line-clamp-2">{c.notes}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className="flex items-center gap-1 typo-caption text-foreground">
                            <Clock className="w-3 h-3" />
                            {tx(t.contacts.lastSeen, { rel: relativeAge(tFull, c.last_seen_at ?? null) })}
                          </span>
                          <span className="typo-caption text-foreground">
                            {tx(t.contacts.messageCount, { count: Number(c.message_count) })}
                          </span>
                          {(() => {
                            const bins = sparklines.get(c.handle.toLowerCase());
                            if (!bins) return null;
                            const total = bins.reduce((a, b) => a + b, 0);
                            if (total === 0) return null;
                            return (
                              <Sparkline
                                bins={bins}
                                label={tx(t.contacts.sparklineAria, { count: total })}
                              />
                            );
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {editing ? (
                      <>
                        <Button onClick={saveEdit} disabled={saving} size="sm" variant="accent" accentColor="violet">
                          <Save className="w-3 h-3 mr-1" />
                          {saving ? t.contacts.saving : t.contacts.save}
                        </Button>
                        <button
                          onClick={cancelEdit}
                          aria-label={t.contacts.cancel}
                          className="p-1.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => startEdit(c)}
                        aria-label={t.contacts.editAria}
                        title={t.contacts.editAria}
                        className="p-1.5 rounded-interactive text-foreground hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
