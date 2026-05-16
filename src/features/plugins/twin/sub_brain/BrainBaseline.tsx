import { Brain, Database, Link, Unlink, FolderTree, RefreshCw, AlertCircle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { CoachMark } from '../CoachMark';
import { useBrainConnection } from './useBrainConnection';
import { DistilledFactsPanel } from './DistilledFactsPanel';

export default function BrainBaseline() {
  const t = useTranslation().t.twin;
  const {
    activeTwin, activeTwinId,
    kbInfo, allKbs, kbLoading, createError, creating, pickMode, setPickMode,
    refreshKb, loadAllKbs, handleCreateKb, handleBind, handleUnbind,
  } = useBrainConnection();

  if (!activeTwinId) return <TwinEmptyState icon={Brain} title={t.brain.title} />;

  return (
    <ContentBox>
      <ContentHeader icon={<Brain className="w-5 h-5 text-violet-400" />} iconColor="violet" title={`${t.brain.title} — ${activeTwin?.name ?? ''}`} subtitle={t.brain.subtitle} />
      <ContentBody>
        <div className="space-y-6 pb-8">
          <CoachMark id="brain" title={t.coach.brainTitle} body={t.coach.brainBody} />
          <div className="p-4 rounded-card border border-violet-500/15 bg-violet-500/5">
            <div className="flex items-center gap-2 mb-2">
              <FolderTree className="w-4 h-4 text-violet-400" />
              <span className="typo-section-title">{t.brain.obsidianVault}</span>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-secondary/30 text-foreground">{t.brain.optional}</span>
            </div>
            <p className="typo-body text-foreground mb-2">
              {t.brain.obsidianDescription}{' '}
              {t.brain.obsidianTwinReadsFrom} <code className="typo-code">{activeTwin?.obsidian_subpath}</code>.
            </p>
            <p className="typo-caption text-foreground">{t.brain.obsidianHint}</p>
          </div>

          <div className="p-4 rounded-card border border-primary/10 bg-card/40">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-violet-400" />
              <span className="typo-section-title">{t.brain.knowledgeBase}</span>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">{t.brain.requiredForRecall}</span>
            </div>
            <p className="typo-caption text-foreground mb-3">{t.brain.kbDescription}</p>

            {kbLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="typo-body text-foreground ml-3">{t.brain.loadingKb}</span>
              </div>
            ) : kbInfo ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="typo-body text-primary font-medium">{kbInfo.name}</p>
                    <p className="typo-caption text-foreground mt-0.5">{kbInfo.document_count} {t.brain.documents}, {kbInfo.chunk_count} {t.brain.chunks}</p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${kbInfo.status === 'ready' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-amber-500/15 text-amber-400 border-amber-500/25'}`}>{kbInfo.status}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={refreshKb} variant="ghost" size="sm"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />{t.brain.refresh}</Button>
                  <Button onClick={handleUnbind} variant="ghost" size="sm"><Unlink className="w-3.5 h-3.5 mr-1.5" />{t.brain.unbind}</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button onClick={handleCreateKb} disabled={creating} size="sm">
                    <Database className="w-3.5 h-3.5 mr-1.5" />{creating ? t.brain.creatingKb : t.brain.createNewKb}
                  </Button>
                  <Button onClick={() => { setPickMode(true); loadAllKbs(); }} variant="secondary" size="sm">
                    <Link className="w-3.5 h-3.5 mr-1.5" />{t.brain.linkExisting}
                  </Button>
                </div>
                {createError && (
                  <div className="flex items-start gap-2 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="typo-caption text-foreground">{createError}</p>
                  </div>
                )}
                {pickMode && (
                  <div className="p-3 rounded-interactive border border-primary/15 bg-background space-y-2">
                    <p className="typo-caption text-foreground font-medium">{t.brain.selectExistingKb}</p>
                    {allKbs.length === 0 ? (
                      <p className="typo-caption text-foreground">{t.brain.noKbsFound}</p>
                    ) : allKbs.map((kb) => (
                      <button key={kb.id} onClick={() => handleBind(kb.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-interactive hover:bg-secondary/40 transition-colors text-left">
                        <span className="typo-body text-foreground">{kb.name}</span>
                        <span className="typo-caption text-foreground">{kb.document_count} {t.brain.docs}</span>
                      </button>
                    ))}
                    <button onClick={() => setPickMode(false)} className="typo-caption text-foreground hover:text-foreground mt-1">{t.profiles.cancel}</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeTwinId && <DistilledFactsPanel twinId={activeTwinId} />}

          <div className="p-4 rounded-card border border-primary/5 bg-card/20">
            <p className="typo-caption text-foreground font-medium mb-2">{t.brain.howBrainGrows}</p>
            <ol className="typo-caption text-foreground space-y-1 list-decimal list-inside">
              <li>{t.brain.brainStep1}</li>
              <li>{t.brain.brainStep2}</li>
              <li>{t.brain.brainStep3}</li>
              <li>{t.brain.brainStep4}</li>
              <li>{t.brain.brainStep5}</li>
            </ol>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
