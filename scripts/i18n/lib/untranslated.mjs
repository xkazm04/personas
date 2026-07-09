/**
 * Shared classifier for "is this locale value actually translated?".
 *
 * `check-coverage.mjs` asserts a KEY EXISTS in every locale. It cannot see a key
 * whose VALUE was merged as verbatim English — and the runtime `t` Proxy
 * deep-merges English under every locale, so such a string renders as English
 * with no warning. In July 2026 that blind spot hid 41,536 raw-English strings
 * (~24% of the app) behind a green "0 missing" report.
 *
 * This module is the shared truth used by check-untranslated.mjs (the gate),
 * plan-gaps.mjs (the fan-out work list), and merge-chunks.mjs (the QA pass).
 */
import fs from 'node:fs';

export const LOCDIR = 'src/i18n/locales';

/** Flatten a nested catalog to dotted paths. */
export const flatten = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v, `${p}${k}.`) : [[p + k, v]],
  );

export const readCatalog = (lang) =>
  Object.fromEntries(flatten(JSON.parse(fs.readFileSync(`${LOCDIR}/${lang}.json`, 'utf8'))));

export const locales = () =>
  fs
    .readdirSync(LOCDIR)
    .filter((f) => f.endsWith('.json') && f !== 'en.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

/**
 * Brand names + technical identifiers that are legitimately byte-identical in
 * every language. A value built ONLY from these is never "untranslated".
 *
 * NOTE: "persona"/"personas" is deliberately absent. "Personas" the product is a
 * brand, but "personas" the plural common noun ("All personas") must translate.
 * Judge by call site; the ambiguity is why it is not auto-exempted here.
 */
export const DNT_TOKENS = new Set(
  `claude anthropic openai gemini ollama github gitlab slack sentry sqlite obsidian
   youtube discord notion jira asana figma stripe twilio docker kubernetes aws gcp
   azure vercel netlify supabase postgres redis mongodb
   api cli json https http cron webhook mcp url uri id ok ai llm ui ux css html sdk
   npm git pr kpi p2p onnx tts a2a oauth jwt uuid sha md yaml toml csv pdf png svg
   webp gif gpu cpu ram ssd os ide ipc db sql crud rest grpc ssh tls ssl dns ip vpn
   smtp imap rss xml regex ascii utf base64 sse ws cors env`.split(/\s+/),
);

const wordish = (s) => String(s).toLowerCase().match(/[a-z]{2,}/g) || [];

/** Value is composed only of brand/technical tokens → identical everywhere is fine. */
export const isDNT = (s) => {
  const w = wordish(s);
  return w.length > 0 && w.every((t) => DNT_TOKENS.has(t));
};

/** `_comment*` path segments are translator notes: never rendered, never translated. */
export const isComment = (k) => k.split('.').some((seg) => seg.startsWith('_comment'));

/**
 * Does this English value carry translatable prose? Requires either two
 * alphabetic words, or one word of >=4 letters. Filters out "OK", "v2", "%",
 * pure punctuation, and bare brand tokens.
 *
 * Brace spans are stripped FIRST. `"{current} / {total}"` and `"${cost}"` are
 * pure format strings with nothing to translate — counting the words inside
 * the braces made them look like prose and dragged 29 such keys into the
 * translation work list, where an agent can only echo them back.
 */
export const isTranslatable = (s) => {
  const v = String(s).replace(/\{[^{}]*\}/g, ' ');
  if (!/[a-zA-Z]/.test(v) || isDNT(v)) return false;
  const w = wordish(v);
  return w.length >= 2 || (w.length === 1 && w[0].length >= 4);
};

/**
 * The placeholders the runtime actually substitutes: exactly `{word}`, matching
 * interpolate()'s /\{(\w+)\}/g. Anything else — a JSON example
 * `{"key": "value"}`, an ICU skeleton `{count, plural, …}`, a mustache
 * `{{event_type}}` — is left verbatim by the runtime and must therefore be
 * left alone by the parity check too. Matching arbitrary `\{[^}]+\}` spans made
 * the checker reject correct translations of JSON placeholder examples.
 */
const PLACEHOLDER = /\{\w+\}/g;
export const placeholders = (s) => (String(s).match(PLACEHOLDER) || []).sort().join(',');

const phList = (s) => String(s).match(PLACEHOLDER) || [];

/**
 * ICU plural/select syntax. This repo has NO ICU runtime — such a string renders
 * literally on screen. Eight of them exist in en.json (see docs/i18n/README).
 * Translations must never carry it, whatever the English source does.
 */
export const ICU_SYNTAX = /\{[^{}]*,\s*(plural|select|selectordinal)\s*,/;
export const hasICU = (s) => ICU_SYNTAX.test(String(s));

/**
 * Keys whose translation invented or renamed a placeholder.
 *
 * `interpolate()` matches /\{(\w+)\}/ — ASCII, case-sensitive. A translated
 * placeholder name ({شخصيةs}, {페르소나s}) never matches and renders literally;
 * a recased one ({Personas}) matches the regex but misses `vars.personas` and
 * also renders literally. Both are visible garbage on screen.
 *
 * Deliberately NOT symmetric: a *dropped* placeholder is often correct
 * transcreation (in a `_one` value count is always 1, so Arabic "خطوة واحدة"
 * rightly omits {count}). Only a placeholder the English source never had is a bug.
 */
export function brokenPlaceholderKeys(en, loc) {
  return Object.keys(en).filter((k) => {
    if (!(k in loc)) return false;
    const src = new Set(phList(en[k]));
    return phList(loc[k]).some((p) => !src.has(p));
  });
}

/** Load `<lang>:<key>` / `*:<key>` exemptions for values intentionally left in English. */
export function loadAllowlist(file = 'docs/i18n/untranslated-allowlist.json') {
  if (!fs.existsSync(file)) return new Set();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Set(Array.isArray(raw) ? raw : Object.keys(raw));
}

const allowed = (allow, lang, key) => allow.has(`${lang}:${key}`) || allow.has(`*:${key}`);

/**
 * Every key in `lang` whose value is byte-identical to the English source while
 * carrying translatable prose. This is the untranslated set.
 */
export function untranslatedKeys(en, loc, lang, allow = new Set()) {
  return Object.keys(en).filter(
    (k) =>
      !isComment(k) &&
      isTranslatable(en[k]) &&
      String(loc[k]) === String(en[k]) &&
      !allowed(allow, lang, k),
  );
}
