import { useEffect, useState } from 'react';
import { Share2, Plus, Loader2, Package, Eye, GitFork, Trash2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import type { ExposedResource, CreateExposedResourceInput } from '@/api/network/exposure';
import { IdentitySettings } from './IdentitySettings';
import { NetworkDashboard } from './NetworkDashboard';
import { PeerList } from './PeerList';

const ACCESS_ICONS = {
  read: Eye,
  execute: Package,
  fork: GitFork,
} as const;

const ACCESS_COLORS = {
  read: 'text-blue-400 bg-blue-500/10',
  execute: 'text-amber-400 bg-amber-500/10',
  fork: 'text-emerald-400 bg-emerald-500/10',
} as const;

const RESOURCE_TYPES = ['persona', 'template', 'execution_result', 'knowledge', 'connector'] as const;
const ACCESS_LEVELS = ['read', 'execute', 'fork'] as const;

function ResourceExposureCard({
  resource,
  onDelete,
}: {
  resource: ExposedResource;
  onDelete: (id: string) => void;
}) {
  const AccessIcon = ACCESS_ICONS[resource.access_level as keyof typeof ACCESS_ICONS] ?? Eye;
  const colorClass = ACCESS_COLORS[resource.access_level as keyof typeof ACCESS_COLORS] ?? ACCESS_COLORS.read;

  const parsedFields: string[] = (() => {
    try { return JSON.parse(resource.fields_exposed); } catch { return []; }
  })();
  const parsedTags: string[] = (() => {
    try { return JSON.parse(resource.tags); } catch { return []; }
  })();

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {resource.display_name || resource.resource_id}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/40 text-muted-foreground">
            {resource.resource_type}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 ${colorClass}`}>
            <AccessIcon className="w-3 h-3" />
            {resource.access_level}
          </span>
          {parsedFields.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60">
              {parsedFields.length} field{parsedFields.length !== 1 ? 's' : ''} exposed
            </span>
          )}
        </div>
        {parsedTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {parsedTags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/70">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => onDelete(resource.id)}
        title="Remove exposure"
        className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function AddExposureForm({
  onAdd,
  onCancel,
}: {
  onAdd: (input: CreateExposedResourceInput) => void;
  onCancel: () => void;
}) {
  const personas = usePersonaStore((s) => s.personas);
  const [resourceType, setResourceType] = useState<string>('persona');
  const [resourceId, setResourceId] = useState('');
  const [accessLevel, setAccessLevel] = useState<string>('read');
  const [tags, setTags] = useState('');

  const selectedPersona = personas.find((p) => p.id === resourceId);

  const handleSubmit = () => {
    if (!resourceId) return;
    const displayName = resourceType === 'persona' && selectedPersona
      ? selectedPersona.name
      : resourceId;
    onAdd({
      resource_type: resourceType,
      resource_id: resourceId,
      display_name: displayName,
      fields_exposed: [],
      access_level: accessLevel,
      requires_auth: false,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    });
  };

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Resource Type</label>
          <select
            value={resourceType}
            onChange={(e) => { setResourceType(e.target.value); setResourceId(''); }}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Access Level</label>
          <select
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {ACCESS_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Resource</label>
        {resourceType === 'persona' ? (
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            <option value="">Select a persona...</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : (
          <input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder="Resource ID"
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Tags (comma-separated, optional)</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. automation, devops"
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!resourceId}
          className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Expose Resource
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ExposureManager() {
  const exposedResources = usePersonaStore((s) => s.exposedResources);
  const fetchExposedResources = usePersonaStore((s) => s.fetchExposedResources);
  const createExposedResource = usePersonaStore((s) => s.createExposedResource);
  const deleteExposedResource = usePersonaStore((s) => s.deleteExposedResource);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const addToast = useToastStore((s) => s.addToast);

  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchExposedResources(), fetchPersonas()]).finally(() => setLoading(false));
  }, []);

  const handleAdd = async (input: CreateExposedResourceInput) => {
    try {
      const res = await createExposedResource(input);
      setShowAddForm(false);
      addToast(`Resource "${res.display_name || res.resource_id}" exposed`, 'success');
    } catch {
      addToast('Failed to expose resource', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExposedResource(id);
      addToast('Resource exposure removed', 'success');
    } catch {
      addToast('Failed to remove exposure', 'error');
    }
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Share2 className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Network & Sharing"
        subtitle="Manage your identity, trusted peers, and shared resources"
      />

      <ContentBody centered>
        <div className="space-y-8">
          {/* Network status */}
          <NetworkDashboard />

          {/* Identity section */}
          <IdentitySettings />

          {/* Exposed Resources section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Package className="w-4 h-4" />
                Exposed Resources
              </h3>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Expose Resource
              </button>
            </div>

            {showAddForm && (
              <div className="mb-3">
                <AddExposureForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading exposed resources...
              </div>
            ) : exposedResources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No resources exposed yet. Expose personas or other resources to include them in bundles for sharing.
              </div>
            ) : (
              <div className="space-y-2">
                {exposedResources.map((resource) => (
                  <ResourceExposureCard
                    key={resource.id}
                    resource={resource}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Discovered Peers section */}
          <PeerList />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
