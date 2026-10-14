/* WP0 surface gallery: keys, theme, compare mode, and the two generated vector layers.
   No build step; opens from disk. URL params (s, t, blur, deck, scrim, thumb, shot) drive the
   screenshot run and the compare-mode thumbnails. */
(function () {
  'use strict';
  var CANDIDATES = [
    'Flat token surface (control)', 'Fine grain', 'Fine dot grid', 'Soft tonal field',
    'Quiet contour lines', 'Woven hairline', 'Calm network', 'Lit edge'
  ];
  var THEMES = ['dark-midnight', 'light', 'dark-cyan'];
  var root = document.documentElement;
  var q = new URLSearchParams(location.search);
  var S = {
    s: clamp(parseInt(q.get('s') || '3', 10), 1, 8),
    t: THEMES.indexOf(q.get('t')) >= 0 ? q.get('t') : 'dark-midnight',
    blur: q.get('blur') !== '0',
    deck: q.get('deck') !== '0',
    scrim: q.get('scrim') === '1'
  };
  if (q.get('thumb') === '1') root.classList.add('thumb');
  if (q.get('shot') === '1') root.classList.add('shot');

  function clamp(n, a, b) { return isNaN(n) ? a : Math.max(a, Math.min(b, n)); }
  function $(id) { return document.getElementById(id); }

  /* Deterministic PRNG so every load (and every screenshot) draws the same lines. */
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

  /* 5. contour lines: marching squares over a smooth field of a few broad hills. */
  function drawContours() {
    var W = 1600, H = 900, step = 10, nx = W / step + 1, ny = H / step + 1, r = rng(7);
    var hills = [];
    for (var h = 0; h < 7; h++) hills.push({ x: r() * W, y: r() * H, s: 180 + r() * 260, a: (r() < .3 ? -1 : 1) * (.6 + r() * .6) });
    var f = new Float32Array(nx * ny);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var x = i * step, y = j * step, v = .25 * Math.sin(x / 310 + y / 520) + .2 * Math.cos(y / 270 - x / 640);
      for (var k = 0; k < hills.length; k++) { var dx = x - hills[k].x, dy = y - hills[k].y; v += hills[k].a * Math.exp(-(dx * dx + dy * dy) / (2 * hills[k].s * hills[k].s)); }
      f[j * nx + i] = v;
    }
    var svg = $('sf-contour'), out = [];
    for (var L = -1.2, li = 0; L <= 1.8; L += .12, li++) {
      var d = [];
      for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
        var a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i + 1], e = f[(j + 1) * nx + i];
        var idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (e > L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        var x0 = i * step, y0 = j * step;
        var top = [x0 + step * (L - a) / (b - a), y0], right = [x0 + step, y0 + step * (L - b) / (c - b)],
            bot = [x0 + step * (L - e) / (c - e), y0 + step], left = [x0, y0 + step * (L - a) / (e - a)];
        var segs = {
          1: [[left, bot]], 2: [[bot, right]], 3: [[left, right]], 4: [[top, right]], 5: [[left, top], [bot, right]],
          6: [[top, bot]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bot]], 10: [[top, right], [left, bot]],
          11: [[top, right]], 12: [[left, right]], 13: [[bot, right]], 14: [[left, bot]]
        }[idx];
        for (var s = 0; s < segs.length; s++) d.push('M' + segs[s][0][0].toFixed(1) + ' ' + segs[s][0][1].toFixed(1) + 'L' + segs[s][1][0].toFixed(1) + ' ' + segs[s][1][1].toFixed(1));
      }
      if (d.length) out.push('<path' + (li % 5 === 0 ? ' class="major"' : '') + ' d="' + d.join('') + '"/>');
    }
    svg.innerHTML = out.join('');
  }

  /* 7. calm network: sparse nodes, each joined to its two nearest neighbours, kept off the centre. */
  function drawNetwork() {
    var W = 1600, H = 900, r = rng(42), nodes = [];
    while (nodes.length < 34) {
      var x = r() * W, y = r() * H, cx = (x - W * .55) / (W * .5), cy = (y - H * .55) / (H * .5);
      if (cx * cx + cy * cy < .35 && r() < .8) continue; /* fewer nodes behind the bays */
      nodes.push([x, y]);
    }
    var seen = {}, lines = [], dots = [];
    nodes.forEach(function (n, i) {
      var near = nodes.map(function (m, j) { return [j, (m[0] - n[0]) * (m[0] - n[0]) + (m[1] - n[1]) * (m[1] - n[1])]; })
        .filter(function (p) { return p[0] !== i; }).sort(function (p, q2) { return p[1] - q2[1]; }).slice(0, 2);
      near.forEach(function (p) {
        var key = Math.min(i, p[0]) + '-' + Math.max(i, p[0]); if (seen[key]) return; seen[key] = 1;
        lines.push('<line x1="' + n[0].toFixed(0) + '" y1="' + n[1].toFixed(0) + '" x2="' + nodes[p[0]][0].toFixed(0) + '" y2="' + nodes[p[0]][1].toFixed(0) + '"/>');
      });
      dots.push('<circle cx="' + n[0].toFixed(0) + '" cy="' + n[1].toFixed(0) + '" r="' + (i % 7 === 0 ? 3 : 2) + '"/>');
      if (i % 9 === 0) dots.push('<circle class="ring" cx="' + n[0].toFixed(0) + '" cy="' + n[1].toFixed(0) + '" r="9"/>');
    });
    $('sf-net').innerHTML = lines.join('') + dots.join('');
  }

  function apply() {
    root.setAttribute('data-theme', S.t);
    root.setAttribute('data-surface', String(S.s));
    root.classList.toggle('noblur', !S.blur);
    root.classList.toggle('deck-on', S.deck);
    root.classList.toggle('scrim-on', S.scrim && S.deck);
    $('hud-n').textContent = S.s + ' / 8';
    $('hud-name').textContent = CANDIDATES[S.s - 1];
    $('hud-theme').textContent = S.t;
    $('hud-blur').textContent = S.blur ? 'blur on' : 'blur off';
    if ($('cmp').classList.contains('open')) buildCompare();
  }

  function buildCompare() {
    var grid = $('cmp-grid'), html = [];
    $('cmp-theme').textContent = S.t + (S.blur ? ' · blur on' : ' · blur off');
    for (var n = 1; n <= 8; n++) {
      html.push('<figure data-n="' + n + '"><div class="frame"><iframe loading="eager" tabindex="-1" title="' + CANDIDATES[n - 1] + '" src="index.html?thumb=1&s=' + n +
        '&t=' + S.t + '&blur=' + (S.blur ? 1 : 0) + '&deck=' + (S.deck ? 1 : 0) + '"></iframe></div><figcaption><kbd>' + n + '</kbd><b>' + CANDIDATES[n - 1] + '</b></figcaption></figure>');
    }
    grid.innerHTML = html.join('');
    fitThumbs();
    Array.prototype.forEach.call(grid.querySelectorAll('figure'), function (fig) {
      fig.onclick = function () { S.s = +fig.getAttribute('data-n'); $('cmp').classList.remove('open'); apply(); };
    });
  }
  function fitThumbs() {
    Array.prototype.forEach.call(document.querySelectorAll('.cmp .frame'), function (fr) {
      var ifr = fr.querySelector('iframe'); if (ifr) ifr.style.transform = 'scale(' + (fr.clientWidth / 1600) + ')';
    });
  }
  window.addEventListener('resize', fitThumbs);

  document.addEventListener('keydown', function (e) {
    if (root.classList.contains('thumb') || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, low = k.length === 1 ? k.toLowerCase() : k;
    if (k >= '1' && k <= '8') { S.s = +k; $('cmp').classList.remove('open'); apply(); return; }
    if (low === 't') { S.t = THEMES[(THEMES.indexOf(S.t) + 1) % THEMES.length]; apply(); return; }
    if (low === 'g') { S.blur = !S.blur; apply(); return; }
    if (low === 'd') { S.deck = !S.deck; apply(); return; }
    if (low === 's') { S.scrim = !S.scrim; apply(); return; }
    if (low === 'c') { var c = $('cmp'); c.classList.toggle('open'); if (c.classList.contains('open')) buildCompare(); else $('cmp-grid').innerHTML = ''; return; }
    if (k === '?') { $('help').classList.toggle('open'); return; }
    if (k === 'Escape') { $('help').classList.remove('open'); $('cmp').classList.remove('open'); $('cmp-grid').innerHTML = ''; }
  });

  /* The help sheet lists the candidates from the same table the HUD reads. */
  $('help-list').innerHTML = CANDIDATES.map(function (c) { return '<li>' + c + '</li>'; }).join('');
  drawContours();
  drawNetwork();
  apply();
})();
