/**
 * SurfaceSpec — the typed vocabulary agents use to emit UI instead of prose.
 *
 * A persona run that wants to render an interactive decision surface declares
 * a `SurfaceSpec`: a small, frozen JSON grammar whose every node maps onto ONE
 * existing blessed-catalog component (StatCard, UnifiedTable, DecisionRow,
 * MarkdownRenderer, ConfidenceArc, CliOutputPanel). No arbitrary HTML, no new
 * visual primitives — the vocabulary IS the catalog, so agent-generated UI is
 * on-brand and injection-free by construction.
 *
 * This module is deliberately pure (no React, no store, no IPC):
 *   - zod schemas + inferred types for the spec,
 *   - `parseSurfaceSpec`   — strict validate with a salvage/repair pass that
 *     drops invalid blocks instead of rejecting the whole surface,
 *   - `extractSurfaceSpec` — find a spec inside raw execution output (whole
 *     JSON, embedded `surface` key, or an NDJSON line).
 *
 * Authoring reference for prompt writers: `./SPEC.md` (same directory).
 * Renderer: `./SurfaceRenderer.tsx`. Consent rule: actions NEVER auto-run —
 * every `SurfaceAction` goes through DispatchChooser / ConfirmDialog.
 */
import { z } from 'zod';

import { silentCatch } from '@/lib/silentCatch';

// ---------------------------------------------------------------------------
// Building blocks — forgiving on the way in, bounded on the way out.
// LLMs emit numbers where strings belong and overlong labels; we coerce and
// truncate instead of failing, and clamp numeric gauges into range.
// ---------------------------------------------------------------------------

/** Non-empty string, coerced from primitives, hard-capped at `max` chars. */
const text = (max: number) =>
  z
    .union([z.string(), z.number(), z.boolean()])
    .transform((v) => String(v))
    .refine((s) => s.trim().length > 0, 'empty text')
    .transform((s) => (s.length > max ? s.slice(0, max) : s));

/** Optional variant of `text` — absent, null and empty all mean "not given". */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) return undefined;
      const s = String(v);
      return s.trim().length > 0 ? (s.length > max ? s.slice(0, max) : s) : undefined;
    });

/** 0–100 number (coerced from numeric strings), clamped instead of rejected. */
const percent = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), 'not a finite number')
  .transform((n) => Math.max(0, Math.min(100, n)));

const toneSchema = z.enum(['neutral', 'success', 'warning', 'danger', 'info']);

// ---------------------------------------------------------------------------
// Actions — declarative; the renderer wires them into the app's consent
// surfaces (DispatchChooser for repo work, ConfirmDialog for persona runs).
// ---------------------------------------------------------------------------

export const surfaceActionSchema = z.object({
  id: text(64),
  label: text(48),
  /** Visual verdict language, mirrors `DecisionTone`. */
  tone: z.enum(['accept', 'reject', 'neutral']).default('neutral'),
  /**
   * What confirming the action does:
   *  - `dispatch`        — hand `prompt` to DispatchChooser (dev runner /
   *                        fleet / CLI) against the host view's project target.
   *  - `execute_persona` — re-invoke a persona with `prompt` as input, behind
   *                        a ConfirmDialog.
   * Both are consent-gated; nothing runs on render or on first click alone.
   */
  kind: z.enum(['dispatch', 'execute_persona']).default('dispatch'),
  /** The prepared prompt / persona input. Shown to the user before running. */
  prompt: text(20_000),
  /** Target persona for `execute_persona`; defaults to the run's persona. */
  persona_id: optionalText(64),
});

export type SurfaceAction = z.infer<typeof surfaceActionSchema>;

// ---------------------------------------------------------------------------
// Blocks — one per catalog component family.
// ---------------------------------------------------------------------------

export const statRowBlockSchema = z.object({
  type: z.literal('stat_row'),
  stats: z
    .array(
      z.object({
        label: text(40),
        value: text(32),
        tone: toneSchema.default('neutral'),
        hint: optionalText(80),
        delta: z
          .object({ label: text(24), direction: z.enum(['up', 'down', 'flat']) })
          .optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const tableBlockSchema = z.object({
  type: z.literal('table'),
  title: optionalText(80),
  columns: z
    .array(
      z.object({
        key: text(48),
        label: text(48),
        align: z.enum(['left', 'right']).default('left'),
      }),
    )
    .min(1)
    .max(8),
  rows: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .max(200),
});

export const decisionsBlockSchema = z.object({
  type: z.literal('decisions'),
  title: optionalText(80),
  items: z
    .array(
      z.object({
        id: text(64),
        title: text(120),
        summary: optionalText(240),
        category: optionalText(32),
        facts: z.array(z.object({ label: text(16), value: text(24) })).max(6).default([]),
        actions: z.array(surfaceActionSchema).max(3).default([]),
      }),
    )
    .min(1)
    .max(50),
});

export const markdownBlockSchema = z.object({
  type: z.literal('markdown'),
  content: text(60_000),
});

export const gaugeBlockSchema = z.object({
  type: z.literal('gauge'),
  label: text(48),
  /** 0–100, clamped. */
  value: percent,
  hint: optionalText(80),
});

export const progressBlockSchema = z.object({
  type: z.literal('progress'),
  label: text(48),
  /** 0–100 completion, clamped. */
  value: percent,
  hint: optionalText(80),
});

export const terminalBlockSchema = z.object({
  type: z.literal('terminal'),
  title: optionalText(80),
  lines: z.array(text(2_000)).max(500).default([]),
});

export const surfaceBlockSchema = z.discriminatedUnion('type', [
  statRowBlockSchema,
  tableBlockSchema,
  decisionsBlockSchema,
  markdownBlockSchema,
  gaugeBlockSchema,
  progressBlockSchema,
  terminalBlockSchema,
]);

export type SurfaceBlock = z.infer<typeof surfaceBlockSchema>;
export type SurfaceBlockType = SurfaceBlock['type'];

// ---------------------------------------------------------------------------
// The spec itself.
// ---------------------------------------------------------------------------

/** Version tag doubles as the detection marker inside arbitrary output JSON. */
export const SURFACE_VERSION = 'v1' as const;

export const surfaceSpecSchema = z.object({
  surface: z.literal(SURFACE_VERSION),
  title: optionalText(120),
  summary: optionalText(280),
  blocks: z.array(surfaceBlockSchema).min(1).max(12),
});

export type SurfaceSpec = z.infer<typeof surfaceSpecSchema>;

// ---------------------------------------------------------------------------
// Parse + repair
// ---------------------------------------------------------------------------

export type SurfaceParseResult =
  | {
      ok: true;
      spec: SurfaceSpec;
      /** Blocks silently removed by the repair pass (0 for a clean parse). */
      dropped: number;
    }
  | { ok: false; error: string };

/** Loose pre-check used by both repair and embedded-spec detection. */
function looksLikeSpec(input: unknown): input is { surface: unknown; blocks: unknown } {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).surface === SURFACE_VERSION &&
    Array.isArray((input as Record<string, unknown>).blocks)
  );
}

/**
 * Validate a candidate SurfaceSpec. Strict parse first; if that fails but the
 * envelope is recognizable (`surface: "v1"` + a blocks array), salvage every
 * individually-valid block and drop the rest — a hallucinated block type never
 * takes down an otherwise sound surface. Fails only when nothing renderable
 * survives, at which point callers fall back to MarkdownRenderer.
 */
export function parseSurfaceSpec(input: unknown): SurfaceParseResult {
  const strict = surfaceSpecSchema.safeParse(input);
  if (strict.success) return { ok: true, spec: strict.data, dropped: 0 };

  if (!looksLikeSpec(input)) {
    return { ok: false, error: 'not a v1 surface envelope' };
  }

  const candidate = input as { blocks: unknown[]; title?: unknown; summary?: unknown };
  const valid: SurfaceBlock[] = [];
  let dropped = 0;
  for (const block of candidate.blocks.slice(0, 12)) {
    const parsed = surfaceBlockSchema.safeParse(block);
    if (parsed.success) valid.push(parsed.data);
    else dropped += 1;
  }
  dropped += Math.max(0, candidate.blocks.length - 12);

  if (valid.length === 0) {
    return { ok: false, error: 'no valid blocks survived repair' };
  }

  const envelope = surfaceSpecSchema.safeParse({
    surface: SURFACE_VERSION,
    title: candidate.title,
    summary: candidate.summary,
    blocks: valid,
  });
  if (!envelope.success) {
    // Bad title/summary types — retry with them stripped rather than failing.
    const bare = surfaceSpecSchema.safeParse({ surface: SURFACE_VERSION, blocks: valid });
    if (!bare.success) return { ok: false, error: 'envelope unrecoverable' };
    return { ok: true, spec: bare.data, dropped };
  }
  return { ok: true, spec: envelope.data, dropped };
}

// ---------------------------------------------------------------------------
// Extraction from raw execution output
// ---------------------------------------------------------------------------

export interface ExtractedSurface {
  spec: SurfaceSpec;
  dropped: number;
}

/** Try one parsed JSON value: the value itself, or its `surface` property. */
function fromJsonValue(value: unknown): ExtractedSurface | null {
  const candidates: unknown[] = [value];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const nested = (value as Record<string, unknown>).surface;
    if (looksLikeSpec(nested)) candidates.push(nested);
  }
  for (const candidate of candidates) {
    if (!looksLikeSpec(candidate)) continue;
    const result = parseSurfaceSpec(candidate);
    if (result.ok) return { spec: result.spec, dropped: result.dropped };
  }
  return null;
}

/**
 * Find a SurfaceSpec inside raw persona output. Handles the three shapes the
 * execution pipeline produces: a single JSON document that IS the spec, a JSON
 * document embedding it under a `surface` key, or an NDJSON stream where one
 * line is/embeds the spec. Returns null when no valid surface is present —
 * callers keep their existing markdown/JSON rendering (graceful fallback).
 */
export function extractSurfaceSpec(raw: string | null | undefined): ExtractedSurface | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.includes('"surface"')) return null;

  try {
    const whole: unknown = JSON.parse(trimmed);
    const found = fromJsonValue(whole);
    if (found) return found;
  } catch (err) {
    // Not a single JSON document — fall through to the NDJSON scan.
    silentCatch('features/shared/components/surface/surfaceSpec:whole')(err);
  }

  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.includes('"surface"')) continue;
    try {
      const found = fromJsonValue(JSON.parse(candidate));
      if (found) return found;
    } catch (err) {
      silentCatch('features/shared/components/surface/surfaceSpec:line')(err);
    }
  }
  return null;
}
