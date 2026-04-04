import { useState, useEffect, useCallback } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, ExternalLink, AlertTriangle } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  obsidianBrainListVaultFiles,
  obsidianBrainReadVaultNote,
  type VaultTreeNode,
} from '@/api/obsidianBrain';

function TreeItem({ node, depth, onSelect }: { node: VaultTreeNode; depth: number; onSelect: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (!node.isDir) {
    return (
      <button
        onClick={() => onSelect(node.path)}
        className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-secondary/30 transition-colors group"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className="w-3.5 h-3.5 text-violet-400/60 flex-shrink-0" />
        <span className="typo-caption text-foreground/60 group-hover:text-foreground/80 truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-secondary/30 transition-colors"
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
        <TreeItem key={child.path} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function BrowsePanel() {
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const vaultName = useSystemStore((s) => s.obsidianVaultName);

  const [tree, setTree] = useState<VaultTreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

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
    if (connected) loadTree();
  }, [connected, loadTree]);

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
    // Extract relative path within vault for Obsidian URI
    const fileName = selectedPath.split(/[/\\]/).pop()?.replace('.md', '') ?? '';
    window.location.href = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(fileName)}`;
  }, [selectedPath, vaultName]);

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-400/50 mx-auto" />
          <p className="typo-heading text-foreground/70">No Vault Connected</p>
          <p className="typo-body text-muted-foreground/50">Set up an Obsidian vault in the Setup tab first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full min-h-0 py-2">
      {/* Tree view */}
      <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-primary/10 pr-2">
        {loading ? (
          <p className="typo-caption text-muted-foreground/40 p-4">Loading vault...</p>
        ) : tree ? (
          <div className="space-y-0.5">
            {tree.children.map((child) => (
              <TreeItem key={child.path} node={child} depth={0} onSelect={selectNote} />
            ))}
            {tree.children.length === 0 && (
              <p className="typo-caption text-muted-foreground/40 p-4">Vault is empty</p>
            )}
          </div>
        ) : (
          <p className="typo-caption text-muted-foreground/40 p-4">Failed to load</p>
        )}
      </div>

      {/* Note preview */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedPath ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="typo-heading text-foreground/80 truncate">
                {selectedPath.split(/[/\\]/).pop()}
              </p>
              <button
                onClick={openInObsidian}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Obsidian
              </button>
            </div>
            {loadingNote ? (
              <p className="typo-body text-muted-foreground/40">Loading...</p>
            ) : (
              <pre className="text-[12px] text-foreground/60 bg-secondary/20 rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed border border-primary/5">
                {noteContent}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="typo-body text-muted-foreground/40">Select a note to preview</p>
          </div>
        )}
      </div>
    </div>
  );
}
