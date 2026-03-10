import {
  CREATE_TEMPLATE_CONTEXT_KEY,
} from './useCreateTemplateReducer';
import type { PersistedCreateTemplateContext } from './useCreateTemplateReducer';

// ── Props ──

export interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateCreated: () => void;
}

// ── Persistence helpers ──

export function persistContext(ctx: PersistedCreateTemplateContext) {
  window.localStorage.setItem(CREATE_TEMPLATE_CONTEXT_KEY, JSON.stringify(ctx));
}

export function clearPersistedContext() {
  window.localStorage.removeItem(CREATE_TEMPLATE_CONTEXT_KEY);
}
