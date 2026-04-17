import { FileJson, FileCode2 } from 'lucide-react';

export function PlatformLabels() {
  return (
    <div className="flex items-center gap-4 typo-body text-foreground">
      <span className="flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> n8n</span>
      <span className="text-primary/20" aria-hidden="true">|</span>
      <span className="flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> Zapier</span>
      <span className="text-primary/20" aria-hidden="true">|</span>
      <span className="flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> Make</span>
      <span className="text-primary/20" aria-hidden="true">|</span>
      {/* eslint-disable-next-line custom/no-hardcoded-jsx-text -- "GitHub Actions" is a brand name, not a translatable string */}
      <span className="flex items-center gap-1.5"><FileCode2 className="w-3.5 h-3.5" /> GitHub Actions</span>
    </div>
  );
}
