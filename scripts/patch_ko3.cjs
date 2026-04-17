'use strict';
const fs = require('fs');

let ko = fs.readFileSync('src/i18n/ko.ts', 'utf8');

const T = '      // @llm-translated 2026-04-17\n';

function insertAfter(anchor, text) {
  const idx = ko.indexOf(anchor);
  if (idx === -1) { console.error('ANCHOR NOT FOUND:', anchor.substring(0, 80)); return false; }
  ko = ko.slice(0, idx + anchor.length) + '\n' + text + ko.slice(idx + anchor.length);
  return true;
}

// agents.lab - insert before closing brace of lab section
insertAfter(
  '      show_impact: "영향 보기",\n    },\n    design: {',
  T +
  '      objective_warning: "적합도 목표 문제",\n' +
  '      objective_fallback_toast: "진화에 기본 적합도 가중치가 사용됨 — 목표 설정을 확인하세요",'
);

// agents.tool_runner - insert before its closing brace
insertAfter(
  '      error: "오류",\n    },\n    health_check: {',
  T + '      input_json_placeholder: \'{ "key": "value" }\','
);

fs.writeFileSync('src/i18n/ko.ts', ko);
console.log('Batch 3 done');
