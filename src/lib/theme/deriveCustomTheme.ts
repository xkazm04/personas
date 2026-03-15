/**
 * Color derivation engine for custom themes.
 *
 * Given a primary color and base mode (dark/light), produces a full set of
 * CSS variable overrides that slot into the [data-theme="custom"] selector.
 */

export interface CustomThemeConfig {
  baseMode: 'dark' | 'light';
  primaryColor: string;
  accentColor: string | null;
  label: string;
  /** Optional color overrides — null/undefined = auto-derived from primary */
  backgroundColor?: string | null;
  backgroundEndColor?: string | null;
  backgroundAngle?: number;
  foregroundColor?: string | null;
  secondaryColor?: string | null;
  borderColor?: string | null;
  cardBgColor?: string | null;
  mutedFgColor?: string | null;
}

// ---------------------------------------------------------------------------
// HSL <-> Hex utilities
// ---------------------------------------------------------------------------

interface HSL { h: number; s: number; l: number }

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function hexToHsl(hex: string): HSL {
  const rgb = hexToRgb(hex);
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function lighten(hex: string, amount: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, Math.min(100, l + amount));
}

function darken(hex: string, amount: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, l - amount));
}

function rotateHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Fixed status colors per base mode — never derived from primary. */
const DARK_STATUS = {
  '--status-success': '#34d399',
  '--status-warning': '#fbbf24',
  '--status-error': '#f87171',
  '--status-info': '#60a5fa',
  '--status-pending': '#fbbf24',
  '--status-processing': '#60a5fa',
  '--status-neutral': '#94a3b8',
};

const LIGHT_STATUS = {
  '--status-success': '#059669',
  '--status-warning': '#b45309',
  '--status-error': '#dc2626',
  '--status-info': '#2563eb',
  '--status-pending': '#b45309',
  '--status-processing': '#2563eb',
  '--status-neutral': '#44444f',
};

const LIGHT_SHADOWS = {
  '--shadow-elevation-1': '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08)',
  '--shadow-elevation-2': '0 2px 4px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.06)',
  '--shadow-elevation-3': '0 4px 8px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.08)',
  '--shadow-elevation-4': '0 8px 16px rgba(0,0,0,0.12), 0 16px 32px rgba(0,0,0,0.1)',
};

export function deriveCustomThemeVars(config: CustomThemeConfig): Record<string, string> {
  const { primaryColor, baseMode } = config;
  const { h } = hexToHsl(primaryColor);
  const accent = config.accentColor ?? lighten(primaryColor, 15);
  const [r, g, b] = hexToRgb(primaryColor);

  let vars: Record<string, string>;

  if (baseMode === 'dark') {
    vars = {
      '--primary': primaryColor,
      '--accent': accent,
      '--background': hslToHex(h, 8, 5),
      '--foreground': hslToHex(h, 8, 90),
      '--secondary': hslToHex(h, 10, 12),
      '--border': hslToHex(h, 16, 22),
      '--muted': hslToHex(h, 8, 40),
      '--muted-dark': hslToHex(h, 6, 32),
      '--muted-foreground': hslToHex(h, 8, 58),
      '--btn-primary': darken(primaryColor, 20),
      '--card-bg': `rgba(${r}, ${g}, ${b}, 0.03)`,
      '--card-border': `rgba(${r}, ${g}, ${b}, 0.08)`,
      '--glass-bg': `rgba(${r}, ${g}, ${b}, 0.03)`,
      '--glass-border': `rgba(${r}, ${g}, ${b}, 0.10)`,
      '--brand-cyan': accent,
      '--brand-purple': rotateHue(primaryColor, -40),
      '--brand-emerald': '#34d399',
      '--brand-amber': '#fbbf24',
      '--brand-rose': '#fb7185',
      ...DARK_STATUS,
    };
  } else {
    // Light mode
    vars = {
      '--primary': primaryColor,
      '--primary-rgb': `${r}, ${g}, ${b}`,
      '--accent': accent,
      '--background': hslToHex(h, 10, 94),
      '--foreground': hslToHex(h, 10, 10),
      '--secondary': hslToHex(h, 8, 86),
      '--border': hslToHex(h, 10, 74),
      '--muted': hslToHex(h, 6, 36),
      '--muted-dark': hslToHex(h, 5, 26),
      '--muted-foreground': hslToHex(h, 6, 30),
      '--btn-primary': darken(primaryColor, 15),
      '--card-bg': 'rgba(0, 0, 0, 0.04)',
      '--card-border': 'rgba(0, 0, 0, 0.10)',
      '--glass-bg': 'rgba(0, 0, 0, 0.03)',
      '--glass-border': 'rgba(0, 0, 0, 0.08)',
      '--brand-cyan': darken(accent, 10),
      '--brand-purple': rotateHue(primaryColor, -40),
      '--brand-emerald': '#059669',
      '--brand-amber': '#b45309',
      '--brand-rose': '#be123c',
      ...LIGHT_STATUS,
      ...LIGHT_SHADOWS,
    };
  }

  // Apply optional color overrides
  if (config.backgroundColor) vars['--background'] = config.backgroundColor;
  if (config.foregroundColor) vars['--foreground'] = config.foregroundColor;
  if (config.secondaryColor) vars['--secondary'] = config.secondaryColor;
  if (config.borderColor) vars['--border'] = config.borderColor;
  if (config.mutedFgColor) vars['--muted-foreground'] = config.mutedFgColor;
  if (config.cardBgColor) {
    vars['--card-bg'] = config.cardBgColor;
    vars['--glass-bg'] = config.cardBgColor;
  }

  // Background gradient
  if (config.backgroundColor && config.backgroundEndColor) {
    const angle = config.backgroundAngle ?? 135;
    vars['--background-gradient'] = `linear-gradient(${angle}deg, ${config.backgroundColor}, ${config.backgroundEndColor})`;
  }

  return vars;
}

// ---------------------------------------------------------------------------
// Runtime CSS injection
// ---------------------------------------------------------------------------

const STYLE_ID = 'persona-custom-theme';

export function injectCustomThemeStyle(vars: Record<string, string>): void {
  const gradient = vars['--background-gradient'];
  const cssVars = { ...vars };
  delete cssVars['--background-gradient'];

  const cssText = Object.entries(cssVars)
    .map(([key, val]) => `  ${key}: ${val};`)
    .join('\n');

  let extraRules = '';
  if (gradient) {
    extraRules = `\nhtml[data-theme="custom"] {\n  background-image: ${gradient};\n  min-height: 100vh;\n}`;
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `[data-theme="custom"] {\n${cssText}\n}${extraRules}`;
}

export function removeCustomThemeStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}
