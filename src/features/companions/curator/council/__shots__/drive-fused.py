"""Drive every owner-named interaction of the fused Council HUD in a browser.

    python drive-fused.py [base-url]      (default http://127.0.0.1:1428)

Serves nothing itself: start the dev server from the checkout first
(`npx vite --host 127.0.0.1 --port 1428 --strictPort`). Reads the page's own
engine (`window.__council`) and store (`window.__councilStore`), which the
harness publishes, and asserts on what the engine reports, not on pixels.
Prints one line per check and exits non-zero if any check fails.
"""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1428"
URL = f"{BASE}/src/features/companions/curator/council/__shots__/harness.html?variant=fused&theme=dark"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")


# Where the engine draws a world point, in page coordinates.
SCREEN = """([wx, wy]) => {
  const e = window.__council; const c = e.getCamera(); const v = e.getViewport();
  const r = document.querySelector('[data-role=hud-field]').getBoundingClientRect();
  return [r.left + (wx - c.x) * c.k + (v.x0 + v.x1) / 2, r.top + (wy - c.y) * c.k + (v.y0 + v.y1) / 2];
}"""
CAM = "() => window.__council.getCamera()"
PATH = """() => { const p = window.__council.getPath();
  return [p.domain && p.domain.slug, p.category && p.category.id, p.subject && p.subject.slug, p.technique && p.technique.slug]; }"""


def settle(pg, ms=900):
    pg.wait_for_timeout(ms)


def click_world(pg, x, y):
    sx, sy = pg.evaluate(SCREEN, [x, y])
    pg.mouse.click(sx, sy)
    settle(pg)


def same(a, b, eps=1e-6):
    return all(abs(a[k] - b[k]) < eps for k in ("x", "y", "k"))


with sync_playwright() as p:
    browser = p.chromium.launch()
    pg = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto(URL, wait_until="networkidle")
    settle(pg, 2800)
    pg.mouse.move(2, 790)

    # 1. Four clicks, sky to technique, no zoom gesture; four Esc back.
    start = pg.evaluate(CAM)
    lay = "window.__councilStore.getState().layout"
    dom = pg.evaluate(f"() => {{ const d = {lay}.domains.find(x => x.slug === 'software-engineering') || {lay}.domains[0]; return [d.x, d.y]; }}")
    click_world(pg, *dom)
    cat = pg.evaluate("() => { const c = window.__council.getPath().domain.categories[0]; return [c.x, c.y]; }")
    click_world(pg, *cat)
    sub = pg.evaluate("() => { const s = window.__council.getPath().category.subjects[0]; return [s.x, s.y]; }")
    click_world(pg, *sub)
    tech = pg.evaluate("() => { const t = window.__council.getPath().subject.techniques[0]; return [t.x, t.y]; }")
    click_world(pg, *tech)
    path = pg.evaluate(PATH)
    doc = pg.evaluate("() => !!document.querySelector('[data-role=hud-doc]')")
    check("four clicks reach a technique", all(path), json.dumps(path))
    check("the pinned technique opens the document", doc)
    for _ in range(4):
        pg.keyboard.press("Escape")
        settle(pg, 700)
    back = pg.evaluate(CAM)
    check("four Esc return to the same camera", same(start, back), f"start={start} back={back}")
    check("four Esc return to the sky", pg.evaluate(PATH) == [None, None, None, None])

    # 2. The needle lands with the camera, not before it.
    samples = pg.evaluate("""async () => {
      const e = window.__council; const out = [];
      const needle = document.querySelector('.fz-needle');
      e.goTo(e.getLayout().domains[0]);
      for (let i = 0; i < 40; i++) { await new Promise(r => requestAnimationFrame(r));
        const f = e.getFlight(); out.push([f.flying, f.e, e.getAltitude(), needle.style.transform]); }
      return out; }""")
    flying = [s for s in samples if s[0]]
    arrived_early = [s for s in flying if s[1] < 0.98 and abs(s[2] - 1) < 1e-6]
    mid = [s for s in flying if 0.2 < s[1] < 0.8]
    check("the needle rides the flight's curve (mid-flight altitude between rungs)", bool(mid) and all(0 < s[2] < 1 for s in mid), json.dumps(mid[:2]))
    check("the needle does not arrive before the camera", not arrived_early and abs(samples[-1][2] - 1) < 1e-6)
    pg.keyboard.press("Escape")
    settle(pg)

    # 3. M cycles lens, bar, none; each switch is a flight on the engine's curve.
    def dock_mid(key):
        return pg.evaluate("""async (key) => {
          const e = window.__council; document.body.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: key === 'M', bubbles: true }));
          const vals = [];
          for (let i = 0; i < 30; i++) { await new Promise(r => requestAnimationFrame(r)); const f = e.getFlight(); vals.push([f.flying, f.e, e.getInsets().b, e.getInsets().l]); }
          return vals; }""", key)

    modes = []
    trace = dock_mid("m")  # bar -> none: the dock sinks
    modes.append(pg.evaluate("() => document.querySelector('[data-role=hud-mode][aria-pressed=true]').dataset.mode"))
    sinking = [v for v in trace if v[0] and 0.2 < v[1] < 0.8]
    check("M: bar to none, the dock sinks on the curve", bool(sinking) and all(0 < v[2] < 104 for v in sinking), f"mid b={[round(v[2], 1) for v in sinking[:3]]}")
    trace = dock_mid("m")  # none -> lens
    modes.append(pg.evaluate("() => document.querySelector('[data-role=hud-mode][aria-pressed=true]').dataset.mode"))
    opening = [v for v in trace if v[0] and 0.2 < v[1] < 0.8]
    check("M: none to lens, the column inset eases", bool(opening) and all(262 < v[3] < 284 for v in opening), f"mid l={[round(v[3], 1) for v in opening[:3]]}")
    trace = dock_mid("m")  # lens -> bar: the dock rises
    modes.append(pg.evaluate("() => document.querySelector('[data-role=hud-mode][aria-pressed=true]').dataset.mode"))
    rising = [v for v in trace if v[0] and 0.2 < v[1] < 0.8]
    check("M: lens to bar, the dock rises on the curve", bool(rising) and all(0 < v[2] < 104 for v in rising), f"mid b={[round(v[2], 1) for v in rising[:3]]}")
    check("M cycles none, lens, bar from bar", modes == ["none", "lens", "bar"], json.dumps(modes))
    live = pg.evaluate("() => document.querySelector('.fz-modes + .sr').textContent")
    check("the live region names the mode", "Cross-section" in live, live)

    # 4. S spreads and folds; the chips filter.
    pg.keyboard.press("s")
    settle(pg)
    spread = pg.evaluate("() => [document.querySelector('[data-role=hud-dock]').className, window.__council.getInsets().b]")
    check("S spreads the cross-section", "spread" in spread[0] and spread[1] > 104, json.dumps(spread))
    pg.keyboard.press("s")
    settle(pg)
    fold = pg.evaluate("() => [document.querySelector('[data-role=hud-dock]').className, window.__council.getInsets().b]")
    check("S folds it back to needs care", "spread" not in fold[0] and abs(fold[1] - 104) < 0.5, json.dumps(fold))
    before = pg.evaluate("() => document.querySelectorAll('[data-role=hud-care-cell]').length")
    pg.locator("[data-role=hud-chip]").nth(2).click()
    settle(pg, 300)
    after = pg.evaluate("() => document.querySelectorAll('[data-role=hud-care-cell]').length")
    pg.locator("[data-role=hud-chip]").nth(2).click()
    settle(pg, 300)
    restored = pg.evaluate("() => document.querySelectorAll('[data-role=hud-care-cell]').length")
    check("the rejected chip filters the care cells", after < before and restored == before, f"{before} -> {after} -> {restored}")

    # 5. W lights the waiting subjects.
    pg.mouse.move(2, 790)
    pg.keyboard.press("w")
    settle(pg)
    lit = pg.evaluate("() => { const s = window.__councilStore.getState(); return [s.focus.kind, s.counts.lit, !!document.querySelector('[data-role=hud-decision].on')]; }")
    check("W lights a waiting decision's stars", lit[0] == "council" and lit[1] > 0 and lit[2], json.dumps(lit))
    pg.keyboard.press("w")
    pg.keyboard.press("w")
    settle(pg)
    check("W cycles back to no decision", pg.evaluate("() => window.__councilStore.getState().focus.kind") == "none")

    # 6. In lens mode the arrows turn the dial and the field flies.
    pg.keyboard.press("Shift+M")
    settle(pg, 1200)
    pg.locator("[data-role=hud-tree-row]").nth(0).click()
    settle(pg)
    first = pg.evaluate(PATH)[0]
    cam0 = pg.evaluate(CAM)
    pg.keyboard.press("ArrowRight")
    settle(pg)
    second = pg.evaluate(PATH)[0]
    cam1 = pg.evaluate(CAM)
    check("lens: Right turns to the next domain and the field flies", first != second and not same(cam0, cam1), f"{first} -> {second}")
    pg.keyboard.press("ArrowLeft")
    settle(pg)
    check("lens: Left turns back", pg.evaluate(PATH)[0] == first)

    # 6b. On the dial's rim an arc shows the field's tooltip, and a click flies there.
    pg.keyboard.press("Escape")
    settle(pg)
    arc = pg.evaluate("""() => {
      const e = window.__council; const v = e.getViewport(); const w = v.x1 - v.x0; const h = v.y1 - v.y0;
      const half = Math.min(w, h) / 2; const sc = Math.max(0.45, Math.min(1.2, (half - 70) / 240));
      const rg = Math.max(60, half - 90 * sc); const cx = v.x0 + w / 2; const cy = v.y0 + h / 2;
      // At the sky the domains band is outermost and 24 * sc thick, three 8 * sc bands and gaps inside it.
      const r = rg + 7 * sc + 3 * (8 * sc + 4 * sc) + 12 * sc; const a = (-90 + 1.5) * Math.PI / 180;
      const f = document.querySelector('[data-role=hud-field]').getBoundingClientRect();
      return { x: f.left + cx + Math.cos(a) * r, y: f.top + cy + Math.sin(a) * r, first: e.getLayout().domains[0].slug };
    }""")
    pg.mouse.move(arc["x"], arc["y"])
    settle(pg, 300)
    tip = pg.evaluate("() => { const t = document.querySelector('[data-role=hud-tip]'); return [t.classList.contains('on'), t.textContent.slice(0, 60)]; }")
    check("lens: an arc on the rim shows the field's tooltip", tip[0], tip[1])
    pg.mouse.click(arc["x"], arc["y"])
    settle(pg)
    check("lens: a click on the arc flies there", pg.evaluate(PATH)[0] == arc["first"], arc["first"])

    # 7. A star inside the bezel is clickable where it is drawn.
    cat = pg.evaluate("() => { const c = window.__council.getPath().domain.categories[0]; return [c.x, c.y, c.id]; }")
    was = pg.evaluate(PATH)[1]
    click_world(pg, cat[0], cat[1])
    check("inside the glass a category is clicked where it is drawn", was is None and pg.evaluate(PATH)[1] == cat[2], cat[2])
    sub = pg.evaluate("() => { const s = window.__council.getPath().category.subjects[0]; return [s.x, s.y, s.slug]; }")
    click_world(pg, sub[0], sub[1])
    check("inside the glass a star is clicked where it is drawn", pg.evaluate(PATH)[2] == sub[2], sub[2])
    for _ in range(3):
        pg.keyboard.press("Escape")
        settle(pg, 600)

    # 8. Nothing moves at rest: zero animation frames once the field settles.
    idle = pg.evaluate("""async () => {
      let n = 0; const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { n += 1; return raf(cb); };
      await new Promise(r => setTimeout(r, 2000));
      window.requestAnimationFrame = raf; return n; }""")
    check("0 rAF at idle after settle", idle == 0, f"{idle} frames in 2 s")
    check("no page errors", not errors, json.dumps(errors[:3]))
    browser.close()

failed = results.count(False)
print(f"\n{len(results) - failed} of {len(results)} checks passed")
sys.exit(1 if failed else 0)
