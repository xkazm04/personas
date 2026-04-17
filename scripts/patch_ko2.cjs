'use strict';
const fs = require('fs');

let ko = fs.readFileSync('src/i18n/ko.ts', 'utf8');

const T = '      // @llm-translated 2026-04-17\n';
const T4 = '    // @llm-translated 2026-04-17\n';

function insertAfter(anchor, text) {
  const idx = ko.indexOf(anchor);
  if (idx === -1) { console.error('ANCHOR NOT FOUND:', anchor.substring(0, 80)); return false; }
  ko = ko.slice(0, idx + anchor.length) + '\n' + text + ko.slice(idx + anchor.length);
  return true;
}

// ─── common.optional ─────────────────────────────────────────────────────────
insertAfter(
  '    required: "필수",',
  T4 + '    optional: "선택 사항",'
);

// ─── agents.executions missing keys ─────────────────────────────────────────
// Insert after no_pipeline_trace line
insertAfter(
  '      no_pipeline_trace: "파이프라인 추적 없음",',
  T +
  '      depth_label: "깊이:",\n' +
  '      active_count_label: "활성 ({count})",\n' +
  '      completed_count_label: "완료됨 ({count})",\n' +
  '      metadata_section: "메타데이터",\n' +
  '      chain_id_prefix: "체인: {id}",\n' +
  '      chain_total_duration: "합계: {duration}",\n' +
  '      zero_ms: "0ms",\n' +
  '      tool_calls_count: "도구 호출 {count}회",\n' +
  '      tool_calls_count_other: "도구 호출 {count}회",\n' +
  '      unique_tools_count: "({count}개 고유)",\n' +
  '      prev_error_nav: "이전 오류 (Shift+E)",\n' +
  '      next_error_nav: "다음 오류 (E)",\n' +
  '      runner_input_placeholder: \'{"key": "value"}\','
);

// ─── agents.lab missing keys (insert before lab section close) ───────────────
// Find last key in lab section
insertAfter(
  '      cancel_default: "취소",\n      hide_impact: "영향 숨기기",\n      show_impact: "영향 보기",',
  T +
  '      objective_warning: "적합도 목표 문제",\n' +
  '      objective_fallback_toast: "진화에 기본 적합도 가중치가 사용됨 — 목표 설정을 확인하세요",'
);

// ─── agents.design missing key ───────────────────────────────────────────────
insertAfter(
  '      additional_instructions_placeholder: "특정 요구사항, 도메인 지식 또는 제약 조건 추가...",',
  T + '      conv_controls_aria: "디자인 대화 컨트롤",'
);

// ─── agents.connectors missing keys ──────────────────────────────────────────
insertAfter(
  '      sub_filter: "필터: {filter}",',
  T +
  '      auto_input_schema_placeholder: \'{ "file_url": "string" }\',\n' +
  '      auto_github_token_needs: "토큰에 {scopes} 범위가 필요합니다. github.com/settings/tokens에서 토큰을 업데이트하세요.",\n' +
  '      auto_fallback_title: "오류 시 직접 커넥터로 폴백",'
);

// ─── agents.model_config missing key ─────────────────────────────────────────
insertAfter(
  '      model_name_placeholder_custom: "모델 식별자",',
  T + '      model_name_placeholder_override: "예: claude-sonnet-4-20250514",'
);

// ─── agents.settings_status missing keys ─────────────────────────────────────
insertAfter(
  '      failed_health_watch: "상태 감시 설정 업데이트 실패",',
  T +
  '      speak_as: "으로 말하기",\n' +
  '      no_twins_configured: "트윈이 설정되지 않았습니다. 트윈 플러그인을 열어 생성하세요 — 그러면 이 페르소나가 트윈을 채택할 수 있습니다.",\n' +
  '      twin_profile_aria: "이 페르소나가 말하는 트윈 프로필",'
);

// ─── agents.tool_runner missing key ──────────────────────────────────────────
insertAfter(
  '      error: "오류",\n    },\n    health_check: {',
  T + '      input_json_placeholder: \'{ "key": "value" }\','
);

// ─── agents.prompt_editor missing key ────────────────────────────────────────
insertAfter(
  '      sections: "섹션",',
  T + '      sections_aria: "프롬프트 섹션",'
);

fs.writeFileSync('src/i18n/ko.ts', ko);
console.log('Batch 2 done (agents section)');
