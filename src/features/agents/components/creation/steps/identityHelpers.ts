import type { BuilderState } from './builder/types';

export function deriveName(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return '';
  const short = trimmed.slice(0, 30);
  const atWord = short.lastIndexOf(' ');
  const base = atWord > 10 ? short.slice(0, atWord) : short;
  return trimmed.length > base.length ? base + '...' : base;
}

export function deriveNameFromState(state: BuilderState): string {
  const firstUc = state.useCases.find((uc) => uc.title.trim());
  if (firstUc) return firstUc.title.trim();
  if (state.intent.trim()) return deriveName(state.intent);
  return '';
}

export function deriveDescription(state: BuilderState): string {
  if (state.intent.trim()) return state.intent.trim().slice(0, 200);
  const descs = state.useCases.filter((uc) => uc.description.trim()).map((uc) => uc.description.trim());
  if (descs.length > 0) return descs.join('; ').slice(0, 200);
  return '';
}

export const pageTransition = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
