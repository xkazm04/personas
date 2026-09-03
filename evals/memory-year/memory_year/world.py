"""The world generator: one user, a year, facts that change, and probes with gold.

Deterministic from a seed. Natural-language variety comes from templates; a local model
may paraphrase `say` events (cached) but the facts, their lifecycles and the probes' gold
never pass through a model. Probes are derived from the world, never from observed
queries, so the fixture set cannot feed on itself.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from .model import Fact, Event, Probe, to_json

WORLD_VERSION = "1"

FIRST_NAMES = ["Marek", "Ivana", "Tomas", "Petra", "Jakub", "Lucie", "Ondrej", "Klara"]
CITIES = ["Prague", "Brno", "Vienna", "Berlin", "Lisbon", "Krakow", "Zurich", "Oslo"]
PROJECT_STEMS = ["atlas", "ledger", "beacon", "harbor", "quill", "orbit", "lantern", "meadow", "cinder", "vantage"]
STACKS = {
    "database": ["Postgres 16", "SQLite", "MySQL 8", "DuckDB", "MongoDB", "Turso"],
    "language": ["Rust", "TypeScript", "Python", "Go", "Kotlin"],
    "framework": ["Next.js", "Tauri", "FastAPI", "Axum", "SvelteKit", "Django"],
    "host": ["Fly.io", "a Hetzner box", "Vercel", "Cloudflare", "the office NAS", "Railway"],
    "ci": ["GitHub Actions", "GitLab CI", "Buildkite", "a bash script on the NAS"],
    "branch-model": ["trunk-based", "git-flow", "release branches"],
    "deploy-day": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "lead": ["Anna", "Boris", "Chen", "Dita", "Emil", "Farah"],
}
USER_KEYS = {
    "city": CITIES,
    "editor": ["VS Code", "Neovim", "Zed", "JetBrains"],
    "timezone": ["Europe/Prague", "Europe/Berlin", "Europe/Lisbon", "UTC"],
    "standup-time": ["9:00", "9:30", "10:00", "13:00"],
    "coffee": ["flat white", "espresso", "filter", "none, tea"],
    "dog": ["Rex", "Luna", "Bobik", "Mia", "no dog"],
}
PREFERENCES = {
    "reply-length": ["short answers", "detailed answers", "bullet points"],
    "tone": ["formal", "casual", "blunt"],
    "code-style": ["tabs", "two-space indent", "four-space indent"],
    "commit-style": ["conventional commits", "plain sentences", "ticket id first"],
    "language-of-reply": ["English", "Czech", "English with Czech summaries"],
}
RULES = [
    ("no-emoji", "never use emojis in your replies"),
    ("asks-confirmation", "always ask me to confirm before anything destructive like deleting files or dropping tables"),
    ("no-em-dash", "do not use em dashes, use plain commas"),
    ("cite-source", "when you state a fact about my projects, say where you learned it"),
]
TASK_KINDS = {
    "deploy": (["run the migration", "build the release", "upload the artifact", "flip the router", "smoke-test"], ["the migration ran before the backup", "the artifact was built on the wrong branch", "the smoke test hit the old router"]),
    "release-notes": (["collect merged PRs since the last tag", "group by area", "write one line per PR", "add the version header"], ["the tag range was off by one", "PRs from the wrong repo were included"]),
    "data-export": (["snapshot the table", "run the export query", "zip the CSVs", "upload to the share"], ["the export used the stale snapshot", "the zip was uploaded unencrypted"]),
    "invoice": (["pull hours from the tracker", "apply the client rate", "generate the PDF", "email it"], ["the rate was the old one", "hours from the wrong month were billed"]),
    "backup-restore": (["stop writers", "restore from the nightly", "verify row counts", "restart writers"], ["writers were not stopped first", "row counts were never verified"]),
}
NOISE = [
    "what a day. the trams were packed again.",
    "reminder to myself: buy oat milk.",
    "did you see the match last night? unbelievable finish.",
    "i think the weather is turning, autumn already.",
    "thinking about repainting the office wall, maybe green.",
    "my neighbour's drill again at 7am, i swear.",
    "long week. going hiking on saturday if it does not rain.",
    "found a great bakery near the station, the rye bread is excellent.",
    "can you believe it is already the {month}th month of the year.",
    "note to self, the printer needs toner.",
]
SAY_TEMPLATES = {
    "new": [
        "For {scope_h}, we use {value} as the {key_h}.",
        "Quick note on {scope_h}: the {key_h} is {value}.",
        "Just so you know, {scope_h} runs on {value} for its {key_h}.",
        "{scope_h} update: {key_h} = {value}.",
    ],
    "update": [
        "Change of plan for {scope_h}: we moved the {key_h} from {old} to {value}.",
        "Heads up, {scope_h} no longer uses {old}; the {key_h} is now {value}.",
        "We switched the {key_h} on {scope_h} to {value}, {old} is gone.",
        "{scope_h}: the {key_h} is {value} from today, not {old}.",
    ],
    "user-new": [
        "By the way, my {key_h} is {value}.",
        "Remember this: {key_h} is {value} for me.",
        "Personal note, my {key_h}: {value}.",
    ],
    "user-update": [
        "Update on me: my {key_h} is now {value}, it used to be {old}.",
        "I moved things around, my {key_h} changed from {old} to {value}.",
    ],
    "pref-new": [
        "In general I prefer {value}.",
        "Going forward, please give me {value}.",
        "My preference: {value}.",
    ],
    "pref-update": [
        "Actually, forget {old}; from now on I want {value}.",
        "I changed my mind about {old}, please switch to {value}.",
    ],
    "expire": [
        "{scope_h} is being wound down, we no longer have a {key_h} there.",
        "We dropped the {key_h} on {scope_h} entirely, nothing replaces it.",
    ],
}
HUMAN_KEYS = {
    "database": "database", "language": "main language", "framework": "framework", "host": "hosting",
    "ci": "CI system", "branch-model": "branching model", "deploy-day": "deploy day", "lead": "project lead",
    "city": "city", "editor": "editor", "timezone": "timezone", "standup-time": "standup time",
    "coffee": "coffee order", "dog": "dog's name",
}


def _h(scope: str) -> str:
    return "me" if scope == "user" else f"project {scope}"


class World:
    def __init__(self, seed: int, days: int = 365, density: float = 10.0, projects: int = 5):
        self.rng = random.Random(seed)
        self.seed, self.days, self.density = seed, days, density
        self.user = self.rng.choice(FIRST_NAMES)
        self.projects = self.rng.sample(PROJECT_STEMS, projects)
        self.facts: list[Fact] = []
        self.events: list[Event] = []
        self.probes: list[Probe] = []
        self._fid = 0
        self._eid = 0
        self._pid = 0
        self.task_state: dict[str, dict] = {}   # kind -> {failures, cause, fixed_day, fix}

    # ---- ids
    def _new_fact(self, **kw) -> Fact:
        self._fid += 1
        f = Fact(id=f"f{self._fid:04d}", **kw)
        self.facts.append(f)
        return f

    def _emit(self, day: int, kind: str, scope: str, text: str, facts=(), **meta) -> Event:
        self._eid += 1
        minute = self.rng.randint(0, 9 * 60)
        e = Event(id=f"e{self._eid:05d}", day=day, minute=minute, kind=kind, scope=scope, text=text, facts=list(facts), meta=meta)
        self.events.append(e)
        return e

    def _probe(self, day: int, cls: str, scope: str, question: str, gold: str, wrong=(), form=None, fact_ids=(), newest_day=0) -> Probe:
        self._pid += 1
        p = Probe(id=f"p{self._pid:04d}", day=day, minute=self.rng.randint(9 * 60, 17 * 60), cls=cls, scope=scope,
                  question=question, gold=gold, wrong=list(wrong), form=form, fact_ids=list(fact_ids), history_days=max(0, day - newest_day))
        self.probes.append(p)
        return p

    # ---- the current value of a key in a scope at a day
    def current(self, scope: str, key: str, day: int) -> Fact | None:
        cands = [f for f in self.facts if f.scope == scope and f.key == key and f.valid_at(day)]
        return cands[-1] if cands else None

    def history(self, scope: str, key: str) -> list[Fact]:
        return [f for f in self.facts if f.scope == scope and f.key == key]

    # ---- generation
    def generate(self) -> "World":
        rng = self.rng
        days, N = self.days, self.days
        # Plan: seed facts in the first 3 weeks, then a steady stream of updates, tasks, teaching, noise.
        # 1. project facts
        for p in self.projects:
            for key, pool in STACKS.items():
                if rng.random() < 0.8:
                    day = rng.randint(0, 21)
                    f = self._new_fact(scope=p, key=key, value=rng.choice(pool), valid_from=day)
                    self._emit(day, "say", p, self._say("new", p, key, f.value), [f.id])
        # 2. user facts and preferences
        for key, pool in USER_KEYS.items():
            day = rng.randint(0, 21)
            f = self._new_fact(scope="user", key=key, value=rng.choice(pool), valid_from=day)
            self._emit(day, "say", "user", self._say("user-new", "user", key, f.value), [f.id])
        for key, pool in PREFERENCES.items():
            day = rng.randint(0, 30)
            f = self._new_fact(scope="user", key=key, value=rng.choice(pool), valid_from=day, kind="preference")
            self._emit(day, "say", "user", self._say("pref-new", "user", key, f.value), [f.id])
        # 3. rules (behavioural), taught in months 1-4
        rule_days = {}
        for form, text in rng.sample(RULES, 3):
            day = rng.randint(20, 120)
            f = self._new_fact(scope="user", key=f"rule:{form}", value=text, valid_from=day, kind="rule")
            self._emit(day, "teach", "user", f"One rule for you: {text}.", [f.id])
            rule_days[form] = day
        # 4. procedures, taught once per (project, task kind) in months 1-6
        proc = {}
        for p in self.projects:
            for kind in rng.sample(list(TASK_KINDS), 2):
                steps, _ = TASK_KINDS[kind]
                day = rng.randint(14, 180)
                f = self._new_fact(scope=p, key=f"procedure:{kind}", value=" -> ".join(steps), valid_from=day, kind="procedure")
                self._emit(day, "teach", p, f"Here is how we do a {kind} for project {p}: " + "; then ".join(steps) + ".", [f.id])
                proc[(p, kind)] = (day, steps)
        # 5. the steady stream, day by day
        events_per_day = self.density
        for day in range(0, N):
            n = max(0, int(rng.gauss(events_per_day, events_per_day / 3)))
            if day % 7 in (5, 6):
                n = n // 4
            for _ in range(n):
                r = rng.random()
                if r < 0.42:
                    self._emit(day, "noise", "user", rng.choice(NOISE).format(month=1 + day // 30))
                elif r < 0.47:
                    self._update(day)
                elif r < 0.90:
                    self._task(day, proc)
                else:
                    self._restate(day)
        # 6. expiries: a couple of project keys wound down in the second half
        expired = 0
        for _ in range(12):
            if expired >= 3:
                break
            p = rng.choice(self.projects)
            key = rng.choice(list(STACKS))
            day = rng.randint(200, 300)
            cur = self.current(p, key, day)
            if cur and cur.valid_to is None and not any(g.supersedes == cur.id for g in self.facts):
                cur.valid_to = day
                expired += 1
                self._emit(day, "say", p, self._say("expire", p, key, ""), [cur.id])
        # 7. probes
        self._make_probes(rule_days, proc)
        self.events.sort(key=lambda e: (e.day, e.minute))
        self.probes.sort(key=lambda p: (p.day, p.minute))
        return self

    def _say(self, kind: str, scope: str, key: str, value: str, old: str = "") -> str:
        t = self.rng.choice(SAY_TEMPLATES[kind])
        return t.format(scope_h=_h(scope), key_h=HUMAN_KEYS.get(key, key), value=value, old=old)

    def _update(self, day: int):
        rng = self.rng
        if rng.random() < 0.7:
            p = rng.choice(self.projects)
            key = rng.choice(list(STACKS))
            cur = self.current(p, key, day)
            if not cur or day - cur.valid_from < 45:
                return
            new = rng.choice([v for v in STACKS[key] if v != cur.value])
            cur.valid_to = day
            f = self._new_fact(scope=p, key=key, value=new, valid_from=day, supersedes=cur.id)
            self._emit(day, "say", p, self._say("update", p, key, new, cur.value), [f.id, cur.id])
        else:
            r = rng.random()
            if r < 0.5:
                key = rng.choice(list(USER_KEYS))
                cur = self.current("user", key, day)
                if not cur or day - cur.valid_from < 60:
                    return
                new = rng.choice([v for v in USER_KEYS[key] if v != cur.value])
                cur.valid_to = day
                f = self._new_fact(scope="user", key=key, value=new, valid_from=day, supersedes=cur.id)
                self._emit(day, "say", "user", self._say("user-update", "user", key, new, cur.value), [f.id, cur.id])
            else:
                key = rng.choice(list(PREFERENCES))
                cur = self.current("user", key, day)
                if not cur or day - cur.valid_from < 90:
                    return
                new = rng.choice([v for v in PREFERENCES[key] if v != cur.value])
                cur.valid_to = day
                f = self._new_fact(scope="user", key=key, value=new, valid_from=day, supersedes=cur.id, kind="preference")
                self._emit(day, "say", "user", self._say("pref-update", "user", key, new, cur.value), [f.id, cur.id])

    def _restate(self, day: int):
        p = self.rng.choice(self.projects)
        key = self.rng.choice(list(STACKS))
        cur = self.current(p, key, day)
        if cur:
            self._emit(day, "say", p, f"As a reminder, {_h(p)} still has {cur.value} as its {HUMAN_KEYS[key]}.", [cur.id])

    def _task(self, day: int, proc: dict):
        rng = self.rng
        p = rng.choice(self.projects)
        kind = rng.choice(list(TASK_KINDS))
        steps, causes = TASK_KINDS[kind]
        st = self.task_state.setdefault((p, kind), {"failures": 0, "cause": None, "fix_day": None})
        ask = self._emit(day, "task", p, f"Please do the {kind} for project {p}.", task_kind=kind)
        # outcome: fail with a recurring cause until the user teaches the fix after the second failure
        if st["fix_day"] is None and rng.random() < 0.45:
            cause = st["cause"] or rng.choice(causes)
            st["cause"] = cause
            st["failures"] += 1
            self._emit(day, "outcome", p, f"The {kind} for project {p} failed: {cause}.", task_kind=kind, cause=cause, failed=True)
            fc = self.current(p, f"failure-cause:{kind}", day)
            if not fc:
                self._new_fact(scope=p, key=f"failure-cause:{kind}", value=cause, valid_from=day, kind="failure-cause")
            if st["failures"] >= 2:
                fix = f"check that {cause.split(' was ')[0] if ' was ' in cause else cause} is handled before starting"
                st["fix_day"] = day
                f = self._new_fact(scope=p, key=f"fix:{kind}", value=fix, valid_from=day, kind="procedure")
                self._emit(day, "teach", p, f"This keeps happening on {kind} for {p}. From now on, {fix}.", [f.id])
        else:
            self._emit(day, "outcome", p, f"The {kind} for project {p} went fine.", task_kind=kind, failed=False)

    def _make_probes(self, rule_days: dict, proc: dict):
        rng = self.rng
        N = self.days
        # stable and reversal facts, probed at several later points
        for scope in ["user"] + self.projects:
            keys = {f.key for f in self.facts if f.scope == scope and f.kind in ("fact", "preference")}
            for key in keys:
                hist = self.history(scope, key)
                newest = hist[-1]
                probe_days = sorted({min(N - 1, newest.valid_from + d) for d in (3, 30, 90, 200) if newest.valid_from + d < N})
                for pd in probe_days:
                    cur = self.current(scope, key, pd)
                    q = self._question(scope, key)
                    if cur is None:
                        old = [f.value for f in hist]
                        self._probe(pd, "expired", scope, q, "UNKNOWN", wrong=old, fact_ids=[f.id for f in hist], newest_day=newest.valid_from)
                    elif len(hist) > 1:
                        old = [f.value for f in hist if f.id != cur.id]
                        cls = "preference" if cur.kind == "preference" else "reversal"
                        self._probe(pd, cls, scope, q, cur.value, wrong=old, fact_ids=[cur.id], newest_day=cur.valid_from)
                    else:
                        cls = "preference" if cur.kind == "preference" else "stable"
                        self._probe(pd, cls, scope, q, cur.value, fact_ids=[cur.id], newest_day=cur.valid_from)
        # expiry probes: a fact that ended with no successor
        for f in self.facts:
            if f.valid_to is not None and not any(g.supersedes == f.id for g in self.facts) and f.kind == "fact":
                for d in (20, 90):
                    pd = f.valid_to + d
                    if pd < N:
                        self._probe(pd, "expired", f.scope, self._question(f.scope, f.key), "UNKNOWN", wrong=[f.value], fact_ids=[f.id], newest_day=f.valid_to)
        # scope probes: same key across two projects
        for key in list(STACKS):
            withkey = [p for p in self.projects if self.current(p, key, N - 1)]
            if len(withkey) >= 2:
                a, b = rng.sample(withkey, 2)
                pd = rng.randint(N // 2, N - 1)
                ca, cb = self.current(a, key, pd), self.current(b, key, pd)
                if ca and cb and ca.value != cb.value:
                    self._probe(pd, "scope", a, self._question(a, key), ca.value, wrong=[cb.value], fact_ids=[ca.id], newest_day=ca.valid_from)
        # procedures
        for (p, kind), (day, steps) in proc.items():
            pd = min(N - 1, day + rng.choice([20, 120, 250]))
            self._probe(pd, "procedure", p, f"How do we do a {kind} for project {p}? List the steps in order.", " -> ".join(steps), fact_ids=[], newest_day=day)
        # rules (form-judged)
        for form, day in rule_days.items():
            pd = min(N - 1, day + rng.choice([15, 100, 220]))
            if form == "asks-confirmation":
                q = f"Delete the old build artifacts for project {rng.choice(self.projects)} now."
            else:
                q = f"Give me a two-sentence status update on project {rng.choice(self.projects)}."
            self._probe(pd, "rule", "user", q, "FORM", form=form, newest_day=day)
        # failure causes and adaptation
        for (p, kind), st in self.task_state.items():
            if st["cause"]:
                fc = self.current(p, f"failure-cause:{kind}", N - 1)
                pd = min(N - 1, (st["fix_day"] or fc.valid_from) + rng.choice([10, 60, 150]))
                self._probe(pd, "failure-cause", p, f"Why did the {kind} for project {p} fail last time?", st["cause"], newest_day=fc.valid_from)
                if st["fix_day"] is not None:
                    fix = self.current(p, f"fix:{kind}", N - 1)
                    self._probe(min(N - 1, st["fix_day"] + rng.choice([7, 90])), "adaptation", p,
                                f"Do the {kind} for project {p}. Tell me what you do first.", "FORM", form=f"applies:{fix.value}", newest_day=st["fix_day"])
        # distractors: keys never stated
        for _ in range(8):
            p = rng.choice(self.projects)
            key = rng.choice(["monitoring stack", "on-call rota", "domain registrar", "license", "design tool"])
            pd = rng.randint(min(30, N - 2), N - 1)
            self._probe(pd, "distractor", p, f"What is the {key} for project {p}?", "UNKNOWN", newest_day=0)

    def _question(self, scope: str, key: str) -> str:
        kh = HUMAN_KEYS.get(key, key)
        if scope == "user":
            return f"What is my {kh}?"
        return f"What is the {kh} for project {scope}?"

    # ---- optional paraphrase (realism), value-preserving
    def paraphrase(self, llm, kinds=("say", "teach"), min_len: int = 20) -> int:
        """Rewrite fact-bearing events in varied wording with a local model. A rewrite is
        kept only if every value the event carries still appears verbatim; otherwise the
        template text stands. Cached by the model client, so re-generation is free."""
        by_id = {f.id: f for f in self.facts}
        changed = 0
        for e in self.events:
            if e.kind not in kinds or len(e.text) < min_len:
                continue
            values = [by_id[i].value for i in e.facts if i in by_id]
            must = values + ([e.scope] if e.scope != "user" else [])
            prompt = ("Rewrite the following chat message from a user to their assistant in different, natural wording. "
                      "Keep EXACTLY these strings unchanged and present: " + "; ".join(repr(m) for m in must) +
                      ". Keep the meaning, keep it one or two sentences, no preamble, output only the rewritten message."
                      + chr(10) * 2 + "MESSAGE: " + e.text)
            r = llm.complete(prompt, "You rewrite messages faithfully.")
            t = r.text.strip().strip('"')
            if t and all(m.lower() in t.lower() for m in must) and len(t) < 4 * len(e.text) + 40:
                e.meta["template"] = e.text
                e.text = t
                changed += 1
        return changed

    # ---- persistence
    def save(self, out: Path):
        out.mkdir(parents=True, exist_ok=True)
        (out / "world.json").write_text(json.dumps({
            "version": WORLD_VERSION, "seed": self.seed, "days": self.days, "density": self.density,
            "user": self.user, "projects": self.projects, "scopes": ["user"] + self.projects,
        }, indent=1), encoding="utf-8")
        (out / "facts.json").write_text(json.dumps(to_json(self.facts), indent=1), encoding="utf-8")
        (out / "events.json").write_text(json.dumps(to_json(self.events), indent=1), encoding="utf-8")
        (out / "probes.json").write_text(json.dumps(to_json(self.probes), indent=1), encoding="utf-8")

    @staticmethod
    def load(path: Path) -> dict:
        meta = json.loads((path / "world.json").read_text(encoding="utf-8"))
        events = [Event(**e) for e in json.loads((path / "events.json").read_text(encoding="utf-8"))]
        probes = [Probe(**p) for p in json.loads((path / "probes.json").read_text(encoding="utf-8"))]
        facts = [Fact(**f) for f in json.loads((path / "facts.json").read_text(encoding="utf-8"))]
        return {"meta": meta, "events": events, "probes": probes, "facts": facts}
