// REFLECTION BLOCK — the post-run dual-reflection contract of the skill
// standard (docs/skill-standard.md). Appended by dispatchSkillToRepo to EVERY
// dispatched skill run (no opt-in field: the honesty calibration makes no-op
// runs nearly free), after the MEMORY BLOCK when one is present.
//
// The same body, as a `## Skill Reflection` SKILL.md trailer, covers manual
// terminal runs — the adopt/share LLM passes standardize it into copies they
// write (skillTasks.ts imports SKILL_REFLECTION_SECTION below). The dispatch
// block supersedes the embedded section for the run it rides on, so a skill
// carrying both never reflects twice.

/** The contract body — single source of truth for both injection lanes. */
export const REFLECTION_CONTRACT_BODY = [
  'After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).',
  '',
  'Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.',
  '',
  'Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):',
  '1. If nothing generalizes beyond this repo, stop here.',
  '2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.',
  '3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.',
  '4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.',
  '',
  'Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).',
].join('\n');

/** Dispatch-lane wrapper (mirrors the MEMORY BLOCK delimiters). */
export function composeReflectionBlock(): string {
  return [
    '--- REFLECTION BLOCK (Personas skill standard) ---',
    'If this skill’s SKILL.md already contains a `## Skill Reflection` section, this block supersedes it for this run.',
    '',
    REFLECTION_CONTRACT_BODY,
    '--- END REFLECTION BLOCK ---',
  ].join('\n');
}

/** The embedded SKILL.md trailer — what the adopt/share passes standardize
 *  into every copy they write, covering manual terminal runs. */
export const SKILL_REFLECTION_SECTION = ['## Skill Reflection', '', REFLECTION_CONTRACT_BODY].join('\n');
