import { silentCatchNull } from "@/lib/silentCatch";

// Native drag-out (Alt-drag a selection onto the desktop / another app).
//
// `@crabnebula/tauri-plugin-drag` 2.1 is a dependency, but the import stays
// dynamic and tolerant: the chunk loads only when a drag starts, and if the
// module or its Rust side is absent (a build without the `desktop` feature,
// a web preview) the caller shows `drag_out_unavailable` instead of throwing.
//
// The specifier is a literal so Vite resolves and code-splits the package —
// a variable specifier is left as a bare import for the browser, which cannot
// resolve it and would make the plugin unreachable in every build.

interface DragPluginModule {
  startDrag: (
    // 2.1 API: `icon` is a string — a PNG data URL (`data:image/png;base64,…`)
    // or an image path. The Rust side rejects any other string shape.
    options: { item: string[]; icon: string; mode?: "copy" | "move" },
    onEvent?: (event: unknown) => void,
  ) => Promise<void>;
}

// 1×1 transparent PNG — the plugin insists on a drag image; the OS draws the
// file icons itself, so an invisible ghost is the honest choice.
const BLANK_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export async function loadDragPlugin(): Promise<DragPluginModule | null> {
  const mod = (await import("@crabnebula/tauri-plugin-drag").catch(
    silentCatchNull("finder:drag-plugin-missing"),
  )) as DragPluginModule | null;
  return mod && typeof mod.startDrag === "function" ? mod : null;
}

/** Starts the OS drag for absolute paths. Resolves `false` when the plugin is missing. */
export async function startNativeDrag(absPaths: string[]): Promise<boolean> {
  if (absPaths.length === 0) return true;
  const mod = await loadDragPlugin();
  if (!mod) return false;
  await mod.startDrag({ item: absPaths, icon: BLANK_PNG_DATA_URL, mode: "copy" });
  return true;
}
