"""Screenshot prototype directions of the Council page (spark council-readout).

    python shoot-proto.py <base-url> <out-dir> <name> <query> [--sizes 1920x1080,1280x800] [--themes dark,light]

`query` is the harness query string without `theme`, e.g.
`variant=fused&live=1&panel=ledger&select=compliant-hiring-decision`.
Writes `<out-dir>/<name>-<w>x<h>-<theme>.png` for every size and theme, and
prints the page's console errors (a shot over a crashed page is not a shot).
Start the dev server first: `npx vite --host 127.0.0.1 --port <port> --strictPort`.
"""

import os
import sys

from playwright.sync_api import sync_playwright

base, out, name, query = sys.argv[1:5]
opts = dict(zip(sys.argv[5::2], sys.argv[6::2]))
sizes = [tuple(int(x) for x in s.split("x")) for s in opts.get("--sizes", "1920x1080,1280x800").split(",")]
themes = opts.get("--themes", "dark,light").split(",")
os.makedirs(out, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    for w, h in sizes:
        for theme in themes:
            page = browser.new_page(viewport={"width": w, "height": h})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            url = f"{base}/src/features/companions/curator/council/__shots__/harness.html?theme={theme}&{query}"
            page.goto(url, wait_until="networkidle", timeout=120_000)
            page.wait_for_timeout(2500)
            path = os.path.join(out, f"{name}-{w}x{h}-{theme}.png")
            page.screenshot(path=path)
            print(f"shot {path}" + (f"  ERRORS: {errors[:3]}" if errors else ""))
            page.close()
    browser.close()
