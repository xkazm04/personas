/** BuildLayoutSwitcher - TEMPORARY prototype switcher (spark
 *  onboarding-blueprint). Cinema stays the default; the three blueprint
 *  variants run on the same props. Deleted at consolidation, with the losers. */
import { useState } from "react";
import { silentCatch } from "@/lib/silentCatch";
import { SegmentedTabs } from "@/features/shared/components/layout/SegmentedTabs";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { ContactSheetCinemaLayout } from "./cinema/ContactSheetCinemaLayout";
import { AnnotatedSheetLayout } from "./annotated/AnnotatedSheetLayout";
import { DraftingSheetLayout } from "./drafting/DraftingSheetLayout";
import { SchematicDialLayout } from "./dial/SchematicDialLayout";

type BuildLayout = "cinema" | "annotated" | "drafting" | "dial";
const KEY = "personas.buildLayoutPrototype.v1";
const TABS: { id: BuildLayout; label: string }[] = [
  { id: "cinema", label: "Cinema" },
  { id: "annotated", label: "Annotated Sheet" },
  { id: "drafting", label: "Drafting Sheet" },
  { id: "dial", label: "Schematic Dial" },
];

function readLayout(): BuildLayout {
  try {
    const v = window.localStorage.getItem(KEY);
    return TABS.some((t) => t.id === v) ? (v as BuildLayout) : "cinema";
  } catch {
    return "cinema";
  }
}

export function BuildLayoutSwitcher(props: GlyphFullLayoutProps) {
  const [layout, setLayout] = useState<BuildLayout>(readLayout);
  const pick = (next: BuildLayout) => {
    setLayout(next);
    try { window.localStorage.setItem(KEY, next); } catch (err) { silentCatch("BuildLayoutSwitcher:remember")(err); }
  };
  return (
    <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
      <SegmentedTabs<BuildLayout>
        tabs={TABS.map((t) => ({ ...t, testId: `build-layout-${t.id}` }))}
        activeTab={layout}
        onTabChange={pick}
        size="sm"
        ariaLabel="Build layout prototype"
        className="self-center"
      />
      {layout === "annotated" ? <AnnotatedSheetLayout {...props} />
        : layout === "drafting" ? <DraftingSheetLayout {...props} />
        : layout === "dial" ? <SchematicDialLayout {...props} />
        : <ContactSheetCinemaLayout {...props} />}
    </div>
  );
}
