'use strict';
const fs = require('fs');

let ko = fs.readFileSync('src/i18n/ko.ts', 'utf8');
const NL = '\r\n';
const T = '      // @llm-translated 2026-04-17' + NL;

function insertAfter(anchor, text) {
  const idx = ko.indexOf(anchor);
  if (idx === -1) { console.error('ANCHOR NOT FOUND:', anchor.substring(0, 80)); return false; }
  ko = ko.slice(0, idx + anchor.length) + NL + text + ko.slice(idx + anchor.length);
  return true;
}

// agents.tool_runner missing key
insertAfter(
  '      error: "\uC624\uB958",' + NL + '    },' + NL + '    health_check: {',
  T + '      input_json_placeholder: \'{ "key": "value" }\','
);

// agents.lab missing keys - insert after show_impact
insertAfter(
  '      show_impact: "\uC601\uD5A5 \uBCF4\uAE30",',
  T +
  '      objective_warning: "\uC801\uD569\uB3C4 \uBAA9\uD45C \uBB38\uC81C",' + NL +
  '      objective_fallback_toast: "\uC9C4\uD654\uC5D0 \uAE30\uBCF8 \uC801\uD569\uB3C4 \uAC00\uC911\uCE58\uAC00 \uC0AC\uC6A9\uB428 \u2014 \uBAA9\uD45C \uC124\uC815\uC744 \uD655\uC778\uD558\uC138\uC694",'
);

fs.writeFileSync('src/i18n/ko.ts', ko);
console.log('Done');
