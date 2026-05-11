/**
 * Cockpit widget registry — mirrors the dashboard registry pattern.
 *
 * Athena composes the cockpit via `compose_cockpit` ops emitting a list of
 * widgets. Each widget has a `kind` matching one of the keys here, plus a
 * `config` object the widget interprets.
 *
 * Adding a new widget kind: implement a React component + register it here +
 * update the doctrine in `src-tauri/src/companion/templates/constitution.md`
 * so Athena knows the kind is available.
 */
import type { ComponentType } from 'react';

import { ConnectedServicesWidget } from './widgets/ConnectedServicesWidget';
import { DecisionsPanelWidget } from './widgets/DecisionsPanelWidget';
import { PersonaOverviewWidget } from './widgets/PersonaOverviewWidget';

export interface CockpitWidgetProps {
  /** Free-form config block from Athena's compose_cockpit op. */
  config?: Record<string, unknown>;
  /** Optional title override; widget falls back to its own default. */
  title?: string;
}

export const cockpitWidgetRegistry: Record<string, ComponentType<CockpitWidgetProps>> = {
  persona_overview: PersonaOverviewWidget,
  connected_services: ConnectedServicesWidget,
  decisions_panel: DecisionsPanelWidget,
};
