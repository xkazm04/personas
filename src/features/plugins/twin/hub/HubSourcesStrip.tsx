/**
 * The knowledge sources strip — three compact, icon-led lines above every Hub
 * variant: the bound knowledge base, the compiled wiki, and the doctrine
 * ingest. A control that cannot act stays VISIBLE and says why in one line
 * (`disabledReason`), because a vanished button teaches nothing.
 */

import { useState } from 'react';
import { Database, Download, Link2, Plus, ScrollText, ShieldCheck, Unlink } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_BUSY, type HubFeed } from './useHubFeed';

export function HubSourcesStrip({ feed }: { feed: HubFeed }) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub.sources;
  const [picking, setPicking] = useState(false);
  const { sources } = feed;
  const kbBound = !!sources.knowledgeBaseId;
  const kbBusy = feed.busyId === HUB_BUSY.kb;

  return (
    <div className="flex-shrink-0 border-b border-border bg-card/30">
      <div className="px-4 md:px-6 xl:px-8 py-2 space-y-1.5">

        {/* ── Knowledge base ─────────────────────────────────────── */}
        <Row icon={<Database className="w-3.5 h-3.5 text-primary" />} label={t.kbLabel}>
          <span className="typo-caption text-foreground truncate">
            {kbBound
              ? tx(t.kbStats, {
                  name: sources.knowledgeBaseName ?? '',
                  documents: sources.documents ?? 0,
                  chunks: sources.chunks ?? 0,
                })
              : t.kbUnbound}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {kbBound ? (
              <AsyncButton size="xs" variant="ghost" isLoading={kbBusy}
                icon={<Unlink className="w-3 h-3" />} onClick={() => feed.unbindKnowledgeBase()}>
                {t.kbUnbind}
              </AsyncButton>
            ) : (
              <>
                <AsyncButton size="xs" variant="accent" accentColor="violet" isLoading={kbBusy}
                  icon={<Plus className="w-3 h-3" />} onClick={() => feed.createBoundKnowledgeBase()}>
                  {t.kbCreate}
                </AsyncButton>
                <AsyncButton size="xs" variant="ghost" icon={<Link2 className="w-3 h-3" />}
                  onClick={async () => { setPicking((v) => !v); await feed.loadKnowledgeBases(); }}>
                  {t.kbBind}
                </AsyncButton>
              </>
            )}
          </div>
        </Row>

        <Collapse open={picking && !kbBound} unmountWhenClosed className="pl-6">
          <div className="flex flex-wrap gap-1.5 py-1">
            {feed.knowledgeBases.length === 0 ? (
              <span className="typo-caption text-foreground">{t.kbNone}</span>
            ) : feed.knowledgeBases.map((kb) => (
              <button key={kb.id} type="button"
                onClick={() => { setPicking(false); void feed.bindKnowledgeBase(kb.id); }}
                className="px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 typo-caption text-foreground transition-colors hover:bg-primary/20 focus-ring">
                {kb.name}
              </button>
            ))}
          </div>
        </Collapse>

        {/* ── Wiki ───────────────────────────────────────────────── */}
        <Row icon={<ScrollText className="w-3.5 h-3.5 text-status-info" />} label={t.wikiLabel}>
          {sources.wikiCompiledAt ? (
            <span className="typo-caption text-foreground truncate">
              {tx(t.wikiFiles, { count: sources.wikiFiles ?? 0 })}
              {' · '}
              <RelativeTime timestamp={sources.wikiCompiledAt} className="tabular-nums" />
            </span>
          ) : (
            <span className="typo-caption text-foreground">{t.wikiNever}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <AsyncButton size="xs" variant="accent" accentColor="violet"
              isLoading={feed.busyId === HUB_BUSY.wiki}
              icon={<ScrollText className="w-3 h-3" />} onClick={() => feed.compileWiki()}>
              {t.wikiCompile}
            </AsyncButton>
            <AsyncButton size="xs" variant="ghost" isLoading={feed.busyId === HUB_BUSY.audit}
              disabled={!sources.wikiCompiledAt}
              disabledReason={!sources.wikiCompiledAt ? t.wikiAuditNeedsCompile : undefined}
              icon={<ShieldCheck className="w-3 h-3" />} onClick={() => feed.auditWiki()}>
              {t.wikiAudit}
            </AsyncButton>
          </div>
        </Row>

        {/* ── Doctrine ingest ────────────────────────────────────── */}
        <Row icon={<Download className="w-3.5 h-3.5 text-status-success" />} label={t.doctrineLabel}>
          <span className="typo-caption text-foreground truncate">{t.doctrineHint}</span>
          <div className="ml-auto">
            <AsyncButton size="xs" variant="ghost" isLoading={feed.busyId === HUB_BUSY.doctrine}
              disabled={!kbBound} disabledReason={!kbBound ? t.doctrineNeedsKb : undefined}
              icon={<Download className="w-3 h-3" />} onClick={() => feed.ingestDoctrine()}>
              {t.doctrineIngest}
            </AsyncButton>
          </div>
        </Row>
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="flex-shrink-0">{icon}</span>
      <span className="typo-label text-foreground flex-shrink-0 w-20 truncate">{label}</span>
      {children}
    </div>
  );
}
