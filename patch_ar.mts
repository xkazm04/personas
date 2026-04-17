import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('./src/i18n/ar.ts', 'utf8');

function replaceOnce(from: string, to: string): void {
  if (!src.includes(from)) throw new Error(`Not found: ${JSON.stringify(from.slice(0,80))}`);
  src = src.replace(from, to);
}

// ── Vault: add missing keys to existing sub-sections ────────────────────────
// vault.list (line ~2285)
replaceOnce(
  `    list: {
`,
  `    list: {
      // @llm-translated 2026-04-17
      sort_label: "ترتيب:",
`
);

// vault.import
replaceOnce(
  `    import: {
`,
  `    import: {
      // @llm-translated 2026-04-17
      parse_secrets: "تحليل الأسرار",
      // @llm-translated 2026-04-17
      selected_for_import: "محدد للاستيراد",
      // @llm-translated 2026-04-17
      auto_detected: "اكتُشف تلقائياً",
      // @llm-translated 2026-04-17
      sync_supported: "المزامنة مدعومة",
      // @llm-translated 2026-04-17
      secrets_found_one: "عُثر على سر واحد",
      // @llm-translated 2026-04-17
      secrets_found_other: "عُثر على {count} سر",
      // @llm-translated 2026-04-17
      import_secrets_one: "استيراد سر واحد",
      // @llm-translated 2026-04-17
      import_secrets_other: "استيراد {count} سر",
`
);

// vault.card (first occurrence = vault card at ~2394)
replaceOnce(
  `    card: {
      reauthorize: "إعادة التفويض",`,
  `    card: {
      // @llm-translated 2026-04-17
      reauthorize_scopes: "إعادة الترخيص بنطاقات إضافية",
      reauthorize: "إعادة التفويض",`
);

// vault.forms
replaceOnce(
  `    forms: {
`,
  `    forms: {
      // @llm-translated 2026-04-17
      connection_test_heading: "اختبار الاتصال",
      // @llm-translated 2026-04-17
      test_connection_btn: "اختبار الاتصال",
      // @llm-translated 2026-04-17
      credential_fields_heading: "حقول بيانات الاعتماد",
      // @llm-translated 2026-04-17
      how_to_get_connector: "كيفية الحصول على بيانات اعتماد {connectorLabel}",
      // @llm-translated 2026-04-17
      authorization_complete: "اكتمل التفويض",
      // @llm-translated 2026-04-17
      copied_to_clipboard: "تم النسخ إلى الحافظة",
      // @llm-translated 2026-04-17
      credential_name: "اسم بيانات الاعتماد",
      // @llm-translated 2026-04-17
      credential_name_placeholder: "أعطِ بيانات الاعتماد تسمية — مثلاً حساب {label}، {label} للإنتاج",
      // @llm-translated 2026-04-17
      authorizing_with: "جارٍ التفويض مع {label}...",
      // @llm-translated 2026-04-17
      authorize_with: "تفويض مع {label}",
      // @llm-translated 2026-04-17
      oauth_consent_hint: "يفتح {label} في متصفحك. امنح الوصول ثم عد هنا.",
      // @llm-translated 2026-04-17
      oauth_connected_at: "تم الاتصال بـ {label} في {time}",
`
);

// vault.auto_cred
replaceOnce(
  `    auto_cred: {
`,
  `    auto_cred: {
      // @llm-translated 2026-04-17
      cancel_session: "إلغاء الجلسة",
      // @llm-translated 2026-04-17
      test_connection: "اختبار الاتصال",
      // @llm-translated 2026-04-17
      testing: "جارٍ الاختبار...",
      // @llm-translated 2026-04-17
      re_run_browser: "إعادة تشغيل المتصفح",
      // @llm-translated 2026-04-17
      discard: "تجاهل",
      // @llm-translated 2026-04-17
      save_credential: "حفظ بيانات الاعتماد",
      // @llm-translated 2026-04-17
      save_procedure: "حفظ الإجراء",
      // @llm-translated 2026-04-17
      procedure_saved: "تم حفظ الإجراء",
`
);

// vault.databases
replaceOnce(
  `    databases: {
`,
  `    databases: {
      // @llm-translated 2026-04-17
      not_null: "NOT NULL",
      // @llm-translated 2026-04-17
      ctrl_enter: "Ctrl+Enter",
`
);

// vault.dependencies
replaceOnce(
  `    dependencies: {
`,
  `    dependencies: {
      // @llm-translated 2026-04-17
      sim_critical: "إلغاء {credentialName} سيُعطل {workflows} سير عمل{workflowPlural} ويُوقف {personas} شخصية{personaPlural}.",
      // @llm-translated 2026-04-17
      sim_high: "إلغاء {credentialName} سيؤثر على {personas} شخصية{personaPlural} في مساحة عملك.",
      // @llm-translated 2026-04-17
      sim_medium: "إلغاء {credentialName} له نطاق تأثير محدود.",
      // @llm-translated 2026-04-17
      per_day: "/يوم",
`
);

// vault.shared
replaceOnce(
  `    shared: {
`,
  `    shared: {
      // @llm-translated 2026-04-17
      copied: "تم النسخ",
      // @llm-translated 2026-04-17
      kb_count_summary: "— {docs} وثيقة، {chunks} جزء",
      // @llm-translated 2026-04-17
      default_patterns: "افتراضي:",
      // @llm-translated 2026-04-17
      add_pattern_placeholder: "*.pdf",
      // @llm-translated 2026-04-17
      distance_label: "المسافة:",
      // @llm-translated 2026-04-17
      chunk_label: "الجزء:",
      // @llm-translated 2026-04-17
      copy_credential_id: "نسخ معرّف بيانات الاعتماد",
      // @llm-translated 2026-04-17
      request_body: "جسم الطلب",
      // @llm-translated 2026-04-17
      add_tag_title: "إضافة وسم",
      // @llm-translated 2026-04-17
      local_embedding_hint: "يُنشأ التضمين محلياً باستخدام {model} ({dims} بُعد). لا تغادر بياناتك جهازك.",
      // @llm-translated 2026-04-17
      api_path_placeholder: "/api/v1/resource",
      // @llm-translated 2026-04-17
      json_body_placeholder: "{\\"key\\": \\"value\\"}",
      // @llm-translated 2026-04-17
      sending: "جارٍ الإرسال...",
      // @llm-translated 2026-04-17
      send: "إرسال",
      // @llm-translated 2026-04-17
      search_results_one: "نتيجة واحدة لـ \\"{query}\\"",
      // @llm-translated 2026-04-17
      search_results_other: "{count} نتيجة لـ \\"{query}\\"",
`
);

// vault.bulk_healthcheck
replaceOnce(
  `    bulk_healthcheck: {
`,
  `    bulk_healthcheck: {
      // @llm-translated 2026-04-17
      passed_count: "{count} ناجح",
      // @llm-translated 2026-04-17
      failed_count: "{count} فاشل",
      // @llm-translated 2026-04-17
      total_count: "{count} إجمالاً",
`
);

// vault.token_metrics
replaceOnce(
  `    token_metrics: {
`,
  `    token_metrics: {
      // @llm-translated 2026-04-17
      fallback_used: "تم استخدام البديل ({fallback} ث) في {rate}% من التحديثات ({count}/{total}) — المزوّد لا يُرسل",
`
);

// vault.rotation_section
replaceOnce(
  `    rotation_section: {
`,
  `    rotation_section: {
      // @llm-translated 2026-04-17
      last_rotated: "آخر تدوير: {time}",
`
);

// vault.event_config
replaceOnce(
  `    event_config: {
`,
  `    event_config: {
      // @llm-translated 2026-04-17
      loading: "جارٍ تحميل الأحداث...",
`
);

// vault.credential_forms
replaceOnce(
  `    credential_forms: {
`,
  `    credential_forms: {
      // @llm-translated 2026-04-17
      open_to_generate: "افتح {label} لإنشاء مفتاح API أو رمز",
      // @llm-translated 2026-04-17
      already_configured: "بيانات الاعتماد مُعدَّة مسبقاً — حدّث أدناه للاستبدال",
      // @llm-translated 2026-04-17
      setup_instructions_label: "تعليمات الإعداد",
      // @llm-translated 2026-04-17
      no_fields_defined: "لم تُحدَّد حقول بيانات اعتماد لهذا الموصّل.",
`
);

// vault.audit_log
replaceOnce(
  `    audit_log: {
`,
  `    audit_log: {
      // @llm-translated 2026-04-17
      loading: "جارٍ تحميل الجدول الزمني للتدقيق...",
      // @llm-translated 2026-04-17
      total_accesses: "{count} إجمالاً",
      // @llm-translated 2026-04-17
      personas_one: "{count} شخصية",
      // @llm-translated 2026-04-17
      personas_other: "{count} شخصيات",
      // @llm-translated 2026-04-17
      accesses_24h: "{count} في 24 ساعة",
      // @llm-translated 2026-04-17
      anomalies_one: "{count} شذوذ",
      // @llm-translated 2026-04-17
      anomalies_other: "{count} شذوذات",
      // @llm-translated 2026-04-17
      no_anomalies: "لا شذوذات",
      // @llm-translated 2026-04-17
      show_all: "عرض جميع {count} إدخالات",
`
);

// vault.credential_import
replaceOnce(
  `    credential_import: {
`,
  `    credential_import: {
      // @llm-translated 2026-04-17
      sync_hint: "يراقب الخزنة الخارجية للتغييرات ويحدّث بيانات الاعتماد تلقائياً عبر الاستطلاع.",
      // @llm-translated 2026-04-17
      interval_15min: "15 دقيقة",
      // @llm-translated 2026-04-17
      interval_30min: "30 دقيقة",
      // @llm-translated 2026-04-17
      interval_1hr: "ساعة واحدة",
      // @llm-translated 2026-04-17
      interval_6hr: "6 ساعات",
      // @llm-translated 2026-04-17
      interval_24hr: "24 ساعة",
`
);

// vault.wizard_detect
replaceOnce(
  `    wizard_detect: {
`,
  `    wizard_detect: {
      // @llm-translated 2026-04-17
      set_up_credentials: "إعداد بيانات الاعتماد",
      // @llm-translated 2026-04-17
      clear_selection: "مسح التحديد",
      // @llm-translated 2026-04-17
      set_up_services: "إعداد {count} خدمة{plural}",
      // @llm-translated 2026-04-17
      setting_up: "إعداد {current} من {total}",
      // @llm-translated 2026-04-17
      wizard_title: "معالج إعداد بيانات الاعتماد",
      // @llm-translated 2026-04-17
      choose_service: "اختر خدمة للإعداد",
      // @llm-translated 2026-04-17
      ai_walk_description: "سيرشدك الذكاء الاصطناعي خطوة بخطوة للحصول على بيانات اعتماد API.",
      // @llm-translated 2026-04-17
      wizard_subtitle: "إعداد بيانات الاعتماد بتوجيه الذكاء الاصطناعي",
      // @llm-translated 2026-04-17
      wizard_subtitle_batch: "إعداد {count} خدمة{plural}",
`
);

// vault.autopilot
replaceOnce(
  `    autopilot: {
`,
  `    autopilot: {
      // @llm-translated 2026-04-17
      from_url: "من URL",
      // @llm-translated 2026-04-17
      paste_content: "لصق المحتوى",
      // @llm-translated 2026-04-17
      openapi_spec_url: "URL مواصفة OpenAPI",
      // @llm-translated 2026-04-17
      openapi_format_hint: "يدعم مواصفات OpenAPI 3.x وSwagger 2.x بتنسيق JSON أو YAML",
      // @llm-translated 2026-04-17
      parsing_spec: "جارٍ تحليل المواصفة...",
      // @llm-translated 2026-04-17
      parse_analyze: "تحليل وفحص",
      // @llm-translated 2026-04-17
      connector_in_catalog: "{connectorLabel} متاح الآن في كتالوج موصّلاتك مع {toolCount} تعريف أداة.",
      // @llm-translated 2026-04-17
      generated_tools: "الأدوات المُنشأة ({count})",
      // @llm-translated 2026-04-17
      credential_fields: "حقول بيانات الاعتماد",
      // @llm-translated 2026-04-17
      open_playground: "فتح الملعب",
      // @llm-translated 2026-04-17
      copy_connector_id: "نسخ معرّف الموصّل",
      // @llm-translated 2026-04-17
      go_to_catalog: "الذهاب إلى الكتالوج",
      // @llm-translated 2026-04-17
      response_headers: "ترويسات الاستجابة ({count})",
      // @llm-translated 2026-04-17
      base_url_placeholder: "https://api.example.com",
      // @llm-translated 2026-04-17
      openapi_url_placeholder: "https://api.example.com/openapi.json",
      // @llm-translated 2026-04-17
      auth_schemes: "مخططات المصادقة",
      // @llm-translated 2026-04-17
      body_placeholder: "{ \\"key\\": \\"value\\" }",
`
);

// vault.foraging
replaceOnce(
  `    foraging: {
`,
  `    foraging: {
      // @llm-translated 2026-04-17
      start_scan: "بدء الفحص",
      // @llm-translated 2026-04-17
      checking_env: "جارٍ فحص متغيرات البيئة وملفات الإعداد وبيانات اعتماد أدوات المطور",
      // @llm-translated 2026-04-17
      importing: "جارٍ استيراد بيانات الاعتماد إلى الخزنة...",
      // @llm-translated 2026-04-17
      scan_again: "فحص مجدداً",
      // @llm-translated 2026-04-17
      back_to_vault: "العودة إلى الخزنة",
      // @llm-translated 2026-04-17
      already_in_vault: "موجودة في الخزنة",
      // @llm-translated 2026-04-17
      imported: "تم الاستيراد",
      // @llm-translated 2026-04-17
      to_vault: "إلى الخزنة",
      // @llm-translated 2026-04-17
      credentials_found_one: "عُثر على بيانات اعتماد واحدة",
      // @llm-translated 2026-04-17
      credentials_found_other: "عُثر على {count} من بيانات الاعتماد",
      // @llm-translated 2026-04-17
      selected: "محدد",
      // @llm-translated 2026-04-17
      import_to_vault_one: "استيراد بيانات اعتماد واحدة إلى الخزنة",
      // @llm-translated 2026-04-17
      import_to_vault_other: "استيراد {count} من بيانات الاعتماد إلى الخزنة",
      // @llm-translated 2026-04-17
      env_var_one: "{count} متغير بيئة",
      // @llm-translated 2026-04-17
      env_var_other: "{count} متغيرات بيئة",
      // @llm-translated 2026-04-17
      import_server: "استيراد",
      // @llm-translated 2026-04-17
      sources_in: "المصادر في",
      // @llm-translated 2026-04-17
      progress_aria: "تقدم الفحص",
      // @llm-translated 2026-04-17
      scanned_sources: "فُحص {count} مصدر في {ms} مللي ثانية",
`
);

// vault.desktop_discovery
replaceOnce(
  `    desktop_discovery: {
`,
  `    desktop_discovery: {
      // @llm-translated 2026-04-17
      connect_description: "اتصل بالتطبيقات المحلية أو استورد خوادم MCP من Claude Desktop",
      // @llm-translated 2026-04-17
      detected_apps_tab: "التطبيقات المكتشفة ({count})",
      // @llm-translated 2026-04-17
      claude_mcp_tab: "Claude MCP ({count})",
      // @llm-translated 2026-04-17
      scanning: "جارٍ فحص تطبيقات سطح المكتب...",
      // @llm-translated 2026-04-17
      detected_on_system: "مكتشف على نظامك",
      // @llm-translated 2026-04-17
      not_detected: "غير مكتشف",
      // @llm-translated 2026-04-17
      no_apps: "لم تُكتشَف تطبيقات سطح مكتب. جرّب التحديث.",
      // @llm-translated 2026-04-17
      reading_config: "جارٍ قراءة إعداد Claude Desktop...",
      // @llm-translated 2026-04-17
      mcp_servers_found_one: "عُثر على {count} خادم MCP في إعداد Claude Desktop. استوردها كبيانات اعتماد لاستخدامها مع وكلاءك.",
      // @llm-translated 2026-04-17
      mcp_servers_found_other: "عُثر على {count} خوادم MCP في إعداد Claude Desktop. استوردها كبيانات اعتماد لاستخدامها مع وكلاءك.",
      // @llm-translated 2026-04-17
      no_mcp_config: "لم يُعثَر على إعداد MCP لـ Claude Desktop.",
      // @llm-translated 2026-04-17
      mcp_config_hint: "إذا كان Claude Desktop مثبّتاً، تأكد من تكوين خوادم MCP في إعداداته.",
      // @llm-translated 2026-04-17
      permission_required: "إذن مطلوب",
      // @llm-translated 2026-04-17
      approve_description: "يطلب الإمكانات التالية. راجع واقبل لتفعيل هذا الموصّل.",
      // @llm-translated 2026-04-17
      approve_connect: "قبول والاتصال",
`
);

// vault.picker_section
replaceOnce(
  `    picker_section: {
`,
  `    picker_section: {
      // @llm-translated 2026-04-17
      credential_name: "اسم بيانات الاعتماد",
      // @llm-translated 2026-04-17
      add_project_first: "أضف مشروعاً في أدوات المطور أولاً لربط قاعدة الكود بوكلاءك.",
      // @llm-translated 2026-04-17
      go_to_dev_tools: "الذهاب إلى أدوات المطور",
      // @llm-translated 2026-04-17
      workspace_connect_description: "تسجيل دخول Google واحد يُنشئ بيانات اعتماد Gmail وCalendar وDrive وSheets تلقائياً",
      // @llm-translated 2026-04-17
      foraging_description: "افحص نظام الملفات بحثاً عن مفاتيح API ومسارات AWS ومتغيرات البيئة وأكثر",
      // @llm-translated 2026-04-17
      no_setup_guide: "لا يوجد دليل إعداد لهذا الموصّل. تفضّل رابط الوثائق أدناه للتعليمات.",
      // @llm-translated 2026-04-17
      open_setup_page: "فتح صفحة إعداد {label}",
`
);

// vault.design_phases
replaceOnce(
  `    design_phases: {
`,
  `    design_phases: {
      // @llm-translated 2026-04-17
      credential_saved_message: "تم حفظ بيانات اعتماد {label} بأمان.",
      // @llm-translated 2026-04-17
      revision_count: "(المراجعة {count})",
      // @llm-translated 2026-04-17
      connector_added_to_catalog: "أُضيف الموصّل إلى كتالوجك — متاح الآن للشخصيات الأخرى واعتماد القوالب.",
      // @llm-translated 2026-04-17
      view_credential: "عرض بيانات الاعتماد",
      // @llm-translated 2026-04-17
      refine_hint: "هل تحتاج لضبط النطاقات أو إضافة حقول أو تعديل الإعداد؟",
      // @llm-translated 2026-04-17
      refine_placeholder: "مثلاً: إضافة نطاقات كتابة، إضافة بيئة التدريج...",
      // @llm-translated 2026-04-17
      refine: "تنقيح",
      // @llm-translated 2026-04-17
      linked_to_existing: "سيُربط بيانات اعتمادك بتعريف الموصّل الحالي.",
      // @llm-translated 2026-04-17
      no_existing_connector: "— لم يُعثَر على موصّل {name} في كتالوجك.",
      // @llm-translated 2026-04-17
      new_connector_will_be_registered: "عند حفظ بيانات الاعتماد، سيُسجَّل تعريف الموصّل المُنشأ بالذكاء الاصطناعي تلقائياً في كتالوجك.",
      // @llm-translated 2026-04-17
      refine_request: "ليس صحيحاً تماماً؟ نقّح طلبك",
      // @llm-translated 2026-04-17
      auto_provision_hint: "— دع الذكاء الاصطناعي يرشدك خطوة بخطوة للحصول على بيانات اعتماد {label}.",
      // @llm-translated 2026-04-17
      credential_name_label: "اسم بيانات الاعتماد",
      // @llm-translated 2026-04-17
      credentials_secure_notice: "تُخزَّن بيانات الاعتماد بأمان في خزنة التطبيق وتكون متاحة لتنفيذ أدوات الوكيل.",
      // @llm-translated 2026-04-17
      tested_successfully_at: "اختُبر بنجاح في {time}",
      // @llm-translated 2026-04-17
      setup_instructions: "تعليمات الإعداد",
      // @llm-translated 2026-04-17
      all_steps_complete: "جميع الخطوات مكتملة — أكمل الحقول أدناه واختبر اتصالك.",
      // @llm-translated 2026-04-17
      use_template: "استخدام",
      // @llm-translated 2026-04-17
      recipe_used_one: "— استُخدم {count} مرة",
      // @llm-translated 2026-04-17
      recipe_used_other: "— استُخدم {count} مرات",
      // @llm-translated 2026-04-17
      instruction_placeholder: "مثلاً Slack، OpenAI، GitHub، Stripe...",
`
);

// vault.auto_cred_extra
replaceOnce(
  `    auto_cred_extra: {
`,
  `    auto_cred_extra: {
      // @llm-translated 2026-04-17
      browser_automation_warning: "أتمتة المتصفح تعمل. لا تتفاعل مع النافذة — ستستأنف عند الاكتمال.",
      // @llm-translated 2026-04-17
      desktop_bridge_title: "{{label}} يتطلب تطبيق سطح المكتب",
      // @llm-translated 2026-04-17
      desktop_bridge_hint: "هذا الموصّل يُشغّل جلسة متصفح أصلية تعمل فقط في تطبيق Personas لسطح المكتب.",
      // @llm-translated 2026-04-17
      review_extracted: "مراجعة بيانات الاعتماد المستخرجة",
      // @llm-translated 2026-04-17
      review_extracted_hint: "قيم مستخرجة من المتصفح — تحقق قبل الحفظ",
      // @llm-translated 2026-04-17
      completeness_partial: "{filled} من {total} حقل مطلوب مملوء. أكمل الحقول المفقودة قبل الحفظ.",
      // @llm-translated 2026-04-17
      universal_auto_setup: "إعداد تلقائي شامل",
      // @llm-translated 2026-04-17
      universal_auto_setup_hint: "أدخل URL ووصفاً وسيتنقل الذكاء الاصطناعي في الموقع تلقائياً لاكتشاف وإنشاء بيانات اعتماد API.",
      // @llm-translated 2026-04-17
      service_url_label: "URL الخدمة",
      // @llm-translated 2026-04-17
      service_url_placeholder: "https://app.example.com أو https://developer.example.com",
      // @llm-translated 2026-04-17
      what_do_you_need: "ماذا تحتاج؟",
      // @llm-translated 2026-04-17
      description_placeholder: "مثلاً: أحتاج مفتاح API للقراءة والكتابة. بوابة المطورين تحتوي قسم API Keys ضمن الإعدادات.",
      // @llm-translated 2026-04-17
      discover_credentials: "اكتشاف بيانات الاعتماد",
      // @llm-translated 2026-04-17
      discovered_label: "مكتشف: {label}",
      // @llm-translated 2026-04-17
      fields_discovered_one: "عُثر على حقل واحد",
      // @llm-translated 2026-04-17
      fields_discovered_other: "عُثر على {count} حقل",
      // @llm-translated 2026-04-17
      extracted_values_label: "القيم المستخرجة",
      // @llm-translated 2026-04-17
      no_fields_discovered: "لم يُكتشَف أي حقل. جرّب مجدداً بوصف أكثر تحديداً.",
      // @llm-translated 2026-04-17
      fields_captured_partial: "{filled}/{total} حقل تم التقاطه",
      // @llm-translated 2026-04-17
      credential_stored: "تم تخزين بيانات اعتماد {label} بأمان.",
`
);

// vault.negotiator_extra
replaceOnce(
  `    negotiator_extra: {
`,
  `    negotiator_extra: {
      // @llm-translated 2026-04-17
      panel_title: "منفّذ بيانات الاعتماد بالذكاء الاصطناعي",
      // @llm-translated 2026-04-17
      planning_description: "يحلّل الذكاء الاصطناعي بوابة المطورين ويُنشئ خطة توفير تفصيلية...",
`
);

// vault.workspace_panel
replaceOnce(
  `    workspace_panel: {
`,
  `    workspace_panel: {
      // @llm-translated 2026-04-17
      selected_count: "{selected} من {total} محدد",
      // @llm-translated 2026-04-17
      select_all: "تحديد الكل",
      // @llm-translated 2026-04-17
      connect_services_one: "الاتصال بـ {count} خدمة بتسجيل دخول واحد",
      // @llm-translated 2026-04-17
      connect_services_other: "الاتصال بـ {count} خدمة بتسجيل دخول واحد",
      // @llm-translated 2026-04-17
      granting_access_one: "سيمنح هذا الوصول إلى {count} خدمة",
      // @llm-translated 2026-04-17
      granting_access_other: "سيمنح هذا الوصول إلى {count} خدمة",
      // @llm-translated 2026-04-17
      credentials_created_one: "تم إنشاء بيانات اعتماد واحدة من تسجيل دخول واحد.",
      // @llm-translated 2026-04-17
      credentials_created_other: "تم إنشاء {count} من بيانات الاعتماد من تسجيل دخول واحد.",
      // @llm-translated 2026-04-17
      sign_in_browser: "سجّل الدخول بحسابك في Google في نافذة المتصفح.",
`
);

// ── Insert new sections: reauth_banner and cli_capture (before gateway) ──────
replaceOnce(
  `    gateway: {
      gateway_members:`,
  `    // @llm-translated 2026-04-17
    reauth_banner: {
      // @llm-translated 2026-04-17
      access_revoked: ") — تم إلغاء الوصول. أعد التفويض لاستئناف الأتمتة.",
      // @llm-translated 2026-04-17
      reconnect: "إعادة الاتصال",
    },
    // @llm-translated 2026-04-17
    cli_capture: {
      // @llm-translated 2026-04-17
      cta: "استيراد من CLI المحلي",
      // @llm-translated 2026-04-17
      hint: "استخدم CLI مسجّلاً دخوله محلياً بدلاً من لصق مفتاح API.",
      // @llm-translated 2026-04-17
      running: "جارٍ تشغيل CLI المحلي...",
      // @llm-translated 2026-04-17
      success: "تم التقاط بيانات الاعتماد من CLI",
      // @llm-translated 2026-04-17
      token_ttl_notice: "ينتهي هذا الرمز خلال {seconds} ث وسيُجدَّد تلقائياً.",
      // @llm-translated 2026-04-17
      source_label: "CLI",
      // @llm-translated 2026-04-17
      missing_binary: "\`{binary}\` غير مثبّت أو ليس في موقع مسموح به.",
      // @llm-translated 2026-04-17
      unauthenticated: "أنت غير مسجّل الدخول في {binary}. {instruction}",
      // @llm-translated 2026-04-17
      capture_failed: "فشل الالتقاط من CLI: {detail}",
      // @llm-translated 2026-04-17
      timeout: "انتهت مهلة الالتقاط من CLI. جرّب تشغيل الأمر يدوياً أولاً.",
    },
    gateway: {
      gateway_members:`
);

// ── Agents section missing keys ──────────────────────────────────────────────
replaceOnce(
  `      additional_instructions_placeholder: "أضف أي متطلبات محددة أو معرفة متخصصة أو قيوداً...",
    },
    connectors: {`,
  `      additional_instructions_placeholder: "أضف أي متطلبات محددة أو معرفة متخصصة أو قيوداً...",
      // @llm-translated 2026-04-17
      conv_controls_aria: "عناصر تحكم محادثة التصميم",
    },
    connectors: {`
);

replaceOnce(
  `      sub_filter: "تصفية: {filter}",
    },
    editor_chrome: {`,
  `      sub_filter: "تصفية: {filter}",
      // @llm-translated 2026-04-17
      auto_input_schema_placeholder: "{ \\"file_url\\": \\"string\\" }",
      // @llm-translated 2026-04-17
      auto_github_token_needs: "يحتاج رمزك إلى نطاق {scopes}. حدّث رمزك في github.com/settings/tokens.",
      // @llm-translated 2026-04-17
      auto_fallback_title: "يعود إلى الموصّل المباشر عند الفشل",
    },
    editor_chrome: {`
);

replaceOnce(
  `      model_name_placeholder_custom: "معرّف النموذج",
      base_url_hint:`,
  `      model_name_placeholder_custom: "معرّف النموذج",
      // @llm-translated 2026-04-17
      model_name_placeholder_override: "مثلاً claude-sonnet-4-20250514",
      base_url_hint:`
);

replaceOnce(
  `      health_watch_enable: "تفعيل المراقبة المستمرة للصحة",
    },
    tool_runner: {`,
  `      health_watch_enable: "تفعيل المراقبة المستمرة للصحة",
      // @llm-translated 2026-04-17
      speak_as: "تحدّث بوصفي",
      // @llm-translated 2026-04-17
      no_twins_configured: "لا توائم مُعدَّة. افتح إضافة التوأم لإنشاء واحد — سيتمكن هذا الوكيل من تبنّيه.",
      // @llm-translated 2026-04-17
      twin_profile_aria: "ملف التوأم الذي يتحدث هذا الوكيل بوصفه",
    },
    tool_runner: {`
);

replaceOnce(
  `      input_json: "مدخل JSON",
      run: "تشغيل",`,
  `      input_json: "مدخل JSON",
      // @llm-translated 2026-04-17
      input_json_placeholder: "{ \\"key\\": \\"value\\" }",
      run: "تشغيل",`
);

replaceOnce(
  `      sections: "أقسام",
    },
    custom_sections: {`,
  `      sections: "أقسام",
      // @llm-translated 2026-04-17
      sections_aria: "أقسام التعليمات",
    },
    custom_sections: {`
);

writeFileSync('./src/i18n/ar.ts', src, 'utf8');
console.log('Done. File size:', src.length);
