'use strict';
const fs = require('fs');

let ko = fs.readFileSync('src/i18n/ko.ts', 'utf8');

const T = '      // @llm-translated 2026-04-17\r\n';
const T4 = '    // @llm-translated 2026-04-17\r\n';
const NL = '\r\n';

function insertAfter(anchor, text) {
  const idx = ko.indexOf(anchor);
  if (idx === -1) { console.error('ANCHOR NOT FOUND:', anchor.substring(0, 80)); return false; }
  ko = ko.slice(0, idx + anchor.length) + NL + text + ko.slice(idx + anchor.length);
  return true;
}

function ins(anchor, lines) {
  // lines is array of strings (key: "value" format)
  const body = lines.map(l => '      ' + l).join(NL) + NL;
  return insertAfter(anchor, T + body);
}

// agents.lab
ins(
  '      show_impact: "\uc601\ud5a5 \ubcf4\uae30",',
  [
    'objective_warning: "적합도 목표 문제",',
    'objective_fallback_toast: "진화에 기본 적합도 가중치가 사용됨 — 목표 설정을 확인하세요",'
  ]
);

// agents.tool_runner
ins(
  '      error: "\uc624\ub958",\r\n    },\r\n    health_check: {'.replace(/\\r/g, '\r'),
  ['input_json_placeholder: \'{ "key": "value" }\',']
);

fs.writeFileSync('src/i18n/ko.ts', ko);
console.log('Done');
