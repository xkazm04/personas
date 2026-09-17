import { silentCatchNull } from "@/lib/silentCatch";

// Native drag-out (Alt-drag a selection onto the desktop / another app).
//
// `@crabnebula/tauri-plugin-drag` is added by the Rust work package, so the
// import is dynamic and tolerant: when the module is absent the caller shows
// `drag_out_unavailable` instead of throwing. The specifier lives in a
// variable so tsc never tries to resolve it before the package lands.

interface DragPluginModule {
  startDrag: (
    options: { item: string[]; icon: string | number[]; mode?: "copy" | "move" },
    onEvent?: (event: unknown) => void,
  ) => Promise<void>;
}

const DRAG_PLUGIN_SPECIFIER = "@crabnebula/tauri-plugin-drag";

// 1×1 transparent PNG — the plugin insists on a drag image; the OS draws the
// file icons itself, so an invisible ghost is the honest choice.
const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function blankIconBytes(): number[] {
  const bin = atob(BLANK_PNG_BASE64);
  return Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function loadDragPlugin(): Promise<DragPluginModule | null> {
  const mod = (await import(/* @vite-ignore */ DRAG_PLUGIN_SPECIFIER).catch(
    silentCatchNull("finder:drag-plugin-missing"),
  )) as DragPluginModule | null;
  return mod && typeof mod.startDrag === "function" ? mod : null;
}

/** Starts the OS drag for absolute paths. Resolves `false` when the plugin is missing. */
export async function startNativeDrag(absPaths: string[]): Promise<boolean> {
  if (absPaths.length === 0) return true;
  const mod = await loadDragPlugin();
  if (!mod) return false;
  await mod.startDrag({ item: absPaths, icon: blankIconBytes(), mode: "copy" });
  return true;
}
