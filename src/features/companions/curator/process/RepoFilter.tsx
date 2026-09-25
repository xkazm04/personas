import { useState } from 'react';
import { Check, ChevronDown, FolderGit2 } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { searchItems } from '@/features/shared/components/display/facetedTableModel';
import { useTranslation } from '@/i18n/useTranslation';

interface RepoFilterProps {
  /** Repositories in this mode, largest first, with their session counts. */
  repos: { name: string; n: number }[];
  total: number;
  value: string | null;
  onChange: (value: string | null) => void;
}

type Option = { name: string | null; n: number };

/**
 * The group picker. A dropdown rather than a side list because the list of repositories only
 * grows, and a side panel pays for every one of them in width the spine needs.
 */
export function RepoFilter({ repos, total, value, onChange }: RepoFilterProps) {
  const { t } = useTranslation();
  const p = t.companions.process;
  const [query, setQuery] = useState('');
  const options: Option[] = searchItems<Option>([{ name: null, n: total }, ...repos], query, (o) => [o.name ?? p.repo_all]);

  const pick = (o: Option | undefined, close?: () => void) => {
    if (!o) return;
    onChange(o.name);
    close?.();
  };

  return (
    <Listbox
      ariaLabel={p.repo_aria}
      itemCount={options.length}
      searchable
      searchPlaceholder={p.repo_search}
      onSearchChange={setQuery}
      onSelectFocused={(i) => pick(options[i])}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          data-testid="process-repo-filter"
          className={`inline-flex items-center gap-2 rounded-interactive border px-3 py-1.5 typo-body focus-ring transition-colors ${
            value ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-secondary/40'
          }`}
        >
          <FolderGit2 className="h-4 w-4" />
          {value ?? p.repo_all}
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="max-h-[26rem] min-w-[18rem] overflow-y-auto py-1">
          {options.map((o, i) => {
            const active = o.name === value;
            return (
              <button
                type="button"
                key={o.name ?? '*'}
                role="option"
                aria-selected={active}
                onClick={() => pick(o, close)}
                className={`flex w-full items-center gap-3 px-3 py-2 typo-body transition-colors hover:bg-secondary/40 ${
                  i === focusIndex ? 'bg-secondary/40' : ''
                } ${active ? 'text-primary' : 'text-foreground'}`}
              >
                <span className="flex-1 truncate text-left">{o.name ?? p.repo_all}</span>
                <span className="typo-caption tabular-nums">{o.n}</span>
                <Check className={`h-4 w-4 flex-shrink-0 ${active ? 'text-primary' : 'invisible'}`} />
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}
