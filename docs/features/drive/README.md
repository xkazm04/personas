# Drive

Drive is the local document/file plugin. It groups file browsing, OCR/signing helpers, sharing-related actions, and local storage workflows under the plugin system.

## Implementation roots

| Layer | Root |
| --- | --- |
| Frontend | `src/features/plugins/drive` |
| API wrapper | `src/api/drive.ts` |
| Backend | `src-tauri/src/commands/drive.rs` |
| Related signing/network commands | `src-tauri/src/commands/signing`, `src-tauri/src/commands/network` |

## Notes

Drive follows the plugin convention used by Artist, Dev Tools, Research Lab, Twin, Obsidian Brain, and Companion. Keep file-system operations behind backend commands so sensitive path validation stays centralized.

