Execute this requirement immediately without asking questions.

## REQUIREMENT

# Delta-based manifest sync instead of full-replace every 30s

## Metadata
- **Category**: data_flow
- **Effort**: High (3/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:37:45 PM

## Description
ManifestSync::run_periodic_sync performs a full DELETE + INSERT of every peer manifest entry every 30 seconds, even when nothing has changed. Replace with a content-hash comparison: include a manifest_hash in ManifestResponse, store it alongside peer_manifests, and skip the DB transaction when the hash matches. At 100 peers with 50 entries each, this eliminates ~5000 DELETE + 5000 INSERT statements per cycle when manifests are stable (the common case).

## Reasoning
The upsert_peer_manifest method (manifest_sync.rs:89-134) unconditionally deletes all rows for a peer_id and re-inserts them inside a transaction. The ManifestEntry struct already has all the data needed to compute a stable hash. Adding a single hash comparison before the transaction turns an O(peers * entries) DB write operation into O(peers) read-only checks in the steady state. This is the single biggest DB write hotpath in the P2P layer.

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

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

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