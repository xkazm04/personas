import { CheckCircle, XCircle, HelpCircle, Radio } from "lucide-react";

// --- Layout Constants ---------------------------------------------------
export const NODE_W = 160;
export const NODE_H = 56;
export const GAP_X = 220;
export const GAP_Y = 90;

// --- Types --------------------------------------------------------------
export interface FlowNode {
  id: string;
  name: string;
  x: number;
  y: number;
  enabled: boolean;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  conditionType: string;
  enabled: boolean;
}

// --- Condition Maps -----------------------------------------------------
export const CONDITION_ICONS: Record<string, typeof CheckCircle> = {
  success: CheckCircle,
  failure: XCircle,
  any: HelpCircle,
  jsonpath: Radio,
};

export const CONDITION_COLORS: Record<string, string> = {
  success: "text-emerald-400",
  failure: "text-red-400",
  any: "text-zinc-400",
  jsonpath: "text-blue-400",
};

/** Hex stroke colors for SVG edges, keyed by condition type */
export const CONDITION_STROKE_HEX: Record<string, string> = {
  success: "#34d399",
  failure: "#f87171",
  any: "#a1a1aa",
  jsonpath: "#60a5fa",
};
