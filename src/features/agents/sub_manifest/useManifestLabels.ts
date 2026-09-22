import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DocumentAuthor, DocumentSurfaceLabels } from '@/features/shared/components/document';

/**
 * The manifest's vocabulary for the shared document surface.
 *
 * The surface is a primitive and owns no words; this is where the manifest's
 * own `t.agents.manifest.*` keys become the strings it renders, which keeps
 * every translated string next to the feature a translator can see it in.
 */
export function useManifestLabels(): DocumentSurfaceLabels {
  const { t, tx } = useTranslation();
  const m = t.agents.manifest;
  const common = t.common;

  return useMemo<DocumentSurfaceLabels>(() => {
    const pick = <T,>(a: DocumentAuthor, you: T, agent: T, neither: T) =>
      a === 'you' ? you : a === 'agent' ? agent : neither;
    const author = (a: DocumentAuthor) => pick(a, m.author_you, m.author_agent, m.author_neither);
    return {
      railLabel: m.rail_label,
      railCaption: { title: m.rail_caption_title, aside: m.rail_caption_aside },
      tabsLabel: m.tabs_label,
      mark: (a) => pick(a, m.mark_you, m.mark_agent, m.mark_neither),
      sealQuiet: (a, canWrite) => `${author(a)} · ${canWrite ? m.saves_whole : m.accept_reject}`,
      lede: (a) => pick(a, m.lede_you, m.lede_agent, m.lede_neither),
      writeHere: m.write_here,
      readOnlyNote: m.read_only_note,
      draftKept: m.draft_kept,
      draftMark: m.draft_mark,
      empty: m.law_empty,
      lines: (count) => (count === 1 ? m.lines_one : tx(m.lines_other, { count })),
      waiting: (count) => (count === 1 ? m.waiting_one : tx(m.waiting_other, { count })),
      scrollOn: (number, chapter) => tx(m.scroll_on, { number, chapter }),
      scrollBack: (number, chapter) => tx(m.scroll_back, { number, chapter }),
      editor: (heading) => ({
        field: tx(m.editor_field, { section: heading }),
        hint: m.editor_hint,
        save: common.save,
      }),
    };
  }, [m, common, tx]);
}
