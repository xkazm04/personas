import { useMemo } from 'react';
import type { RealtimeEvent, AnimationMap, AnimationPhase, AnimationState } from './useRealtimeEvents';

export interface AnimatedEvent {
  event: RealtimeEvent;
  animationId: string;
  phase: AnimationPhase;
}

/**
 * Derives a list of active (non-done, non-expired) animated events
 * by joining events with the animation map.
 *
 * Consumers should include `animTick` in their render path so this
 * re-evaluates when animation phases change.
 */
export function useAnimatedEvents(
  events: RealtimeEvent[],
  animationMap: AnimationMap,
  _animTick: number,
): AnimatedEvent[] {
  return useMemo(() => {
    const result: AnimatedEvent[] = [];
    // Build a quick lookup: eventId -> AnimationState[]
    // (an event can have multiple animation entries in replay scenarios)
    const byEventId = new Map<string, AnimationState>();
    for (const anim of animationMap.values()) {
      // Keep the latest animation for each event
      const existing = byEventId.get(anim.eventId);
      if (!existing || anim.phaseStartedAt > existing.phaseStartedAt) {
        byEventId.set(anim.eventId, anim);
      }
    }

    for (const event of events) {
      const anim = byEventId.get(event.id);
      if (!anim || anim.phase === 'done') continue;
      result.push({
        event,
        animationId: anim.animationId,
        phase: anim.phase,
      });
    }
    return result;
  }, [events, animationMap, _animTick]);
}

/**
 * Get animation phase for a specific event. Returns 'done' if no animation found.
 */
export function getEventPhase(animationMap: AnimationMap, eventId: string): AnimationPhase {
  for (const anim of animationMap.values()) {
    if (anim.eventId === eventId) return anim.phase;
  }
  return 'done';
}

/**
 * Find animation entry for a specific event.
 */
export function getEventAnimation(animationMap: AnimationMap, eventId: string): AnimationState | undefined {
  for (const anim of animationMap.values()) {
    if (anim.eventId === eventId) return anim;
  }
  return undefined;
}
