"""The /curator --multi validator: every rule here was a measured seat failure (2026-10-12)."""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import multi as M  # noqa: E402

FILES = M.Files()
REL = "package.json"
LINES = FILES.lines(REL)
N = next(i for i, l in enumerate(LINES, 1) if '"name"' in l)
QUOTE = LINES[N - 1].strip()
SECOND = next(i for i, l in enumerate(LINES, 1) if '"version"' in l)
QUOTE2 = LINES[SECOND - 1].strip()
DOSSIER = {
    "domain": "software-engineering", "slug": "s",
    "techniques": [{"slug": t} for t in ("t1", "t2", "t3", "t4")],
    "pairs": [{"context": "ctx-a", "context_id": "id-a", "files": ["src/a.ts"]},
              {"context": "ctx-b", "context_id": "id-b", "files": ["src/b.ts"]}],
}


def tech(slug, verdict, n=N, q=QUOTE):
    return {"technique": slug, "verdict": verdict, "anchor": f"{REL}:{n}", "quote": q, "note": "n"}


def pair(ctx, state, techs, n=N, q=QUOTE):
    return {"context": ctx, "state": state, "anchor": f"{REL}:{n}", "quote": q,
            "consequence": "a consequence sentence long enough", "techniques": techs, "registryProposal": ""}


def answer(*pairs, notes=""):
    return {"subject": "s", "pairs": list(pairs), "declined": [], "notes": notes}


class Anchors(unittest.TestCase):
    def test_exact(self):
        self.assertEqual(M.check_anchor(FILES, f"{REL}:{N}", QUOTE), (f"{REL}:{N}", None, None))

    def test_absolute_windows_path_is_repaired_not_refused(self):
        fixed, _, bad = M.check_anchor(FILES, "C:\\Users\\kazda\\kiro\\personas\\" + f"{REL}:{N}", QUOTE)
        self.assertIsNone(bad)
        self.assertEqual(fixed, f"{REL}:{N}")

    def test_off_by_one_line_is_repaired(self):
        fixed, rep, bad = M.check_anchor(FILES, f"{REL}:{N + 1}", QUOTE)
        self.assertEqual((fixed, bad), (f"{REL}:{N}", None))
        self.assertIn("->", rep)

    def test_quote_found_nowhere_is_refused(self):
        self.assertIsNotNone(M.check_anchor(FILES, f"{REL}:{N}", "this text is in no line of the file")[2])

    def test_placeholder_and_untracked(self):
        self.assertIsNotNone(M.check_anchor(FILES, "src/x/y.ts:41", "whatever text")[2])
        self.assertIsNotNone(M.check_anchor(FILES, "no/such/file.ts:1", "whatever text")[2])


class Validate(unittest.TestCase):
    def test_read_nothing_refuses_the_whole_answer(self):
        v = M.validate(answer(pair("ctx-a", "deviation", [tech("t1", "deviation")])), DOSSIER, FILES,
                       "grok answered in 1 turn(s): no file was opened")
        self.assertEqual(v["pairs"], [])
        self.assertEqual(len(v["declined"]), 2)

    def test_self_disclaimer_refuses_but_scope_notes_do_not(self):
        bad = answer(pair("ctx-a", "deviation", [tech("t1", "deviation")]), notes="DRAFT ONLY - do not keep")
        self.assertEqual(M.validate(bad, DOSSIER, FILES)["pairs"], [])
        honest = answer(pair("ctx-a", "deviation", [tech("t1", "deviation")]),
                        notes="enforcement was not verified; empty fields contain no placeholder anchors")
        self.assertEqual(len(M.validate(honest, DOSSIER, FILES)["pairs"]), 1)

    def test_floor_counts_distinct_anchors(self):
        # four techniques, floor 2: one anchor reused four times is ONE piece of evidence
        padded = answer(pair("ctx-a", "conformant", [tech(t, "conformant") for t in ("t1", "t2", "t3", "t4")]))
        self.assertEqual(M.validate(padded, DOSSIER, FILES)["pairs"], [])
        real = answer(pair("ctx-a", "conformant", [tech("t1", "conformant"), tech("t2", "conformant", SECOND, QUOTE2)]))
        self.assertEqual(len(M.validate(real, DOSSIER, FILES)["pairs"]), 1)

    def test_conformant_with_a_deviating_technique_is_declined(self):
        a = answer(pair("ctx-a", "conformant", [tech("t1", "conformant"), tech("t2", "deviation", SECOND, QUOTE2)]))
        self.assertEqual(M.validate(a, DOSSIER, FILES)["pairs"], [])

    def test_smear_across_contexts_is_declined(self):
        a = answer(pair("ctx-a", "deviation", [tech("t1", "deviation")]),
                   pair("ctx-b", "deviation", [tech("t1", "deviation")]))
        v = M.validate(a, DOSSIER, FILES)
        self.assertEqual(v["pairs"], [])
        self.assertTrue(any("repo-wide" in r for r in v["rejections"]))

    def test_unknown_context_and_unknown_state_become_declines(self):
        v = M.validate(answer(pair("elsewhere", "deviation", []), pair("ctx-a", "unknown", [])), DOSSIER, FILES)
        self.assertEqual(v["pairs"], [])
        self.assertEqual([d["context"] for d in v["declined"]], ["ctx-a"])


class Envelope(unittest.TestCase):
    def test_last_json_object_skips_a_placeholder_draft(self):
        text = 'thinking {"pairs": [], "subject": "placeholder"} then {"pairs": [1], "subject": "s"}'
        self.assertEqual(M._last_json_object(text)["pairs"], [1])

    def test_limit_only_without_an_answer(self):
        self.assertTrue(M.seat_limited("", "You've hit your usage limit", 1, None))
        self.assertFalse(M.seat_limited("about rate limiting", "", 0, {"pairs": [{}]}))


if __name__ == "__main__":
    unittest.main()
