// The report's only script, inlined: scroll-spy for the contents rail (the
// current entry is STATED with aria-current, not only painted), the crumb in
// the top bar, the reading-progress line, and opening a finding's reasoning
// when a must-address link jumps to it. No network, no storage.
export const CLIENT_JS = `
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.rail a[data-target]'));
  var rail = document.querySelector('.rail');
  var crumb = document.getElementById('crumb');
  var prog = document.getElementById('prog');
  var sections = links.map(function (a) { return document.getElementById(a.getAttribute('data-target')); });
  var current = null;
  function setCurrent(i) {
    if (i === current) return;
    current = i;
    links.forEach(function (a, j) {
      if (j === i) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    var s = sections[i];
    if (crumb && s) crumb.textContent = s.getAttribute('data-nav') || '';
    var a = links[i];
    if (rail && a) {
      var r = a.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      if (r.top < rr.top + 40 || r.bottom > rr.bottom - 40) rail.scrollTop += r.top - rr.top - rr.height / 3;
    }
  }
  var ticking = false;
  function update() {
    ticking = false;
    var line = 120, best = 0;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].getBoundingClientRect().top <= line) best = i;
    }
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (max > 0 && window.scrollY >= max - 2) best = sections.length - 1;
    setCurrent(best);
    if (prog) prog.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + '%';
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  function openTarget() {
    var id = decodeURIComponent(location.hash.slice(1));
    var el = id && document.getElementById(id);
    if (el && el.classList.contains('finding')) {
      var d = el.querySelector('details');
      if (d) d.open = true;
      el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash'); }, 1600);
    }
  }
  window.addEventListener('hashchange', openTarget);
  openTarget();
  update();
})();
`;
