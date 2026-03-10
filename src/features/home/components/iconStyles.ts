// ── Animated SVG Icon Styles (injected once) ────────────────────────────

export const ICON_STYLES = `
  .pi-pulse { animation: pi-pulse 2.5s ease-in-out infinite; }
  .pi-pulse-delay { animation: pi-pulse 2.5s ease-in-out infinite 0.8s; }
  .pi-flow { stroke-dasharray: 3 3; animation: pi-flow 1.5s linear infinite; }
  .pi-flow-slow { stroke-dasharray: 4 4; animation: pi-flow 3s linear infinite; }
  .pi-orbit { animation: pi-orbit 8s linear infinite; transform-origin: 12px 12px; }
  .pi-orbit-r { animation: pi-orbit 6s linear infinite reverse; transform-origin: 12px 12px; }
  .pi-breathe { animation: pi-breathe 3s ease-in-out infinite; }
  .pi-scan { animation: pi-scan 2s ease-in-out infinite; }
  .pi-flicker { animation: pi-flicker 3s step-end infinite; }
  .pi-spin-slow { animation: pi-orbit 12s linear infinite; transform-origin: 12px 12px; }

  @keyframes pi-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
  @keyframes pi-flow {
    0% { stroke-dashoffset: 12; }
    100% { stroke-dashoffset: 0; }
  }
  @keyframes pi-orbit {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes pi-breathe {
    0%, 100% { r: 1.5; opacity: 0.4; }
    50% { r: 2.2; opacity: 0.8; }
  }
  @keyframes pi-scan {
    0%, 100% { transform: translateY(0); opacity: 0.3; }
    50% { transform: translateY(-2px); opacity: 0.7; }
  }
  @keyframes pi-flicker {
    0%, 100% { opacity: 0.8; }
    33% { opacity: 0.2; }
    66% { opacity: 0.6; }
  }
`;
