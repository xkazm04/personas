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
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useVaultStore } from '@/stores/vaultStore';
import { connectorCategoryTags } from '@/lib/credentials/builtinConnectors';
import type { DiscoveredItem } from '@/api/discovery/discovery';
import { CredentialPickerCards } from './CredentialPickerCards';
import { QuickAddCredentialModal } from '@/features/templates/sub_generated/adoption/QuickAddCredentialModal';
import { DebtText } from '@/i18n/DebtText';


/** Sentinel value emitted when the user picks the "Use a different credential"
 *  card — the questionnaire host opens QuickAddCredentialModal in response. */
const ADD_FROM_VAULT_SENTINEL = '__add_from_vault__';

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
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // A credential is eligible when its connector's category tag set includes
  // the requested category. Match against both the singular `category` field
  // and the multi-tag `categories[]` array via `connectorCategoryTags`.
  //
  // One card per credential: when the user has 2 Gmail accounts, both render
  // as separate cards labeled with the credential name (e.g. "Work Gmail" /
  // "Personal Gmail") and the connector type as sublabel. The emitted
  // `value` remains the connector's service_type for backend compatibility —
  // resolving which specific credential to use at runtime is a separate
  // backend concern. Cards sort A→Z by credential name.
  //
  // A trailing "Use a different credential" sentinel card lets the user
  // pivot to the QuickAdd modal even when the picker already has matches —
  // common when their build strategy doesn't fit the auto-detected category.
  const items: DiscoveredItem[] = useMemo(() => {
    const eligible = credentials
      .filter((c) => connectorCategoryTags(c.service_type).includes(category))
      .sort((a, b) => (a.name || a.service_type).localeCompare(b.name || b.service_type));
    const out: DiscoveredItem[] = eligible.map((c) => ({
      value: c.service_type,
      label: c.name || c.service_type,
      sublabel: c.service_type,
    }));
    out.push({
      value: ADD_FROM_VAULT_SENTINEL,
      label: 'Add a different credential',
      sublabel: 'Pick from catalog',
    });
    return out;
  }, [credentials, category]);

  if (items.length === 0) {
    return (
      <>
        <div
          className="flex flex-col items-start gap-2 rounded-card border border-dashed border-border bg-foreground/[0.02] p-4"
          data-testid="vault-connector-picker-empty"
        >
          <span className="typo-body text-foreground">
            {/* intentionally un-i18n'd pending translation key approval; see handoff */}
            No <strong>{category}</strong> <DebtText k="auto_connector_in_your_vault_yet_852a324e" />
          </span>
          <span className="typo-caption text-foreground">
            <DebtText k="auto_add_one_inline_or_open_the_full_catalog_fc0bb46a" />
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQuickAdd(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-primary/15 hover:bg-primary/25 border border-primary/30 typo-body text-primary cursor-pointer transition-colors"
              data-testid="vault-connector-picker-empty-add"
            >
              <Plus className="w-3.5 h-3.5" />
              Add {category} connector
            </button>
            {onAddFromCatalog && (
              <button
                type="button"
                onClick={() => onAddFromCatalog(category)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-secondary/30 hover:bg-secondary/40 border border-border/40 typo-caption text-foreground cursor-pointer transition-colors"
                data-testid="vault-connector-picker-add"
              >
                <DebtText k="auto_open_catalog_1e8f5a54" />
              </button>
            )}
          </div>
        </div>
        {showQuickAdd && (
          <QuickAddCredentialModal
            category={category}
            onCredentialAdded={(serviceType) => {
              setShowQuickAdd(false);
              // Auto-fill the picker's value so the user doesn't have to click
              // the freshly-added card. The vault store's reactive update
              // re-renders the populated state on the next tick.
              onChange(serviceType);
            }}
            onClose={() => setShowQuickAdd(false)}
          />
        )}
      </>
    );
  }

  return (
    <div data-testid={`vault-connector-picker-${category}`}>
      <CredentialPickerCards
        items={items}
        value={value}
        onChange={(picked) => {
          if (picked === ADD_FROM_VAULT_SENTINEL) {
            setShowQuickAdd(true);
            return;
          }
          onChange(picked);
        }}
      />
      {showQuickAdd && (
        <QuickAddCredentialModal
          category={category}
          onCredentialAdded={(serviceType) => {
            setShowQuickAdd(false);
            onChange(serviceType);
          }}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </div>
  );
}
