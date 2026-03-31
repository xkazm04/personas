// Apply saved theme AND text scale synchronously to prevent FOUC.
// Reads the Zustand-persisted state from localStorage before React mounts.
try {
  var stored = JSON.parse(localStorage.getItem('persona-theme') || '{}');
  var state = stored && stored.state;
  if (state) {
    // Theme
    var id = state.themeId;
    if (id && id !== 'dark-midnight') {
      document.documentElement.setAttribute('data-theme', id);
    }
    // Toggle dark class based on theme type
    if (id && id.indexOf('light') === 0) {
      document.documentElement.classList.remove('dark');
    }
    // Text scale — apply immediately so first paint uses the correct size
    var scale = state.textScale;
    if (scale) {
      document.documentElement.setAttribute('data-text-scale', scale);
    }
  }
} catch (e) {}
