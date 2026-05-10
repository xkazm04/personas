import { useEffect, useMemo } from 'react';
import {
  BookOpen, Search, FileText, RefreshCw, Save,
  AlertCircle, ChevronDown, ChevronRight, ArrowLeft, ArrowRight, Edit3,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { SkillData } from './useSkillData';

/**
 * VARIANT — "Workbench": single-skill deep-dive, immersive reader.
 *
 * Mental model: a workbench dedicated to one skill at a time. The user
 * picks a skill, then the page becomes a focused reading + editing
 * environment for that skill's documents. Reference files are not equal
 * tabs — SKILL.md is the showcase, references are accordion sections
 * stacked below the main doc.
 *
 * Layout:
 *   - Narrow left rail (~200px): condensed skill picker, current skill
 *     highlighted, next/prev keyboard hint.
 *   - Wide reading pane: oversized title (typo-hero), description as
 *     subtitle, then SKILL.md content rendered with comfortable line
 *     length. Reference files appear as expandable accordion sections
 *     below — each can be opened independently for split-doc reading.
 *
 * Differs from baseline:
 *   - Reading is the primary affordance, not browsing. The page is
 *     designed for "I need to read or edit one specific skill" rather
 *     than "let me see what's in the catalog."
 *   - SKILL.md and reference files are NOT visually equal — SKILL.md is
 *     the doc, references are appendices.
 *   - Comfortable line length + larger typography make extended reading
 *     less tiring than the baseline's compact font.
 *   - Edit button moves into the reading pane header so it's where your
 *     eyes already are when you decide to make changes.
 */
export function SkillBrowserVariantWorkbench({ data }: { data: SkillData }) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const {
    skills, filtered, loading, search, setSearch,
    selectedSkill, activeFile, fileContent, editContent, setEditContent,
    editing, setEditing, saving, fileLoading, loadFailed,
    skillFiles, fetchSkills, selectSkill, switchFile, save, cancelEdit,
  } = data;

  // Auto-select first skill when none picked yet, so the workbench is never empty.
  useEffect(() => {
    if (!selectedSkill && filtered.length > 0 && filtered[0]) {
      selectSkill(filtered[0]);
    }
  }, [selectedSkill, filtered, selectSkill]);

  // Prev/next within the filtered list — reading mode benefits from sequential
  // navigation more than catalog mode does.
  const { prev, next } = useMemo(() => {
    if (!selectedSkill || filtered.length === 0) return { prev: null, next: null };
    const idx = filtered.findIndex((s) => s.name === selectedSkill.name);
    return {
      prev: idx > 0 ? filtered[idx - 1] ?? null : null,
      next: idx < filtered.length - 1 ? filtered[idx + 1] ?? null : null,
    };
  }, [selectedSkill, filtered]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={dt.skills_title}
        subtitle={tx(skills.length === 1 ? dt.skills_subtitle_one : dt.skills_subtitle_other, { count: skills.length })}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={fetchSkills}
            disabled={loading}
          >
            {t.common.refresh}
          </Button>
        }
      />

      <ContentBody noPadding>
        <div className="flex h-full min-h-[500px]">
          {/* ============================================================ */}
          {/* Left rail — condensed skill picker                            */}
          {/* ============================================================ */}
          <aside className="w-56 shrink-0 border-r border-card-border flex flex-col">
            <div className="p-3 border-b border-card-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/60" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.plugins.dev_tools.search_skills}
                  className="w-full pl-8 pr-2 py-1.5 typo-caption bg-secondary/30 border border-primary/10 rounded-card text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 px-3">
                  <AlertCircle className="w-5 h-5 text-foreground/40 mx-auto mb-2" />
                  <p className="typo-caption text-foreground/60">
                    {search ? t.plugins.dev_tools.no_matching_skills : t.plugins.dev_tools.no_skills_found}
                  </p>
                </div>
              ) : (
                filtered.map((skill) => {
                  const isActive = selectedSkill?.name === skill.name;
                  return (
                    <button
                      key={skill.name}
                      onClick={() => selectSkill(skill)}
                      className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2 border-l-2 ${
                        isActive
                          ? 'bg-primary/10 border-primary text-foreground'
                          : 'border-transparent text-foreground/75 hover:bg-primary/5 hover:text-foreground'
                      }`}
                    >
                      <BookOpen className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? 'text-primary' : 'text-foreground/50'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="typo-caption font-medium leading-tight truncate">{skill.name}</div>
                        {skill.referenceFileCount > 0 && (
                          <div className="text-[10px] text-foreground/50 mt-0.5">
                            +{skill.referenceFileCount} ref{skill.referenceFileCount === 1 ? '' : 's'}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer: prev/next navigation hint */}
            {selectedSkill && (
              <div className="border-t border-card-border p-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => prev && selectSkill(prev)}
                  disabled={!prev}
                  className="inline-flex items-center gap-1 px-2 py-1 typo-caption text-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  title={prev?.name}
                >
                  <ArrowLeft className="w-3 h-3" />
                </button>
                <span className="typo-caption text-foreground/40">
                  {filtered.findIndex((s) => s.name === selectedSkill.name) + 1} / {filtered.length}
                </span>
                <button
                  type="button"
                  onClick={() => next && selectSkill(next)}
                  disabled={!next}
                  className="inline-flex items-center gap-1 px-2 py-1 typo-caption text-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  title={next?.name}
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </aside>

          {/* ============================================================ */}
          {/* Reading pane                                                  */}
          {/* ============================================================ */}
          <main className="flex-1 min-w-0 overflow-y-auto">
            {!selectedSkill ? (
              <div className="flex items-center justify-center h-full p-12">
                <div className="text-center">
                  <BookOpen className="w-10 h-10 text-foreground/30 mx-auto mb-3" />
                  <p className="typo-body text-foreground/70">{t.plugins.dev_tools.select_skill}</p>
                </div>
              </div>
            ) : (
              <article className="max-w-3xl mx-auto px-8 py-10">
                {/* Skill header */}
                <header className="mb-6 pb-5 border-b border-card-border">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="typo-label text-foreground/50 mb-2">SKILL</p>
                      <h1 className="typo-hero text-foreground mb-3 break-words">{selectedSkill.name}</h1>
                      {selectedSkill.description && (
                        <p className="typo-body-lg text-foreground/75 leading-relaxed max-w-prose">
                          {selectedSkill.description}
                        </p>
                      )}
                    </div>
                    {/* Edit toolbar — anchored at the top of the doc */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {editing && activeFile === 'SKILL.md' ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={cancelEdit}>
                            {t.common.cancel}
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
                      ) : activeFile === 'SKILL.md' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Edit3 className="w-3 h-3" />}
                          onClick={() => setEditing(true)}
                          disabled={loadFailed}
                        >
                          {t.plugins.dev_tools.edit}
                        </Button>
                      )}
                    </div>
                  </div>
                </header>

                {/* SKILL.md body — only when SKILL.md is the active file */}
                {activeFile === 'SKILL.md' && (
                  <DocumentBody
                    fileLoading={fileLoading}
                    loadFailed={loadFailed}
                    editing={editing}
                    fileContent={fileContent}
                    editContent={editContent}
                    setEditContent={setEditContent}
                    fileLoadFailedHeading={t.plugins.dev_tools.file_load_failed}
                    fileLoadFailedHint={t.plugins.dev_tools.file_load_failed_hint}
                    fileEmptyMessage={t.plugins.dev_tools.file_empty}
                  />
                )}

                {/* Reference files — accordion appendices below SKILL.md */}
                {skillFiles.length > 1 && (
                  <section className="mt-10">
                    <p className="typo-label text-foreground/50 mb-3">REFERENCE FILES</p>
                    <div className="space-y-2">
                      {skillFiles.filter((f) => f !== 'SKILL.md').map((f) => {
                        const isOpen = activeFile === f;
                        return (
                          <div
                            key={f}
                            className={`border rounded-card transition-colors ${
                              isOpen ? 'border-primary/25 bg-primary/[0.04]' : 'border-card-border'
                            }`}
                          >
                            <button
                              onClick={() => switchFile(isOpen ? 'SKILL.md' : f)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left"
                            >
                              {isOpen ? (
                                <ChevronDown className="w-3.5 h-3.5 text-foreground/60" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-foreground/40" />
                              )}
                              <FileText className={`w-3.5 h-3.5 ${isOpen ? 'text-primary' : 'text-foreground/50'}`} />
                              <span className="typo-body font-medium text-foreground">{f}</span>
                              {isOpen && (
                                <div className="ml-auto flex items-center gap-1.5">
                                  {editing ? (
                                    <>
                                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>
                                        {t.common.cancel}
                                      </Button>
                                      <Button
                                        variant="accent"
                                        accentColor="emerald"
                                        size="sm"
                                        icon={<Save className="w-3 h-3" />}
                                        onClick={(e) => { e.stopPropagation(); save(); }}
                                        loading={saving}
                                        disabled={editContent === fileContent}
                                      >
                                        {t.plugins.dev_tools.save}
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                                      disabled={loadFailed}
                                    >
                                      {t.plugins.dev_tools.edit}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </button>
                            {isOpen && (
                              <div className="border-t border-card-border px-4 py-4">
                                <DocumentBody
                                  fileLoading={fileLoading}
                                  loadFailed={loadFailed}
                                  editing={editing}
                                  fileContent={fileContent}
                                  editContent={editContent}
                                  setEditContent={setEditContent}
                                  fileLoadFailedHeading={t.plugins.dev_tools.file_load_failed}
                                  fileLoadFailedHint={t.plugins.dev_tools.file_load_failed_hint}
                                  fileEmptyMessage={t.plugins.dev_tools.file_empty}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </article>
            )}
          </main>
        </div>
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// DocumentBody — shared rendering of viewer/editor for both SKILL.md and refs
// ---------------------------------------------------------------------------

function DocumentBody({
  fileLoading, loadFailed, editing, fileContent, editContent, setEditContent,
  fileLoadFailedHeading, fileLoadFailedHint, fileEmptyMessage,
}: {
  fileLoading: boolean;
  loadFailed: boolean;
  editing: boolean;
  fileContent: string;
  editContent: string;
  setEditContent: (v: string) => void;
  fileLoadFailedHeading: string;
  fileLoadFailedHint: string;
  fileEmptyMessage: string;
}) {
  if (fileLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
      </div>
    );
  }
  if (loadFailed) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-modal border border-amber-500/30 bg-amber-500/10 text-amber-200 typo-caption">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <div>
          <p className="font-medium">{fileLoadFailedHeading}</p>
          <p className="text-amber-200/60 mt-0.5">{fileLoadFailedHint}</p>
        </div>
      </div>
    );
  }
  if (editing) {
    return (
      <textarea
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        className="w-full min-h-[400px] p-3 typo-body font-mono bg-secondary/20 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-none"
        spellCheck={false}
      />
    );
  }
  if (fileContent) {
    return <MarkdownRenderer content={fileContent} />;
  }
  return (
    <p className="typo-body text-foreground/55 text-center py-8">{fileEmptyMessage}</p>
  );
}

