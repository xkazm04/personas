"""Paired experiment: a closed-set memory-admission verdict answered two ways.

Arm A  discrete      - the model names one label (the shape the write-verdict gate uses today).
Arm B  distribution  - the model states a probability per label; the choice is the argmax and a
                       confidence is computed from the SHAPE of the distribution
                       (peak over uniform, rescaled 0..1), then a code-owned threshold
                       downgrades a low-confidence destructive verdict to the non-destructive one.

Gold comes from the world generator (supersedes / restate / first mention), never from a model.
Threshold is fitted on the first half of the cases and reported on the second half.
"""
from __future__ import annotations
import json, random, sys, re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HARNESS = Path(sys.argv[1]); OUT = Path(sys.argv[2]); N = int(sys.argv[3]); SPEC = sys.argv[4]
sys.path.insert(0, str(HARNESS))
from memory_year.world import World, _h, HUMAN_KEYS   # noqa: E402
from memory_year.llm import LLM                        # noqa: E402

w = World(seed=7, days=365, density=10.0).generate()
facts = {f.id: f for f in w.facts}
rng = random.Random(11)

def render(f): return f"{f.id}: [{_h(f.scope)}] {HUMAN_KEYS.get(f.key, f.key)} = {f.value}"

cases = []
seen: set[str] = set()
for ev in sorted(w.events, key=lambda e: (e.day, e.minute)):
    if ev.kind != "say" or not ev.facts: continue
    fs = [facts[i] for i in ev.facts if i in facts]
    if not fs or any(f.kind not in ("fact", "preference") for f in fs): continue
    new = fs[0]
    if new.supersedes and len(fs) > 1: kind, neighbour = "update", facts[new.supersedes]
    elif new.id in seen: kind, neighbour = "repeat", new
    else: kind, neighbour = "create", None
    for f in fs: seen.add(f.id)
    # pool = what a nearest-neighbour fetch would plausibly return: same key in every scope, valid just before now
    same_key = [f for f in w.facts if (f.key == new.key and f.id != new.id and f.valid_from < ev.day
                and (f.valid_to is None or f.valid_to >= ev.day) and f.id in seen) or (neighbour is not None and f.id == neighbour.id)]
    same_key = list({f.id: f for f in same_key}.values())
    withheld = bool(neighbour) and rng.random() < 0.35          # a retrieval miss: the true neighbour is not shown
    pool = [f for f in same_key if not (withheld and f.id == neighbour.id)]
    rng.shuffle(pool); pool = pool[:5]
    if neighbour and not withheld and neighbour.id not in [f.id for f in pool]: pool[-1:] = [neighbour]
    if not pool and kind == "create" and rng.random() < 0.6: continue   # trivial: nothing to confuse it with
    gold = "create" if (kind == "create" or withheld) else f"{kind}:{neighbour.id}"
    labels = ["create"] + [f"repeat:{f.id}" for f in pool] + [f"update:{f.id}" for f in pool]
    cases.append(dict(id=ev.id, kind=kind, withheld=withheld, text=ev.text, pool=[render(f) for f in pool], labels=labels, gold=gold))

by = {}
for c in cases: by.setdefault((c["kind"], c["withheld"]), []).append(c)
per = max(1, N // len(by)); picked = []
for k, v in sorted(by.items()): rng.shuffle(v); picked += v[:per]
rng.shuffle(picked); cases = picked
print("cases", len(cases), {f"{k[0]}{'-withheld' if k[1] else ''}": min(per, len(v)) for k, v in sorted(by.items())}, flush=True)

SYSTEM = ("You are the admission gate of an assistant's memory. You see one new message and the memory items nearest to it. "
          "Rule how the message relates to memory. 'create' = a fact not in the shown memory (also when the item it refers to is NOT shown). "
          "'repeat:<id>' = restates shown item <id> with the same value. 'update:<id>' = replaces the value of shown item <id>; "
          "the item must be about the SAME project or person, never a different one. Reply with one JSON object and nothing else.")

def prompt(c, mode):
    mem = "\n".join(c["pool"]) or "(no memory items)"
    head = f"MEMORY ITEMS\n{mem}\n\nNEW MESSAGE\n{c['text']}\n\nALLOWED LABELS\n" + "\n".join(c["labels"]) + "\n\n"
    if mode == "A": return head + 'Reply exactly: {"answer": "<one allowed label>"}'
    return head + ('Reply exactly: {"probabilities": {"<label>": <number 0..1>, ...}} with EVERY allowed label as a key. '
                   "The numbers are your probability that each label is the correct one and must sum to 1.")

llm = LLM(SPEC, OUT / "cache.sqlite", OUT / "work")

def parse(text):
    m = re.search(r"\{.*\}", text, re.S)
    try: return json.loads(m.group(0)) if m else None
    except json.JSONDecodeError: return None

def run(c):
    ra, rb = llm.complete(prompt(c, "A"), SYSTEM), llm.complete(prompt(c, "B"), SYSTEM)
    a = (parse(ra.text) or {}).get("answer")
    a_valid = a in c["labels"]
    if not a_valid: a = "create"                                  # the gate's existing coercion
    pb = (parse(rb.text) or {}).get("probabilities") or {}
    raw = {l: max(0.0, float(pb.get(l, 0) or 0)) for l in c["labels"]}
    tot = sum(raw.values()); sum_err = abs(tot - 1.0)
    p = {l: (v / tot if tot else 1 / len(raw)) for l, v in raw.items()}
    b = max(p, key=p.get); k = len(p)
    conf = 1.0 if k == 1 else (p[b] - 1 / k) / (1 - 1 / k)
    return dict(c, a=a, a_valid=a_valid, b=b, conf=round(conf, 4), sum_err=round(sum_err, 4), missing=len([l for l in c["labels"] if l not in pb]),
                tout_a=ra.tokens_out, tout_b=rb.tokens_out, ms_a=ra.latency_ms, ms_b=rb.latency_ms)

with ThreadPoolExecutor(6) as ex: rows = list(ex.map(run, cases))
(OUT / "rows.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")

def destructive(pred, gold): return pred.startswith("update:") and pred != gold   # invalidates a fact that is still true
def auroc(rows):
    pos = [r["conf"] for r in rows if r["b"] == r["gold"]]; neg = [r["conf"] for r in rows if r["b"] != r["gold"]]
    if not pos or not neg: return None
    return sum((x > y) + 0.5 * (x == y) for x in pos for y in neg) / (len(pos) * len(neg))
def gate(r, tau): return "create" if (r["b"].startswith("update:") and r["conf"] < tau) else r["b"]   # code-owned policy

half = len(rows) // 2; fit, rep = rows[:half], rows[half:]
# tau: the smallest threshold that removes every destructive error on the FIT half (ties -> lowest cost in accuracy)
cands = sorted({r["conf"] for r in fit} | {0.0})
best = min(cands + [1.01], key=lambda t: (sum(destructive(gate(r, t), r["gold"]) for r in fit), -sum(gate(r, t) == r["gold"] for r in fit), t))
def summ(rs, name):
    n = len(rs)
    d = dict(n=n, acc_A=sum(r["a"] == r["gold"] for r in rs) / n, acc_B=sum(r["b"] == r["gold"] for r in rs) / n,
             acc_B_gated=sum(gate(r, best) == r["gold"] for r in rs) / n,
             destr_A=sum(destructive(r["a"], r["gold"]) for r in rs), destr_B=sum(destructive(r["b"], r["gold"]) for r in rs),
             destr_B_gated=sum(destructive(gate(r, best), r["gold"]) for r in rs), auroc_B=auroc(rs),
             conf_correct=sum(r["conf"] for r in rs if r["b"] == r["gold"]) / max(1, sum(r["b"] == r["gold"] for r in rs)),
             conf_wrong=sum(r["conf"] for r in rs if r["b"] != r["gold"]) / max(1, sum(r["b"] != r["gold"] for r in rs)),
             saturated_B=sum(r["conf"] >= 0.999 for r in rs), invalid_A=sum(not r["a_valid"] for r in rs),
             sum_err_B=sum(r["sum_err"] > 1e-6 for r in rs), missing_label_B=sum(r["missing"] > 0 for r in rs),
             tout_A=sum(r["tout_a"] for r in rs) / n, tout_B=sum(r["tout_b"] for r in rs) / n,
             ms_A=sum(r["ms_a"] for r in rs) / n, ms_B=sum(r["ms_b"] for r in rs) / n)
    print(name, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items()})); return d
print("tau(fit half) =", best)
res = dict(spec=SPEC, tau=best, all=summ(rows, "ALL "), fit=summ(fit, "FIT "), report=summ(rep, "REPORT"))
for key in sorted({(r["kind"], r["withheld"]) for r in rows}):
    rs = [r for r in rows if (r["kind"], r["withheld"]) == key]
    print(key, "n", len(rs), "accA", round(sum(r["a"] == r["gold"] for r in rs) / len(rs), 2), "accB", round(sum(r["b"] == r["gold"] for r in rs) / len(rs), 2),
          "destrA", sum(destructive(r["a"], r["gold"]) for r in rs), "destrB", sum(destructive(r["b"], r["gold"]) for r in rs))
(OUT / "summary.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
