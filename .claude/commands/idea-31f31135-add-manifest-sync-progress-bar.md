Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add manifest sync progress bar with resource-level breakdown in PeerDetailDrawer

## Metadata
- **Category**: ui
- **Effort**: Unknown (5/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/12/2026, 9:58:30 AM

## Description
When a peer is connected, the ManifestSync module (src-tauri/src/engine/p2p/manifest_sync.rs) runs periodic_sync_loop every 30s but the frontend has zero visibility into sync status. Add a manifest sync progress indicator inside PeerDetailDrawer (referenced in PeerList.tsx line 102). Show: (1) a thin progress bar at the top of the drawer using `<motion.div initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 0.8 }} className="h-0.5 bg-gradient-to-r from-cyan-500 to-emerald-400" />` during active sync, (2) a resource count badge like "12 resources synced" with synced_at relative timestamp from PeerManifestEntry (types.rs line 76), and (3) a collapsible list of manifest entries grouped by resource_type showing display_name and access_level badges. This requires a new Tauri event `p2p:manifest-sync-progress` emitted from manifest_sync.rs during sync_manifest, plus calling the existing get_peer_manifest command to populate the drawer.

## Reasoning
Manifest sync is a core differentiator of the P2P system -- peers share what resources they expose. But currently users connect to a peer and see nothing about what that peer offers. The PeerManifestEntry type is already TS-exported and the get_peer_manifest command exists (discovery.rs line 63-71) but is never called from the UI. This bridges a significant gap between backend capability and user awareness.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: P2P Protocol & Transport

**Description**: Peer-to-peer networking with mDNS discovery, QUIC transport, protocol messaging, manifest synchronization.
**Related Files**:
- `src-tauri/src/engine/p2p/mod.rs`
- `src-tauri/src/engine/p2p/protocol.rs`
- `src-tauri/src/engine/p2p/transport.rs`
- `src-tauri/src/engine/p2p/mdns.rs`
- `src-tauri/src/engine/p2p/connection.rs`
- `src-tauri/src/engine/p2p/messaging.rs`
- `src-tauri/src/engine/p2p/manifest_sync.rs`
- `src-tauri/src/engine/p2p/types.rs`
- `src-tauri/src/engine/identity.rs`
- `src-tauri/src/engine/bundle.rs`
- `src-tauri/src/commands/network/discovery.rs`
- `src-tauri/src/commands/network/identity.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **leonardo**: Use `/leonardo` skill to generate images with Leonardo AI (Lucid Origin model). For illustrations, icons, empty state artwork, branded loaders, and visual assets. Do NOT hand-code SVG — generate with AI and convert to SVG if needed.
- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

## DURING IMPLEMENTATION

- Use `get_memory` MCP tool when you encounter unfamiliar code or need context about patterns/files
- Use `report_progress` MCP tool at each major phase (analyzing, planning, implementing, testing, validating)
- Use `get_related_tasks` MCP tool before modifying shared files to check for parallel task conflicts

## AFTER IMPLEMENTATION

1. Log your implementation using the `log_implementation` MCP tool with:
   - requirementName: the requirement filename (without .md)
   - title: 2-6 word summary
   - overview: 1-2 paragraphs describing what was done

2. Check for test scenario using `check_test_scenario` MCP tool
   - If hasScenario is true, call `capture_screenshot` tool
   - If hasScenario is false, skip screenshot

3. Verify: `npx tsc --noEmit` (fix any type errors)

Begin implementation now.