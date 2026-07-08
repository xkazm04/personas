---
name: motionize
description: Upgrade a generic UI icon or loading/empty state into a traced, motion-animated SVG. Generates flat trace-friendly art (via /leonardo tools), validates with Qwen vision, vectorizes to a clean multi-path SVG, and emits a Motion (framer-motion) reveal component. For icon + loading-state visual upgrades — NOT raw image generation (use /leonardo for that).
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(npx *), Bash(cd *)
argument-hint: <UI surface to upgrade, e.g. "teams empty state icon">
---

# Motionize — traced, animated SVG upgrades for icons & loading states

Turn a generic lucide icon + a basic fade into a **traced, self-drawing SVG** whose
every element is under your control (draw order, per-path timing, easing). This
skill is the *upgrade* layer; **`/leonardo` stays the pure image/illustration
generator**. Motionize consumes flat art and produces animated React components.

**The core idea:** neon/glow art traces badly (soft edges → speckle). Generate a
**flat** twin (solid fills, hard edges, no glow/gradients), trace *that*, then add
glow back as an SVG/CSS filter — that separation is what puts traces "under control".

## Pipeline (four steps)

### 0. One-time setup
Install the skill's self-contained deps (kept out of the app's package.json):
```bash
cd .claude/skills/motionize && npm install && cd -
```

### 1. Generate flat, trace-friendly art (via /leonardo tools)
Use the existing generators, but with a FLAT profile — no glow, no gradients:
```bash
export $(grep -E '^(OPENAI_API_KEY|LEONARDO_API_KEY|QWEN_API_KEY)=' .env | xargs)
# transparent bg is ideal for icons (gpt-image-2 supports it natively):
node .claude/skills/leonardo/tools/openai-image.mjs generate \
  --prompt "Flat vector icon of <SUBJECT>: solid fills, crisp hard edges, thick uniform outlines, no gradients, no glow, no shadow, limited palette (<=4 colors), centered" \
  --output .claude/skills/motionize/out/<name>-flat.png --size 1024x1024 --background transparent --quality high
# (or leonardo-gpt-image.mjs / leonardo-image.mjs when only a Leonardo key is present)
```

### 2. Validate with Qwen (free, Gemini-free)
```bash
node .claude/skills/motionize/tools/qwen-recognize.mjs \
  --input .claude/skills/motionize/out/<name>-flat.png \
  --prompt "Is this a FLAT icon (solid fills, hard edges, no gradients/glow)? How many distinct colors? Name the shapes. Reply JSON {flat:bool, colors:int, shapes:[...]}."
```
DashScope OpenAI-compatible endpoint, `qwen3.7-plus` + quota-fallbacks, `$QWEN_API_KEY`
(free 1M tokens / 90 days per model). If it isn't flat/clean, re-prompt step 1.

### 3. Trace → clean multi-path SVG
```bash
node .claude/skills/motionize/tools/trace.mjs \
  --input .claude/skills/motionize/out/<name>-flat.png \
  --output .claude/skills/motionize/out/<name>.svg \
  --mode spline --color-precision 6 --filter-speckle 4
```
`@neplex/vectorizer` (VTracer) → one `<path>` per color region + SVGO cleanup.
Tune `--filter-speckle` up to kill residual noise; `--mode polygon` for a harder
geometric look; `--mono` (Binary) for a single-color line mark. Re-validate the
rendered SVG against the original with Qwen (step 2) if fidelity matters.

### 4. Motionize → React component
Hand the SVG's paths to **Motion (framer-motion, already in the app)**:
- Inline the `<path>`s as `motion.path`, `initial={{ pathLength: 0, opacity: 0 }}`,
  `animate={{ pathLength: 1, opacity: 1 }}`, staggered via `transition.delay` per
  index for a sequential self-draw. Add `strokeDasharray="0 1"` to avoid SSR flash.
- For fills (not just strokes) reveal with opacity/clip; for a frame-exact rendered
  asset, drive the same paths with Remotion `interpolate(frame, …)`.
- Keep it a self-contained component (e.g. `<name>Glyph.tsx`) that renders inline
  SVG — no runtime tracing, the SVG is baked at authoring time.

## Conventions
- Scratch art + SVGs live in `.claude/skills/motionize/out/` (git-ignored working
  area). The FINAL committed artifact is the React component (inline SVG) in the
  feature, not the PNG.
- Respect the app's motion norms: honor `useMotion()`/reduced-motion; keep reveals
  short (< 1s) and non-blocking.
- Env: `QWEN_API_KEY` (recognition) + `OPENAI_API_KEY`/`LEONARDO_API_KEY`
  (generation). Load from `.env` before running.

## First POC
`src/features/teams/sub_teamWorkspace/TeamList.tsx` → `EmptyState`: a generic
`<Users>` icon + `animate-fade-slide-in`. Replace the icon with a traced,
self-drawing teams glyph as the reference implementation.
