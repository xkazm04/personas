import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DocumentSurfaceLabels } from '@/features/shared/components/document';

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

  return useMemo<DocumentSurfaceLabels>(
    () => ({
      railLabel: m.rail_label,
      tabsLabel: m.tabs_label,
      author: (author) =>
        author === 'you' ? m.author_you : author === 'agent' ? m.author_agent : m.author_neither,
      savesWhole: m.saves_whole,
      writeHere: m.write_here,
      readOnlyNote: m.read_only_note,
      draftKept: m.draft_kept,
      empty: m.law_empty,
      lines: (count) => (count === 1 ? m.lines_one : tx(m.lines_other, { count })),
      waiting: (count) => (count === 1 ? m.waiting_one : tx(m.waiting_other, { count })),
      editor: (heading) => ({
        field: tx(m.editor_field, { section: heading }),
        hint: m.law_no_headings,
        save: common.save,
        stop: m.editor_stop,
      }),
    }),
    [m, common, tx],
  );
}
