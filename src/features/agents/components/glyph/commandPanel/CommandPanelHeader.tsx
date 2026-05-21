import { Sparkles } from "lucide-react";
import { DebtText } from '@/i18n/DebtText';


export function CommandPanelHeader() {
  return (
    <>
      <div className="flex items-center gap-2 px-5 md:px-6 pt-5 md:pt-6 pb-2 text-foreground font-semibold">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="typo-heading-sm"><DebtText k="auto_design_your_agent_e84a18e0" /></span>
      </div>
      <p className="px-5 md:px-6 pb-3 typo-caption text-foreground">
        <DebtText k="auto_fill_the_rows_that_apply_attach_a_schedule_ea6dc3f9" />
      </p>
    </>
  );
}
