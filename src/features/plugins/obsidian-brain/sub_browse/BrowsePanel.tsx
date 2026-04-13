import { useState, useEffect, useCallback, useMemo } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, ExternalLink, AlertTriangle, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  obsidianBrainListVaultFiles,
  obsidianBrainReadVaultNote,
  type VaultTreeNode,
} from '@/api/obsidianBrain';
import SavedConfigsSidebar from '../SavedConfigsSidebar';

function matchesFilter(node: VaultTreeNode, filter: string): boolean {
  const lower = filter.toLowerCase();
  if (node.name.toLowerCase().includes(lower)) return true;
  if (node.isDir) return node.children.some((c) => matchesFilter(c, filter));
  return false;
}

function TreeItem({ node, depth, onSelect, selectedPath, filter }: {
  node: VaultTreeNode;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  filter: string;
}) {
  const [expanded, setExpanded] = useState(depth < 1 || (!!filter && matchesFilter(node, filter)));

  useEffect(() => {
    if (filter && matchesFilter(node, filter)) setExpanded(true);
  }, [filter, node]);

  if (filter && !matchesFilter(node, filter)) return null;

  if (!node.isDir) {
    const isSelected = selectedPath === node.path;
    return (
      <button
        onClick={() => onSelect(node.path)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group focus-ring ${
          isSelected ? 'bg-violet-500/10 border border-violet-500/20' : 'hover:bg-secondary/30 border border-transparent'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-violet-400' : 'text-violet-400/60'}`} />
        <span className={`typo-caption truncate ${isSelected ? 'text-violet-300' : 'text-foreground/60 group-hover:text-foreground/80'}`}>
          {node.name}
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/30 transition-colors focus-ring"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        )}
        <Folder className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        <span className="typo-caption text-foreground/70 truncate">{node.name}</span>
        {node.noteCount > 0 && (
          <span className="typo-caption text-muted-foreground/30 ml-auto">{node.noteCount}</span>
        )}
      </button>
      {expanded && node.children.map((child) => (
        <TreeItem key={child.path} node={child} depth={depth + 1} onSelect={onSelect} selectedPath={selectedPath} filter={filter} />
      ))}
    </div>
  );
}

export default function BrowsePanel() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const vaultName = useSystemStore((s) => s.obsidianVaultName);
  const vaultPath = useSystemStore((s) => s.obsidianVaultPath);

  const [tree, setTree] = useState<VaultTreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [filter, setFilter] = useState('');

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const root = await obsidianBrainListVaultFiles();
      setTree(root);
    } catch (e) {
      addToast(`Failed to load vault: ${e}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (connected) {
      setSelectedPath(null);
      setNoteContent(null);
      loadTree();
    }
  }, [connected, vaultPath, loadTree]);

  const selectNote = useCallback(async (path: string) => {
    setSelectedPath(path);
    setLoadingNote(true);
    try {
      const content = await obsidianBrainReadVaultNote(path);
      setNoteContent(content);
    } catch (e) {
      setNoteContent(`Error: ${e}`);
    } finally {
      setLoadingNote(false);
    }
  }, []);

  const openInObsidian = useCallback(() => {
    if (!selectedPath || !vaultName) return;
    const fileName = selectedPath.split(/[/\\]/).pop()?.replace('.md', '') ?? '';
    window.location.href = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(fileName)}`;
  }, [selectedPath, vaultName]);

  const selectedFileName = useMemo(
    () => selectedPath?.split(/[/\\]/).pop() ?? null,
    [selectedPath],
  );

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <EmptyState
          icon={AlertTriangle}
          title="No Vault Connected"
          subtitle="Set up an Obsidian vault in the Setup tab first."
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
        />
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[400px] py-2">
      {/* Tree view */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-primary/10 pr-2">
        {/* Selected vault header */}
        {vaultName && (
          <div className="px-2 pb-2 mb-2 border-b border-primary/10">
            <p className="typo-caption text-muted-foreground/40 uppercase tracking-wide">Vault</p>
            <p className="typo-heading text-violet-300 truncate" title={vaultPath ?? undefined}>{vaultName}</p>
          </div>
        )}
        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t.plugins.obsidian_brain.filter_notes}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-background/50 border border-primary/12 text-foreground/80 typo-caption placeholder:text-muted-foreground/30 focus-ring transition-all"
          />
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" label="Loading vault..." />
            </div>
          ) : tree ? (
            <div className="space-y-0.5">
              {tree.children.map((child) => (
                <TreeItem key={child.path} node={child} depth={0} onSelect={selectNote} selectedPath={selectedPath} filter={filter} />
              ))}
              {tree.children.length === 0 && (
                <p className="typo-caption text-muted-foreground/40 p-4">Vault is empty</p>
              )}
            </div>
          ) : (
            <p className="typo-caption text-muted-foreground/40 p-4">Failed to load</p>
          )}
        </div>
      </div>

      {/* Note preview */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedPath ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="typo-heading text-foreground/80 truncate">{selectedFileName}</p>
              <button
                onClick={openInObsidian}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors focus-ring"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Obsidian
              </button>
            </div>
            {loadingNote ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner size="md" label="Loading note..." />
              </div>
            ) : noteContent ? (
              <div className="prose prose-invert prose-sm max-w-none rounded-xl bg-secondary/20 border border-primary/5 p-5 [&_h1]:typo-heading-lg [&_h2]:typo-heading [&_h3]:typo-heading [&_p]:text-foreground/60 [&_li]:text-foreground/60 [&_a]:text-violet-400 [&_code]:text-violet-300 [&_code]:bg-violet-500/10 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-secondary/40 [&_pre]:border [&_pre]:border-primary/10 [&_blockquote]:border-violet-500/30 [&_blockquote]:text-muted-foreground/50">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{noteContent}</ReactMarkdown>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-20">
            <EmptyState
              icon={FileText}
              title="Select a Note"
              subtitle="Choose a note from the tree on the left to preview its contents."
              iconColor="text-violet-400/80"
              iconContainerClassName="bg-violet-500/10 border-violet-500/20"
            />
          </div>
        )}
      </div>

      <SavedConfigsSidebar
        emptyHint="No saved vaults yet. Set one up in the Setup tab."
      />
    </div>
  );
}
