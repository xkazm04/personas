import { en } from './src/i18n/en.ts';

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string') {
      result[key] = v;
    } else if (typeof v === 'object' && v !== null) {
      Object.assign(result, flatten(v as Record<string, unknown>, key));
    }
  }
  return result;
}

import { readFileSync, writeFileSync } from 'fs';
const missingKeys: string[] = JSON.parse(readFileSync('missing_de_keys.json', 'utf8'));
const flat = flatten(en as unknown as Record<string, unknown>);

const result: Record<string, string> = {};
for (const key of missingKeys) {
  result[key] = flat[key] ?? '(not found)';
}

const notFound = Object.entries(result).filter(([,v]) => v === '(not found)');
console.error('Not found:', notFound.length);
writeFileSync('missing_de_with_values.json', JSON.stringify(result, null, 2));
console.error('Written:', Object.keys(result).length, 'keys');
