"""Paired experiment 2: the harness's model grader (a YES/NO call) against a yes-probability call.

Cases are REAL recorded (fix, reply) pairs the harness already graded with a model.
Borderline label (no model gold, derived from a different layer): the two grading rubrics the
harness already ships - strict and lenient - DISAGREE on the pair. That is the documented
"grader strictness" noise.

Arm A  one strict YES/NO call (as shipped). It has no way to say "this one is borderline".
Arm B  one call returning the probability of YES under the SAME strict rubric. Borderline-ness
       = 1 - |2p - 1|. A code-owned review band [lo, hi] sends the pair to a second look.
Target: AUROC of borderline-ness against strict!=lenient; share of disagreements the band catches
        vs the share of all pairs it flags. Floor: (p >= .5) agrees with the strict verdict >= 95%.
"""
from __future__ import annotations
import glob, json, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HARNESS = Path(sys.argv[1]); OUT = Path(sys.argv[2]); N = int(sys.argv[3]); SPEC = sys.argv[4]
sys.path.insert(0, str(HARNESS))
from memory_year.llm import LLM   # noqa: E402

root = HARNESS / "out" / "s7-d365-x10"
probes = {p["id"]: p for p in json.load(open(root / "probes.json", encoding="utf-8"))}
pairs = {}
for f in sorted(glob.glob(str(root / "run-*" / "answers.json"))):
    d = json.load(open(f, encoding="utf-8")); rows = d if isinstance(d, list) else d.get("answers", [])
    for r in rows:
        if not str(r.get("judge", "")).startswith("model-"): continue
        fix = probes[r["probe_id"]]["form"].split(":", 1)[1]
        pairs.setdefault((fix, r["text"].strip()), r.get("verdict"))
cases = [dict(fix=k[0], reply=k[1], recorded=v) for k, v in sorted(pairs.items())][:N]
print("unique recorded model-graded pairs:", len(pairs), "used:", len(cases), flush=True)

STRICT = "Answer YES only if the reply explicitly applies or mentions this fix as the first thing it does; otherwise NO."
LENIENT = "Answer YES if the reply mentions or applies the fix anywhere; otherwise NO."
llm = LLM(SPEC, OUT / "cache2.sqlite", OUT / "work")

def yn(c, rubric):
    r = llm.complete(f"FIX: {c['fix']}\n\nREPLY:\n{c['reply']}\n\n{rubric} Reply with YES or NO only.", "You are a strict grader. Output only YES or NO.")
    return r.text.strip().upper().startswith("YES"), r
def noul(c):
    q = STRICT.replace("Answer YES only if", "The statement to judge: ").replace("; otherwise NO.", ".")
    r = llm.complete(f"FIX: {c['fix']}\n\nREPLY:\n{c['reply']}\n\n{q}\nReply with one JSON object and nothing else: "
                     '{"p_yes": <number 0..1>} - your probability that the statement is true.', "You are a strict grader. Output only the JSON object.")
    m = re.search(r"\{.*\}", r.text, re.S)
    try: p = float(json.loads(m.group(0))["p_yes"])
    except Exception: p = None
    return p, r

def run(c):
    s, rs = yn(c, STRICT); l, _ = yn(c, LENIENT); p, rp = noul(c)
    return dict(c, strict=s, lenient=l, p=p, tout_a=rs.tokens_out, tout_b=rp.tokens_out, ms_a=rs.latency_ms, ms_b=rp.latency_ms)

with ThreadPoolExecutor(6) as ex: rows = list(ex.map(run, cases))
(OUT / "rows2.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
ok = [r for r in rows if r["p"] is not None]
dis = [r for r in ok if r["strict"] != r["lenient"]]; agr = [r for r in ok if r["strict"] == r["lenient"]]
b = lambda r: 1 - abs(2 * r["p"] - 1)
auroc = (sum((b(x) > b(y)) + 0.5 * (b(x) == b(y)) for x in dis for y in agr) / (len(dis) * len(agr))) if dis and agr else None
res = dict(spec=SPEC, n=len(rows), parsed=len(ok), strict_yes=sum(r["strict"] for r in ok), lenient_yes=sum(r["lenient"] for r in ok),
           disagreements=len(dis), floor_agree_with_strict=sum((r["p"] >= .5) == r["strict"] for r in ok) / max(1, len(ok)),
           auroc_borderline=auroc, p_hist={k: sum(1 for r in ok if lo <= r["p"] < hi) for k, lo, hi in
                                           [("0-.05", 0, .05), (".05-.2", .05, .2), (".2-.8", .2, .8), (".8-.95", .8, .95), (".95-1", .95, 1.01)]},
           recorded_vs_rerun_strict_flip=sum((r["recorded"] == "correct") != r["strict"] for r in ok if r["recorded"] in ("correct", "wrong")),
           tout_A=sum(r["tout_a"] for r in ok) / max(1, len(ok)), tout_B=sum(r["tout_b"] for r in ok) / max(1, len(ok)))
for lo, hi in [(.2, .8), (.1, .9), (.05, .95)]:
    band = [r for r in ok if lo <= r["p"] <= hi]
    res[f"band_{lo}_{hi}"] = dict(flagged=len(band), flagged_share=round(len(band) / max(1, len(ok)), 3),
                                  disagreements_caught=sum(r["strict"] != r["lenient"] for r in band), of=len(dis))
print(json.dumps(res, indent=1))
(OUT / "summary2.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
