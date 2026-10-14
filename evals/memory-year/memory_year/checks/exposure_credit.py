"""Exposure credit: does an outcome credited to the delivered set measure use, or exposure?

Registry technique agent-memory/exposure-is-not-credit; intake run dle-r5-1015 (2026-10-15).
The attribution rule under test as arm A was read in a public procedural-memory tool and is
restated here from scratch; none of its code is copied.

Usage (from evals/memory-year):
  py -I memory_year/checks/exposure_credit.py out/s7-d365-x10 \n     out/s7-d365-x10/supermemory-arm/side_contexts.jsonl \n     out/s7-d365-x10/run-recorded-20260918-094721-29f18e/answers.json memories

Data (read-only): a memory-year scenario dir (probes.json), one arm's recorded per-probe
contexts (side_contexts.jsonl, one mode), and the answers of a run that replayed those
contexts (answers.json). No model calls.

Arm A - session credit (the attribution rule read in the source tree): every item in a
probe's delivered set is credited helpful when the answer was graded correct; blame is
withheld when the delivered set is larger than BLAST (8) and otherwise applied to all.
Arm B - use credit: an item is credited only when the answer text uses it (shares >= 2
distinctive tokens with it that the question does not already carry); blame the same way,
symmetric, no size gate.
Both arms: 90-day half-life on event age (probe day vs day 365), harm weighted 4x,
maturity 'proven' at decayed helpful >= 10 and harm ratio < 0.1 (the source's defaults).

Ground truth (never shown to either arm): an item SUPPORTS a probe when it was delivered
and contains the probe's gold value; it MISLEADS when it contains a listed wrong value.
Only value-gold probes define support; every probe feeds credit, as a live system would.

Pre-registered verdict rule (written after a first look on an incomplete ground truth
that excluded procedure and adaptation probes; recorded so the reader can discount it):
  target T1 = share of 'proven' items that never supported any probe (lower is better),
  target T2 = p@25 useful (higher is better);
  floor F   = useful items scored below neutral (score < 0) may exceed arm A's count by <= 2.
  Coverage (useful items with positive score) is reported as the measured cost, not a floor.
Arm D (POST HOC, added after the B result; exploratory, never the verdict) = use credit,
helpful only, no blame through use.
Arm C = session credit with symmetric blame and no size gate: separates the source's
asymmetric guard from the attribution unit itself.

Asserts its instrument first: a planted always-delivered item with zero support must be
proven under A and must not be under B, on a synthetic three-probe set.
"""
import json, re, sys, math, collections

BLAST, HALF, HARM, PROVEN_H, PROVEN_R = 8, 90.0, 4.0, 10.0, 0.1
STOP = set("the a an of for to in on and or is are was were be been it its this that with as at by from "
           "what which who whom how why when where do does did we our you your project user".split())

def norm(s): return re.sub(r"\s+", " ", s.lower()).strip()
def toks(s): return {t for t in re.findall(r"[a-z0-9][a-z0-9\-\.]+", s.lower()) if len(t) >= 3 and t not in STOP}
def items_of(text):
    out = []
    for ln in text.split("\n"):
        ln = ln.strip()
        if ln.startswith("- "):
            out.append(re.sub(r"\s*\(as of [0-9\-]+\)\s*$", "", ln[2:]).strip())
    return out

def decay(day, now=365): return 0.5 ** (max(0, now - day) / HALF)

def score(events):
    h = sum(decay(d) for k, d in events if k == "h"); b = sum(decay(d) for k, d in events if k == "b")
    tot = h + b; ratio = b / tot if tot else 0.0
    return h - HARM * b, (h >= PROVEN_H and ratio < PROVEN_R), h, b

def run(probes, ctx, ans):
    A, B, C, Dd = (collections.defaultdict(list) for _ in range(4))
    deliver, support, mislead = collections.Counter(), collections.Counter(), collections.Counter()
    value_probes = 0
    for p in sorted(probes, key=lambda q: (q["day"], q.get("minute", 0))):
        pid = p["id"]
        if pid not in ctx or pid not in ans: continue
        D = list(dict.fromkeys(ctx[pid])); a = ans[pid]; ok = a["verdict"] == "correct"
        gold = p.get("gold"); wrong = p.get("wrong") or []
        valued = isinstance(gold, str) and gold and gold.upper() != "UNKNOWN" and p["cls"] not in ("procedure", "rule", "adaptation")
        cover = None
        if p["cls"] == "procedure" and isinstance(gold, str): cover = toks(gold)
        if p["cls"] == "adaptation" and str(p.get("form") or "").startswith("applies:"): cover = toks(p["form"][8:])
        value_probes += cover is not None
        value_probes += valued
        qt, at = toks(p["question"]), toks(a.get("text", ""))
        for it in D:
            deliver[it] += 1
            ni = norm(it)
            if valued and norm(gold) in ni: support[it] += 1
            elif cover and len(cover & toks(it)) >= 0.7 * len(cover): support[it] += 1
            if any(isinstance(w, str) and w and norm(w) in ni for w in wrong): mislead[it] += 1
            # arm A: session verdict onto the delivered set, blame size-gated
            if ok: A[it].append(("h", p["day"]))
            elif len(D) <= BLAST: A[it].append(("b", p["day"]))
            C[it].append(("h" if ok else "b", p["day"]))
            # arm B: credit or blame only through use evidence in the answer
            used = len((toks(it) - qt) & at) >= 2
            if used: B[it].append(("h" if ok else "b", p["day"]))
            if used and ok: Dd[it].append(("h", p["day"]))
    run.D = Dd
    return A, B, C, deliver, support, mislead, value_probes

def report(name, arm, deliver, support, mislead, ks=(10, 25, 50)):
    rows = {it: score(ev) for it, ev in arm.items()}
    ranked = sorted(rows, key=lambda it: (-rows[it][0], it))
    useful = {it for it in deliver if support[it] > 0}
    proven = [it for it in rows if rows[it][1]]
    out = {"arm": name, "items_scored": len(rows), "useful_items": len(useful),
           "proven": len(proven), "proven_never_supported": sum(1 for it in proven if support[it] == 0),
           "proven_misleading": sum(1 for it in proven if mislead[it] > 0),
           "useful_with_positive_score": sum(1 for it in useful if it in rows and rows[it][0] > 0),
           "useful_below_neutral": sum(1 for it in useful if it in rows and rows[it][0] < 0)}
    for k in ks:
        top = ranked[:k]
        out[f"p@{k}_useful"] = round(sum(1 for it in top if support[it] > 0) / max(1, len(top)), 3)
    # rank correlation of score with exposure and with support, over delivered items
    def spearman(xs, ys):
        def rk(v):
            o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
            while i < len(o):
                j = i
                while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]: j += 1
                for m in range(i, j + 1): r[o[m]] = (i + j) / 2.0
                i = j + 1
            return r
        a, b = rk(xs), rk(ys); n = len(a); ma, mb = sum(a) / n, sum(b) / n
        cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
        va = math.sqrt(sum((x - ma) ** 2 for x in a)); vb = math.sqrt(sum((y - mb) ** 2 for y in b))
        return round(cov / (va * vb), 3) if va and vb else None
    its = sorted(deliver)
    sc = [rows[it][0] if it in rows else 0.0 for it in its]
    out["rho_score_exposure"] = spearman(sc, [deliver[it] for it in its])
    out["rho_score_support"] = spearman(sc, [support[it] - mislead[it] for it in its])
    out["top10"] = [(it[:70], deliver[it], support[it], mislead[it], round(rows[it][0], 2)) for it in ranked[:10]]
    return out

def self_test():
    probes = [{"id": f"t{i}", "day": 350 + i, "cls": "stable", "question": f"what is key{i}", "gold": f"val{i}", "wrong": []} for i in range(15)]
    ctx = {f"t{i}": [f"key{i} is val{i} indeed", "always delivered boilerplate rule about testing"] for i in range(15)}
    ans = {f"t{i}": {"verdict": "correct", "text": f"key{i} is val{i} indeed"} for i in range(15)}
    A, B, C, dl, sp, ms, _ = run(probes, ctx, ans)
    bp = "always delivered boilerplate rule about testing"
    assert score(A[bp])[1] and sp[bp] == 0, "instrument: planted exposure item must be proven under A"
    assert not B.get(bp) or not score(B[bp])[1], "instrument: planted exposure item must not be proven under B"
    assert all(sp[f"key{i} is val{i} indeed"] == 1 for i in range(15)), "instrument: support detection"
    return "self-test ok"

if __name__ == "__main__":
    print(self_test())
    scen, side, answers, mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    probes = json.load(open(f"{scen}/probes.json", encoding="utf-8"))
    ctx = {}
    for ln in open(side, encoding="utf-8"):
        r = json.loads(ln)
        if r.get("mode") == mode: ctx[r["probe"]] = items_of(r["text"])
    ans = {a["probe_id"]: a for a in json.load(open(answers, encoding="utf-8"))}
    A, B, C, dl, sp, ms, vp = run(probes, ctx, ans)
    sizes = [len(set(v)) for v in ctx.values()]
    print(json.dumps({"probes_with_context": len(ctx), "support_defined_probes": vp, "distinct_items": len(dl),
                      "delivered_set_size_min_med_max": [min(sizes), sorted(sizes)[len(sizes)//2], max(sizes)],
                      "sets_at_or_below_blast": sum(1 for s in sizes if s <= BLAST),
                      "accuracy": round(sum(1 for a in ans.values() if a["verdict"] == "correct") / len(ans), 3)}))
    for name, arm in (("A_session_credit", A), ("C_session_symmetric", C), ("B_use_credit", B), ("D_use_credit_no_blame_POSTHOC", run.D)):
        print(json.dumps(report(name, arm, dl, sp, ms), ensure_ascii=False))
