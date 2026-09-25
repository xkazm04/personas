"""Drive every interaction the owner named on the Cadastre, and assert on the page's state.

    npx vite --host 127.0.0.1 --port 1427 --strictPort      (from the repo root, in another shell)
    python src/features/teams/sub_features/__shots__/drive-cadastre.py [--base http://127.0.0.1:1427] [--width 1280x800]

The harness is the product's real page, stylesheet and theme store with the checked-in fixture
(the DEV switch). Every assertion reads the page's own state, which the Cadastre root publishes
as data attributes (data-focus, data-sel, data-filter, data-lens, data-tip, data-hot, data-ask,
data-last-write, data-rows), or the ARIA state the keyboard leaves behind: what the page holds
and what a write would send, not what the pixels look like. Exits non-zero on the first failed
expectation of each check and prints one PASS / FAIL line per check.

Promotion plan section 1, "Interactions to drive": Enter opens the layer with the transition
and the rose blooms; [ ] step deeds and the breadcrumb follows; Esc closes and returns focus to
the row; w i u filter and light parcels; u swaps the register for the unclaimed list; hovering
a parcel names its claim; l draws the survey line in the lens; Promote to major opens the
confirm with the numbers; the 100-row rehearsal keeps every register name unclipped at 312px.
"""

import argparse
import sys

from playwright.sync_api import sync_playwright

HARNESS = "/src/features/teams/sub_features/__shots__/harness.html?variant=cadastre&theme=dark"
ROOT = "[data-role=cad-page]"
RESULTS = []


def state(pg):
    return pg.evaluate(f"() => ({{...document.querySelector('{ROOT}').dataset}})")


def check(name, fn):
    try:
        detail = fn()
        RESULTS.append(True)
        print(f"PASS  {name}" + (f"  ({detail})" if detail else ""))
    except AssertionError as e:
        RESULTS.append(False)
        print(f"FAIL  {name}: {e}")


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def open_page(p, base, width, measure=False):
    w, h = (int(x) for x in width.split("x"))
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": w, "height": h})
    pg.goto(base + HARNESS + ("&measure=1" if measure else ""), wait_until="networkidle")
    pg.wait_for_timeout(2000)
    pg.click('[data-testid="features-page"] [role=switch]')
    pg.wait_for_selector(ROOT)
    pg.wait_for_timeout(1200)
    # count view transitions the page starts
    pg.evaluate("""() => { window.__vt = 0; const o = document.startViewTransition?.bind(document);
      if (o) document.startViewTransition = (cb) => { window.__vt += 1; return o(cb); }; }""")
    return b, pg


def rows(pg):
    return pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-row]')].map(r => ({key: r.dataset.key, name: r.querySelector('.nt').textContent}))")


def run(base, width):
    with sync_playwright() as p:
        b, pg = open_page(p, base, width)
        reg = rows(pg)

        def enter_opens():
            pg.focus("[data-testid=cad-list]")
            pg.keyboard.press("j")
            s = state(pg)
            expect(s["focus"] == reg[0]["key"], f"j focused {s['focus']!r}, expected {reg[0]['key']!r}")
            expect(pg.locator("[data-testid=cad-survey]").count() == 1, "no survey line for the focused deed")
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(200)
            s = state(pg)
            expect(s["sel"] == reg[0]["key"], f"Enter opened {s['sel']!r}")
            expect(pg.evaluate("window.__vt") == 1, "the view transition did not run")
            expect(not pg.locator("[data-testid=cad-layer]").get_attribute("hidden") is not None, "layer hidden")
            petals = pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-petal]')].map(e => getComputedStyle(e).animationName + '@' + getComputedStyle(e).animationDelay)")
            expect(len(petals) == 5 and all(x.startswith("cad-bloom") for x in petals), f"petals {petals}")
            expect(len({x.split('@')[1] for x in petals}) == 5, f"the bloom is not staggered: {petals}")
            pg.wait_for_timeout(1200)
            ops = pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-petal]')].map(e => getComputedStyle(e).opacity)")
            expect(all(o == "1" for o in ops), f"petals not bloomed: {ops}")
            return f"sel={s['sel']}, 5 petals bloom staggered"

        def step_deeds():
            pg.keyboard.press("]")
            pg.wait_for_timeout(250)
            s = state(pg)
            cur = pg.inner_text("[data-testid=cad-crumb-current]")
            pos = pg.inner_text("[data-role=cad-layer-position]")
            expect(s["sel"] == reg[1]["key"] and cur == reg[1]["name"], f"] went to {s['sel']!r} / crumb {cur!r}")
            expect(pos.startswith("2 "), f"position {pos!r}")
            pg.keyboard.press("[")
            pg.wait_for_timeout(250)
            s = state(pg)
            expect(s["sel"] == reg[0]["key"] and pg.inner_text("[data-testid=cad-crumb-current]") == reg[0]["name"], "[ did not step back")
            return f"] -> {reg[1]['name']} ({pos}), [ -> {reg[0]['name']}"

        def esc_returns_focus():
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(700)
            s = state(pg)
            active = pg.evaluate("() => ({t: document.activeElement?.dataset.testid, ad: document.activeElement?.getAttribute('aria-activedescendant')})")
            row = pg.evaluate("(id) => { const e = document.getElementById(id); return e && e.dataset.key + '|' + e.getAttribute('aria-selected'); }", active["ad"] or "")
            expect(s["sel"] == "", f"layer still open: {s['sel']!r}")
            expect(active["t"] == "cad-list" and row == f"{reg[0]['key']}|true", f"focus {active}, row {row}")
            return f"focus on the register, active row {reg[0]['key']}"

        def filters():
            out = []
            pg.keyboard.press("Escape")  # back one level: the preview goes, the ground is shown whole
            pg.wait_for_timeout(200)
            for key, filt, tone in (("w", "waiting", "gate"), ("i", "trouble", "trouble")):
                pg.keyboard.press(key)
                pg.wait_for_timeout(250)
                s = state(pg)
                expect(s["filter"] == filt, f"{key} set filter {s['filter']!r}")
                listed = [r["key"] for r in rows(pg)]
                groups = pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-group]')].map(g => g.firstChild.textContent)")
                expect(len(listed) == int(s["rows"]) and len(groups) == 1, f"{key}: {len(listed)} rows under {groups}")
                expect(s["focus"] in listed, f"{key}: focus {s['focus']!r} is not a {filt} deed")
                lit = pg.evaluate("() => [...document.querySelectorAll('.map.dim [data-role=cad-parcel].keep')].map(e => e.dataset.ctx)")
                expect(len(lit) > 0, f"{key}: no parcel lit")
                # the winner's rule, kept: with no deed previewed the filter's tone is lit;
                # when the focus moves onto a deed of the filter, its slice is surveyed instead
                slice_ = pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-parcel].in')].map(e => e.dataset.ctx)")
                tone_all = pg.evaluate(f"() => [...document.querySelectorAll('[data-role=cad-parcel][data-tone={tone}]')].map(e => e.dataset.ctx)")
                expect(set(lit) == set(slice_) if slice_ else set(lit) == set(tone_all), f"{key}: lit {len(lit)}, slice {len(slice_)}, {tone} {len(tone_all)}")
                out.append(f"{key}: {len(listed)} {filt} rows, {len(lit)} parcels lit ({'the focused deed' if slice_ else 'every ' + tone + ' parcel'})")
                pg.keyboard.press(key)
                pg.wait_for_timeout(150)
                expect(state(pg)["filter"] == "", f"{key} again did not clear")
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(150)
            pg.keyboard.press("u")
            pg.wait_for_timeout(250)
            s = state(pg)
            n_list = pg.locator("[data-testid=cad-unclaimed]").count()
            n_open = pg.evaluate("() => document.querySelectorAll('[data-role=cad-parcel][data-tone=open]').length")
            expect(s["filter"] == "unclaimed" and n_list == n_open, f"u: filter {s['filter']!r}, list {n_list} vs {n_open} open parcels")
            pg.keyboard.press("j")
            pg.wait_for_timeout(150)
            s = state(pg)
            first = pg.locator("[data-testid=cad-unclaimed]").first.get_attribute("data-ctx")
            hot = pg.evaluate("(id) => document.querySelector(`[data-role=cad-parcel][data-ctx=\"${id}\"]`)?.classList.contains('hot')", first)
            expect(s["hot"] == first and hot, f"j in u mode: hot {s['hot']!r} vs {first!r}, parcel lit {hot}")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            s = state(pg)
            expect(s["filter"] == "" and s["sort"] == "move" and s["sel"] == "", f"Esc left {s}")
            out.append(f"u: {n_list} unclaimed listed, j lights {first}")
            return "; ".join(out)

        def hover_names_claim():
            ctx = pg.evaluate("() => document.querySelector('[data-role=cad-parcel][data-tone=gate]').dataset.ctx")
            pg.hover(f'[data-role=cad-parcel][data-ctx="{ctx}"]')
            pg.wait_for_timeout(300)
            s = state(pg)
            expect(s["tip"] == ctx, f"tip names {s['tip']!r}, hovered {ctx!r}")
            names = pg.evaluate("() => [...document.querySelectorAll('[data-testid=cad-tip-claimant] span:last-child')].map(e => e.textContent)")
            hot = pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-row].claims-hot .nt')].map(e => e.textContent)")
            expect(names and sorted(names) == sorted(hot), f"tip {names} vs lit rows {hot}")
            return f"{ctx}: claimed by {', '.join(names)}"

        def lens_survey():
            pg.mouse.move(5, 5)
            pg.wait_for_timeout(300)
            pg.focus("[data-testid=cad-list]")
            pg.keyboard.press("j")  # a deed in view, so the lens has a survey line to carry
            pg.keyboard.press("l")
            s = state(pg)
            expect(s["lens"] == "on", "l did not turn the lens on")
            prim = pg.evaluate("() => { const f = document.querySelector('[data-role=cad-survey-group] .sv-prim'); const r = f.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
            pg.mouse.move(prim[0] - 2, prim[1] - 2)
            pg.mouse.move(prim[0], prim[1])
            pg.wait_for_timeout(250)
            shown = pg.evaluate("() => !document.querySelector('[data-role=cad-lens]').hidden")
            line = pg.locator("[data-role=cad-lens-survey]").count()
            expect(shown and line == 1, f"lens shown {shown}, survey line in lens {line}")
            pg.keyboard.press("l")
            expect(state(pg)["lens"] == "off", "l again did not put the lens away")
            return "lens over the primary parcel carries the survey line"

        def promote_confirm():
            target = next(r for r in reg if r["name"] == "GDPR Data Erasure")
            pg.click(f'[data-role=cad-row][data-key="{target["key"]}"]')
            pg.wait_for_timeout(900)
            overall = pg.text_content(".r-ov")
            coverage = pg.text_content(".rg-t")
            pg.keyboard.press("a")
            pg.wait_for_timeout(300)
            s = state(pg)
            body = pg.inner_text("[role=dialog]")
            expect(s["ask"] == "promote", f"a asked {s['ask']!r}")
            expect(overall in body and coverage in body, f"confirm lacks the numbers {overall}/{coverage}: {body!r}")
            pg.get_by_role("dialog").get_by_role("button").last.click()
            pg.wait_for_timeout(400)
            s = state(pg)
            expect(s["lastWrite"] == f"tier:{target['key']}:major" and s["ask"] == "", f"write {s['lastWrite']!r}, ask {s['ask']!r}")
            tier = pg.inner_text("[data-role=cad-layer-head] .chips")
            expect("Standard tier" in tier, "the fixture accepted a write it must refuse")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(600)
            return f"confirm shows overall {overall} and coverage {coverage}; would send {s['lastWrite']}; fixture refused it"

        check("Enter opens the layer with the transition, the rose blooms", enter_opens)
        check("[ ] step deeds, the breadcrumb follows", step_deeds)
        check("Esc closes and returns focus to the row", esc_returns_focus)
        check("w i u filter and light parcels; u lists the unclaimed ground", filters)
        check("hovering a parcel names its claim", hover_names_claim)
        check("l draws the survey line in the lens", lens_survey)
        check("Promote to major opens the confirm with the numbers", promote_confirm)
        b.close()

        for measure in (True, False):
            b, pg = open_page(p, base, width, measure=measure)

            def hundred():
                pg.focus("[data-testid=cad-list]")
                pg.keyboard.press("d")
                pg.wait_for_timeout(600)
                s = state(pg)
                clipped = pg.evaluate("() => [...document.querySelectorAll('[data-role=cad-row] .nt')].filter(n => n.scrollWidth > n.clientWidth).map(n => n.textContent)")
                reg_w = pg.evaluate("() => document.querySelector('[data-role=cad-register]').getBoundingClientRect().width")
                root = pg.evaluate("() => getComputedStyle(document.documentElement).fontSize")
                expect(s["rows"] == "100", f"rehearsal rows {s['rows']}")
                expect(not clipped, f"{len(clipped)} names clipped: {clipped[:3]}")
                return f"100 rows, 0 names clipped, register {reg_w:g}px at root {root}"

            check(f"the 100-row rehearsal keeps every name unclipped ({'16px root' if measure else 'product default root'})", hundred)
            b.close()

    print(f"\n{sum(RESULTS)} of {len(RESULTS)} checks passed")
    return 0 if all(RESULTS) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:1427")
    ap.add_argument("--width", default="1280x800")
    a = ap.parse_args()
    sys.exit(run(a.base, a.width))
