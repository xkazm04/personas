Execute this requirement immediately without asking questions.

## REQUIREMENT

# Replace write-lock rate limiter with atomic counters for message ingestion

## Metadata
- **Category**: hot_path
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:38:24 PM

## Description
MessageRouter::check_rate_limit acquires a write lock on the entire rate_tracker HashMap for every incoming message, even when just incrementing a counter. Under message bursts from multiple peers, all receive paths serialize on this single lock. Replace with a DashMap<String, AtomicU32 + AtomicU64> (or a per-peer atomic struct) so rate checks become lock-free CAS operations. The 60-second cleanup in receive_loop can sweep the DashMap with retain() without blocking the hot path.

## Reasoning
In messaging.rs:111-131, check_rate_limit takes self.rate_tracker.write().await on every call. The inbox write lock (line 88) is also taken per message but is keyed by target_persona_id so contention is spread. The rate_tracker lock is global -- every message from every peer contends on the same lock. At 10 messages/second across 10 peers (the configured rate limit), that is 100 write-lock acquisitions per second on a single RwLock. Switching to atomic operations eliminates this serialization point entirely and is a well-understood pattern for token-bucket rate limiters.

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