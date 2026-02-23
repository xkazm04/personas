import { readdirSync, readFileSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

function walkDir(dir) {
  let results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.name.endsWith('.json') && !entry.name.startsWith('_')) results.push(full);
  }
  return results;
}

const files = walkDir('scripts/templates');
let deleted = 0, kept = 0;
for (const f of files) {
  const data = JSON.parse(readFileSync(f, 'utf-8'));
  const flows = data.payload && data.payload.use_case_flows;
  if (flows && Array.isArray(flows) && flows.length > 0) {
    kept++;
    console.log('KEEP:', basename(f));
  } else {
    unlinkSync(f);
    deleted++;
  }
}
console.log('\nDeleted:', deleted, '| Kept:', kept);
