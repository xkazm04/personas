import { deriveArchCategories, userHasCategoryCredential } from '../matrix/architecturalCategories';

interface ArchCategoryIconsProps {
  connectors: string[];
  credentialServiceTypes: Set<string>;
}

export function ArchCategoryIcons({ connectors, credentialServiceTypes }: ArchCategoryIconsProps) {
  if (connectors.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {deriveArchCategories(connectors).map((cat) => {
        const hasIt = userHasCategoryCredential(cat.key, credentialServiceTypes);
        const CatIcon = cat.icon;
        return (
          <div
            key={cat.key}
            className="relative flex-shrink-0"
            title={`${cat.label}${hasIt ? ' (ready)' : ''}`}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                hasIt ? '' : 'grayscale opacity-60'
              }`}
              style={{ backgroundColor: `${cat.color}18` }}
            >
              <CatIcon className="w-4 h-4" style={{ color: cat.color }} />
            </div>
            <span
              className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                hasIt
                  ? 'bg-emerald-500'
                  : 'bg-amber-500/60 border border-dashed border-amber-500/30'
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}
