/**
 * Morning Director — the widget-action enum + its parser. Pure and
 * framework-free (no store/IPC imports) so it unit-tests in isolation;
 * the executor lives in `./actions`.
 *
 * Backend mirror of the enum: `src-tauri/src/companion/brain/briefing.rs`
 * (`ACTION_KINDS` + `action_allowed_on`).
 */

/** Enum-validated one-click briefing action. */
export type CockpitWidgetAction =
  | { kind: 'rerun_persona'; personaId: string; label?: string }
  | { kind: 'pause_persona'; personaId: string; label?: string }
  | { kind: 'approve_approval'; approvalId: string; label?: string }
  | { kind: 'decline_approval'; approvalId: string; label?: string };

export type CockpitWidgetActionKind = CockpitWidgetAction['kind'];

const ACTION_KINDS: readonly CockpitWidgetActionKind[] = [
  'rerun_persona',
  'pause_persona',
  'approve_approval',
  'decline_approval',
];

/** Mirrors the Rust cap — max actions rendered per widget. */
export const MAX_WIDGET_ACTIONS = 3;

/** Actions that spend money or change persona behavior get a confirm step. */
export function actionNeedsConfirm(kind: CockpitWidgetActionKind): boolean {
  return kind === 'rerun_persona' || kind === 'pause_persona';
}

/**
 * Which action kinds a widget kind may carry. Mirrors `action_allowed_on` in
 * `src-tauri/src/companion/brain/briefing.rs`. Only the briefing sanitizer
 * applies that rule on the Rust side; the persistent `compose_cockpit` path
 * stores a model-written board as sent, so the render side applies it again
 * (DW-95): an approve button can only ride on a verdict widget.
 */
export function actionAllowedOn(widgetKind: string, actionKind: CockpitWidgetActionKind): boolean {
  switch (actionKind) {
    case 'rerun_persona':
      return widgetKind === 'issue_list';
    case 'pause_persona':
      return widgetKind === 'issue_list' || widgetKind === 'persona_overview';
    case 'approve_approval':
    case 'decline_approval':
      return widgetKind === 'verdict';
  }
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Re-validate a raw `actions` array from a widget spec. Unknown kinds,
 * missing targets, and non-object entries are dropped — rendering never
 * throws on a malformed spec. Capped at {@link MAX_WIDGET_ACTIONS}.
 * With `widgetKind`, an action that kind may not carry ({@link actionAllowedOn})
 * is dropped too, before it counts toward the cap.
 */
export function parseWidgetActions(raw: unknown, widgetKind?: string): CockpitWidgetAction[] {
  if (!Array.isArray(raw)) return [];
  const out: CockpitWidgetAction[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_WIDGET_ACTIONS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const a = entry as Record<string, unknown>;
    if (
      widgetKind !== undefined &&
      typeof a.kind === 'string' &&
      ACTION_KINDS.includes(a.kind as CockpitWidgetActionKind) &&
      !actionAllowedOn(widgetKind, a.kind as CockpitWidgetActionKind)
    ) {
      continue;
    }
    const label = asNonEmptyString(a.label) ?? undefined;
    switch (a.kind) {
      case 'rerun_persona':
      case 'pause_persona': {
        const personaId = asNonEmptyString(a.personaId);
        if (personaId) out.push({ kind: a.kind, personaId, label });
        break;
      }
      case 'approve_approval':
      case 'decline_approval': {
        const approvalId = asNonEmptyString(a.approvalId);
        if (approvalId) out.push({ kind: a.kind, approvalId, label });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
