import { useMemo, useState } from 'react';
import {
  BookOpen, Search, FileText, RefreshCw, Save,
  X, AlertCircle, ArrowDownAZ, ArrowDownNarrowWide,
  Hash, Filter,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { SkillEntry } from '@/api/devTools/devTools';
import type { SkillData } from './useSkillData';

/**
 * VARIANT — "Gallery": full-width skill gallery, modal viewer.
 *
 * Mental model: Notion gallery view of a skill catalog. The whole window
 * is dedicated to browsing — every skill visible at once, sortable,
 * filterable. Reading a skill happens in a focused modal so the gallery
 * stays as the persistent home base.
 *
 * Layout:
 *   - Header: title + sort/filter chips inline.
 *   - Search bar: full width at the top of the body.
 *   - Card grid: 2/3/4 columns responsive. Each card shows a category
 *     accent stripe (derived from name hash so adjacent skills feel
 *     visually distinct), large name, multi-line description, ref-file
 *     chip, last word of name as a tag.
 *   - Modal: triggered by clicking a card. Holds the file viewer/editor
 *     verbatim from baseline (file tabs, markdown render, edit mode).
 *
 * Differs from baseline:
 *   - 100% of the viewport surface is used for the catalog when no skill
 *     is open (baseline wastes the right ~70% if no selection).
 *   - Cards carry MORE information per skill (full description, sortable
 *     metadata) instead of the truncated single-line baseline card.
 *   - Reading a doc temporarily takes over the screen — better focus,
 *     dismissible with Esc, return to gallery preserves scroll position.
 *   - Sort + filter affordances surface explicitly (baseline only has
 *     search).
 */
export function SkillBrowserVariantGallery({ data }: { data: SkillData }) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const {
    skills, filtered, loading, search, setSearch,
    selectedSkill, activeFile, fileContent, editContent, setEditContent,
    editing, setEditing, saving, fileLoading, loadFailed,
    skillFiles, fetchSkills, selectSkill, switchFile, save, cancelEdit, clearSelection,
  } = data;

  const [sort, setSort] = useState<'name' | 'refs'>('name');
  const [filterRefs, setFilterRefs] = useState<'all' | 'with-refs' | 'doc-only'>('all');

  const visible = useMemo(() => {
    let v = filtered;
    if (filterRefs === 'with-refs') v = v.filter((s) => s.referenceFileCount > 0);
    if (filterRefs === 'doc-only') v = v.filter((s) => s.referenceFileCount === 0);
    v = [...v].sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name)
      : b.referenceFileCount - a.referenceFileCount);
    return v;
  }, [filtered, sort, filterRefs]);

  const totalRefs = skills.reduce((sum, s) => sum + s.referenceFileCount, 0);

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={dt.skills_title}
        subtitle={tx(skills.length === 1 ? dt.skills_subtitle_one : dt.skills_subtitle_other, { count: skills.length })}
      />

      <ContentBody>
        <ActionRow
          left={
            <>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-pill border border-primary/15 bg-card/30 typo-caption text-foreground/80">
                <BookOpen className="w-3 h-3 text-primary" />
                {skills.length} skills
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-pill border border-primary/15 bg-card/30 typo-caption text-foreground/80">
                <FileText className="w-3 h-3 text-primary" />
                {totalRefs} reference files
              </span>
            </>
          }
        >
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

        {/* Search + sort + filter strip */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.plugins.dev_tools.search_skills}
              className="w-full pl-9 pr-3 py-2 typo-body bg-secondary/30 border border-primary/10 rounded-card text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>

          <div className="flex items-center gap-1 rounded-card border border-primary/10 bg-card/30 p-0.5">
            <ChipButton active={sort === 'name'} onClick={() => setSort('name')} icon={ArrowDownAZ} label="Name" />
            <ChipButton active={sort === 'refs'} onClick={() => setSort('refs')} icon={ArrowDownNarrowWide} label="Most refs" />
          </div>

          <div className="flex items-center gap-1 rounded-card border border-primary/10 bg-card/30 p-0.5">
            <ChipButton active={filterRefs === 'all'} onClick={() => setFilterRefs('all')} icon={Filter} label="All" />
            <ChipButton active={filterRefs === 'with-refs'} onClick={() => setFilterRefs('with-refs')} icon={Hash} label="With refs" />
            <ChipButton active={filterRefs === 'doc-only'} onClick={() => setFilterRefs('doc-only')} icon={FileText} label="Doc-only" />
          </div>
        </div>

        {/* Gallery grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="w-5 h-5 animate-spin text-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-primary/10 rounded-card">
            <AlertCircle className="w-7 h-7 text-foreground/40 mx-auto mb-2" />
            <p className="typo-body text-foreground/70">
              {search ? t.plugins.dev_tools.no_matching_skills : t.plugins.dev_tools.no_skills_found}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visible.map((skill) => (
              <GalleryCard key={skill.name} skill={skill} onOpen={() => selectSkill(skill)} />
            ))}
          </div>
        )}
      </ContentBody>

      {/* File-viewer modal */}
      <BaseModal
        isOpen={Boolean(selectedSkill)}
        onClose={clearSelection}
        titleId="skill-modal-title"
        size="lg"
        portal
      >
        {selectedSkill && (
          <div className="flex flex-col" style={{ minHeight: '60vh', maxHeight: '75vh' }}>
            {/* Modal title row */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-primary shrink-0" />
                <h2 id="skill-modal-title" className="typo-section-title truncate">{selectedSkill.name}</h2>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={clearSelection}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1 px-3 py-2 bg-secondary/30 border-b border-primary/10 overflow-x-auto">
              {skillFiles.map((f) => (
                <button
                  key={f}
                  onClick={() => switchFile(f)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-card text-[11px] font-medium whitespace-nowrap transition-colors ${
                    activeFile === f
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground/70 hover:text-foreground hover:bg-primary/5'
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

            <div className="flex-1 overflow-y-auto p-5">
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
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full min-h-[400px] p-3 text-md font-mono bg-secondary/20 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-none"
                  spellCheck={false}
                />
              ) : fileContent ? (
                <MarkdownRenderer content={fileContent} />
              ) : !loadFailed ? (
                <p className="text-md text-foreground/60 text-center py-8">
                  {t.plugins.dev_tools.file_empty}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </BaseModal>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Gallery card — extractable, the visual workhorse of this variant
// ---------------------------------------------------------------------------

const ACCENTS = [
  { stripe: 'bg-blue-400/70', text: 'text-blue-300' },
  { stripe: 'bg-emerald-400/70', text: 'text-emerald-300' },
  { stripe: 'bg-amber-400/70', text: 'text-amber-300' },
  { stripe: 'bg-violet-400/70', text: 'text-violet-300' },
  { stripe: 'bg-rose-400/70', text: 'text-rose-300' },
  { stripe: 'bg-cyan-400/70', text: 'text-cyan-300' },
] as const;

// Stable hash → palette index. Same skill name always gets the same colour
// so the gallery feels coherent across reloads.
function accentForName(name: string): typeof ACCENTS[number] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length]!;
}

function GalleryCard({ skill, onOpen }: { skill: SkillEntry; onOpen: () => void }) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const accent = accentForName(skill.name);
  return (
    <button
      onClick={onOpen}
      className="text-left rounded-card border border-primary/10 bg-card/30 overflow-hidden hover:border-primary/25 hover:bg-card/50 transition-colors group"
    >
      <div className={`h-1 w-full ${accent.stripe} opacity-80 group-hover:opacity-100 transition-opacity`} />
      <div className="p-4">
        <div className="flex items-start gap-2 mb-2">
          <BookOpen className={`w-4 h-4 ${accent.text} shrink-0 mt-0.5`} />
          <h3 className="typo-section-title text-foreground leading-tight flex-1 min-w-0 break-words">
            {skill.name}
          </h3>
        </div>
        {skill.description ? (
          <p className="typo-body text-foreground/75 line-clamp-3 mb-3">{skill.description}</p>
        ) : (
          <p className="typo-caption text-foreground/40 italic mb-3">No description</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {skill.referenceFileCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border border-primary/15 bg-card/40 typo-caption text-foreground/70">
              <FileText className="w-3 h-3" />
              {tx(skill.referenceFileCount === 1 ? dt.skills_ref_count_one : dt.skills_ref_count_other, { count: skill.referenceFileCount })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border border-primary/10 bg-card/30 typo-caption text-foreground/50">
              SKILL.md only
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ChipButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Filter;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive typo-caption transition-colors ${
        active
          ? 'bg-primary/15 text-foreground'
          : 'text-foreground/65 hover:text-foreground hover:bg-primary/5'
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
