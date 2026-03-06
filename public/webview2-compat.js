// WebView2 compatibility shim — MUST run before any ES module code.
//
// Problem: WebView2 (Tauri's Windows renderer) treats inherited
// Object.prototype properties (toString, constructor, valueOf, etc.) as
// read-only inside ESM strict-mode contexts.  Many libraries assign to these
// properties directly (e.g. `exports.toString = fn`, `P.valueOf = fn`,
// `prototype.constructor = Ctor`), which throws at runtime.
//
// Fix: Convert these Object.prototype data properties into accessor properties
// (getter/setter).  The setter transparently creates a real own data property
// on the target object via Object.defineProperty, which always succeeds.
// The getter returns the original built-in function for unmodified objects.

(function () {
  var dp = Object.defineProperty;
  var proto = Object.prototype;
  var props = ['toString', 'constructor', 'valueOf', 'toLocaleString'];
  var ok = 0, fail = 0;

  for (var i = 0; i < props.length; i++) {
    (function (prop) {
      try {
        var original = proto[prop];
        dp(proto, prop, {
          get: function () {
            return original;
          },
          set: function (value) {
            dp(this, prop, {
              value: value,
              writable: true,
              configurable: true
            });
          },
          configurable: true
        });
        ok++;
      } catch (e) {
        fail++;
        console.warn('[webview2-compat] cannot shim ' + prop + ': ' + e.message);
      }
    })(props[i]);
  }

  // Diagnostic: log result so we can verify the shim is working
  console.log('[webview2-compat] shim applied: ' + ok + ' ok, ' + fail + ' failed');
})();
