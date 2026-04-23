/**
 * VaultConnectorPicker — vault-aware wrapper around `CredentialPickerCards`.
 *
 * Used anywhere the user must choose a *concrete* connector from their vault
 * to fill a category-shaped slot (e.g. the from-scratch build flow emits a
 * clarifying_question with `scope: "connector_category"` and the UI routes
 * the answer through this picker). Contract:
 *
 *   - `category` — a machine token (storage/messaging/ai_vision/...) that
 *     the component uses to filter the user's vault via
 *     `connectorCategoryTags` on each credential's service_type.
 *   - `value` / `onChange` — the chosen service_type. Single-select only;
 *     from-scratch builds always fill one slot per clarifying_question.
 *   - Empty state shows an "Add credential from Catalog" CTA that deep-links
 *     into the Vault catalog. The host is responsible for restoring focus
 *     after the CTA — we just surface the intent.
 *
 * Shared between template adoption (QuestionnaireFormGridParts) and the
 * from-scratch build surface. Keeping it vault-store-driven means the picker
 * is reactive: adding a credential in another tab unblocks the question
 * without a reload.
 */
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useVaultStore } from '@/stores/vaultStore';
import { connectorCategoryTags } from '@/lib/credentials/builtinConnectors';
import type { DiscoveredItem } from '@/api/templates/discovery';
import { CredentialPickerCards } from './CredentialPickerCards';

export interface VaultConnectorPickerProps {
  /** Machine token — e.g. "storage", "messaging", "ai_vision", "image_generation". */
  category: string;
  /** Currently-selected service_type, or "" for none. */
  value: string;
  onChange: (serviceType: string) => void;
  /** Called when the user hits the empty-state "Add from Catalog" CTA.
   *  Host should navigate to the Vault catalog (and ideally pre-filter to
   *  `category`). After the credential lands, `useVaultStore` updates and
   *  the picker re-renders without re-mounting. */
  onAddFromCatalog?: (category: string) => void;
}

export function VaultConnectorPicker({
  category,
  value,
  onChange,
  onAddFromCatalog,
}: VaultConnectorPickerProps) {
  const credentials = useVaultStore((s) => s.credentials);

  // A credential is eligible when its connector's category tag set includes
  // the requested category. Match against both the singular `category` field
  // and the multi-tag `categories[]` array via `connectorCategoryTags`.
  //
  // The emitted `value` is the connector's service_type (NOT the credential
  // id). Downstream consumers — the build LLM's answer parser, adoption
  // variable substitution — key off service_type and resolve the concrete
  // credential at promotion time. One card per distinct service_type; if
  // the user has several credentials for the same service, the sublabel
  // gets a count suffix.
  const items: DiscoveredItem[] = useMemo(() => {
    const byService = new Map<string, { label: string; count: number }>();
    for (const c of credentials) {
      const tags = connectorCategoryTags(c.service_type);
      if (!tags.includes(category)) continue;
      const entry = byService.get(c.service_type);
      if (entry) {
        entry.count += 1;
      } else {
        byService.set(c.service_type, { label: c.name || c.service_type, count: 1 });
      }
    }
    const out: DiscoveredItem[] = [];
    for (const [serviceType, meta] of byService.entries()) {
      out.push({
        value: serviceType,
        label: meta.label,
        sublabel: meta.count > 1 ? `${serviceType} · ${meta.count} credentials` : serviceType,
      });
    }
    return out;
  }, [credentials, category]);

  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-start gap-2 rounded-card border border-dashed border-border bg-foreground/[0.02] p-4"
        data-testid="vault-connector-picker-empty"
      >
        <span className="typo-body text-foreground/80">
          {/* intentionally un-i18n'd pending translation key approval; see handoff */}
          No <strong>{category}</strong> connector in your vault yet.
        </span>
        <span className="typo-caption text-foreground/55">
          Add one from the Catalog, then return here to pick it.
        </span>
        {onAddFromCatalog && (
          <button
            type="button"
            onClick={() => onAddFromCatalog(category)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-primary/15 hover:bg-primary/25 border border-primary/30 typo-body text-primary cursor-pointer transition-colors"
            data-testid="vault-connector-picker-add"
          >
            <Plus className="w-3.5 h-3.5" />
            Open Catalog
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid={`vault-connector-picker-${category}`}>
      <CredentialPickerCards
        items={items}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
