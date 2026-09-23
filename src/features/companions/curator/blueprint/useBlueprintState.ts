/**
 * The page's own state and its one keyboard map.
 *
 * Every key the help sheet names is bound here and nowhere else, so the sheet
 * and the behaviour cannot drift: J/K and the arrows move the row cursor,
 * Enter opens it, Esc backs out of whatever is deepest, 1-9 sort the ledger by
 * one channel, 0 clears, D opens the docket, F widens it, U takes the last
 * answer back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChannelId } from './model/channels';
import type { DocketEntry, DocketFeed } from './model/docket';
import { needsReason } from './model/docket';
import type { BlueprintModel, BlueprintRow } from './model/types';

export interface BlueprintState {
  rows: BlueprintRow[];
  cursor: number;
  setCursor: (i: number) => void;
  solo: ChannelId | 0;
  toggleSolo: (channel: ChannelId) => void;
  query: string;
  setQuery: (value: string) => void;
  docket: {
    open: boolean;
    full: boolean;
    selected: string | null;
    decided: Record<string, { option: string; reason: string }>;
  };
  prompt: { id: string; option: string } | null;
  promptValue: string;
  setPromptValue: (value: string) => void;
  commitPrompt: () => void;
  answer: (entry: DocketEntry, option: string) => void;
  /** Answer the selected card by option index - the armed number keys. */
  answerSelected: (index: number) => void;
  undo: () => void;
  selectCard: (id: string) => void;
  toggleDocket: () => void;
  toggleFull: () => void;
  closeDocket: () => void;
  help: boolean;
  toggleHelp: () => void;
  waiting: number;
}

export function useBlueprintState(model: BlueprintModel, feed: DocketFeed): BlueprintState {
  const [cursor, setCursor] = useState(0);
  const [solo, setSolo] = useState<ChannelId | 0>(0);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, { option: string; reason: string }>>({});
  const [prompt, setPrompt] = useState<{ id: string; option: string } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [help, setHelp] = useState(false);
  const stack = useRef<string[]>([]);

  const rows = useMemo(() => {
    const list = [...model.rows];
    if (solo) {
      list.sort((a, b) => {
        const av = a.cells[solo].kind === 'scored' ? (a.cells[solo] as { mark: { points: number } }).mark.points : 0;
        const bv = b.cells[solo].kind === 'scored' ? (b.cells[solo] as { mark: { points: number } }).mark.points : 0;
        return bv - av || a.rank - b.rank;
      });
    }
    return list;
  }, [model.rows, solo]);

  const waiting = feed.entries.filter((e) => !e.answeredBy && !decided[e.id]).length;

  const toggleSolo = useCallback((channel: ChannelId) => {
    setSolo((current) => (current === channel ? 0 : channel));
    setCursor(0);
  }, []);

  const answer = useCallback((entry: DocketEntry, option: string) => {
    setSelected(entry.id);
    if (needsReason(option)) {
      setPrompt({ id: entry.id, option });
      setPromptValue('');
      return;
    }
    stack.current.push(entry.id);
    setDecided((d) => ({ ...d, [entry.id]: { option, reason: '' } }));
  }, []);

  const commitPrompt = useCallback(() => {
    if (!prompt || !promptValue.trim()) return;
    stack.current.push(prompt.id);
    setDecided((d) => ({ ...d, [prompt.id]: { option: prompt.option, reason: promptValue.trim() } }));
    setPrompt(null);
    setPromptValue('');
  }, [prompt, promptValue]);

  const answerSelected = useCallback(
    (index: number) => {
      const entry = feed.entries.find((e) => e.id === selected);
      const option = entry?.options[index];
      if (entry && option && !decided[entry.id]) answer(entry, option);
    },
    [answer, decided, feed.entries, selected],
  );

  const undo = useCallback(() => {
    const id = stack.current.pop();
    if (!id) return;
    setDecided((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    setPrompt(null);
    setSelected(id);
  }, []);

  // One card is always the selected one, so the keys have a target the moment
  // the drawer opens. A default that pointed at nothing would make `1` do
  // nothing and look broken.
  useEffect(() => {
    if (open && !selected && feed.entries.length) setSelected(feed.entries[0]!.id);
  }, [open, selected, feed.entries]);

  return {
    rows,
    cursor,
    setCursor,
    solo,
    toggleSolo,
    query,
    setQuery,
    docket: { open, full, selected, decided },
    prompt,
    promptValue,
    setPromptValue,
    commitPrompt,
    answer,
    answerSelected,
    undo,
    selectCard: setSelected,
    toggleDocket: () => {
      setOpen((v) => !v);
      setFull(false);
    },
    toggleFull: () => {
      setFull((v) => !v);
    },
    closeDocket: () => {
      setOpen(false);
      setFull(false);
      setPrompt(null);
    },
    help,
    toggleHelp: () => {
      setHelp((v) => !v);
    },
    waiting,
  };
}
