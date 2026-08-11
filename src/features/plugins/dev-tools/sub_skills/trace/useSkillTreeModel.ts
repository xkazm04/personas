// Level-2 data spine — derives branches from the already-loaded TraceModel
// (zero re-fan-out) and fetches only the two skill-standard reads: the
// library revision timeline and the parsed lessons.
import { useEffect, useMemo, useState } from 'react';

import {
  listSkillLessons, skillVersionTimeline,
  type SkillLessonRow, type SkillRevisionRow,
} from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';

import { presetVisual } from '../../constants/presetSkills';
import { buildSkillTree } from './traceModel';
import type { SkillTreeModel, TraceModel } from './traceTypes';

interface Fetched {
  loading: boolean;
  timeline: SkillRevisionRow[];
  lessons: SkillLessonRow[];
}

// Warm cache keyed by skill name (page unmounts on tab switch).
let cachedSkill: string | null = null;
let cachedFetched: Fetched | null = null;

export function useSkillTreeModel(skillName: string, trace: TraceModel): SkillTreeModel {
  const warm = skillName === cachedSkill && cachedFetched != null;
  const [f, setF] = useState<Fetched>(
    warm ? (cachedFetched as Fetched) : { loading: true, timeline: [], lessons: [] },
  );

  useEffect(() => {
    let alive = true;
    setF((prev) => (skillName === cachedSkill ? prev : { loading: true, timeline: [], lessons: [] }));
    void (async () => {
      const [timeline, lessons] = await Promise.all([
        skillVersionTimeline(skillName, 'global').catch((e) => { silentCatch('tree timeline')(e); return [] as SkillRevisionRow[]; }),
        listSkillLessons(skillName).catch((e) => { silentCatch('tree lessons')(e); return [] as SkillLessonRow[]; }),
      ]);
      if (!alive) return;
      const next: Fetched = { loading: false, timeline, lessons };
      cachedSkill = skillName;
      cachedFetched = next;
      setF(next);
    })();
    return () => { alive = false; };
  }, [skillName]);

  return useMemo(() => {
    const row = trace.skills.find((s) => s.name === skillName);
    const cells = trace.projects.map((p) => trace.cell(skillName, p.id));
    const built = buildSkillTree(
      skillName,
      trace.projects,
      cells,
      row?.libraryVersion ?? null,
      f.timeline,
      f.lessons,
    );
    return {
      skillName,
      visual: (() => {
        const v = presetVisual(skillName);
        return v ? { icon: v.icon, color: v.color, label: v.label } : row?.visual ?? null;
      })(),
      contextTracked: row?.contextTracked ?? true,
      libraryVersion: row?.libraryVersion ?? null,
      loading: trace.loading || f.loading,
      ...built,
    };
  }, [skillName, trace, f]);
}
