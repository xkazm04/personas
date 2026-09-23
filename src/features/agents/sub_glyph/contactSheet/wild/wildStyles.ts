/** Scoped stylesheet for "Sheet · Wild". Injected once by the layout as a
 *  <style> element and scoped under `.csw`, so nothing leaks into the app.
 *
 *  Dark theme is the hero: a darkroom (warm black, safelight red, silver-paper
 *  prints, orange film-base edge print). Light theme is its daylight twin: a
 *  lightbox (warm paper, ink, red grease pencil). Both are legible on their own.
 *
 *  Grain is a static SVG turbulence tile (no animation). Every keyframe here is
 *  one-shot; nothing loops while the screen is idle. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

export const WILD_CSS = `
.csw{
  --cs-bg:#0d0a08;--cs-bg2:#17120f;--cs-paper:#1d1713;--cs-ink:#f2ebe0;--cs-dim:#b9ab9b;--cs-faint:#7d7064;
  --cs-safe:#ff5b36;--cs-safe-soft:rgba(255,91,54,.16);--cs-amber:#f4b35a;--cs-edge:#e08a3c;--cs-film:#231811;
  --cs-you:#6fd6c2;--cs-ok:#8fdc9f;--cs-bad:#ff6363;--cs-mark:rgba(242,235,224,.30);--cs-hair:rgba(242,235,224,.10);
  --cs-print:#e9e1d3;--cs-print-ink:#191410;--cs-grain-op:.075;--cs-vig:rgba(0,0,0,.72);
  --cs-display:'Bahnschrift Condensed','Bahnschrift','Arial Narrow',var(--font-sans),sans-serif;
  --cs-serif:Georgia,'Times New Roman',serif;
  --cs-mono:var(--font-mono),ui-monospace,monospace;
  position:relative;isolation:isolate;color:var(--cs-ink);font-family:var(--font-sans);font-size:15px;
  background:radial-gradient(120% 90% at 50% 38%,var(--cs-bg2) 0%,var(--cs-bg) 58%,#060504 100%);
  border-radius:14px;overflow:hidden;
}
[data-theme^="light"] .csw{
  --cs-bg:#efe9de;--cs-bg2:#f8f4ec;--cs-paper:#fbf8f2;--cs-ink:#1c1713;--cs-dim:#554b41;--cs-faint:#857a6e;
  --cs-safe:#c3321b;--cs-safe-soft:rgba(195,50,27,.10);--cs-amber:#9a5a0e;--cs-edge:#b2601c;--cs-film:#2e2118;
  --cs-you:#0f6f63;--cs-ok:#1d7a3a;--cs-bad:#b3261e;--cs-mark:rgba(28,23,19,.42);--cs-hair:rgba(28,23,19,.12);
  --cs-print:#ffffff;--cs-print-ink:#1c1713;--cs-grain-op:.05;--cs-vig:rgba(120,100,70,.18);
  background:radial-gradient(120% 90% at 50% 38%,var(--cs-bg2) 0%,var(--cs-bg) 70%,#e2d9ca 100%);
}
.csw::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:30;background-image:${GRAIN};opacity:var(--cs-grain-op);mix-blend-mode:overlay}
.csw::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:29;box-shadow:inset 0 0 140px 20px var(--cs-vig)}
.csw :focus-visible{outline:2px solid var(--cs-amber);outline-offset:2px}
.csw-edge{font-family:var(--cs-mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cs-edge)}
.csw-display{font-family:var(--cs-display);letter-spacing:-.01em;font-weight:700}
.csw-serif{font-family:var(--cs-serif);font-style:italic}
.csw-body{font-size:15px;line-height:1.55;color:var(--cs-dim)}
.csw-kbd{font-family:var(--cs-mono);font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid var(--cs-hair);color:var(--cs-dim)}
.csw-cell{
  --m:var(--cs-mark);position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;gap:6px;padding:12px 14px;text-align:left;border-radius:3px;cursor:pointer;
  background:
   linear-gradient(var(--m),var(--m)) top left/18px 1px no-repeat,linear-gradient(var(--m),var(--m)) top left/1px 18px no-repeat,
   linear-gradient(var(--m),var(--m)) top right/18px 1px no-repeat,linear-gradient(var(--m),var(--m)) top right/1px 18px no-repeat,
   linear-gradient(var(--m),var(--m)) bottom left/18px 1px no-repeat,linear-gradient(var(--m),var(--m)) bottom left/1px 18px no-repeat,
   linear-gradient(var(--m),var(--m)) bottom right/18px 1px no-repeat,linear-gradient(var(--m),var(--m)) bottom right/1px 18px no-repeat,
   linear-gradient(160deg,rgba(255,255,255,.025),rgba(0,0,0,.18));
  transition:background-color .3s ease;
}
.csw-cell:hover{background-color:var(--cs-hair)}
.csw-cell[data-state="pending"]{--m:var(--cs-safe);background-color:var(--cs-safe-soft)}
.csw-cell[data-state="developed"]{--m:color-mix(in srgb,var(--cs-ink) 60%,transparent)}
.csw-cell[data-state="fogged"]{--m:var(--cs-bad)}
.csw-cell[data-state="unused"]{--m:var(--cs-hair)}
.csw-cell[data-dim="true"]{opacity:.3}
.csw-lab{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--cs-dim)}
.csw-lab b{font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.csw-dot{margin-left:auto;width:8px;height:8px;border-radius:50%;background:var(--cs-hair)}
.csw-cell[data-state="pending"] .csw-dot{background:var(--cs-safe);box-shadow:0 0 0 4px var(--cs-safe-soft)}
.csw-cell[data-state="developed"] .csw-dot{background:var(--cs-ok)}
.csw-cell[data-state="fogged"] .csw-dot{background:var(--cs-bad)}
.csw-img{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:10px;position:relative;overflow:hidden}
.csw-cap{font-size:14px;color:var(--cs-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:20px}
.csw-cell[data-state="developed"] .csw-cap{color:var(--cs-ink)}
.csw-cell[data-state="pending"] .csw-cap,.csw-cell[data-state="pending"] .csw-lab b{color:var(--cs-safe)}
.csw-cell[data-state="fogged"] .csw-cap{color:var(--cs-bad)}
.csw-neg{width:58%;height:48%;border-radius:2px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 6px,transparent 6px 12px);border:1px dashed var(--cs-hair)}
.csw-latent{width:62%;height:54%;border-radius:4px;background:radial-gradient(ellipse at center,var(--cs-safe-soft),transparent 70%)}
.csw-week{display:inline-grid;grid-template-columns:repeat(7,18px);gap:3px}
.csw-week i{font-style:normal;height:22px;border-radius:2px;font-size:12px;line-height:22px;text-align:center;color:var(--cs-faint);background:var(--cs-hair);font-family:var(--cs-mono)}
.csw-week i[data-on="true"]{background:var(--cs-amber);color:#1a1106}
.csw-printbox{--cs-ink:var(--cs-print-ink);--cs-hair:rgba(0,0,0,.12);--cs-faint:#6b6158}
.csw-bigt{font-family:var(--cs-display);font-size:24px;line-height:1;font-weight:700;letter-spacing:.01em}
.csw-tile{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:8px;flex:none;box-shadow:0 0 0 1px var(--cs-hair),0 6px 14px rgba(0,0,0,.35)}
.csw-mini{display:flex;gap:5px}
.csw-mini i{width:28px;height:22px;border-radius:2px;border:1.5px solid var(--cs-edge);font-style:normal;font-size:12px;display:grid;place-items:center;font-family:var(--cs-mono);color:var(--cs-ink)}
.csw-centre{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:safe center;text-align:center;gap:12px;min-height:0;padding:14px 8px 8px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
.csw-centre[data-premiere="true"]{overflow:visible}
.csw-composer{width:min(560px,100%);border-radius:10px;border:1px solid var(--cs-hair);background:color-mix(in srgb,var(--cs-paper) 88%,transparent);padding:12px;text-align:left;box-shadow:0 18px 40px -18px rgba(0,0,0,.7)}
.csw-composer:focus-within{border-color:color-mix(in srgb,var(--cs-safe) 55%,transparent)}
.csw-composer textarea{width:100%;min-height:64px;max-height:140px;resize:none;border:0;outline:0;background:transparent;font-size:16px;line-height:1.55;color:var(--cs-ink)}
.csw-composer textarea::placeholder{color:var(--cs-faint)}
.csw-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 18px;border-radius:6px;font-weight:650;font-size:15px;color:#fff;
  background:linear-gradient(180deg,color-mix(in srgb,var(--cs-safe) 88%,#fff) 0%,var(--cs-safe) 60%,color-mix(in srgb,var(--cs-safe) 80%,#000) 100%);box-shadow:0 8px 24px -8px var(--cs-safe),inset 0 1px 0 rgba(255,255,255,.25)}
.csw-btn:hover{filter:brightness(1.08)}.csw-btn:disabled{opacity:.45;cursor:not-allowed;filter:none;box-shadow:none}
.csw-btn .csw-kbd{color:#fff;border-color:rgba(255,255,255,.35)}
.csw-ghost{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:6px;border:1px solid var(--cs-hair);font-size:14px;color:var(--cs-ink)}
.csw-ghost:hover{background:var(--cs-hair)}.csw-ghost:disabled{opacity:.45;cursor:not-allowed}
.csw-link{font-size:14px;color:var(--cs-dim);padding:4px 8px;border-radius:4px}.csw-link:hover{color:var(--cs-ink);background:var(--cs-hair)}
.csw-slate{width:min(480px,100%);border-radius:8px;overflow:hidden;border:1px solid var(--cs-hair);background:#0b0908;color:#f2ebe0;text-align:left;box-shadow:0 30px 60px -20px rgba(0,0,0,.8)}
[data-theme^="light"] .csw-slate{background:#1c1713}
.csw-clap{height:28px;background:repeating-linear-gradient(-55deg,#f2ebe0 0 18px,#0b0908 18px 36px);transform-origin:0 100%}
.csw-slate dl{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;margin:0;padding:10px 16px 12px;gap:6px 12px;align-items:baseline}
.csw-slate dt{font-family:var(--cs-mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a89c8e}
.csw-slate dd{margin:0;font-size:15px;line-height:1.45}
.csw-tc{font-family:var(--cs-mono);font-size:30px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:#ffcf8a}
.csw-stamp{display:inline-block;font-family:var(--cs-display);font-size:22px;font-weight:800;letter-spacing:.14em;padding:4px 14px;border:3px solid currentColor;border-radius:4px}
.csw-loupe{position:absolute;inset:6px;z-index:20;display:flex;flex-direction:column;border-radius:10px;background:var(--cs-paper);box-shadow:0 0 0 1px var(--cs-mark),0 40px 90px -30px rgba(0,0,0,.85);overflow:hidden}
.csw-loupe-h{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--cs-hair);background:linear-gradient(90deg,var(--cs-film),color-mix(in srgb,var(--cs-film) 60%,transparent))}
.csw-loupe-h .csw-edge{color:#f0a55a}
.csw-loupe-b{flex:1;min-height:0;overflow:auto;padding:18px 22px}
.csw-opt{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:8px 12px;border-radius:6px;border:1px solid var(--cs-hair);text-align:left;font-size:15px;color:var(--cs-ink)}
.csw-opt:hover{border-color:color-mix(in srgb,var(--cs-safe) 50%,transparent);background:var(--cs-safe-soft)}
.csw-opt .csw-kbd{min-width:24px;text-align:center}
.csw-input{height:42px;border-radius:6px;border:1px solid var(--cs-hair);background:transparent;padding:0 12px;outline:0;color:var(--cs-ink);font-size:15px;flex:1}
.csw-input:focus{border-color:color-mix(in srgb,var(--cs-safe) 55%,transparent)}
.csw-area{width:100%;min-height:220px;border-radius:6px;border:1px solid var(--cs-hair);background:transparent;padding:12px;line-height:1.6;outline:0;resize:vertical;color:var(--cs-ink);font-size:15px}
.csw-rail{position:relative;display:flex;align-items:center;gap:14px;padding:4px 18px;height:66px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.25))}
.csw-strip{position:relative;flex:1;height:34px;border-radius:2px;background:var(--cs-film);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
.csw-strip::before,.csw-strip::after{content:'';position:absolute;left:4px;right:4px;height:5px;background:repeating-linear-gradient(90deg,rgba(255,236,210,.55) 0 5px,transparent 5px 11px);border-radius:1px}
.csw-strip::before{top:3px}.csw-strip::after{bottom:3px}
.csw-frames{position:absolute;left:4px;right:4px;top:10px;bottom:10px;display:flex;gap:2px}
.csw-frames i{flex:1;border-radius:1px;background:rgba(255,236,210,.06)}
.csw-frames i[data-k="model"]{background:linear-gradient(180deg,#ffcf8a,#e08a3c)}
.csw-frames i[data-k="you"]{background:linear-gradient(180deg,#a7f0e2,#3fb3a0)}
.csw-frames i[data-k="test"]{background:linear-gradient(180deg,#d9c8ff,#8f76d8)}
.csw-window{position:absolute;top:-9px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--cs-amber) 55%,transparent)}
.csw-head{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--cs-safe);box-shadow:0 0 12px var(--cs-safe)}
.csw-acts{display:flex;gap:10px;flex-wrap:nowrap;overflow:hidden}
.csw-acts span{font-family:var(--cs-mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--cs-faint);white-space:nowrap}
.csw-acts span[data-on="true"]{color:var(--cs-amber)}
.csw-acts span[data-done="true"]{color:var(--cs-dim)}
.csw-poster-title{font-family:var(--cs-display);font-weight:800;font-size:clamp(44px,6vw,76px);line-height:.95;letter-spacing:-.01em;text-transform:uppercase}
.csw-beam{position:absolute;left:50%;top:-10%;width:130%;height:120%;transform:translateX(-50%);pointer-events:none;
  background:conic-gradient(from 180deg at 50% 0%,transparent 160deg,rgba(255,214,150,.16) 172deg,rgba(255,230,190,.28) 180deg,rgba(255,214,150,.16) 188deg,transparent 200deg)}
[data-theme^="light"] .csw-beam{background:conic-gradient(from 180deg at 50% 0%,transparent 160deg,rgba(195,50,27,.07) 172deg,rgba(195,50,27,.12) 180deg,rgba(195,50,27,.07) 188deg,transparent 200deg)}
`;
