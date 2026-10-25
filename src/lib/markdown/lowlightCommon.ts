/**
 * The highlight.js grammars the app's markdown renders, standing in for
 * lowlight's own `common` set (37 grammars) at build time.
 *
 * rehype-highlight registers `settings.languages || common`, so it imports
 * lowlight's `common` unconditionally and every one of the 37 grammars lands
 * in `vendor-markdown` no matter what options are passed. The
 * `lowlight-common-subset` plugin in vite.config.ts resolves lowlight's
 * `./lib/common.js` to this file instead. A fence in a language not listed
 * here renders as plain text (rehype-highlight's `detect` is off), which is
 * what an unknown language already did.
 *
 * Add a grammar here when a surface really renders it; each one is 2-30 KB.
 */
import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// lowlight's index re-exports this module's `grammars` as `common`.
export const grammars: Record<string, LanguageFn> = {
  bash,
  css,
  diff,
  ini,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
};
