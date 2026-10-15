// The fixture's screens (WP4b): two tiny SYNTHETIC drawings per shot row, a before and an after, as inline SVG data
// URLs. Nothing is captured from a product: the drawing is a made-up card in the shot's theme, and the after carries
// the state the item designs (a reason under the action, in the success ink). The theme and phase come from the shot
// row's path, `<pack>-<feature>-<phase>-<theme>.svg`, as bp's sample names them.

const INK = {
  light: { paper: 'white', panel: 'whitesmoke', text: 'dimgray', head: 'black', line: 'gainsboro', act: 'steelblue', ok: 'seagreen', bad: 'firebrick' },
  dark: { paper: 'black', panel: 'darkslategray', text: 'silver', head: 'white', line: 'dimgray', act: 'cornflowerblue', ok: 'mediumseagreen', bad: 'indianred' },
} as const;

const esc = (s: string) => s.replace(/[<&>"']/g, '');

/** The synthetic screen a `shots` row's path names. */
export function sampleShot(path: string): string {
  const name = (path.split('/').pop() ?? path).replace(/\.\w+$/, '');
  const after = /-after-/.test(name), c = INK[/-light$/.test(name) ? 'light' : 'dark'];
  const what = esc(name.split('-').slice(1, -2).join(' ') || 'screen');
  const state = after
    ? `<rect x="40" y="110" width="240" height="26" rx="4" fill="none" stroke="${c.ok}"/><text x="52" y="127" fill="${c.ok}" font-family="sans-serif" font-size="11">Refused: the reason, and Try again</text>`
    : `<text x="40" y="127" fill="${c.bad}" font-family="sans-serif" font-size="11">(closes silently)</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">`
    + `<rect width="320" height="180" fill="${c.paper}"/><rect width="320" height="22" fill="${c.panel}"/>`
    + `<text x="12" y="15" fill="${c.text}" font-family="sans-serif" font-size="10">Kettle · sample</text>`
    + `<rect x="24" y="36" width="272" height="116" rx="6" fill="${c.panel}" stroke="${c.line}"/>`
    + `<text x="40" y="60" fill="${c.head}" font-family="sans-serif" font-size="13">${what}</text>`
    + `<rect x="40" y="76" width="96" height="24" rx="4" fill="${c.act}"/><text x="58" y="92" fill="white" font-family="sans-serif" font-size="11">Continue</text>`
    + state + '</svg>';
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
