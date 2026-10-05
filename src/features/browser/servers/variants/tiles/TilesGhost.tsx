/**
 * Live tiles loading ghost: two workspace groups of still tiles in the real
 * tile's geometry (name, port row, command, state foot). No spinner, no
 * shimmer; the section chrome above stays rendered.
 */
const GROUPS = [3, 2];

export function TilesGhost() {
  return (
    <div className="lt-root lt-ghost" aria-hidden="true" data-testid="server-tiles-ghost">
      {GROUPS.map((count, g) => (
        <div key={g} className="lt-group">
          <div className="lt-group__head">
            <span className="lt-group__swatch" />
            <span className="lt-ghost__bar" style={{ width: 120, height: 18 }} />
          </div>
          <div className="lt-grid">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="lt-card lt-t-off">
                <div className="lt-card__body">
                  <span className="lt-ghost__bar" style={{ width: '62%', height: 26 }} />
                  <span className="lt-ghost__bar" style={{ width: 96, height: 30 }} />
                  <span className="lt-ghost__bar" style={{ width: '44%', height: 16 }} />
                </div>
                <div className="lt-state">
                  <span className="lt-ghost__bar" style={{ width: '40%', height: 18 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
