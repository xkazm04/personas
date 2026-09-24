/** SheetModals - what sits over the whole sheet rather than inside a layer:
 *  the force-promote / reject confirms, the test report, the dry-run
 *  (BuildSimulatePanel), and a recipe's detail from the compose act's
 *  starters (RecipeAlternativeModal, whose "select as alternative" seeds the
 *  intent). Each is an existing modal; the sheet only decides when. */
import { ConfirmDialog } from "@/features/shared/components/feedback/ConfirmDialog";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import { BuildSimulatePanel } from "@/features/agents/components/matrix/BuildSimulatePanel";
import { RecipeAlternativeModal } from "@/features/agents/sub_glyph/RecipeAlternativeModal";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "./useSheetState";
import { COPY } from "./copy";

export type SheetModal = "force" | "reject" | "report" | "simulate";

interface SheetModalsProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  modal: SheetModal | null;
  close: () => void;
}

export function SheetModals({ p, s, modal, close }: SheetModalsProps) {
  const buildDraft = useAgentStore((st) => st.buildDraft);
  const confirm = modal === "force" || modal === "reject" ? modal : null;
  const { open: recipe, setOpen: setRecipe, select } = s.recipes;

  return (
    <>
      {confirm && (
        <ConfirmDialog
          danger
          title={confirm === "force" ? COPY.promoteAnywayTitle : COPY.rejectTitle}
          body={confirm === "force" ? COPY.promoteAnywayBody : COPY.rejectBody}
          confirmLabel={confirm === "force" ? COPY.promoteAnyway.replace("...", "") : COPY.reject}
          onCancel={close}
          onConfirm={() => { close(); if (confirm === "force") p.onPromoteForce?.(); else p.onRejectTest?.(); }}
        />
      )}
      {modal === "report" && (
        <TestReportModal
          results={p.toolTestResults ?? []}
          summary={p.testSummary ?? null}
          onClose={close}
          onCredentialAdded={() => { void useAgentStore.getState().fetchPersonas(); }}
        />
      )}
      <BuildSimulatePanel isOpen={modal === "simulate"} onClose={close} sessionId={s.sessionId} draft={buildDraft} />
      {s.isCompose && recipe && (
        <RecipeAlternativeModal
          recipeId={recipe.recipe_id}
          recipeName={recipe.recipe_name}
          matchScore={recipe.score}
          onClose={() => setRecipe(null)}
          onSelect={select}
        />
      )}
    </>
  );
}
