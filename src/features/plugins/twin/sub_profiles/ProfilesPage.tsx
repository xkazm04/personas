import { useEffect, useState } from 'react';
import { Sparkles, Plus, Trash2, Check, Pencil, X, FolderTree } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';

interface DraftForm {
  name: string;
  role: string;
}

const EMPTY_DRAFT: DraftForm = { name: '', role: '' };

export default function ProfilesPage() {
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const isLoading = useSystemStore((s) => s.twinProfilesLoading);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const deleteTwinProfile = useSystemStore((s) => s.deleteTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchTwinProfiles(); }, [fetchTwinProfiles]);

  // Sort by name ascending
  const sorted = [...twinProfiles].sort((a, b) => a.name.localeCompare(b.name));

  const handleCreate = async () => {
    if (!draft.name.trim()) return;
    setSubmitting(true);
    try {
      await createTwinProfile(draft.name.trim(), undefined, draft.role.trim() || undefined);
      setDraft(EMPTY_DRAFT);
      setCreating(false);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (profile: TwinProfile) => {
    setEditingId(profile.id);
    setEditDraft({ name: profile.name, role: profile.role ?? '' });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editDraft.name.trim()) return;
    setSubmitting(true);
    try {
      await updateTwinProfile(editingId, {
        name: editDraft.name.trim(),
        role: editDraft.role.trim() ? editDraft.role.trim() : null,
      });
      setEditingId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete twin "${name}"? This removes the profile only — no Obsidian files are touched.`)) return;
    await deleteTwinProfile(id);
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Sparkles className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Twin Profiles"
        subtitle="Each twin is a digital identity that personas adopt via the Twin connector."
        actions={
          <Button onClick={() => setCreating(true)} size="sm" variant="accent" accentColor="violet">
            <Plus className="w-4 h-4 mr-1.5" />
            New Twin
          </Button>
        }
      />

      <ContentBody centered>
        {/* Inline create form */}
        {creating && (
          <div className="mb-6 p-4 rounded-card border border-violet-500/20 bg-violet-500/5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="typo-heading text-foreground">New Twin</h3>
              <button onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); }} className="text-muted-foreground hover:text-foreground" aria-label="Cancel">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="text" placeholder="Name (e.g. Founder Twin)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={INPUT_FIELD} autoFocus />
              <input type="text" placeholder="Role (e.g. Indie Dev)" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className={INPUT_FIELD} />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); }} variant="ghost" size="sm">Cancel</Button>
              <Button onClick={handleCreate} disabled={!draft.name.trim() || submitting} size="sm">{submitting ? 'Creating...' : 'Create Twin'}</Button>
            </div>
          </div>
        )}

        {/* List */}
        {isLoading && sorted.length === 0 ? (
          <p className="typo-body text-foreground text-center py-12">Loading...</p>
        ) : sorted.length === 0 && !creating ? (
          <div className="py-12 text-center">
            <Sparkles className="w-10 h-10 text-violet-400/30 mx-auto mb-3" />
            <p className="typo-body text-foreground">No twins yet.</p>
            <p className="typo-caption text-muted-foreground mt-1">Create your first digital twin to give personas a voice.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map((profile) => {
              const isActive = profile.id === activeTwinId;
              const isEditing = editingId === profile.id;

              if (isEditing) {
                return (
                  <div key={profile.id} className="p-4 rounded-card border border-violet-500/30 bg-violet-500/5 space-y-3 col-span-1">
                    <input type="text" placeholder="Name" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className={INPUT_FIELD} />
                    <input type="text" placeholder="Role" value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className={INPUT_FIELD} />
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setEditingId(null)} variant="ghost" size="sm">Cancel</Button>
                      <Button onClick={handleSaveEdit} disabled={!editDraft.name.trim() || submitting} size="sm">Save</Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={profile.id}
                  className={`p-4 rounded-card border transition-colors ${
                    isActive
                      ? 'border-violet-500/30 bg-violet-500/5'
                      : 'border-primary/10 bg-card/40 hover:border-primary/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-card flex items-center justify-center flex-shrink-0 border ${
                      isActive ? 'bg-violet-500/15 border-violet-500/30' : 'bg-secondary/40 border-primary/10'
                    }`}>
                      <Sparkles className={`w-4 h-4 ${isActive ? 'text-violet-400' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="typo-heading text-foreground truncate">{profile.name}</h3>
                        {isActive && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25 flex-shrink-0">Active</span>
                        )}
                      </div>
                      {profile.role && <p className="typo-caption text-foreground mt-0.5 truncate">{profile.role}</p>}
                      <div className="flex items-center gap-1.5 mt-2 typo-caption text-muted-foreground">
                        <FolderTree className="w-3 h-3" />
                        <span className="font-mono truncate">{profile.obsidian_subpath}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-3 pt-3 border-t border-primary/5">
                    {!isActive && (
                      <button onClick={() => setActiveTwin(profile.id)} title="Set active" className="p-1.5 rounded-interactive text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => startEdit(profile)} title="Edit" className="p-1.5 rounded-interactive text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(profile.id, profile.name)} title="Delete" className="p-1.5 rounded-interactive text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
