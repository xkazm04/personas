import { useState, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';

/**
 * Search, filter, and category state for the tool selector.
 * Reads toolDefinitions from the store and derives filtered/grouped results.
 */
export function useToolSelectorSearch() {
  const toolDefinitions = usePersonaStore((s) => s.toolDefinitions);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'grouped'>('grid');

  const isSearching = searchQuery.trim().length > 0;

  const categories = useMemo(() => {
    const cats = new Set<string>();
    toolDefinitions.forEach((tool) => { if (tool.category) cats.add(tool.category); });
    return ['All', ...Array.from(cats)];
  }, [toolDefinitions]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('All', toolDefinitions.length);
    for (const tool of toolDefinitions) {
      if (tool.category) counts.set(tool.category, (counts.get(tool.category) || 0) + 1);
    }
    return counts;
  }, [toolDefinitions]);

  const filteredTools = useMemo(() => {
    let tools = toolDefinitions;
    if (!isSearching && selectedCategory !== 'All') {
      tools = tools.filter((tool) => tool.category === selectedCategory);
    }
    if (isSearching) {
      const q = searchQuery.trim().toLowerCase();
      tools = tools.filter((tool) =>
        tool.name.toLowerCase().includes(q) ||
        (tool.description && tool.description.toLowerCase().includes(q))
      );
    }
    return tools;
  }, [toolDefinitions, selectedCategory, searchQuery, isSearching]);

  const connectorGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredTools>();
    for (const tool of filteredTools) {
      const key = tool.requires_credential_type || '__general__';
      const existing = groups.get(key);
      if (existing) existing.push(tool);
      else groups.set(key, [tool]);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '__general__') return 1;
      if (b[0] === '__general__') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredTools]);

  return {
    selectedCategory, setSelectedCategory,
    searchQuery, setSearchQuery,
    viewMode, setViewMode,
    isSearching,
    filteredTools,
    connectorGroups,
    categories,
    categoryCounts,
  };
}
