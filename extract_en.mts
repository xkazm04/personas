import { en } from './src/i18n/en';
import { readFileSync, writeFileSync } from 'fs';

const missing = readFileSync('./ar_missing_keys_full.txt','utf8').split('\n').slice(1).filter((s:string)=>s.trim());

function getVal(obj: any, path: string): any {
  return path.split('.').reduce((o: any, k: string) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

const result: Record<string, string> = {};
for (const key of missing) {
  const val = getVal(en, key);
  result[key] = val ?? 'UNDEFINED';
}
writeFileSync('./ar_missing_values.json', JSON.stringify(result, null, 2));
console.log('Done, keys:', Object.keys(result).length);
