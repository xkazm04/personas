import { Check, Plus, Star, Users } from 'lucide-react';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';

interface Props {
  entry: SharedEventCatalogEntry;
  isSubscribed: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
}

export function CatalogCard({ entry, isSubscribed, onSubscribe, onUnsubscribe }: Props) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-modal bg-card/60 border border-primary/10 hover:border-primary/20 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div
          className="flex-shrink-0 w-9 h-9 rounded-card flex items-center justify-center text-sm"
          style={{ backgroundColor: `${entry.color ?? '#3b82f6'}15` }}
        >
          {entry.icon ?? '📡'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground truncate">{entry.name}</span>
            {entry.isFeatured && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />}
          </div>
          <span className="text-[10px] text-foreground capitalize">{entry.category}</span>
        </div>
      </div>

      {/* Description */}
      {entry.description && (
        <p className="text-[11px] text-foreground leading-relaxed line-clamp-2">
          {entry.description}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1">
        <div className="flex items-center gap-3 text-[10px] text-foreground">
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {entry.subscriberCount}
          </span>
          {entry.publisher && (
            <span className="truncate max-w-[100px]">by {entry.publisher}</span>
          )}
        </div>

        <button
          onClick={isSubscribed ? onUnsubscribe : onSubscribe}
          className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-input transition-colors ${
            isSubscribed
              ? 'bg-emerald-500/10 text-emerald-400 hover:bg-red-500/10 hover:text-red-400'
              : 'bg-primary/10 text-primary hover:bg-primary/20'
          }`}
        >
          {isSubscribed ? (
            <>
              <Check className="w-3 h-3" />
              Subscribed
            </>
          ) : (
            <>
              <Plus className="w-3 h-3" />
              Subscribe
            </>
          )}
        </button>
      </div>
    </div>
  );
}
