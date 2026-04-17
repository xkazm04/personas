#!/usr/bin/env node
/**
 * One-shot fill: adds the 52 overview.* keys that were missing across
 * all 13 non-English locales after the 4d589912 restoration. Inserts
 * each key at its correct nested path in every locale JSON.
 *
 * Translations below are author-curated machine translations. Quality
 * varies: de/fr/es/ru/zh/ja are highest-confidence; cs/id/ko/vi are
 * good; ar/hi/bn are usable but benefit most from human review.
 * Every translated key added here is marked in the commit message and
 * should be reviewed by a fluent speaker before the TEMPORARY fallback
 * in useTranslation.ts is removed.
 *
 * Usage:  node scripts/i18n/fill-missing-keys.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const LOCALES_DIR = resolve(ROOT, 'src/i18n/locales');

/**
 * Flat key → translation-per-locale map. Each value is itself a
 * { locale: translation } object keyed by ISO code.
 * Placeholders like `{count}` are preserved literally.
 * Brand names (Ollama, IPC, SLA) kept in Latin script across all locales.
 */
const FILLS = {
  'overview.healing_issue_modal.retrying_badge': {
    ar: 'إعادة المحاولة', bn: 'পুনরায় চেষ্টা', cs: 'opakuje se', de: 'wird wiederholt',
    es: 'reintentando', fr: 'nouvelle tentative', hi: 'पुनः प्रयास', id: 'mencoba lagi',
    ja: '再試行中', ko: '재시도 중', ru: 'повтор', vi: 'đang thử lại', zh: '重试中',
  },
  'overview.healing_issue_modal.auto_fixed_badge': {
    ar: 'تم الإصلاح تلقائياً', bn: 'স্বয়ংক্রিয়ভাবে ঠিক করা হয়েছে', cs: 'opraveno automaticky', de: 'automatisch behoben',
    es: 'corregido automáticamente', fr: 'corrigé automatiquement', hi: 'स्वचालित रूप से ठीक किया गया', id: 'diperbaiki otomatis',
    ja: '自動修復済み', ko: '자동 수정됨', ru: 'исправлено автоматически', vi: 'đã tự động sửa', zh: '已自动修复',
  },
  'overview.healing_issue_modal.retry_in_progress_badge': {
    ar: 'إعادة المحاولة قيد التنفيذ', bn: 'পুনরায় চেষ্টা চলছে', cs: 'opakování probíhá', de: 'Wiederholung läuft',
    es: 'reintento en curso', fr: 'nouvelle tentative en cours', hi: 'पुनः प्रयास जारी है', id: 'percobaan ulang berlangsung',
    ja: '再試行実行中', ko: '재시도 진행 중', ru: 'идёт повтор', vi: 'đang thử lại', zh: '重试进行中',
  },
  'overview.healing_issue_modal.healed_via_retry_badge': {
    ar: 'تم الإصلاح عبر إعادة المحاولة', bn: 'পুনরায় চেষ্টার মাধ্যমে ঠিক হয়েছে', cs: 'opraveno opakováním', de: 'durch Wiederholung behoben',
    es: 'corregido mediante reintento', fr: 'corrigé par nouvelle tentative', hi: 'पुनः प्रयास से ठीक हुआ', id: 'diperbaiki lewat percobaan ulang',
    ja: '再試行で修復', ko: '재시도로 복구됨', ru: 'исправлено повтором', vi: 'đã sửa qua thử lại', zh: '通过重试修复',
  },
  'overview.healing_issue_modal.severity_suffix': {
    ar: 'شدة', bn: 'গুরুত্ব', cs: 'závažnost', de: 'Schweregrad',
    es: 'gravedad', fr: 'gravité', hi: 'गंभीरता', id: 'tingkat keparahan',
    ja: '重大度', ko: '심각도', ru: 'серьёзность', vi: 'mức độ', zh: '严重程度',
  },
  'overview.healing_issues_panel.analysis_complete_prefix': {
    ar: 'اكتمل التحليل:', bn: 'বিশ্লেষণ সম্পূর্ণ:', cs: 'Analýza dokončena:', de: 'Analyse abgeschlossen:',
    es: 'Análisis completado:', fr: 'Analyse terminée :', hi: 'विश्लेषण पूर्ण:', id: 'Analisis selesai:',
    ja: '分析完了:', ko: '분석 완료:', ru: 'Анализ завершён:', vi: 'Phân tích hoàn tất:', zh: '分析完成：',
  },
  'overview.healing_timeline.retry_badge': {
    ar: 'إعادة #{count}', bn: 'পুনঃপ্রয়াস #{count}', cs: 'opakování #{count}', de: 'Wiederholung #{count}',
    es: 'reintento #{count}', fr: 'tentative #{count}', hi: 'पुनः प्रयास #{count}', id: 'percobaan #{count}',
    ja: '再試行 #{count}', ko: '재시도 #{count}', ru: 'повтор #{count}', vi: 'lần {count}', zh: '重试 #{count}',
  },
  'overview.ipc_panel.commands_table_label': {
    ar: 'أداء أوامر IPC', bn: 'IPC কমান্ড কর্মক্ষমতা', cs: 'Výkon příkazů IPC', de: 'IPC-Befehlsleistung',
    es: 'Rendimiento de comandos IPC', fr: 'Performance des commandes IPC', hi: 'IPC कमांड प्रदर्शन', id: 'Kinerja perintah IPC',
    ja: 'IPCコマンドのパフォーマンス', ko: 'IPC 명령 성능', ru: 'Производительность команд IPC', vi: 'Hiệu suất lệnh IPC', zh: 'IPC 命令性能',
  },
  'overview.ipc_panel.slowest_table_label': {
    ar: 'أبطأ استدعاءات IPC', bn: 'সবচেয়ে ধীর IPC কল', cs: 'Nejpomalejší IPC volání', de: 'Langsamste IPC-Aufrufe',
    es: 'Llamadas IPC más lentas', fr: 'Appels IPC les plus lents', hi: 'सबसे धीमे IPC कॉल', id: 'Panggilan IPC terlambat',
    ja: '最も遅いIPC呼び出し', ko: '가장 느린 IPC 호출', ru: 'Самые медленные вызовы IPC', vi: 'Cuộc gọi IPC chậm nhất', zh: '最慢的 IPC 调用',
  },
  'overview.ipc_panel.error_rate': {
    ar: 'معدل الأخطاء:', bn: 'ত্রুটির হার:', cs: 'Míra chyb:', de: 'Fehlerrate:',
    es: 'Tasa de errores:', fr: 'Taux d\'erreur :', hi: 'त्रुटि दर:', id: 'Tingkat kesalahan:',
    ja: 'エラー率:', ko: '오류율:', ru: 'Частота ошибок:', vi: 'Tỷ lệ lỗi:', zh: '错误率：',
  },
  'overview.ipc_panel.timeout_rate': {
    ar: 'معدل المهلات:', bn: 'টাইমআউট হার:', cs: 'Míra časových limitů:', de: 'Timeout-Rate:',
    es: 'Tasa de tiempo agotado:', fr: 'Taux d\'expiration :', hi: 'टाइमआउट दर:', id: 'Tingkat waktu habis:',
    ja: 'タイムアウト率:', ko: '타임아웃 비율:', ru: 'Частота тайм-аутов:', vi: 'Tỷ lệ hết thời gian:', zh: '超时率：',
  },
  'overview.system_trace_extra.zero_ms': {
    ar: '0 مللي', bn: '0 ms', cs: '0 ms', de: '0 ms',
    es: '0 ms', fr: '0 ms', hi: '0 मि.से.', id: '0 ms',
    ja: '0ミリ秒', ko: '0ms', ru: '0 мс', vi: '0 ms', zh: '0 毫秒',
  },
  'overview.event_log_sidebar.filter_placeholder': {
    ar: 'تصفية الأحداث…', bn: 'ইভেন্ট ফিল্টার করুন…', cs: 'Filtrovat události…', de: 'Ereignisse filtern…',
    es: 'Filtrar eventos…', fr: 'Filtrer les événements…', hi: 'इवेंट फ़िल्टर करें…', id: 'Filter peristiwa…',
    ja: 'イベントをフィルター…', ko: '이벤트 필터링…', ru: 'Фильтр событий…', vi: 'Lọc sự kiện…', zh: '筛选事件…',
  },
  'overview.event_detail_drawer.event_id_label': {
    ar: 'معرّف الحدث', bn: 'ইভেন্ট আইডি', cs: 'ID události', de: 'Ereignis-ID',
    es: 'ID de evento', fr: 'ID d\'événement', hi: 'इवेंट आईडी', id: 'ID peristiwa',
    ja: 'イベントID', ko: '이벤트 ID', ru: 'ID события', vi: 'ID sự kiện', zh: '事件 ID',
  },
  'overview.event_detail_drawer.broadcast': {
    ar: '(بث)', bn: '(ব্রডকাস্ট)', cs: '(všesměrové)', de: '(Broadcast)',
    es: '(difusión)', fr: '(diffusion)', hi: '(ब्रॉडकास्ट)', id: '(siaran)',
    ja: '(ブロードキャスト)', ko: '(브로드캐스트)', ru: '(широковещание)', vi: '(phát rộng)', zh: '（广播）',
  },
  'overview.event_bus_overlay.earlier_events_not_shown_one': {
    ar: '{count} حدث سابق غير معروض', bn: '{count} পূর্ববর্তী ইভেন্ট দেখানো হয়নি', cs: '{count} dřívější událost nezobrazena', de: '{count} früheres Ereignis nicht angezeigt',
    es: '{count} evento anterior no mostrado', fr: '{count} événement antérieur non affiché', hi: '{count} पहले की इवेंट नहीं दिखाई गई', id: '{count} peristiwa sebelumnya tidak ditampilkan',
    ja: '以前のイベント {count} 件は表示されていません', ko: '이전 이벤트 {count}건 표시되지 않음', ru: 'Не показано {count} более раннее событие', vi: '{count} sự kiện trước không hiển thị', zh: '{count} 条较早的事件未显示',
  },
  'overview.event_bus_overlay.earlier_events_not_shown_other': {
    ar: '{count} أحداث سابقة غير معروضة', bn: '{count} পূর্ববর্তী ইভেন্ট দেখানো হয়নি', cs: '{count} dřívějších událostí nezobrazeno', de: '{count} frühere Ereignisse nicht angezeigt',
    es: '{count} eventos anteriores no mostrados', fr: '{count} événements antérieurs non affichés', hi: '{count} पहले की इवेंट नहीं दिखाई गईं', id: '{count} peristiwa sebelumnya tidak ditampilkan',
    ja: '以前のイベント {count} 件は表示されていません', ko: '이전 이벤트 {count}건 표시되지 않음', ru: 'Не показано {count} более ранних событий', vi: '{count} sự kiện trước không hiển thị', zh: '{count} 条较早的事件未显示',
  },
  'overview.event_bus_filter.search_placeholder': {
    ar: 'بحث الأحداث...', bn: 'ইভেন্ট খুঁজুন...', cs: 'Hledat události…', de: 'Ereignisse suchen…',
    es: 'Buscar eventos…', fr: 'Rechercher des événements…', hi: 'इवेंट खोजें...', id: 'Cari peristiwa...',
    ja: 'イベントを検索…', ko: '이벤트 검색…', ru: 'Поиск событий…', vi: 'Tìm sự kiện…', zh: '搜索事件…',
  },
  'overview.realtime_stats.events_per_min': {
    ar: 'أحداث/دقيقة', bn: 'ইভেন্ট/মিনিট', cs: 'událostí/min', de: 'Ereignisse/Min',
    es: 'eventos/min', fr: 'événements/min', hi: 'इवेंट/मिनट', id: 'peristiwa/menit',
    ja: 'イベント/分', ko: '이벤트/분', ru: 'событий/мин', vi: 'sự kiện/phút', zh: '事件/分钟',
  },
  'overview.realtime_stats.pending': {
    ar: 'قيد الانتظار', bn: 'মুলতুবি', cs: 'čeká', de: 'ausstehend',
    es: 'pendiente', fr: 'en attente', hi: 'लंबित', id: 'tertunda',
    ja: '保留中', ko: '대기 중', ru: 'ожидает', vi: 'đang chờ', zh: '待处理',
  },
  'overview.realtime_stats.success': {
    ar: 'نجاح', bn: 'সফল', cs: 'úspěch', de: 'Erfolg',
    es: 'éxito', fr: 'succès', hi: 'सफल', id: 'berhasil',
    ja: '成功', ko: '성공', ru: 'успех', vi: 'thành công', zh: '成功',
  },
  'overview.realtime_stats.in_window': {
    ar: 'في النافذة', bn: 'উইন্ডোতে', cs: 'v okně', de: 'im Zeitfenster',
    es: 'en ventana', fr: 'dans la fenêtre', hi: 'विंडो में', id: 'dalam jendela',
    ja: 'ウィンドウ内', ko: '창 내', ru: 'в окне', vi: 'trong cửa sổ', zh: '窗口内',
  },
  'overview.realtime_stats.test_flow': {
    ar: 'تدفّق الاختبار', bn: 'পরীক্ষা প্রবাহ', cs: 'Testovací tok', de: 'Testfluss',
    es: 'Flujo de prueba', fr: 'Flux de test', hi: 'परीक्षण प्रवाह', id: 'Alur uji',
    ja: 'テストフロー', ko: '테스트 흐름', ru: 'Тестовый поток', vi: 'Luồng kiểm thử', zh: '测试流',
  },
  'overview.realtime_stats.to_simulate_traffic': {
    ar: 'لمحاكاة حركة المرور', bn: 'ট্রাফিক সিমুলেট করতে', cs: 'pro simulaci provozu', de: 'um Traffic zu simulieren',
    es: 'para simular tráfico', fr: 'pour simuler le trafic', hi: 'ट्रैफ़िक अनुकरण के लिए', id: 'untuk mensimulasikan lalu lintas',
    ja: 'トラフィックをシミュレート', ko: '트래픽 시뮬레이션', ru: 'для имитации трафика', vi: 'để mô phỏng lưu lượng', zh: '以模拟流量',
  },
  'overview.bus_lane.event_queue': {
    ar: 'قائمة الأحداث', bn: 'ইভেন্ট সারি', cs: 'FRONTA UDÁLOSTÍ', de: 'EREIGNIS-WARTESCHLANGE',
    es: 'COLA DE EVENTOS', fr: 'FILE D\'ATTENTE', hi: 'इवेंट कतार', id: 'ANTREAN PERISTIWA',
    ja: 'イベントキュー', ko: '이벤트 큐', ru: 'ОЧЕРЕДЬ СОБЫТИЙ', vi: 'HÀNG ĐỢI SỰ KIỆN', zh: '事件队列',
  },
  'overview.health_dashboard.heartbeats_view': {
    ar: 'عرض نبضات القلب', bn: 'হার্টবিট ভিউ', cs: 'Zobrazení signálů', de: 'Heartbeat-Ansicht',
    es: 'Vista de latidos', fr: 'Vue des battements', hi: 'हार्टबीट दृश्य', id: 'Tampilan detak',
    ja: 'ハートビート表示', ko: '하트비트 보기', ru: 'Просмотр сигналов', vi: 'Xem nhịp tim', zh: '心跳视图',
  },
  'overview.health_dashboard.status_page_view': {
    ar: 'عرض صفحة الحالة', bn: 'স্ট্যাটাস পেজ ভিউ', cs: 'Zobrazení stavové stránky', de: 'Statusseiten-Ansicht',
    es: 'Vista de página de estado', fr: 'Vue de la page de statut', hi: 'स्थिति पृष्ठ दृश्य', id: 'Tampilan halaman status',
    ja: 'ステータスページ表示', ko: '상태 페이지 보기', ru: 'Страница статуса', vi: 'Xem trang trạng thái', zh: '状态页面视图',
  },
  'overview.health_dashboard.reliability_view': {
    ar: 'عرض موثوقية SLA', bn: 'SLA নির্ভরযোগ্যতা ভিউ', cs: 'Zobrazení spolehlivosti SLA', de: 'SLA-Zuverlässigkeitsansicht',
    es: 'Vista de fiabilidad SLA', fr: 'Vue de fiabilité SLA', hi: 'SLA विश्वसनीयता दृश्य', id: 'Tampilan keandalan SLA',
    ja: 'SLA 信頼性ビュー', ko: 'SLA 신뢰성 보기', ru: 'Надёжность SLA', vi: 'Xem độ tin cậy SLA', zh: 'SLA 可靠性视图',
  },
  'overview.health_dashboard.refresh_tooltip': {
    ar: 'تحديث بيانات الصحة', bn: 'স্বাস্থ্য ডেটা রিফ্রেশ করুন', cs: 'Obnovit zdravotní data', de: 'Gesundheitsdaten aktualisieren',
    es: 'Actualizar datos de salud', fr: 'Actualiser les données de santé', hi: 'स्वास्थ्य डेटा ताज़ा करें', id: 'Segarkan data kesehatan',
    ja: 'ヘルスデータを更新', ko: '상태 데이터 새로고침', ru: 'Обновить данные о состоянии', vi: 'Làm mới dữ liệu sức khỏe', zh: '刷新健康数据',
  },
  'overview.health_dashboard.persona_heartbeats': {
    ar: 'نبضات الشخصيات', bn: 'পার্সোনা হার্টবিট', cs: 'Tep person', de: 'Persona-Heartbeats',
    es: 'Latidos de personas', fr: 'Battements des personas', hi: 'व्यक्तित्व हार्टबीट', id: 'Detak persona',
    ja: 'ペルソナのハートビート', ko: '페르소나 하트비트', ru: 'Пульс персон', vi: 'Nhịp tim của Persona', zh: 'Persona 心跳',
  },
  'overview.health_dashboard.system_health': {
    ar: 'صحة النظام:', bn: 'সিস্টেম স্বাস্থ্য:', cs: 'Stav systému:', de: 'Systemstatus:',
    es: 'Salud del sistema:', fr: 'Santé du système :', hi: 'सिस्टम स्वास्थ्य:', id: 'Kesehatan sistem:',
    ja: 'システムの状態:', ko: '시스템 상태:', ru: 'Состояние системы:', vi: 'Tình trạng hệ thống:', zh: '系统健康：',
  },
  'overview.health_dashboard.computing': {
    ar: 'جارٍ حساب إشارات الصحة...', bn: 'স্বাস্থ্য সংকেত গণনা করা হচ্ছে...', cs: 'Počítání zdravotních signálů…', de: 'Berechnung der Gesundheitsdaten…',
    es: 'Calculando señales de salud…', fr: 'Calcul des signaux de santé…', hi: 'स्वास्थ्य संकेत गणना की जा रही है...', id: 'Menghitung sinyal kesehatan...',
    ja: 'ヘルスシグナルを計算中…', ko: '상태 신호 계산 중…', ru: 'Вычисление показателей здоровья…', vi: 'Đang tính tín hiệu sức khỏe…', zh: '正在计算健康信号…',
  },
  'overview.health_dashboard.no_match': {
    ar: 'لا تتطابق أي شخصيات مع التصفية المختارة.', bn: 'নির্বাচিত ফিল্টারের সাথে কোনো পার্সোনা মেলে না।', cs: 'Žádné persony neodpovídají vybranému filtru.', de: 'Keine Personas entsprechen dem gewählten Filter.',
    es: 'Ninguna persona coincide con el filtro seleccionado.', fr: 'Aucune persona ne correspond au filtre sélectionné.', hi: 'चयनित फ़िल्टर से मेल खाने वाला कोई व्यक्तित्व नहीं।', id: 'Tidak ada persona yang cocok dengan filter yang dipilih.',
    ja: '選択されたフィルターに一致するペルソナはありません。', ko: '선택한 필터와 일치하는 페르소나가 없습니다.', ru: 'Ни одна персона не соответствует выбранному фильтру.', vi: 'Không có persona nào khớp với bộ lọc đã chọn.', zh: '没有符合所选筛选条件的 Persona。',
  },
  'overview.health_dashboard.loading_status_page': {
    ar: 'جارٍ تحميل صفحة الحالة...', bn: 'স্ট্যাটাস পেজ লোড হচ্ছে...', cs: 'Načítání stavové stránky…', de: 'Statusseite wird geladen…',
    es: 'Cargando página de estado…', fr: 'Chargement de la page de statut…', hi: 'स्थिति पृष्ठ लोड हो रहा है...', id: 'Memuat halaman status...',
    ja: 'ステータスページを読み込み中…', ko: '상태 페이지 불러오는 중…', ru: 'Загрузка страницы статуса…', vi: 'Đang tải trang trạng thái…', zh: '正在加载状态页面…',
  },
  'overview.health_dashboard.loading_reliability': {
    ar: 'جارٍ تحميل بيانات الموثوقية...', bn: 'নির্ভরযোগ্যতার ডেটা লোড হচ্ছে...', cs: 'Načítání dat spolehlivosti…', de: 'Zuverlässigkeitsdaten werden geladen…',
    es: 'Cargando datos de fiabilidad…', fr: 'Chargement des données de fiabilité…', hi: 'विश्वसनीयता डेटा लोड हो रहा है...', id: 'Memuat data keandalan...',
    ja: '信頼性データを読み込み中…', ko: '신뢰성 데이터 불러오는 중…', ru: 'Загрузка данных надёжности…', vi: 'Đang tải dữ liệu độ tin cậy…', zh: '正在加载可靠性数据…',
  },
  'overview.health_dashboard.heartbeats_btn': {
    ar: 'نبضات', bn: 'হার্টবিট', cs: 'Signály', de: 'Heartbeats',
    es: 'Latidos', fr: 'Battements', hi: 'हार्टबीट', id: 'Detak',
    ja: 'ハートビート', ko: '하트비트', ru: 'Сигналы', vi: 'Nhịp tim', zh: '心跳',
  },
  'overview.health_dashboard.reliability_btn': {
    ar: 'الموثوقية', bn: 'নির্ভরযোগ্যতা', cs: 'Spolehlivost', de: 'Zuverlässigkeit',
    es: 'Fiabilidad', fr: 'Fiabilité', hi: 'विश्वसनीयता', id: 'Keandalan',
    ja: '信頼性', ko: '신뢰성', ru: 'Надёжность', vi: 'Độ tin cậy', zh: '可靠性',
  },
  'overview.crash_logs.title': {
    ar: 'سجلات الأعطال', bn: 'ক্র্যাশ লগ', cs: 'Protokoly pádů', de: 'Absturzprotokolle',
    es: 'Registros de fallos', fr: 'Journaux de plantage', hi: 'क्रैश लॉग', id: 'Log kerusakan',
    ja: 'クラッシュログ', ko: '충돌 로그', ru: 'Журналы сбоев', vi: 'Nhật ký sự cố', zh: '崩溃日志',
  },
  'overview.crash_logs.no_logs': {
    ar: 'لم يتم تسجيل أي سجلات أعطال.', bn: 'কোনো ক্র্যাশ লগ রেকর্ড করা হয়নি।', cs: 'Žádné protokoly pádů nejsou zaznamenány.', de: 'Keine Absturzprotokolle aufgezeichnet.',
    es: 'No se han registrado fallos.', fr: 'Aucun journal de plantage enregistré.', hi: 'कोई क्रैश लॉग दर्ज नहीं है।', id: 'Tidak ada log kerusakan yang tercatat.',
    ja: 'クラッシュログは記録されていません。', ko: '기록된 충돌 로그가 없습니다.', ru: 'Журналы сбоев не зарегистрированы.', vi: 'Không có nhật ký sự cố nào.', zh: '未记录崩溃日志。',
  },
  'overview.crash_logs.component_stack_separator': {
    ar: '--- Component Stack ---', bn: '--- Component Stack ---', cs: '--- Component Stack ---', de: '--- Component Stack ---',
    es: '--- Component Stack ---', fr: '--- Component Stack ---', hi: '--- Component Stack ---', id: '--- Component Stack ---',
    ja: '--- Component Stack ---', ko: '--- Component Stack ---', ru: '--- Component Stack ---', vi: '--- Component Stack ---', zh: '--- Component Stack ---',
  },
  'overview.popup_fields.sign_up_free_at': {
    ar: 'اشترك مجاناً على', bn: 'বিনামূল্যে সাইন আপ করুন', cs: 'Zaregistrujte se zdarma na', de: 'Kostenlos registrieren auf',
    es: 'Regístrate gratis en', fr: 'Inscrivez-vous gratuitement sur', hi: 'मुफ़्त में साइन अप करें', id: 'Daftar gratis di',
    ja: '無料で登録', ko: '무료 가입 위치:', ru: 'Бесплатная регистрация на', vi: 'Đăng ký miễn phí tại', zh: '免费注册于',
  },
  'overview.popup_fields.ollama_domain': {
    ar: 'ollama.com', bn: 'ollama.com', cs: 'ollama.com', de: 'ollama.com',
    es: 'ollama.com', fr: 'ollama.com', hi: 'ollama.com', id: 'ollama.com',
    ja: 'ollama.com', ko: 'ollama.com', ru: 'ollama.com', vi: 'ollama.com', zh: 'ollama.com',
  },
  'overview.popup_fields.ollama_key_instructions': {
    ar: '، ثم انسخ مفتاح API من الإعدادات. يُخزَّن هذا المفتاح محلياً ويُشارَك بين جميع الوكلاء.',
    bn: ', তারপর সেটিংস থেকে আপনার API কী কপি করুন। এই কী স্থানীয়ভাবে সংরক্ষিত এবং সমস্ত এজেন্টের মধ্যে শেয়ার করা হয়।',
    cs: ', poté zkopírujte svůj API klíč z Nastavení. Klíč je uložen lokálně a sdílen všemi agenty.',
    de: ', kopieren Sie dann Ihren API-Schlüssel aus den Einstellungen. Der Schlüssel wird lokal gespeichert und für alle Agenten gemeinsam genutzt.',
    es: ', luego copia tu clave API desde Configuración. Esta clave se almacena localmente y se comparte entre todos los agentes.',
    fr: ', puis copiez votre clé API depuis les paramètres. Cette clé est stockée localement et partagée par tous les agents.',
    hi: ', फिर सेटिंग्स से अपनी API कुंजी कॉपी करें। यह कुंजी स्थानीय रूप से संग्रहीत है और सभी एजेंट्स में साझा की जाती है।',
    id: ', lalu salin kunci API Anda dari Pengaturan. Kunci ini disimpan secara lokal dan dibagikan ke semua agen.',
    ja: '、設定からAPIキーをコピーしてください。このキーはローカルに保存され、すべてのエージェントで共有されます。',
    ko: ', 설정에서 API 키를 복사하세요. 이 키는 로컬에 저장되며 모든 에이전트에서 공유됩니다.',
    ru: ', затем скопируйте API-ключ из Настроек. Ключ хранится локально и используется всеми агентами.',
    vi: ', sau đó sao chép khóa API của bạn từ Cài đặt. Khóa này được lưu cục bộ và dùng chung cho mọi agent.',
    zh: '，然后从设置中复制您的 API 密钥。此密钥存储在本地，所有代理共享使用。',
  },
  'overview.events_list.save_view_tooltip': {
    ar: 'حفظ المرشحات الحالية كعرض', bn: 'বর্তমান ফিল্টারকে ভিউ হিসাবে সংরক্ষণ করুন', cs: 'Uložit aktuální filtry jako zobrazení', de: 'Aktuelle Filter als Ansicht speichern',
    es: 'Guardar filtros actuales como vista', fr: 'Enregistrer les filtres comme vue', hi: 'वर्तमान फ़िल्टर को दृश्य के रूप में सहेजें', id: 'Simpan filter saat ini sebagai tampilan',
    ja: '現在のフィルターをビューとして保存', ko: '현재 필터를 보기로 저장', ru: 'Сохранить текущие фильтры как представление', vi: 'Lưu bộ lọc hiện tại thành view', zh: '将当前筛选条件保存为视图',
  },
  'overview.events_list.clear_filters_tooltip': {
    ar: 'مسح جميع المرشحات', bn: 'সমস্ত ফিল্টার সাফ করুন', cs: 'Vymazat všechny filtry', de: 'Alle Filter löschen',
    es: 'Borrar todos los filtros', fr: 'Effacer tous les filtres', hi: 'सभी फ़िल्टर साफ़ करें', id: 'Hapus semua filter',
    ja: 'すべてのフィルターをクリア', ko: '모든 필터 지우기', ru: 'Очистить все фильтры', vi: 'Xoá mọi bộ lọc', zh: '清除所有筛选条件',
  },
  'overview.dashboard_home.you_have': {
    ar: 'لديك', bn: 'আপনার আছে', cs: 'Máte', de: 'Sie haben',
    es: 'Tienes', fr: 'Vous avez', hi: 'आपके पास', id: 'Anda memiliki',
    ja: 'あなたには', ko: '보유 중:', ru: 'У вас есть', vi: 'Bạn có', zh: '您有',
  },
  'overview.fleet_optimization_card.title': {
    ar: 'تحسين الأسطول', bn: 'ফ্লিট অপ্টিমাইজেশন', cs: 'Optimalizace flotily', de: 'Flottenoptimierung',
    es: 'Optimización de flota', fr: 'Optimisation de flotte', hi: 'फ्लीट अनुकूलन', id: 'Optimisasi armada',
    ja: 'フリート最適化', ko: '플릿 최적화', ru: 'Оптимизация флота', vi: 'Tối ưu hoá đội', zh: '群组优化',
  },
  'overview.usage_filters.time_range_label': {
    ar: 'النطاق الزمني', bn: 'সময় পরিসীমা', cs: 'Časové rozmezí', de: 'Zeitraum',
    es: 'Intervalo de tiempo', fr: 'Plage temporelle', hi: 'समय सीमा', id: 'Rentang waktu',
    ja: '時間範囲', ko: '시간 범위', ru: 'Временной диапазон', vi: 'Khoảng thời gian', zh: '时间范围',
  },
  'overview.day_range_picker.start_date': {
    ar: 'تاريخ البدء', bn: 'শুরুর তারিখ', cs: 'Datum začátku', de: 'Startdatum',
    es: 'Fecha de inicio', fr: 'Date de début', hi: 'शुरू होने की तारीख', id: 'Tanggal mulai',
    ja: '開始日', ko: '시작일', ru: 'Дата начала', vi: 'Ngày bắt đầu', zh: '开始日期',
  },
  'overview.day_range_picker.end_date': {
    ar: 'تاريخ الانتهاء', bn: 'শেষের তারিখ', cs: 'Datum konce', de: 'Enddatum',
    es: 'Fecha de fin', fr: 'Date de fin', hi: 'समाप्ति तिथि', id: 'Tanggal selesai',
    ja: '終了日', ko: '종료일', ru: 'Дата окончания', vi: 'Ngày kết thúc', zh: '结束日期',
  },
  'overview.healing_summary.auto_fixed_this_week': {
    ar: 'تم الإصلاح تلقائياً هذا الأسبوع', bn: 'এই সপ্তাহে স্বয়ংক্রিয়ভাবে ঠিক হয়েছে', cs: 'opraveno automaticky tento týden', de: 'diese Woche automatisch behoben',
    es: 'corregido automáticamente esta semana', fr: 'corrigé automatiquement cette semaine', hi: 'इस सप्ताह स्वचालित रूप से ठीक किया गया', id: 'diperbaiki otomatis minggu ini',
    ja: '今週の自動修復', ko: '이번 주 자동 수정됨', ru: 'автоматически исправлено на этой неделе', vi: 'đã tự động sửa tuần này', zh: '本周自动修复',
  },
  'overview.healing_summary.issues_in_7d': {
    ar: 'مشكلات خلال 7 أيام', bn: '7 দিনে সমস্যা', cs: 'problémy za 7 dní', de: 'Probleme in 7 Tagen',
    es: 'incidencias en 7 días', fr: 'incidents en 7 jours', hi: '7 दिनों में समस्याएँ', id: 'masalah dalam 7 hari',
    ja: '7日間のイシュー', ko: '지난 7일간 이슈', ru: 'проблемы за 7 дней', vi: 'sự cố trong 7 ngày', zh: '7 天内的问题',
  },
};

// -- Apply fills --

const LOCALES = ['ar','bn','cs','de','es','fr','hi','id','ja','ko','ru','vi','zh'];

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (node[key] === undefined || typeof node[key] !== 'object' || Array.isArray(node[key])) {
      node[key] = {};
    }
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
}

for (const lang of LOCALES) {
  const path = resolve(LOCALES_DIR, `${lang}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let added = 0;
  for (const [key, map] of Object.entries(FILLS)) {
    const translation = map[lang];
    if (translation === undefined) {
      console.warn(`  [${lang}] missing translation for ${key}`);
      continue;
    }
    setByPath(data, key, translation);
    added++;
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ ${lang} — added ${added} keys`);
}
