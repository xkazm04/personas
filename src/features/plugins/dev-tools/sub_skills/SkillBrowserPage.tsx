import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Search, FileText, ChevronRight, Save,
  RefreshCw, X, FolderOpen, AlertCircle,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useToastStore } from '@/stores/toastStore';
import * as devApi from '@/api/devTools/devTools';
import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Skill Card (list item)
// ---------------------------------------------------------------------------

function SkillCard({
  skill,
  selected,
  onClick,
}: {
  skill: SkillEntry;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-modal border p-3 transition-all ${
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
              {skill.referenceFileCount} ref{skill.referenceFileCount !== 1 ? 's' : ''}
            </span>
          )}
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SkillBrowserPage() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Selection state
  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
  const [activeFile, setActiveFile] = useState<string>('SKILL.md');
  const [fileContent, setFileContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Fetch skills
  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const list = await devApi.listSkills();
      setSkills(list);
    } catch {
      addToast('Failed to load skills. Make sure a project with .claude/skills/ exists.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // Load file content when skill or file changes
  const loadFile = useCallback(async (skill: SkillEntry, fileName: string) => {
    setFileLoading(true);
    setEditing(false);
    setLoadFailed(false);
    try {
      const result = await devApi.readSkillFile(skill.name, fileName);
      setFileContent(result.content);
      setEditContent(result.content);
    } catch {
      setFileContent('');
      setEditContent('');
      setLoadFailed(true);
      addToast(`Failed to read ${skill.name}/${fileName}`, 'error');
    } finally {
      setFileLoading(false);
    }
  }, [addToast]);

  const handleSelectSkill = useCallback((skill: SkillEntry) => {
    setSelectedSkill(skill);
    setActiveFile('SKILL.md');
    loadFile(skill, 'SKILL.md');
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      await devApi.writeSkillFile(selectedSkill.name, activeFile, editContent);
      setFileContent(editContent);
      setEditing(false);
      addToast(`Saved ${selectedSkill.name}/${activeFile}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedSkill, activeFile, editContent, addToast]);

  // Filtered skills
  const filtered = search
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : skills;

  // Files for the selected skill
  const skillFiles = selectedSkill
    ? ['SKILL.md', ...selectedSkill.referenceFiles]
    : [];

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={t.plugins.dev_tools.skills_title}
        subtitle={`${skills.length} skill${skills.length !== 1 ? 's' : ''} installed`}
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

      <ContentBody>
        <div className="flex gap-4 h-full min-h-[400px]">
          {/* Left panel — skill list */}
          <div className="w-64 shrink-0 flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.plugins.dev_tools.search_skills}
                className="w-full pl-9 pr-3 py-2 text-xs bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>

            {/* Skill list */}
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-6 h-6 text-foreground mx-auto mb-2" />
                  <p className="text-xs text-foreground">
                    {search ? t.plugins.dev_tools.no_matching_skills : t.plugins.dev_tools.no_skills_found}
                  </p>
                </div>
              ) : (
                filtered.map((skill) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    selected={selectedSkill?.name === skill.name}
                    onClick={() => handleSelectSkill(skill)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right panel — file viewer/editor */}
          <div className="flex-1 min-w-0 border border-primary/10 rounded-card overflow-hidden flex flex-col">
            {!selectedSkill ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <FolderOpen className="w-10 h-10 text-foreground mb-3" />
                <p className="typo-body text-foreground">{t.plugins.dev_tools.select_skill}</p>
              </div>
            ) : (
              <>
                {/* File tabs */}
                <div className="flex items-center gap-1 px-3 py-2 bg-secondary/30 border-b border-primary/10 overflow-x-auto">
                  {skillFiles.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setActiveFile(f);
                        loadFile(selectedSkill, f);
                      }}
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

                  {/* Edit/Save toggle */}
                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    {editing ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditing(false);
                            setEditContent(fileContent);
                          }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="accent"
                          accentColor="emerald"
                          size="sm"
                          icon={<Save className="w-3 h-3" />}
                          onClick={handleSave}
                          loading={saving}
                          disabled={editContent === fileContent}
                        >
                          {t.plugins.dev_tools.save}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditing(true)}
                        disabled={loadFailed}
                      >
                        {t.plugins.dev_tools.edit}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto p-4">
                  {loadFailed && !fileLoading && (
                    <div className="flex items-center gap-2 p-3 mb-3 rounded-modal border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
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
                      className="w-full h-full min-h-[300px] p-3 text-md font-mono bg-secondary/20 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-none"
                      spellCheck={false}
                    />
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
