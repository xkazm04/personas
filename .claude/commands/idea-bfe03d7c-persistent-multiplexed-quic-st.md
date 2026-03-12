Execute this requirement immediately without asking questions.

## REQUIREMENT

# Persistent multiplexed QUIC streams instead of open-per-operation

## Metadata
- **Category**: hot_path
- **Effort**: Unknown (6/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:38:08 PM

## Description
Every ping, manifest request, and agent message opens a fresh bi-directional QUIC stream (open_bi/accept_bi), wraps it in BufWriter/BufReader, performs one request-response, then drops the stream. QUIC stream creation involves round-trip overhead and flow-control negotiation. Instead, maintain a small pool of long-lived streams per connection (one for control messages like Ping/ManifestRequest, one for agent messages). Reuse streams across operations with a lightweight framing layer that tags each message with a request ID for multiplexing.

## Reasoning
Stream creation appears in connection.rs:74, connection.rs:316, manifest_sync.rs:32, and messaging.rs:53 -- every single P2P operation. QUIC streams are cheap but not free: each open_bi triggers a STREAM frame exchange. For health checks running every 15s across N peers, that is 2N stream opens per cycle (ping + manifest sync). A persistent stream pool eliminates this overhead entirely and also removes the repeated BufWriter/BufReader allocation. The agent messaging path benefits most because message bursts would amortize stream setup cost.

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