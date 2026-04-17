import { File, Tag } from 'lucide-react';
import type { ContextItem } from './contextMapTypes';

export default function ContextCard({
  ctx,
  selected,
  onSelect,
}: {
  ctx: ContextItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`animate-fade-in border rounded-modal p-4 cursor-pointer transition-colors ${
        selected
          ? 'bg-primary/10 border-primary/20'
          : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
      }`}
    >
      <h4 className="typo-card-label mb-1">{ctx.name}</h4>
      <p className="text-md text-foreground line-clamp-2 mb-3">{ctx.description}</p>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-foreground bg-primary/5 rounded-full px-2 py-0.5">
          <File className="w-3 h-3" />
          {ctx.filePaths.length} files
        </span>
        {ctx.keywords.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-foreground bg-primary/5 rounded-full px-2 py-0.5">
            <Tag className="w-3 h-3" />
            {ctx.keywords.length}
          </span>
        )}
      </div>
    </div>
  );
}
