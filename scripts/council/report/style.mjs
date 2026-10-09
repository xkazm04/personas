// One theme, on purpose: Personas-adjacent midnight blues with a cyan and a
// violet accent, sized for an hour of reading. No light variant and no print
// sheet (both cut by the owner), no external fonts (the file must open with no
// network), so the stacks lean on what Windows and macOS ship.
export const CSS = `
:root{
  --bg:#0a1222; --bg-2:#0c1629; --panel:#0f1b31; --panel-2:#13223c; --raise:#182a48;
  --rule:#22354f; --rule-2:#1a2a43;
  --ink:#e8eef8; --ink-2:#b6c3d8; --ink-3:#8796b0;
  --cyan:#5ad4ec; --cyan-2:#2fb3cf; --cyan-bg:rgba(90,212,236,.09);
  --violet:#ab95ff; --violet-bg:rgba(171,149,255,.10);
  --red:#ff7d8c; --red-bg:rgba(255,125,140,.09);
  --amber:#f4b862; --amber-bg:rgba(244,184,98,.09);
  --green:#63e2aa; --green-bg:rgba(99,226,170,.09);
  --slate:#8fb2e6;
  --sans:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --mono:"Cascadia Mono","Cascadia Code",ui-monospace,Consolas,"SFMono-Regular",Menlo,monospace;
  --maxw:74ch;
  color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth; scroll-padding-top:76px; background:var(--bg)}
body{margin:0; background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:17px; line-height:1.65; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility}
h1,h2,h3,h4{line-height:1.2; margin:0}
h1,h2{font-family:var(--serif); font-weight:600; letter-spacing:-.01em}
a{color:var(--cyan); text-decoration-color:rgba(90,212,236,.35); text-underline-offset:3px}
a:hover{text-decoration-color:var(--cyan)}
code{font-family:var(--mono); font-size:.84em}
:focus-visible{outline:2px solid var(--cyan); outline-offset:2px; border-radius:4px}
.skip{position:absolute; left:-999px; top:8px; background:var(--panel-2); color:var(--ink); padding:8px 12px; border-radius:6px; z-index:60}
.skip:focus{left:12px}
.vh{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}

/* ------------------------------------------------------------- frame */
.top{position:sticky; top:0; z-index:40; background:rgba(10,18,34,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--rule)}
.top-in{display:flex; align-items:center; gap:20px; padding:11px 26px; max-width:1560px; margin:0 auto}
.brand{font-family:var(--serif); font-size:18px; white-space:nowrap; color:var(--ink-2)}
.brand b{color:var(--cyan); font-weight:600}
.crumb{flex:1; min-width:0; font-family:var(--mono); font-size:12.5px; color:var(--ink-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.crumb #crumb{color:var(--ink-2)}
.crumb-sep{opacity:.5; margin:0 4px}
.top-id{font-family:var(--mono); font-size:12.5px; color:var(--ink-2); white-space:nowrap; display:flex; align-items:center; gap:8px}
.top-id code{color:var(--ink); font-size:1em}
.o-dot{width:9px; height:9px; border-radius:50%; background:var(--ink-3); display:inline-block}
.o-dot.o-ready{background:var(--cyan); box-shadow:0 0 10px var(--cyan)}
.o-dot.o-fail{background:var(--red); box-shadow:0 0 10px var(--red)}
.o-dot.o-incomplete,.o-dot.o-stalled{background:var(--amber)}
.prog{position:absolute; left:0; bottom:-1px; height:2px; width:0; background:linear-gradient(90deg,var(--cyan),var(--violet))}
.wrap{display:grid; grid-template-columns:286px minmax(0,1fr); max-width:1560px; margin:0 auto}

/* ------------------------------------------------------------- rail */
.rail{position:sticky; top:49px; align-self:start; max-height:calc(100vh - 49px); overflow-y:auto; padding:22px 16px 40px 22px; border-right:1px solid var(--rule); font-size:14.5px; scrollbar-width:thin; scrollbar-color:var(--rule) transparent}
.rail-head{padding:4px 10px 6px; display:flex; flex-direction:column; gap:2px}
.rail-k{font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--cyan)}
.rail-t{font-family:var(--serif); font-size:17px; color:var(--ink); line-height:1.3}
.rail .grp{margin:20px 0 6px; padding-left:10px; font-family:var(--mono); font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3)}
.rail ol{list-style:none; margin:0; padding:0}
.rail li{margin:1px 0}
.rail a{display:flex; align-items:baseline; gap:9px; padding:6px 10px; border-radius:7px; text-decoration:none; color:var(--ink-2); border-left:2px solid transparent; transition:background .14s,color .14s,border-color .14s}
.rail a:hover{background:var(--rule-2); color:var(--ink)}
.rail a[aria-current]{background:var(--panel-2); color:var(--ink); border-left-color:var(--cyan); font-weight:600}
.rail .num{font-family:var(--mono); font-size:11px; color:var(--ink-3); flex:none; font-weight:400}
.rail .lbl{flex:1; min-width:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4}
.rail .cnt{font-family:var(--mono); font-size:11px; color:var(--bg); background:var(--amber); border-radius:999px; padding:0 6px; margin-left:4px; font-weight:600}
.rail .members a{align-items:center}
.rail .mini{flex:none; width:54px; height:5px; border-radius:3px; background:var(--rule); overflow:hidden}
.rail .mini i{display:block; height:100%; background:linear-gradient(90deg,var(--cyan-2),var(--cyan))}
.rail .mini.u{background:repeating-linear-gradient(135deg,var(--rule) 0 3px,transparent 3px 6px)}
.rail .mini-n{flex:none; width:30px; text-align:right; font-family:var(--mono); font-size:11.5px; color:var(--ink-3); font-weight:400}
.rail-foot{margin:26px 10px 0; padding-top:14px; border-top:1px solid var(--rule); font-size:12.5px; color:var(--ink-3); line-height:1.5}

main{padding:28px 48px 120px; min-width:0}
main>section{padding-top:64px; scroll-margin-top:60px}
main>section.hero{padding-top:0}
.eyebrow{font-family:var(--mono); font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--cyan); margin:0 0 10px}
main h2{font-size:32px; margin:0 0 22px; color:var(--ink)}
p,ul,ol{max-width:var(--maxw)}
p{margin:0 0 1em}
.quiet{color:var(--ink-3)}
.figcap{font-size:14px; color:var(--ink-3); margin-top:12px; max-width:90ch}
code.code,code.sha{background:var(--rule-2); border:1px solid var(--rule); border-radius:4px; padding:0 4px; color:var(--ink)}
code.cite,.ref{font-family:var(--mono); color:var(--cyan); background:var(--cyan-bg); border:1px solid rgba(90,212,236,.32); border-radius:4px; padding:0 4px; font-size:.8em; overflow-wrap:anywhere}

/* ------------------------------------------------------------- hero */
.hero-in{position:relative; overflow:hidden; border:1px solid rgba(90,212,236,.18); border-radius:20px; padding:34px 38px 26px;
  background:
    radial-gradient(900px 380px at 88% -10%, rgba(171,149,255,.16), transparent 60%),
    radial-gradient(700px 300px at 10% 0%, rgba(90,212,236,.10), transparent 60%),
    linear-gradient(165deg,#10234a 0%,#0c1934 52%,#0a1427 100%);
  box-shadow:0 30px 60px -30px rgba(0,0,0,.7)}
.hero-in::before{content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image:linear-gradient(rgba(140,170,220,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(140,170,220,.05) 1px,transparent 1px);
  background-size:32px 32px; mask-image:linear-gradient(180deg,#000,transparent 70%)}
.hero-in>*{position:relative}
.hero h1{font-size:clamp(34px,3.4vw,48px); line-height:1.08; max-width:34ch}
.slugline{margin:10px 0 0; font-size:13.5px; color:var(--ink-3); display:flex; gap:10px; align-items:center}
.slugline span{font-family:var(--mono); font-size:11.5px; letter-spacing:.1em; text-transform:uppercase}
.hero .sub{font-size:18px; color:var(--ink-2); max-width:78ch; margin:14px 0 0; line-height:1.55}
.tiles{display:grid; grid-template-columns:1.35fr 1fr 1fr 1fr; gap:12px; margin-top:24px}
.tile{border-radius:14px; border:1px solid var(--rule); background:rgba(10,18,34,.55); padding:14px 18px; display:flex; flex-direction:column; gap:4px; color:inherit; text-decoration:none; min-width:0}
.o-word{font-family:var(--serif); font-size:56px; line-height:1; margin:4px 0 6px; letter-spacing:-.01em}
.o-word.long{font-size:42px; margin:12px 0 10px}
.o-mean{font-size:14px; color:var(--ink-2); line-height:1.45}
.outcome.o-ready{border-color:rgba(90,212,236,.45); box-shadow:inset 0 0 0 1px rgba(90,212,236,.08), 0 0 40px -20px var(--cyan)}
.outcome.o-ready .o-word{color:var(--cyan)}
.outcome.o-fail{border-color:rgba(255,125,140,.5); box-shadow:0 0 40px -20px var(--red)}
.outcome.o-fail .o-word{color:var(--red)}
.outcome.o-incomplete .o-word,.outcome.o-stalled .o-word{color:var(--amber)}
.outcome.o-incomplete,.outcome.o-stalled{border-color:rgba(244,184,98,.45)}
.lite-note{margin:10px 0 0; font-size:13px; color:var(--violet); border-top:1px dashed var(--rule); padding-top:8px}
.tile-must:hover{border-color:var(--amber)}
.tile-must .k-n{color:var(--amber); font-size:56px}
.k-l{font-family:var(--mono); font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3)}
.k-n{font-family:var(--serif); font-size:44px; line-height:1.05; font-variant-numeric:tabular-nums; color:var(--ink)}
.k-c{font-size:13px; color:var(--ink-3); line-height:1.45}
.gauge{position:relative; height:9px; border-radius:5px; background:var(--rule); margin:10px 0 12px}
.gauge i{position:absolute; left:0; top:0; bottom:0; border-radius:5px; background:linear-gradient(90deg,var(--cyan-2),var(--violet))}
.gauge b{position:absolute; top:-5px; bottom:-5px; width:2px; margin-left:-1px; background:var(--ink)}
.gauge b em{position:absolute; top:13px; left:50%; transform:translateX(-50%); font-style:normal; font-family:var(--mono); font-size:10.5px; color:var(--ink-2); font-weight:400}
.ring-row{display:flex; align-items:center; gap:14px; margin:4px 0 2px}
.ring-key{list-style:none; margin:0; padding:0; font-size:12.5px; line-height:1.6; color:var(--ink-2); white-space:nowrap; min-width:0}
.ring-key .off{text-decoration:line-through; text-decoration-color:rgba(135,150,176,.5)}
.ring-key i{display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:7px; background:var(--cyan)}
.ring-key small{font-family:var(--mono); font-size:10.5px; color:var(--ink-3)}
.ring-key .off{color:var(--ink-3)}
.ring-key .off i{background:#2a3c5a}
.ring{width:92px; height:92px; flex:none}
.ring-bg{fill:none; stroke:rgba(255,255,255,.03); stroke-width:12}
.seg{fill:none; stroke-width:12}
.seg.on{stroke:var(--cyan)}
.seg.off{stroke:#2a3c5a}
.ring-floor{stroke:var(--amber); stroke-width:2.5; stroke-linecap:round}
.ring-n{font-family:var(--serif); font-size:24px; fill:var(--ink)}
.ring-l{font-family:var(--mono); font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; fill:var(--ink-3)}

/* ------------------------------------------------------------- scoreboard */
.scoreboard{margin:12px 0 0; border-radius:14px; border:1px solid var(--rule); background:rgba(10,18,34,.55); padding:12px 20px 10px; display:flex; flex-direction:column}
.sb-head,.sb-row{display:grid; grid-template-columns:150px minmax(0,1fr) 150px 92px; gap:22px; align-items:center}
.sb-head{font-family:var(--mono); font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); padding:4px 0 8px; border-bottom:1px solid var(--rule)}
.sb-sevh{display:flex; gap:5px}
.sb-sevh b{width:24px; text-align:center; font-weight:400; letter-spacing:0; font-size:9.5px}
.h-high{color:var(--red)} .h-med{color:var(--amber)} .h-low{color:var(--slate)}
.sb-scale{position:relative; height:14px}
.sb-scale span{position:absolute; transform:translateX(-50%); letter-spacing:0}
.sb-scale span:first-child{transform:none}
.sb-scale span:last-of-type{transform:translateX(-100%)}
.sb-scale em{position:absolute; top:-2px; transform:translateX(-50%); font-style:normal; color:var(--ink); background:var(--panel-2); border:1px solid var(--rule); border-radius:4px; padding:0 5px; letter-spacing:.04em}
.sb-row{padding:7px 0; color:inherit; text-decoration:none; border-bottom:1px solid var(--rule-2); flex:1}
a.sb-row:hover .sb-name b{color:var(--cyan)}
.sb-row:last-of-type{border-bottom:0}
.sb-name{display:flex; flex-direction:column; line-height:1.25}
.sb-name b{font-size:16px; font-weight:600}
.sb-name small{font-family:var(--mono); font-size:11px; color:var(--ink-3); margin-top:2px}
.sb-score{font-family:var(--mono); font-size:19px; font-variant-numeric:tabular-nums; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap}
.is-unm .sb-score{color:var(--ink-3)}
.sb-sev{display:flex; gap:5px; align-items:center}
.sb-sev .none{font-size:12px; color:var(--ink-3)}
.sb-overall{border-top:1px solid var(--ink-3); margin-top:2px; padding-top:12px}
.sb-overall .sb-score{color:var(--ink); font-size:20px}
.scoreboard figcaption{font-size:12.5px; color:var(--ink-3); margin-top:8px; padding-top:8px; border-top:1px solid var(--rule-2); line-height:1.45; display:flex; flex-wrap:wrap; align-items:center; column-gap:6px; row-gap:4px}
.lg{display:inline-block; width:16px; height:12px; margin-left:12px; vertical-align:middle}
.lg:first-child{margin-left:0}
.lg-thr{border-left:1.5px dashed rgba(232,238,248,.7); width:2px; margin-right:2px}
.lg-bind{border-left:2px solid var(--amber); width:2px}
.lg-adv{border-left:2px dotted var(--amber); width:2px}
.lg-unm{border-radius:3px; background:repeating-linear-gradient(135deg,rgba(135,150,176,.35) 0 3px,transparent 3px 6px); box-shadow:inset 0 0 0 1px var(--rule); width:22px}
.track{position:relative; height:12px; border-radius:6px; background:rgba(255,255,255,.05); box-shadow:inset 0 0 0 1px var(--rule)}
.track.big{height:14px; width:100%}
.track.empty{background:repeating-linear-gradient(135deg,rgba(135,150,176,.13) 0 5px,transparent 5px 10px); box-shadow:inset 0 0 0 1px var(--rule)}
.track .fill{position:absolute; left:0; top:0; bottom:0; border-radius:6px; background:linear-gradient(90deg,var(--cyan-2),var(--cyan))}
.track .fill.hit{background:linear-gradient(90deg,#c74a5c,var(--red))}
.track .fill.adv-hit{background:linear-gradient(90deg,#c48a35,var(--amber))}
.sb-overall .track .fill{background:linear-gradient(90deg,var(--cyan-2),var(--violet))}
.track .unm{position:absolute; left:8px; top:50%; transform:translateY(-50%); font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3)}
.track .floor{position:absolute; top:-5px; bottom:-5px; width:0; border-left:2px solid var(--amber)}
.track .floor.advisory{border-left:2px dotted rgba(244,184,98,.85)}
.track .floor b{display:none}
.track.big .floor b{display:block; position:absolute; top:-20px; left:0; transform:translateX(-50%); white-space:nowrap; font-family:var(--mono); font-size:10.5px; font-weight:400; color:var(--amber)}
.track .thr{position:absolute; top:-10px; bottom:-10px; width:0; border-left:1.5px dashed rgba(232,238,248,.55)}
.track .thr b{position:absolute; top:-15px; left:0; transform:translateX(-50%); font-family:var(--mono); font-size:10.5px; font-weight:400; color:var(--ink-2)}
.sv{font-family:var(--mono); font-size:11.5px; font-weight:600; min-width:24px; height:20px; padding:0 6px; border-radius:5px; display:inline-flex; align-items:center; justify-content:center; font-variant-numeric:tabular-nums}
.sv-high{background:var(--red-bg); color:var(--red); box-shadow:inset 0 0 0 1px rgba(255,125,140,.45)}
.sv-med{background:var(--amber-bg); color:var(--amber); box-shadow:inset 0 0 0 1px rgba(244,184,98,.45)}
.sv-low{background:rgba(143,178,230,.09); color:var(--slate); box-shadow:inset 0 0 0 1px rgba(143,178,230,.4)}
.sb-head .sv-high{background:var(--red)} .sb-head .sv-med{background:var(--amber)} .sb-head .sv-low{background:var(--slate)}
.sv.zero{opacity:.32}
.conf{font-family:var(--mono); font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; padding:1px 6px; border-radius:999px; border:1px solid currentColor; font-weight:400}
.c-high{color:var(--green)} .c-med{color:var(--ink-2)} .c-low{color:var(--amber)}
.delta{font-family:var(--mono); font-size:11.5px; color:var(--ink-3)}
.delta.up{color:var(--green)} .delta.down{color:var(--red)}

.trust{display:flex; gap:12px; align-items:flex-start; margin-top:18px; border-radius:12px; padding:12px 16px; font-size:15px; line-height:1.5}
.trust small{display:block; color:var(--ink-3); font-size:12.5px; margin-top:2px}
.tr-warn{background:var(--violet-bg); border:1px solid rgba(171,149,255,.35); color:var(--ink)}
.tr-ok{background:var(--green-bg); border:1px solid rgba(99,226,170,.35)}
.tr-i{flex:none; width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-weight:700; font-size:14px; background:var(--violet); color:var(--bg); margin-top:1px}
.tr-ok .tr-i{background:var(--green)}
.ident{display:grid; grid-template-columns:minmax(0,2.4fr) repeat(6,minmax(0,1fr)); gap:1px; margin:14px 0 0; border-radius:12px; overflow:hidden; border:1px solid var(--rule); background:var(--rule)}
.ident>div{background:rgba(10,18,34,.82); padding:9px 12px; min-width:0}
.ident dt{font-family:var(--mono); font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3)}
.ident dd{margin:2px 0 0; font-size:13.5px; color:var(--ink); overflow-wrap:anywhere; line-height:1.4}
.ident dd small{color:var(--ink-3)}
.ident code{font-size:12.5px}
.no-decision{margin:14px 0 0; font-size:13px; color:var(--ink-3); max-width:none}

/* ------------------------------------------------------------- must address */
.musts{list-style:none; padding:0; margin:0; max-width:1080px; display:flex; flex-direction:column; gap:14px}
.must{display:grid; grid-template-columns:56px minmax(0,1fr); border-radius:14px; border:1px solid var(--rule); background:var(--panel); overflow:hidden}
.must-n{font-family:var(--serif); font-size:30px; display:grid; place-items:center; color:var(--bg); background:var(--amber)}
.must-body{padding:14px 20px 14px}
.must-meta{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px}
.mtag{font-family:var(--mono); font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--violet); background:var(--violet-bg); border:1px solid rgba(171,149,255,.4); border-radius:999px; padding:1px 9px; text-decoration:none}
.mkind{font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3)}
.must-claim{font-family:var(--serif); font-size:21px; line-height:1.42; margin:0; color:var(--ink); max-width:none}
.must-claim code{font-size:.72em}
.must-fig{display:flex; align-items:center; gap:16px; margin:26px 0 4px; max-width:620px}
.must-fig .track{flex:1}
.must-fig>span{font-family:var(--mono); font-size:12px; color:var(--ink-3); white-space:nowrap}
.must.k-floor .must-n{background:var(--red)}
.must.k-floor{border-color:rgba(255,125,140,.45)}
.must.k-unm{background:transparent; border-style:dashed}
.must.k-unm .must-n{background:var(--rule); color:var(--ink-3)}
.must.k-unm .must-claim{font-family:var(--sans); font-size:16px; color:var(--ink-2)}
.must.k-none{grid-template-columns:1fr}
.fid{font-family:var(--mono); font-size:12px; color:var(--ink-2); background:var(--rule-2); border:1px solid var(--rule); border-radius:4px; padding:1px 6px; text-decoration:none}
a.fid:hover{border-color:var(--cyan); color:var(--cyan)}
.rec{font-family:var(--mono); font-size:11px; color:var(--amber)}
.sev-tag{font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; padding:1px 8px; border-radius:999px; font-weight:600}
.sev-tag.s-high{color:var(--bg); background:var(--red)}
.sev-tag.s-med{color:var(--bg); background:var(--amber)}
.sev-tag.s-low{color:var(--bg); background:var(--slate)}
.sev-tag.s-other{color:var(--ink); background:var(--rule)}

/* ------------------------------------------------------------- rounds + scenarios */
.rounds{list-style:none; padding:0; margin:0; display:flex; gap:0; max-width:1080px; position:relative}
.rnd{flex:1; min-width:0; position:relative; padding:16px 18px; margin-right:26px; border-radius:14px; border:1px solid var(--rule); background:var(--panel); display:flex; flex-direction:column; gap:4px}
.rnd:last-child{margin-right:0}
.rnd:not(:last-child)::after{content:"→"; position:absolute; right:-21px; top:50%; transform:translateY(-50%); color:var(--ink-3); font-size:16px}
.rnd.cur{border-color:var(--cyan); box-shadow:0 0 0 1px rgba(90,212,236,.25), 0 10px 30px -18px var(--cyan)}
.r-no{font-family:var(--mono); font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3)}
.r-out{align-self:flex-start; font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; padding:1px 8px; border-radius:999px; border:1px solid currentColor; color:var(--ink-3)}
.r-out.o-ready{color:var(--cyan)} .r-out.o-fail{color:var(--red)} .r-out.o-incomplete,.r-out.o-stalled{color:var(--amber)}
.r-n{font-family:var(--serif); font-size:34px; line-height:1.1; font-variant-numeric:tabular-nums}
.r-c{font-size:12.5px; color:var(--ink-3)}
.r-bars{display:flex; align-items:flex-end; gap:5px; height:44px; margin:8px 0 6px; border-bottom:1px solid var(--rule)}
.r-bars i{flex:1; border-radius:3px 3px 0 0; background:linear-gradient(180deg,var(--cyan),var(--cyan-2)); position:relative}
.r-bars i.u{background:transparent; border:1px dashed var(--rule); border-bottom:0}
.rnd a,.rnd .you{font-size:13px}
.rnd .you{color:var(--cyan); font-family:var(--mono); font-size:11.5px; letter-spacing:.06em; text-transform:uppercase}
.envelope{display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px}
.env{font-size:13px; color:var(--ink-2); border:1px solid var(--rule); border-radius:999px; padding:3px 12px; background:var(--panel)}
.env b{font-family:var(--mono); color:var(--ink)}
.pill{font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; padding:1px 8px; border-radius:999px; border:1px solid currentColor; color:var(--ink-3); white-space:nowrap}
.pill.p-measured{color:var(--cyan)}
.ladder{display:inline-flex; gap:3px; vertical-align:middle}
.ladder i{width:14px; height:6px; border-radius:2px; background:var(--rule)}
.ladder i.on{background:var(--violet)}
.scen .sc-sum{font-size:14px; color:var(--ink-2); min-width:260px}
.scen .sc-sum p{margin:0}

/* ------------------------------------------------------------- members */
.member{border-top:1px solid var(--rule); margin-top:40px}
.m-head{display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,440px); gap:30px; align-items:end; margin-bottom:24px}
.m-head h2{font-size:40px; margin:0}
.m-fig{display:flex; flex-direction:column; gap:10px}
.m-n{font-family:var(--serif); font-size:58px; line-height:.95; font-variant-numeric:tabular-nums; color:var(--cyan)}
.m-n.unm{font-size:30px; color:var(--ink-3); font-style:italic}
.m-tags{display:flex; gap:10px; align-items:center; flex-wrap:wrap}
.m-floor{font-family:var(--mono); font-size:11.5px; color:var(--amber)}
.m-fig .track{margin-top:16px}
.m-block{margin:26px 0 0; max-width:1080px}
.m-sub{font-family:var(--mono); font-size:12px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3); font-weight:400; margin:0 0 12px; display:flex; align-items:center; gap:8px}
.m-sub span{color:var(--ink); background:var(--rule-2); border-radius:999px; padding:0 8px; font-size:11px}
.sevbar{display:flex; height:24px; border-radius:6px; overflow:hidden; margin:0 0 16px; gap:2px; max-width:640px}
.sevbar span{display:flex; align-items:center; padding:0 9px; font-family:var(--mono); font-size:11px; font-weight:600; color:var(--bg); white-space:nowrap; overflow:hidden; min-width:0}
.sb-high{background:var(--red)} .sb-med{background:var(--amber)} .sb-low{background:var(--slate)} .sb-other{background:var(--rule); color:var(--ink)!important}
.findings{list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px; max-width:none}
.finding{border:1px solid var(--rule); border-left:4px solid var(--slate); border-radius:10px; background:var(--panel); padding:13px 18px 12px; transition:box-shadow .3s}
.finding.s-high{border-left-color:var(--red)}
.finding.s-med{border-left-color:var(--amber)}
.finding.s-other{border-left-color:var(--rule)}
.finding.flash{box-shadow:0 0 0 2px var(--cyan)}
.f-top{display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:6px}
.f-title{font-family:var(--sans); font-size:17px; font-weight:600; line-height:1.45; color:var(--ink); max-width:92ch}
.f-title code{font-weight:400}
.f-detail{margin-top:8px}
.f-detail summary{cursor:pointer; font-size:13.5px; color:var(--ink-3); list-style:none; display:inline-flex; align-items:center; gap:6px}
.f-detail summary::-webkit-details-marker{display:none}
.f-detail summary::before{content:"▸"; color:var(--cyan); transition:transform .15s}
.f-detail[open] summary::before{transform:rotate(90deg)}
.f-detail summary:hover{color:var(--ink-2)}
.f-body{margin-top:10px; padding:12px 16px; border-radius:8px; background:var(--bg-2); border:1px solid var(--rule-2); font-size:15px; color:var(--ink-2); line-height:1.6}
.f-body p{max-width:96ch; margin:0 0 .7em}
.f-body p:last-child{margin:0}
.techs{list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:8px; max-width:none}
.techs li{display:flex; align-items:center; gap:6px; font-family:var(--mono); font-size:12px; border:1px solid var(--rule); background:var(--panel); border-radius:8px; padding:5px 10px}
.t-sub{color:var(--violet)} .t-sep{color:var(--ink-3)} .t-tech{color:var(--ink)}
.t-proof{color:var(--ink-3); border-left:1px solid var(--rule); padding-left:7px; margin-left:2px}
.evidence{list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; max-width:none}
.ev{display:flex; flex-direction:column; gap:5px; border:1px solid var(--rule-2); border-radius:8px; padding:9px 12px; background:var(--bg-2); min-width:0}
.ev .ref{align-self:flex-start; max-width:100%}
.ev-k{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3)}
.ev-k.k-metric{color:var(--green)} .ev-k.k-url{color:var(--violet)}
.ev-c{font-size:13.5px; color:var(--ink-2); line-height:1.5}
details.more{margin-top:10px}
details.more>summary{cursor:pointer; font-size:13.5px; color:var(--cyan); margin-bottom:10px}
.callout{border-left:3px solid var(--violet); background:var(--violet-bg); padding:14px 18px; border-radius:0 12px 12px 0; margin:0 0 18px; max-width:1080px}
.callout h3{font-size:15px; font-family:var(--sans); margin:0 0 6px}
.callout p{margin:0 0 .5em; max-width:96ch}
.callout p:last-child{margin:0}
.callout.bad{border-color:var(--red); background:var(--red-bg)}
.callout.dim{border-color:var(--ink-3); background:rgba(135,150,176,.07)}
.callout.dim p{color:var(--ink-2)}

/* ------------------------------------------------------------- the written report */
.prose{max-width:1080px}
.prose h3{font-size:21px; font-family:var(--serif); margin:1.8em 0 .6em; font-weight:600}
.prose h4,.prose h5{font-size:16px; margin:1.6em 0 .5em}
.prose ul,.prose ol{padding-left:1.3em}
.prose li{margin:.35em 0}
.prose li::marker{color:var(--ink-3)}
.prose li>ul,.prose li>ol{margin:.3em 0}
.prose ol.numbered{list-style:none; padding:0; counter-reset:n}
.prose ol.numbered>li{counter-increment:n; position:relative; padding:12px 16px 12px 54px; margin:10px 0; border:1px solid var(--rule); border-radius:10px; background:var(--panel)}
.prose ol.numbered>li::before{content:counter(n); position:absolute; left:14px; top:11px; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-family:var(--mono); font-size:12.5px; color:var(--bg); background:var(--cyan)}
.prose ol.numbered[start]>li::before{content:counter(n)}
.prose ol.numbered>li>ul{margin-top:.4em}
.prose p.lede{font-family:var(--serif); font-size:20px; line-height:1.48; color:var(--ink); border-left:3px solid var(--cyan); padding:2px 0 2px 18px; margin:6px 0 22px; max-width:80ch}
.prose p.lede strong{color:var(--cyan); font-weight:600}
.prose strong{color:var(--ink); font-weight:600}
.prose blockquote.quote{margin:20px 0; padding:12px 20px; border-left:3px solid var(--violet); background:var(--violet-bg); border-radius:0 10px 10px 0; font-family:var(--serif); font-size:18.5px; color:var(--ink); max-width:76ch}
.prose blockquote.quote p:last-child{margin:0}
.table-wrap{overflow-x:auto; margin:18px 0 24px; border:1px solid var(--rule); border-radius:12px; background:var(--panel); max-width:1080px}
table{border-collapse:collapse; width:100%; font-size:14.5px}
th,td{text-align:left; padding:9px 14px; border-bottom:1px solid var(--rule-2); vertical-align:top}
th{font-family:var(--mono); font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-3); font-weight:400; background:var(--bg-2); border-bottom:1px solid var(--rule); white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:rgba(255,255,255,.02)}
td code.code{font-size:.82em}
td.t-num{font-family:var(--mono); font-variant-numeric:tabular-nums; white-space:nowrap; color:var(--ink)}
td.t-dim{color:var(--ink-3)}
td.t-good{color:var(--green)}
td.t-bad{color:var(--red)}
table.kv td.key{width:200px; font-family:var(--mono); font-size:11.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-3); background:var(--bg-2)}
pre.block{background:var(--bg-2); border:1px solid var(--rule); border-radius:10px; padding:14px 18px; overflow-x:auto; font-family:var(--mono); font-size:13.5px; line-height:1.6; max-width:1080px; position:relative}
pre.block .lang{position:absolute; right:10px; top:6px; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3)}
hr.rule{border:0; border-top:1px solid var(--rule); margin:28px 0}
.check{display:inline-grid; place-items:center; width:16px; height:16px; border:1px solid var(--ink-3); border-radius:4px; margin-right:8px; font-size:11px; vertical-align:-2px}
.check.on{background:var(--cyan); border-color:var(--cyan); color:var(--bg)}

.foot{margin-top:80px; padding-top:20px; border-top:1px solid var(--rule); font-size:13px; color:var(--ink-3)}
.foot p{max-width:110ch}

@media (max-width:1240px){
  .tiles{grid-template-columns:1fr 1fr}
  .ident{grid-template-columns:repeat(4,minmax(0,1fr))}
  .ident>div:first-child{grid-column:1 / -1}
}
@media (max-width:980px){
  .wrap{grid-template-columns:1fr}
  .rail{position:static; max-height:none; border-right:0; border-bottom:1px solid var(--rule)}
  main{padding:20px 18px 80px}
  .m-head{grid-template-columns:1fr}
  .evidence{grid-template-columns:1fr}
  .rounds{flex-direction:column; gap:12px}
  .rnd{margin-right:0}
  .rnd:not(:last-child)::after{display:none}
  .tiles{grid-template-columns:1fr}
  .hero-in{padding:24px 18px}
  .sb-head,.sb-row{grid-template-columns:90px minmax(0,1fr) 92px; gap:12px}
  .sb-sev,.sb-head>span:last-child{display:none}
}
@media (prefers-reduced-motion:reduce){ html{scroll-behavior:auto} *{transition:none!important} }
`;
