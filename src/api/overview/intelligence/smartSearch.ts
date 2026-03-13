import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SmartSearchResult } from "@/lib/bindings/SmartSearchResult";

export type { SmartSearchResult } from "@/lib/bindings/SmartSearchResult";

export const smartSearchTemplates = (query: string) =>
  invoke<SmartSearchResult>("smart_search_templates", { query });
