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
 *   - A trailing "Add a different credential" sentinel card (always rendered,
 *     even with an empty vault) opens `QuickAddCredentialModal` so the user
 *     can add the missing credential inline.
 *
 * Shared between template adoption (QuestionnaireFormGridParts) and the
 * from-scratch build surface. Keeping it vault-store-driven means the picker
 * is reactive: adding a credential in another tab unblocks the question
 * without a reload.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useVaultStore } from '@/stores/vaultStore';
import { connectorCategoryTags } from '@/lib/credentials/builtinConnectors';
import type { DiscoveredItem } from '@/api/discovery/discovery';
import { CredentialPickerCards } from '@/features/vault/components/CredentialPickerCards';
import { QuickAddCredentialModal } from '@/features/templates/sub_generated/adoption/QuickAddCredentialModal';


/** Sentinel value emitted when the user picks the "Use a different credential"
 *  card — the questionnaire host opens QuickAddCredentialModal in response. */
const ADD_FROM_VAULT_SENTINEL = '__add_from_vault__';

export interface VaultConnectorPickerProps {
  /** Machine token — e.g. "storage", "messaging", "ai_vision", "image_generation". */
  category: string;
  /** Currently-selected service_type, or "" for none. */
  value: string;
  onChange: (serviceType: string) => void;
  /** Ambient Context Fusion (Case 1) — connector keywords implied by ambient
   *  desktop signals. Eligible credentials whose service_type matches one of
   *  these float to the top and get a "Suggested" pill. Purely a pre-rank
   *  hint: the user still picks. Omit / empty to disable. */
  suggested?: string[];
}

/** Normalise a connector keyword or service_type for fuzzy matching:
 *  lowercase, strip non-alphanumerics (so "google drive" ≈ "google_drive"). */
function normalizeConnector(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function VaultConnectorPicker({
  category,
  value,
  onChange,
  suggested,
}: VaultConnectorPickerProps) {
  const { t } = useTranslation();
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
    // Ambient pre-rank: a credential is "suggested" when its service_type
    // fuzzy-matches any ambient connector keyword (Case 1, "pre-rank still
    // ask"). Suggested credentials float above the rest; both groups stay
    // A→Z internally so ordering is stable when there's no ambient evidence.
    const suggestedNorm = (suggested ?? [])
      .map(normalizeConnector)
      .filter(Boolean);
    const isSuggested = (serviceType: string): boolean => {
      if (suggestedNorm.length === 0) return false;
      const st = normalizeConnector(serviceType);
      return suggestedNorm.some((k) => st.includes(k) || k.includes(st));
    };

    const eligible = credentials
      .filter((c) => connectorCategoryTags(c.service_type).includes(category))
      .sort((a, b) => {
        const sa = isSuggested(a.service_type) ? 0 : 1;
        const sb = isSuggested(b.service_type) ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return (a.name || a.service_type).localeCompare(b.name || b.service_type);
      });
    const out: DiscoveredItem[] = eligible.map((c) => ({
      value: c.service_type,
      label: c.name || c.service_type,
      sublabel: c.service_type,
      badge: isSuggested(c.service_type) ? t.common.suggested : null,
    }));
    out.push({
      value: ADD_FROM_VAULT_SENTINEL,
      label: 'Add a different credential',
      sublabel: 'Pick from catalog',
    });
    return out;
  }, [credentials, category, suggested, t]);

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
