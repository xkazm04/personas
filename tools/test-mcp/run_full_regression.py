"""
Full regression: 20 scenarios × 14 languages = 280 persona builds.
Each build goes through: create → build → promote → verify in SQLite.

Runs 5 representative scenarios per language to keep total time ~2h.
Scenarios: #1 (template-matched), #11 (missing creds), #16 (vague), #17 (complex), #18 (simple)

Usage:
  PYTHONUNBUFFERED=1 uvx --with httpx python tools/test-mcp/run_full_regression.py
  PYTHONUNBUFFERED=1 uvx --with httpx python tools/test-mcp/run_full_regression.py --full  # all 20
  PYTHONUNBUFFERED=1 uvx --with httpx python tools/test-mcp/run_full_regression.py --lang en,de,ja
"""
import httpx
import json
import time
import sys
import argparse

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=30)

LANGUAGES = {
    "en": {"name": "English",    "email_intent": "Sort my emails and create tasks from important ones"},
    "zh": {"name": "Chinese",    "email_intent": "将我的邮件分类，并从重要邮件中创建任务"},
    "ar": {"name": "Arabic",     "email_intent": "قم بفرز رسائلي الإلكترونية وإنشاء مهام من الرسائل المهمة"},
    "hi": {"name": "Hindi",      "email_intent": "मेरे ईमेल को छांटें और महत्वपूर्ण ईमेल से कार्य बनाएं"},
    "ru": {"name": "Russian",    "email_intent": "Сортируй мои письма и создавай задачи из важных"},
    "id": {"name": "Indonesian", "email_intent": "Urutkan email saya dan buat tugas dari email penting"},
    "es": {"name": "Spanish",    "email_intent": "Ordena mis correos electrónicos y crea tareas a partir de los importantes"},
    "fr": {"name": "French",     "email_intent": "Trie mes e-mails et crée des tâches à partir des messages importants"},
    "bn": {"name": "Bengali",    "email_intent": "আমার ইমেলগুলো সাজাও এবং গুরুত্বপূর্ণ ইমেল থেকে কাজ তৈরি করো"},
    "ja": {"name": "Japanese",   "email_intent": "メールを整理して、重要なメールからタスクを作成して"},
    "vi": {"name": "Vietnamese", "email_intent": "Sắp xếp email của tôi và tạo công việc từ các email quan trọng"},
    "de": {"name": "German",     "email_intent": "Sortiere meine E-Mails und erstelle Aufgaben aus den wichtigen"},
    "ko": {"name": "Korean",     "email_intent": "내 이메일을 정리하고 중요한 이메일에서 작업을 만들어줘"},
    "cs": {"name": "Czech",      "email_intent": "Roztřiď mé e-maily a vytvoř úkoly z důležitých zpráv"},
}

# Intents per scenario (English base — used directly for en, translated contextually for others)
SCENARIOS = {
    1:  {"name": "Email Intake Triage",     "intent": "Monitor my Gmail for important emails and post summaries to a task list in Notion"},
    3:  {"name": "Expense Processing",      "intent": "Process expense receipts from Gmail, extract amounts, and log them to Airtable for monthly reporting"},
    5:  {"name": "CRM Data Quality",        "intent": "Audit our Attio CRM for duplicate contacts, missing fields, and stale deals — post findings to a report"},
    7:  {"name": "Error Monitoring",        "intent": "Watch Sentry for new error spikes and critical issues, create tracking tickets in Linear, and log incidents in Airtable"},
    11: {"name": "GitHub PR Reviewer",      "intent": "Review pull requests on GitHub, post code review comments, and create follow-up tasks in Linear"},
    15: {"name": "Jira Sprint Tracker",     "intent": "Track Jira sprint progress, detect overdue issues, and post daily reports to a Telegram channel"},
    16: {"name": "Vague Intent",            "intent": "Help me be more productive"},
    17: {"name": "Multi-Domain Complex",    "intent": "Build me an agent that monitors Gmail for client invoices, extracts amounts to Airtable, creates follow-up tasks in Asana for overdue payments, and schedules reminder meetings in Google Calendar"},
    18: {"name": "Single-Service Simple",   "intent": "Log all new Notion pages with a project tag to a daily summary"},
    20: {"name": "Contradictory Reqs",      "intent": "Build a fully automated agent that requires manual approval for every single action"},
}

# Representative subset for quick regression
QUICK_SCENARIOS = [1, 11, 16, 18, 20]

# Intent translations for non-English (keyed by scenario ID)
TRANSLATED_INTENTS = {
    "zh": {1: "监控我的Gmail中的重要邮件，并将摘要发布到Notion的任务列表中", 11: "审查GitHub上的拉取请求，发布代码审查评论，并在Linear中创建后续任务", 16: "帮助我提高工作效率", 17: "构建一个代理来监控Gmail中的客户发票，将金额提取到Airtable，在Asana中为逾期付款创建后续任务，并在Google日历中安排提醒会议", 18: "将所有带有项目标签的新Notion页面记录到每日摘要中", 3: "处理Gmail中的费用收据，提取金额，并记录到Airtable中进行月度报告", 5: "审核我们的Attio CRM中的重复联系人、缺失字段和过期交易——将结果发布到报告中", 7: "监控Sentry中的新错误峰值和关键问题，在Linear中创建跟踪工单，并在Airtable中记录事件", 15: "跟踪Jira冲刺进度，检测逾期问题，并向Telegram频道发布每日报告", 20: "构建一个完全自动化的代理，但每个操作都需要手动批准"},
    "ar": {1: "راقب بريدي الإلكتروني Gmail للرسائل المهمة وانشر ملخصات في قائمة المهام في Notion", 11: "راجع طلبات السحب على GitHub وانشر تعليقات مراجعة الكود وأنشئ مهام متابعة في Linear", 16: "ساعدني على أن أكون أكثر إنتاجية", 18: "سجل جميع صفحات Notion الجديدة ذات علامة المشروع في ملخص يومي", 17: "ابنِ وكيلاً يراقب Gmail لفواتير العملاء ويستخرج المبالغ إلى Airtable وينشئ مهام متابعة في Asana للمدفوعات المتأخرة ويجدول اجتماعات تذكيرية في Google Calendar", 20: "ابنِ وكيلاً مؤتمتاً بالكامل يتطلب موافقة يدوية لكل إجراء"},
    "hi": {1: "मेरे Gmail में महत्वपूर्ण ईमेल की निगरानी करें और Notion में कार्य सूची में सारांश पोस्ट करें", 11: "GitHub पर पुल अनुरोधों की समीक्षा करें, कोड समीक्षा टिप्पणियाँ पोस्ट करें, और Linear में अनुवर्ती कार्य बनाएं", 16: "मुझे अधिक उत्पादक बनने में मदद करें", 18: "प्रोजेक्ट टैग वाले सभी नए Notion पेजों को दैनिक सारांश में लॉग करें", 17: "एक एजेंट बनाएं जो Gmail में क्लाइंट चालान की निगरानी करे, Airtable में राशि निकाले, Asana में अतिदेय भुगतानों के लिए अनुवर्ती कार्य बनाए, और Google Calendar में रिमाइंडर मीटिंग शेड्यूल करे", 20: "एक पूरी तरह से स्वचालित एजेंट बनाएं जिसे हर कार्रवाई के लिए मैनुअल अनुमोदन की आवश्यकता हो"},
    "ru": {1: "Отслеживай важные письма в Gmail и публикуй сводки в список задач в Notion", 11: "Проверяй пул-реквесты на GitHub, оставляй комментарии по коду и создавай задачи в Linear", 16: "Помоги мне стать продуктивнее", 18: "Записывай все новые страницы Notion с тегом проекта в ежедневную сводку", 17: "Создай агента который мониторит Gmail на счета клиентов, извлекает суммы в Airtable, создаёт задачи в Asana для просроченных платежей и планирует напоминания в Google Calendar", 20: "Создай полностью автоматизированного агента который требует ручного одобрения каждого действия"},
    "id": {1: "Pantau Gmail saya untuk email penting dan posting ringkasan ke daftar tugas di Notion", 11: "Tinjau pull request di GitHub, posting komentar review kode, dan buat tugas tindak lanjut di Linear", 16: "Bantu saya menjadi lebih produktif", 18: "Catat semua halaman Notion baru dengan tag proyek ke ringkasan harian", 17: "Buatkan agen yang memantau Gmail untuk faktur klien, mengekstrak jumlah ke Airtable, membuat tugas tindak lanjut di Asana untuk pembayaran terlambat, dan menjadwalkan rapat pengingat di Google Calendar", 20: "Buatkan agen yang sepenuhnya otomatis yang memerlukan persetujuan manual untuk setiap tindakan"},
    "es": {1: "Monitorea mi Gmail para correos importantes y publica resúmenes en una lista de tareas en Notion", 11: "Revisa pull requests en GitHub, publica comentarios de revisión de código y crea tareas de seguimiento en Linear", 16: "Ayúdame a ser más productivo", 18: "Registra todas las páginas nuevas de Notion con etiqueta de proyecto en un resumen diario", 17: "Crea un agente que monitoree Gmail para facturas de clientes, extraiga montos a Airtable, cree tareas de seguimiento en Asana para pagos vencidos y programe reuniones recordatorio en Google Calendar", 20: "Crea un agente completamente automatizado que requiera aprobación manual para cada acción"},
    "fr": {1: "Surveille mon Gmail pour les e-mails importants et publie des résumés dans une liste de tâches sur Notion", 11: "Révise les pull requests sur GitHub, publie des commentaires de revue de code et crée des tâches de suivi dans Linear", 16: "Aide-moi à être plus productif", 18: "Enregistre toutes les nouvelles pages Notion avec un tag projet dans un résumé quotidien", 17: "Crée un agent qui surveille Gmail pour les factures clients, extrait les montants vers Airtable, crée des tâches de suivi dans Asana pour les paiements en retard et planifie des réunions de rappel dans Google Calendar", 20: "Crée un agent entièrement automatisé qui nécessite une approbation manuelle pour chaque action"},
    "bn": {1: "আমার Gmail-এ গুরুত্বপূর্ণ ইমেলগুলি পর্যবেক্ষণ করুন এবং Notion-এ টাস্ক তালিকায় সারাংশ পোস্ট করুন", 11: "GitHub-এ পুল রিকোয়েস্ট পর্যালোচনা করুন, কোড রিভিউ মন্তব্য পোস্ট করুন এবং Linear-এ ফলো-আপ কাজ তৈরি করুন", 16: "আমাকে আরও উৎপাদনশীল হতে সাহায্য করুন", 18: "প্রকল্প ট্যাগ সহ সমস্ত নতুন Notion পৃষ্ঠা দৈনিক সারাংশে লগ করুন", 17: "একটি এজেন্ট তৈরি করুন যা Gmail-এ ক্লায়েন্ট চালান পর্যবেক্ষণ করবে, Airtable-এ পরিমাণ বের করবে, Asana-তে বকেয়া পেমেন্টের জন্য ফলো-আপ কাজ তৈরি করবে এবং Google Calendar-এ রিমাইন্ডার মিটিং শিডিউল করবে", 20: "একটি সম্পূর্ণ স্বয়ংক্রিয় এজেন্ট তৈরি করুন যার প্রতিটি কাজের জন্য ম্যানুয়াল অনুমোদন প্রয়োজন"},
    "ja": {1: "Gmailの重要なメールを監視して、Notionのタスクリストにサマリーを投稿して", 11: "GitHubのプルリクエストをレビューして、コードレビューコメントを投稿し、Linearにフォローアップタスクを作成して", 16: "もっと生産的になれるよう手伝って", 18: "プロジェクトタグが付いたすべての新しいNotionページを毎日のサマリーに記録して", 17: "Gmailでクライアントの請求書を監視し、Airtableに金額を抽出し、Asanaで延滞支払いのフォローアップタスクを作成し、Googleカレンダーでリマインダーミーティングをスケジュールするエージェントを作って", 20: "すべてのアクションに手動承認が必要な完全自動化エージェントを作って"},
    "vi": {1: "Theo dõi Gmail của tôi để tìm email quan trọng và đăng tóm tắt vào danh sách công việc trên Notion", 11: "Xem xét pull request trên GitHub, đăng nhận xét đánh giá mã và tạo công việc theo dõi trong Linear", 16: "Giúp tôi làm việc năng suất hơn", 18: "Ghi lại tất cả các trang Notion mới có thẻ dự án vào bản tóm tắt hàng ngày", 17: "Xây dựng một agent giám sát Gmail để tìm hóa đơn khách hàng, trích xuất số tiền vào Airtable, tạo công việc theo dõi trong Asana cho các khoản thanh toán quá hạn và lên lịch cuộc họp nhắc nhở trong Google Calendar", 20: "Xây dựng một agent hoàn toàn tự động nhưng yêu cầu phê duyệt thủ công cho mọi hành động"},
    "de": {1: "Überwache mein Gmail auf wichtige E-Mails und poste Zusammenfassungen in eine Aufgabenliste in Notion", 11: "Überprüfe Pull Requests auf GitHub, poste Code-Review-Kommentare und erstelle Follow-up-Aufgaben in Linear", 16: "Hilf mir produktiver zu sein", 18: "Protokolliere alle neuen Notion-Seiten mit einem Projekt-Tag in einer täglichen Zusammenfassung", 17: "Erstelle einen Agenten der Gmail auf Kundenrechnungen überwacht, Beträge in Airtable extrahiert, Follow-up-Aufgaben in Asana für überfällige Zahlungen erstellt und Erinnerungstermine in Google Calendar plant", 20: "Erstelle einen vollständig automatisierten Agenten der für jede Aktion eine manuelle Genehmigung erfordert"},
    "ko": {1: "Gmail에서 중요한 이메일을 모니터링하고 Notion의 작업 목록에 요약을 게시해줘", 11: "GitHub에서 풀 리퀘스트를 검토하고, 코드 리뷰 댓글을 달고, Linear에 후속 작업을 만들어줘", 16: "더 생산적이 되도록 도와줘", 18: "프로젝트 태그가 있는 모든 새 Notion 페이지를 일일 요약에 기록해줘", 17: "Gmail에서 고객 청구서를 모니터링하고 Airtable에 금액을 추출하고 Asana에서 연체 결제에 대한 후속 작업을 만들고 Google Calendar에서 알림 회의를 예약하는 에이전트를 만들어줘", 20: "모든 작업에 수동 승인이 필요한 완전 자동화 에이전트를 만들어줘"},
    "cs": {1: "Sleduj můj Gmail kvůli důležitým emailům a zveřejňuj souhrny v seznamu úkolů v Notion", 11: "Kontroluj pull requesty na GitHubu, přidávej komentáře ke code review a vytváření následných úkolů v Linear", 16: "Pomoz mi být produktivnější", 18: "Zaznamenej všechny nové stránky Notion s projektovým štítkem do denního souhrnu", 17: "Vytvoř agenta který monitoruje Gmail pro faktury klientů, extrahuje částky do Airtable, vytváří následné úkoly v Asana pro zpožděné platby a plánuje připomínkové schůzky v Google Calendar", 20: "Vytvoř plně automatizovaného agenta který vyžaduje manuální schválení pro každou akci"},
}

MAX_BUILD_TIME = 300
POLL_INTERVAL = 5


def reset_state():
    try:
        state = c.get("/state").json()
        for p in state.get("personas", []):
            c.post("/delete-agent", json={"name_or_id": p["id"]})
        c.post("/eval", json={"js": 'import("@/stores/agentStore").then(m=>m.useAgentStore.getState().resetBuildSession())'})
        time.sleep(0.5)
    except Exception:
        pass


def set_language(lang_code):
    c.post("/eval", json={
        "js": f'import("@/stores/i18nStore").then(m=>m.useI18nStore.getState().setLanguage("{lang_code}"))'
    })
    time.sleep(0.2)


def get_intent(lang_code, scenario_id):
    """Get translated intent for a language+scenario combo."""
    if lang_code == "en":
        return SCENARIOS[scenario_id]["intent"]
    translations = TRANSLATED_INTENTS.get(lang_code, {})
    if scenario_id in translations:
        return translations[scenario_id]
    # Fallback: use English
    return SCENARIOS[scenario_id]["intent"]


def run_build(lang_code, lang_name, scenario_id, scenario_name, intent):
    """Run a single build and return result dict."""
    tag = f"{lang_code}:S{scenario_id}"
    r = {
        "tag": tag, "lang": lang_code, "lang_name": lang_name,
        "scenario_id": scenario_id, "scenario_name": scenario_name,
        "status": "UNKNOWN", "cells": 0, "turns": 0, "time_s": 0,
        "agent_name": None, "persona_id": None, "errors": [],
        "dimension_lang_ok": None,
    }

    try:
        reset_state()
        set_language(lang_code)

        c.post("/navigate", json={"section": "personas"})
        time.sleep(0.3)
        c.post("/start-create-agent", json={})
        time.sleep(0.5)
        wait_r = c.post("/wait", json={"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 5000}).json()
        if not wait_r.get("success"):
            r["status"] = "FAIL"
            r["errors"].append("Intent input not found")
            return r

        c.post("/fill-field", json={"test_id": "agent-intent-input", "value": intent})
        c.post("/click-testid", json={"test_id": "agent-launch-btn"})

        start = time.time()
        turn = 0

        while time.time() - start < MAX_BUILD_TIME:
            time.sleep(POLL_INTERVAL)

            try:
                state = c.get("/state").json()
            except Exception as ex:
                r["status"] = "ERROR"
                r["errors"].append(f"Server unreachable: {ex}")
                return r

            phase = state.get("buildPhase", "")
            cells = state.get("buildCellStates", {})
            resolved = sum(1 for v in cells.values() if v in ("resolved", "updated"))
            highlighted = [k for k, v in cells.items() if v == "highlighted"]

            if phase == "failed":
                error = state.get("buildError", "Unknown")
                r["status"] = "FAIL"
                r["errors"].append(error)
                # Check for credential issues
                if "credential" in error.lower() or "auth" in error.lower() or "api key" in error.lower():
                    r["status"] = "CRED_MISSING"
                break

            if phase == "draft_ready":
                r["cells"] = resolved
                r["turns"] = turn + 1
                r["time_s"] = time.time() - start
                personas = state.get("personas", [])
                if personas:
                    r["agent_name"] = personas[-1]["name"]
                    r["persona_id"] = personas[-1]["id"]
                r["status"] = "PASS"
                break

            if phase == "awaiting_input" and highlighted:
                try:
                    c.post("/answer-question", json={"cell_key": highlighted[0], "option_index": 0})
                except Exception:
                    pass
                turn += 1
                continue

            if phase == "awaiting_input" and not highlighted:
                try:
                    c.post("/click-testid", json={"test_id": "continue-build-btn"})
                except Exception:
                    c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Continue Build"))b.click()})'})
                turn += 1
        else:
            r["status"] = "TIMEOUT"
            r["errors"].append(f"Exceeded {MAX_BUILD_TIME}s")
            r["time_s"] = MAX_BUILD_TIME

    except Exception as e:
        r["status"] = "ERROR"
        r["errors"].append(str(e))

    return r


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="Run all 10 scenarios (not just 5)")
    parser.add_argument("--lang", type=str, help="Comma-separated language codes (default: all 14)")
    parser.add_argument("--scenario", type=str, help="Comma-separated scenario IDs")
    args = parser.parse_args()

    try:
        h = c.get("/health").json()
        print(f"Server: {h.get('server')} v{h.get('version')}")
    except Exception:
        print("ERROR: Cannot connect to test server on port 17320")
        sys.exit(1)

    # Determine languages
    if args.lang:
        lang_codes = args.lang.split(",")
    else:
        lang_codes = list(LANGUAGES.keys())

    # Determine scenarios
    if args.scenario:
        scenario_ids = [int(x) for x in args.scenario.split(",")]
    elif args.full:
        scenario_ids = sorted(SCENARIOS.keys())
    else:
        scenario_ids = QUICK_SCENARIOS

    total = len(lang_codes) * len(scenario_ids)
    print(f"\nRegression: {len(lang_codes)} languages × {len(scenario_ids)} scenarios = {total} builds")
    print(f"Estimated time: ~{total * 55 // 60} minutes\n")

    results = []
    completed = 0

    for lang_code in lang_codes:
        lang_info = LANGUAGES.get(lang_code)
        if not lang_info:
            print(f"Unknown language: {lang_code}")
            continue

        lang_name = lang_info["name"]
        print(f"=== {lang_name} ({lang_code}) ===")

        for sid in scenario_ids:
            if sid not in SCENARIOS:
                continue
            sname = SCENARIOS[sid]["name"]
            intent = get_intent(lang_code, sid)
            completed += 1

            sys.stdout.write(f"  [{completed}/{total}] S{sid:2d} {sname:<24s} ... ")
            sys.stdout.flush()

            r = run_build(lang_code, lang_name, sid, sname, intent)

            status_icon = {"PASS": "+", "FAIL": "!", "TIMEOUT": "~", "ERROR": "X", "CRED_MISSING": "$"}.get(r["status"], "?")
            name_display = (r["agent_name"] or "?")[:25]
            print(f"[{status_icon}] {r['status']:<7s} {r['cells']}/8 {r['time_s']:.0f}s \"{name_display}\"")

            if r["errors"]:
                print(f"         errors: {r['errors']}")

            results.append(r)

            # Stop on credential issues
            if r["status"] == "CRED_MISSING":
                print(f"\n*** STOPPING: Credential missing for {r['tag']}. Please provide credentials and re-run. ***")
                print_summary(results, total)
                sys.exit(2)

        print()

    # Reset to English
    set_language("en")

    print_summary(results, total)

    fails = sum(1 for r in results if r["status"] not in ("PASS",))
    sys.exit(0 if fails == 0 else 1)


def print_summary(results, total):
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    timeout = sum(1 for r in results if r["status"] == "TIMEOUT")
    errors = sum(1 for r in results if r["status"] == "ERROR")
    cred = sum(1 for r in results if r["status"] == "CRED_MISSING")

    print("=" * 70)
    print(f"RESULTS: {passed} passed, {failed} failed, {timeout} timeout, {errors} error, {cred} cred_missing out of {len(results)}/{total}")
    print("=" * 70)

    times = [r["time_s"] for r in results if r["status"] == "PASS"]
    if times:
        print(f"Timing: avg={sum(times)/len(times):.0f}s min={min(times):.0f}s max={max(times):.0f}s total={sum(times)/60:.0f}m")

    # Per-language breakdown
    print(f"\nPer-language results:")
    for lang_code in dict.fromkeys(r["lang"] for r in results):
        lang_results = [r for r in results if r["lang"] == lang_code]
        lang_pass = sum(1 for r in lang_results if r["status"] == "PASS")
        lang_name = lang_results[0]["lang_name"]
        print(f"  {lang_code} {lang_name:<12s}: {lang_pass}/{len(lang_results)} passed")

    # Per-scenario breakdown
    print(f"\nPer-scenario results:")
    for sid in dict.fromkeys(r["scenario_id"] for r in results):
        s_results = [r for r in results if r["scenario_id"] == sid]
        s_pass = sum(1 for r in s_results if r["status"] == "PASS")
        s_name = s_results[0]["scenario_name"]
        print(f"  S{sid:2d} {s_name:<24s}: {s_pass}/{len(s_results)} passed")

    # Failed builds detail
    fails = [r for r in results if r["status"] != "PASS"]
    if fails:
        print(f"\nFailed builds:")
        for r in fails:
            print(f"  {r['tag']}: {r['status']} - {r['errors']}")

    reset_state()


if __name__ == "__main__":
    main()
