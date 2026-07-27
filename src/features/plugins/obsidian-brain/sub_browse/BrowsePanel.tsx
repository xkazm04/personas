import { useState, useEffect, useCallback, useMemo } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, ExternalLink, AlertTriangle, Search, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  obsidianBrainListVaultFiles,
  obsidianBrainReadVaultNote,
  type VaultTreeNode,
} from '@/api/obsidianBrain';
import SavedConfigsSidebar from '../SavedConfigsSidebar';
import { openNoteInObsidian } from '../openInObsidian';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { parseNote } from './parseNote';

/**
 * Rows in the first viewport that play the one-shot entrance ripple when the
 * vault tree first loads (35ms stagger via RevealItem, id-guarded per vault
 * so re-filtering or expanding folders never replays it).
 */
const TREE_CASCADE_ROWS = 12;

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
        type="button"
        onClick={() => onSelect(node.path)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-card transition-colors group focus-ring ${
          isSelected ? 'bg-violet-500/10 border border-violet-500/20' : 'hover:bg-secondary/30 border border-transparent'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-violet-400' : 'text-violet-400/60'}`} />
        <span className={`typo-caption truncate ${isSelected ? 'text-violet-300' : 'text-foreground group-hover:text-foreground'}`}>
          {node.name}
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-card hover:bg-secondary/30 transition-colors focus-ring"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
        )}
        <Folder className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        <span className="typo-caption text-foreground truncate">{node.name}</span>
        {node.noteCount > 0 && (
          <span className="typo-caption text-foreground ml-auto">{node.noteCount}</span>
        )}
      </button>
      {expanded && node.children.map((child) => (
        <TreeItem key={child.path} node={child} depth={depth + 1} onSelect={onSelect} selectedPath={selectedPath} filter={filter} />
      ))}
    </div>
  );
}

export default function BrowsePanel() {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const vaultName = useSystemStore((s) => s.obsidianVaultName);
  const vaultPath = useSystemStore((s) => s.obsidianVaultPath);
  const setObsidianBrainTab = useSystemStore((s) => s.setObsidianBrainTab);

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
    // Clear the previous note immediately — this is a context switch to a
    // different resource, not a refresh of the same one, so the stale body
    // must not linger under the new title while the fetch is in flight.
    setNoteContent(null);
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
    if (!selectedPath) return;
    openNoteInObsidian(vaultName, selectedPath);
  }, [selectedPath, vaultName]);

  const selectedFileName = useMemo(
    () => selectedPath?.split(/[/\\]/).pop() ?? null,
    [selectedPath],
  );

  const parsed = useMemo(
    () => (noteContent ? parseNote(noteContent) : null),
    [noteContent],
  );

  // ── Loading choreography (docs/design/overview-loading.md, row-level) ──
  // Ghosts only enter emptiness: a cold fetch (no tree yet) or a cold note
  // fetch (content just cleared). An already-loaded tree stays on screen
  // while a reload runs (law 1) — vaultPath changing is what resets the
  // ripple below, not `loading` toggling on its own.
  const showTreeGhost = loading && !tree;
  const showNoteGhost = loadingNote && !noteContent;
  const treeRevealKey = vaultPath ?? 'root';
  const treeEnter = useRevealTracker(treeRevealKey);

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <EmptyState
          icon={AlertTriangle}
          title={t.plugins.obsidian_brain.no_vault_connected}
          subtitle={t.plugins.obsidian_brain.no_vault_hint}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
          action={{ label: t.plugins.obsidian_brain.tab_setup, onClick: () => setObsidianBrainTab('setup'), icon: Settings }}
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
            <p className="typo-label text-foreground/90">{t.plugins.obsidian_brain.vault_label}</p>
            <p className="typo-heading text-violet-300 truncate" title={vaultPath ?? undefined}>{vaultName}</p>
          </div>
        )}
        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t.plugins.obsidian_brain.filter_notes}
            className="w-full pl-8 pr-3 py-1.5 rounded-card bg-background/50 border border-primary/12 text-foreground typo-caption placeholder:text-foreground/40 focus-ring transition-all"
          />
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto">
          {showTreeGhost ? (
            /* Cold fetch, nothing on screen yet: a delayed ghost tree under
               the real search box / vault header above. Invisible for its
               first ~120ms so a fast local read never paints it — see
               VaultGhostTree below. */
            <VaultGhostTree />
          ) : tree ? (
            <div className="space-y-0.5">
              {tree.children.map((child, index) => (
                <RevealItem
                  key={child.path}
                  revealId={child.path}
                  order={index}
                  hasEntered={(id) => index >= TREE_CASCADE_ROWS || treeEnter.hasEntered(id)}
                  markEntered={treeEnter.markEntered}
                >
                  <TreeItem node={child} depth={0} onSelect={selectNote} selectedPath={selectedPath} filter={filter} />
                </RevealItem>
              ))}
              {tree.children.length === 0 && (
                <p className="typo-caption text-foreground p-4">{t.plugins.obsidian_brain.vault_empty}</p>
              )}
            </div>
          ) : (
            <p className="typo-caption text-foreground p-4">{t.plugins.obsidian_brain.failed_to_load}</p>
          )}
        </div>
      </div>

      {/* Note preview */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedPath ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="typo-heading typo-card-label truncate">{selectedFileName}</p>
                <div className="flex items-center gap-2 mt-1 min-w-0">
                  {parsed && (
                    <span className="typo-caption text-foreground/90 tabular-nums flex-shrink-0">
                      {tx(t.plugins.obsidian_brain.word_count, { count: parsed.wordCount })}
                    </span>
                  )}
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="typo-caption text-foreground truncate" title={selectedPath}>{selectedPath}</span>
                    <CopyButton text={selectedPath} iconSize="w-3 h-3" />
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={openInObsidian}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors focus-ring flex-shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t.plugins.obsidian_brain.open_in_obsidian}
              </button>
            </div>
            {showNoteGhost ? (
              /* The note pane is a content region, not a spinner target: a
                 small delayed ghost (title bar + text bars) in the same
                 geometry as the real note. Delayed entrance means opening a
                 cached/fast note never flashes it — see NoteGhostBlock. */
              <NoteGhostBlock />
            ) : noteContent ? (
              <>
                {parsed && parsed.properties.length > 0 && (
                  <div className="rounded-modal bg-secondary/20 border border-primary/8 p-3">
                    <p className="typo-label text-foreground/90 mb-2">{t.plugins.obsidian_brain.note_properties}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {parsed.properties.map((prop) => (
                        <span key={prop.key} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/10 typo-caption">
                          <span className="text-violet-300/80">{prop.key}</span>
                          {prop.value && <span className="text-foreground">{prop.value}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="prose prose-invert prose-sm max-w-none rounded-modal bg-secondary/20 border border-primary/5 p-5 [&_h1]:typo-heading-lg [&_h2]:typo-heading [&_h3]:typo-heading [&_p]:text-foreground [&_li]:text-foreground [&_a]:text-violet-400 [&_code]:text-violet-300 [&_code]:bg-violet-500/10 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-secondary/40 [&_pre]:border [&_pre]:border-primary/10 [&_blockquote]:border-violet-500/30 [&_blockquote]:text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed ? parsed.body : noteContent}</ReactMarkdown>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-20">
            <EmptyState
              icon={FileText}
              title={t.plugins.obsidian_brain.select_note}
              subtitle={t.plugins.obsidian_brain.select_note_hint}
              iconColor="text-violet-400/80"
              iconContainerClassName="bg-violet-500/10 border-violet-500/20"
            />
          </div>
        )}
      </div>

      <SavedConfigsSidebar
        emptyHint={t.plugins.obsidian_brain.saved_vaults_empty_hint_other}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghosts — calm, delayed, geometry-matched placeholders for the ONLY two
// moments each region has nothing to show (docs/design/overview-loading.md).
// `animate-fade-in` (150ms, fill-mode: both) behind a ≥120ms animation-delay
// means a fast local read never paints a single bar — the delay IS the
// anti-flash. No `animate-pulse`, ever. `aria-hidden` — nothing here is
// content.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';

/** Deterministic depth/width mix so the tree ghost reads as folder/file
 * nesting rather than a flat barcode of rows. */
const TREE_GHOST_ROWS: { depth: number; width: string }[] = [
  { depth: 0, width: 'w-28' },
  { depth: 1, width: 'w-36' },
  { depth: 1, width: 'w-20' },
  { depth: 2, width: 'w-32' },
  { depth: 0, width: 'w-40' },
  { depth: 1, width: 'w-24' },
  { depth: 1, width: 'w-16' },
];

function VaultGhostTree() {
  return (
    <div className="space-y-0.5" aria-hidden="true">
      {TREE_GHOST_ROWS.map((row, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2 py-1.5 animate-fade-in"
          style={{ paddingLeft: `${row.depth * 16 + 8}px`, animationDelay: `${120 + i * 35}ms` }}
        >
          <span className={`w-3.5 h-3.5 flex-shrink-0 ${GHOST_BAR}`} />
          <span className={`h-3 ${row.width} max-w-full ${GHOST_BAR}`} />
        </div>
      ))}
    </div>
  );
}

/** Single delayed block (title bar + body bars) matching the real note
 * pane's geometry — not a per-row list, so one entrance delay is enough. */
function NoteGhostBlock() {
  return (
    <div className="space-y-3 animate-fade-in" style={{ animationDelay: '120ms' }} aria-hidden="true">
      <div className="space-y-2">
        <span className={`block h-4 w-48 ${GHOST_BAR}`} />
        <span className={`block h-3 w-32 ${GHOST_BAR}`} />
      </div>
      <div className="rounded-modal bg-secondary/20 border border-primary/5 p-5 space-y-2.5">
        <span className={`block h-3 w-full ${GHOST_BAR}`} />
        <span className={`block h-3 w-11/12 ${GHOST_BAR}`} />
        <span className={`block h-3 w-4/5 ${GHOST_BAR}`} />
        <span className={`block h-3 w-full ${GHOST_BAR}`} />
        <span className={`block h-3 w-2/3 ${GHOST_BAR}`} />
      </div>
    </div>
  );
}
