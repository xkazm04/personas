from __future__ import annotations

import argparse
import json
from pathlib import Path

from .llm import DEFAULT_CONSUMER, DEFAULT_JUDGE
from .run import compare, rejudge, run
from .world import World

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "out"


def main():
    ap = argparse.ArgumentParser(prog="memory_year")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen", help="generate a world, its events and its probes")
    g.add_argument("--seed", type=int, default=7)
    g.add_argument("--days", type=int, default=365)
    g.add_argument("--density", type=float, default=10.0, help="mean events per weekday")
    g.add_argument("--projects", type=int, default=5)
    g.add_argument("--out", default=None)
    g.add_argument("--paraphrase", default=None, help="model spec used to reword fact-bearing events (value-preserving, cached), e.g. claude:claude-sonnet-5@low")
    r = sub.add_parser("run", help="replay a scenario through one or more rungs")
    r.add_argument("--scenario", required=True)
    r.add_argument("--rungs", default="none,full-history,raw-retrieval")
    r.add_argument("--consumer", default=DEFAULT_CONSUMER, help="claude:<model>@<effort>")
    r.add_argument("--judge", default=DEFAULT_JUDGE, help="claude:<model>@<effort>")
    r.add_argument("--budget", type=int, default=6000)
    r.add_argument("--elaboration", default="direct", choices=["direct", "elaborate"])
    r.add_argument("--lenient", action="store_true")
    r.add_argument("--max-days", type=int, default=None)
    r.add_argument("--probe-limit", type=int, default=None)
    r.add_argument("--backend-kw", default="{}", help="JSON passed to the backend constructor")
    r.add_argument("--resume", default=None, help="an existing run directory whose partial answers are kept (single rung)")
    r.add_argument("--parallel", type=int, default=6, help="concurrent CLI calls for answering and screening")
    j = sub.add_parser("rejudge", help="re-score cached answers with the current judge")
    j.add_argument("runs", nargs="+")
    j.add_argument("--judge", default=DEFAULT_JUDGE)
    j.add_argument("--lenient", action="store_true")
    c = sub.add_parser("compare", help="one ladder table over several run directories")
    c.add_argument("runs", nargs="+")
    a = ap.parse_args()

    if a.cmd == "gen":
        out = Path(a.out) if a.out else OUT / f"s{a.seed}-d{a.days}-x{int(a.density)}"
        w = World(a.seed, a.days, a.density, a.projects).generate()
        if a.paraphrase:
            from .llm import LLM
            n = w.paraphrase(LLM(a.paraphrase, OUT / "cache" / "llm.sqlite"))
            print(f"paraphrased {n} events with {a.paraphrase}")
        w.save(out)
        cls = {}
        for p in w.probes:
            cls[p.cls] = cls.get(p.cls, 0) + 1
        print(f"scenario {out}: user {w.user}, projects {w.projects}, facts {len(w.facts)}, events {len(w.events)}, probes {len(w.probes)} {json.dumps(cls)}")
    elif a.cmd == "run":
        dirs = []
        for rung in a.rungs.split(","):
            d = run(Path(a.scenario), rung.strip(), a.consumer, a.judge, a.budget, a.elaboration, OUT,
                    backend_kw=json.loads(a.backend_kw), max_days=a.max_days, strict_judge=not a.lenient, probe_limit=a.probe_limit,
                    resume=Path(a.resume) if a.resume else None, parallel=a.parallel)
            print(f"{rung}: {d}")
            dirs.append(d)
        print()
        print(compare(dirs))
    elif a.cmd == "rejudge":
        dirs = [rejudge(Path(r), a.judge, not a.lenient, OUT) for r in a.runs]
        print(compare(dirs))
    elif a.cmd == "compare":
        print(compare([Path(p) for p in a.runs]))


if __name__ == "__main__":
    main()
