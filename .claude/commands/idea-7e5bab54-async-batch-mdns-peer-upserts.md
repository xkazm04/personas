Execute this requirement immediately without asking questions.

## REQUIREMENT

# Async-batch mDNS peer upserts instead of synchronous per-event DB writes

## Metadata
- **Category**: hot_path
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:38:16 PM

## Description
MdnsService::handle_mdns_event performs a synchronous pool.get() + SQL INSERT/UPDATE for every ServiceResolved event on the mDNS browse receiver. When multiple peers announce simultaneously (e.g., network recovery, app startup on a busy LAN), this blocks the mDNS event loop and can cause the flume receiver to back up. Buffer discovered peers in a small in-memory map (peer_id -> ValidatedPeerData) and flush to DB in a single batch transaction every 2-5 seconds via a dedicated periodic task, reducing DB round-trips by the number of events per flush window.

## Reasoning
In mdns.rs:230-241, browse_loop calls handle_mdns_event synchronously for each recv_async result. handle_mdns_event (line 244-322) acquires a DB connection and performs a single-row upsert. On a LAN with 30+ peers, initial discovery fires 30+ ServiceResolved events in rapid succession. Each synchronous DB write blocks the next event from being processed. Batching into a single transaction (one pool.get(), one BEGIN/COMMIT) reduces SQLite lock contention and write-ahead log flushes from N to 1 per batch window.

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