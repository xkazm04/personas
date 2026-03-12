Execute this requirement immediately without asking questions.

## REQUIREMENT

# Race condition in concurrent connect_to_peer calls

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 9:02:22 AM

## Description
connect_to_peer checks contains_key then later inserts, but drops the read lock between check and insert. Two concurrent calls for the same peer_id both pass the check, both complete the QUIC handshake, and one silently overwrites the other in the HashMap � orphaning a QUIC connection. Use an entry API pattern or hold a write lock across the check-and-insert, or track an in-progress Connecting state to serialize attempts per peer.

## Reasoning
This is a classic TOCTOU race in async code. The orphaned connection leaks resources and the peer sees two open connections to the same node, causing protocol confusion. P2P auto-connect on mDNS discovery makes concurrent calls for the same peer likely in practice.

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