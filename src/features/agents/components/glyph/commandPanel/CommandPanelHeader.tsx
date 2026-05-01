import { Sparkles } from "lucide-react";

export function CommandPanelHeader() {
  return (
    <>
      <div className="flex items-center gap-2 px-5 md:px-6 pt-5 md:pt-6 pb-2 text-foreground font-semibold">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="typo-heading-sm">Design your agent</span>
      </div>
      <p className="px-5 md:px-6 pb-3 typo-caption text-foreground/80">
        Fill the rows that apply. Attach a schedule, apps, or events with the pickers.
      </p>
    </>
  );
}
