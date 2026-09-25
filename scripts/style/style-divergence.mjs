// style-divergence.mjs - per-module style divergence instrument (spark style-unification, 2026-09-24)
// Instrument for the style-unification campaign (docs/design/style-mastery). Ranks src/features modules by raw-vs-token style usage per 100 LOC.
// Re-derive, never inherit: run it at each gate. CSS weight defaults to 0 (calibrated 2026-09-24 against surfaces the operator rated good).
// node style-divergence.mjs --repo <repo> --out <dir> [--since 30] [--top N] [--csv] [--cssw 0|1]
import { execFileSync as X } from "node:child_process"; import fs from "node:fs";
const A = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const R = A("--repo", process.cwd()), DAYS = +A("--since", 30), OUT = A("--out", null), TOP = +A("--top", 999), rd = f => fs.readFileSync(R + "/" + f, "utf8");
const git = (...a) => X("git", a, { cwd: R, encoding: "utf8", maxBuffer: 3e8 }), NL = "\n";
const tr = git("ls-files", "src/features").split(NL);
const files = tr.filter(f => f.endsWith(".tsx") && !/__tests__|\.test\.|\.spec\.|\.stories\./.test(f)), css = tr.filter(f => f.endsWith(".css"));
function mod(f) { const s = f.split("/").slice(2), [ft, a, b] = s;
  if (s.length === 2) return ft + "/(root)";
  if (ft === "shared") return s.length >= 4 ? "shared/" + a + "/" + b : "shared/" + a + "/(root)";
  if (a.startsWith("sub_")) return ft + "/" + a;
  if (s.length >= 4 && b.startsWith("sub_")) return ft + "/" + a + "/" + b;
  return ft + "/" + a; }
const ctxOf = {}; try { for (const c of JSON.parse(rd("context-map.json")).contexts) for (const p of (c.file_paths || [])) ctxOf[p] = c.name + " [" + c.group + "]"; } catch {}
const PAL = "(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|emerald|cyan|violet|purple|rose|orange|indigo|sky|teal|pink|fuchsia|lime|yellow)";
const M = { rawText: [/\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g, 3], arbText: [/\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g, 2],
  typoOverride: [/\btypo-[a-z-]+[^\x22\x60]*?\btext-(?:xs|sm|base|lg|xl|2xl|3xl|\[\d)/g, 2],
  arbOther: [/\b(?:rounded|shadow|tracking|leading)-\[/g, 1.5], rawRadius: [/\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/g, 1.5], bareRounded: [/(?<![\w-])rounded(?![\w-])/g, 1],
  roundFull: [/\brounded-full\b/g, 0], rawShadow: [/\bshadow-(?:sm|md|lg|xl)\b/g, 2],
  dimText: [/\btext-foreground\/[0-8]\d\b/g, 0.5], mutedFg: [/\btext-muted-foreground\b/g, 1],
  opacityDim: [/\btext-foreground\b(?!\/)[^\x22\x60]*?\bopacity-[1-8]\d\b|\bopacity-[1-8]\d\b[^\x22\x60]*?\btext-foreground\b(?!\/)/g, 0.5],
  rawBW: [/\b(?:text|bg|border|ring)-(?:white|black)\b/g, 1.5], hex: [/(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g, 0.5], rgba: [/\brgba?\(/g, 0.5],
  palText: [new RegExp("[^-\\w]text-" + PAL + "-[0-9]", "g"), 0.3], palFill: [new RegExp("(?:bg|border|ring|from|to|via)-" + PAL + "-[0-9]", "g"), 0.2],
  button: [/<button\b/g, 0.25], overlay: [/\bfixed inset-0\b/g, 3], nativeTitle: [/<[a-z][a-z0-9]*\b[^<>]*?\stitle=[{\x22]/g, 0.5],
  pulseSpin: [/\banimate-(?:pulse|spin)\b/g, 0.75], select: [/<select\b/g, 2], table: [/<table\b/g, 2], tablist: [/role=.tablist/g, 2],
  clipboard: [/navigator\.clipboard/g, 3], toFixed: [/\.toFixed\(/g, 0.5], toLocale: [/toLocaleString\(/g, 0.5], styleObj: [/style=\{\{/g, 0.3],
  phantomTypo: [/\btypo-(?:body-sm|overline|heading-sm|body-strong|heading-md|button|title-sm|heading-xs|display|data-md)\b/g, 3],
  typo: [/\btypo-[a-z]/g, 0], radiusTok: [/\brounded-(?:interactive|input|card|modal)\b/g, 0], elev: [/\bshadow-elevation-/g, 0],
  lazy: [/\blazy\(/g, 0], suspense: [/<Suspense\b/g, 0], routeSkel: [/RouteChunkSkeleton/g, 0], unifiedTable: [/\bUnifiedTable\b/g, 0],
  reveal: [/\bRevealItem\b/g, 0], modCache: [/createModuleCache/g, 0], virt: [/react-virtual|@tanstack\/virtual|useVirtualizer|react-window/g, 0] };
const CSSW = +A("--cssw", 0), CSSRE = /font-size:\s*[\d.]+(?:px|rem)|#[0-9a-fA-F]{3,8}\b|rgba?\(/g;
const IMP = /import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+))\s*from\s*[\x22\x27]@\/features\/shared\/components\//g;
const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const added = new Set(git("log", "--diff-filter=A", "--since=" + since, "--name-only", "--format=", "--", "src/features").split(NL).filter(Boolean));
const mods = {}, coh = { recent: { loc: 0 }, older: { loc: 0 } };
const score = o => (Object.entries(M).reduce((s, [k, [, w]]) => s + w * (o[k] || 0), 0) + CSSW * (o.cssRaw || 0)) * 100 / Math.max(o.loc, 1);
for (const f of files) {
  const src = rd(f), loc = src.split(NL).length, id = mod(f), c = ctxOf[f] || "(unmapped)", h = added.has(f) ? coh.recent : coh.older;
  const m = mods[id] ??= { module: id, files: 0, loc: 0, big: 0, newFiles: 0, cssLines: 0, cssRaw: 0, cx: {}, sh: new Set(), shImp: 0, list: [] };
  m.files++; m.loc += loc; h.loc += loc; if (loc > 200) m.big++; if (added.has(f)) m.newFiles++; m.list.push(f); m.cx[c] = (m.cx[c] || 0) + 1;
  for (const [k, [re]] of Object.entries(M)) { const n = (src.match(re) || []).length; m[k] = (m[k] || 0) + n; h[k] = (h[k] || 0) + n; }
  for (const x of src.matchAll(IMP)) { m.shImp++; (x[1] || x[2]).split(",").map(s => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "")).filter(Boolean).forEach(n => m.sh.add(n)); } }
for (const f of css) { const m = mods[mod(f.slice(0, -4) + ".tsx")]; if (!m) continue; const s = rd(f); m.cssLines += s.split(NL).length; m.cssRaw += (s.match(CSSRE) || []).length; }
const rows = Object.values(mods).map(m => {
  const p = m.module.endsWith("(root)") ? m.list : ["src/features/" + m.module], sc = score(m);
  return { ...m, score: +sc.toFixed(2), debt: Math.round(sc * m.loc / 100), system: m.module.startsWith("shared/"),
    last: git("log", "-1", "--format=%cs", "--", ...p).trim(), c30: git("log", "--since=" + since, "--format=%h", "--", ...p).split(NL).filter(Boolean).length,
    typeRaw: m.rawText + m.arbText + m.typoOverride + m.phantomTypo, radius: m.rawRadius + m.bareRounded, muted: m.mutedFg + m.dimText + m.opacityDim, colour: m.rawBW + m.hex + m.rgba, prims: m.overlay + m.select + m.table + m.tablist + m.clipboard,
    sharedDistinct: m.sh.size, sharedPer100: +(m.shImp * 100 / m.loc).toFixed(2), ctx: Object.entries(m.cx).sort((a, b) => b[1] - a[1])[0][0], lowConf: m.loc < 300 }; }).sort((a, b) => b.score - a.score);
const cols = ["module", "system", "score", "debt", "files", "loc", "big", "newFiles", "last", "c30", ...Object.keys(M), "cssLines", "cssRaw", "sharedDistinct", "sharedPer100", "lowConf", "ctx"];
const csv = [cols.join(","), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? "")).join(","))].join(NL);
const mc = ["module", "score", "debt", "loc", "big", "newFiles", "last", "c30", "typeRaw", "radius", "muted", "colour", "palText", "prims", "nativeTitle", "pulseSpin", "styleObj", "cssRaw", "sharedPer100"];
const table = L => ["| # | " + mc.join(" | ") + " |", "|" + "---|".repeat(mc.length + 1), ...L.map(r => "| " + r.rank + " | " + mc.map(c => r[c]).join(" | ") + " |")].join(NL);
const feat = rows.filter(r => !r.system).map((r, i) => ({ ...r, rank: i + 1 })), sys = rows.filter(r => r.system).map((r, i) => ({ ...r, rank: "S" + (i + 1) }));
const per = (o, k) => +((o[k] || 0) * 100 / o.loc).toFixed(2);
const cj = Object.fromEntries(Object.entries(coh).map(([k, o]) => [k, { loc: o.loc, score: +score(o).toFixed(2), ...Object.fromEntries(Object.keys(M).map(x => [x, per(o, x)])) }]));
const W = Object.entries(M).filter(([, [, w]]) => w).map(([k, [, w]]) => k + "=" + w).join(" ") + " cssRaw=" + CSSW;
const md = "files=" + files.length + " modules=" + rows.length + " since=" + since + NL + "cohorts per 100 LOC: " + JSON.stringify(cj) + NL + "weights: " + W + NL + NL + "## Feature modules" + NL + table(feat.slice(0, TOP)) + NL + NL + "## shared/ (system) modules" + NL + table(sys.slice(0, TOP));
if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(OUT + "/style-divergence.csv", csv); fs.writeFileSync(OUT + "/style-divergence.md", md); }
console.log(process.argv.includes("--csv") ? csv : md.split(NL).slice(0, 4 + Math.min(TOP, 25)).join(NL));
