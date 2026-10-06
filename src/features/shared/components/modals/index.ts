// Re-export BaseModal so contributors find the canonical modal primitive
// under `shared/components/modals/` (the path most reach for first).
// Source of truth lives in `@/lib/ui/BaseModal` for legacy reasons.
export { BaseModal } from '@/lib/ui/BaseModal';
export type { BaseModalSize } from '@/lib/ui/BaseModal';


// The modal INTERIOR standard. `BaseModal` above owns everything outside the
// panel; `ModalShell` owns everything inside it, so a caller never writes a
// `panelClassName` again. Prefer it for any new modal.
export { ModalShell, ModalSection, modalSectionHeadClass } from './ModalShell';
export type { ModalShellProps } from './ModalShell';
export { SKINS as MODAL_SKINS } from './modalSkins';
export type { ModalSkin, ModalWidth, SkinSpec } from './modalSkins';
