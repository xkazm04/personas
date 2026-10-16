import { useCallback, useEffect, useRef, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';

const DRAFT_PREFIX = 'personas.channel.draft.';
const ATHENA = { personaId: 'athena', name: 'Athena' };

/**
 * The team composer's state: a per-team PERSISTED draft (switching projects
 * never loses what was typed), an rAF-batched autosize (one frame of latency
 * instead of a reflow per keystroke), and the @-mention candidates with Tab to
 * complete. Extracted from ConversationComposer (WP12, under 200 LOC).
 */
export function useComposerDraft(teamId: string, members: ChannelMember[]) {
  const [draft, setDraft] = useState('');
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      setDraft(localStorage.getItem(DRAFT_PREFIX + teamId) ?? '');
    } catch {
      setDraft('');
    }
  }, [teamId]);
  useEffect(() => {
    try {
      if (draft.trim()) localStorage.setItem(DRAFT_PREFIX + teamId, draft);
      else localStorage.removeItem(DRAFT_PREFIX + teamId);
    } catch (e) {
      silentCatch('conversation:draft')(e);
    }
  }, [draft, teamId]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
    return () => cancelAnimationFrame(id);
  }, [draft]);

  const query = mentionAt === null ? null : draft.slice(mentionAt + 1).toLowerCase();
  const candidates = query === null
    ? []
    : [ATHENA, ...members]
        .filter((m) => m.name.toLowerCase().replace(/^t:\s*/, '').includes(query))
        .slice(0, 5);

  const completeMention = useCallback(
    (name: string) => {
      if (mentionAt === null) return;
      const first = name.replace(/^T:\s*/, '').split(/\s+/)[0] ?? name;
      setDraft((d) => `${d.slice(0, mentionAt)}@${first} `);
      setMentionAt(null);
      ref.current?.focus();
    },
    [mentionAt],
  );

  /** Track the caret: an `@` with no space after it opens the mention list. */
  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    const upto = v.slice(0, e.target.selectionStart ?? v.length);
    const at = upto.lastIndexOf('@');
    setMentionAt(at >= 0 && !/\s/.test(upto.slice(at + 1)) ? at : null);
  }, []);

  return { draft, setDraft, ref, candidates, completeMention, mentionOpen: mentionAt !== null, closeMention: () => setMentionAt(null), onChange };
}
