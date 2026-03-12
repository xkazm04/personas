Execute this requirement immediately without asking questions.

## REQUIREMENT

# Hot-reloading config is silently broken after start

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:35:40 PM

## Description
set_config() updates the RwLock<NetworkConfig> but all interval values (health_check_interval_secs, manifest_sync_interval_secs, stale_peer_timeout_secs) were captured at start() time and baked into PeriodicTask constructors. Calling set_config after start has zero effect on running behavior. Either make PeriodicTask read the live config each tick, or remove set_config and make NetworkConfig immutable after construction, documenting that restart is required for config changes.

## Reasoning
This is a classic implicit assumption bug: the API shape implies runtime configurability but the implementation ignores updates. A new developer will waste hours debugging why their config change did nothing. Making the contract explicit prevents confusion and misuse.

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