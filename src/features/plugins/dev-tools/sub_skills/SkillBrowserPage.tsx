import {
  BookOpen, Search, FileText, ChevronRight, Save,
  RefreshCw, X, FolderOpen, AlertCircle, Star, Clock,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { SkillEntry } from '@/api/devTools/devTools';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { useSkillData } from './useSkillData';

/**
 * Skill browser — two-pane layout.
 *
 * Left rail: skill list with search + cards.
 * Right pane: file viewer/editor for the selected skill (file tabs +
 * markdown rendering + edit mode).
 */
export default function SkillBrowserPage() {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const data = useSkillData();
  const {
    skills, filtered, recentSkills, loading, search, setSearch,
    selectedSkill, activeFile, fileContent, editContent, setEditContent,
    editing, setEditing, saving, fileLoading, loadFailed,
    skillFiles, fetchSkills, selectSkill, switchFile, save, cancelEdit,
    toggleFavorite, isFavorite,
  } = data;

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={dt.skills_title}
        subtitle={tx(skills.length === 1 ? dt.skills_subtitle_one : dt.skills_subtitle_other, { count: skills.length })}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        <ActionRow>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={fetchSkills}
            disabled={loading}
          >
            {t.common.refresh}
          </Button>
        </ActionRow>

        <div className="flex gap-4 h-full min-h-[400px]">
          <div className="w-64 shrink-0 flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.plugins.dev_tools.search_skills}
                className="w-full pl-9 pr-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>

            {/* Recent chips — only shown when no search filter is active */}
            {!search && recentSkills.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Clock className="w-3 h-3 text-foreground" />
                  <span className="typo-caption uppercase tracking-[0.18em] text-foreground/70">
                    {t.plugins.dev_tools.skills_recent_heading}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {recentSkills.map((s) => (
                    <button
                      key={`recent-${s.name}`}
                      type="button"
                      onClick={() => selectSkill(s)}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                        selectedSkill?.name === s.name
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-primary/15 bg-card/30 text-foreground hover:border-primary/25 hover:bg-primary/5'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-1.5">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-6 h-6 text-foreground mx-auto mb-2" />
                  <p className="typo-caption text-foreground">
                    {search ? t.plugins.dev_tools.no_matching_skills : t.plugins.dev_tools.no_skills_found}
                  </p>
                </div>
              ) : (
                filtered.map((skill) => (
                  <SkillListItem
                    key={skill.name}
                    skill={skill}
                    selected={selectedSkill?.name === skill.name}
                    favorited={isFavorite(skill.name)}
                    onClick={() => selectSkill(skill)}
                    onToggleFavorite={() => toggleFavorite(skill.name)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 border border-primary/10 rounded-card overflow-hidden flex flex-col">
            {!selectedSkill ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <FolderOpen className="w-10 h-10 text-foreground mb-3" />
                <p className="typo-body text-foreground">{t.plugins.dev_tools.select_skill}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 px-3 py-2 bg-secondary/30 border-b border-primary/10 overflow-x-auto">
                  {skillFiles.map((f) => (
                    <button
                      key={f}
                      onClick={() => switchFile(f)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-card text-[11px] font-medium whitespace-nowrap transition-colors ${
                        activeFile === f
                          ? 'bg-primary/10 text-foreground'
                          : 'text-foreground hover:text-foreground hover:bg-primary/5'
                      }`}
                    >
                      <FileText className="w-3 h-3" />
                      {f}
                    </button>
                  ))}

                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    {editing ? (
                      <>
                        <Button variant="ghost" size="icon-sm" onClick={cancelEdit}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="accent"
                          accentColor="emerald"
                          size="sm"
                          icon={<Save className="w-3 h-3" />}
                          onClick={save}
                          loading={saving}
                          disabled={editContent === fileContent}
                        >
                          {t.plugins.dev_tools.save}
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={loadFailed}>
                        {t.plugins.dev_tools.edit}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {loadFailed && !fileLoading && (
                    <div className="flex items-center gap-2 p-3 mb-3 rounded-modal border border-amber-500/30 bg-amber-500/10 text-amber-200 typo-caption">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="font-medium">{t.plugins.dev_tools.file_load_failed}</p>
                        <p className="text-amber-200/60 mt-0.5">{t.plugins.dev_tools.file_load_failed_hint}</p>
                      </div>
                    </div>
                  )}
                  {fileLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
                    </div>
                  ) : editing ? (
                    <div className="grid grid-cols-2 gap-3 h-full min-h-[300px]">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full h-full min-h-[300px] p-3 text-md font-mono bg-secondary/20 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-none"
                        spellCheck={false}
                      />
                      <div className="border border-primary/10 rounded-modal bg-card/30 p-3 overflow-y-auto">
                        <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-primary/5">
                          <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">
                            {t.plugins.dev_tools.skills_preview_heading}
                          </span>
                          {editContent !== fileContent && (
                            <span className="text-[9px] text-amber-400/80 ml-auto">{t.plugins.dev_tools.skills_preview_unsaved}</span>
                          )}
                        </div>
                        {editContent.trim() ? (
                          <MarkdownRenderer content={editContent} />
                        ) : (
                          <p className="text-md text-foreground/45 italic">{t.plugins.dev_tools.skills_preview_empty}</p>
                        )}
                      </div>
                    </div>
                  ) : fileContent ? (
                    <MarkdownRenderer content={fileContent} />
                  ) : !loadFailed ? (
                    <p className="text-md text-foreground text-center py-8">
                      {t.plugins.dev_tools.file_empty}
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}

function SkillListItem({
  skill, selected, favorited, onClick, onToggleFavorite,
}: {
  skill: SkillEntry;
  selected: boolean;
  favorited: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
}) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      className={`w-full text-left rounded-modal border p-3 transition-all cursor-pointer ${
        selected
          ? 'border-primary/30 bg-primary/8 ring-1 ring-primary/20'
          : 'border-primary/10 bg-card/30 hover:border-primary/20'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-interactive flex items-center justify-center shrink-0 ${
          selected ? 'bg-primary/15 border border-primary/25' : 'bg-secondary/40 border border-primary/10'
        }`}>
          <BookOpen className={`w-4 h-4 ${selected ? 'text-primary' : 'text-foreground'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="typo-card-label truncate">{skill.name}</h4>
          {skill.description && (
            <p className="text-[10px] text-foreground mt-0.5 truncate">{skill.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {skill.referenceFileCount > 0 && (
            <span className="text-[9px] text-foreground bg-primary/5 rounded-full px-1.5 py-0.5">
              {tx(skill.referenceFileCount === 1 ? dt.skills_ref_count_one : dt.skills_ref_count_other, { count: skill.referenceFileCount })}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            title={favorited ? dt.skills_unfavorite : dt.skills_favorite}
            aria-label={favorited ? dt.skills_unfavorite : dt.skills_favorite}
            aria-pressed={favorited}
            className={`p-0.5 rounded transition-colors ${
              favorited ? 'text-amber-400 hover:text-amber-300' : 'text-foreground/30 hover:text-amber-400'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${favorited ? 'fill-amber-400' : ''}`} />
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        </div>
      </div>
    </div>
  );
}
