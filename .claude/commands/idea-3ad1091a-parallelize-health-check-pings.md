Execute this requirement immediately without asking questions.

## REQUIREMENT

# Parallelize health check pings with bounded concurrency

## Metadata
- **Category**: scaling
- **Effort**: Medium (2/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:37:55 PM

## Description
ConnectionManager::run_health_checks iterates peer IDs sequentially, calling ping_peer one at a time. Each ping opens a new QUIC bi-directional stream with a 5-second timeout. At N connected peers, worst-case latency is 5N seconds. With the 15-second health check interval and >3 peers timing out, the health loop can never complete a full cycle. Use futures::stream::iter + buffer_unordered(8) to ping up to 8 peers concurrently, capping total cycle time at ceil(N/8)*5 seconds and keeping the health loop within its 15-second budget up to ~24 peers.

## Reasoning
In connection.rs:282-299, run_health_checks collects all peer IDs then loops sequentially. Each ping_peer (line 311-345) opens a new bi-stream, writes Ping, and waits up to 5s for Pong. This is the most latency-sensitive periodic task because stale connections block message delivery. Sequential execution means the system cannot detect and evict dead peers fast enough under load. Bounded concurrency directly translates to faster dead-peer eviction and more responsive messaging.

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