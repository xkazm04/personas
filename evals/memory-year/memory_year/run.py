"""The runner: replay a scenario day by day through a backend, probe it, judge, report.

One run = one scenario × one rung × one consumer × one judge × one budget × one
elaboration. All of those go into the header. The runner interleaves probes with events
by simulated time, so a probe at day 90 sees exactly the history up to that instant.
"""
from __future__ import annotations

import json
import time
import uuid
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

from . import backends
from .clock import Clock
from .consumer import answer, final_answer
from .judge import judge_form, judge_value
from .llm import LLM
from .model import Answer, to_json
from .world import World


def load_scenario(path: Path) -> dict:
    return World.load(path)


def screen_unaided(scenario: dict, llm: LLM, elaboration: str, out_dir: Path, probe_ids: set[str] | None = None) -> set[str]:
    """Unaided-baseline screening: a probe the consumer answers correctly with NO context
    is not measuring memory. Cached per (scenario, consumer, elaboration, probe); only the
    probes this run will ask are screened."""
    key = out_dir / f"screen-{llm.model.replace(':', '_')}-{elaboration}.json"
    done: dict[str, bool] = json.loads(key.read_text(encoding="utf-8")) if key.exists() else {}
    if isinstance(done, list):
        done = {i: True for i in done}
    for p in scenario["probes"]:
        if probe_ids is not None and p.id not in probe_ids:
            continue
        if p.gold in ("UNKNOWN", "FORM") or p.id in done:
            continue
        r = answer(llm, p.question, "", elaboration, Clock(p.day, p.minute).iso)
        v, _ = judge_value(p, final_answer(r.text, elaboration))
        done[p.id] = (v == "correct")
        key.write_text(json.dumps(done), encoding="utf-8")
    return {i for i, ok in done.items() if ok}


def run(scenario_dir: Path, rung: str, consumer_model: str, judge_model: str | None, budget_tokens: int,
        elaboration: str, out_root: Path, backend_kw: dict | None = None, max_days: int | None = None,
        strict_judge: bool = True, consolidate_every: int = 1, probe_limit: int | None = None) -> Path:
    scenario = load_scenario(scenario_dir)
    meta = scenario["meta"]
    cache_dir = out_root / "cache"
    llm = LLM(consumer_model, cache_dir / "llm.sqlite")
    jllm = LLM(judge_model, cache_dir / "llm.sqlite") if judge_model else None
    backend = backends.make(rung, **({"cache_dir": cache_dir} if rung == "raw-retrieval" else {}), **(backend_kw or {}))
    run_id = f"{rung}-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    run_dir = out_root / scenario_dir.name / f"run-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)

    # merge events and probes on the simulated timeline
    timeline = [("e", e.day, e.minute, e) for e in scenario["events"]] + [("p", p.day, p.minute, p) for p in scenario["probes"]]
    timeline.sort(key=lambda t: (t[1], t[2], 0 if t[0] == "e" else 1))
    if max_days is not None:
        timeline = [t for t in timeline if t[1] < max_days]
    will_ask = [t[3].id for t in timeline if t[0] == "p"]
    if probe_limit is not None:
        will_ask = will_ask[:probe_limit]
    screened = screen_unaided(scenario, llm, elaboration, out_root / scenario_dir.name, set(will_ask))

    answers: list[Answer] = []
    store_timeline = {}
    day_seen = -1
    write_ms = 0
    probes_done = 0
    t_run = time.time()
    for kind, day, minute, obj in timeline:
        clock = Clock(day, minute)
        if day != day_seen:
            if day_seen >= 0 and day_seen % consolidate_every == 0:
                backend.consolidate(Clock(day_seen, 23 * 60))
            if day in (90, 180, 270, 364) and day not in store_timeline:
                store_timeline[day] = backend.cost().store_bytes
            day_seen = day
        if kind == "e":
            t0 = time.time()
            backend.ingest(obj, clock)
            write_ms += int((time.time() - t0) * 1000)
            continue
        p = obj
        if probe_limit is not None and probes_done >= probe_limit:
            continue
        probes_done += 1
        if p.id in screened:
            answers.append(Answer(p.id, rung, "", 0, 0, "screened", "unaided-screen", 0, "rung-1 answers it"))
            continue
        t0 = time.time()
        ctx = backend.recall(p, clock, budget_tokens)
        r = answer(llm, p.question, ctx.text, elaboration, clock.iso)
        text = final_answer(r.text, elaboration)
        ms = int((time.time() - t0) * 1000)
        if p.gold == "FORM":
            v, note, jname = judge_form(p, text, jllm, strict_judge)
        else:
            v, note = judge_value(p, text)
            jname = "deterministic"
        answers.append(Answer(p.id, rung, text[:2000], ctx.tokens, len(ctx.items), v, jname, ms, note))
    backend.consolidate(Clock(day_seen, 23 * 60))
    cost = backend.cost().as_dict()
    cost["write_ms"] = write_ms
    header = {
        "run_id": run_id, "rung": rung, "backend": backend.describe(), "scenario": meta,
        "consumer": consumer_model, "judge": judge_model or "deterministic-only", "judge_direction": "strict" if strict_judge else "lenient",
        "budget_tokens": budget_tokens, "elaboration": elaboration, "date": time.strftime("%Y-%m-%d"),
        "events_replayed": sum(1 for t in timeline if t[0] == "e"), "probes": probes_done, "screened": len(screened),
        "consumer_calls": llm.calls, "consumer_tokens_in": llm.tokens_in, "consumer_tokens_out": llm.tokens_out, "consumer_cache_hits": llm.cache_hits,
        "write_cost": cost, "store_bytes_at": store_timeline, "wall_s": round(time.time() - t_run, 1),
    }
    (run_dir / "header.json").write_text(json.dumps(header, indent=1), encoding="utf-8")
    (run_dir / "answers.json").write_text(json.dumps(to_json(answers), indent=1), encoding="utf-8")
    backend.close()
    (run_dir / "report.md").write_text(report_run(header, answers, scenario), encoding="utf-8")
    return run_dir


def report_run(header: dict, answers: list[Answer], scenario: dict) -> str:
    probes = {p.id: p for p in scenario["probes"]}
    by_cls = defaultdict(lambda: defaultdict(int))
    by_bucket = defaultdict(lambda: defaultdict(int))
    tok = []
    for a in answers:
        p = probes[a.probe_id]
        by_cls[p.cls][a.verdict] += 1
        by_cls[p.cls]["n"] += 1
        b = "0-7d" if p.history_days <= 7 else "8-45d" if p.history_days <= 45 else "46-120d" if p.history_days <= 120 else "121d+"
        by_bucket[b][a.verdict] += 1
        by_bucket[b]["n"] += 1
        if a.verdict != "screened":
            tok.append(a.context_tokens)
    L = [f"# memory-year run `{header['run_id']}`", "",
         f"rung **{header['rung']}** · backend `{json.dumps(header['backend'])}` · consumer `{header['consumer']}` · judge `{header['judge']}` ({header['judge_direction']}) · budget {header['budget_tokens']} tokens · elaboration `{header['elaboration']}` · scenario seed {header['scenario']['seed']} density {header['scenario']['density']} days {header['scenario']['days']} · {header['date']}",
         "", f"events replayed {header['events_replayed']} · probes {header['probes']} (screened by rung 1: {header['screened']}) · consumer calls {header['consumer_calls']} (cache hits {header['consumer_cache_hits']}) · wall {header['wall_s']}s", "",
         "## Per probe class", "", "| class | n | correct | wrong | wrong-old | abstained | error | screened | acc (scored) |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for cls in sorted(by_cls):
        c = by_cls[cls]
        scored = c["n"] - c["screened"]
        acc = f"{c['correct'] / scored:.2f}" if scored else "-"
        L.append(f"| {cls} | {c['n']} | {c['correct']} | {c['wrong']} | {c['wrong-old']} | {c['abstained']} | {c['error']} | {c['screened']} | {acc} |")
    tot = defaultdict(int)
    for c in by_cls.values():
        for k, v in c.items():
            tot[k] += v
    scored = tot["n"] - tot["screened"]
    L += ["", f"**All scored probes: {tot['correct']}/{scored} correct ({tot['correct'] / scored:.2f}), wrong-old {tot['wrong-old']}, abstained {tot['abstained']}**" if scored else "", "",
          "## Crossover: by days of history at probe time", "", "| history | n | correct | wrong-old | abstained | acc |", "| --- | --- | --- | --- | --- | --- |"]
    for b in ["0-7d", "8-45d", "46-120d", "121d+"]:
        c = by_bucket.get(b)
        if not c:
            continue
        sc = c["n"] - c["screened"]
        L.append(f"| {b} | {c['n']} | {c['correct']} | {c['wrong-old']} | {c['abstained']} | {(c['correct'] / sc):.2f} |" if sc else f"| {b} | {c['n']} | - | - | - | - |")
    wc = header["write_cost"]
    ev = max(1, header["events_replayed"])
    L += ["", "## Cost", "",
          f"- read: mean {sum(tok) / max(1, len(tok)):.0f} context tokens per scored probe (max {max(tok) if tok else 0})",
          f"- write: {wc.get('model_calls', 0)} model calls, {wc.get('tokens_in', 0)} tokens in, {wc.get('tokens_out', 0)} tokens out, {wc.get('embeddings', 0)} embeddings over {ev} events "
          f"({wc.get('model_calls', 0) / ev:.2f} calls/event, {wc.get('tokens_in', 0) / ev:.0f} tokens/event); write wall {wc.get('write_ms', 0)} ms",
          f"- store bytes at day: {json.dumps(header['store_bytes_at'])}", ""]
    return "\n".join(L)


def compare(run_dirs: list[Path]) -> str:
    rows = []
    for d in run_dirs:
        h = json.loads((d / "header.json").read_text(encoding="utf-8"))
        answers = json.loads((d / "answers.json").read_text(encoding="utf-8"))
        sc = [a for a in answers if a["verdict"] != "screened"]
        correct = sum(1 for a in sc if a["verdict"] == "correct")
        wo = sum(1 for a in sc if a["verdict"] == "wrong-old")
        ab = sum(1 for a in sc if a["verdict"] == "abstained")
        tok = sum(a["context_tokens"] for a in sc) / max(1, len(sc))
        wc = h["write_cost"]; ev = max(1, h["events_replayed"])
        rows.append((h["rung"], len(sc), correct, wo, ab, tok, wc.get("model_calls", 0) / ev, wc.get("tokens_in", 0) / ev, h["consumer"], h["budget_tokens"], h["elaboration"]))
    L = ["| rung | scored | correct | acc | wrong-old | abstained | ctx tokens/probe | write calls/event | write tokens/event |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        L.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[2] / max(1, r[1]):.2f} | {r[3]} | {r[4]} | {r[5]:.0f} | {r[6]:.2f} | {r[7]:.0f} |")
    if rows:
        L.append(f"\nconsumer `{rows[0][8]}` · budget {rows[0][9]} · elaboration `{rows[0][10]}` - every row shares them or the table is not a ladder.")
    return "\n".join(L)
