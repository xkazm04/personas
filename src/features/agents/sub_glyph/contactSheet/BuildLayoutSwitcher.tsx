/** BuildLayoutSwitcher - TEMPORARY switcher (spark onboarding-blueprint).
 *  The Schematic Dial won the prototype round; Cinema stays beside it, and
 *  the default, until the dial is polished. Deleted when one of them goes.
 *  The pick is remembered for the app session only (module memory): a
 *  prototype choice is not user state worth persisting. */
import { useState } from "react";
import { SegmentedTabs } from "@/features/shared/components/layout/SegmentedTabs";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { ContactSheetCinemaLayout } from "./cinema/ContactSheetCinemaLayout";
import { SchematicDialLayout } from "./dial/SchematicDialLayout";

type BuildLayout = "cinema" | "dial";
const ID_PREFIX = "build-layout";
const TABS: { id: BuildLayout; label: string }[] = [
  { id: "cinema", label: "Cinema" },
  { id: "dial", label: "Schematic Dial" },
];

let remembered: BuildLayout = "cinema";

export function BuildLayoutSwitcher(props: GlyphFullLayoutProps) {
  const [layout, setLayout] = useState<BuildLayout>(remembered);
  const pick = (next: BuildLayout) => {
    remembered = next;
    setLayout(next);
  };
  return (
    <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
      <SegmentedTabs<BuildLayout>
        tabs={TABS.map((t) => ({ ...t, testId: `build-layout-${t.id}` }))}
        activeTab={layout}
        onTabChange={pick}
        idPrefix={ID_PREFIX}
        size="sm"
        ariaLabel="Build layout prototype"
        className="self-center"
      />
      <div role="tabpanel" id={`${ID_PREFIX}-panel-${layout}`} aria-labelledby={`${ID_PREFIX}-tab-${layout}`} className="flex-1 min-h-0 w-full flex flex-col">
        {layout === "dial" ? <SchematicDialLayout {...props} /> : <ContactSheetCinemaLayout {...props} />}
      </div>
    </div>
  );
}
