/**
 * Patch bay — the assignment matrix as a physical patch panel.
 *
 * Metaphor: connect / disconnect. Each project is a compact card; wiring it to an
 * LLM tracer lights the card's left edge in that connector's brand colour and
 * shows a live "plugged in" icon, so a column of projects reads by brand colour
 * at a glance. Un-wired projects show a muted "unplugged" jack inviting a
 * connection. Different from baseline (a flat table of grey rows + OS-styled
 * `<select>`s) by carrying the connect metaphor through colour, icon, and the
 * themed brand-icon picker.
 */
import { Cable, PlugZap, Unplug } from 'lucide-react';
import {
  connectorBrand,
  assignedCred,
  ConnectorSocket,
  type MatrixVariantProps,
} from './matrixShared';

export default function MatrixPatchbay({ projects, llmCreds, assign }: MatrixVariantProps) {
  const wired = projects.filter((p) => p.llm_tracking_credential_id).length;

  return (
    <div className="mx-4 mt-3" data-testid="llm-overview-matrix">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <Cable className="w-3.5 h-3.5 text-primary/60" />
        <span className="typo-caption text-foreground/70">Wire each project to its LLM tracer</span>
        <span className="ml-auto typo-caption text-foreground/40">
          {wired}/{projects.length} wired
        </span>
      </div>

      <div className="space-y-1.5">
        {projects.map((p) => {
          const cred = assignedCred(p, llmCreds);
          const brand = cred ? connectorBrand(cred.serviceType) : null;
          return (
            <div
              key={p.id}
              style={brand ? { borderLeftColor: brand.color } : undefined}
              className="group relative flex items-center gap-3 rounded-modal border border-primary/10 border-l-2 bg-gradient-to-br from-card/60 to-card/20 px-3 py-2 transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-elevation-2"
            >
              <span
                className={cred ? 'shrink-0' : 'shrink-0 text-foreground/30'}
                style={cred && brand ? { color: brand.color } : undefined}
              >
                {cred ? <PlugZap className="w-4 h-4" /> : <Unplug className="w-4 h-4" />}
              </span>

              <div className="flex-1 min-w-0">
                <div className="typo-caption text-foreground truncate">{p.name}</div>
                {p.tech_stack ? (
                  <div className="text-[10px] text-foreground/40 truncate">{p.tech_stack}</div>
                ) : null}
              </div>

              <ConnectorSocket
                value={p.llm_tracking_credential_id}
                llmCreds={llmCreds}
                onChange={(id) => assign(p.id, id)}
                testId={`llm-overview-assign-${p.id}`}
                placeholder="Connect…"
                className="w-44 shrink-0"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
