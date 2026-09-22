/**
 * The one door an app surface uses to start a conversation with Athena.
 *
 * Before this existed each surface reached into the store itself
 * (`setPendingChatPrompt('…')`) and every one of them forgot the same thing:
 * the message reached Athena filed as USER INPUT. She had no way to tell a
 * button from a person, which matters more than it sounds — she reasons
 * differently about "the operator is asking me this" than about "a surface
 * handed me a state dump and wants a read on it", and an app prompt also
 * cancelled any autonomous chain that happened to be running, because that
 * cancel is keyed on the operator interrupting.
 *
 * The plumbing to do it properly was already there and unused: the backend has
 * accepted `system_source` since the paired-device work, turning the turn into
 * a `TurnOrigin::External` (System episode, `[Automated request from <source> —
 * not the user]` on stdin, autonomy left alone). This hook is the frontend half.
 *
 * Usage — `source` is REQUIRED here, deliberately. The store's
 * `setPendingChatPrompt` still accepts a source-less request for genuine user
 * text; a surface reaching for THIS hook is by definition not the user typing.
 *
 * ```ts
 * const askAthena = useAskAthena();
 * askAthena('Ship', buildShipBriefing(vm, project));
 * ```
 */
import { useCallback } from 'react';

import { useCompanionStore } from './companionStore';

export type AskAthena = (source: string, text: string) => void;

export function useAskAthena(): AskAthena {
  return useCallback((source: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    useCompanionStore.getState().setPendingChatPrompt({ text: body, source });
  }, []);
}
