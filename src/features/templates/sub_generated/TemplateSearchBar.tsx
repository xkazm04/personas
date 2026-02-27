import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Plus,
  Filter,
  ChevronDown,
  CheckCircle2,
  X,
  ArrowUpDown,
  Trash2,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import type { ConnectorWithCount } from '@/api/reviews';

interface TemplateSearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  sortDir: string;
  onSortDirChange: (value: string) => void;
  connectorFilter: string[];
  onConnectorFilterChange: (connectors: string[]) => void;
  availableConnectors: ConnectorWithCount[];
  total: number;
  page: number;
  perPage: number;
  onNewTemplate: () => void;
  onCleanupDuplicates?: () => void;
  isCleaningUp?: boolean;
}

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Newest First', dir: 'desc' },
  { value: 'created_at_asc', label: 'Oldest First', dir: 'asc' },
  { value: 'name', label: 'Name A-Z', dir: 'asc' },
  { value: 'name_desc', label: 'Name Z-A', dir: 'desc' },
  { value: 'quality', label: 'Highest Quality', dir: 'desc' },
];

function ConnectorFilterDropdown({
  availableConnectors,
  connectorFilter,
  setConnectorFilter,
}: {
  availableConnectors: ConnectorWithCount[];
  connectorFilter: string[];
  setConnectorFilter: (connectors: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setDropdownSearch('');
    }
  }, [isOpen]);

  const toggleConnector = (name: string) => {
    if (connectorFilter.includes(name)) {
      setConnectorFilter(connectorFilter.filter((c) => c !== name));
    } else {
      setConnectorFilter([...connectorFilter, name]);
    }
  };

  const sorted = useMemo(() =>
    [...availableConnectors].sort((a, b) => {
      const la = getConnectorMeta(a.name).label;
      const lb = getConnectorMeta(b.name).label;
      return la.localeCompare(lb);
    }),
    [availableConnectors],
  );

  const filtered = useMemo(() => {
    const q = dropdownSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => {
      const meta = getConnectorMeta(item.name);
      return meta.label.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
    });
  }, [sorted, dropdownSearch]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/80 transition-colors flex items-center gap-1.5"
      >
        <Filter className="w-3.5 h-3.5" />
        Connectors
        {connectorFilter.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-xs font-medium">
            {connectorFilter.length}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-background border border-primary/20 rounded-xl shadow-xl min-w-[280px] overflow-hidden">
          {/* Search input */}
          <div className="px-3 py-2 border-b border-primary/10">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <input
                ref={searchInputRef}
                type="text"
                value={dropdownSearch}
                onChange={(e) => setDropdownSearch(e.target.value)}
                placeholder="Search connectors..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/40 border border-primary/10 rounded-lg text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/30 transition-colors"
              />
            </div>
          </div>

          {/* Connector list */}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.map((item) => {
              const meta = getConnectorMeta(item.name);
              const isSelected = connectorFilter.includes(item.name);
              return (
                <button
                  key={item.name}
                  onClick={() => toggleConnector(item.name)}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left hover:bg-primary/5 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${meta.color}20` }}
                  >
                    <ConnectorIcon meta={meta} size="w-4 h-4" />
                  </div>
                  <span className="text-sm text-foreground/90 flex-1">{meta.label}</span>
                  <span className="text-xs text-muted-foreground/50 tabular-nums px-1.5 py-0.5 rounded-full bg-secondary/60">
                    {item.count}
                  </span>
                  <div
                    className={`w-4.5 h-4.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-violet-500/30 border-violet-500/50'
                        : 'border-primary/20'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-violet-300" />}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3.5 py-3 text-sm text-muted-foreground/60 italic text-center">
                {dropdownSearch ? 'No matching connectors' : 'No connectors available'}
              </div>
            )}
          </div>

          {/* Clear all */}
          {connectorFilter.length > 0 && (
            <div className="border-t border-primary/10 px-1 py-1">
              <button
                onClick={() => {
                  setConnectorFilter([]);
                  setIsOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-sm text-muted-foreground/90 hover:text-foreground/95 hover:bg-primary/5 rounded-lg transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SortDropdown({
  sortBy,
  sortDir,
  onSortChange,
}: {
  sortBy: string;
  sortDir: string;
  onSortChange: (sortBy: string, sortDir: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const defaultOption = { value: 'created_at', label: 'Newest First', dir: 'desc' };
  const currentOption = SORT_OPTIONS.find(
    (o) => {
      const optSort = o.value.replace(/_(?:asc|desc)$/, '');
      return optSort === sortBy && o.dir === sortDir;
    },
  ) ?? defaultOption;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/80 transition-colors flex items-center gap-1.5"
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
        {currentOption.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-20 bg-background border border-primary/20 rounded-xl shadow-xl min-w-[190px] py-1.5 overflow-hidden">
          {SORT_OPTIONS.map((option) => {
            const optSort = option.value.replace(/_(?:asc|desc)$/, '');
            const isSelected = optSort === sortBy && option.dir === sortDir;
            return (
              <button
                key={option.value}
                onClick={() => {
                  onSortChange(optSort, option.dir);
                  setIsOpen(false);
                }}
                className={`w-full px-3.5 py-2.5 text-left text-sm transition-colors ${
                  isSelected
                    ? 'text-violet-300 bg-violet-500/10'
                    : 'text-foreground/80 hover:bg-primary/5'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TemplateSearchBar({
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  connectorFilter,
  onConnectorFilterChange,
  availableConnectors,
  total,
  page,
  perPage,
  onNewTemplate,
  onCleanupDuplicates,
  isCleaningUp,
}: TemplateSearchBarProps) {
  const start = page * perPage + 1;
  const end = Math.min((page + 1) * perPage, total);

  return (
    <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2.5 flex-shrink-0">
      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search templates..."
          className="w-full pl-9 pr-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-lg text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/30 transition-colors"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground/70"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Connector filter chips */}
      {connectorFilter.length > 0 && (
        <div className="flex items-center gap-1.5">
          {connectorFilter.map((name) => {
            const meta = getConnectorMeta(name);
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300"
              >
                <ConnectorIcon meta={meta} size="w-3 h-3" />
                {meta.label}
                <button
                  onClick={() => onConnectorFilterChange(connectorFilter.filter((c) => c !== name))}
                  className="ml-0.5 hover:text-white transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex-1" />

      {/* Count */}
      {total > 0 && (
        <span className="text-xs text-muted-foreground/50 tabular-nums">
          {start}-{end} of {total}
        </span>
      )}

      {/* Cleanup duplicates */}
      {onCleanupDuplicates && (
        <button
          onClick={onCleanupDuplicates}
          disabled={isCleaningUp}
          className="px-3 py-2 text-sm rounded-lg border border-amber-500/20 hover:bg-amber-500/10 text-amber-400/80 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          title="Remove duplicate templates, keeping only the newest version of each"
        >
          <Trash2 className={`w-3.5 h-3.5 ${isCleaningUp ? 'animate-spin' : ''}`} />
          Deduplicate
        </button>
      )}

      {/* Connector filter — always show button */}
      <ConnectorFilterDropdown
        availableConnectors={availableConnectors}
        connectorFilter={connectorFilter}
        setConnectorFilter={onConnectorFilterChange}
      />

      {/* Sort */}
      <SortDropdown
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(by, dir) => {
          onSortByChange(by);
          onSortDirChange(dir);
        }}
      />

      {/* New Template */}
      <button
        onClick={onNewTemplate}
        className="px-3 py-2 text-sm rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" />
        New
      </button>
    </div>
  );
}
