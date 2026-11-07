// SkillInfoModal — the shared "what is this skill" surface, opened by clicking
// a skill name in Overview / Analytics / Registry. Shows an understandable
// summary (the standard `description` = what + when), how to invoke it (command
// + argument variations), and the skill's metadata. Preset scan skills are
// described from the in-memory catalogue; custom skills are parsed from their
// SKILL.md (Claude Code / Agent Skills frontmatter standard).
import { useEffect, useState } from 'react';
import { BookOpen, Copy, Wand2 } from 'lucide-react';

import { readSkillFile } from '@/api/devTools/devTools';
import { BaseModal } from '@/features/shared/components/modals';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { PRESET_SKILLS, presetVisual } from '../constants/presetSkills';
import { commandVariations, metaFromPreset, metaFromSkillMd, type SkillMeta } from './skillMeta';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons';

/** Read a skill's SKILL.md, trying the project copy then the global one, and
 *  both filename casings (SKILL.md / skill.md live in the wild). */
async function loadSkillMd(name: string, projectId: string | null): Promise<string | null> {
  for (const pid of [projectId, null]) {
    for (const file of ['SKILL.md', 'skill.md']) {
      try {
        const { content } = await readSkillFile(name, file, pid);
        if (content) return content;
      } catch (e) {
        // Expected for sources the skill isn't in (project vs global × casing);
        // breadcrumb only, then fall through to the next source.
        silentCatch('skillInfo:readSource')(e);
      }
    }
  }
  return null;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 typo-label text-ink-3 border border-hair bg-surface-2 rounded-interactive px-1.5 py-0.5">{children}</span>;
}

export function SkillInfoModal({ skillName, projectId, onClose }: {
  skillName: string;
  projectId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const { copy } = useCopyToClipboard();
  const addToast = useToastStore((s) => s.addToast);
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [loading, setLoading] = useState(true);

  const visual = presetVisual(skillName);

  useEffect(() => {
    let alive = true;
    const preset = PRESET_SKILLS.get(skillName);
    if (preset) { setMeta(metaFromPreset(preset)); setLoading(false); return; }
    setLoading(true);
    void loadSkillMd(skillName, projectId)
      .then((content) => {
        if (!alive) return;
        setMeta(content ? metaFromSkillMd(skillName, content) : { name: skillName, description: null, argumentHint: null, category: null, contextsTracked: false, memory: null, bodySummary: null });
        setLoading(false);
      })
      .catch((e) => { silentCatch('skillInfo load')(e); if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [skillName, projectId]);

  const Icon = visual?.icon ?? Wand2;
  const hue = visual?.color;

  return (
    <BaseModal isOpen onClose={onClose} titleId="skill-info-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="skill-info-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-hair bg-surface-2">
          <Icon className="w-4 h-4 flex-shrink-0" style={hue ? { color: hue } : undefined} aria-hidden />
          <span id="skill-info-title" className="typo-title truncate">{skillName}</span>
          {meta?.category && <span className="ml-auto typo-label text-ink-3 flex-shrink-0">{meta.category}</span>}
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <p className="typo-caption text-ink-3">{d.skills_info_loading}</p>
          ) : (
            <>
              {/* summary — the description (what + when) */}
              <div className="rounded-input bg-background/40 border border-hair px-3 py-2.5">
                {meta?.description
                  ? <p className="typo-caption text-ink-2">{meta.description}</p>
                  : <p className="typo-caption text-ink-3 italic">{d.skills_confirm_no_desc}</p>}
                {meta?.bodySummary && meta.bodySummary !== meta.description && (
                  <p className="typo-caption mt-2">{meta.bodySummary}</p>
                )}
              </div>

              {/* how to invoke */}
              {meta && (
                <div className="space-y-1.5">
                  <div className="typo-label text-ink-3">{d.skills_info_invoke}</div>
                  <ul className="space-y-1">
                    {commandVariations(meta).map((v) => (
                      <li key={v.command}>
                        <PressSurface
                          onPress={() => { copy(v.command); addToast(d.skills_info_copied, 'success'); }}
                          data-testid={`skill-info-cmd-${v.note}`}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-input bg-background/70 border border-hair hover:border-primary/30 group"
                        >
                          <span className="font-mono typo-caption text-primary truncate">{v.command}</span>
                          <span className="typo-label text-ink-3 flex-shrink-0">· {v.note}</span>
                          <Copy className="w-3 h-3 ml-auto text-ink-3 group-hover:text-ink-2 flex-shrink-0" aria-hidden />
                        </PressSurface>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* metadata */}
              {meta && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {meta.memory && <Chip>{d.skills_info_memory}: {meta.memory}</Chip>}
                  {meta.contextsTracked && <Chip><BookOpen className="w-3 h-3" aria-hidden /> {d.skills_info_context_tracked}</Chip>}
                  {meta.argumentHint && <Chip>{d.skills_info_args}: <span className="font-mono">{meta.argumentHint}</span></Chip>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-hair bg-surface-1">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}
           >
            {t.common.close}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
