'use strict';
const fs = require('fs');

let ko = fs.readFileSync('src/i18n/ko.ts', 'utf8');
const NL = '\r\n';
const T = '    // @llm-translated 2026-04-17' + NL;

function insertAfter(anchor, text) {
  const idx = ko.indexOf(anchor);
  if (idx === -1) { console.error('ANCHOR NOT FOUND:', anchor.substring(0, 80)); return false; }
  ko = ko.slice(0, idx + anchor.length) + NL + text + ko.slice(idx + anchor.length);
  return true;
}

// Find vault section end anchors by looking at what exists at end of each subsection
// vault.list - need sort_label
const vaultListAnchor = ko.indexOf('  vault: {');
console.log('vault starts at char', vaultListAnchor);

// Let's use a different approach: insert blocks at end of vault section subsections
// by finding existing last keys in those subsections

// vault.list.sort_label - find vault list section
const vaultListSearch = ko.indexOf('    list: {');
console.log('vault list search at:', vaultListSearch);

fs.writeFileSync('src/i18n/ko.ts', ko);
console.log('Probe done');
