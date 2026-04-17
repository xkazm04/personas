/**
 * Patch script: insert all missing Japanese translation keys into src/i18n/ja.ts
 * Run: node scripts/patch-ja-translations.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const jaPath = resolve(__dirname, '../src/i18n/ja.ts');

const ANNO = '// @llm-translated 2026-04-17';

let content = readFileSync(jaPath, 'utf8');

/**
 * Insert lines after a unique anchor string in the content.
 * anchorLine: exact line to find (trimmed match)
 * newLines: array of strings to insert after that line
 */
function insertAfter(anchorLine, newLines) {
  const idx = content.indexOf(anchorLine);
  if (idx === -1) {
    console.warn('ANCHOR NOT FOUND:', anchorLine.slice(0, 80));
    return;
  }
  const afterAnchor = idx + anchorLine.length;
  // Find end of that line (the \n)
  const nlPos = content.indexOf('\n', afterAnchor);
  if (nlPos === -1) return;
  content = content.slice(0, nlPos + 1) + newLines.join('\n') + '\n' + content.slice(nlPos + 1);
}

/**
 * Insert lines before a unique anchor string in the content.
 */
function insertBefore(anchorLine, newLines) {
  const idx = content.indexOf(anchorLine);
  if (idx === -1) {
    console.warn('ANCHOR NOT FOUND (before):', anchorLine.slice(0, 80));
    return;
  }
  // Find start of that line
  const lineStart = content.lastIndexOf('\n', idx - 1) + 1;
  content = content.slice(0, lineStart) + newLines.join('\n') + '\n' + content.slice(lineStart);
}

// ============================================================
// common.optional  (insert after loading_label line)
// ============================================================
insertAfter('    loading_label: "読み込み中",', [
  `    ${ANNO}`,
  `    optional: "任意",`,
]);

// ============================================================
// sidebar: quality_gates, config_resolution (insert before closing })
// ============================================================
insertAfter('    pending_events_sr_other: "{count}件の保留イベント",', [
  `    ${ANNO}`,
  `    quality_gates: "コンテンツフィルター",`,
  `    ${ANNO}`,
  `    config_resolution: "エージェント設定",`,
]);

// ============================================================
// agents.executions: depth_label etc (insert after frame_count)
// ============================================================
insertAfter('      frame_count: "フレーム {index}/{total}",', [
  `      ${ANNO}`,
  `      depth_label: "深さ:",`,
  `      ${ANNO}`,
  `      active_count_label: "アクティブ ({count})",`,
  `      ${ANNO}`,
  `      completed_count_label: "完了 ({count})",`,
  `      ${ANNO}`,
  `      metadata_section: "メタデータ",`,
]);

// agents.executions: chain_id_prefix etc (insert after ms_into_stage)
insertAfter('      ms_into_stage: "ステージ内 {ms}ms",', [
  `      ${ANNO}`,
  `      chain_id_prefix: "チェーン: {id}",`,
  `      ${ANNO}`,
  `      chain_total_duration: "合計: {duration}",`,
  `      ${ANNO}`,
  `      zero_ms: "0ms",`,
  `      ${ANNO}`,
  `      tool_calls_count: "{count}件のツール呼び出し",`,
  `      ${ANNO}`,
  `      tool_calls_count_other: "{count}件のツール呼び出し",`,
  `      ${ANNO}`,
  `      unique_tools_count: "({count}種類)",`,
  `      ${ANNO}`,
  `      prev_error_nav: "前のエラー (Shift+E)",`,
  `      ${ANNO}`,
  `      next_error_nav: "次のエラー (E)",`,
  `      ${ANNO}`,
  `      runner_input_placeholder: "{ \\"key\\": \\"value\\" }",`,
]);

// ============================================================
// agents.lab: objective_warning, objective_fallback_toast
// ============================================================
// Find a good anchor in lab section
insertAfter('      regenerate_strategies_title: "戦略を再生成",', [
  `      ${ANNO}`,
  `      objective_warning: "フィットネス目標の問題",`,
  `      ${ANNO}`,
  `      objective_fallback_toast: "進化はデフォルトのフィットネスウェイトを使用しました — 目標設定を確認してください",`,
]).toString();

// Alternative anchor if above not found
// Find last key in lab section
const labObjectiveAnchor = '      cancel_matrix_test: "マトリクステストをキャンセル",';
if (content.indexOf('objective_warning') === -1) {
  insertAfter(labObjectiveAnchor, [
    `      ${ANNO}`,
    `      objective_warning: "フィットネス目標の問題",`,
    `      ${ANNO}`,
    `      objective_fallback_toast: "進化はデフォルトのフィットネスウェイトを使用しました — 目標設定を確認してください",`,
  ]);
}

// ============================================================
// agents.design: conv_controls_aria
// ============================================================
insertAfter('      run_btn_aria: "', [
  `      ${ANNO}`,
  `      conv_controls_aria: "デザイン会話コントロール",`,
]);

// ============================================================
// agents.connectors
// ============================================================
insertAfter('      auto_schema_hint: "', [
  `      ${ANNO}`,
  `      auto_input_schema_placeholder: "{ \\"file_url\\": \\"string\\" }",`,
  `      ${ANNO}`,
  `      auto_github_token_needs: "トークンには {scopes} スコープが必要です。github.com/settings/tokens でトークンを更新してください。",`,
  `      ${ANNO}`,
  `      auto_fallback_title: "失敗時はダイレクトコネクタにフォールバック",`,
]);

// ============================================================
// agents.model_config: model_name_placeholder_override
// ============================================================
insertAfter('      model_name_placeholder: "', [
  `      ${ANNO}`,
  `      model_name_placeholder_override: "例: claude-sonnet-4-20250514",`,
]);

// ============================================================
// agents.settings_status
// ============================================================
insertAfter('      voice_label: "', [
  `      ${ANNO}`,
  `      speak_as: "として話す",`,
  `      ${ANNO}`,
  `      no_twins_configured: "ツインが設定されていません。ツインプラグインを開いて作成してください — このペルソナがそれを採用できるようになります。",`,
  `      ${ANNO}`,
  `      twin_profile_aria: "このペルソナが話すツインプロフィール",`,
]);

// ============================================================
// agents.tool_runner: input_json_placeholder
// ============================================================
insertAfter('      run_tool_btn: "', [
  `      ${ANNO}`,
  `      input_json_placeholder: "{ \\"key\\": \\"value\\" }",`,
]);

// ============================================================
// agents.prompt_editor: sections_aria
// ============================================================
insertAfter('      section_count: "', [
  `      ${ANNO}`,
  `      sections_aria: "プロンプトセクション",`,
]);

// ============================================================
// vault.list: sort_label
// ============================================================
insertAfter('      sort_by: "', [
  `      ${ANNO}`,
  `      sort_label: "並び替え",`,
]);

// ============================================================
// vault.import (8 keys)
// ============================================================
insertAfter('      import_format_hint: "', [
  `      ${ANNO}`,
  `      parse_secrets: "シークレットを解析",`,
  `      ${ANNO}`,
  `      selected_for_import: "インポート選択済み",`,
  `      ${ANNO}`,
  `      auto_detected: "自動検出",`,
  `      ${ANNO}`,
  `      sync_supported: "同期対応",`,
  `      ${ANNO}`,
  `      secrets_found_one: "{count}件のシークレットが見つかりました",`,
  `      ${ANNO}`,
  `      secrets_found_other: "{count}件のシークレットが見つかりました",`,
  `      ${ANNO}`,
  `      import_secrets_one: "{count}件のシークレットをインポート",`,
  `      ${ANNO}`,
  `      import_secrets_other: "{count}件のシークレットをインポート",`,
]);

// ============================================================
// vault.card: reauthorize_scopes
// ============================================================
insertAfter('      reauthorize: "', [
  `      ${ANNO}`,
  `      reauthorize_scopes: "スコープを再認証",`,
]);

// ============================================================
// vault.forms (12 keys)
// ============================================================
insertAfter('      test_connection: "', [
  `      ${ANNO}`,
  `      connection_test_heading: "接続テスト",`,
  `      ${ANNO}`,
  `      test_connection_btn: "接続をテスト",`,
  `      ${ANNO}`,
  `      credential_fields_heading: "認証情報フィールド",`,
  `      ${ANNO}`,
  `      how_to_get_connector: "取得方法",`,
  `      ${ANNO}`,
  `      authorization_complete: "認証完了",`,
  `      ${ANNO}`,
  `      copied_to_clipboard: "クリップボードにコピーしました",`,
  `      ${ANNO}`,
  `      credential_name: "認証情報名",`,
  `      ${ANNO}`,
  `      credential_name_placeholder: "例: 仕事用 GitHub",`,
  `      ${ANNO}`,
  `      authorizing_with: "{name}で認証中...",`,
  `      ${ANNO}`,
  `      authorize_with: "{name}で認証",`,
  `      ${ANNO}`,
  `      oauth_consent_hint: "OAuth同意ページが新しいウィンドウで開きます。",`,
  `      ${ANNO}`,
  `      oauth_connected_at: "{time}に接続済み",`,
]);

// ============================================================
// vault.auto_cred (8 keys)
// ============================================================
insertAfter('      browser_status_ready: "', [
  `      ${ANNO}`,
  `      cancel_session: "セッションをキャンセル",`,
  `      ${ANNO}`,
  `      test_connection: "接続をテスト",`,
  `      ${ANNO}`,
  `      testing: "テスト中...",`,
  `      ${ANNO}`,
  `      re_run_browser: "ブラウザを再実行",`,
  `      ${ANNO}`,
  `      discard: "破棄",`,
  `      ${ANNO}`,
  `      save_credential: "認証情報を保存",`,
  `      ${ANNO}`,
  `      save_procedure: "手順を保存",`,
  `      ${ANNO}`,
  `      procedure_saved: "手順が保存されました",`,
]);

// ============================================================
// vault.databases (2 keys)
// ============================================================
insertAfter('      query_placeholder: "', [
  `      ${ANNO}`,
  `      not_null: "NOT NULL",`,
  `      ${ANNO}`,
  `      ctrl_enter: "Ctrl+Enter",`,
]);

// ============================================================
// vault.dependencies (4 keys)
// ============================================================
insertAfter('      health_score_label: "', [
  `      ${ANNO}`,
  `      sim_critical: "重大",`,
  `      ${ANNO}`,
  `      sim_high: "高",`,
  `      ${ANNO}`,
  `      sim_medium: "中",`,
  `      ${ANNO}`,
  `      per_day: "/日",`,
]);

// ============================================================
// vault.shared (16 keys)
// ============================================================
insertAfter('      copy_id: "', [
  `      ${ANNO}`,
  `      copied: "コピー済み",`,
  `      ${ANNO}`,
  `      kb_count_summary: "{count}件のチャンクが {size} でインデックス済み",`,
  `      ${ANNO}`,
  `      default_patterns: "デフォルトパターン",`,
  `      ${ANNO}`,
  `      add_pattern_placeholder: "パターンを追加...",`,
  `      ${ANNO}`,
  `      distance_label: "距離:",`,
  `      ${ANNO}`,
  `      chunk_label: "チャンク:",`,
  `      ${ANNO}`,
  `      copy_credential_id: "認証情報IDをコピー",`,
  `      ${ANNO}`,
  `      request_body: "リクエストボディ",`,
  `      ${ANNO}`,
  `      add_tag_title: "タグを追加",`,
  `      ${ANNO}`,
  `      local_embedding_hint: "ローカル埋め込みはGPUがない場合、低速になる場合があります。",`,
  `      ${ANNO}`,
  `      api_path_placeholder: "/v1/endpoint",`,
  `      ${ANNO}`,
  `      json_body_placeholder: "{ \\"key\\": \\"value\\" }",`,
  `      ${ANNO}`,
  `      sending: "送信中...",`,
  `      ${ANNO}`,
  `      send: "送信",`,
  `      ${ANNO}`,
  `      search_results_one: "{count}件の結果",`,
  `      ${ANNO}`,
  `      search_results_other: "{count}件の結果",`,
]);

// ============================================================
// vault.bulk_healthcheck (3 keys)
// ============================================================
insertAfter('      run_bulk_check: "', [
  `      ${ANNO}`,
  `      passed_count: "{count}件合格",`,
  `      ${ANNO}`,
  `      failed_count: "{count}件失敗",`,
  `      ${ANNO}`,
  `      total_count: "{count}件合計",`,
]);

// ============================================================
// vault.token_metrics: fallback_used
// ============================================================
insertAfter('      token_budget_label: "', [
  `      ${ANNO}`,
  `      fallback_used: "フォールバック使用済み",`,
]);

// ============================================================
// vault.reauth_banner (2 keys)
// ============================================================
insertAfter('      reauth_required: "', [
  `      ${ANNO}`,
  `      access_revoked: "アクセスが取り消されました",`,
  `      ${ANNO}`,
  `      reconnect: "再接続",`,
]);

// ============================================================
// vault.rotation_section: last_rotated
// ============================================================
insertAfter('      rotation_interval_label: "', [
  `      ${ANNO}`,
  `      last_rotated: "最終ローテーション",`,
]);

// ============================================================
// vault.event_config: loading
// ============================================================
insertAfter('      event_config_title: "', [
  `      ${ANNO}`,
  `      loading: "読み込み中...",`,
]);

// ============================================================
// vault.credential_forms (4 keys)
// ============================================================
insertAfter('      generate_token_hint: "', [
  `      ${ANNO}`,
  `      open_to_generate: "クリックして生成",`,
  `      ${ANNO}`,
  `      already_configured: "設定済み",`,
  `      ${ANNO}`,
  `      setup_instructions_label: "セットアップ手順",`,
  `      ${ANNO}`,
  `      no_fields_defined: "フィールドが定義されていません",`,
]);

// ============================================================
// vault.audit_log (9 keys)
// ============================================================
insertAfter('      audit_title: "', [
  `      ${ANNO}`,
  `      loading: "読み込み中...",`,
  `      ${ANNO}`,
  `      total_accesses: "合計アクセス数",`,
  `      ${ANNO}`,
  `      personas_one: "{count}件のペルソナ",`,
  `      ${ANNO}`,
  `      personas_other: "{count}件のペルソナ",`,
  `      ${ANNO}`,
  `      accesses_24h: "24時間以内のアクセス",`,
  `      ${ANNO}`,
  `      anomalies_one: "{count}件の異常",`,
  `      ${ANNO}`,
  `      anomalies_other: "{count}件の異常",`,
  `      ${ANNO}`,
  `      no_anomalies: "異常なし",`,
  `      ${ANNO}`,
  `      show_all: "すべて表示",`,
]);

// ============================================================
// vault.credential_import (6 keys)
// ============================================================
insertAfter('      sync_interval_label: "', [
  `      ${ANNO}`,
  `      sync_hint: "同期間隔を設定して、認証情報を定期的に更新します。",`,
  `      ${ANNO}`,
  `      interval_15min: "15分ごと",`,
  `      ${ANNO}`,
  `      interval_30min: "30分ごと",`,
  `      ${ANNO}`,
  `      interval_1hr: "1時間ごと",`,
  `      ${ANNO}`,
  `      interval_6hr: "6時間ごと",`,
  `      ${ANNO}`,
  `      interval_24hr: "24時間ごと",`,
]);

// ============================================================
// vault.wizard_detect (9 keys)
// ============================================================
insertAfter('      detection_title: "', [
  `      ${ANNO}`,
  `      set_up_credentials: "認証情報を設定",`,
  `      ${ANNO}`,
  `      clear_selection: "選択をクリア",`,
  `      ${ANNO}`,
  `      set_up_services: "サービスを設定",`,
  `      ${ANNO}`,
  `      setting_up: "設定中...",`,
  `      ${ANNO}`,
  `      wizard_title: "セットアップウィザード",`,
  `      ${ANNO}`,
  `      choose_service: "サービスを選択",`,
  `      ${ANNO}`,
  `      ai_walk_description: "AIが認証情報セットアップをガイドします",`,
  `      ${ANNO}`,
  `      wizard_subtitle: "接続するサービスを選択してください。",`,
  `      ${ANNO}`,
  `      wizard_subtitle_batch: "複数のサービスをまとめて設定できます。",`,
]);

// ============================================================
// vault.autopilot (17 keys)
// ============================================================
insertAfter('      openapi_title: "', [
  `      ${ANNO}`,
  `      from_url: "URLから",`,
  `      ${ANNO}`,
  `      paste_content: "内容を貼り付け",`,
  `      ${ANNO}`,
  `      openapi_spec_url: "OpenAPI仕様URL",`,
  `      ${ANNO}`,
  `      openapi_format_hint: "OpenAPI 3.x または Swagger 2.x をサポートしています。",`,
  `      ${ANNO}`,
  `      parsing_spec: "仕様を解析中...",`,
  `      ${ANNO}`,
  `      parse_analyze: "解析して分析",`,
  `      ${ANNO}`,
  `      connector_in_catalog: "カタログ内のコネクタ",`,
  `      ${ANNO}`,
  `      generated_tools: "生成されたツール",`,
  `      ${ANNO}`,
  `      credential_fields: "認証情報フィールド",`,
  `      ${ANNO}`,
  `      open_playground: "プレイグラウンドを開く",`,
  `      ${ANNO}`,
  `      copy_connector_id: "コネクタIDをコピー",`,
  `      ${ANNO}`,
  `      go_to_catalog: "カタログへ",`,
  `      ${ANNO}`,
  `      response_headers: "レスポンスヘッダー",`,
  `      ${ANNO}`,
  `      base_url_placeholder: "https://api.example.com",`,
  `      ${ANNO}`,
  `      openapi_url_placeholder: "https://api.example.com/openapi.json",`,
  `      ${ANNO}`,
  `      auth_schemes: "認証スキーム",`,
  `      ${ANNO}`,
  `      body_placeholder: "{ \\"key\\": \\"value\\" }",`,
]);

// ============================================================
// vault.foraging (19 keys)
// ============================================================
insertAfter('      foraging_title: "', [
  `      ${ANNO}`,
  `      start_scan: "スキャン開始",`,
  `      ${ANNO}`,
  `      checking_env: "環境を確認中...",`,
  `      ${ANNO}`,
  `      importing: "インポート中...",`,
  `      ${ANNO}`,
  `      scan_again: "再スキャン",`,
  `      ${ANNO}`,
  `      back_to_vault: "ボールトに戻る",`,
  `      ${ANNO}`,
  `      already_in_vault: "ボールトに登録済み",`,
  `      ${ANNO}`,
  `      imported: "インポート済み",`,
  `      ${ANNO}`,
  `      to_vault: "ボールトへ",`,
  `      ${ANNO}`,
  `      credentials_found_one: "{count}件の認証情報が見つかりました",`,
  `      ${ANNO}`,
  `      credentials_found_other: "{count}件の認証情報が見つかりました",`,
  `      ${ANNO}`,
  `      selected: "選択済み",`,
  `      ${ANNO}`,
  `      import_to_vault_one: "{count}件をボールトにインポート",`,
  `      ${ANNO}`,
  `      import_to_vault_other: "{count}件をボールトにインポート",`,
  `      ${ANNO}`,
  `      env_var_one: "{count}件の環境変数",`,
  `      ${ANNO}`,
  `      env_var_other: "{count}件の環境変数",`,
  `      ${ANNO}`,
  `      import_server: "サーバーからインポート",`,
  `      ${ANNO}`,
  `      sources_in: "ソース: {source}",`,
  `      ${ANNO}`,
  `      progress_aria: "スキャン進捗",`,
  `      ${ANNO}`,
  `      scanned_sources: "スキャン済みソース",`,
]);

// ============================================================
// vault.desktop_discovery (15 keys)
// ============================================================
insertAfter('      discovery_title: "', [
  `      ${ANNO}`,
  `      connect_description: "デスクトップアプリを検出してMCPサーバーに接続します。",`,
  `      ${ANNO}`,
  `      detected_apps_tab: "検出されたアプリ",`,
  `      ${ANNO}`,
  `      claude_mcp_tab: "Claude MCP",`,
  `      ${ANNO}`,
  `      scanning: "スキャン中...",`,
  `      ${ANNO}`,
  `      detected_on_system: "システムで検出済み",`,
  `      ${ANNO}`,
  `      not_detected: "未検出",`,
  `      ${ANNO}`,
  `      no_apps: "アプリが見つかりません",`,
  `      ${ANNO}`,
  `      reading_config: "設定を読み込み中...",`,
  `      ${ANNO}`,
  `      mcp_servers_found_one: "{count}件のMCPサーバーが見つかりました",`,
  `      ${ANNO}`,
  `      mcp_servers_found_other: "{count}件のMCPサーバーが見つかりました",`,
  `      ${ANNO}`,
  `      no_mcp_config: "MCP設定が見つかりません",`,
  `      ${ANNO}`,
  `      mcp_config_hint: "Claude Desktopに claude_desktop_config.json があります。",`,
  `      ${ANNO}`,
  `      permission_required: "権限が必要です",`,
  `      ${ANNO}`,
  `      approve_description: "このアプリへのアクセスを承認してください。",`,
  `      ${ANNO}`,
  `      approve_connect: "接続を承認",`,
]);

// ============================================================
// vault.picker_section (7 keys)
// ============================================================
insertAfter('      picker_title: "', [
  `      ${ANNO}`,
  `      credential_name: "認証情報名",`,
  `      ${ANNO}`,
  `      add_project_first: "まずプロジェクトを追加してください",`,
  `      ${ANNO}`,
  `      go_to_dev_tools: "開発ツールへ",`,
  `      ${ANNO}`,
  `      workspace_connect_description: "ワークスペースをコネクタに接続します。",`,
  `      ${ANNO}`,
  `      foraging_description: "環境から認証情報を自動検出します。",`,
  `      ${ANNO}`,
  `      no_setup_guide: "このコネクタのセットアップガイドはありません",`,
  `      ${ANNO}`,
  `      open_setup_page: "セットアップページを開く",`,
]);

// ============================================================
// vault.cli_capture (10 keys)
// ============================================================
insertAfter('      cli_title: "', [
  `      ${ANNO}`,
  `      cta: "CLIで認証情報をキャプチャ",`,
  `      ${ANNO}`,
  `      hint: "コマンドラインからの認証情報を自動でボールトにインポートします。",`,
  `      ${ANNO}`,
  `      running: "実行中...",`,
  `      ${ANNO}`,
  `      success: "キャプチャ成功",`,
  `      ${ANNO}`,
  `      token_ttl_notice: "トークンは {hours}時間後に期限切れになります。",`,
  `      ${ANNO}`,
  `      source_label: "ソース:",`,
  `      ${ANNO}`,
  `      missing_binary: "バイナリが見つかりません: {binary}",`,
  `      ${ANNO}`,
  `      unauthenticated: "未認証です。先にログインしてください。",`,
  `      ${ANNO}`,
  `      capture_failed: "キャプチャに失敗しました",`,
  `      ${ANNO}`,
  `      timeout: "タイムアウト",`,
]);

// ============================================================
// vault.design_phases (21 keys)
// ============================================================
insertAfter('      phase_title_setup: "', [
  `      ${ANNO}`,
  `      credential_saved_message: "認証情報が保存されました",`,
  `      ${ANNO}`,
  `      revision_count: "改訂 {count}",`,
  `      ${ANNO}`,
  `      connector_added_to_catalog: "コネクタがカタログに追加されました",`,
  `      ${ANNO}`,
  `      view_credential: "認証情報を表示",`,
  `      ${ANNO}`,
  `      refine_hint: "何を修正しますか？",`,
  `      ${ANNO}`,
  `      refine_placeholder: "修正内容を説明...",`,
  `      ${ANNO}`,
  `      refine: "改善",`,
  `      ${ANNO}`,
  `      linked_to_existing: "既存のコネクタにリンク済み",`,
  `      ${ANNO}`,
  `      no_existing_connector: "既存のコネクタなし",`,
  `      ${ANNO}`,
  `      new_connector_will_be_registered: "新しいコネクタが登録されます",`,
  `      ${ANNO}`,
  `      refine_request: "改善リクエスト",`,
  `      ${ANNO}`,
  `      auto_provision_hint: "自動プロビジョニングが認証情報を設定します。",`,
  `      ${ANNO}`,
  `      credential_name_label: "認証情報名",`,
  `      ${ANNO}`,
  `      credentials_secure_notice: "認証情報はAES-256-GCMで暗号化されます。",`,
  `      ${ANNO}`,
  `      tested_successfully_at: "{time}にテスト成功",`,
  `      ${ANNO}`,
  `      setup_instructions: "セットアップ手順",`,
  `      ${ANNO}`,
  `      all_steps_complete: "すべてのステップ完了",`,
  `      ${ANNO}`,
  `      use_template: "テンプレートを使用",`,
  `      ${ANNO}`,
  `      recipe_used_one: "{count}件のレシピを使用",`,
  `      ${ANNO}`,
  `      recipe_used_other: "{count}件のレシピを使用",`,
  `      ${ANNO}`,
  `      instruction_placeholder: "手順を入力...",`,
]);

// ============================================================
// vault.auto_cred_extra (20 keys)
// ============================================================
insertAfter('      auto_cred_extra_title: "', [
  `      ${ANNO}`,
  `      browser_automation_warning: "ブラウザ自動化には注意が必要です。機密情報を取り扱う場合があります。",`,
  `      ${ANNO}`,
  `      desktop_bridge_title: "デスクトップブリッジ",`,
  `      ${ANNO}`,
  `      desktop_bridge_hint: "ローカルアプリのセッションデータを使用して認証情報を取得します。",`,
  `      ${ANNO}`,
  `      review_extracted: "抽出された情報を確認",`,
  `      ${ANNO}`,
  `      review_extracted_hint: "保存前に抽出されたフィールドを確認してください。",`,
  `      ${ANNO}`,
  `      completeness_partial: "一部のフィールドが見つかりました",`,
  `      ${ANNO}`,
  `      universal_auto_setup: "ユニバーサル自動セットアップ",`,
  `      ${ANNO}`,
  `      universal_auto_setup_hint: "サービスURLと必要なものを説明すると、AIが認証情報を取得します。",`,
  `      ${ANNO}`,
  `      service_url_label: "サービスURL",`,
  `      ${ANNO}`,
  `      service_url_placeholder: "https://app.example.com",`,
  `      ${ANNO}`,
  `      what_do_you_need: "何が必要ですか？",`,
  `      ${ANNO}`,
  `      description_placeholder: "例: APIキーとシークレットが必要です",`,
  `      ${ANNO}`,
  `      discover_credentials: "認証情報を検出",`,
  `      ${ANNO}`,
  `      discovered_label: "検出済み",`,
  `      ${ANNO}`,
  `      fields_discovered_one: "{count}件のフィールドが検出されました",`,
  `      ${ANNO}`,
  `      fields_discovered_other: "{count}件のフィールドが検出されました",`,
  `      ${ANNO}`,
  `      extracted_values_label: "抽出された値",`,
  `      ${ANNO}`,
  `      no_fields_discovered: "フィールドが検出されませんでした",`,
  `      ${ANNO}`,
  `      fields_captured_partial: "一部のフィールドのみキャプチャされました",`,
  `      ${ANNO}`,
  `      credential_stored: "認証情報が保存されました",`,
]);

// ============================================================
// vault.negotiator_extra (2 keys)
// ============================================================
insertAfter('      negotiator_title: "', [
  `      ${ANNO}`,
  `      panel_title: "ネゴシエーターパネル",`,
  `      ${ANNO}`,
  `      planning_description: "AIがアクセストークンの取得計画を作成中です。",`,
]);

// ============================================================
// vault.workspace_panel (9 keys)
// ============================================================
insertAfter('      workspace_title: "', [
  `      ${ANNO}`,
  `      selected_count: "{count}件選択済み",`,
  `      ${ANNO}`,
  `      select_all: "すべて選択",`,
  `      ${ANNO}`,
  `      connect_services_one: "{count}件のサービスを接続",`,
  `      ${ANNO}`,
  `      connect_services_other: "{count}件のサービスを接続",`,
  `      ${ANNO}`,
  `      granting_access_one: "{count}件のアクセスを付与中",`,
  `      ${ANNO}`,
  `      granting_access_other: "{count}件のアクセスを付与中",`,
  `      ${ANNO}`,
  `      credentials_created_one: "{count}件の認証情報が作成されました",`,
  `      ${ANNO}`,
  `      credentials_created_other: "{count}件の認証情報が作成されました",`,
  `      ${ANNO}`,
  `      sign_in_browser: "ブラウザでサインイン",`,
]);

// ============================================================
// deployment (39 keys)
// ============================================================
insertAfter('      request_body_label: "', [
  `      ${ANNO}`,
  `      request_body_placeholder: "{ \\"message\\": \\"プロンプトをここに...\\" }",`,
]);

insertAfter('      orchestrator_url_label: "', [
  `      ${ANNO}`,
  `      orchestrator_url_placeholder: "https://your-orchestrator.example.com",`,
]);

insertAfter('      no_deployments: "', [
  `      ${ANNO}`,
  `      no_deployments_yet: "デプロイメントがありません。上でペルソナを選択してクラウドAPIエンドポイントとしてデプロイしてください。",`,
  `      ${ANNO}`,
  `      active_deployments: "アクティブなデプロイメント",`,
]);

insertAfter('      exec_id_label: "', [
  `      ${ANNO}`,
  `      label_status: "ステータス:",`,
  `      ${ANNO}`,
  `      label_duration: "所要時間:",`,
  `      ${ANNO}`,
  `      label_cost: "コスト:",`,
  `      ${ANNO}`,
  `      label_tokens: "トークン:",`,
  `      ${ANNO}`,
  `      label_started: "開始:",`,
  `      ${ANNO}`,
  `      label_completed: "完了:",`,
  `      ${ANNO}`,
  `      label_input: "入力:",`,
  `      ${ANNO}`,
  `      view_output: "出力を表示",`,
  `      ${ANNO}`,
  `      output_prefix: "出力 (",`,
  `      ${ANNO}`,
  `      output_lines_suffix: "行)",`,
]);

insertAfter('      oauth_title: "', [
  `      ${ANNO}`,
  `      open_auth_window: "認証ウィンドウを開く",`,
  `      ${ANNO}`,
  `      complete_authorization: "認証を完了",`,
  `      ${ANNO}`,
  `      refresh_token: "トークンを更新",`,
  `      ${ANNO}`,
  `      open_authorization_window: "認証ウィンドウを開く",`,
  `      ${ANNO}`,
  `      token_unknown_msg: "トークンの有効性を確認できませんでした。トークンを更新して確認してください。",`,
  `      ${ANNO}`,
  `      connect_anthropic_msg: "Anthropicアカウントを接続してクラウド実行のOAuth認証を有効にします。",`,
  `      ${ANNO}`,
  `      token_expired_msg_prefix: "このOAuthトークンは期限切れです",`,
]);

insertAfter('      cron_label: "', [
  `      ${ANNO}`,
  `      cron_expression: "Cron式",`,
  `      ${ANNO}`,
  `      utc_suffix: "(UTC)",`,
  `      ${ANNO}`,
  `      webhook_info: "このトリガーにウェブフックエンドポイントが作成されます。作成後にペイロードフィルタリングを設定できます。",`,
]);

insertAfter('      chart_title: "', [
  `      ${ANNO}`,
  `      tooltip_runs: "実行数:",`,
  `      ${ANNO}`,
  `      tooltip_cost: "コスト:",`,
  `      ${ANNO}`,
  `      tooltip_success: "成功率:",`,
]);

insertAfter('      deploy_title: "', [
  `      ${ANNO}`,
  `      budget_label: "予算:",`,
  `      ${ANNO}`,
  `      label_invocations: "呼び出し数:",`,
  `      ${ANNO}`,
  `      label_last_called: "最終呼び出し:",`,
  `      ${ANNO}`,
  `      label_created: "作成日:",`,
]);

insertAfter('      history_title: "', [
  `      ${ANNO}`,
  `      clear_filters: "フィルターをクリア",`,
  `      ${ANNO}`,
  `      execution_history: "実行履歴",`,
]);

insertAfter('      schedule_title: "', [
  `      ${ANNO}`,
  `      label_type: "種別:",`,
  `      ${ANNO}`,
  `      label_status: "ステータス:",`,
  `      ${ANNO}`,
  `      label_last_triggered: "最終トリガー:",`,
  `      ${ANNO}`,
  `      label_next_trigger: "次回トリガー:",`,
  `      ${ANNO}`,
  `      label_cron: "Cron:",`,
  `      ${ANNO}`,
  `      loading_firings: "読み込み中...",`,
]);

// ============================================================
// sharing (10 keys)
// ============================================================
insertAfter('    hash_label: "', [
  `    ${ANNO}`,
  `    enclave_hash_label: "ハッシュ:",`,
]);

insertAfter('    peer_id_label: "', [
  `    ${ANNO}`,
  `    refresh_peer_list: "ピアリストを更新",`,
  `    ${ANNO}`,
  `    peer_list_stale: "ピアリストが古い可能性があります —",`,
  `    ${ANNO}`,
  `    network_data_stale: "ネットワークデータが古い可能性があります —",`,
  `    ${ANNO}`,
  `    peer_id_footer: "ピアID",`,
  `    ${ANNO}`,
  `    remove_exposure: "公開を解除",`,
  `    ${ANNO}`,
  `    revoke_trust: "信頼を取り消す",`,
  `    ${ANNO}`,
  `    remove_peer: "ピアを削除",`,
  `    ${ANNO}`,
  `    share_link_tooltip: "ワンタイム共有リンクを生成（24時間で期限切れ）",`,
  `    ${ANNO}`,
  `    copy_clipboard_tooltip: "バンドルをbase64でクリップボードにコピー（最大256KB）",`,
]);

// ============================================================
// overview (68 keys)
// ============================================================
insertAfter('      message_id_label: "', [
  `      ${ANNO}`,
  `      id_label: "ID:",`,
  `      ${ANNO}`,
  `      confirm_delete_title: "削除の確認",`,
  `      ${ANNO}`,
  `      close_message: "メッセージ詳細を閉じる",`,
]);

insertAfter('      no_memories: "', [
  `      ${ANNO}`,
  `      no_memories_hint: "エージェントが実行されると、重要なメモや学習内容がここに保存されます。",`,
  `      ${ANNO}`,
  `      no_memories_match: "現在のフィルターに一致するメモリがありません",`,
  `      ${ANNO}`,
  `      list_aria_label: "メモリリスト",`,
  `      ${ANNO}`,
  `      add_memory_btn: "メモリを追加",`,
  `      ${ANNO}`,
  `      search_placeholder: "メモリを検索...",`,
  `      ${ANNO}`,
  `      no_filter_match: "フィルターに一致するメモリがありません。検索を調整してください。",`,
]);

insertAfter('      conflicts_title: "', [
  `      ${ANNO}`,
  `      all_conflicts_resolved: "すべての競合が解決されました",`,
  `      ${ANNO}`,
  `      keep_prefix: "保存: \\"",`,
  `      ${ANNO}`,
  `      keep_suffix: "\\"",`,
]);

insertAfter('      leaderboard_title: "', [
  `      ${ANNO}`,
  `      fleet_avg: "フリート平均:",`,
  `      ${ANNO}`,
  `      refresh_label: "リーダーボードを更新",`,
  `      ${ANNO}`,
  `      computing_scores: "エージェントスコアを計算中...",`,
  `      ${ANNO}`,
  `      single_agent_has_data: "にデータがあります。",`,
  `      ${ANNO}`,
  `      add_more_agents: "ランキングを表示するにはエージェントを追加してください。現在 {name} のみ",`,
  `      ${ANNO}`,
  `      open_agent: "エージェントを開く",`,
  `      ${ANNO}`,
  `      no_agent_data_title: "エージェントデータなし",`,
  `      ${ANNO}`,
  `      no_agent_data_hint: "エージェントを実行してパフォーマンスランキングを表示します。リーダーボードには実行履歴とヘルスデータが必要です。",`,
]);

insertAfter('      health_score_label: "', [
  `      ${ANNO}`,
  `      score_prefix: "スコア:",`,
  `      ${ANNO}`,
  `      uptime_30d_prefix: "30日稼働率:",`,
  `      ${ANNO}`,
  `      updated_prefix: "更新",`,
  `      ${ANNO}`,
  `      consecutive_failures_one: "{count}件の連続失敗",`,
  `      ${ANNO}`,
  `      consecutive_failures_other: "{count}件の連続失敗",`,
]);

insertAfter('      burn_rate_title: "', [
  `      ${ANNO}`,
  `      active_personas_subtitle: "{count}件のアクティブペルソナ · ローカル月次境界",`,
]);

insertAfter('      predictive_title: "', [
  `      ${ANNO}`,
  `      per_month: "/月",`,
  `      ${ANNO}`,
  `      confidence_pct: "% 信頼度",`,
]);

insertAfter('      annotation_title: "', [
  `      ${ANNO}`,
  `      annotation_placeholder: "例: Stripe webhookの検証には解析済みJSONではなく生のリクエストボディが必要です",`,
]);

insertAfter('      knowledge_row_title: "', [
  `      ${ANNO}`,
  `      execution_trend_label: "実行トレンド",`,
]);

insertAfter('      knowledge_graph_title: "', [
  `      ${ANNO}`,
  `      mock_pattern: "モックパターン",`,
  `      ${ANNO}`,
  `      seed_tooltip: "モックパターンをシード（開発専用）",`,
  `      ${ANNO}`,
  `      all_types: "すべての種類",`,
  `      ${ANNO}`,
  `      all_scopes: "すべてのスコープ",`,
  `      ${ANNO}`,
  `      failure_drilldown_prefix: "失敗のドリルダウン:",`,
  `      ${ANNO}`,
  `      failure_date_filter: "{date}以降にアクティブな失敗パターンを表示",`,
  `      ${ANNO}`,
  `      data_unavailable: "ナレッジデータ利用不可",`,
  `      ${ANNO}`,
  `      loading_patterns: "ナレッジパターンを読み込み中...",`,
  `      ${ANNO}`,
  `      drilldown_toggle_title: "失敗ドリルダウンを表示/非表示",`,
  `      ${ANNO}`,
  `      no_patterns_yet: "ナレッジパターンなし",`,
  `      ${ANNO}`,
  `      no_patterns_yet_hint: "エージェントを実行してナレッジパターンを構築します。エージェントは時間とともに賢くなります。",`,
  `      ${ANNO}`,
  `      no_patterns_match: "現在のフィルターに一致するパターンがありません",`,
  `      ${ANNO}`,
  `      recent_learnings: "最近の学習",`,
  `      ${ANNO}`,
  `      curating_manually: "ドキュメントを手動でキュレーションしていますか？",`,
  `      ${ANNO}`,
  `      obsidian_tip: "~1000件以下のノートには、Obsidianコネクタでボールトを直接同期できます。",`,
]);

insertAfter('      decision_title: "', [
  `      ${ANNO}`,
  `      video_not_supported: "お使いのブラウザは動画再生に対応していません。",`,
  `      ${ANNO}`,
  `      reject_this: "これを却下",`,
  `      ${ANNO}`,
  `      accept_this: "これを承認",`,
]);

insertAfter('      review_focus_title: "', [
  `      ${ANNO}`,
  `      video_not_supported: "お使いのブラウザは動画再生に対応していません。",`,
]);

insertAfter('      bulk_action_title: "', [
  `      ${ANNO}`,
  `      pending_reviews_selected_one: "{count}件の保留レビューが選択されています",`,
  `      ${ANNO}`,
  `      pending_reviews_selected_other: "{count}件の保留レビューが選択されています",`,
]);

insertAfter('      inbox_title: "', [
  `      ${ANNO}`,
  `      drag_to_resize: "ドラッグしてサイズ変更",`,
]);

insertAfter('      healing_title: "', [
  `      ${ANNO}`,
  `      ai_healing_title: "AI ヒーリング",`,
  `      ${ANNO}`,
  `      diagnosis_label: "診断:",`,
  `      ${ANNO}`,
  `      fixes_applied: "修正が適用されました",`,
  `      ${ANNO}`,
  `      alert_history_title: "アラート履歴",`,
  `      ${ANNO}`,
  `      all_agents_global: "すべてのエージェント（グローバル）",`,
  `      ${ANNO}`,
  `      add_rule: "ルールを追加",`,
  `      ${ANNO}`,
  `      no_rules_configured: "アラートルールが設定されていません。ルールを追加して監視を開始してください。",`,
  `      ${ANNO}`,
  `      confidence_pct_suffix: "% 信頼度",`,
  `      ${ANNO}`,
  `      spike_on: "スパイク発生:",`,
  `      ${ANNO}`,
  `      correlated_events_prefix: "相関イベント (",`,
  `      ${ANNO}`,
  `      circuit_breaker_label: "サーキットブレーカー",`,
  `      ${ANNO}`,
  `      auto_disabled_message: "このペルソナは繰り返しの失敗に対するサーキットブレーカーとして自動的に無効化されました。",`,
  `      ${ANNO}`,
  `      execution_label: "実行:",`,
  `      ${ANNO}`,
  `      issue_marked_as: "この問題は次のようにマークされています:",`,
  `      ${ANNO}`,
  `      retry_in_progress: "リトライ実行中 — 完了次第ステータスが更新されます。",`,
  `      ${ANNO}`,
  `      resolve_issue_title: "問題を解決済みにマーク",`,
]);

// ============================================================
// templates (136 keys)
// ============================================================
insertAfter('      tabs_aria: "', [
  `      ${ANNO}`,
  `      template_details_tabs_aria: "テンプレート詳細",`,
]);

insertAfter('      answer_prefix: "', [
  `      ${ANNO}`,
  `      answer_cell: "回答: {cell}",`,
  `      ${ANNO}`,
  `      working_on: "作業中: {cells}",`,
  `      ${ANNO}`,
  `      draft_ready_label: "下書き準備完了",`,
  `      ${ANNO}`,
  `      editing_cell: "編集中: {cell}",`,
  `      ${ANNO}`,
  `      protocol_active: "プロトコルアクティブ",`,
  `      ${ANNO}`,
  `      matrix_unavailable: "マトリクスデータ利用不可。",`,
  `      ${ANNO}`,
  `      persona_matrix_title: "ペルソナマトリクス",`,
  `      ${ANNO}`,
  `      cell_status_analyzing: "分析中",`,
  `      ${ANNO}`,
  `      cell_status_answered: "回答済み",`,
  `      ${ANNO}`,
  `      cell_status_resolved: "解決済み",`,
  `      ${ANNO}`,
  `      cell_status_input_needed: "入力が必要",`,
  `      ${ANNO}`,
  `      cell_status_missing_credential: "認証情報が不足",`,
  `      ${ANNO}`,
  `      cell_status_error: "エラー",`,
]);

insertAfter('      search_aria: "', [
  `      ${ANNO}`,
  `      coverage_filter_aria: "カバレッジフィルター",`,
  `      ${ANNO}`,
  `      search_suggestions_aria: "検索候補",`,
  `      ${ANNO}`,
  `      clear_search_aria: "検索をクリア",`,
  `      ${ANNO}`,
  `      search_with_ai_aria: "AIで検索",`,
]);

insertAfter('      question_title: "', [
  `      ${ANNO}`,
  `      previous_question: "前の質問",`,
  `      ${ANNO}`,
  `      next_question: "次の質問",`,
  `      ${ANNO}`,
  `      go_to_question: "質問 {number} へ",`,
  `      ${ANNO}`,
  `      question_answered_suffix: "（回答済み）",`,
  `      ${ANNO}`,
  `      question_unanswered_suffix: "（未回答）",`,
]);

insertAfter('      n8n_title: "', [
  `      ${ANNO}`,
  `      dropzone_aria: "ワークフローファイルをドロップまたはクリックして参照",`,
  `      ${ANNO}`,
  `      paste_aria: "ワークフローJSONの内容",`,
  `      ${ANNO}`,
  `      url_aria: "ワークフローURL",`,
  `      ${ANNO}`,
  `      url_placeholder: "https://raw.githubusercontent.com/.../workflow.json",`,
  `      ${ANNO}`,
  `      url_format_github: "github.com/*/blob/*",`,
  `      ${ANNO}`,
  `      url_format_gist: "gist.github.com/*",`,
  `      ${ANNO}`,
  `      url_format_raw: "生のJSONエンドポイント",`,
  `      ${ANNO}`,
  `      question_view_mode_aria: "質問表示モード",`,
  `      ${ANNO}`,
  `      wizard_progress_aria: "インポートウィザードの進捗",`,
  `      ${ANNO}`,
  `      wizard_steps_aria: "ウィザードのステップ",`,
  `      ${ANNO}`,
  `      transform_progress_aria: "変換の進捗",`,
]);

insertAfter('      adopt_title: "', [
  `      ${ANNO}`,
  `      credentials_required_title: "認証情報が必要です",`,
  `      ${ANNO}`,
  `      credentials_required_body: "このテンプレートを採用する前に、以下の各カテゴリから少なくとも1つの認証情報が必要です。「認証情報を追加」をクリックしてください — セットアップ完了後、自動的にここに戻ります。",`,
  `      ${ANNO}`,
  `      answered_of_total: "{answered} / {total} 回答済み",`,
  `      ${ANNO}`,
  `      blocked_count: "{count}件ブロック",`,
  `      ${ANNO}`,
  `      question_number_of: "質問 {current} / {total}",`,
  `      ${ANNO}`,
  `      question_number_aria: "質問 {number}",`,
  `      ${ANNO}`,
  `      navigate_hint: "ナビゲート",`,
  `      ${ANNO}`,
  `      enter_to_advance: "進む",`,
  `      ${ANNO}`,
  `      previous: "前へ",`,
  `      ${ANNO}`,
  `      next: "次へ",`,
  `      ${ANNO}`,
  `      live_preview: "ライブプレビュー",`,
  `      ${ANNO}`,
  `      persona_label: "ペルソナ",`,
  `      ${ANNO}`,
  `      untitled_agent: "無題のエージェント",`,
  `      ${ANNO}`,
  `      not_yet_set: "未設定",`,
  `      ${ANNO}`,
  `      auto_badge: "自動",`,
  `      ${ANNO}`,
  `      jump_to_question_hint: "上の行をクリックしてその質問に移動します。自動検出された値は接続済み認証情報から推定されます。",`,
  `      ${ANNO}`,
  `      hide_explanation: "説明を非表示",`,
  `      ${ANNO}`,
  `      show_explanation: "説明を表示",`,
  `      ${ANNO}`,
  `      all_option: "すべて",`,
  `      ${ANNO}`,
  `      add_custom: "追加",`,
  `      ${ANNO}`,
  `      custom_prefix: "+ カスタム...",`,
  `      ${ANNO}`,
  `      custom_plain: "カスタム...",`,
  `      ${ANNO}`,
  `      type_your_answer: "回答を入力...",`,
  `      ${ANNO}`,
  `      describe_in_detail: "詳しく説明...",`,
  `      ${ANNO}`,
  `      select_directory: "ディレクトリを選択...",`,
  `      ${ANNO}`,
  `      type_a_value: "値を入力...",`,
  `      ${ANNO}`,
  `      preparing: "準備中...",`,
  `      ${ANNO}`,
  `      waiting_for_parent: "前の回答を待機中...",`,
  `      ${ANNO}`,
  `      loading_from_service: "{service}からオプションを読み込み中...",`,
  `      ${ANNO}`,
  `      loaded_live_from: "{service}からライブで読み込み済み",`,
  `      ${ANNO}`,
  `      no_items_found: "{item}が見つかりません。先に{service}で作成してください。",`,
  `      ${ANNO}`,
  `      retry: "再試行",`,
  `      ${ANNO}`,
  `      source_local: "ローカルファイルまたはフォルダ",`,
  `      ${ANNO}`,
  `      source_codebase: "コードベース",`,
  `      ${ANNO}`,
  `      source_database: "データベース",`,
  `      ${ANNO}`,
  `      source_local_hint: "ファイルまたはフォルダのフルローカルパスを貼り付けてください。",`,
  `      ${ANNO}`,
  `      source_codebase_hint: "開発ツールに登録されているプロジェクトを選択してください。",`,
  `      ${ANNO}`,
  `      source_database_hint: "ボールトからデータベース認証情報を選択してください。",`,
  `      ${ANNO}`,
  `      source_local_placeholder: "/Users/me/project/design.md",`,
  `      ${ANNO}`,
  `      source_no_codebases: "開発ツールプロジェクトが見つかりません。先に開発ツールで登録してください。",`,
  `      ${ANNO}`,
  `      source_no_databases: "データベース認証情報が見つかりません。先にボールトで追加してください。",`,
  `      ${ANNO}`,
  `      source_pick_codebase: "コードベースを選択...",`,
  `      ${ANNO}`,
  `      source_pick_database: "データベースを選択...",`,
]);

insertAfter('      variants_title: "', [
  `      ${ANNO}`,
  `      command_center_header: "コマンドセンター // ビルド v1.0",`,
  `      ${ANNO}`,
  `      phase_label: "[フェーズ: {phase}]",`,
  `      ${ANNO}`,
  `      your_answer_placeholder: "回答を入力...",`,
  `      ${ANNO}`,
  `      testing_background_hint: "数分かかる場合があります。このページを離れて後で戻っても — テストはバックグラウンドで継続されます。",`,
  `      ${ANNO}`,
  `      cancel_test: "テストをキャンセル",`,
  `      ${ANNO}`,
  `      missing_keys: "不足しているキー:",`,
  `      ${ANNO}`,
  `      approve_anyway: "とにかく承認",`,
  `      ${ANNO}`,
  `      delete_draft_title: "この下書きペルソナを破棄して閉じる",`,
  `      ${ANNO}`,
  `      delete_draft: "下書きを削除",`,
  `      ${ANNO}`,
  `      agent_promoted: "エージェントが昇格されました",`,
  `      ${ANNO}`,
  `      view_agent: "エージェントを表示",`,
]);

insertAfter('      diagrams_title: "', [
  `      ${ANNO}`,
  `      close_dialog: "ダイアログを閉じる",`,
]);

insertAfter('      generation_title: "', [
  `      ${ANNO}`,
  `      back: "戻る",`,
  `      ${ANNO}`,
  `      generate_template: "テンプレートを生成",`,
  `      ${ANNO}`,
  `      view_draft: "下書きを表示",`,
  `      ${ANNO}`,
  `      saving: "保存中...",`,
  `      ${ANNO}`,
  `      save_template: "テンプレートを保存",`,
  `      ${ANNO}`,
  `      template_saved: "テンプレート保存済み",`,
  `      ${ANNO}`,
  `      template_name_label_step: "テンプレート名",`,
  `      ${ANNO}`,
  `      template_name_placeholder: "テンプレート名...",`,
  `      ${ANNO}`,
  `      description_label: "説明",`,
  `      ${ANNO}`,
  `      description_placeholder: "このペルソナが何をすべきか、どのサービスに接続するか、どのように動作すべきかを説明してください。ツール、トリガー、統合について具体的に記述してください。",`,
  `      ${ANNO}`,
  `      description_hint: "AIはシステムプロンプト、ツール、トリガー、コネクタ、テンプレート変数を含む完全なペルソナテンプレートを生成します。",`,
  `      ${ANNO}`,
  `      terminal_aria_label: "デザインレビュー出力",`,
  `      ${ANNO}`,
  `      terminal_placeholder: "レビュー開始時に出力が表示されます",`,
  `      ${ANNO}`,
  `      terminal_running: "実行中...",`,
  `      ${ANNO}`,
  `      result_passed: "{count}件合格",`,
  `      ${ANNO}`,
  `      result_failed: "{count}件失敗",`,
  `      ${ANNO}`,
  `      result_errored: "{count}件エラー",`,
  `      ${ANNO}`,
  `      result_total: "合計 {count}件のテスト",`,
  `      ${ANNO}`,
  `      mode_predefined: "定義済み (5)",`,
  `      ${ANNO}`,
  `      mode_custom: "カスタム",`,
  `      ${ANNO}`,
  `      mode_batch: "バッチ",`,
  `      ${ANNO}`,
  `      mode_batch_count: "バッチ ({count})",`,
  `      ${ANNO}`,
  `      batch_upload_hint: "Claude CLIを通じてテンプレートを一括生成するには、番号付きテンプレートエントリが含まれるlist.mdファイルをアップロードしてください。",`,
  `      ${ANNO}`,
  `      batch_upload_btn: "list.mdをアップロード",`,
  `      ${ANNO}`,
  `      batch_format_hint: "期待されるフォーマット:",`,
  `      ${ANNO}`,
  `      batch_all: "すべて ({count})",`,
  `      ${ANNO}`,
  `      batch_count: "{count}件のテンプレートがClaude CLIで生成されます（各約45秒）",`,
  `      ${ANNO}`,
  `      batch_clear: "クリア",`,
  `      ${ANNO}`,
  `      batch_format_example: "**1. テンプレート名**",`,
  `      ${ANNO}`,
  `      custom_count: "テンプレートのユースケースを定義（{count}件準備完了）",`,
  `      ${ANNO}`,
  `      custom_load_file_title: ".txtまたは.mdファイルから読み込む",`,
  `      ${ANNO}`,
  `      custom_load_file: "ファイルを読み込む",`,
  `      ${ANNO}`,
  `      custom_add: "追加",`,
  `      ${ANNO}`,
  `      custom_case_name_placeholder: "テンプレート名（例: Gmailスマートフィルター）",`,
  `      ${ANNO}`,
  `      custom_instruction_placeholder: "このペルソナが何をすべきか、どのサービスを統合するか、どのトリガーを使用するかを説明してください...",`,
  `      ${ANNO}`,
  `      custom_short_instruction: "{current}/{min}文字以上",`,
  `      ${ANNO}`,
  `      custom_category_default: "カテゴリ...",`,
  `      ${ANNO}`,
  `      custom_trigger_default: "トリガー...",`,
  `      ${ANNO}`,
  `      custom_connectors_placeholder: "コネクタ（例: gmail, slack）",`,
  `      ${ANNO}`,
  `      custom_detail_hint: "詳しく記述するほど良い結果が得られます。サービス、トリガー、期待される動作を含めてください。",`,
  `      ${ANNO}`,
  `      custom_show_example: "例を表示",`,
  `      ${ANNO}`,
  `      custom_hide_example: "例を非表示",`,
  `      ${ANNO}`,
  `      custom_example_title: "例: Gmailスマートフィルター",`,
  `      ${ANNO}`,
  `      custom_example_body: "\\"Gmailを監視して重要なメールを分類し、送信者と緊急度でラベルを付け、Slackに緊急なものを転送するエージェントを作成します。gmailとslackコネクタを使ったポーリングトリガーを使用します。\\"",`,
  `      ${ANNO}`,
  `      predefined_intro: "{count}件の定義済みユースケースをデザインエンジンで実行します:",`,
]);

insertAfter('      connector_edit_title: "', [
  `      ${ANNO}`,
  `      table_name_placeholder: "例: persona_data",`,
]);

insertAfter('      trigger_edit_title: "', [
  `      ${ANNO}`,
  `      webhook_url_placeholder: "https://...",`,
]);

// ============================================================
// triggers (180 keys)
// ============================================================
insertAfter('    trigger_type_cron: "', [
  `    ${ANNO}`,
  `    cron_colon: "Cron:",`,
  `    ${ANNO}`,
  `    interval_colon: "間隔:",`,
  `    ${ANNO}`,
  `    event_colon: "イベント:",`,
  `    ${ANNO}`,
  `    endpoint_colon: "エンドポイント:",`,
  `    ${ANNO}`,
  `    listens_for_colon: "リッスン対象:",`,
  `    ${ANNO}`,
  `    source_filter_colon: "ソースフィルター:",`,
  `    ${ANNO}`,
  `    hmac_colon: "HMAC:",`,
  `    ${ANNO}`,
  `    paths_colon: "パス:",`,
  `    ${ANNO}`,
  `    events_colon: "イベント:",`,
  `    ${ANNO}`,
  `    recursive_yes: "再帰: はい",`,
  `    ${ANNO}`,
  `    filter_colon: "フィルター:",`,
  `    ${ANNO}`,
  `    watches_colon: "監視:",`,
  `    ${ANNO}`,
  `    pattern_colon: "パターン:",`,
  `    ${ANNO}`,
  `    poll_every: "ポーリング: 毎",`,
  `    ${ANNO}`,
  `    apps_colon: "アプリ:",`,
  `    ${ANNO}`,
  `    title_colon: "タイトル:",`,
  `    ${ANNO}`,
  `    operator_colon: "オペレーター:",`,
  `    ${ANNO}`,
  `    window_colon: "ウィンドウ:",`,
  `    ${ANNO}`,
  `    id_colon: "ID:",`,
  `    ${ANNO}`,
  `    type_colon: "種別:",`,
  `    ${ANNO}`,
  `    status_colon: "ステータス:",`,
  `    ${ANNO}`,
  `    target_colon: "ターゲット:",`,
  `    ${ANNO}`,
  `    retry_hash: "リトライ #",`,
  `    ${ANNO}`,
  `    model_colon: "モデル:",`,
  `    ${ANNO}`,
  `    next_run_colon: "次回実行:",`,
  `    ${ANNO}`,
  `    local_label: "（ローカル）",`,
  `    ${ANNO}`,
  `    then_every: "、その後毎",`,
  `    ${ANNO}`,
  `    source_colon: "ソース:",`,
  `    ${ANNO}`,
  `    dry_run_target_colon: "ターゲット:",`,
  `    ${ANNO}`,
  `    matched_subscriptions_count: "マッチしたサブスクリプション ({count})",`,
  `    ${ANNO}`,
  `    last_label: "最終:",`,
  `    ${ANNO}`,
  `    loading_history: "読み込み中...",`,
  `    ${ANNO}`,
  `    zero_unlimited: "0 = 無制限",`,
  `    ${ANNO}`,
  `    category_section_label: "トリガーカテゴリ",`,
  `    ${ANNO}`,
  `    no_persona_selected: "ペルソナが選択されていません",`,
  `    ${ANNO}`,
  `    quick_templates_label: "クイックテンプレート",`,
  `    ${ANNO}`,
  `    quick_presets_label: "クイックプリセット",`,
  `    ${ANNO}`,
  `    cron_expression_label: "Cron式",`,
  `    ${ANNO}`,
  `    this_persona_will: "このペルソナは",`,
  `    ${ANNO}`,
  `    starting_from: "、有効にした時点から。",`,
  `    ${ANNO}`,
  `    per_day: "回/日。",`,
  `    ${ANNO}`,
  `    last_poll_label: "最終ポーリング:",`,
  `    ${ANNO}`,
  `    deployed_persona_label: "デプロイ済みペルソナ",`,
  `    ${ANNO}`,
  `    fired_at_label: "発火日時",`,
  `    ${ANNO}`,
  `    webhook_last_label: "最終:",`,
  `    ${ANNO}`,
  `    relay_last_label: "最終:",`,
  `    ${ANNO}`,
  `    optional_label: "（任意）",`,
  `    ${ANNO}`,
  `    optional_comma_separated: "（任意、カンマ区切り）",`,
  `    ${ANNO}`,
  `    get_channel_url_from: "チャンネルURLを取得する場所:",`,
  `    ${ANNO}`,
  `    setup_step1: "smee.io/new を訪れて無料リレーチャンネルを作成",`,
  `    ${ANNO}`,
  `    setup_step2: "ラベルとチャンネルURLを入力してリレーを追加",`,
  `    ${ANNO}`,
  `    setup_step3: "チャンネルURLをGitHub/Stripe/任意のサービスのウェブフックとして貼り付け",`,
  `    ${ANNO}`,
  `    setup_step4: "イベントがライブストリームに表示され、エージェントに自動でルーティングされます",`,
  `    ${ANNO}`,
  `    studio_empty_desc: "ペルソナ間でリアクティブなイベントフローを構成します。トリガータイプをビルディングブロックとして使用し、条件分岐と並列ファンアウトを追加してインテリジェントな自動化チェーンを作成してください。",`,
  `    ${ANNO}`,
  `    studio_step1: "1. サイドバーからトリガーソースを追加（スケジュール、ウェブフックなど）",`,
  `    ${ANNO}`,
  `    studio_step2: "2. イベントを処理するペルソナステップを追加",`,
  `    ${ANNO}`,
  `    studio_step3: "3. 接続してリアクティブチェーンを構築",`,
  `    ${ANNO}`,
  `    studio_step4: "4. ルーティングロジックに条件ゲートを使用",`,
  `    ${ANNO}`,
  `    gate_if_else: "If / Else",`,
  `    ${ANNO}`,
  `    gate_if_else_desc: "二項条件分岐",`,
  `    ${ANNO}`,
  `    gate_classifier_desc: "多方向ルーティング（サポート、営業など）",`,
  `    ${ANNO}`,
  `    gate_fan_out: "ファンアウト（並列）",`,
  `    ${ANNO}`,
  `    gate_fan_out_desc: "複数ブランチを並列実行",`,
  `    ${ANNO}`,
  `    palette_help: "トリガーソースをペルソナステップに接続してリアクティブチェーンを構築します。分岐ロジックと並列ファンアウトのための条件ゲートを追加してください。",`,
  `    ${ANNO}`,
  `    toolbar_title_auto_layout: "自動レイアウト",`,
  `    ${ANNO}`,
  `    toolbar_title_add_note: "付箋を追加",`,
  `    ${ANNO}`,
  `    toolbar_title_start_dry_run: "ドライラン開始",`,
  `    ${ANNO}`,
  `    toolbar_title_stop_dry_run: "ドライラン停止",`,
  `    ${ANNO}`,
  `    toolbar_title_assistant: "キャンバスアシスタント",`,
  `    ${ANNO}`,
  `    toolbar_dry_run: "ドライラン",`,
  `    ${ANNO}`,
  `    canvas_assistant_title: "キャンバスアシスタント",`,
  `    ${ANNO}`,
  `    try_asking_hint: "例えば聞いてみてください",`,
  `    ${ANNO}`,
  `    assistant_placeholder: "イベントトポロジーを説明してください...",`,
  `    ${ANNO}`,
  `    disconnect_persona_title: "ペルソナを切断しますか？",`,
  `    ${ANNO}`,
  `    disconnect_will_no_longer: "は次のものに反応しなくなります:",`,
  `    ${ANNO}`,
  `    disconnect_events_reconnect: "イベント。後で再接続できます。",`,
  `    ${ANNO}`,
  `    rename_also_updates: "履歴イベント、ペルソナイベントハンドラー、トリガー監査メタデータも更新されます。",`,
  `    ${ANNO}`,
  `    delete_connection_label: "接続を削除",`,
  `    ${ANNO}`,
  `    search_personas_placeholder: "ペルソナを検索...",`,
  `    ${ANNO}`,
  `    no_matching_personas_found: "一致するペルソナが見つかりません",`,
  `    ${ANNO}`,
  `    clear_search_label: "検索をクリア",`,
  `    ${ANNO}`,
  `    dead_letter_source: "ソース:",`,
  `    ${ANNO}`,
  `    dead_letter_id: "ID:",`,
  `    ${ANNO}`,
  `    event_data_label: "イベントデータ",`,
  `    ${ANNO}`,
  `    shared_prefix: "共有:",`,
  `    ${ANNO}`,
  `    nl_type_colon: "種別:",`,
  `    ${ANNO}`,
  `    nl_cron_colon: "· Cron:",`,
  `    ${ANNO}`,
  `    nl_interval_colon: "· 間隔:",`,
  `    ${ANNO}`,
  `    nl_filter_colon: "· フィルター:",`,
  `    ${ANNO}`,
  `    nl_could_not_parse: "その説明からトリガーを解析できませんでした。次のような形式を試してください",`,
  `    ${ANNO}`,
  `    active_hours_every_day: "毎日",`,
  `    ${ANNO}`,
  `    event_type_to_listen: "リッスンするイベント種別",`,
  `    ${ANNO}`,
  `    event_type_input_placeholder: "例: file_changed, execution_completed",`,
  `    ${ANNO}`,
  `    event_type_helper: "登録済みイベント種別を検索するか、カスタム種別を入力してください。",`,
  `    ${ANNO}`,
  `    source_filter_optional_label: "（任意）",`,
  `    ${ANNO}`,
  `    wildcard_hint: "— 末尾の * プレフィックスワイルドカードに対応",`,
  `    ${ANNO}`,
  `    window_title_pattern_label: "ウィンドウタイトルパターン",`,
  `    ${ANNO}`,
  `    optional_regex_label: "（任意の正規表現）",`,
  `    ${ANNO}`,
  `    text_pattern_label: "テキストパターン",`,
  `    ${ANNO}`,
  `    credential_event_label: "認証情報イベント",`,
  `    ${ANNO}`,
  `    refresh_label: "更新",`,
  `    ${ANNO}`,
  `    copy_webhook_url_title: "ウェブフックURLをコピー",`,
  `    ${ANNO}`,
  `    copy_webhook_secret_title: "ウェブフックシークレットをコピー",`,
  `    ${ANNO}`,
  `    delete_webhook_title: "ウェブフックトリガーを削除",`,
  `    ${ANNO}`,
  `    status_col_label: "ステータス",`,
  `    ${ANNO}`,
  `    duration_col_label: "所要時間",`,
  `    ${ANNO}`,
  `    cost_col_label: "コスト",`,
  `    ${ANNO}`,
  `    dead_letter_refresh: "更新",`,
  `    ${ANNO}`,
  `    dead_letter_loading: "読み込み中...",`,
  `    ${ANNO}`,
  `    dead_letter_retry: "再試行",`,
  `    ${ANNO}`,
  `    dead_letter_discard: "破棄",`,
  `    ${ANNO}`,
  `    dead_letter_payload: "ペイロード",`,
  `    ${ANNO}`,
  `    event_data_section_label: "イベントデータ",`,
  `    ${ANNO}`,
  `    copy_event_data_title: "イベントデータをコピー",`,
  `    ${ANNO}`,
  `    copied_label: "コピー済み",`,
  `    ${ANNO}`,
  `    error_section_label: "エラー",`,
  `    ${ANNO}`,
  `    meta_event_id: "イベントID",`,
  `    ${ANNO}`,
  `    meta_project: "プロジェクト",`,
  `    ${ANNO}`,
  `    meta_processed: "処理済み",`,
  `    ${ANNO}`,
  `    clear_stream: "クリア",`,
  `    ${ANNO}`,
  `    clear_stream_title: "ストリームバッファをクリア",`,
  `    ${ANNO}`,
  `    col_type: "種別",`,
  `    ${ANNO}`,
  `    col_source: "ソース",`,
  `    ${ANNO}`,
  `    col_target_agent: "ターゲットエージェント",`,
  `    ${ANNO}`,
  `    col_status: "ステータス",`,
  `    ${ANNO}`,
  `    col_time: "時刻",`,
  `    ${ANNO}`,
  `    queued_bare: "キュー中",`,
  `    ${ANNO}`,
  `    pause_tooltip: "受信イベントを一時停止",`,
  `    ${ANNO}`,
  `    resume_tooltip: "ライブ更新を再開",`,
  `    ${ANNO}`,
  `    relay_label_field: "ラベル",`,
  `    ${ANNO}`,
  `    relay_channel_url_field: "チャンネルURL",`,
  `    ${ANNO}`,
  `    relay_route_to_agent: "エージェントにルーティング",`,
  `    ${ANNO}`,
  `    optional_suffix: "（任意）",`,
  `    ${ANNO}`,
  `    relay_event_filter_field: "イベントフィルター",`,
  `    ${ANNO}`,
  `    relay_event_filter_note: "（任意、カンマ区切り）",`,
  `    ${ANNO}`,
  `    relay_confirm_delete: "確認",`,
  `    ${ANNO}`,
  `    setup_guide_step2: "ラベルとチャンネルURLを入力してリレーを追加",`,
  `    ${ANNO}`,
  `    setup_guide_step3: "チャンネルURLをGitHub/Stripe/任意のサービスのウェブフックとして貼り付け",`,
  `    ${ANNO}`,
  `    setup_guide_step4: "イベントがライブストリームに表示され、エージェントに自動でルーティングされます",`,
  `    ${ANNO}`,
  `    get_channel_url_prompt: "チャンネルURLを取得する場所:",`,
  `    ${ANNO}`,
  `    gate_if_else_label: "If / Else",`,
  `    ${ANNO}`,
  `    gate_if_else_description: "二項条件分岐",`,
  `    ${ANNO}`,
  `    gate_classifier_label: "クラシファイアー",`,
  `    ${ANNO}`,
  `    gate_classifier_description: "多方向ルーティング（サポート、営業など）",`,
  `    ${ANNO}`,
  `    gate_fan_out_label: "ファンアウト（並列）",`,
  `    ${ANNO}`,
  `    gate_fan_out_description: "複数ブランチを並列実行",`,
  `    ${ANNO}`,
  `    palette_help_text: "トリガーソースをペルソナステップに接続してリアクティブチェーンを構築します。",`,
  `    ${ANNO}`,
  `    test_event_type_placeholder: "例: build_complete, deploy, file_changed",`,
  `    ${ANNO}`,
  `    result_id_prefix: "ID:",`,
  `    ${ANNO}`,
  `    result_type_prefix: "種別:",`,
  `    ${ANNO}`,
  `    result_status_prefix: "ステータス:",`,
  `    ${ANNO}`,
  `    result_target_prefix: "ターゲット:",`,
  `    ${ANNO}`,
  `    tab_loading: "読み込み中...",`,
  `    ${ANNO}`,
  `    smee_open_new_title: "smee.io/newを開いてチャンネルを作成",`,
  `    ${ANNO}`,
  `    relay_label_placeholder: "例: GitHub — my-repo",`,
  `    ${ANNO}`,
  `    relay_channel_url_placeholder: "https://smee.io/your-channel-id",`,
  `    ${ANNO}`,
  `    relay_filter_placeholder: "github_push, github_pull_request",`,
  `    ${ANNO}`,
  `    dead_letter_retry_exhausted_title: "リトライ上限に達しました — 破棄するか根本原因を調査してください",`,
  `    ${ANNO}`,
  `    dead_letter_discard_title: "このイベントを永久に破棄",`,
  `    ${ANNO}`,
  `    dead_letter_retry_title: "このイベントを再試行",`,
  `    ${ANNO}`,
  `    replay_button_title: "同じ入力ペイロードで再発火",`,
  `    ${ANNO}`,
  `    interval_seconds_placeholder: "秒数（最小60）",`,
  `    ${ANNO}`,
  `    cron_expression_placeholder: "* * * * *  (分 時 日 月 曜日)",`,
  `    ${ANNO}`,
  `    app_focus_window_placeholder: "例: .*.rs$ または Project - Visual Studio",`,
  `    ${ANNO}`,
  `    app_focus_process_placeholder: "例: Code.exe または firefox",`,
  `    ${ANNO}`,
  `    field_optional: "（任意）",`,
  `    ${ANNO}`,
  `    source_filter_input_placeholder: "例: watcher-* または exact-source-id",`,
  `    ${ANNO}`,
  `    meta_source: "ソース",`,
  `    ${ANNO}`,
  `    relay_last_event: "最終:",`,
  `    ${ANNO}`,
  `    relay_delete_title: "リレーを削除",`,
  `    ${ANNO}`,
  `    setup_guide_step1: "smee.io/newでチャンネルを作成",`,
  `    ${ANNO}`,
  `    clipboard_pattern_placeholder: "例: https?://.* または error|exception",`,
  `    ${ANNO}`,
  `    composite_event_type_placeholder: "イベント種別（例: file_changed）",`,
  `    ${ANNO}`,
  `    composite_debounce_placeholder: "300",`,
  `    ${ANNO}`,
  `    file_watcher_path_placeholder: "C:/Users/me/projects または /home/me/src",`,
  `    ${ANNO}`,
  `    file_watcher_pattern_placeholder: "例: *.py, *.{ts,tsx}, Dockerfile",`,
  `    ${ANNO}`,
  `    polling_endpoint_placeholder: "https://api.example.com/poll",`,
  `    ${ANNO}`,
  `    more_tools_title: "その他のツール",`,
  `    ${ANNO}`,
  `    validate_and_fire_title: "トリガー設定を検証して発火",`,
  `    ${ANNO}`,
  `    simulate_trigger_title: "実行せずにトリガーをシミュレート",`,
]);

// ============================================================
// settings (10 keys)
// ============================================================
insertAfter('    settings_title: "', [
  `    ${ANNO}`,
  `    settings_saved: "保存済み",`,
]);

insertAfter('    telemetry_label: "', [
  `    ${ANNO}`,
  `    telemetry_toggle_aria: "テレメトリを切り替え",`,
]);

insertAfter('    reset_theme_label: "', [
  `    ${ANNO}`,
  `    reset_to_auto: "自動にリセット",`,
]);

insertAfter('    engine_title: "', [
  `    ${ANNO}`,
  `    engine_not_capable: "{provider}はこの操作の統合テストに合格していません。結果が解析できない可能性があります。",`,
]);

insertAfter('    byom_title: "', [
  `    ${ANNO}`,
  `    model_placeholder: "例: claude-haiku-4-5-20251001",`,
]);

insertAfter('    portability_title: "', [
  `    ${ANNO}`,
  `    import_personas: "{count}件のペルソナ",`,
  `    ${ANNO}`,
  `    import_teams: "{count}件のチーム",`,
  `    ${ANNO}`,
  `    import_tools: "{count}件のツール",`,
  `    ${ANNO}`,
  `    import_groups: "{count}件のグループ",`,
  `    ${ANNO}`,
  `    import_credentials_count: "{count}件の認証情報",`,
]);

// ============================================================
// design: conversation_truncated
// ============================================================
insertAfter('    conv_title: "', [
  `    ${ANNO}`,
  `    conversation_truncated: "この会話はメッセージ制限に達しました。古いメッセージが削除されました — コンテキストを保持するために新しい会話を開始することを検討してください。",`,
]);

// ============================================================
// schedules (9 keys)
// ============================================================
insertAfter('    schedules_title: "', [
  `    ${ANNO}`,
  `    missed_since: "{time}から{count}件の未実行",`,
  `    ${ANNO}`,
  `    every_interval: "{interval}ごと",`,
  `    ${ANNO}`,
  `    mark_for_recovery: "回復対象にマーク",`,
  `    ${ANNO}`,
  `    run_once_now: "今すぐ1回実行",`,
  `    ${ANNO}`,
  `    skip_dont_recover: "スキップ — 回復しない",`,
  `    ${ANNO}`,
  `    overlaps_with: "重複:",`,
  `    ${ANNO}`,
  `    refresh_schedules: "スケジュールを更新",`,
  `    ${ANNO}`,
  `    seed_mock_tooltip: "モックスケジュールをシード（開発専用）",`,
  `    ${ANNO}`,
  `    schedule_view_aria: "スケジュールビュー",`,
]);

// ============================================================
// recipes (2 keys)
// ============================================================
insertAfter('    recipe_title: "', [
  `    ${ANNO}`,
  `    recipe_label: "レシピ:",`,
  `    ${ANNO}`,
  `    executed_label: "実行済み:",`,
]);

// ============================================================
// plugins: drive_label, drive_desc, plus nested sections
// ============================================================
insertAfter('    artist_label: "', [
  `    ${ANNO}`,
  `    drive_label: "ドライブ",`,
  `    ${ANNO}`,
  `    drive_desc: "エージェントのエクスポートを保存するマネージドローカルファイルシステム。Finderスタイルのインターフェースでファイルを閲覧できます。アプリアップグレード後も保持されます。",`,
]);

// plugins.drive section
insertAfter('    drive: {', [
  `      ${ANNO}`,
  `      title: "ドライブ",`,
  `      ${ANNO}`,
  `      subtitle: "エージェントのエクスポート用マネージドローカルファイルシステム",`,
  `      ${ANNO}`,
  `      root_label: "ドライブルート",`,
  `      ${ANNO}`,
  `      dev_badge: "開発",`,
  `      ${ANNO}`,
  `      back: "戻る",`,
  `      ${ANNO}`,
  `      forward: "進む",`,
  `      ${ANNO}`,
  `      up: "上へ",`,
  `      ${ANNO}`,
  `      refresh: "更新",`,
  `      ${ANNO}`,
  `      search_placeholder: "このフォルダを検索...",`,
  `      ${ANNO}`,
  `      view_list: "リスト",`,
  `      ${ANNO}`,
  `      view_icons: "アイコン",`,
  `      ${ANNO}`,
  `      view_columns: "カラム",`,
  `      ${ANNO}`,
  `      new_folder: "新規フォルダ",`,
  `      ${ANNO}`,
  `      new_file: "新規ファイル",`,
  `      ${ANNO}`,
  `      reveal_in_os: "ファイルマネージャーで表示",`,
  `      ${ANNO}`,
  `      open_in_os: "開く",`,
  `      ${ANNO}`,
  `      sidebar_root: "ドライブ",`,
  `      ${ANNO}`,
  `      sidebar_recent: "最近",`,
  `      ${ANNO}`,
  `      sidebar_storage: "ストレージ",`,
  `      ${ANNO}`,
  `      storage_used: "{used} 使用済み · {count}件",`,
  `      ${ANNO}`,
  `      empty_folder: "このフォルダは空です",`,
  `      ${ANNO}`,
  `      empty_hint: "ローカルドライブにエクスポートするエージェントがここにファイルを保存します。",`,
  `      ${ANNO}`,
  `      empty_cta: "フォルダを作成",`,
  `      ${ANNO}`,
  `      col_name: "名前",`,
  `      ${ANNO}`,
  `      col_size: "サイズ",`,
  `      ${ANNO}`,
  `      col_kind: "種類",`,
  `      ${ANNO}`,
  `      col_modified: "更新日",`,
  `      ${ANNO}`,
  `      folder_kind: "フォルダ",`,
  `      ${ANNO}`,
  `      ctx_open: "開く",`,
  `      ${ANNO}`,
  `      ctx_rename: "名前を変更",`,
  `      ${ANNO}`,
  `      ctx_duplicate: "複製",`,
  `      ${ANNO}`,
  `      ctx_delete: "削除",`,
  `      ${ANNO}`,
  `      ctx_copy: "コピー",`,
  `      ${ANNO}`,
  `      ctx_cut: "切り取り",`,
  `      ${ANNO}`,
  `      ctx_paste: "貼り付け",`,
  `      ${ANNO}`,
  `      ctx_new_folder: "新規フォルダ",`,
  `      ${ANNO}`,
  `      ctx_new_file: "新規ファイル",`,
  `      ${ANNO}`,
  `      ctx_reveal: "ファイルマネージャーで表示",`,
  `      ${ANNO}`,
  `      ctx_copy_path: "パスをコピー",`,
  `      ${ANNO}`,
  `      rename_title: "名前を変更",`,
  `      ${ANNO}`,
  `      rename_placeholder: "新しい名前",`,
  `      ${ANNO}`,
  `      new_folder_title: "新規フォルダ",`,
  `      ${ANNO}`,
  `      new_folder_placeholder: "フォルダ名",`,
  `      ${ANNO}`,
  `      new_file_title: "新規ファイル",`,
  `      ${ANNO}`,
  `      new_file_placeholder: "filename.txt",`,
  `      ${ANNO}`,
  `      delete_confirm_title: "{count}件を削除しますか？",`,
  `      ${ANNO}`,
  `      delete_confirm_body: "この操作は元に戻せません。削除されたファイルは完全に消えます。",`,
  `      ${ANNO}`,
  `      confirm: "確認",`,
  `      ${ANNO}`,
  `      cancel: "キャンセル",`,
  `      ${ANNO}`,
  `      details_title: "詳細",`,
  `      ${ANNO}`,
  `      details_path: "パス",`,
  `      ${ANNO}`,
  `      details_size: "サイズ",`,
  `      ${ANNO}`,
  `      details_kind: "種類",`,
  `      ${ANNO}`,
  `      details_modified: "更新日",`,
  `      ${ANNO}`,
  `      details_items: "アイテム数",`,
  `      ${ANNO}`,
  `      details_preview: "プレビュー",`,
  `      ${ANNO}`,
  `      preview_unavailable: "プレビュー利用不可",`,
  `      ${ANNO}`,
  `      preview_binary: "バイナリファイル — OSのファイルマネージャーで開いて確認してください。",`,
  `      ${ANNO}`,
  `      preview_too_large: "ファイルが大きすぎてインラインプレビューできません。",`,
  `      ${ANNO}`,
  `      loading: "読み込み中...",`,
  `      ${ANNO}`,
  `      error_prefix: "エラー:",`,
  `      ${ANNO}`,
  `      items_selected: "{count}件選択",`,
  `      ${ANNO}`,
  `      items_total: "{count}件",`,
  `      ${ANNO}`,
  `      signatures_button: "署名",`,
  `      ${ANNO}`,
  `      ctx_sign_file: "ファイルに署名…",`,
  `      ${ANNO}`,
  `      ctx_verify_file: "署名を検証…",`,
  `      ${ANNO}`,
  `      ctx_extract_text: "テキストを抽出（OCR）…",`,
  `      ${ANNO}`,
  `      ctx_extract_text_no_gemini: "テキストを抽出 — Geminiを接続して有効にする",`,
  `      ${ANNO}`,
  `      ocr_title: "Geminiでテキストを抽出",`,
  `      ${ANNO}`,
  `      ocr_subtitle: "Google Gemini 3 Flash PreviewによるビジョンOCR",`,
  `      ${ANNO}`,
  `      ocr_model_label: "モデル",`,
  `      ${ANNO}`,
  `      ocr_connector_ready: "Geminiコネクタ準備完了",`,
  `      ${ANNO}`,
  `      ocr_connector_missing: "ボールトにGemini認証情報が見つかりません。Google GeminiをconnectしてOCRを有効にしてください。",`,
  `      ${ANNO}`,
  `      ocr_prompt_label: "任意のプロンプト",`,
  `      ${ANNO}`,
  `      ocr_prompt_placeholder: "例: 請求合計と明細のみを抽出",`,
  `      ${ANNO}`,
  `      ocr_extract: "テキストを抽出",`,
  `      ${ANNO}`,
  `      ocr_running: "抽出中…",`,
  `      ${ANNO}`,
  `      ocr_done: "抽出完了",`,
  `      ${ANNO}`,
  `      ocr_save: ".ocr.txtとして保存",`,
  `      ${ANNO}`,
  `      ocr_saved: "保存済み",`,
  `      ${ANNO}`,
  `      ocr_saved_to: "保存先",`,
  `      ${ANNO}`,
  `      ocr_copied: "クリップボードにコピーしました",`,
  `      ${ANNO}`,
  `      select_file_or_folder: "ファイルまたはフォルダを選択すると詳細が表示されます。",`,
  `      ${ANNO}`,
  `      download_aria: "ダウンロード",`,
  `      ${ANNO}`,
  `      download_title: "ダウンロード",`,
  `      ${ANNO}`,
  `      sign_reason_placeholder: "署名理由…",`,
]);

// plugins.artist section
insertAfter('    artist: {', [
  `      ${ANNO}`,
  `      status_partial: "一部",`,
  `      ${ANNO}`,
  `      status_not_checked: "未確認",`,
  `      ${ANNO}`,
  `      blender_label: "Blender",`,
  `      ${ANNO}`,
  `      blender_mcp_label: "Blender MCP",`,
  `      ${ANNO}`,
  `      session_cancelled: "セッションがキャンセルされました。",`,
  `      ${ANNO}`,
  `      imported_assets_one: "1件の新しいアセットをギャラリーにインポートしました。",`,
  `      ${ANNO}`,
  `      imported_assets_other: "{count}件の新しいアセットをギャラリーにインポートしました。",`,
  `      ${ANNO}`,
  `      scan_result_one: "{scanned}件のアセットが見つかり、1件の新規をインポートしました。",`,
  `      ${ANNO}`,
  `      scan_result_other: "{scanned}件のアセットが見つかり、{imported}件の新規をインポートしました。",`,
  `      ${ANNO}`,
  `      tool_blender: "Blender",`,
  `      ${ANNO}`,
  `      tool_leonardo: "Leonardo",`,
  `      ${ANNO}`,
  `      tool_gemini: "Gemini",`,
  `      ${ANNO}`,
  `      tag_editor_hint: "EnterまたはカンマでタグをEnterキー、Backspaceで最後のタグを削除します。",`,
  `      ${ANNO}`,
  `      tag_editor_placeholder: "タグ、別のタグ",`,
  `      ${ANNO}`,
  `      send_to_media_studio: "メディアスタジオに送信",`,
  `      ${ANNO}`,
  `      sent_to_media_studio: "メディアスタジオに追加済み",`,
  `      ${ANNO}`,
  `      session_history: "履歴",`,
  `      ${ANNO}`,
  `      session_history_empty: "実行したセッションがここに表示されます。",`,
  `      ${ANNO}`,
  `      session_tools_label: "ツール:",`,
  `      ${ANNO}`,
  `      session_status_running: "実行中",`,
  `      ${ANNO}`,
  `      session_status_completed: "完了",`,
  `      ${ANNO}`,
  `      session_status_failed: "失敗",`,
  `      ${ANNO}`,
  `      session_status_cancelled: "キャンセル済み",`,
  `      ${ANNO}`,
  `      replay_session: "リプレイ",`,
  `      ${ANNO}`,
  `      delete_session: "セッションを削除",`,
]);

// ============================================================
// Media Studio (22 keys) - but first find where it is in ja.ts
// ============================================================

// ============================================================
// process_labels: feedback_chat
// ============================================================
insertAfter('    data_analysis: "', [
  `    ${ANNO}`,
  `    feedback_chat: "フィードバックチャット",`,
]);

// ============================================================
// execution (5 keys)
// ============================================================
insertAfter('    needs_review: "', [
  `    ${ANNO}`,
  `    needs_credential: "認証情報が必要",`,
  `    ${ANNO}`,
  `    run_preview: "実行プレビュー",`,
  `    ${ANNO}`,
  `    close_preview: "プレビューを閉じる",`,
  `    ${ANNO}`,
  `    budget_limit: "予算制限",`,
  `    ${ANNO}`,
  `    run_agent: "エージェントを実行",`,
]);

// ============================================================
// gitlab (4 keys)
// ============================================================
insertAfter('    gitlab_title: "', [
  `    ${ANNO}`,
  `    trigger_on: "トリガー条件:",`,
  `    ${ANNO}`,
  `    connecting_to_gitlab: "GitLabに接続中...",`,
  `    ${ANNO}`,
  `    deploying_to_gitlab: "ペルソナをGitLabにデプロイ中...",`,
  `    ${ANNO}`,
  `    pipeline_hash: "パイプライン #",`,
]);

// ============================================================
// pipeline (5 keys)
// ============================================================
insertAfter('    pipeline_title: "', [
  `    ${ANNO}`,
  `    no_timeline_data: "タイムラインデータなし",`,
  `    ${ANNO}`,
  `    clear_filter: "フィルターをクリア",`,
  `    ${ANNO}`,
  `    filter_to_run: "この実行でフィルター",`,
  `    ${ANNO}`,
  `    new_memories_one: "{count}件の新規メモリ",`,
  `    ${ANNO}`,
  `    new_memories_other: "{count}件の新規メモリ",`,
]);

// ============================================================
// shared sections (62 keys)
// ============================================================
insertAfter('    draft_editor: {', [
  `      ${ANNO}`,
  `      edit_tabs_label: "下書き編集タブ",`,
  `      ${ANNO}`,
  `      request_ai_adjustments: "AI調整をリクエスト",`,
  `      ${ANNO}`,
  `      edit_raw_json_hint: "生のJSONを編集します。変更はフォームフィールドを上書きします。",`,
  `      ${ANNO}`,
  `      no_custom_sections: "カスタムセクションはまだありません",`,
  `      ${ANNO}`,
  `      no_content_to_preview: "プレビューするコンテンツがありません",`,
  `      ${ANNO}`,
  `      edit_raw: "RAWを編集",`,
  `      ${ANNO}`,
  `      credential_links: "認証情報リンク",`,
  `      ${ANNO}`,
  `      view_full_prompt: "全プロンプトを表示",`,
  `      ${ANNO}`,
  `      hide_full_prompt: "全プロンプトを非表示",`,
]);

insertAfter('    forms_extra: {', [
  `      ${ANNO}`,
  `      color_hex_placeholder: "#8b5cf6",`,
  `      ${ANNO}`,
  `      attach_file_title: "ファイルを添付（APIスペック、スキーマ、MCP設定）",`,
  `      ${ANNO}`,
  `      add_references_title: "参照URLまたは接続文字列を追加",`,
  `      ${ANNO}`,
  `      no_matches: "一致なし",`,
  `      ${ANNO}`,
  `      all_prefix: "すべて (",`,
]);

insertAfter('    reasoning_trace: {', [
  `      ${ANNO}`,
  `      heartbeat_silent: "秒（サイレント",`,
  `      ${ANNO}`,
  `      waiting: "実行イベントを待機中...",`,
  `      ${ANNO}`,
  `      tool_call_label: "ツール呼び出し:",`,
]);

insertAfter('    sidebar_extra: {', [
  `      ${ANNO}`,
  `      clear_completed_title: "完了済みおよびキュー済みアイテムをクリア",`,
  `      ${ANNO}`,
  `      no_credentials: "認証情報がまだありません",`,
  `      ${ANNO}`,
  `      ai_setup_wizard: "AIセットアップウィザード",`,
  `      ${ANNO}`,
  `      all_personas: "すべてのペルソナ",`,
  `      ${ANNO}`,
  `      no_scheduled_agents: "スケジュールのあるエージェントなし",`,
  `      ${ANNO}`,
  `      all_agents_label: "すべてのエージェント",`,
  `      ${ANNO}`,
  `      draft_builds: "下書きビルド",`,
  `      ${ANNO}`,
  `      dev_tools_label: "開発ツール",`,
  `      ${ANNO}`,
  `      obsidian_brain: "Obsidian Brain",`,
  `      ${ANNO}`,
  `      active_twin: "アクティブツイン",`,
  `      ${ANNO}`,
  `      research_lab: "リサーチラボ",`,
]);

insertAfter('    execution_detail: {', [
  `      ${ANNO}`,
  `      running: "実行中...",`,
  `      ${ANNO}`,
  `      rerun: "再実行",`,
  `      ${ANNO}`,
  `      retry_prefix: "リトライ #",`,
  `      ${ANNO}`,
  `      importance_prefix: "重要度:",`,
  `      ${ANNO}`,
  `      confidence_suffix: "% 信頼度",`,
]);

insertAfter('    progress_extra: {', [
  `      ${ANNO}`,
  `      continue_working: "引き続き作業できます — 下書きの準備ができたらお知らせします。",`,
  `      ${ANNO}`,
  `      draft_ready: "ペルソナの下書きがレビューと編集の準備ができています。",`,
  `      ${ANNO}`,
  `      click_generate: "「ペルソナ下書きを生成」をクリックして開始します。",`,
  `      ${ANNO}`,
  `      skip_configuration: "設定をスキップ",`,
  `      ${ANNO}`,
  `      no_config_questions: "設定の質問は必要ありません。",`,
  `      ${ANNO}`,
  `      answer_questions: "これらの質問に答えてペルソナの生成をカスタマイズしてください。",`,
  `      ${ANNO}`,
  `      no_output: "まだ出力がありません...",`,
  `      ${ANNO}`,
  `      s_elapsed: "秒経過",`,
  `      ${ANNO}`,
  `      s_remaining: "秒残り",`,
  `      ${ANNO}`,
  `      show_cli_output: "CLI出力を表示",`,
  `      ${ANNO}`,
  `      hide_cli_output: "CLI出力を非表示",`,
]);

insertAfter('    terminal_extra: {', [
  `      ${ANNO}`,
  `      connecting: "プロバイダーに接続中",`,
  `      ${ANNO}`,
  `      queued_at: "位置でキュー中",`,
  `      ${ANNO}`,
  `      new_line: "新しい行",`,
  `      ${ANNO}`,
  `      new_lines: "新しい行数",`,
  `      ${ANNO}`,
  `      below: "以下",`,
  `      ${ANNO}`,
  `      lines_suffix: "行)",`,
  `      ${ANNO}`,
  `      search_and_filter: "検索とフィルター",`,
]);

insertAfter('    use_cases_extra: {', [
  `      ${ANNO}`,
  `      input_placeholder: "ここにユースケースを実行する入力を入力...",`,
  `      ${ANNO}`,
  `      model_placeholder: "例: claude-3-5-sonnet-latest",`,
  `      ${ANNO}`,
  `      use_case_singular: "ユースケース",`,
  `      ${ANNO}`,
  `      window_prefix: "（ウィンドウ:",`,
  `      ${ANNO}`,
  `      loading_history: "履歴を読み込み中...",`,
  `      ${ANNO}`,
  `      no_executions: "まだ実行なし",`,
  `      ${ANNO}`,
  `      run_to_see_history: "このユースケースを実行すると実行履歴、タイミング、コストがここに表示されます。",`,
  `      ${ANNO}`,
  `      run_use_case: "このユースケースを実行",`,
  `      ${ANNO}`,
  `      custom_model: "カスタムモデル",`,
  `      ${ANNO}`,
  `      no_results: "結果が見つかりません",`,
  `      ${ANNO}`,
  `      ctrl_enter: "Ctrl+Enter",`,
]);

// ============================================================
// Write the result
// ============================================================
writeFileSync(jaPath, content, 'utf8');
console.log('Done! File written.');
