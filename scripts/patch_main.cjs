'use strict';
const fs = require('fs');

let ko = fs.readFileSync('src/i18n/ko.ts', 'utf8');
const NL = '\r\n';

function insertAfter(anchor, text) {
  const idx = ko.indexOf(anchor);
  if (idx === -1) { console.error('MISS:', anchor.substring(0, 60)); return false; }
  ko = ko.slice(0, idx + anchor.length) + NL + text + ko.slice(idx + anchor.length);
  return true;
}

const T6 = '      // @llm-translated 2026-04-17';
const T4 = '    // @llm-translated 2026-04-17';

function blk6(lines) { return T6 + NL + lines.map(l => '      ' + l).join(NL); }
function blk4(lines) { return T4 + NL + lines.map(l => '    ' + l).join(NL); }

// ─── vault.list ──────────────────────────────────────────────────────────────
insertAfter(
  '      affected_events: "\uc601\ud5a5\ubc1b\ub294 \uc774\ubca4\ud2b8",\n    },\n    import: {',
  blk6(['sort_label: "정렬:",'])
);

// ─── vault.import ─────────────────────────────────────────────────────────────
insertAfter(
  '      poll_interval: "\ud3f4\ub9c1 \uac04\uaca9",\n      intervals: {',
  blk6([
    'parse_secrets: "비밀 파싱",',
    'selected_for_import: "가져오기 선택됨",',
    'auto_detected: "자동 감지됨",',
    'sync_supported: "동기화 지원됨",',
    'secrets_found_one: "{count}개 비밀 발견됨",',
    'secrets_found_other: "{count}개 비밀 발견됨",',
    'import_secrets_one: "{count}개 비밀 가져오기",',
    'import_secrets_other: "{count}개 비밀 가져오기",',
  ])
);

// ─── vault.card ───────────────────────────────────────────────────────────────
insertAfter(
  '      reauthorize: "\uc7ac\uc778\uc99d",',
  blk6(['reauthorize_scopes: "추가 범위로 재인증",'])
);

// ─── vault.forms ──────────────────────────────────────────────────────────────
insertAfter(
  '      auto_add: "\uc790\ub3d9 \ucd94\uac00",',
  blk6([
    'connection_test_heading: "연결 테스트",',
    'test_connection_btn: "연결 테스트",',
    'credential_fields_heading: "자격 증명 필드",',
    'how_to_get_connector: "{connectorLabel} 자격 증명 얻는 방법",',
    'authorization_complete: "인증 완료",',
    'copied_to_clipboard: "클립보드에 복사됨",',
    'credential_name: "자격 증명 이름",',
    'credential_name_placeholder: "자격 증명에 레이블 지정 — 예: 내 {label} 계정, 프로덕션 {label}",',
    'authorizing_with: "{label}(으)로 인증 중...",',
    'authorize_with: "{label}(으)로 인증",',
    'oauth_consent_hint: "브라우저에서 {label}을(를) 엽니다. 액세스를 허용한 후 여기로 돌아오세요.",',
    'oauth_connected_at: "{time}에 {label} 연결됨",',
  ])
);

// ─── vault.auto_cred ─────────────────────────────────────────────────────────
insertAfter(
  '      input_requested: "\uc785\ub825 \uc694\uccad\ub428",',
  blk6([
    'cancel_session: "세션 취소",',
    'test_connection: "연결 테스트",',
    'testing: "테스트 중...",',
    're_run_browser: "브라우저 재실행",',
    'discard: "버리기",',
    'save_credential: "자격 증명 저장",',
    'save_procedure: "절차 저장",',
    'procedure_saved: "절차 저장됨",',
  ])
);

// ─── vault.databases ─────────────────────────────────────────────────────────
insertAfter(
  '      introspection_unavailable: "\uc774 \ucee4\ub125\ud130 \uc720\ud615\uc5d0\ub294 \ud14c\uc774\ube14 \ub0b4\ubd80 \uac80\uc0ac\ub97c \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",',
  blk6([
    'not_null: "NOT NULL",',
    'ctrl_enter: "Ctrl+Enter",',
  ])
);

// ─── vault.dependencies ──────────────────────────────────────────────────────
insertAfter(
  '      sim_low: "\uc774 \uc790\uaca9 \uc99d\uba85\uc5d0 \uc758\uc874\ud558\ub294 \ud398\ub974\uc18c\ub098\ub098 \uc6cc\ud06c\ud50c\ub85c\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \ucde8\uc18c\uac00 \uc548\uc804\ud569\ub2c8\ub2e4.",',
  blk6([
    'sim_critical: "{credentialName} 취소 시 {workflows}개 워크플로{workflowPlural}와 {personas}개 페르소나{personaPlural}가 중단됩니다.",',
    'sim_high: "{credentialName} 취소 시 워크스페이스의 {personas}개 페르소나{personaPlural}에 영향을 줍니다.",',
    'sim_medium: "{credentialName} 취소 시 영향 범위가 제한적입니다.",',
    'per_day: "/일",',
  ])
);

// ─── vault.shared ─────────────────────────────────────────────────────────────
insertAfter(
  '      chunks_label: "{count}\uac1c \uccad\ud06c",',
  blk6([
    'copied: "복사됨",',
    'kb_count_summary: "-- {docs}개 문서, {chunks}개 청크",',
    'default_patterns: "기본값:",',
    'add_pattern_placeholder: "*.pdf",',
    'distance_label: "거리:",',
    'chunk_label: "청크:",',
    'copy_credential_id: "자격 증명 ID 복사",',
    'request_body: "요청 본문",',
    'add_tag_title: "태그 추가",',
    'local_embedding_hint: "{model} ({dims}차원)을 사용해 로컬에서 임베딩이 생성됩니다. 데이터가 기기를 벗어나지 않습니다. 모델(~23MB)은 처음 사용 시 다운로드되어 로컬에 캐시됩니다.",',
    'api_path_placeholder: "/api/v1/resource",',
    'json_body_placeholder: \'{"key": "value"}\',',
    'sending: "전송 중...",',
    'send: "보내기",',
    'search_results_one: "\\"{query}\\"에 대한 결과 {count}개",',
    'search_results_other: "\\"{query}\\"에 대한 결과 {count}개",',
  ])
);

// ─── vault.bulk_healthcheck ───────────────────────────────────────────────────
insertAfter(
  '      slowest_responses: "\uac00\uc7a5 \ub290\ub9b0 \uc751\ub2f5",',
  blk6([
    'passed_count: "{count}개 통과",',
    'failed_count: "{count}개 실패",',
    'total_count: "{count}개 합계",',
  ])
);

// ─── vault.token_metrics ──────────────────────────────────────────────────────
insertAfter(
  '      recent_refreshes: "\ucd5c\uadfc \uac31\uc2e0",',
  blk6([
    'fallback_used: "폴백 ({fallback}s)이 {rate}%의 갱신에서 사용됨 ({count}/{total}) — 공급자 누락",',
  ])
);

// ─── vault.reauth_banner ─────────────────────────────────────────────────────
// needs to be added as a new section after rotation_section
insertAfter(
  '      enable_failed: "\uad50\uccb4 \ud65c\uc131\ud654 \uc2e4\ud328: {error}",\n    },\n    event_config: {',
  blk4([
    'reauth_banner: {',
    '  // @llm-translated 2026-04-17',
    '  access_revoked: ") -- 액세스가 취소되었습니다. 자동화를 재개하려면 재인증하세요.",',
    '  reconnect: "재연결",',
    '},',
  ])
);

// ─── vault.rotation_section ──────────────────────────────────────────────────
insertAfter(
  '      enable_failed: "\uad50\uccb4 \ud65c\uc131\ud654 \uc2e4\ud328: {error}",',
  blk6([
    'last_rotated: "{time}에 마지막 교체됨",',
  ])
);

// ─── vault.event_config ──────────────────────────────────────────────────────
insertAfter(
  '      last_evaluated: "\ub9c8\uc9c0\ub9c9 \ud3c9\uac00: {time}",',
  blk6([
    'loading: "이벤트 로딩 중...",',
  ])
);

// ─── vault.credential_forms ───────────────────────────────────────────────────
insertAfter(
  '      oauth_required: "\uc774 \uc790\uaca9 \uc99d\uba85\uc744 \uc5f0\uacb0\ud558\ub824\uba74 \uc544\ub798 \uc778\uc99d \ubc84\ud2bc\uc744 \uc0ac\uc6a9\ud558\uc138\uc694.",',
  blk6([
    'open_to_generate: "{label}을(를) 열어 API 키 또는 토큰 생성",',
    'already_configured: "자격 증명이 이미 구성됨 -- 아래에서 업데이트해 교체",',
    'setup_instructions_label: "설정 지침",',
    'no_fields_defined: "이 커넥터에 정의된 자격 증명 필드가 없습니다.",',
  ])
);

// ─── vault.audit_log ─────────────────────────────────────────────────────────
insertAfter(
  '      access_events_hint: "\uc561\uc138\uc2a4 \uc774\ubca4\ud2b8\uac00 \uc5ec\uae30\uc5d0 \ub098\ud0c0\ub0a9\ub2c8\ub2e4.",',
  blk6([
    'loading: "감사 타임라인 로딩 중...",',
    'total_accesses: "{count}개 합계",',
    'personas_one: "{count}개 페르소나",',
    'personas_other: "{count}개 페르소나",',
    'accesses_24h: "24시간 내 {count}개",',
    'anomalies_one: "{count}개 이상",',
    'anomalies_other: "{count}개 이상",',
    'no_anomalies: "이상 없음",',
    'show_all: "전체 {count}개 항목 표시",',
  ])
);

// ─── vault.credential_import ─────────────────────────────────────────────────
insertAfter(
  '      poll_interval: "\ud3f4\ub9c1 \uac04\uaca9",\n    },\n    empty_state: {',
  blk6([
    'sync_hint: "외부 볼트의 변경 사항을 감시하고 폴링을 사용해 자격 증명을 자동 업데이트합니다.",',
    'interval_15min: "15분",',
    'interval_30min: "30분",',
    'interval_1hr: "1시간",',
    'interval_6hr: "6시간",',
    'interval_24hr: "24시간",',
  ])
);

// ─── vault.wizard_detect ─────────────────────────────────────────────────────
insertAfter(
  '      no_filter_match: "\ub2e4\ub978 \uac80\uc0c9\uc5b4\ub97c \uc0ac\uc6a9\ud558\uac70\ub098 \ud544\ud130\ub97c \uc9c0\uc6b0\uc138\uc694.",',
  blk6([
    'set_up_credentials: "자격 증명 설정",',
    'clear_selection: "선택 지우기",',
    'set_up_services: "{count}개 서비스{plural} 설정",',
    'setting_up: "{total}개 중 {current}번째 설정 중",',
    'wizard_title: "자격 증명 설정 마법사",',
    'choose_service: "설정할 서비스 선택",',
    'ai_walk_description: "AI가 API 자격 증명 획득을 단계별로 안내합니다.",',
    'wizard_subtitle: "AI 안내 자격 증명 설정",',
    'wizard_subtitle_batch: "{count}개 서비스{plural} 설정 중",',
  ])
);

// ─── vault.autopilot ─────────────────────────────────────────────────────────
insertAfter(
  '      request_body: "\uc694\uccad \ubcf8\ubb38 (JSON)",',
  blk6([
    'from_url: "URL에서",',
    'paste_content: "내용 붙여넣기",',
    'openapi_spec_url: "OpenAPI 스펙 URL",',
    'openapi_format_hint: "JSON 또는 YAML 형식의 OpenAPI 3.x 및 Swagger 2.x 스펙 지원",',
    'parsing_spec: "스펙 파싱 중...",',
    'parse_analyze: "파싱 & 분석",',
    'connector_in_catalog: "{connectorLabel}을(를) 이제 {toolCount}개 도구 정의와 함께 커넥터 카탈로그에서 사용할 수 있습니다.",',
    'generated_tools: "생성된 도구 ({count})",',
    'credential_fields: "자격 증명 필드",',
    'open_playground: "플레이그라운드 열기",',
    'copy_connector_id: "커넥터 ID 복사",',
    'go_to_catalog: "카탈로그로 이동",',
    'response_headers: "응답 헤더 ({count})",',
    'base_url_placeholder: "https://api.example.com",',
    'openapi_url_placeholder: "https://api.example.com/openapi.json",',
    'auth_schemes: "인증 스키마",',
    'body_placeholder: \'{ "key": "value" }\',',
  ])
);

// ─── vault.foraging ──────────────────────────────────────────────────────────
insertAfter(
  '      step_current: "(\ud604\uc7ac)",',
  blk6([
    'start_scan: "스캔 시작",',
    'checking_env: "환경 변수, 구성 파일, 개발 도구 자격 증명 확인 중",',
    'importing: "볼트에 자격 증명 가져오는 중...",',
    'scan_again: "다시 스캔",',
    'back_to_vault: "볼트로 돌아가기",',
    'already_in_vault: "이미 볼트에 있음",',
    'imported: "가져왔음",',
    'to_vault: "볼트로",',
    'credentials_found_one: "{count}개 자격 증명 발견됨",',
    'credentials_found_other: "{count}개 자격 증명 발견됨",',
    'selected: "선택됨",',
    'import_to_vault_one: "{count}개 자격 증명을 볼트에 가져오기",',
    'import_to_vault_other: "{count}개 자격 증명을 볼트에 가져오기",',
    'env_var_one: "환경 변수 {count}개",',
    'env_var_other: "환경 변수 {count}개",',
    'import_server: "가져오기",',
    'sources_in: "소스 내",',
    'progress_aria: "탐색 진행률",',
    'scanned_sources: "{ms}ms 내 {count}개 소스 스캔됨",',
  ])
);

// ─── vault.desktop_discovery ─────────────────────────────────────────────────
insertAfter(
  '      allowed_binaries: "\ud5c8\uc6a9\ub41c \ubc14\uc774\ub108\ub9ac: ",',
  blk6([
    'connect_description: "로컬 앱 연결 또는 Claude Desktop MCP 서버 가져오기",',
    'detected_apps_tab: "감지된 앱 ({count})",',
    'claude_mcp_tab: "Claude MCP ({count})",',
    'scanning: "데스크톱 앱 스캔 중...",',
    'detected_on_system: "시스템에서 감지됨",',
    'not_detected: "감지되지 않음",',
    'no_apps: "감지된 데스크톱 앱 없음. 새로 고침해 보세요.",',
    'reading_config: "Claude Desktop 설정 읽는 중...",',
    'mcp_servers_found_one: "Claude Desktop 구성에서 MCP 서버 {count}개 발견됨. 에이전트와 함께 사용하려면 자격 증명으로 가져오세요.",',
    'mcp_servers_found_other: "Claude Desktop 구성에서 MCP 서버 {count}개 발견됨. 에이전트와 함께 사용하려면 자격 증명으로 가져오세요.",',
    'no_mcp_config: "Claude Desktop MCP 구성이 없습니다.",',
    'mcp_config_hint: "Claude Desktop이 설치된 경우 설정에 MCP 서버가 구성되어 있는지 확인하세요.",',
    'permission_required: "권한 필요",',
    'approve_description: "다음 기능을 요청합니다. 이 커넥터를 활성화하려면 검토하고 승인하세요.",',
    'approve_connect: "승인 및 연결",',
  ])
);

// ─── vault.picker_section ────────────────────────────────────────────────────
insertAfter(
  '      filter_license: "\ub77c\uc774\uc120\uc2a4",',
  blk6([
    'credential_name: "자격 증명 이름",',
    'add_project_first: "코드베이스를 에이전트에 연결하려면 먼저 Dev Tools에서 프로젝트를 추가하세요.",',
    'go_to_dev_tools: "Dev Tools로 이동",',
    'workspace_connect_description: "Google 로그인 한 번으로 Gmail, Calendar, Drive, Sheets 자격 증명 자동 생성",',
    'foraging_description: "파일 시스템에서 기존 API 키, AWS 프로파일, 환경 변수 등을 스캔",',
    'no_setup_guide: "이 커넥터에 사용 가능한 설정 가이드가 없습니다. 지침은 아래 설명서 링크를 방문하세요.",',
    'open_setup_page: "{label} 설정 페이지 열기",',
  ])
);

// ─── vault.cli_capture ───────────────────────────────────────────────────────
// Add as new section (it's not in ko.ts yet)
insertAfter(
  '      filter_license: "\ub77c\uc774\uc120\uc2a4",\n    },\n    schemas: {',
  blk4([
    'cli_capture: {',
    '  // @llm-translated 2026-04-17',
    '  cta: "로컬 CLI에서 가져오기",',
    '  hint: "API 키를 붙여넣는 대신 이미 로그인된 로컬 CLI 사용",',
    '  running: "로컬 CLI 실행 중...",',
    '  success: "CLI에서 자격 증명 캡처됨",',
    '  token_ttl_notice: "이 토큰은 {seconds}초 후 만료되며 자동으로 갱신됩니다.",',
    '  source_label: "CLI",',
    '  missing_binary: "`{binary}`이(가) 설치되어 있지 않거나 허용된 위치에 없습니다.",',
    '  unauthenticated: "{binary}에 로그인되어 있지 않습니다. {instruction}",',
    '  capture_failed: "CLI 캡처 실패: {detail}",',
    '  timeout: "CLI 캡처 시간 초과. 먼저 명령을 수동으로 실행해 보세요.",',
    '},',
  ])
);

// ─── vault.design_phases ─────────────────────────────────────────────────────
insertAfter(
  '      copy_to_clipboard: "\ud074\ub9bd\ubcf4\ub4dc\uc5d0 \ubcf5\uc0ac",',
  blk6([
    'credential_saved_message: "{label} 자격 증명이 안전하게 저장되었습니다.",',
    'revision_count: "(개정 {count})",',
    'connector_added_to_catalog: "커넥터가 카탈로그에 추가됨 -- 이제 다른 페르소나 및 템플릿 채택에 사용 가능합니다.",',
    'view_credential: "자격 증명 보기",',
    'refine_hint: "범위 조정, 필드 추가, 또는 구성 조정이 필요하신가요?",',
    'refine_placeholder: "예: 쓰기 범위 추가, 스테이징 환경 추가...",',
    'refine: "정제",',
    'linked_to_existing: "자격 증명이 기존 커넥터 정의에 연결됩니다.",',
    'no_existing_connector: "-- 카탈로그에서 기존 {name} 커넥터를 찾을 수 없습니다.",',
    'new_connector_will_be_registered: "자격 증명을 저장하면 AI 생성 커넥터 정의가 커넥터 카탈로그에 자동 등록됩니다 -- 다른 페르소나 및 템플릿 채택에 재사용 가능합니다.",',
    'refine_request: "맞지 않으신가요? 요청 정제",',
    'auto_provision_hint: "-- AI가 {label} 자격 증명 획득을 단계별로 안내합니다.",',
    'credential_name_label: "자격 증명 이름",',
    'credentials_secure_notice: "자격 증명은 앱 볼트에 안전하게 저장되며 에이전트 도구 실행에 사용 가능합니다.",',
    'tested_successfully_at: "{time}에 테스트 성공",',
    'setup_instructions: "설정 지침",',
    'all_steps_complete: "모든 단계 완료 -- 아래 필드를 작성하고 연결을 테스트하세요.",',
    'use_template: "사용",',
    'recipe_used_one: "-- {count}회 사용됨",',
    'recipe_used_other: "-- {count}회 사용됨",',
    'instruction_placeholder: "예: Slack, OpenAI, GitHub, Stripe...",',
  ])
);

// ─── vault.auto_cred_extra ───────────────────────────────────────────────────
insertAfter(
  '      setup_context: "\uc124\uacc4 \ubd84\uc11d\uc758 \uc124\uc815 \ubb38\ub9e5:",',
  blk6([
    'browser_automation_warning: "브라우저 자동화가 실행 중입니다. 창과 상호작용하지 마세요 — 완료되면 재개됩니다.",',
    'desktop_bridge_title: "{{label}}은(는) 데스크톱 앱이 필요합니다",',
    'desktop_bridge_hint: "이 커넥터는 Personas 데스크톱 앱에서만 실행되는 네이티브 브라우저 세션을 구동합니다.",',
    'review_extracted: "추출된 자격 증명 검토",',
    'review_extracted_hint: "브라우저에서 추출된 값 — 저장 전에 확인하세요",',
    'completeness_partial: "{total}개 필수 필드 중 {filled}개 입력됨. 저장 전에 누락된 필드를 완성하세요.",',
    'universal_auto_setup: "범용 자동 설정",',
    'universal_auto_setup_hint: "URL과 설명을 제공하면 AI가 사이트를 탐색해 API 자격 증명을 자동으로 발견하고 생성합니다.",',
    'service_url_label: "서비스 URL",',
    'service_url_placeholder: "https://app.example.com 또는 https://developer.example.com",',
    'what_do_you_need: "무엇이 필요하신가요?",',
    'description_placeholder: "예: REST API 읽기/쓰기용 API 키가 필요합니다. 개발자 포털에는 설정의 API 키 섹션이 있습니다.",',
    'discover_credentials: "자격 증명 발견",',
    'discovered_label: "발견됨: {label}",',
    'fields_discovered_one: "{count}개 필드 발견됨",',
    'fields_discovered_other: "{count}개 필드 발견됨",',
    'extracted_values_label: "추출된 값",',
    'no_fields_discovered: "필드가 발견되지 않았습니다. 더 구체적인 설명으로 다시 시도해 보세요.",',
    'fields_captured_partial: "{total}개 중 {filled}개 필드 캡처됨",',
    'credential_stored: "{label} 자격 증명이 안전하게 저장되었습니다.",',
  ])
);

// ─── vault.negotiator_extra ──────────────────────────────────────────────────
insertAfter(
  '      ask_question: "\uc774 \ub2e8\uacc4\uc5d0 \ub300\ud574 \uc9c8\ubb38\ud558\uae30...",',
  blk6([
    'panel_title: "AI 자격 증명 협상기",',
    'planning_description: "AI가 개발자 포털을 분석하고 단계별 프로비저닝 계획을 생성하고 있습니다...",',
  ])
);

// ─── vault.workspace_panel ───────────────────────────────────────────────────
insertAfter(
  '      some_failed: "\uc77c\ubd80 \uc790\uaca9 \uc99d\uba85 \uc2e4\ud328",',
  blk6([
    'selected_count: "{total}개 중 {selected}개 선택됨",',
    'select_all: "전체 선택",',
    'connect_services_one: "로그인 한 번으로 {count}개 서비스 연결",',
    'connect_services_other: "로그인 한 번으로 {count}개 서비스 연결",',
    'granting_access_one: "{count}개 서비스에 대한 액세스가 부여됩니다",',
    'granting_access_other: "{count}개 서비스에 대한 액세스가 부여됩니다",',
    'credentials_created_one: "단일 로그인으로 {count}개 자격 증명 생성됨.",',
    'credentials_created_other: "단일 로그인으로 {count}개 자격 증명 생성됨.",',
    'sign_in_browser: "브라우저 창에서 Google 계정으로 로그인하세요.",',
  ])
);

fs.writeFileSync('src/i18n/ko.ts', ko);
console.log('Vault patches done');
