/**
 * CredentialPickerCards — card-tile picker for vault-sourced credential
 * selection in the adoption questionnaire.
 *
 * Replaces the generic SelectPills row for questions whose `dynamic_source`
 * resolves from the user's vault. Each eligible credential renders as a
 * clickable tile showing the connector icon, the user-assigned credential
 * name as the primary title, and the connector's canonical label as the
 * sublabel. Selection is indicated by a ✓ badge in the corner.
 *
 * Why cards instead of pills: pills convey almost no information for a
 * choice-between-services decision. A user looking at three AI credentials
 * can't tell from "GPT-4", "Leonardo", "Claude" alone which provider they
 * picked — the icon does the heavy lifting. The catalog grid uses the
 * same pattern, so the picker visually rhymes with where the user added
 * the credential in the first place.
 *
 * Multi-select: toggling cards emits a CSV-encoded value so the existing
 * `Record<string,string>` answer map keeps working. The ALL sentinel is
 * intentionally omitted — vault pickers always authorize one concrete
 * credential slot, never "use every credential I have".
 */
import { useMemo } from 'react';
import { Check, Plus } from 'lucide-react';
import type { DiscoveredItem } from '@/api/discovery/discovery';
import { BUILTIN_CONNECTORS } from '@/lib/credentials/builtinConnectors';

/** Sentinel value emitted by VaultConnectorPicker when the user wants to add
 *  a credential outside the auto-detected category. Centralised here so
 *  CredentialPickerCards can render a distinct "+" tile for it. */
const ADD_FROM_VAULT_SENTINEL = '__add_from_vault__';

export interface CredentialPickerCardsProps {
  items: DiscoveredItem[];
  value: string;
  onChange: (v: string) => void;
  /** If true, multi-select (CSV-encoded value). */
  multi?: boolean;
}

function parseCsv(v: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function toCsv(values: string[]): string {
  return values.join(',');
}

/** Resolve icon + display label for a connector by service_type / name. */
function resolveConnectorMeta(name: string): { iconUrl: string | null; label: string } {
  const c = BUILTIN_CONNECTORS.find((x) => x.name === name);
  if (!c) return { iconUrl: null, label: name };
  return {
    iconUrl: c.icon_url ?? null,
    label: c.label ?? name,
  };
}

export function CredentialPickerCards({
  items,
  value,
  onChange,
  multi,
}: CredentialPickerCardsProps) {
  const selectedValues = useMemo(
    () => (multi ? new Set(parseCsv(value)) : new Set(value ? [value] : [])),
    [value, multi],
  );

  const toggle = (v: string) => {
    if (!multi) {
      onChange(v);
      return;
    }
    const next = new Set(selectedValues);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(toCsv([...next]));
  };

  return (
    <div
      role={multi ? 'group' : 'radiogroup'}
      // Fixed 2-column grid — connector display labels (Notion, Google
      // Calendar, Personal GitLab Account, ElevenLabs Voice Library, …)
      // need horizontal room. Earlier 3-/4-col responsive widening
      // truncated names mid-word at the typical answer-card width.
      className="grid grid-cols-2 gap-2"
    >
      {items.map((item) => {
        // Sentinel card — "Add a different credential" CTA. Rendered with a
        // dashed border + plus icon so it visually reads as an action, not
        // a credential pick. Click bubbles back through onChange so the
        // parent can open its add-credential modal.
        if (item.value === ADD_FROM_VAULT_SENTINEL) {
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => toggle(item.value)}
              className="group relative flex flex-col items-center gap-2 p-3 rounded-card border border-dashed border-border/60 bg-foreground/[0.01] hover:bg-primary/5 hover:border-primary/40 text-center transition-all"
            >
              <span className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-card border border-dashed border-border/60 group-hover:border-primary/40 transition-colors">
                <Plus className="w-6 h-6 text-foreground group-hover:text-primary transition-colors" />
              </span>
              <span className="block w-full truncate typo-body font-medium text-foreground/85">
                {item.label}
              </span>
              {item.sublabel && (
                <span className="block w-full truncate typo-caption text-foreground">
                  {item.sublabel}
                </span>
              )}
            </button>
          );
        }

        // `value` is the connector's service_type; the icon + canonical
        // display label come from the builtin catalog keyed on that name.
        const meta = resolveConnectorMeta(item.value);
        const isSelected = selectedValues.has(item.value);
        const sublabel = meta.label !== item.label ? meta.label : item.sublabel;
        return (
          <button
            key={item.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isSelected}
            onClick={() => toggle(item.value)}
            // Vertical card: icon on top, label below. Tiles read more
            // like a logo grid than a settings list — the icon does the
            // recognition work and the label confirms.
            className={`group relative flex flex-col items-center gap-2 p-3 rounded-card border text-center transition-all ${
              isSelected
                ? 'bg-primary/10 border-primary/40 shadow-elevation-1 shadow-primary/10'
                : 'bg-foreground/[0.02] border-border hover:bg-foreground/[0.05] hover:border-foreground/15'
            }`}
          >
            {/* Solid neutral plate — many connector SVGs are dark-fill
                (e.g. ElevenLabs is brand-black). On a dark theme they'd
                vanish against `bg-foreground/[0.03]`; the white-95 plate
                keeps every icon legible regardless of its native colour
                or the active theme. */}
            <span
              className={`flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-card border ${
                isSelected ? 'border-primary/40' : 'border-border'
              }`}
              style={{ background: 'rgba(255,255,255,0.95)' }}
            >
              {meta.iconUrl ? (
                <img
                  src={meta.iconUrl}
                  alt=""
                  className="w-9 h-9 object-contain"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                // Built-in / custom connectors without a vendor logo
                // (personas_database, web_search, etc.) fall back to the
                // Persona app mark instead of initials. Initials read as
                // "missing icon" — the Persona logo signals "this is one
                // of ours" and stays on-brand.
                <img
                  src="/illustrations/logo-v1-geometric-nobg.png"
                  alt=""
                  className="w-9 h-9 object-contain"
                  loading="lazy"
                  draggable={false}
                />
              )}
            </span>
            <span
              className={`block w-full truncate typo-body font-medium ${
                isSelected ? 'text-foreground' : 'text-foreground/90'
              }`}
              title={item.label}
            >
              {item.label}
            </span>
            {sublabel && sublabel !== item.label && (
              <span
                className="block w-full truncate typo-caption text-foreground"
                title={sublabel}
              >
                {sublabel}
              </span>
            )}
            {isSelected && (
              <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">
                <Check className="w-3 h-3" strokeWidth={3} />
              </span>
            )}
            {item.badge && (
              <span
                className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 typo-caption font-medium text-primary"
                title={item.badge}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
