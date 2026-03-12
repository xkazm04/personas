/**
 * Typed schemas for PersonaTeam.team_config and canvas_data fields.
 *
 * These fields are stored as serialized JSON (string | null) in the database
 * and Rust bindings. These types enforce structure at the TypeScript boundary
 * so consumers don't need to parse-and-hope.
 */

// -- Team Config (stored in PersonaTeam.team_config) ------------------

/** A node in a pipeline template blueprint. */
export interface TeamConfigNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
}

/** An edge in a pipeline template blueprint. */
export interface TeamConfigEdge {
  source: string;
  target: string;
  type: 'sequential' | 'conditional' | 'parallel' | 'feedback';
}

/** Blueprint stored when adopting a pipeline template. */
export interface TeamConfig {
  template_id: string;
  nodes: TeamConfigNode[];
  edges: TeamConfigEdge[];
}

// -- Canvas Data (stored in PersonaTeam.canvas_data) ------------------

/** Persisted canvas viewport and node positions. */
export interface CanvasLayout {
  viewport?: { x: number; y: number; zoom: number };
  nodePositions?: Record<string, { x: number; y: number }>;
}

// -- Parse / Serialize Helpers ----------------------------------------

/** Parse team_config JSON string into a typed TeamConfig, or null on failure. */
export function parseTeamConfig(raw: string | null): TeamConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'template_id' in parsed) {
      return parsed as TeamConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/** Serialize a TeamConfig to a JSON string for storage. */
export function serializeTeamConfig(config: TeamConfig): string {
  return JSON.stringify(config);
}

/** Parse canvas_data JSON string into a typed CanvasLayout, or null on failure. */
export function parseCanvasLayout(raw: string | null): CanvasLayout | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CanvasLayout;
  } catch {
    return null;
  }
}

/** Serialize a CanvasLayout to a JSON string for storage. */
export function serializeCanvasLayout(layout: CanvasLayout): string {
  return JSON.stringify(layout);
}
