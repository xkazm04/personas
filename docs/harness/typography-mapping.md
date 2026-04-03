# Typography Mapping Reference

Definitive reference for converting raw Tailwind text classes to semantic `typo-*` classes.
Source of truth: `src/styles/typography.css`.

---

## 1. Mapping Table

| Raw Tailwind Pattern | Semantic Class | Properties | When to Use |
|---|---|---|---|
| `text-4xl font-bold` | `typo-hero` | 2.25rem / 700 / lh 1.15 / -0.015em tracking | Main page greetings, large display text |
| `text-xl font-bold` | `typo-heading-lg` | 1.25rem / 700 / lh 1.3 / -0.01em tracking | Page-level headings, panel titles |
| `text-sm font-bold` or `text-sm font-semibold` | `typo-heading` | 0.875rem / 700 / lh 1.4 / 0.025em tracking | Section titles, card headers, sidebar group labels |
| `text-sm` (body context) | `typo-body` | 0.875rem / 400 / lh 1.65 | Paragraphs, descriptions, help text |
| `text-base` | `typo-body-lg` | 1rem / 400 / lh 1.7 | Prominent descriptions, summaries, intro text |
| `text-xs` (secondary context) | `typo-caption` | 0.75rem / 500 / lh 1.4 | Timestamps, hints, metadata, secondary info |
| `text-xs font-bold uppercase tracking-wider` | `typo-label` | 0.75rem / 700 / lh 1 / 0.15em / uppercase | Category markers, badge text, divider labels |
| `text-sm tabular-nums` or `text-sm font-medium` (numeric) | `typo-data` | 0.875rem / 500 / lh 1.4 / tabular-nums | Numbers, stats, counts, percentages |
| `text-2xl font-bold tabular-nums` | `typo-data-lg` | 1.5rem / 700 / lh 1.2 / tabular-nums | Hero metrics, big counters, KPI values |
| `font-mono text-xs` | `typo-code` | 0.75rem mono / 400 / lh 1.5 | IDs, hashes, technical values, code snippets |

---

## 2. Ambiguous Cases

These patterns require judgment. Use the surrounding context to pick the right class.

### `text-sm font-medium`

- **If displaying a number, stat, or metric** --> `typo-data`
- **If displaying emphasized body text** --> `typo-body` (medium weight was just default styling, the semantic class at 400 weight is sufficient)
- **If it acts as a mini-heading or label** --> `typo-heading`

### `text-lg`

- **If it's a heading** --> `typo-heading-lg` (closest semantic match at 1.25rem vs 1.125rem)
- **If it's body text** --> `typo-body-lg` (closest semantic match at 1rem vs 1.125rem)

### `text-3xl`

- Map to `typo-hero` (2.25rem covers the 1.875rem of text-3xl adequately; the scale system handles fine-tuning)

### `text-[11px]` or other arbitrary sizes

- 11px is between `typo-caption` (12px) and nothing below it --> use `typo-caption`
- 13px is between `typo-caption` (12px) and `typo-body` (14px) --> use `typo-body` if body text, `typo-caption` if secondary

### `text-xs font-medium` (non-numeric)

- **If it's a small label or tag** --> `typo-caption`
- **If it's uppercase with tracking** --> `typo-label`

### `text-sm` alone (ambiguous role)

- **In a `<p>` or descriptive span** --> `typo-body`
- **In a list of stats/numbers** --> `typo-data`
- **As a heading inside a small card** --> `typo-heading` (add if the element acts as a title)

---

## 3. DO NOT Replace

These classes start with `text-` but are NOT typography sizing. Leave them untouched.

### Color classes

```
text-foreground       text-muted-foreground    text-primary
text-secondary        text-accent              text-status-*
text-brand-*          text-card-*              text-destructive
text-white            text-black               text-inherit
text-current          text-transparent
```

### Alignment classes

```
text-center    text-left    text-right    text-start    text-end
```

### Overflow and wrapping classes

```
text-ellipsis    text-clip    text-wrap    text-nowrap    text-balance    text-pretty
```

### Decoration classes

```
text-underline    text-line-through    text-no-underline
```

---

## 4. Exceptions -- Keep As-Is

### Recharts / SVG components

Chart components using inline `fontSize` in tick/style props cannot use CSS classes:

```tsx
// KEEP -- CSS classes don't apply inside SVG <text> elements
<XAxis tick={{ fontSize: 11 }} />
<YAxis style={{ fontSize: '0.75rem' }} />
```

### The `sf()` scale factor helper

Chart components using the `sf()` helper for responsive font sizing should remain unchanged -- they operate in a different scaling system.

### Inline `style={{ fontSize: ... }}`

If a component uses inline styles for font size rather than Tailwind classes, leave it alone. These typically exist for dynamic sizing or SVG constraints.

---

## 5. Weight Cleanup

When converting to a semantic class, **remove** any now-redundant utility classes:

| Semantic Class | Remove These Redundant Classes |
|---|---|
| `typo-hero` | `font-bold`, `text-4xl`, `leading-tight` |
| `typo-heading-lg` | `font-bold`, `text-xl`, `leading-snug` |
| `typo-heading` | `font-bold`, `font-semibold`, `text-sm`, `leading-snug` |
| `typo-body` | `font-normal`, `text-sm`, `leading-relaxed` |
| `typo-body-lg` | `font-normal`, `text-base`, `leading-relaxed` |
| `typo-caption` | `font-medium`, `text-xs`, `leading-tight` |
| `typo-label` | `font-bold`, `text-xs`, `uppercase`, `tracking-wider`, `tracking-wide`, `leading-none` |
| `typo-data` | `font-medium`, `text-sm`, `tabular-nums`, `leading-snug` |
| `typo-data-lg` | `font-bold`, `text-2xl`, `tabular-nums`, `leading-tight` |
| `typo-code` | `font-mono`, `text-xs`, `leading-relaxed` |

**Keep** any classes that are NOT covered by the semantic class: colors, spacing, alignment, display, etc.

### Example conversion

Before:
```tsx
<h2 className="text-sm font-bold text-foreground mb-2">Section Title</h2>
```

After:
```tsx
<h2 className="typo-heading text-foreground mb-2">Section Title</h2>
```

Before:
```tsx
<span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
```

After:
```tsx
<span className="typo-label text-muted-foreground">
```

---

## 6. Grep Audit Command

Run this after migration to find remaining unconverted text-size classes in feature components:

```bash
grep -rn "\btext-xs\b\|\btext-sm\b\|\btext-base\b\|\btext-lg\b\|\btext-xl\b\|\btext-2xl\b\|\btext-3xl\b\|\btext-4xl\b" \
  src/features/ --include="*.tsx" \
  | grep -v "text-foreground\|text-muted\|text-background\|text-primary\|text-secondary\|text-accent\|text-status\|text-brand\|text-card\|text-destructive\|text-white\|text-black\|text-inherit\|text-current\|text-transparent\|text-center\|text-left\|text-right\|text-ellipsis\|text-wrap\|text-nowrap\|text-balance\|text-clip\|text-start\|text-end" \
  | wc -l
```

Target: **0 remaining matches** (excluding exceptions documented in section 4).

To see the actual lines instead of just the count, remove the final `| wc -l`.

---

## Quick Decision Flowchart

```
Is the element displaying a number/stat/metric?
  YES --> Is it a large hero number?
    YES --> typo-data-lg
    NO  --> typo-data

Is the element a heading or title?
  YES --> Is it page-level (large)?
    YES --> typo-heading-lg
    NO  --> typo-heading

Is the element a greeting or hero display?
  YES --> typo-hero

Is the element monospace / showing an ID or code?
  YES --> typo-code

Is the element an uppercase label / badge / category?
  YES --> typo-label

Is the element small secondary text (timestamp, hint)?
  YES --> typo-caption

Is the element prominent body text (1rem+)?
  YES --> typo-body-lg

Default --> typo-body
```
