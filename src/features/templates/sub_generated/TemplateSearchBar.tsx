import { useState, useEffect, useRef, useMemo, useCallback, type FC } from 'react';
import {
  Search,
  Plus,
  Filter,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowUpDown,
  Trash2,
  LayoutGrid,
  MessageSquare,
  FileText,
  Database,
  Code2,
  Container,
  BookOpen,
  Mail,
  DollarSign,
  Users,
  Scale,
  Wrench,
  Megaphone,
  Activity,
  GitBranch,
  Zap,
  Kanban,
  BadgeCheck,
  FlaskConical,
  TrendingUp,
  Shield,
  LifeBuoy,
  TestTube2,
  type LucideIcon,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import type { ConnectorWithCount, CategoryWithCount } from '@/api/reviews';

// ── Category icon/color mapping ──────────────────────────────────

const CATEGORY_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  communication:        { icon: MessageSquare, color: '#6366f1', label: 'Communication' },
  content:              { icon: FileText,      color: '#f59e0b', label: 'Content' },
  data:                 { icon: Database,      color: '#06b6d4', label: 'Data' },
  development:          { icon: Code2,         color: '#8b5cf6', label: 'Development' },
  devops:               { icon: Container,     color: '#3b82f6', label: 'DevOps' },
  documentation:        { icon: BookOpen,      color: '#a78bfa', label: 'Documentation' },
  email:                { icon: Mail,          color: '#ef4444', label: 'Email' },
  finance:              { icon: DollarSign,    color: '#10b981', label: 'Finance' },
  hr:                   { icon: Users,         color: '#f97316', label: 'HR' },
  legal:                { icon: Scale,         color: '#64748b', label: 'Legal' },
  maintenance:          { icon: Wrench,        color: '#78716c', label: 'Maintenance' },
  marketing:            { icon: Megaphone,     color: '#ec4899', label: 'Marketing' },
  monitoring:           { icon: Activity,      color: '#14b8a6', label: 'Monitoring' },
  pipeline:             { icon: GitBranch,     color: '#2563eb', label: 'Pipeline' },
  productivity:         { icon: Zap,           color: '#eab308', label: 'Productivity' },
  'project-management': { icon: Kanban,        color: '#0ea5e9', label: 'Project Mgmt' },
  quality:              { icon: BadgeCheck,     color: '#22c55e', label: 'Quality' },
  research:             { icon: FlaskConical,  color: '#a855f7', label: 'Research' },
  sales:                { icon: TrendingUp,    color: '#f43f5e', label: 'Sales' },
  security:             { icon: Shield,        color: '#ef4444', label: 'Security' },
  support:              { icon: LifeBuoy,      color: '#0891b2', label: 'Support' },
  testing:              { icon: TestTube2,     color: '#84cc16', label: 'Testing' },
  Other:                { icon: LayoutGrid,    color: '#71717a', label: 'Other' },
};

function getCategoryMeta(name: string) {
  return CATEGORY_META[name] ?? { icon: LayoutGrid, color: '#71717a', label: name };
}

// ── Props ────────────────────────────────────────────────────────

interface TemplateSearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  sortDir: string;
  onSortDirChange: (value: string) => void;
  connectorFilter: string[];
  onConnectorFilterChange: (connectors: string[]) => void;
  categoryFilter: string[];
  onCategoryFilterChange: (categories: string[]) => void;
  availableConnectors: ConnectorWithCount[];
  availableCategories: CategoryWithCount[];
  total: number;
  page: number;
  perPage: number;
  onNewTemplate: () => void;
  onCleanupDuplicates?: () => void;
  isCleaningUp?: boolean;
  coverageFilter?: string;
  onCoverageFilterChange?: (value: string) => void;
}

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Newest First', dir: 'desc' },
  { value: 'created_at_asc', label: 'Oldest First', dir: 'asc' },
  { value: 'name', label: 'Name A-Z', dir: 'asc' },
  { value: 'name_desc', label: 'Name Z-A', dir: 'desc' },
  { value: 'quality', label: 'Highest Quality', dir: 'desc' },
  { value: 'trending', label: 'Most Adopted', dir: 'desc' },
];

// ── Category Picker Modal ────────────────────────────────────────

const CategoryPickerModal: FC<{
  categories: CategoryWithCount[];
  selectedCategory: string | null;
  onSelect: (name: string | null) => void;
  onClose: () => void;
}> = ({ categories, selectedCategory, onSelect, onClose }) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const totalCount = useMemo(
    () => categories.reduce((s, c) => s + c.count, 0),
    [categories],
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-[780px] mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
          <div>
            <h2 className="text-base font-semibold text-foreground/90">Filter by Category</h2>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Select a category to filter templates</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Grid */}
        <div className="p-5">
          <div className="grid grid-cols-5 gap-3">
            {/* "All" card */}
            <button
              onClick={() => { onSelect(null); onClose(); }}
              className={`group relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all ${
                selectedCategory === null
                  ? 'bg-violet-500/15 border-violet-500/40 ring-1 ring-violet-500/20'
                  : 'border-primary/10 hover:border-primary/25 hover:bg-secondary/40'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  selectedCategory === null
                    ? 'bg-violet-500/20'
                    : 'bg-secondary/60 group-hover:bg-secondary/80'
                }`}
              >
                <LayoutGrid className={`w-5 h-5 ${
                  selectedCategory === null ? 'text-violet-400' : 'text-muted-foreground/70'
                }`} />
              </div>
              <div className="text-center">
                <div className={`text-xs font-medium leading-tight ${
                  selectedCategory === null ? 'text-violet-300' : 'text-foreground/80'
                }`}>
                  All
                </div>
                <div className="text-[10px] text-muted-foreground/50 mt-0.5 tabular-nums">{totalCount}</div>
              </div>
              {selectedCategory === null && (
                <div className="absolute top-2 right-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
                </div>
              )}
            </button>

            {categories.map((cat) => {
              const meta = getCategoryMeta(cat.name);
              const Icon = meta.icon;
              const isSelected = selectedCategory === cat.name;
              return (
                <button
                  key={cat.name}
                  onClick={() => { onSelect(isSelected ? null : cat.name); onClose(); }}
                  className={`group relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-violet-500/15 border-violet-500/40 ring-1 ring-violet-500/20'
                      : 'border-primary/10 hover:border-primary/25 hover:bg-secondary/40'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                      isSelected ? '' : 'bg-secondary/60 group-hover:bg-secondary/80'
                    }`}
                    style={isSelected ? { backgroundColor: `${meta.color}25` } : undefined}
                  >
                    <Icon
                      className={`w-5 h-5 transition-colors ${
                        isSelected ? '' : 'text-muted-foreground/70 group-hover:text-foreground/70'
                      }`}
                      style={isSelected ? { color: meta.color } : undefined}
                    />
                  </div>
                  <div className="text-center">
                    <div className={`text-xs font-medium leading-tight ${
                      isSelected ? 'text-violet-300' : 'text-foreground/80'
                    }`}>
                      {meta.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground/50 mt-0.5 tabular-nums">{cat.count}</div>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Connector Filter Dropdown ────────────────────────────────────

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

// ── Sort Dropdown ────────────────────────────────────────────────

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

// ── Main Component ───────────────────────────────────────────────

export function TemplateSearchBar({
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  connectorFilter,
  onConnectorFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  availableConnectors,
  availableCategories,
  total,
  page,
  perPage,
  onNewTemplate,
  onCleanupDuplicates,
  isCleaningUp,
  coverageFilter,
  onCoverageFilterChange,
}: TemplateSearchBarProps) {
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  const start = page * perPage + 1;
  const end = Math.min((page + 1) * perPage, total);

  const selectedCategory: string | null = categoryFilter[0] ?? null;

  const handleCategorySelect = useCallback((name: string | null) => {
    onCategoryFilterChange(name ? [name] : []);
  }, [onCategoryFilterChange]);

  const activeCategoryMeta = selectedCategory ? getCategoryMeta(selectedCategory) : null;
  const ActiveCategoryIcon = activeCategoryMeta?.icon ?? null;

  return (
    <div className="border-b border-primary/10 flex-shrink-0">
      {/* Row 1 — Centered Search */}
      <div className="px-4 py-3 flex items-center justify-center">
        <div className="relative w-full max-w-2xl">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-10 pr-10 py-2.5 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/30 focus:ring-1 focus:ring-violet-500/20 transition-all"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground/70"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2 — Category button + active filter chips + controls */}
      <div className="px-4 pb-3 flex items-center gap-2">
        {/* Category filter button */}
        {availableCategories.length > 0 && (
          <button
            onClick={() => setShowCategoryModal(true)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-1.5 flex-shrink-0 ${
              selectedCategory
                ? 'bg-violet-500/10 border-violet-500/25 text-violet-300'
                : 'border-primary/15 hover:bg-secondary/50 text-muted-foreground/80'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Categories
          </button>
        )}

        {/* Active category chip */}
        {selectedCategory && activeCategoryMeta && ActiveCategoryIcon && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 flex-shrink-0">
            <ActiveCategoryIcon className="w-3 h-3" style={{ color: activeCategoryMeta.color }} />
            {activeCategoryMeta.label}
            <button
              onClick={() => onCategoryFilterChange([])}
              className="ml-0.5 hover:text-white transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )}

        {/* Active connector filter chips */}
        {connectorFilter.length > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {(selectedCategory || connectorFilter.length > 0) && <div className="w-px h-5 bg-primary/10 mx-0.5" />}
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

        {/* Coverage filter segmented control */}
        {onCoverageFilterChange && (
          <>
            {(selectedCategory || connectorFilter.length > 0) && <div className="w-px h-5 bg-primary/10 mx-0.5" />}
            <div className="inline-flex items-center rounded-lg border border-primary/15 overflow-hidden flex-shrink-0">
              {([
                { value: 'all', label: 'All', color: 'violet' },
                { value: 'full', label: 'Ready', color: 'emerald', icon: CheckCircle2 },
                { value: 'partial', label: 'Partial', color: 'amber', icon: AlertCircle },
              ] as const).map((opt) => {
                const isActive = (coverageFilter ?? 'all') === opt.value;
                const Icon = 'icon' in opt ? opt.icon : null;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onCoverageFilterChange(opt.value)}
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${
                      isActive
                        ? opt.color === 'violet'
                          ? 'bg-violet-500/20 text-violet-300'
                          : opt.color === 'emerald'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-amber-500/20 text-amber-300'
                        : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
                    }`}
                  >
                    {Icon && <Icon className="w-3 h-3" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Count */}
        {total > 0 && (
          <span className="text-xs text-muted-foreground/50 tabular-nums flex-shrink-0">
            {start}-{end} of {total}
          </span>
        )}

        {/* Cleanup duplicates */}
        {onCleanupDuplicates && (
          <button
            onClick={onCleanupDuplicates}
            disabled={isCleaningUp}
            className="px-3 py-2 text-sm rounded-lg border border-amber-500/20 hover:bg-amber-500/10 text-amber-400/80 transition-colors flex items-center gap-1.5 disabled:opacity-50 flex-shrink-0"
            title="Remove duplicate templates, keeping only the newest version of each"
          >
            <Trash2 className={`w-3.5 h-3.5 ${isCleaningUp ? 'animate-spin' : ''}`} />
            Deduplicate
          </button>
        )}

        {/* Connector filter */}
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
          className="px-3 py-2 text-sm rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-1.5 flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      {/* Category Picker Modal */}
      {showCategoryModal && (
        <CategoryPickerModal
          categories={availableCategories}
          selectedCategory={selectedCategory}
          onSelect={handleCategorySelect}
          onClose={() => setShowCategoryModal(false)}
        />
      )}
    </div>
  );
}
