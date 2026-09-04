import { GLYPH_DIMENSIONS, type GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import type { PersonaSigilSummaryEntry } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import { ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { getDimLabels, specEventSubscriptions, type PersonaCapability } from '@/lib/personas/capabilities';
import type { Translations } from '@/i18n/generated/types';
import { interpolate } from '@/i18n/useTranslation';
import { reviewPolicyMode } from './charterSpec';

/**
 * Per-dimension saved values for the charter shown in the hero — the rows of
 * the left rail (`PersonaSigilSummary`). A dim with no entry renders nothing,
 * which is how "this charter does not use that dimension" reads visually.
 */
export function charterSummaryEntries(
  cap: PersonaCapability,
  t: Translations,
): Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>> {
  const charter = cap.charter;
  if (!charter) return {};
  const labels = getDimLabels(t);
  const c = t.agents.responsibilities;
  const out: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>> = {};

  out.task = { label: labels.task, value: charter.title };
  if (cap.triggerLabel) out.trigger = { label: labels.trigger, value: cap.triggerLabel };

  // Apps: brand icon ONLY when a real connector slug resolves. `cap.connector`
  // falls back to the charter's domain, which is not a connector — never text.
  if (cap.connectorKey) {
    out.connector = {
      label: labels.connector,
      value: <ConnectorIcon meta={getConnectorMeta(cap.connectorKey)} size="w-4 h-4" />,
    };
  }

  const channels = [...new Set(cap.notificationChannels)];
  if (channels.length > 0) out.message = { label: labels.message, value: channels.join(' · ') };

  const events = specEventSubscriptions(charter.spec);
  if (events.length > 0) out.event = { label: labels.event, value: events.join(' · ') };

  const gates = charter.approvalGates.length;
  const mode = reviewPolicyMode(charter.spec);
  if (gates > 0 || mode) {
    out.review = {
      label: labels.review,
      value: gates > 0 ? interpolate(c.review_gates_count, { count: gates }) : mode,
    };
  }

  if (cap.dimensions.includes('memory')) {
    out.memory = { label: labels.memory, value: t.agents.use_cases.dim_status_activated };
  }

  if (cap.dimensions.includes('error')) {
    const policy = charter.spec.errorPolicy;
    const parts: string[] = [];
    if (policy?.incident) parts.push(c.error_incident_label);
    if (policy?.lab) parts.push(c.error_lab_label);
    out.error = {
      label: labels.error,
      value: parts.length > 0 ? parts.join(' · ') : t.agents.use_cases.dim_status_activated,
    };
  }

  return out;
}

/**
 * Hero petal states for one charter: lit where the charter populates the
 * dimension, idle everywhere else. Every dimension is present in the result —
 * an absent key would let `PersonaHero` fall back to its own derivation over
 * the whole item list, which is the persona-wide reading, not this charter's.
 */
export function charterPetalStates(cap: PersonaCapability): Record<GlyphDimension, PetalState> {
  const touched = new Set(cap.dimensions);
  const out = {} as Record<GlyphDimension, PetalState>;
  for (const dim of GLYPH_DIMENSIONS) out[dim] = touched.has(dim) ? 'resolved' : 'idle';
  return out;
}
