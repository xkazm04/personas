import { useEffect, useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { ArrowDownLeft, ArrowUpRight, BookmarkPlus, Check, Eye, Loader2, Mic, RefreshCw, Sparkles, User, Users } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { Button } from '@/features/shared/components/buttons';
import type { TwinRecallBundle } from '@/lib/bindings/TwinRecallBundle';

/**
 * Cycle 16 Stage 1 — read-only recall preview. Calls the new `twin_recall`
 * command and renders the structured bundle a persona prompt-builder would
 * see: bio + generic tone + last 5 communications + top 5 distilled facts +
 * (when twin-wide) top 5 contacts.
 *
 * Read-only on purpose: the actual persona prompt path doesn't consume this
 * bundle yet. Stage 2 will replace whatever ad-hoc fetching the connector
 * tool does today with a `twin_recall` call so persona replies pick up the
 * same shelves the operator previews here.
 */

interface Props {
  twinId: string;
}

export function RecallPreviewPanel({ twinId }: Props) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const addToast = useToastStore((s) => s.addToast);
  const [bundle, setBundle] = useState<TwinRecallBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [contactFilter, setContactFilter] = useState('');
  // Tracks which communications have been promoted to facts in this session so
  // the button can lock to a "Saved" state. The DistilledFactsPanel is the
  // source of truth on next reload — this set is just for in-session feedback.
  const [savedCommIds, setSavedCommIds] = useState<Set<string>>(new Set());
  const [savingCommId, setSavingCommId] = useState<string | null>(null);

  const handleSaveAsFact = async (commId: string, content: string, contactHandle: string | null) => {
    if (savedCommIds.has(commId) || savingCommId) return;
    setSavingCommId(commId);
    try {
      // Default importance 3 (middle of the 1-5 range). User can re-rank later
      // in the DistilledFactsPanel; recall preview's role is to make the save
      // cheap, not to choose how important it is.
      await twinApi.createDistilledFact(twinId, [commId], content, contactHandle ?? undefined, 3);
      setSavedCommIds((prev) => new Set(prev).add(commId));
      addToast(t.recall.saveAsFactToast, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : t.recall.saveAsFactError, 'error');
    } finally {
      setSavingCommId(null);
    }
  };

  const fetchRecall = async (handle?: string) => {
    setLoading(true);
    try {
      const result = await twinApi.twinRecall(twinId, handle);
      setBundle(result);
    } catch (e) {
      toastCatch('twin:recall')(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!twinId) return;
    void fetchRecall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twinId]);

  const applyFilter = () => {
    void fetchRecall(contactFilter.trim() || undefined);
  };

  return (
    <div className="p-4 rounded-card border border-primary/10 bg-card/40">
      <div className="flex items-center gap-2 mb-1">
        <Eye className="w-4 h-4 text-violet-400" />
        <span className="typo-section-title">{t.recall.title}</span>
      </div>
      <p className="typo-caption text-foreground mb-3">{t.recall.subtitle}</p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder={t.recall.contactFilterPlaceholder}
          value={contactFilter}
          onChange={(e) => setContactFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilter(); }}
          className={`${INPUT_FIELD} flex-1 min-w-[160px]`}
        />
        <Button onClick={applyFilter} disabled={loading} size="sm" variant="ghost">
          {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
          {loading ? t.recall.refreshing : t.recall.refresh}
        </Button>
      </div>

      {bundle === null ? (
        <p className="typo-caption text-foreground py-2">{t.recall.loading}</p>
      ) : (
        <div className="space-y-3">
          {bundle.contact_filter && (
            <p className="typo-caption text-violet-300 italic">
              {tx(t.recall.scopedTo, { handle: bundle.contact_filter })}
            </p>
          )}

          {/* Identity */}
          <section className="p-3 rounded-card border border-primary/10 bg-background/40">
            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground mb-1.5 flex items-center gap-1">
              <User className="w-3 h-3" />
              {t.recall.identitySection}
            </p>
            <p className="typo-body text-foreground font-medium">{bundle.profile.name}</p>
            {bundle.profile.role && (
              <p className="typo-caption text-foreground">{bundle.profile.role}</p>
            )}
            {bundle.profile.bio && (
              <p className="typo-body text-foreground mt-1.5 leading-relaxed">{bundle.profile.bio}</p>
            )}
          </section>

          {/* Tone */}
          <section className="p-3 rounded-card border border-primary/10 bg-background/40">
            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground mb-1.5 flex items-center gap-1">
              <Mic className="w-3 h-3" />
              {t.recall.toneSection}
            </p>
            {bundle.tone ? (
              <>
                <p className="typo-body text-foreground whitespace-pre-wrap">{bundle.tone.voice_directives}</p>
                {bundle.tone.length_hint && (
                  <p className="typo-caption text-foreground mt-1 italic">{bundle.tone.length_hint}</p>
                )}
              </>
            ) : (
              <p className="typo-caption text-foreground italic">{t.recall.toneEmpty}</p>
            )}
          </section>

          {/* Top facts */}
          <section className="p-3 rounded-card border border-primary/10 bg-background/40">
            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {tx(t.recall.factsSection, { count: bundle.top_facts.length })}
            </p>
            {bundle.top_facts.length === 0 ? (
              <p className="typo-caption text-foreground italic">{t.recall.factsEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {bundle.top_facts.map((fact) => (
                  <li key={fact.id} className="flex items-start gap-2 typo-caption text-foreground">
                    <span className="px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/25 flex-shrink-0">
                      {fact.importance}
                    </span>
                    <span className="flex-1 min-w-0">
                      {fact.content}
                      {fact.contact_handle && (
                        <span className="ml-1.5 text-[10px] text-foreground">({fact.contact_handle})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent comms */}
          <section className="p-3 rounded-card border border-primary/10 bg-background/40">
            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground mb-1.5">
              {tx(t.recall.commsSection, { count: bundle.recent_communications.length })}
            </p>
            {bundle.recent_communications.length === 0 ? (
              <p className="typo-caption text-foreground italic">{t.recall.commsEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {bundle.recent_communications.map((c) => {
                  const isOut = c.direction === 'out';
                  const isSaved = savedCommIds.has(c.id);
                  const isSaving = savingCommId === c.id;
                  return (
                    <li key={c.id} className="group flex items-start gap-2 typo-caption text-foreground">
                      {isOut
                        ? <ArrowUpRight className="w-3 h-3 text-violet-400 mt-0.5 flex-shrink-0" />
                        : <ArrowDownLeft className="w-3 h-3 text-cyan-400 mt-0.5 flex-shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="text-[10px] text-foreground">
                          {c.channel} · {c.contact_handle ?? '—'} · {<AbsoluteTime timestamp={c.occurred_at} variant="date" />}
                        </span>
                        <span className="block line-clamp-2">{c.content}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleSaveAsFact(c.id, c.content, c.contact_handle)}
                        disabled={isSaved || isSaving}
                        title={isSaved ? t.recall.saveAsFactSaved : t.recall.saveAsFactTooltip}
                        className={`flex-shrink-0 mt-0.5 p-1 rounded-interactive transition-colors disabled:cursor-not-allowed ${
                          isSaved
                            ? 'text-emerald-400'
                            : 'text-foreground/40 hover:text-violet-300 hover:bg-violet-500/10 opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        aria-label={isSaved ? t.recall.saveAsFactSaved : t.recall.saveAsFact}
                      >
                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" />
                          : isSaved ? <Check className="w-3 h-3" />
                          : <BookmarkPlus className="w-3 h-3" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Top contacts (only for twin-wide) */}
          {!bundle.contact_filter && (
            <section className="p-3 rounded-card border border-primary/10 bg-background/40">
              <p className="text-[10px] uppercase tracking-[0.18em] text-foreground mb-1.5 flex items-center gap-1">
                <Users className="w-3 h-3" />
                {tx(t.recall.contactsSection, { count: bundle.top_contacts.length })}
              </p>
              {bundle.top_contacts.length === 0 ? (
                <p className="typo-caption text-foreground italic">{t.recall.contactsEmpty}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {bundle.top_contacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setContactFilter(c.handle);
                          void fetchRecall(c.handle);
                        }}
                        className="px-2 py-1 text-[10px] rounded-full bg-secondary/40 text-foreground hover:bg-violet-500/10 hover:text-violet-300 transition-colors"
                        title={t.recall.scopeToTooltip}
                      >
                        {c.alias?.trim() || c.handle}
                        <span className="ml-1 text-foreground">· {Number(c.message_count)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
