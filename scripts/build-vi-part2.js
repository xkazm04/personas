// Part 2: agents.editor_chrome through agents.editor_ui + vault sections
const fs = require('fs');
const existing = JSON.parse(fs.readFileSync('C:/Users/kazda/kiro/personas/.planning/i18n/translated-vi.json', 'utf8'));
const vi = existing;

// agents.editor_chrome
vi["agents.editor_chrome.health_label"] = "Sức khỏe";
vi["agents.editor_chrome.latency_label"] = "Độ trễ";
vi["agents.editor_chrome.cost_run_label"] = "Chi phí/lần";
vi["agents.editor_chrome.last_run_label"] = "Lần chạy cuối";
vi["agents.editor_chrome.rank"] = "Hạng";

// agents.model_config
vi["agents.model_config.model_provider"] = "Mô hình & Nhà cung cấp";
vi["agents.model_config.unsaved_changes"] = "Thay đổi chưa lưu";
vi["agents.model_config.max_budget"] = "Ngân sách tối đa (USD)";
vi["agents.model_config.max_turns"] = "Số vòng tối đa";
vi["agents.model_config.prompt_caching"] = "Lưu bộ nhớ đệm lời nhắc";
vi["agents.model_config.cache_off"] = "Tắt";
vi["agents.model_config.cache_off_desc"] = "Không lưu đệm";
vi["agents.model_config.cache_short"] = "5 phút";
vi["agents.model_config.cache_short_desc"] = "Lưu ngắn hạn";
vi["agents.model_config.cache_long"] = "1 giờ";
vi["agents.model_config.cache_long_desc"] = "Lưu dài hạn";
vi["agents.model_config.provider_label"] = "Nhà cung cấp";
vi["agents.model_config.model_name"] = "Tên mô hình";
vi["agents.model_config.base_url"] = "URL gốc";
vi["agents.model_config.auth_token"] = "Token xác thực";
vi["agents.model_config.effective_config"] = "Cấu hình hiệu lực";
vi["agents.model_config.inherited"] = "{count} kế thừa";
vi["agents.model_config.overridden"] = "{count} ghi đè";
vi["agents.model_config.source_agent"] = "Tác nhân";
vi["agents.model_config.source_workspace"] = "Không gian làm việc";
vi["agents.model_config.source_global"] = "Toàn cục";
vi["agents.model_config.source_default"] = "Mặc định";
vi["agents.model_config.tooltip_workspace"] = "Kế thừa từ không gian làm việc \"{name}\"";
vi["agents.model_config.tooltip_global"] = "Kế thừa từ mặc định toàn cục";
vi["agents.model_config.tooltip_agent_override"] = "Ghi đè mặc định không gian/toàn cục";
vi["agents.model_config.tooltip_agent_set"] = "Đặt trên tác nhân này";
vi["agents.model_config.tooltip_no_value"] = "Chưa cấu hình giá trị";
vi["agents.model_config.tooltip_default"] = "Chưa cấu hình giá trị";
vi["agents.model_config.tooltip_overriding"] = "Đang ghi đè giá trị kế thừa";
vi["agents.model_config.saved"] = "Đã lưu";
vi["agents.model_config.workspace_prefix"] = "Không gian: {label}";
vi["agents.model_config.field_model"] = "Mô hình";
vi["agents.model_config.field_provider"] = "Nhà cung cấp";
vi["agents.model_config.field_base_url"] = "URL gốc";
vi["agents.model_config.field_auth_token"] = "Token xác thực";
vi["agents.model_config.field_max_budget"] = "Ngân sách tối đa";
vi["agents.model_config.field_max_turns"] = "Số vòng tối đa";
vi["agents.model_config.field_prompt_cache"] = "Bộ đệm lời nhắc";
vi["agents.model_config.model_and_provider"] = "Mô hình & Nhà cung cấp";
vi["agents.model_config.max_budget_label"] = "Ngân sách tối đa (USD)";
vi["agents.model_config.max_budget_hint"] = "Tổng chi tiêu tối đa cho một lần thực thi. Lần chạy sẽ dừng khi đạt giới hạn.";
vi["agents.model_config.max_budget_range"] = "Từ $0.01 trở lên, hoặc để trống không giới hạn";
vi["agents.model_config.max_budget_example"] = "0.50";
vi["agents.model_config.max_budget_placeholder"] = "Ngân sách tháng tính USD -- ví dụ 25.00";
vi["agents.model_config.max_turns_label"] = "Số vòng tối đa";
vi["agents.model_config.max_turns_hint"] = "Số vòng tương tác LLM tối đa mỗi lần thực thi. Mỗi vòng là một chu kỳ prompt-response với công cụ.";
vi["agents.model_config.max_turns_range"] = "Từ 1 trở lên, hoặc để trống không giới hạn";
vi["agents.model_config.max_turns_example"] = "5";
vi["agents.model_config.max_turns_placeholder"] = "Số vòng tối đa -- ví dụ 5";
vi["agents.model_config.prompt_caching_hint"] = "Lưu lời nhắc hệ thống qua các lần thực thi để giảm chi phí token đầu vào.";
vi["agents.model_config.prompt_caching_range"] = "Tắt, 5 phút, hoặc 1 giờ";
vi["agents.model_config.prompt_caching_example"] = "5 phút cho tác nhân kích hoạt cron";
vi["agents.model_config.provider"] = "Nhà cung cấp";
vi["agents.model_config.provider_anthropic"] = "Anthropic";
vi["agents.model_config.provider_ollama"] = "Ollama (cục bộ)";
vi["agents.model_config.provider_litellm"] = "LiteLLM (proxy)";
vi["agents.model_config.provider_custom"] = "URL tùy chỉnh";
vi["agents.model_config.model_name_placeholder_litellm"] = "ví dụ anthropic/claude-sonnet-4-20250514";
vi["agents.model_config.model_name_placeholder_ollama"] = "ví dụ llama3.1:8b";
vi["agents.model_config.model_name_placeholder_custom"] = "Định danh mô hình";
vi["agents.model_config.base_url_hint"] = "Điểm cuối API cho nhà cung cấp mô hình. Phải bao gồm giao thức (http/https) và cổng nếu không chuẩn.";
vi["agents.model_config.base_url_example"] = "http://localhost:11434";
vi["agents.model_config.auth_token_hint"] = "Token xác thực cho API nhà cung cấp. Với Ollama cục bộ, dùng 'ollama'. Với LiteLLM, dùng khóa master.";
vi["agents.model_config.auth_token_example"] = "sk-...";
vi["agents.model_config.auth_token_placeholder_litellm"] = "LiteLLM master key (sk-...)";
vi["agents.model_config.auth_token_placeholder_ollama"] = "ollama";
vi["agents.model_config.auth_token_placeholder_custom"] = "Bearer token";
vi["agents.model_config.litellm_label"] = "Cài đặt LiteLLM Proxy";
vi["agents.model_config.litellm_sublabel"] = "(toàn cục, dùng chung cho tất cả tác nhân)";
vi["agents.model_config.litellm_base_url_placeholder"] = "URL gốc Proxy (http://localhost:4000)";
vi["agents.model_config.litellm_master_key_placeholder"] = "Master Key (sk-...)";
vi["agents.model_config.litellm_save_label"] = "Lưu cấu hình toàn cục";
vi["agents.model_config.litellm_description"] = "Các cài đặt toàn cục này là mặc định cho tất cả tác nhân dùng LiteLLM. Ghi đè mỗi tác nhân ở trên có độ ưu tiên cao hơn.";
vi["agents.model_config.ollama_label"] = "Khóa API Ollama";
vi["agents.model_config.ollama_sublabel"] = "(toàn cục, dùng chung cho tất cả tác nhân)";
vi["agents.model_config.ollama_placeholder"] = "Dán khóa từ ollama.com/settings";
vi["agents.model_config.ollama_save_label"] = "Lưu khóa";
vi["agents.model_config.ollama_signup"] = "Đăng ký miễn phí tại";
vi["agents.model_config.ollama_copy_key"] = "và sao chép khóa API từ Cài đặt.";
vi["agents.model_config.compare_models"] = "So sánh mô hình";
vi["agents.model_config.side_by_side"] = "Song song";
vi["agents.model_config.model_a"] = "Mô hình A";
vi["agents.model_config.model_b"] = "Mô hình B";
vi["agents.model_config.add_prompt_first"] = "Thêm lời nhắc trước khi chạy so sánh.";
vi["agents.model_config.select_different_models"] = "Chọn hai mô hình khác nhau để so sánh.";
vi["agents.model_config.run_comparison"] = "Chạy so sánh";
vi["agents.model_config.generating_scenarios"] = "Đang tạo tình huống...";
vi["agents.model_config.testing_model"] = "Đang kiểm tra {modelId}";
vi["agents.model_config.running"] = "Đang chạy...";
vi["agents.model_config.tokens_in"] = "Token vào";
vi["agents.model_config.tokens_out"] = "Token ra";
vi["agents.model_config.wins"] = "thắng";
vi["agents.model_config.composite"] = "tổng hợp";
vi["agents.model_config.quality"] = "Chất lượng";
vi["agents.model_config.tool_accuracy"] = "Độ chính xác công cụ";
vi["agents.model_config.protocol"] = "Giao thức";
vi["agents.model_config.scenario"] = "Tình huống";
vi["agents.model_config.latency"] = "Độ trễ";
vi["agents.model_config.cost"] = "Chi phí";
vi["agents.model_config.output_previews"] = "Xem trước đầu ra";
vi["agents.model_config.no_output"] = "Không có đầu ra";

// agents.use_cases
vi["agents.use_cases.no_persona"] = "Chưa chọn tác nhân";
vi["agents.use_cases.identified"] = "{count} trường hợp sử dụng được xác định";
vi["agents.use_cases.default_model"] = "Mô hình mặc định tác nhân";
vi["agents.use_cases.inherit_hint"] = "Tất cả trường hợp sử dụng kế thừa mô hình này trừ khi ghi đè bên dưới.";
vi["agents.use_cases.test"] = "Kiểm tra";
vi["agents.use_cases.run_with"] = "Chạy với {model}";
vi["agents.use_cases.fixture_inputs"] = "Đầu vào fixture:";
vi["agents.use_cases.test_use_case"] = "Kiểm tra trường hợp sử dụng";
vi["agents.use_cases.view_history"] = "Xem lịch sử kiểm tra đầy đủ";
vi["agents.use_cases.testing_scenario"] = "Đang kiểm tra {name}...";
vi["agents.use_cases.active_triggers"] = "Trình kích hoạt đang hoạt động";
vi["agents.use_cases.active_subs"] = "Đăng ký đang hoạt động";
vi["agents.use_cases.general_history"] = "Lịch sử chung";
vi["agents.use_cases.unlinked_execs"] = "({count} lần thực thi chưa liên kết)";
vi["agents.use_cases.no_unlinked"] = "Không tìm thấy lần thực thi chưa liên kết.";
vi["agents.use_cases.no_persona_selected"] = "Chưa chọn tác nhân";
vi["agents.use_cases.use_cases_identified"] = "{count} trường hợp sử dụng được xác định";
vi["agents.use_cases.use_cases_identified_other"] = "{count} trường hợp sử dụng được xác định";
vi["agents.use_cases.persona_default_model"] = "Mô hình mặc định tác nhân";
vi["agents.use_cases.cache_5m"] = "Bộ đệm 5 phút";
vi["agents.use_cases.cache_1h"] = "Bộ đệm 1 giờ";
vi["agents.use_cases.custom_model"] = "Mô hình tùy chỉnh";
vi["agents.use_cases.notifications_configured"] = "Đã cấu hình thông báo";
vi["agents.use_cases.unlinked_executions"] = "({count} lần thực thi chưa liên kết)";
vi["agents.use_cases.unlinked_executions_other"] = "({count} lần thực thi chưa liên kết)";
vi["agents.use_cases.no_unlinked_executions"] = "Không tìm thấy lần thực thi chưa liên kết.";
vi["agents.use_cases.waiting_for_test"] = "Đang chờ bắt đầu kiểm tra...";
vi["agents.use_cases.cancel_test"] = "Hủy kiểm tra";
vi["agents.use_cases.view_full_test_history"] = "Xem lịch sử kiểm tra đầy đủ";
vi["agents.use_cases.use_case_not_found"] = "Không tìm thấy trường hợp sử dụng.";
vi["agents.use_cases.stop"] = "Dừng";
vi["agents.use_cases.stop_test"] = "Dừng kiểm tra";
vi["agents.use_cases.no_prompt_configured"] = "Chưa cấu hình lời nhắc";
vi["agents.use_cases.test_this_use_case"] = "Kiểm tra trường hợp sử dụng này";
vi["agents.use_cases.tests"] = "Kiểm tra";
vi["agents.use_cases.view_full_test_history_title"] = "Xem lịch sử kiểm tra đầy đủ";
vi["agents.use_cases.stage_input"] = "Đầu vào";
vi["agents.use_cases.stage_transform"] = "Chuyển đổi";
vi["agents.use_cases.stage_output"] = "Đầu ra";
vi["agents.use_cases.generating"] = "Đang tạo...";
vi["agents.use_cases.testing"] = "Đang kiểm tra...";
vi["agents.use_cases.save_failed"] = "Lưu thất bại";
vi["agents.use_cases.no_inputs"] = "Không có đầu vào";
vi["agents.use_cases.override"] = "Ghi đè";
vi["agents.use_cases.inherited_label"] = "Kế thừa";
vi["agents.use_cases.persona_default"] = "Mặc định tác nhân";
vi["agents.use_cases.use_persona_default"] = "Dùng mặc định tác nhân";
vi["agents.use_cases.model"] = "Mô hình";
vi["agents.use_cases.default_label"] = "Mặc định";
vi["agents.use_cases.not_set"] = "Chưa đặt";
vi["agents.use_cases.confirm"] = "Xác nhận";
vi["agents.use_cases.update_fixture_title"] = "Cập nhật fixture với đầu vào hiện tại";
vi["agents.use_cases.delete_fixture_title"] = "Xóa fixture";
vi["agents.use_cases.fixture_name_placeholder"] = "ví dụ Luồng chính";
vi["agents.use_cases.description_optional"] = "Mô tả (tùy chọn)";
vi["agents.use_cases.save_current_as_fixture"] = "Lưu hiện tại làm fixture";
vi["agents.use_cases.no_fixture"] = "Không có fixture";
vi["agents.use_cases.select_test_fixture"] = "Chọn fixture kiểm tra";
vi["agents.use_cases.no_fixture_auto"] = "Không có fixture (tự động tạo)";
vi["agents.use_cases.active_subscriptions"] = "Đăng ký đang hoạt động";
vi["agents.use_cases.confirm_delete"] = "Xác nhận?";
vi["agents.use_cases.quick_pick"] = "Chọn nhanh";
vi["agents.use_cases.visual"] = "Trực quan";
vi["agents.use_cases.cron"] = "Cron";
vi["agents.use_cases.activating"] = "Đang kích hoạt...";
vi["agents.use_cases.activate_schedule"] = "Kích hoạt trình kích hoạt lịch";
vi["agents.use_cases.ai_suggestion"] = "Gợi ý AI:";
vi["agents.use_cases.days"] = "Ngày";
vi["agents.use_cases.all"] = "Tất cả";
vi["agents.use_cases.weekdays"] = "Ngày trong tuần";
vi["agents.use_cases.time"] = "Giờ";
vi["agents.use_cases.hour_click"] = "Giờ (nhấp để đặt)";
vi["agents.use_cases.cron_placeholder"] = "* * * * *  (phút giờ ngày tháng thứ)";
vi["agents.use_cases.next"] = "tiếp:";
vi["agents.use_cases.now"] = "ngay bây giờ";
vi["agents.use_cases.schedule_trigger"] = "Trình kích hoạt lịch";
vi["agents.use_cases.activate"] = "Kích hoạt";
vi["agents.use_cases.event_type"] = "Loại sự kiện";
vi["agents.use_cases.select_event_type"] = "Chọn loại sự kiện...";
vi["agents.use_cases.source_filter"] = "Bộ lọc nguồn";
vi["agents.use_cases.source_filter_optional"] = "(tùy chọn)";
vi["agents.use_cases.source_filter_placeholder"] = "ví dụ persona-id hoặc mẫu glob";
vi["agents.use_cases.add"] = "Thêm";
vi["agents.use_cases.event_subscriptions"] = "Đăng ký sự kiện";
vi["agents.use_cases.configured"] = "đã cấu hình";
vi["agents.use_cases.activate_db"] = "Kích hoạt như đăng ký qua DB";
vi["agents.use_cases.add_subscription"] = "Thêm đăng ký";
vi["agents.use_cases.select_channels_label"] = "Chọn kênh thông báo";
vi["agents.use_cases.cron_field_min"] = "phút";
vi["agents.use_cases.cron_field_hour"] = "giờ";
vi["agents.use_cases.cron_field_day"] = "ngày";
vi["agents.use_cases.cron_field_month"] = "tháng";
vi["agents.use_cases.cron_field_weekday"] = "thứ";

// agents.tools
vi["agents.tools.no_persona"] = "Chưa chọn tác nhân";
vi["agents.tools.search_placeholder"] = "Tìm kiếm công cụ...";
vi["agents.tools.category_view"] = "Xem theo danh mục";
vi["agents.tools.connector_view"] = "Xem theo trình kết nối";
vi["agents.tools.assigned_summary"] = "{assigned} trong {total} công cụ được gán";
vi["agents.tools.more"] = "+{count} nữa";
vi["agents.tools.clear_all"] = "Xóa tất cả";
vi["agents.tools.no_matching"] = "Không có công cụ nào khớp";
vi["agents.tools.clear_filter"] = "Xóa bộ lọc";
vi["agents.tools.no_assigned"] = "Chưa gán công cụ nào";
vi["agents.tools.browse_tools"] = "Duyệt công cụ có sẵn";
vi["agents.tools.no_available"] = "Không có công cụ nào";
vi["agents.tools.add_credential"] = "Thêm thông tin xác thực";
vi["agents.tools.requires_cred"] = "Cần thông tin xác thực {label} để kết nối";
vi["agents.tools.calls"] = "{count} lần gọi";
vi["agents.tools.impact_label"] = "Tác động";
vi["agents.tools.removed"] = "Đã xóa {name}";
vi["agents.tools.undo"] = "Hoàn tác";
vi["agents.tools.general"] = "Chung";
vi["agents.tools.no_impact"] = "Không có dữ liệu tác động";
vi["agents.tools.uc_section"] = "Trường hợp sử dụng";
vi["agents.tools.runs"] = "{count} lần chạy";
vi["agents.tools.more_uc"] = "+{count} nữa";
vi["agents.tools.no_uc"] = "Chưa có trường hợp sử dụng nào chạy công cụ này";
vi["agents.tools.removing_affects"] = "Xóa công cụ này ảnh hưởng {count} trường hợp sử dụng";
vi["agents.tools.usage_30d"] = "Sử dụng (30 ngày)";
vi["agents.tools.stat_calls"] = "Lần gọi";
vi["agents.tools.stat_runs"] = "Lần chạy";
vi["agents.tools.stat_agents"] = "Tác nhân";
vi["agents.tools.no_usage"] = "Chưa ghi nhận sử dụng";
vi["agents.tools.cost_impact"] = "Tác động chi phí";
vi["agents.tools.per_call"] = "Mỗi lần gọi:";
vi["agents.tools.total_cost"] = "Tổng:";
vi["agents.tools.credential"] = "Thông tin xác thực";
vi["agents.tools.linked"] = "-- đã liên kết";
vi["agents.tools.cred_missing"] = "-- thiếu";
vi["agents.tools.often_used"] = "Thường dùng cùng với";

// agents.chat_thread
vi["agents.chat_thread.welcome"] = "Cho tôi biết bạn muốn tác nhân này làm gì. Tôi sẽ xây dựng cấu hình đầy đủ -- lời nhắc, công cụ, trình kích hoạt -- từ mô tả của bạn.";
vi["agents.chat_thread.welcome_example"] = "Theo dõi PR GitHub của tôi và đăng tóm tắt lên Slack mỗi sáng";

// agents.assign
vi["agents.assign.assign_to"] = "Gán cho {role}";
vi["agents.assign.saved_credentials"] = "Thông tin xác thực đã lưu ({count})";
vi["agents.assign.all_connectors"] = "Tất cả trình kết nối ({count})";
vi["agents.assign.search_credentials"] = "Tìm thông tin xác thực...";
vi["agents.assign.search_connectors"] = "Tìm trình kết nối...";
vi["agents.assign.no_saved_credentials"] = "Chưa có thông tin xác thực nào";
vi["agents.assign.no_credentials_match"] = "Không có thông tin xác thực nào khớp";
vi["agents.assign.vault_hint"] = "Lưu thông tin xác thực trong Kho, hoặc dùng tab Trình kết nối";
vi["agents.assign.no_connectors_match"] = "Không có trình kết nối nào khớp";
vi["agents.credential_coverage"] = "{matched}/{total} thông tin xác thực";
vi["agents.role_card.no_credential"] = "Không có thông tin xác thực";
vi["agents.role_card.edit_tables"] = "sửa";
vi["agents.role_card.select_tables"] = "chọn bảng";
vi["agents.role_card.assign"] = "Gán";

// agents.channel_picker
vi["agents.channel_picker.in_app_messaging"] = "Nhắn tin trong ứng dụng";
vi["agents.channel_picker.vault_hint"] = "Lưu thông tin xác thực giao tiếp (Slack, Email, v.v.) trong Kho để thấy ở đây.";

// agents.connector_picker
vi["agents.connector_picker.no_connectors"] = "Không có trình kết nối nào";
vi["agents.connector_picker.search"] = "Tìm trình kết nối...";
vi["agents.connector_picker.no_match"] = "Không có trình kết nối nào khớp \"{search}\"";

// agents.policy_picker
vi["agents.policy_picker.error_handling"] = "Xử lý lỗi";
vi["agents.policy_picker.manual_review"] = "Xem xét thủ công";

// agents.table_selector
vi["agents.table_selector.title"] = "Chọn bảng";
vi["agents.table_selector.subtitle"] = "{label} -- chọn bảng để theo dõi";
vi["agents.table_selector.tables_selected_one"] = "{count} bảng được chọn";
vi["agents.table_selector.tables_selected_other"] = "{count} bảng được chọn";
vi["agents.table_selector.no_tables_selected"] = "Không chọn bảng nào -- tác nhân theo dõi tất cả";

// agents.trigger_popover
vi["agents.trigger_popover.trigger"] = "Trình kích hoạt";
vi["agents.trigger_popover.clear_override"] = "Xóa ghi đè";

// agents.use_case
vi["agents.use_case.add"] = "Thêm trường hợp sử dụng";
vi["agents.use_case.title_placeholder"] = "Tiêu đề trường hợp sử dụng -- ví dụ: Xử lý yêu cầu hoàn tiền, Tóm tắt phiếu hàng ngày";
vi["agents.use_case.description_placeholder"] = "Mô tả các bước -- ví dụ: Khi nhận yêu cầu hoàn tiền, xác minh đơn hàng, kiểm tra chính sách và gửi chấp thuận hoặc từ chối";

// agents.builder_action
vi["agents.builder_action.processing"] = "Đang xử lý...";
vi["agents.builder_action.error_retry"] = "Có lỗi xảy ra. Vui lòng thử lại.";
vi["agents.builder_action.enhancing"] = "Đang cải tiến...";
vi["agents.builder_action.enhance_with_ai"] = "Cải tiến với AI";
vi["agents.builder_action.describe_agent"] = "Mô tả tác nhân của bạn nên làm gì";

// agents.builder_preview
vi["agents.builder_preview.title"] = "Xem trước";
vi["agents.builder_preview.start_building"] = "Bắt đầu xây dựng để xem trước";
vi["agents.builder_preview.intent"] = "Ý định";
vi["agents.builder_preview.use_cases"] = "Trường hợp sử dụng";
vi["agents.builder_preview.none_yet"] = "Chưa có";
vi["agents.builder_preview.components"] = "Thành phần";
vi["agents.builder_preview.none"] = "Không có";
vi["agents.builder_preview.credentials_covered"] = "Thông tin xác thực: {matched}/{total} đã bao phủ";
vi["agents.builder_preview.schedule"] = "Lịch";
vi["agents.builder_preview.manual_only"] = "Chỉ thủ công";
vi["agents.builder_preview.errors"] = "Lỗi";
vi["agents.builder_preview.review"] = "Xem xét";

// agents.dry_run
vi["agents.dry_run.ready"] = "Sẵn sàng";
vi["agents.dry_run.blocked"] = "Bị chặn";
vi["agents.dry_run.partial"] = "Một phần";
vi["agents.dry_run.issues_remaining_one"] = "{count} vấn đề còn lại";
vi["agents.dry_run.issues_remaining_other"] = "{count} vấn đề còn lại";
vi["agents.dry_run.capabilities"] = "Khả năng";
vi["agents.dry_run.issues"] = "Vấn đề";
vi["agents.dry_run.apply_fix"] = "Áp dụng sửa lỗi: {label}";
vi["agents.dry_run.manual_action_needed"] = "Cần hành động thủ công";
vi["agents.dry_run.no_issues"] = "Không phát hiện vấn đề. Cấu hình tác nhân trông ổn.";

// agents.identity_preview
vi["agents.identity_preview.title"] = "Xem trước";
vi["agents.identity_preview.agent_name_placeholder"] = "Tên tác nhân";
vi["agents.identity_preview.description_placeholder"] = "Mô tả";
vi["agents.identity_preview.use_cases"] = "Trường hợp sử dụng";
vi["agents.identity_preview.more"] = "+{count} nữa";
vi["agents.identity_preview.components"] = "Thành phần";
vi["agents.identity_preview.schedule_label"] = "Lịch:";
vi["agents.identity_preview.errors_label"] = "Lỗi:";
vi["agents.identity_preview.review_label"] = "Xem xét:";

// agents.build_review
vi["agents.build_review.agent_name"] = "Tên tác nhân";
vi["agents.build_review.all_dimensions"] = "Tất cả 8 chiều";
vi["agents.build_review.prompt_generated"] = "Đã tạo lời nhắc";
vi["agents.build_review.connectors_ready"] = "Trình kết nối sẵn sàng";
vi["agents.build_review.promote_agent"] = "Đề bạt tác nhân";
vi["agents.build_review.testing"] = "Đang kiểm tra...";
vi["agents.build_review.test_agent"] = "Kiểm tra tác nhân";

// agents.connectors_cell
vi["agents.connectors_cell.add_in_keys"] = "Thêm trong Khóa";
vi["agents.connectors_cell.linked"] = "Đã liên kết";
vi["agents.connectors_cell.link"] = "Liên kết";
vi["agents.connectors_cell.no_credential_found"] = "Không tìm thấy thông tin xác thực {name}. Thêm một cái trong Khóa để tiếp tục.";
vi["agents.connectors_cell.swap_to"] = "Hoán đổi sang:";
vi["agents.connectors_cell.recalculating"] = "Đang tính lại...";
vi["agents.connectors_cell.recalculate_dimensions"] = "Tính lại các chiều";
vi["agents.connectors_cell.rebuilding"] = "Đang xây dựng lại với trình kết nối mới...";

// agents.dimension_edit
vi["agents.dimension_edit.add_item"] = "Thêm mục...";
vi["agents.dimension_edit.add_connector"] = "Thêm trình kết nối...";
vi["agents.dimension_edit.add_trigger"] = "Thêm trình kích hoạt...";
vi["agents.dimension_edit.add_task"] = "Thêm nhiệm vụ...";
vi["agents.dimension_edit.add_channel"] = "Thêm kênh thông báo...";
vi["agents.dimension_edit.add_memory"] = "Thêm mục bộ nhớ...";
vi["agents.dimension_edit.add_error_strategy"] = "Thêm chiến lược lỗi...";
vi["agents.dimension_edit.add_review_rule"] = "Thêm quy tắc xem xét...";
vi["agents.dimension_edit.replace"] = "Thay thế";
vi["agents.dimension_edit.replace_connector"] = "Thay thế: {name}";
vi["agents.dimension_edit.pick_credential"] = "Chọn một thông tin xác thực đã kết nối";
vi["agents.dimension_edit.no_connected_credentials"] = "Chưa có thông tin xác thực nào được kết nối";
vi["agents.dimension_edit.add_credentials_hint"] = "Thêm thông tin xác thực trong module Khóa trước.";
vi["agents.dimension_edit.open_keys"] = "Mở Khóa";
vi["agents.dimension_edit.add_credential_in_keys"] = "Thêm thông tin xác thực trong Khóa";
vi["agents.dimension_edit.healthy"] = "khỏe mạnh";
vi["agents.dimension_edit.check_failed"] = "kiểm tra thất bại";
vi["agents.dimension_edit.not_tested"] = "chưa kiểm tra";
vi["agents.dimension_edit.credential_warning"] = "Một số trình kết nối cần thông tin xác thực khỏe mạnh trước khi hoàn thiện chiều này";
vi["agents.dimension_edit.approval_required"] = "Cần phê duyệt";
vi["agents.dimension_edit.fully_automated"] = "Tự động hoàn toàn";
vi["agents.dimension_edit.cron_label"] = "Cron:";
vi["agents.dimension_edit.every_label"] = "Mỗi:";
vi["agents.dimension_edit.done"] = "Xong";

// agents.quick_config
vi["agents.quick_config.title"] = "Cài đặt nhanh";
vi["agents.quick_config.start_conditions"] = "Điều kiện bắt đầu";
vi["agents.quick_config.apps_and_services"] = "Ứng dụng & Dịch vụ";
vi["agents.quick_config.time_schedule"] = "Lịch thời gian";
vi["agents.quick_config.event_triggers"] = "Trình kích hoạt sự kiện";
vi["agents.quick_config.frequency"] = "Tần suất";
vi["agents.quick_config.daily"] = "Hàng ngày";
vi["agents.quick_config.weekly"] = "Hàng tuần";
vi["agents.quick_config.monthly"] = "Hàng tháng";
vi["agents.quick_config.days"] = "Ngày";
vi["agents.quick_config.day_of_month"] = "Ngày trong tháng";
vi["agents.quick_config.time"] = "Giờ";

// agents.events_panel
vi["agents.events_panel.source_agent"] = "Tác nhân nguồn";
vi["agents.events_panel.no_agents"] = "Không có tác nhân nào";
vi["agents.events_panel.events_from"] = "Sự kiện từ {name}";
vi["agents.events_panel.select_agent"] = "Chọn một tác nhân";
vi["agents.events_panel.loading_events"] = "Đang tải sự kiện...";
vi["agents.events_panel.no_subscriptions"] = "Không tìm thấy đăng ký sự kiện";
vi["agents.events_panel.choose_agent"] = "Chọn tác nhân để xem sự kiện";

// agents.matrix_cred_picker
vi["agents.matrix_cred_picker.no_stored"] = "Không có thông tin xác thực đã lưu";
vi["agents.matrix_cred_picker.best_match"] = "Phù hợp nhất";
vi["agents.matrix_cred_picker.other"] = "Khác";

// agents.services_panel
vi["agents.services_panel.no_connectors"] = "Không tìm thấy trình kết nối với khóa API khỏe mạnh. Thêm thông tin xác thực trong Kho trước.";
vi["agents.services_panel.select_table"] = "Chọn bảng";

// agents.spatial_question
vi["agents.spatial_question.agent_configuration"] = "Cấu hình tác nhân";
vi["agents.spatial_question.or_custom_answer"] = "Hoặc nhập câu trả lời tùy chỉnh";
vi["agents.spatial_question.type_answer"] = "Nhập câu trả lời...";
vi["agents.spatial_question.submit"] = "Gửi";
vi["agents.spatial_question.press_to_select"] = "Nhấn 1-{count} để chọn ngay";

// agents.table_picker
vi["agents.table_picker.title"] = "Chọn bảng";
vi["agents.table_picker.search"] = "Tìm bảng...";
vi["agents.table_picker.loading"] = "Đang tải bảng...";
vi["agents.table_picker.no_tables"] = "Không tìm thấy bảng nào cho trình kết nối này";
vi["agents.table_picker.clear_selection"] = "Xóa lựa chọn";
vi["agents.table_picker.no_match"] = "Không có bảng nào khớp \"{search}\"";

// agents.matrix_entry
vi["agents.matrix_entry.new_agent"] = "Tác nhân mới";
vi["agents.matrix_entry.failed_to_create"] = "Không thể tạo tác nhân nháp.";
vi["agents.matrix_entry.build_failed"] = "Xây dựng không khởi động được. Kiểm tra cấu hình CLI.";

// agents.workflow_upload
vi["agents.workflow_upload.build_hint"] = "Nhấn Xây dựng để chuyển đổi quy trình này thành tác nhân.";
vi["agents.workflow_upload.paste_placeholder"] = "Dán JSON quy trình của bạn vào đây...";
vi["agents.workflow_upload.parse"] = "Phân tích";
vi["agents.workflow_upload.drop_file"] = "Thả tệp quy trình vào đây";
vi["agents.workflow_upload.file_types"] = "n8n, Zapier, Make, hoặc GitHub Actions (.json, .yaml)";
vi["agents.workflow_upload.paste_json"] = "Hoặc dán JSON trực tiếp";

// agents.config_popup
vi["agents.config_popup.load_error"] = "Không thể tải giá trị đã lưu -- bạn có thể cần nhập lại.";
vi["agents.config_popup.fill_hint"] = "Điền ít nhất một trường để lưu";
vi["agents.config_popup.failed_to_save"] = "Không thể lưu cấu hình";

// agents.onboarding
vi["agents.onboarding.setup_complete"] = "Hoàn tất cài đặt {score}%";
vi["agents.onboarding.steps_done"] = "{completed}/{total} bước hoàn thành";
vi["agents.onboarding.dismiss_checklist"] = "Bỏ qua danh sách";

// agents.template_picker
vi["agents.template_picker.title"] = "Chọn mẫu";
vi["agents.template_picker.subtitle"] = "Chọn mẫu để điền sẵn tác nhân, hoặc bắt đầu từ đầu.";
vi["agents.template_picker.start_from_scratch"] = "Bắt đầu từ đầu";

// agents.persona_overview
vi["agents.persona_overview.no_match"] = "Không có tác nhân nào khớp";
vi["agents.persona_overview.no_connectors"] = "Không có trình kết nối";
vi["agents.persona_overview.never"] = "Chưa bao giờ";
vi["agents.persona_overview.description_copied"] = "Đã sao chép mô tả vào clipboard";
vi["agents.persona_overview.failed_copy"] = "Không thể sao chép mô tả";
vi["agents.persona_overview.no_connectors_configured"] = "Chưa cấu hình trình kết nối";
vi["agents.persona_overview.click_to_copy"] = "Nhấp để sao chép";

// agents.overview_empty
vi["agents.overview_empty.title"] = "Không có tác nhân nào khớp các bộ lọc này";
vi["agents.overview_empty.subtitle"] = "Thử điều chỉnh tìm kiếm hoặc bộ lọc, hoặc đặt lại để xem tất cả tác nhân.";
vi["agents.overview_empty.clear_all_filters"] = "Xóa tất cả bộ lọc";

// agents.overview_batch
vi["agents.overview_batch.selected"] = "{count} đã chọn";

// agents.overview_menu
vi["agents.overview_menu.more_actions"] = "Thêm thao tác";
vi["agents.overview_menu.settings"] = "Cài đặt";

// agents.overview_toolbar
vi["agents.overview_toolbar.search_placeholder"] = "Tìm tác nhân...";
vi["agents.overview_toolbar.show_all"] = "Hiển thị tất cả tác nhân";
vi["agents.overview_toolbar.show_favorites"] = "Chỉ hiển thị yêu thích";
vi["agents.overview_toolbar.favorites"] = "Yêu thích";
vi["agents.overview_toolbar.clear_search"] = "Xóa tìm kiếm";

// agents.overview_columns
vi["agents.overview_columns.persona"] = "Tác nhân";
vi["agents.overview_columns.connectors"] = "Trình kết nối";
vi["agents.overview_columns.status"] = "Trạng thái";
vi["agents.overview_columns.trust"] = "Độ tin cậy";
vi["agents.overview_columns.triggers"] = "Trình kích hoạt";
vi["agents.overview_columns.last_run"] = "Lần chạy cuối";
vi["agents.overview_columns.all_statuses"] = "Tất cả trạng thái";
vi["agents.overview_columns.active_only"] = "Chỉ đang hoạt động";
vi["agents.overview_columns.disabled_only"] = "Chỉ đã tắt";
vi["agents.overview_columns.building_drafts"] = "Đang xây dựng / Nháp";
vi["agents.overview_columns.all_health"] = "Tất cả sức khỏe";
vi["agents.overview_columns.all_connectors"] = "Tất cả trình kết nối";
vi["agents.overview_columns.active_triggers"] = "{count} trình kích hoạt đang hoạt động";

// agents.health_indicator
vi["agents.health_indicator.last"] = "cuối {count}";

// agents.view_presets
vi["agents.view_presets.views"] = "Chế độ xem";
vi["agents.view_presets.save_current"] = "Lưu chế độ xem hiện tại";
vi["agents.view_presets.smart_presets"] = "Cài đặt trước thông minh";
vi["agents.view_presets.your_views"] = "Chế độ xem của bạn";
vi["agents.view_presets.custom_view"] = "Chế độ xem tùy chỉnh";
vi["agents.view_presets.custom_filters"] = "Bộ lọc tùy chỉnh";
vi["agents.view_presets.reset_defaults"] = "Đặt lại mặc định";
vi["agents.view_presets.view_name_placeholder"] = "Tên chế độ xem...";
vi["agents.view_presets.enter_view_name"] = "Nhập tên chế độ xem";
vi["agents.view_presets.delete_view"] = "Xóa chế độ xem";
vi["agents.view_presets.active_healthy"] = "Hoạt động & Khỏe mạnh";
vi["agents.view_presets.needs_attention"] = "Cần chú ý";
vi["agents.view_presets.failing_agents"] = "Tác nhân thất bại";
vi["agents.view_presets.my_favorites"] = "Yêu thích của tôi";
vi["agents.view_presets.recently_active"] = "Hoạt động gần đây";

// agents.activity
vi["agents.activity.title"] = "Hoạt động";
vi["agents.activity.items"] = "{count} mục";
vi["agents.activity.all_statuses"] = "Tất cả trạng thái";
vi["agents.activity.select_persona"] = "Chọn tác nhân để xem hoạt động";
vi["agents.activity.no_activity"] = "Chưa có hoạt động nào";
vi["agents.activity.execution"] = "Thực thi";
vi["agents.activity.description"] = "Mô tả";
vi["agents.activity.context"] = "Ngữ cảnh";
vi["agents.activity.reviewer_notes"] = "Ghi chú người xem xét";
vi["agents.activity.approve"] = "Phê duyệt";
vi["agents.activity.reject"] = "Từ chối";
vi["agents.activity.col_activity"] = "Hoạt động";
vi["agents.activity.col_status"] = "Trạng thái";
vi["agents.activity.col_time"] = "Thời gian";
vi["agents.activity.execution_status"] = "Thực thi {status}";
vi["agents.activity.no_output"] = "Không có đầu ra";
vi["agents.activity.message_title"] = "Tin nhắn";
vi["agents.activity.modal_execution_title"] = "{name} - Thực thi";
vi["agents.activity.modal_execution_subtitle"] = "ID: {id}";
vi["agents.activity.modal_review_title"] = "Xem xét: {title}";
vi["agents.activity.modal_review_subtitle"] = "Mức độ: {severity} · Trạng thái: {status}";

// agents.chat
vi["agents.chat.select_persona"] = "Chọn tác nhân để bắt đầu trò chuyện";
vi["agents.chat.waiting"] = "Đang chờ phản hồi...";
vi["agents.chat.ask_anything"] = "Hỏi bất cứ điều gì về tác nhân này...";
vi["agents.chat.enter_to_send"] = "Enter để gửi, Shift+Enter để xuống dòng";
vi["agents.chat.scroll_to_bottom"] = "Cuộn xuống dưới";
vi["agents.chat.experiments_running_one"] = "{count} thí nghiệm đang chạy -- kết quả sẽ hiển thị khi sẵn sàng";
vi["agents.chat.experiments_running_other"] = "{count} thí nghiệm đang chạy -- kết quả sẽ hiển thị khi sẵn sàng";
vi["agents.chat.you"] = "Bạn";
vi["agents.chat.assistant"] = "Trợ lý";
vi["agents.chat.thinking"] = "đang suy nghĩ...";
vi["agents.chat.copy_message"] = "Sao chép tin nhắn";
vi["agents.chat.no_conversations"] = "Chưa có cuộc trò chuyện nào";
vi["agents.chat.new_chat"] = "Trò chuyện mới";
vi["agents.chat.confirm_delete"] = "Xóa?";
vi["agents.chat.processing"] = "Đang xử lý...";
vi["agents.chat.delete_conversation"] = "Xóa cuộc trò chuyện";
vi["agents.chat.confirm_delete_conversation"] = "Xác nhận xóa cuộc trò chuyện";

// agents.advisory
vi["agents.advisory.how_can_improve"] = "Làm thế nào tác nhân này có thể hoạt động tốt hơn cho bạn?";
vi["agents.advisory.go"] = "Thực hiện";
vi["agents.advisory.improve"] = "Cải tiến";
vi["agents.advisory.improve_desc"] = "Mô tả điều bạn muốn tác nhân này làm tốt hơn";
vi["agents.advisory.improve_goal_label"] = "Cần cải tiến gì?";
vi["agents.advisory.experiment"] = "Thử nghiệm";
vi["agents.advisory.experiment_desc"] = "Kiểm tra hai phương pháp song song";
vi["agents.advisory.experiment_hypothesis_label"] = "Kiểm tra điều gì?";
vi["agents.advisory.analyze"] = "Phân tích";
vi["agents.advisory.analyze_desc"] = "Xem xét xu hướng và mẫu hiệu suất";
vi["agents.advisory.test_run"] = "Chạy thử";
vi["agents.advisory.test_run_desc"] = "Chạy tác nhân và đánh giá kết quả";
vi["agents.advisory.test_input_label"] = "Đầu vào thử (tùy chọn)";

// agents.ops
vi["agents.ops.sessions"] = "Phiên";
vi["agents.ops.run"] = "Chạy";
vi["agents.ops.lab"] = "Phòng thí nghiệm";
vi["agents.ops.health"] = "Sức khỏe";
vi["agents.ops.assertions"] = "Xác nhận";
vi["agents.ops.switch_panel"] = "Chuyển sang bảng {panel}";
vi["agents.ops.choose_action"] = "Chọn hành động hoặc nhập tin nhắn bên dưới";
vi["agents.ops.diagnose"] = "Chẩn đoán";
vi["agents.ops.diagnose_desc"] = "Phân tích sức khỏe, hiệu suất và tìm vấn đề";
vi["agents.ops.execute"] = "Thực thi";
vi["agents.ops.execute_desc"] = "Chạy tác nhân với đầu vào tùy chọn";
vi["agents.ops.input_optional"] = "Đầu vào (tùy chọn)";
vi["agents.ops.arena_test"] = "Kiểm tra đấu trường";
vi["agents.ops.arena_test_desc"] = "So sánh các mô hình trực tiếp";
vi["agents.ops.models"] = "Mô hình";
vi["agents.ops.improve"] = "Cải tiến";
vi["agents.ops.improve_desc"] = "Cải tiến tác nhân bằng AI";
vi["agents.ops.focus_area"] = "Lĩnh vực tập trung";
vi["agents.ops.executions"] = "Thực thi";
vi["agents.ops.executions_desc"] = "Xem lịch sử thực thi gần đây";
vi["agents.ops.knowledge"] = "Kiến thức";
vi["agents.ops.knowledge_desc"] = "Xem bộ nhớ và mẫu học được";
vi["agents.ops.reviews"] = "Xem xét";
vi["agents.ops.reviews_desc"] = "Phê duyệt và quyết định đang chờ";
vi["agents.ops.versions"] = "Phiên bản";
vi["agents.ops.versions_desc"] = "Lịch sử phiên bản lời nhắc và khôi phục";

// agents.ops_run
vi["agents.ops_run.execute_agent"] = "Thực thi tác nhân";
vi["agents.ops_run.running"] = "Đang chạy...";
vi["agents.ops_run.recent"] = "Gần đây";
vi["agents.ops_run.no_executions"] = "Chưa có lần thực thi nào";
vi["agents.ops_run.refresh_executions"] = "Làm mới thực thi";

// agents.ops_lab
vi["agents.ops_lab.history"] = "Lịch sử";
vi["agents.ops_lab.no_lab_runs"] = "Chưa có lần chạy phòng thí nghiệm nào";
vi["agents.ops_lab.refresh_lab"] = "Làm mới lịch sử phòng thí nghiệm";
vi["agents.ops_lab.arena"] = "Đấu trường";
vi["agents.ops_lab.improve"] = "Cải tiến";

// agents.ops_health
vi["agents.ops_health.no_health_data"] = "Không có dữ liệu sức khỏe";
vi["agents.ops_health.run_health_check"] = "Chạy kiểm tra sức khỏe";
vi["agents.ops_health.checking"] = "Đang kiểm tra...";
vi["agents.ops_health.last_check"] = "Lần kiểm tra cuối";
vi["agents.ops_health.checked_at"] = "Kiểm tra lúc {time}";
vi["agents.ops_health.issues"] = "Vấn đề";
vi["agents.ops_health.run_check_aria"] = "Chạy kiểm tra sức khỏe";
vi["agents.ops_health.healthy"] = "Khỏe mạnh";
vi["agents.ops_health.degraded"] = "Suy giảm";
vi["agents.ops_health.unhealthy"] = "Không khỏe";

// agents.ops_assertions
vi["agents.ops_assertions.active_count"] = "{enabled}/{total} đang hoạt động";
vi["agents.ops_assertions.no_assertions"] = "Chưa cấu hình xác nhận";
vi["agents.ops_assertions.refresh_assertions"] = "Làm mới xác nhận";
vi["agents.ops_assertions.enable_assertion"] = "Bật {name}";
vi["agents.ops_assertions.disable_assertion"] = "Tắt {name}";

// agents.health_tab
vi["agents.health_tab.title"] = "Kiểm tra sức khỏe";
vi["agents.health_tab.description"] = "Chạy phân tích giả lập đối với cấu hình hiện tại của tác nhân để phát hiện thông tin xác thực thiếu, trình kết nối bị ngắt, kết hợp công cụ không tương thích và trường hợp sử dụng chưa đủ.";

// agents.matrix_tab
vi["agents.matrix_tab.loading"] = "Đang tải ma trận";
vi["agents.matrix_tab.no_data"] = "Không có dữ liệu ma trận. Xây dựng hoặc xây dựng lại tác nhân để tạo các chiều.";

// agents.settings_status
vi["agents.settings_status.saving"] = "Đang lưu {sections}...";
vi["agents.settings_status.changed"] = "{sections} đã thay đổi";
vi["agents.settings_status.all_saved"] = "Tất cả thay đổi đã được lưu";
vi["agents.settings_status.irreversible"] = "Không thể hoàn tác";
vi["agents.settings_status.identity"] = "Danh tính";
vi["agents.settings_status.execution"] = "Thực thi";
vi["agents.settings_status.label_name"] = "Tên";
vi["agents.settings_status.label_description"] = "Mô tả";
vi["agents.settings_status.label_icon"] = "Biểu tượng";
vi["agents.settings_status.label_color"] = "Màu sắc";
vi["agents.settings_status.max_concurrent"] = "Đồng thời tối đa";
vi["agents.settings_status.timeout_sec"] = "Thời gian chờ (giây)";
vi["agents.settings_status.execution_retention"] = "Lưu giữ thực thi";
vi["agents.settings_status.months"] = "tháng";
vi["agents.settings_status.persona_enabled"] = "Bật tác nhân";
vi["agents.settings_status.sensitive_preview"] = "Xem trước nhạy cảm";
vi["agents.settings_status.sensitive_preview_desc"] = "Ẩn chi tiết xem trước khi di chuột qua cho đến khi được hiển thị.";
vi["agents.settings_status.failed_health_watch"] = "Không cập nhật được cài đặt theo dõi sức khỏe";
vi["agents.settings_status.health_watch"] = "Theo dõi sức khỏe";
vi["agents.settings_status.health_watch_active"] = "Đang theo dõi sức khỏe (mỗi 6 giờ)";
vi["agents.settings_status.health_watch_enable"] = "Bật theo dõi sức khỏe liên tục";

// agents.tool_runner
vi["agents.tool_runner.no_tools"] = "Không có công cụ nào được gán cho tác nhân này.";
vi["agents.tool_runner.input_json"] = "JSON đầu vào";
vi["agents.tool_runner.run"] = "Chạy";
vi["agents.tool_runner.running"] = "Đang chạy...";
vi["agents.tool_runner.success"] = "Thành công";
vi["agents.tool_runner.failed"] = "Thất bại";
vi["agents.tool_runner.error"] = "Lỗi";

// agents.health_check
vi["agents.health_check.title"] = "Kiểm tra sức khỏe tác nhân";
vi["agents.health_check.idle_description"] = "Chạy phân tích giả lập để phát hiện thông tin xác thực thiếu, trình kết nối bị ngắt và trường hợp sử dụng chưa đủ.";
vi["agents.health_check.run_check"] = "Chạy kiểm tra";
vi["agents.health_check.select_agent"] = "Chọn tác nhân để kiểm tra sức khỏe";
vi["agents.health_check.scanning"] = "Đang quét cấu hình tác nhân...";
vi["agents.health_check.scanning_detail"] = "Đang kiểm tra thông tin xác thực, trình kết nối và trường hợp sử dụng";
vi["agents.health_check.check_failed"] = "Kiểm tra sức khỏe thất bại";
vi["agents.health_check.issues_found_one"] = "{count} vấn đề được tìm thấy";
vi["agents.health_check.issues_found_other"] = "{count} vấn đề được tìm thấy";
vi["agents.health_check.no_issues"] = "Không phát hiện vấn đề nào";
vi["agents.health_check.stale"] = "Lỗi thời";
vi["agents.health_check.rerun"] = "Chạy lại";
vi["agents.health_check.capabilities"] = "Khả năng";
vi["agents.health_check.all_healthy"] = "Tất cả hệ thống khỏe mạnh";
vi["agents.health_check.all_healthy_detail"] = "Không phát hiện vấn đề trong cấu hình tác nhân";

// agents.health_digest
vi["agents.health_digest.title"] = "Tóm tắt sức khỏe tác nhân";
vi["agents.health_digest.description"] = "Chạy kiểm tra sức khỏe toàn diện trên tất cả tác nhân để phát hiện lỗi cấu hình, thông tin xác thực hết hạn và cơ hội tối ưu hóa.";
vi["agents.health_digest.run_digest"] = "Chạy tóm tắt sức khỏe";
vi["agents.health_digest.generating"] = "Đang tạo tóm tắt...";
vi["agents.health_digest.stale_warning"] = "Dữ liệu sức khỏe đã lỗi thời. Chạy lại để có kết quả hiện tại.";
vi["agents.health_digest.all_healthy"] = "Tất cả hệ thống khỏe mạnh";
vi["agents.health_digest.some_attention"] = "Một số tác nhân cần chú ý";
vi["agents.health_digest.critical_issues"] = "Phát hiện vấn đề nghiêm trọng";
vi["agents.health_digest.agents_checked_one"] = "{count} tác nhân được kiểm tra";
vi["agents.health_digest.agents_checked_other"] = "{count} tác nhân được kiểm tra";
vi["agents.health_digest.issues_one"] = "{count} vấn đề";
vi["agents.health_digest.issues_other"] = "{count} vấn đề";
vi["agents.health_digest.last_run"] = "Lần chạy cuối: {time}";

// agents.health_issue
vi["agents.health_issue.apply_fix"] = "Áp dụng sửa lỗi: {label}";
vi["agents.health_issue.manual_action"] = "Cần hành động thủ công";

// agents.health_score
vi["agents.health_score.healthy"] = "Khỏe mạnh";
vi["agents.health_score.degraded"] = "Suy giảm";
vi["agents.health_score.unhealthy"] = "Không khỏe";

// agents.prompt_editor
vi["agents.prompt_editor.no_persona"] = "Chưa chọn tác nhân";
vi["agents.prompt_editor.enter_content"] = "Nhập nội dung {section}...";
vi["agents.prompt_editor.new_section"] = "Phần mới";
vi["agents.prompt_editor.saved"] = "Đã lưu";
vi["agents.prompt_editor.sections"] = "phần";

// agents.custom_sections
vi["agents.custom_sections.title"] = "Phần tùy chỉnh";
vi["agents.custom_sections.add"] = "Thêm";
vi["agents.custom_sections.no_sections"] = "Chưa có phần tùy chỉnh nào";
vi["agents.custom_sections.section_fallback"] = "Phần {index}";
vi["agents.custom_sections.remove_section"] = "Xóa phần";
vi["agents.custom_sections.title_placeholder"] = "Tiêu đề phần...";
vi["agents.custom_sections.content_placeholder"] = "Nội dung phần...";
vi["agents.custom_sections.custom_section"] = "Phần tùy chỉnh";

// agents.activity_filters
vi["agents.activity_filters.all"] = "Tất cả";
vi["agents.activity_filters.executions"] = "Thực thi";
vi["agents.activity_filters.events"] = "Sự kiện";
vi["agents.activity_filters.memories"] = "Bộ nhớ";
vi["agents.activity_filters.reviews"] = "Xem xét";
vi["agents.activity_filters.messages"] = "Tin nhắn";

// agents.overview_actions
vi["agents.overview_actions.delete_agent"] = "Xóa tác nhân";
vi["agents.overview_actions.delete_agent_message"] = "Tác nhân này và toàn bộ cấu hình của nó sẽ bị xóa vĩnh viễn.";
vi["agents.overview_actions.delete_agents"] = "Xóa {count} tác nhân";
vi["agents.overview_actions.delete_agents_message"] = "{count} tác nhân và toàn bộ cấu hình của chúng sẽ bị xóa vĩnh viễn.";
vi["agents.overview_actions.delete_drafts"] = "Xóa {count} nháp";
vi["agents.overview_actions.delete_drafts_message"] = "{count} tác nhân nháp sẽ bị xóa vĩnh viễn.";

// agents.persona_list
vi["agents.persona_list.all_personas"] = "Tất cả tác nhân";
vi["agents.persona_list.delete_drafts_btn"] = "Xóa nháp ({count})";
vi["agents.persona_list.badge_draft"] = "Nháp";
vi["agents.persona_list.badge_disabled"] = "Đã tắt";
vi["agents.persona_list.badge_building"] = "Đang xây dựng";
vi["agents.persona_list.batch_selected"] = "{count} đã chọn";
vi["agents.persona_list.batch_delete"] = "Xóa";
vi["agents.persona_list.batch_clear"] = "Xóa lựa chọn";
vi["agents.persona_list.no_personas_match"] = "Không có tác nhân nào khớp";
vi["agents.persona_list.no_connectors"] = "Không có trình kết nối";
vi["agents.persona_list.never"] = "Chưa bao giờ";
vi["agents.persona_list.click_to_copy"] = "Nhấp để sao chép";
vi["agents.persona_list.description_copied"] = "Đã sao chép mô tả vào clipboard";
vi["agents.persona_list.copy_failed"] = "Không thể sao chép mô tả";
vi["agents.persona_list.no_match_filters"] = "Không có tác nhân nào khớp bộ lọc";
vi["agents.persona_list.adjust_filters_hint"] = "Thử điều chỉnh tìm kiếm hoặc bộ lọc, hoặc đặt lại để xem tất cả tác nhân.";
vi["agents.persona_list.clear_all_filters"] = "Xóa tất cả bộ lọc";
vi["agents.persona_list.more_actions"] = "Thêm thao tác";
vi["agents.persona_list.settings"] = "Cài đặt";
vi["agents.persona_list.search_personas"] = "Tìm tác nhân...";
vi["agents.persona_list.favorites"] = "Yêu thích";
vi["agents.persona_list.show_all_personas"] = "Hiển thị tất cả tác nhân";
vi["agents.persona_list.show_only_favorites"] = "Chỉ hiển thị yêu thích";
vi["agents.persona_list.clear_search"] = "Xóa tìm kiếm";
vi["agents.persona_list.col_persona"] = "Tác nhân";
vi["agents.persona_list.no_connectors_configured"] = "Chưa cấu hình trình kết nối";

// agents.design_preview
vi["agents.design_preview.preview"] = "Xem trước";
vi["agents.design_preview.identity"] = "Danh tính";
vi["agents.design_preview.prompt"] = "Lời nhắc";
vi["agents.design_preview.lines"] = "{count} dòng";
vi["agents.design_preview.tools"] = "Công cụ";
vi["agents.design_preview.triggers"] = "Trình kích hoạt";
vi["agents.design_preview.subscriptions"] = "Đăng ký";
vi["agents.design_preview.none_yet"] = "Chưa có";
vi["agents.design_preview.activating"] = "Đang kích hoạt...";
vi["agents.design_preview.activate_agent"] = "Kích hoạt tác nhân";
vi["agents.design_preview.create_agent"] = "Tạo tác nhân";
vi["agents.design_preview.min_completeness"] = "Thêm chi tiết để đạt 40% hoàn chỉnh";

// agents.editor_ui
vi["agents.editor_ui.max_budget_label"] = "Ngân sách tối đa (USD)";
vi["agents.editor_ui.max_budget_hint"] = "Tổng chi tiêu tối đa cho một lần thực thi. Lần chạy sẽ dừng khi đạt giới hạn.";
vi["agents.editor_ui.max_budget_range"] = "Từ $0.01 trở lên, hoặc để trống không giới hạn";
vi["agents.editor_ui.max_budget_example"] = "0.50";
vi["agents.editor_ui.max_budget_placeholder"] = "Ngân sách tháng tính USD -- ví dụ 25.00";
vi["agents.editor_ui.max_turns_label"] = "Số vòng tối đa";
vi["agents.editor_ui.max_turns_hint"] = "Số vòng tương tác LLM tối đa mỗi lần thực thi.";
vi["agents.editor_ui.max_turns_range"] = "Từ 1 trở lên, hoặc để trống không giới hạn";
vi["agents.editor_ui.max_turns_example"] = "5";
vi["agents.editor_ui.max_turns_placeholder"] = "Số vòng tối đa -- ví dụ 5";
vi["agents.editor_ui.prompt_caching"] = "Lưu bộ nhớ đệm lời nhắc";
vi["agents.editor_ui.prompt_caching_hint"] = "Lưu lời nhắc hệ thống qua các lần thực thi để giảm chi phí token đầu vào.";
vi["agents.editor_ui.prompt_caching_range"] = "Tắt, 5 phút, hoặc 1 giờ";
vi["agents.editor_ui.prompt_caching_example"] = "5 phút cho tác nhân kích hoạt cron";
vi["agents.editor_ui.cache_off"] = "Tắt";
vi["agents.editor_ui.cache_off_desc"] = "Không lưu đệm";
vi["agents.editor_ui.cache_short"] = "5 phút";
vi["agents.editor_ui.cache_short_desc"] = "Lưu ngắn hạn";
vi["agents.editor_ui.cache_long"] = "1 giờ";
vi["agents.editor_ui.cache_long_desc"] = "Lưu dài hạn";
vi["agents.editor_ui.source_agent"] = "Tác nhân";
vi["agents.editor_ui.source_workspace"] = "Không gian làm việc";
vi["agents.editor_ui.source_global"] = "Toàn cục";
vi["agents.editor_ui.source_default"] = "Mặc định";
vi["agents.editor_ui.tooltip_workspace"] = "Kế thừa từ không gian làm việc \"{name}\"";
vi["agents.editor_ui.tooltip_global"] = "Kế thừa từ mặc định toàn cục";
vi["agents.editor_ui.tooltip_agent_override"] = "Ghi đè mặc định không gian/toàn cục";
vi["agents.editor_ui.tooltip_agent_set"] = "Đặt trên tác nhân này";
vi["agents.editor_ui.tooltip_default"] = "Chưa cấu hình giá trị";
vi["agents.editor_ui.tooltip_overriding"] = "Đang ghi đè giá trị kế thừa";
vi["agents.editor_ui.effective_config"] = "Cấu hình hiệu lực";
vi["agents.editor_ui.inherited"] = "kế thừa";
vi["agents.editor_ui.overridden"] = "ghi đè";
vi["agents.editor_ui.field_model"] = "Mô hình";
vi["agents.editor_ui.field_provider"] = "Nhà cung cấp";
vi["agents.editor_ui.field_base_url"] = "URL gốc";
vi["agents.editor_ui.field_auth_token"] = "Token xác thực";
vi["agents.editor_ui.field_max_budget"] = "Ngân sách tối đa";
vi["agents.editor_ui.field_max_turns"] = "Số vòng tối đa";
vi["agents.editor_ui.field_prompt_cache"] = "Bộ đệm lời nhắc";
vi["agents.editor_ui.provider"] = "Nhà cung cấp";
vi["agents.editor_ui.provider_anthropic"] = "Anthropic";
vi["agents.editor_ui.provider_ollama"] = "Ollama (cục bộ)";
vi["agents.editor_ui.provider_litellm"] = "LiteLLM (proxy)";
vi["agents.editor_ui.provider_custom"] = "URL tùy chỉnh";
vi["agents.editor_ui.model_name"] = "Tên mô hình";
vi["agents.editor_ui.model_name_placeholder_litellm"] = "ví dụ anthropic/claude-sonnet-4-20250514";
vi["agents.editor_ui.model_name_placeholder_ollama"] = "ví dụ llama3.1:8b";
vi["agents.editor_ui.model_name_placeholder_custom"] = "Định danh mô hình";
vi["agents.editor_ui.base_url"] = "URL gốc";
vi["agents.editor_ui.base_url_hint"] = "Điểm cuối API cho nhà cung cấp mô hình. Phải bao gồm giao thức (http/https) và cổng nếu không chuẩn.";
vi["agents.editor_ui.base_url_example"] = "http://localhost:11434";
vi["agents.editor_ui.auth_token"] = "Token xác thực";
vi["agents.editor_ui.auth_token_hint"] = "Token xác thực cho API nhà cung cấp. Với Ollama cục bộ, dùng 'ollama'. Với LiteLLM, dùng khóa master.";
vi["agents.editor_ui.auth_token_example"] = "sk-...";
vi["agents.editor_ui.auth_token_placeholder_litellm"] = "LiteLLM master key (sk-...)";
vi["agents.editor_ui.auth_token_placeholder_ollama"] = "ollama";
vi["agents.editor_ui.auth_token_placeholder_custom"] = "Bearer token";
vi["agents.editor_ui.saved"] = "Đã lưu";
vi["agents.editor_ui.litellm_label"] = "Cài đặt LiteLLM Proxy";
vi["agents.editor_ui.litellm_sublabel"] = "(toàn cục, dùng chung cho tất cả tác nhân)";
vi["agents.editor_ui.litellm_base_url_placeholder"] = "URL gốc Proxy (http://localhost:4000)";
vi["agents.editor_ui.litellm_master_key_placeholder"] = "Master Key (sk-...)";
vi["agents.editor_ui.litellm_save_label"] = "Lưu cấu hình toàn cục";
vi["agents.editor_ui.litellm_description"] = "Các cài đặt toàn cục này là mặc định cho tất cả tác nhân dùng LiteLLM. Ghi đè mỗi tác nhân ở trên có độ ưu tiên cao hơn.";
vi["agents.editor_ui.ollama_label"] = "Khóa API Ollama";
vi["agents.editor_ui.ollama_sublabel"] = "(toàn cục, dùng chung cho tất cả tác nhân)";
vi["agents.editor_ui.ollama_placeholder"] = "Dán khóa từ ollama.com/settings";
vi["agents.editor_ui.ollama_save_label"] = "Lưu khóa";
vi["agents.editor_ui.ollama_signup"] = "Đăng ký miễn phí tại";
vi["agents.editor_ui.ollama_copy_key"] = "và sao chép khóa API từ Cài đặt.";
vi["agents.editor_ui.compare_models"] = "So sánh mô hình";
vi["agents.editor_ui.side_by_side"] = "Song song";
vi["agents.editor_ui.model_a"] = "Mô hình A";
vi["agents.editor_ui.model_b"] = "Mô hình B";
vi["agents.editor_ui.add_prompt_first"] = "Thêm lời nhắc trước khi chạy so sánh.";
vi["agents.editor_ui.select_different_models"] = "Chọn hai mô hình khác nhau để so sánh.";
vi["agents.editor_ui.run_comparison"] = "Chạy so sánh";
vi["agents.editor_ui.generating_scenarios"] = "Đang tạo tình huống...";
vi["agents.editor_ui.testing_model"] = "Đang kiểm tra {modelId}";
vi["agents.editor_ui.running"] = "Đang chạy...";
vi["agents.editor_ui.tokens_in"] = "Token vào";
vi["agents.editor_ui.tokens_out"] = "Token ra";
vi["agents.editor_ui.wins"] = "thắng";
vi["agents.editor_ui.composite"] = "tổng hợp";
vi["agents.editor_ui.quality"] = "Chất lượng";
vi["agents.editor_ui.tool_accuracy"] = "Độ chính xác công cụ";
vi["agents.editor_ui.protocol"] = "Giao thức";
vi["agents.editor_ui.scenario"] = "Tình huống";
vi["agents.editor_ui.output_previews"] = "Xem trước đầu ra";
vi["agents.editor_ui.no_output"] = "Không có đầu ra";
vi["agents.editor_ui.select_agent"] = "Chọn tác nhân để bắt đầu";
vi["agents.editor_ui.choose_from_sidebar"] = "Chọn từ thanh bên hoặc tạo tác nhân mới";
vi["agents.editor_ui.save_failed_retry"] = "Lưu thất bại -- sẽ thử lại ở lần chỉnh sửa tiếp";
vi["agents.editor_ui.delete_failed"] = "Xóa thất bại: {message}";
vi["agents.editor_ui.tab_activity"] = "Hoạt động";
vi["agents.editor_ui.tab_matrix"] = "Ma trận";
vi["agents.editor_ui.tab_use_cases"] = "Trường hợp sử dụng";
vi["agents.editor_ui.tab_prompt"] = "Lời nhắc";
vi["agents.editor_ui.tab_lab"] = "Phòng thí nghiệm";
vi["agents.editor_ui.tab_connectors"] = "Trình kết nối";
vi["agents.editor_ui.tab_chat"] = "Trò chuyện";
vi["agents.editor_ui.tab_design"] = "Thiết kế";
vi["agents.editor_ui.tab_health"] = "Sức khỏe";
vi["agents.editor_ui.tab_settings"] = "Cài đặt";
vi["agents.editor_ui.unsaved_changes"] = "Thay đổi chưa lưu";
vi["agents.editor_ui.partial_load"] = "Tải một phần:";
vi["agents.editor_ui.cloud_connect"] = "Kết nối trình điều phối đám mây để chạy tác nhân từ xa";
vi["agents.editor_ui.cloud_signin"] = "Đăng nhập để mở khóa tính năng đám mây và thực thi từ xa";
vi["agents.editor_ui.execution_in_progress"] = "Đang thực thi";
vi["agents.editor_ui.execute"] = "Thực thi";
vi["agents.editor_ui.execute_failed"] = "Không thể bắt đầu thực thi. Vui lòng thử lại.";
vi["agents.editor_ui.no_triggers_or_subs"] = "Chưa cấu hình trình kích hoạt hoặc đăng ký sự kiện";
vi["agents.editor_ui.missing_credentials"] = "Thiếu thông tin xác thực: {credentials}";
vi["agents.editor_ui.cannot_enable"] = "Không thể bật tác nhân";
vi["agents.editor_ui.success"] = "Thành công";
vi["agents.editor_ui.health"] = "Sức khỏe";
vi["agents.editor_ui.latency"] = "Độ trễ";
vi["agents.editor_ui.cost_per_run"] = "Chi phí/lần chạy";
vi["agents.editor_ui.last_run"] = "Lần chạy cuối";
vi["agents.editor_ui.rank"] = "Hạng";
vi["agents.editor_ui.view_in_leaderboard"] = "Xem trong bảng xếp hạng";

console.log('Part 2 done. Keys:', Object.keys(vi).length);
fs.writeFileSync('C:/Users/kazda/kiro/personas/.planning/i18n/translated-vi.json', JSON.stringify(vi, null, 2), 'utf8');
