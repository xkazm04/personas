import { useEffect, useMemo, useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Sparkles, Plus, Trash2, FileText, X } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { Button } from '@/features/shared/components/buttons';
import { Slider } from '@/features/shared/components/forms/Slider';
import type { TwinDistilledFact } from '@/lib/bindings/TwinDistilledFact';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';

/**
 * Distilled-facts panel. Cycle 12 Stage 1 of the Athena-style memory pipeline
 * port — manual write surface against the new `twin_distilled_facts` table.
 *
 * Each fact carries provenance: the user must pick at least one source
 * `twin_communications` row before save. The repo rejects empty sources, so
 * a hallucinated fact can never enter the table even if a future caller
 * forgets the check.
 *
 * Stage 2 will add a Claude-driven consolidation pass that proposes facts
 * from recent communications + approved pending memories. Stage 3 will add
 * vector dedup against existing facts before the apply.
 */

interface Props {
  twinId: string;
}

export function DistilledFactsPanel({ twinId }: Props) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;

  // Communications are already fetched by useChannelActivity in the Channels
  // tab; we re-fetch here so the panel works even if the user hasn't visited
  // Channels in this session. fetch is idempotent against the slice.
  const communications = useSystemStore((s) => s.twinCommunications);
  const fetchComms = useSystemStore((s) => s.fetchTwinCommunications);

  const [facts, setFacts] = useState<TwinDistilledFact[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftContact, setDraftContact] = useState('');
  const [draftImportance, setDraftImportance] = useState(3);
  const [draftSources, setDraftSources] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!twinId) return;
    twinApi.listDistilledFacts(twinId).then(setFacts).catch(() => setFacts([]));
    void fetchComms(twinId, undefined, 50);
  }, [twinId, fetchComms]);

  const scopedComms = useMemo(
    () => communications.filter((c) => c.twin_id === twinId).slice(0, 30),
    [communications, twinId],
  );

  const resetDraft = () => {
    setAdding(false);
    setDraftContent('');
    setDraftContact('');
    setDraftImportance(3);
    setDraftSources(new Set());
  };

  const toggleSource = (id: string) => {
    setDraftSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!draftContent.trim() || draftSources.size === 0) return;
    setSubmitting(true);
    try {
      const created = await twinApi.createDistilledFact(
        twinId,
        Array.from(draftSources),
        draftContent.trim(),
        draftContact.trim() || undefined,
        draftImportance,
      );
      setFacts((prev) => (prev ? [created, ...prev] : [created]));
      resetDraft();
    } catch (e) {
      toastCatch('twin:create-distilled-fact')(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await twinApi.deleteDistilledFact(id);
      setFacts((prev) => (prev ? prev.filter((f) => f.id !== id) : prev));
    } catch (e) {
      toastCatch('twin:delete-distilled-fact')(e);
    }
  };

  const importanceTint = (n: number) =>
    n >= 4 ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
    : n >= 3 ? 'bg-secondary/40 text-foreground border-primary/10'
    : 'bg-secondary/30 text-foreground border-primary/10';

  return (
    <div className="p-4 rounded-card border border-primary/10 bg-card/40">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="typo-section-title">{t.distilled.title}</span>
          {facts && <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-secondary/40 text-foreground">{facts.length}</span>}
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} size="sm" variant="ghost">
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t.distilled.addCta}
          </Button>
        )}
      </div>
      <p className="typo-caption text-foreground mb-3">{t.distilled.subtitle}</p>

      {adding && (
        <div className="p-3 mb-3 rounded-card border border-violet-500/20 bg-violet-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="typo-caption font-medium text-foreground">{t.distilled.addHeading}</span>
            <button onClick={resetDraft} aria-label={t.distilled.cancel} className="text-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            rows={2}
            placeholder={t.distilled.contentPlaceholder}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className={`${INPUT_FIELD} resize-y`}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="typo-caption text-foreground">{t.distilled.contactLabel}</span>
              <input
                type="text"
                placeholder={t.distilled.contactPlaceholder}
                value={draftContact}
                onChange={(e) => setDraftContact(e.target.value)}
                className={INPUT_FIELD}
              />
            </label>
            <label className="space-y-1">
              <span className="typo-caption text-foreground">{t.distilled.importanceLabel}</span>
              <Slider
                min={1}
                max={5}
                step={1}
                value={draftImportance}
                onChange={(v) => setDraftImportance(v)}
                ariaLabel={t.distilled.importanceLabel}
                showBubble={false}
              />
              <span className="block text-[10px] text-foreground text-right">{draftImportance} / 5</span>
            </label>
          </div>

          <div className="space-y-1">
            <span className="typo-caption text-foreground font-medium">{t.distilled.sourcesLabel}</span>
            <p className="text-[10px] text-foreground">{t.distilled.sourcesHint}</p>
            {scopedComms.length === 0 ? (
              <p className="typo-caption text-foreground italic">{t.distilled.noCommsYet}</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto border border-primary/10 rounded-interactive divide-y divide-primary/5">
                {scopedComms.map((c: TwinCommunication) => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 px-2 py-1.5 cursor-pointer hover:bg-secondary/30 transition-colors">
                      <input
                        type="checkbox"
                        checked={draftSources.has(c.id)}
                        onChange={() => toggleSource(c.id)}
                        className="accent-violet-500 mt-1 flex-shrink-0"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 typo-caption text-foreground">
                          <span className="px-1 py-0.5 text-[9px] rounded bg-secondary/40">{c.channel}</span>
                          <span>{c.direction === 'out' ? t.distilled.sent : t.distilled.received}</span>
                          {c.contact_handle && <span className="truncate">{c.contact_handle}</span>}
                          <span className="ml-auto text-[10px] flex-shrink-0">{<AbsoluteTime timestamp={c.occurred_at} variant="date" />}</span>
                        </span>
                        <span className="block typo-caption text-foreground line-clamp-2 mt-0.5">{c.content}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={resetDraft} variant="ghost" size="sm">{t.distilled.cancel}</Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !draftContent.trim() || draftSources.size === 0}
              size="sm"
              variant="accent"
              accentColor="violet"
              title={draftSources.size === 0 ? t.distilled.needsSources : undefined}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              {submitting ? t.distilled.saving : tx(t.distilled.saveWithSources, { count: draftSources.size })}
            </Button>
          </div>
        </div>
      )}

      {facts === null ? (
        <p className="typo-caption text-foreground py-2">{t.distilled.loading}</p>
      ) : facts.length === 0 ? (
        <div className="py-6 text-center">
          <FileText className="w-7 h-7 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">{t.distilled.emptyTitle}</p>
          <p className="typo-caption text-foreground mt-1">{t.distilled.emptyBody}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {facts.map((fact) => {
            let sourceCount = 0;
            try {
              const arr = JSON.parse(fact.sources_json) as string[];
              if (Array.isArray(arr)) sourceCount = arr.length;
            } catch (err) { silentCatch("features/plugins/twin/sub_brain/DistilledFactsPanel:catch1")(err); }
            return (
              <li key={fact.id} className="p-3 rounded-card border border-primary/10 bg-background/40 flex items-start gap-3">
                <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full border flex-shrink-0 ${importanceTint(fact.importance)}`}>
                  {fact.importance}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="typo-body text-foreground">{fact.content}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {fact.contact_handle && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-secondary/40 text-foreground truncate">
                        {fact.contact_handle}
                      </span>
                    )}
                    <span className="text-[10px] text-foreground">
                      {tx(t.distilled.sourceCount, { count: sourceCount })}
                    </span>
                    <span className="text-[10px] text-foreground">{<AbsoluteTime timestamp={fact.created_at} variant="date" />}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(fact.id)}
                  aria-label={t.distilled.deleteAria}
                  className="p-1 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
