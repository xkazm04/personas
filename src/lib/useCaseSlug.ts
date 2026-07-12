/**
 * Use-case join key. MUST stay behaviourally identical to
 * `slugify_use_case` in `src-tauri/src/db/repos/dev_tools.rs` — the Rust side
 * writes `dev_use_cases.slug` with it, and this side matches an observed
 * LLM-telemetry use-case name against that column.
 *
 * Rule: lowercase; every run of non-alphanumeric characters collapses to a
 * single `-`; no leading or trailing separator.
 *
 *   "Checkout Conversion"   → "checkout-conversion"
 *   "checkout_conversion"   → "checkout-conversion"
 *   "  Checkout — Convert!" → "checkout-convert"
 */
export function slugifyUseCase(name: string): string {
  let out = '';
  let pendingSep = false;
  for (const ch of name) {
    if (/[a-z0-9]/i.test(ch)) {
      if (pendingSep && out.length > 0) out += '-';
      pendingSep = false;
      out += ch.toLowerCase();
    } else {
      pendingSep = true;
    }
  }
  return out;
}
