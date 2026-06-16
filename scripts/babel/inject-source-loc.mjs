/**
 * Dev-only Babel plugin — stamps each HOST JSX element with a
 * `data-loc="src/.../File.tsx:LINE:COL"` attribute so the in-app DevInspector
 * (press `;` then `i`) can map a clicked DOM node back to its source location
 * and copy a Claude-Code-friendly `path:line` reference to the clipboard.
 *
 * Host-only by design: component (uppercase) JSX elements don't reliably
 * forward an injected prop to their root DOM node, and React 19 removed both
 * the Fiber `_debugSource` field and (in 19.2) the `jsxDEV` source/self args
 * the old click-to-component tools relied on. Stamping host elements and
 * walking the DOM ancestor chain at runtime is version-independent and needs
 * no React internals.
 *
 * Wired in vite.config.ts ONLY when `command === 'serve'` (the dev server), so
 * the attribute never exists in any production / `tauri build` output.
 *
 * @param {{ types: import('@babel/core').types }} babel
 */
export default function injectSourceLoc({ types: t }) {
  const ATTR = "data-loc";

  return {
    name: "inject-source-loc",
    visitor: {
      JSXOpeningElement(path, state) {
        const nameNode = path.node.name;

        // Host elements only: <div>, <button>, ... (a JSXIdentifier whose name
        // starts lowercase). Skip components (<Button>), member expressions
        // (<Foo.Bar>) and namespaced names.
        if (nameNode.type !== "JSXIdentifier") return;
        if (!/^[a-z]/.test(nameNode.name)) return;

        const loc = path.node.loc;
        if (!loc) return;

        const filename = state.file.opts.filename;
        if (!filename) return;

        // Absolute OS path -> repo-relative 'src/...' (Windows-safe).
        const norm = filename.replace(/\\/g, "/");
        const idx = norm.lastIndexOf("/src/");
        if (idx === -1) return; // outside src (node_modules, generated) -> skip
        const rel = norm.slice(idx + 1); // 'src/.../File.tsx'

        // Idempotent: never double-stamp (e.g. if a file is transformed twice).
        const already = path.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name && a.name.name === ATTR,
        );
        if (already) return;

        path.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier(ATTR),
            t.stringLiteral(`${rel}:${loc.start.line}:${loc.start.column + 1}`),
          ),
        );
      },
    },
  };
}
