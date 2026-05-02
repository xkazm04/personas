import type { BindingValue, RecipeBinding } from '../types';

/** Replace `{{variable}}` placeholders in a string with the user's binding
 *  values. Multi-value bindings are joined with ", ". Missing bindings
 *  leave the placeholder intact so the substituted output is greppable
 *  for "{{" if something didn't fill in correctly.
 *
 *  Edge: a placeholder whose binding is `undefined` (optional skipped)
 *  is replaced with an empty string — that's the user's intent. */
export function substituteString(
  template: string,
  values: Record<string, BindingValue | undefined>,
  bindings: RecipeBinding[],
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const binding = bindings.find((b) => b.variable === key);
    if (!binding) return `{{${key}}}`; // unknown variable — leave for inspection
    const v = values[key];
    if (v === undefined) {
      // Optional binding skipped → empty replacement.
      return binding.required ? `{{${key}}}` : '';
    }
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  });
}

/** Walk an object and substitute placeholders in every string field
 *  recursively. Used to project a `RecipeUseCaseTemplate` into a
 *  concrete `DesignUseCase` at adoption time. */
export function substituteDeep<T>(
  value: T,
  values: Record<string, BindingValue | undefined>,
  bindings: RecipeBinding[],
): T {
  if (typeof value === 'string') {
    return substituteString(value, values, bindings) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteDeep(v, values, bindings)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteDeep(v, values, bindings);
    }
    return out as T;
  }
  return value;
}

/** Validate that every required binding has a non-empty value. Returns a
 *  list of `variable` keys that are still missing — callers render error
 *  states next to the offending binding inputs. */
export function findMissingBindings(
  bindings: RecipeBinding[],
  values: Record<string, BindingValue | undefined>,
): string[] {
  const missing: string[] = [];
  for (const b of bindings) {
    if (!b.required) continue;
    const v = values[b.variable];
    if (v === undefined || v === null) { missing.push(b.variable); continue; }
    if (typeof v === 'string' && v.trim() === '') { missing.push(b.variable); continue; }
    if (Array.isArray(v) && v.length === 0) { missing.push(b.variable); continue; }
  }
  return missing;
}

/** Pre-fill `bindingValues` with every binding's `default` (when defined).
 *  Optional bindings without defaults stay undefined. Caller can spread
 *  this output into useState's initial value. */
export function defaultBindingValues(bindings: RecipeBinding[]): Record<string, BindingValue> {
  const out: Record<string, BindingValue> = {};
  for (const b of bindings) {
    if (b.default !== undefined) out[b.variable] = b.default;
  }
  return out;
}
