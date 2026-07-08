/** MemorySection — memory reframed as ORTHOGONAL choices grounded in what the
 *  app actually wires (2026-07-08 memory-module research), replacing the old
 *  one-of-five strategy list (which collapsed independent flags and named two
 *  subsystems that aren't wired at persona runtime).
 *
 *  Real, per-persona axes only:
 *   • Remembers between runs — the real default-on persona-memory store.
 *   • Reflects & improves — memory curation + the self-annealing scratchpad.
 *   • Team ledger — the team_memories shared pool (only bites when in a team).
 *   • Obsidian — off / read-the-vault / mirror-out (mirror is a manual sync today).
 *  Knowledge-base grounding is deliberately shown as unavailable — runtime KB
 *  retrieval for personas isn't implemented (the verb has no handler).
 */
import { Brain, Sparkles, Users, NotebookPen, Database } from "lucide-react";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import { Segment } from "./coreBits";
import type { PersonaCore, ObsidianMode } from "./usePersonaCore";

export function MemorySection({ core }: { core: PersonaCore }) {
  const m = core.state.memory;
  return (
    <div className="flex flex-col gap-2.5">
      <ToggleRow
        icon={Brain} title="Remembers between runs"
        sub="Learns facts, preferences, and lessons from its own runs (on by default)."
        checked={m.remembers} onChange={() => core.setMemory({ remembers: !m.remembers })}
      />
      <ToggleRow
        icon={Sparkles} title="Reflects & improves"
        sub="Periodically tidies what it keeps and re-reads a technique scratchpad."
        checked={m.reflect} disabled={!m.remembers}
        onChange={() => core.setMemory({ reflect: !m.reflect })}
      />
      <ToggleRow
        icon={Users} title="Team ledger"
        sub="Contributes to and reads the team's shared knowledge — when it's on a team."
        checked={m.team} disabled={!m.remembers}
        onChange={() => core.setMemory({ team: !m.team })}
      />
      <div className="flex flex-col gap-1.5 pt-0.5">
        <span className="inline-flex items-center gap-2 typo-body text-foreground">
          <NotebookPen className="w-3.5 h-3.5" style={{ color: "#c084fc" }} /> Obsidian vault
        </span>
        <Segment<ObsidianMode>
          label=""
          layoutGroup="obsidian"
          color="#c084fc"
          value={m.obsidian}
          onChange={(v) => core.setMemory({ obsidian: v })}
          options={[
            { id: "off", label: "Off" },
            { id: "read", label: "Read vault", blurb: "Reads the connected vault during runs" },
            { id: "mirror", label: "Mirror out", blurb: "Mirrors learnings to the vault (manual sync today)" },
          ]}
        />
      </div>
      {/* Honest about the gap: KB grounding isn't wired for personas yet. */}
      <div className="inline-flex items-center gap-2 typo-caption opacity-50">
        <Database className="w-3.5 h-3.5" /> Knowledge-base grounding — coming soon
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon, title, sub, checked, onChange, disabled = false,
}: {
  icon: typeof Brain; title: string; sub: string; checked: boolean; onChange: () => void; disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${disabled ? "opacity-45" : ""}`}>
      <Icon className="w-4 h-4 shrink-0" style={{ color: "#c084fc" }} />
      <span className="flex flex-col min-w-0 flex-1">
        <span className="typo-body text-foreground leading-tight">{title}</span>
        <span className="typo-caption">{sub}</span>
      </span>
      <AccessibleToggle checked={checked} onChange={disabled ? () => {} : onChange} label={title} disabled={disabled} size="sm" />
    </div>
  );
}
