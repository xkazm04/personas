import { useEffect, useMemo, useState } from 'react';
import { Share2, Plus, Package, Eye, GitFork, Trash2 } from 'lucide-react';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import type { ExposedResource, CreateExposedResourceInput, AccessLevel, ResourceType } from '@/api/network/exposure';
import { IdentitySettings } from './IdentitySettings';
import { InlineConfirm } from './InlineConfirm';
import { NetworkDashboard } from './NetworkDashboard';
import { PeerList } from './PeerList';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger("exposure-manager");

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
  const AccessIcon = ACCESS_ICONS[resource.access_level] ?? Eye;
  const colorClass = ACCESS_COLORS[resource.access_level] ?? ACCESS_COLORS.read;

  const parsedFields: string[] = useMemo(() => parseJsonOrDefault(resource.fields_exposed, []), [resource.fields_exposed]);
  const parsedTags: string[] = useMemo(() => parseJsonOrDefault(resource.tags, []), [resource.tags]);

  return (
    <div className="rounded-modal border border-border bg-secondary/20 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {resource.display_name || resource.resource_id}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/40 text-foreground">
            {resource.resource_type}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 ${colorClass}`}>
            <AccessIcon className="w-3 h-3" />
            {resource.access_level}
          </span>
          {parsedFields.length > 0 && (
            <span className="text-[10px] text-foreground">
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
      <InlineConfirm
        message={`Remove exposure for ${resource.display_name || resource.resource_id}?`}
        onConfirm={() => onDelete(resource.id)}
      >
        {({ requestConfirm }) => (
          <button
            onClick={requestConfirm}
            title="Remove exposure"
            className="p-1.5 rounded-card hover:bg-secondary/50 text-foreground hover:text-red-500 transition-colors flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </InlineConfirm>
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
  const personas = useAgentStore((s) => s.personas);
  const { t } = useTranslation();
  const st = t.sharing;
  const [resourceType, setResourceType] = useState<ResourceType>('persona');
  const [resourceId, setResourceId] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('read');
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
    <div className="rounded-modal border border-border bg-secondary/20 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-foreground mb-1 block">{st.resource_type_label}</label>
          <select
            value={resourceType}
            onChange={(e) => { setResourceType(e.target.value as ResourceType); setResourceId(''); }}
            className="w-full px-2 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
          >
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-foreground mb-1 block">{st.access_level_label}</label>
          <select
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
            className="w-full px-2 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
          >
            {ACCESS_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-foreground mb-1 block">{st.resource_label}</label>
        {resourceType === 'persona' ? (
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
          >
            <option value="">{st.select_persona_placeholder}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : (
          <input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder={st.resource_id_placeholder}
            className="w-full px-2 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
          />
        )}
      </div>

      <div>
        <label className="text-xs text-foreground mb-1 block">{st.tags_label}</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder={st.tags_placeholder}
          className="w-full px-2 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!resourceId}
          className="px-3 py-1.5 text-xs rounded-card bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {st.expose_resource}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded-card border border-border hover:bg-secondary/50"
        >
          {st.cancel}
        </button>
      </div>
    </div>
  );
}

export default function ExposureManager() {
  const exposedResources = useSystemStore((s) => s.exposedResources);
  const fetchExposedResources = useSystemStore((s) => s.fetchExposedResources);
  const createExposedResource = useSystemStore((s) => s.createExposedResource);
  const deleteExposedResource = useSystemStore((s) => s.deleteExposedResource);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const addToast = useToastStore((s) => s.addToast);

  const { t } = useTranslation();
  const st = t.sharing;
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to expose resource', { resource_type: input.resource_type, resource_id: input.resource_id, error: msg });
      addToast(`Failed to expose resource: ${msg}`, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExposedResource(id);
      addToast('Resource exposure removed', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to remove exposure', { id, error: msg });
      addToast(`Failed to remove exposure: ${msg}`, 'error');
    }
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Share2 className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={st.network_sharing_title}
        subtitle={st.network_sharing_subtitle}
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
                {st.exposed_resources}
              </h3>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="px-2.5 py-1 text-xs rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                {st.expose_resource}
              </button>
            </div>

            <div
              className={`grid transition-all duration-200 ease-in-out ${
                showAddForm ? 'grid-rows-[1fr] opacity-100 mb-3' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <AddExposureForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-foreground py-4 justify-center">
                <LoadingSpinner />
                {st.loading_exposed}
              </div>
            ) : exposedResources.length === 0 ? (
              <div className="rounded-modal border border-dashed border-border p-6 text-center text-sm text-foreground">
                {st.no_resources_hint}
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
