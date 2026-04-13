#!/usr/bin/env node
import { readFileSync } from 'fs';

function parseTs(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const map = new Map();
  const stack = [];
  let inExport = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') ||
        t.startsWith('/*') || t.startsWith('*/')) continue;
    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(t)) inExport = true;
      continue;
    }
    const s = t
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const km = t.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (km) {
      const k = km[1] ?? km[2] ?? km[3];
      const after = s.slice(s.indexOf(':') + 1);
      const hO = after.includes('{'), hC = after.includes('}');
      if (hO && hC) {
        const oi = t.indexOf('{'), ci = t.lastIndexOf('}');
        const inner = t.slice(oi + 1, ci);
        const re = /(?:"([\w$-]+)"|(\w[\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = re.exec(inner)) !== null) {
          const ik = m[1] ?? m[2];
          map.set([...stack, k, ik].join('.'), m[3]);
        }
      } else if (hO) {
        stack.push(k);
      } else {
        const vm = t.match(/:\s*"((?:[^"\\]|\\.)*)"/) ||
                   t.match(/:\s*'((?:[^'\\]|\\.)*)'/);
        if (vm) map.set([...stack, k].join('.'), vm[1]);
      }
    }
    const o = (s.match(/\{/g) || []).length;
    const c = (s.match(/\}/g) || []).length;
    for (let i = 0; i < c - o && stack.length > 0; i++) stack.pop();
    if (s === '};' && stack.length === 0) break;
  }
  return map;
}

const enKeys = parseTs('src/i18n/en.ts');
console.log('en.ts total keys:', enKeys.size);
console.log();
console.log('Lang | Present | Missing | Coverage');
console.log('-----|---------|---------|---------');
for (const lang of ['ar','bn','cs','de','es','fr','hi','id','ja','ko','ru','vi','zh']) {
  const m = parseTs(`src/i18n/${lang}.ts`);
  let present = 0;
  for (const k of enKeys.keys()) if (m.has(k)) present++;
  const missing = enKeys.size - present;
  const pct = (present / enKeys.size * 100).toFixed(1);
  console.log(
    lang.padEnd(4), '|',
    String(present).padStart(7), '|',
    String(missing).padStart(7), '|',
    pct.padStart(5) + '%'
  );
}
