# Companion

Companion is the Athena assistant plugin. It provides setup controls, a companion panel, memory/brain inspection, approval cards, voice configuration, and optional voice playback.

## Implemented surfaces

| Surface | Purpose | Implementation |
| --- | --- | --- |
| Setup | Configure companion behavior | `src/features/plugins/companion/sub_setup` |
| Memory | Inspect companion brain/memory | `sub_memory`, `BrainViewer.tsx` |
| Voice | Configure voice profile and playback | `sub_voice`, `voicePlayback.ts`, backend `commands/companion/voice.rs` |
| Panel | Chat and approval UI | `CompanionPanel.tsx`, `ApprovalCard.tsx` |
| Avatar | Athena visual state | `AthenaAvatar.tsx`, [athena-interactive-avatar.md](athena-interactive-avatar.md) |

## Backend

The Rust surface is `src-tauri/src/commands/companion` plus companion runtime modules under `src-tauri/src/companion`.

