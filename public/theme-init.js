// Apply saved theme synchronously to prevent FOUC.
// Reads the Zustand-persisted theme from localStorage before React mounts.
try {
  var stored = JSON.parse(localStorage.getItem('persona-theme') || '{}');
  var id = stored && stored.state && stored.state.themeId;
  if (id && id !== 'dark-midnight') {
    document.documentElement.setAttribute('data-theme', id);
  }
  // Toggle dark class based on theme type
  if (id && id.indexOf('light') === 0) {
    document.documentElement.classList.remove('dark');
  }
} catch (e) {}
