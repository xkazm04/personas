const fs = require('fs');
const existing = JSON.parse(fs.readFileSync('C:/Users/kazda/kiro/personas/.planning/i18n/translated-vi.json', 'utf8'));
const vi = existing;

vi["overview.realtime_page.replay_subtitle_1d"] = "Đang phát lại 24 giờ qua ở tốc độ {speed}x";
vi["overview.realtime_page.replay_subtitle_7d"] = "Đang phát lại 7 ngày qua ở tốc độ {speed}x";
vi["overview.realtime_page.paused"] = "Tạm dừng";
vi["overview.realtime_page.live"] = "Trực tiếp";
vi["overview.realtime_page.offline"] = "Ngoại tuyến";
vi["overview.realtime_page.connection_paused"] = "Trạng thái kết nối: Tạm dừng";
vi["overview.realtime_page.connection_live"] = "Trạng thái kết nối: Trực tiếp";
vi["overview.realtime_page.connection_offline"] = "Trạng thái kết nối: Ngắt kết nối";
vi["overview.realtime_page.events_per_min"] = "sự kiện/phút";
vi["overview.realtime_page.pending"] = "đang chờ";
vi["overview.realtime_page.success"] = "thành công";
vi["overview.realtime_page.in_window"] = "trong cửa sổ";
vi["overview.realtime_page.test_flow"] = "Kiểm thử luồng";
vi["overview.realtime_page.testing_flow"] = "Đang kiểm thử luồng...";
vi["overview.realtime_page.test_event_flow"] = "Kiểm thử luồng sự kiện";
vi["overview.realtime_page.resume"] = "Tiếp tục";
vi["overview.realtime_page.pause"] = "Tạm dừng";
vi["overview.realtime_page.resume_stream"] = "Tiếp tục luồng thời gian thực";
vi["overview.realtime_page.pause_stream"] = "Tạm dừng luồng thời gian thực";
vi["overview.realtime_page.search_events"] = "Tìm kiếm sự kiện...";
vi["overview.realtime_page.filter_type"] = "Loại";
vi["overview.realtime_page.filter_status"] = "Trạng thái";
vi["overview.realtime_page.filter_source"] = "Nguồn";
vi["overview.realtime_page.filter_agent"] = "Tác nhân";
vi["overview.realtime_page.clear"] = "Xóa";
vi["overview.realtime_page.views"] = "Chế độ xem";
vi["overview.realtime_page.no_saved_views"] = "Chưa có chế độ xem đã lưu";
vi["overview.realtime_page.save_current_filter"] = "Lưu bộ lọc hiện tại";
vi["overview.realtime_page.view_name_placeholder"] = "Tên chế độ xem...";
vi["overview.realtime_page.delete_saved_view"] = "Xóa chế độ xem đã lưu";
vi["overview.realtime_page.event_log"] = "Nhật ký sự kiện";
vi["overview.realtime_page.entries"] = "{count} mục";
vi["overview.realtime_page.filter_events"] = "Lọc sự kiện...";
vi["overview.realtime_page.no_events"] = "Chưa có sự kiện";
vi["overview.realtime_page.open_in_drawer"] = "Mở trong ngăn chi tiết";
vi["overview.realtime_page.event_label"] = "Sự kiện";
vi["overview.realtime_page.status_label"] = "Trạng thái";
vi["overview.realtime_page.source_label"] = "Nguồn";
vi["overview.realtime_page.target_label"] = "Đích";
vi["overview.realtime_page.id_label"] = "ID";
vi["overview.realtime_page.error_label"] = "Lỗi";
vi["overview.realtime_page.payload_label"] = "Payload";
vi["overview.realtime_page.close_event_details"] = "Đóng chi tiết sự kiện";
vi["overview.realtime_page.reset_to_start"] = "Đặt lại về đầu";
vi["overview.realtime_page.cycle_speed"] = "Chuyển đổi tốc độ phát lại";
vi["overview.realtime_page.exit_replay"] = "Thoát phát lại";
vi["overview.realtime_page.galaxy"] = "Thiên hà";
vi["overview.realtime_page.galaxy_desc"] = "Chùm sao quỹ đạo với đuôi sao chổi";
vi["overview.realtime_page.lanes"] = "Làn";
vi["overview.realtime_page.lanes_desc"] = "Sơ đồ luồng làn ngang";

vi["overview.memory_form.agent"] = "Tác nhân";
vi["overview.memory_form.category"] = "Danh mục";
vi["overview.memory_form.title"] = "Tiêu đề";
vi["overview.memory_form.title_placeholder"] = "vd: Luôn dùng đơn vị metric";
vi["overview.memory_form.content"] = "Nội dung";
vi["overview.memory_form.content_placeholder"] = "Mô tả những gì tác nhân nên nhớ...";
vi["overview.memory_form.importance"] = "Tầm quan trọng";
vi["overview.memory_form.tags"] = "Thẻ";
vi["overview.memory_form.tags_hint"] = "(phân cách bằng dấu phẩy)";
vi["overview.memory_form.tags_placeholder"] = "vd: units, formatting, output";
vi["overview.memory_form.save_memory"] = "Lưu bộ nhớ";
vi["overview.memory_form.saving"] = "Đang lưu...";
vi["overview.memory_form.created_success"] = "Đã tạo bộ nhớ thành công";
vi["overview.memory_form.fill_required"] = "Điền tất cả các trường bắt buộc để lưu";
vi["overview.memory_form.saving_memory"] = "Đang lưu bộ nhớ...";

vi["overview.memory_filter.search_placeholder"] = "Tìm kiếm bộ nhớ...";
vi["overview.memory_filter.all_agents"] = "Tất cả tác nhân";
vi["overview.memory_filter.all_categories"] = "Tất cả danh mục";

vi["overview.memory_actions.dismiss_suggestion"] = "Bỏ qua gợi ý";
vi["overview.memory_actions.memory_insights"] = "Hiểu biết bộ nhớ";
vi["overview.memory_actions.suggestions"] = "{count} gợi ý";
vi["overview.memory_actions.suggestions_one"] = "{count} gợi ý";

vi["overview.memory_conflict.memory_a"] = "Bộ nhớ A";
vi["overview.memory_conflict.memory_b"] = "Bộ nhớ B";
vi["overview.memory_conflict.merge"] = "Gộp";
vi["overview.memory_conflict.keep"] = "Giữ";
vi["overview.memory_conflict.vs"] = "vs";

vi["overview.observability_charts.cost_over_time"] = "Chi phí theo thời gian";
vi["overview.observability_charts.executions_by_persona"] = "Thực thi theo persona";
vi["overview.observability_charts.execution_health"] = "Sức khỏe thực thi";
vi["overview.observability_charts.successful"] = "Thành công";
vi["overview.observability_charts.failed"] = "Thất bại";
vi["overview.observability_charts.anomalies_detected"] = "{count} bất thường chi phí được phát hiện";
vi["overview.observability_charts.anomaly_detected"] = "{count} bất thường chi phí được phát hiện";
vi["overview.observability_charts.anomaly_click_hint"] = "Nhấp vào điểm kim cương trên biểu đồ để điều tra";
vi["overview.observability_charts.clear_traces"] = "Xóa trace đã hoàn thành";
vi["overview.observability_charts.all_operations"] = "Tất cả thao tác";

vi["overview.health_extra.success"] = "Thành công";
vi["overview.health_extra.burn"] = "Tiêu hao";
vi["overview.health_extra.healing"] = "Phục hồi";
vi["overview.health_extra.rollbacks"] = "Khôi phục";
vi["overview.health_extra.improving"] = "Đang cải thiện";
vi["overview.health_extra.degrading"] = "Đang suy giảm";
vi["overview.health_extra.stable"] = "Ổn định";
vi["overview.health_extra.success_pct"] = "{pct}% thành công";
vi["overview.health_extra.budget_exhaustion"] = "Ngân sách cạn kiệt trong";
vi["overview.health_extra.exhausted"] = "đã cạn";
vi["overview.health_extra.predicted_failure"] = "Dự đoán tăng đột biến thất bại trong";
vi["overview.health_extra.loading_status"] = "Đang tải dữ liệu trang trạng thái...";
vi["overview.health_extra.no_personas"] = "Không có personas để hiển thị.";
vi["overview.health_extra.score_label"] = "Điểm";
vi["overview.health_extra.uptime_30d"] = "Uptime 30 ngày";
vi["overview.health_extra.updated"] = "Cập nhật {time}";
vi["overview.health_extra.legend"] = "Chú giải:";
vi["overview.health_extra.operational"] = "Hoạt động";
vi["overview.health_extra.degraded"] = "Suy giảm";
vi["overview.health_extra.outage"] = "Gián đoạn";
vi["overview.health_extra.no_data"] = "Không có dữ liệu";
vi["overview.health_extra.success_rate_label"] = "Tỷ lệ thành công";
vi["overview.health_extra.latency_p95"] = "Độ trễ (p95)";
vi["overview.health_extra.cost_anomalies"] = "Bất thường chi phí";
vi["overview.health_extra.detected"] = "{count} được phát hiện";
vi["overview.health_extra.healing_issues"] = "Vấn đề phục hồi";
vi["overview.health_extra.open"] = "{count} mở";
vi["overview.health_extra.sla_compliance"] = "Tuân thủ SLA";
vi["overview.health_extra.consecutive_failures"] = "{count} lần thất bại liên tiếp";
vi["overview.health_extra.consecutive_failure"] = "{count} lần thất bại liên tiếp";

vi["overview.system_health.title"] = "Kiểm tra hệ thống";
vi["overview.system_health.subtitle"] = "Xác minh môi trường đã sẵn sàng";
vi["overview.system_health.re_run_checks"] = "Chạy lại kiểm tra";
vi["overview.system_health.ollama_title"] = "Khóa API Ollama Cloud";
vi["overview.system_health.ollama_subtitle"] = "Tùy chọn -- mở khóa các mô hình đám mây miễn phí (Qwen3 Coder, GLM-5, Kimi K2.5) cho tất cả tác nhân.";
vi["overview.system_health.litellm_title"] = "Cấu hình Proxy LiteLLM";
vi["overview.system_health.litellm_subtitle"] = "Tùy chọn -- định tuyến tác nhân qua proxy LiteLLM để quản lý mô hình và theo dõi chi phí.";
vi["overview.system_health.save_key"] = "Lưu khóa";
vi["overview.system_health.save_configuration"] = "Lưu cấu hình";
vi["overview.system_health.litellm_footer"] = "Cài đặt này được lưu cục bộ và chia sẻ trên tất cả tác nhân được cấu hình dùng nhà cung cấp LiteLLM.";
vi["overview.system_health.ipc_error"] = "Cầu nối ứng dụng không phản hồi. Hãy thử khởi động lại ứng dụng. Bạn vẫn có thể tiếp tục khám phá giao diện.";
vi["overview.system_health.issues_warning"] = "Một số kiểm tra báo cáo vấn đề. Bạn vẫn có thể tiếp tục, nhưng một số tính năng có thể không hoạt động đúng.";

vi["overview.review_extra.add_note"] = "Thêm ghi chú (tùy chọn)...";
vi["overview.review_extra.confirm"] = "Xác nhận";
vi["overview.review_extra.processing"] = "Đang xử lý...";
vi["overview.review_extra.clear_verdicts"] = "Xóa tất cả phán quyết";
vi["overview.review_extra.retry_with_changes"] = "Thử lại với thay đổi";
vi["overview.review_extra.reject_all"] = "Từ chối tất cả";
vi["overview.review_extra.quick_actions"] = "Thao tác nhanh";
vi["overview.review_extra.accepted"] = "{count} đã chấp nhận";
vi["overview.review_extra.rejected"] = "{count} đã từ chối";
vi["overview.review_extra.undecided"] = "{count} chưa quyết định";

vi["overview.widgets_extra.execution_health_chart"] = "Sức khỏe thực thi";
vi["overview.widgets_extra.cost_over_time_chart"] = "Chi phí theo thời gian";
vi["overview.widgets_extra.successful"] = "Thành công";
vi["overview.widgets_extra.failed"] = "Thất bại";
vi["overview.widgets_extra.close"] = "Đóng";
vi["overview.widgets_extra.dismiss_help"] = "Bỏ qua trợ giúp";
vi["overview.widgets_extra.skip_tour"] = "Bỏ qua hướng dẫn hoàn toàn";

vi["overview.remote_control_card.connect_to_desktop"] = "Kết nối với máy tính";
vi["overview.remote_control_card.connect_description"] = "Chạy tác nhân bằng CLI máy tính qua Điều khiển từ xa. Khởi động {command} trên máy tính, sau đó kết nối tại đây.";
vi["overview.remote_control_card.requires_subscription"] = "Yêu cầu đăng ký Claude Pro hoặc Max";

vi["overview.resume_setup_card.resume_tour"] = "Tiếp tục hướng dẫn";
vi["overview.resume_setup_card.left_off_at"] = "Bạn đã dừng tại";
vi["overview.resume_setup_card.steps_completed"] = "{completed}/{total} bước đã hoàn thành";
vi["overview.resume_setup_card.skip_tour"] = "Bỏ qua hướng dẫn hoàn toàn";
vi["overview.resume_setup_card.continue_label"] = "Tiếp tục";

vi["overview.detail_modal.close"] = "Đóng";

vi["overview.metric_help_popover.help_for"] = "Trợ giúp cho {label}";
vi["overview.metric_help_popover.dismiss_help"] = "Bỏ qua trợ giúp";
vi["overview.metric_help_popover.healthy"] = "Bình thường:";
vi["overview.metric_help_popover.click"] = "Nhấp:";
vi["overview.metric_help_popover.got_it"] = "Hiểu rồi, đừng hiện lại";

vi["overview.install_button.install_node"] = "Cài đặt Node.js";
vi["overview.install_button.install_cli"] = "Cài đặt Claude CLI";
vi["overview.install_button.downloading"] = "Đang tải xuống...";
vi["overview.install_button.installing"] = "Đang cài đặt...";
vi["overview.install_button.installed_success"] = "Cài đặt thành công";
vi["overview.install_button.installation_failed"] = "Cài đặt thất bại";
vi["overview.install_button.try_manually"] = "Thử chạy thủ công:";
vi["overview.install_button.retry"] = "Thử lại";
vi["overview.install_button.official_page"] = "Trang chính thức";

vi["overview.section_card.checking"] = "Đang kiểm tra {section}...";
vi["overview.section_card.edit_key"] = "Chỉnh sửa khóa";
vi["overview.section_card.configure"] = "Cấu hình";
vi["overview.section_card.edit_config"] = "Chỉnh sửa cấu hình";
vi["overview.section_card.signing_in"] = "Đang đăng nhập...";
vi["overview.section_card.sign_in_google"] = "Đăng nhập với Google";
vi["overview.section_card.working"] = "Đang xử lý...";
vi["overview.section_card.connect_claude"] = "Kết nối với Claude Desktop";
vi["overview.section_card.disconnect"] = "Ngắt kết nối";

vi["overview.metrics_cards.cost_spike"] = "Tăng đột biến chi phí";
vi["overview.metrics_cards.above_avg"] = "trên mức trung bình";
vi["overview.metrics_cards.top_executions"] = "Thực thi hàng đầu:";

vi["overview.event_log_item.event_id"] = "ID sự kiện";
vi["overview.event_log_item.project"] = "Dự án";
vi["overview.event_log_item.source"] = "Nguồn";
vi["overview.event_log_item.processed"] = "Đã xử lý";
vi["overview.event_log_item.event_data"] = "Dữ liệu sự kiện";
vi["overview.event_log_item.copy_event_data"] = "Sao chép dữ liệu sự kiện";
vi["overview.event_log_item.copied"] = "Đã sao chép";
vi["overview.event_log_item.copy"] = "Sao chép";
vi["overview.event_log_item.error"] = "Lỗi";
vi["overview.event_log_item.system"] = "Hệ thống";

vi["overview.burn_rate_extra.title"] = "Dự đoán tốc độ tiêu hao";
vi["overview.burn_rate_extra.daily_burn"] = "Tiêu hao hàng ngày";
vi["overview.burn_rate_extra.projected_monthly"] = "Dự kiến hàng tháng";
vi["overview.burn_rate_extra.at_risk"] = "Có rủi ro";
vi["overview.burn_rate_extra.top_cost_drivers"] = "Yếu tố chi phí hàng đầu";
vi["overview.burn_rate_extra.budget_exhaustion_warnings"] = "Cảnh báo cạn ngân sách";
vi["overview.burn_rate_extra.exhausted"] = "Đã cạn";
vi["overview.burn_rate_extra.days_left"] = "còn {days} ngày";

vi["overview.cascade.title"] = "Bản đồ tầng chuỗi";
vi["overview.cascade.no_chains"] = "Không phát hiện chuỗi -- tất cả personas hoạt động độc lập";

vi["overview.predictive_alerts_extra.title"] = "Cảnh báo dự đoán";
vi["overview.predictive_alerts_extra.all_nominal"] = "Tất cả hệ thống bình thường";
vi["overview.predictive_alerts_extra.no_alerts"] = "Không có cảnh báo dự đoán -- tất cả personas trong thông số bình thường.";
vi["overview.predictive_alerts_extra.budget_exhausted"] = "Ngân sách đã cạn";
vi["overview.predictive_alerts_extra.budget_exhaustion_in"] = "Ngân sách cạn trong {days} ngày";
vi["overview.predictive_alerts_extra.failure_spike_predicted"] = "Dự đoán tăng đột biến tỷ lệ thất bại trong {days} ngày";
vi["overview.predictive_alerts_extra.excessive_healing"] = "Hoạt động tự phục hồi quá mức";
vi["overview.predictive_alerts_extra.critical_health"] = "Trạng thái sức khỏe nghiêm trọng";
vi["overview.predictive_alerts_extra.byom_recommendations"] = "Đề xuất định tuyến BYOM";

vi["overview.annotate_modal.title"] = "Thêm chú thích kiến thức";
vi["overview.annotate_modal.persona_label"] = "Persona phân bổ";
vi["overview.annotate_modal.scope_label"] = "Phạm vi";
vi["overview.annotate_modal.tool_name"] = "Tên công cụ";
vi["overview.annotate_modal.connector_type"] = "Loại trình kết nối / Dịch vụ";
vi["overview.annotate_modal.annotation_label"] = "Chú thích";
vi["overview.annotate_modal.cancel"] = "Hủy";
vi["overview.annotate_modal.saving"] = "Đang lưu...";
vi["overview.annotate_modal.save_annotation"] = "Lưu chú thích";

vi["overview.knowledge_row.annotation"] = "Chú thích";
vi["overview.knowledge_row.successes"] = "Thành công";
vi["overview.knowledge_row.failures"] = "Thất bại";
vi["overview.knowledge_row.avg_cost"] = "Chi phí trung bình";
vi["overview.knowledge_row.avg_duration"] = "Thời gian trung bình";
vi["overview.knowledge_row.pattern_data"] = "Dữ liệu mẫu";
vi["overview.knowledge_row.collapse_details"] = "Thu gọn chi tiết";
vi["overview.knowledge_row.expand_details"] = "Mở rộng chi tiết";
vi["overview.knowledge_row.verify_annotation"] = "Xác minh chú thích";
vi["overview.knowledge_row.dismiss_annotation"] = "Bỏ qua chú thích";

vi["overview.focused_decision.accept"] = "Chấp nhận";
vi["overview.focused_decision.reject"] = "Từ chối";
vi["overview.focused_decision.media_unavailable"] = "Phương tiện không khả dụng";

vi["overview.review_focus.all_caught_up"] = "Tất cả xong rồi";
vi["overview.review_focus.no_pending"] = "Không có đánh giá đang chờ để xử lý.";
vi["overview.review_focus.queue"] = "Hàng đợi";
vi["overview.review_focus.clear"] = "Xóa";
vi["overview.review_focus.clear_all_verdicts"] = "Xóa tất cả phán quyết";
vi["overview.review_focus.quick_actions"] = "Thao tác nhanh";
vi["overview.review_focus.reject_all"] = "Từ chối tất cả";
vi["overview.review_focus.accept_all"] = "Chấp nhận tất cả";
vi["overview.review_focus.retry_with_changes"] = "Thử lại với thay đổi";

vi["overview.memory_card.confirm"] = "Xác nhận";
vi["overview.memory_card.cancel"] = "Hủy";

vi["overview.memory_detail.title_label"] = "Tiêu đề";
vi["overview.memory_detail.content_label"] = "Nội dung";
vi["overview.memory_detail.category_label"] = "Danh mục";
vi["overview.memory_detail.importance_label"] = "Tầm quan trọng";
vi["overview.memory_detail.tags_label"] = "Thẻ";
vi["overview.memory_detail.view_source_execution"] = "Xem thực thi nguồn";
vi["overview.memory_detail.delete_memory"] = "Xóa bộ nhớ";
vi["overview.memory_detail.close"] = "Đóng";

vi["overview.memory_table.agent"] = "Tác nhân";
vi["overview.memory_table.title"] = "Tiêu đề";
vi["overview.memory_table.category"] = "Danh mục";
vi["overview.memory_table.priority"] = "Ưu tiên";
vi["overview.memory_table.tags"] = "Thẻ";
vi["overview.memory_table.created"] = "Ngày tạo";

vi["overview.review_results.title"] = "Đánh giá bộ nhớ AI";
vi["overview.review_results.review_failed"] = "Đánh giá thất bại";

vi["overview.anomaly_drilldown_extra.title"] = "Phân tích sâu bất thường";
vi["overview.anomaly_drilldown_extra.value_label"] = "Giá trị:";
vi["overview.anomaly_drilldown_extra.baseline_label"] = "Đường cơ sở:";
vi["overview.anomaly_drilldown_extra.correlating"] = "Đang tương quan sự kiện...";
vi["overview.anomaly_drilldown_extra.likely_root_causes"] = "Nguyên nhân gốc rễ có thể";
vi["overview.anomaly_drilldown_extra.correlated_events"] = "Sự kiện tương quan";
vi["overview.anomaly_drilldown_extra.no_correlated"] = "Không tìm thấy sự kiện tương quan trong cửa sổ ±24h.";

vi["overview.healing_issue_modal.issue_resolved"] = "Vấn đề đã giải quyết";
vi["overview.healing_issue_modal.analysis"] = "Phân tích";
vi["overview.healing_issue_modal.suggested_fix"] = "Đề xuất sửa";
vi["overview.healing_issue_modal.copied"] = "Đã sao chép";
vi["overview.healing_issue_modal.copy_fix"] = "Sao chép cách sửa";
vi["overview.healing_issue_modal.persona_auto_disabled"] = "Persona tự động tắt";
vi["overview.healing_issue_modal.persona_auto_disabled_desc"] = "Persona này tự động bị tắt sau 5 lần thất bại liên tiếp. Hãy xem xét mẫu lỗi bên dưới và bật lại thủ công sau khi đã giải quyết nguyên nhân gốc.";
vi["overview.healing_issue_modal.marking_resolved_note"] = "Đánh dấu đã giải quyết có nghĩa là bạn đã xử lý vấn đề này bên ngoài hệ thống phục hồi.";
vi["overview.healing_issue_modal.retry_in_progress"] = "Đang thử lại -- trạng thái sẽ cập nhật khi hoàn tất";
vi["overview.healing_issue_modal.auto_resolved"] = "Vấn đề này đã tự động giải quyết";
vi["overview.healing_issue_modal.close"] = "Đóng";
vi["overview.healing_issue_modal.resolving"] = "Đang giải quyết…";
vi["overview.healing_issue_modal.mark_resolved"] = "Đánh dấu đã giải quyết";

vi["overview.healing_issues_panel.title"] = "Vấn đề sức khỏe";
vi["overview.healing_issues_panel.analyzing"] = "Đang phân tích...";
vi["overview.healing_issues_panel.run_analysis"] = "Chạy phân tích";
vi["overview.healing_issues_panel.no_open_issues"] = "Không có vấn đề nào mở";
vi["overview.healing_issues_panel.run_analysis_hint"] = "Chạy phân tích để kiểm tra vấn đề.";
vi["overview.healing_issues_panel.healing_audit_log"] = "Nhật ký kiểm tra phục hồi";
vi["overview.healing_issues_panel.no_silent_failures"] = "Không có lỗi thầm lặng nào được ghi.";

vi["overview.healing_timeline.loading"] = "Đang tải dòng thời gian...";
vi["overview.healing_timeline.no_events"] = "Không có sự kiện phục hồi";
vi["overview.healing_timeline.no_events_hint"] = "Chạy phân tích để xây dựng dòng thời gian khả năng phục hồi.";
vi["overview.healing_timeline.knowledge_base"] = "Cơ sở kiến thức";
vi["overview.healing_timeline.patterns_hint"] = "Các mẫu ảnh hưởng đến quyết định phục hồi";

vi["overview.ipc_panel.title"] = "Hiệu suất IPC";
vi["overview.ipc_panel.by_command"] = "Theo lệnh";
vi["overview.ipc_panel.slowest_calls"] = "Lần gọi chậm nhất";
vi["overview.ipc_panel.command"] = "Lệnh";
vi["overview.ipc_panel.calls_header"] = "Số lần gọi";
vi["overview.ipc_panel.duration_header"] = "Thời gian";
vi["overview.ipc_panel.when_header"] = "Khi nào";

vi["overview.system_trace_extra.no_traces"] = "Không có trace hệ thống nào được ghi";
vi["overview.system_trace_extra.no_traces_hint"] = "Trace xuất hiện khi các thao tác thiết kế, thông tin xác thực hoặc mẫu chạy";
vi["overview.system_trace_extra.all_operations"] = "Tất cả thao tác";
vi["overview.system_trace_extra.clear_completed"] = "Xóa trace đã hoàn thành";
vi["overview.system_trace_extra.span"] = "Span";

vi["overview.event_log_sidebar.title"] = "Nhật ký sự kiện";
vi["overview.event_log_sidebar.no_events"] = "Chưa có sự kiện";
vi["overview.event_log_sidebar.open_detail_drawer"] = "Mở trong ngăn chi tiết";

vi["overview.chart_error.chart_unavailable"] = "Biểu đồ không khả dụng";

vi["overview.realtime_idle.idle"] = "Rảnh";

vi["overview.day_range.apply"] = "Áp dụng";

vi["templates.matrix.preparing"] = "Đang chuẩn bị build...";
vi["templates.matrix.analyzing"] = "Đang phân tích ý định của bạn...";
vi["templates.matrix.building"] = "Đang xây dựng chiều tác nhân...";
vi["templates.matrix.waiting_input"] = "Đang chờ đầu vào của bạn...";
vi["templates.matrix.draft_ready"] = "Bản nháp sẵn sàng để xem xét";
vi["templates.matrix.testing"] = "Đang kiểm thử tác nhân...";
vi["templates.matrix.test_complete"] = "Kiểm thử hoàn tất";
vi["templates.matrix.promoted"] = "Tác nhân đã được thăng cấp";
vi["templates.matrix.build_failed"] = "Build thất bại";
vi["templates.matrix.phase_subtext_analyzing"] = "Đang hiểu ý định của bạn...";
vi["templates.matrix.phase_subtext_resolving"] = "Đang xây dựng cấu hình tác nhân...";
vi["templates.matrix.phase_subtext_awaiting_input"] = "Cần đầu vào của bạn — nhấp vào chiều được làm nổi bật";
vi["templates.matrix.phase_subtext_draft_ready"] = "Tất cả chiều đã giải quyết — sẵn sàng kiểm thử";
vi["templates.matrix.dim_tasks"] = "Nhiệm vụ";
vi["templates.matrix.dim_apps"] = "Ứng dụng & Dịch vụ";
vi["templates.matrix.dim_schedule"] = "Khi nào chạy";
vi["templates.matrix.dim_review"] = "Đánh giá con người";
vi["templates.matrix.dim_memory"] = "Bộ nhớ";
vi["templates.matrix.dim_errors"] = "Xử lý lỗi";
vi["templates.matrix.dim_messages"] = "Tin nhắn";
vi["templates.matrix.dim_events"] = "Sự kiện";
vi["templates.matrix.generating"] = "Đang tạo...";
vi["templates.matrix.continue_build"] = "Tiếp tục build";
vi["templates.matrix.all_resolved"] = "Tất cả chiều đã giải quyết";
vi["templates.matrix.answers_ready"] = "{count} câu trả lời sẵn sàng -- nhấp Tiếp tục";
vi["templates.matrix.input_needed"] = "Cần đầu vào của bạn";
vi["templates.matrix.answer_progress"] = "{answered} đã trả lời, {remaining} còn lại";
vi["templates.matrix.cell_edit"] = "Chỉnh sửa";
vi["templates.matrix.cell_done"] = "Xong";
vi["templates.matrix.cancel_test"] = "Hủy kiểm thử";
vi["templates.matrix.test_agent"] = "Kiểm thử tác nhân";
vi["templates.matrix.starting_test"] = "Đang bắt đầu kiểm thử...";
vi["templates.matrix.apply_changes"] = "Áp dụng thay đổi";
vi["templates.matrix.discard"] = "Hủy bỏ";
vi["templates.matrix.build_complete"] = "Build hoàn tất";
vi["templates.matrix.adjust_placeholder"] = "Điều chỉnh bất kỳ điều gì...";
vi["templates.matrix.answer_placeholder"] = "Câu trả lời của bạn...";

vi["templates.page.title"] = "Mẫu tác nhân";
vi["templates.page.subtitle_one"] = "{count} mẫu khả dụng";
vi["templates.page.subtitle_other"] = "{count} mẫu khả dụng";

vi["templates.explore.ready_to_deploy"] = "Sẵn sàng triển khai";
vi["templates.explore.ready_to_deploy_hint"] = "Mẫu có tất cả trình kết nối đã cấu hình";
vi["templates.explore.adoption_count_one"] = "{count} lần áp dụng";
vi["templates.explore.adoption_count_other"] = "{count} lần áp dụng";
vi["templates.explore.popular_in"] = "Phổ biến trong {role}";
vi["templates.explore.configure_to_unlock"] = "Cấu hình trình kết nối để mở khóa mẫu sẵn sàng triển khai";
vi["templates.explore.hero_title"] = "Bạn muốn tự động hóa điều gì?";
vi["templates.explore.hero_subtitle"] = "Duyệt theo trường hợp sử dụng hoặc tìm kiếm mẫu phù hợp với quy trình làm việc.";
vi["templates.explore.hero_search_placeholder"] = "Tìm kiếm mẫu theo từ khóa hoặc mô tả nhu cầu của bạn...";
vi["templates.explore.templates_count_one"] = "{count} mẫu";
vi["templates.explore.templates_count_other"] = "{count} mẫu";
vi["templates.explore.view_all"] = "Xem tất cả";
vi["templates.explore.most_adopted"] = "Được áp dụng nhiều nhất";
vi["templates.explore.whats_your_role"] = "Vai trò của bạn là gì?";
vi["templates.explore.categories_for_role"] = "{count} danh mục với mẫu tác nhân chuyên biệt cho quy trình {role}.";
vi["templates.explore.role_templates"] = "Mẫu {role}";
vi["templates.explore.by_role"] = "Theo vai trò";
vi["templates.explore.by_need"] = "Theo nhu cầu";
vi["templates.explore.classic"] = "Cổ điển";

vi["templates.opportunities.title"] = "Cơ hội tự động hóa";
vi["templates.opportunities.subtitle"] = "Các quy trình bạn có thể mở khóa";
vi["templates.opportunities.ready_now"] = "Sẵn sàng ngay";
vi["templates.opportunities.add_connector"] = "Thêm";
vi["templates.opportunities.unlock_more"] = "để mở khóa thêm {count}";
vi["templates.opportunities.explore_templates"] = "Khám phá mẫu {label}";

vi["templates.recommended.title"] = "Đề xuất cho bạn";
vi["templates.recommended.subtitle"] = "Dựa trên trình kết nối của bạn";
vi["templates.recommended.no_recommendations"] = "Chưa có đề xuất nào.";

vi["templates.trending.title"] = "Được áp dụng nhiều nhất tuần này";

vi["templates.empty.no_templates"] = "Chưa có mẫu nào được tạo";
vi["templates.empty.no_templates_hint"] = "Dùng nút Tổng hợp nhóm trong tiêu đề hoặc kỹ năng Claude Code để tạo mẫu.";
vi["templates.empty.no_search_results"] = "Không có mẫu phù hợp";
vi["templates.empty.no_search_results_hint"] = "Hãy thử điều chỉnh cụm từ tìm kiếm hoặc bộ lọc.";
vi["templates.empty.clear_search"] = "Xóa tìm kiếm";
vi["templates.empty.waiting_for_draft"] = "Đang chờ bản nháp persona";
vi["templates.empty.waiting_for_draft_hint"] = "AI đang tạo bản nháp dựa trên lựa chọn của bạn. Thường mất vài giây.";

vi["templates.banners.draft_prefix"] = "Bản nháp: ";
vi["templates.banners.step_click_resume"] = "Bước: {step} -- nhấp để tiếp tục";
vi["templates.banners.discard_draft"] = "Hủy bản nháp";
vi["templates.banners.adoption_in_progress"] = "Đang áp dụng mẫu";
vi["templates.banners.click_to_view_progress"] = "Nhấp để xem tiến trình";
vi["templates.banners.rebuilding"] = "Đang xây dựng lại: {name}";
vi["templates.banners.status_testing"] = "Đang kiểm thử";
vi["templates.banners.status_completed"] = "Đã hoàn tất";
vi["templates.banners.status_failed"] = "Thất bại";
vi["templates.banners.click_to_view_result"] = "Nhấp để xem kết quả";
vi["templates.banners.click_to_view_output"] = "Nhấp để xem đầu ra";

vi["templates.search.switch_to_keyword"] = "Chuyển sang tìm kiếm theo từ khóa";
vi["templates.search.switch_to_ai"] = "Chuyển sang tìm kiếm AI";
vi["templates.search.few_results"] = "Tìm thấy ít kết quả";
vi["templates.search.try_ai_search"] = "Thử tìm kiếm AI";

console.log('Part 7 done. Keys:', Object.keys(vi).length);
fs.writeFileSync('C:/Users/kazda/kiro/personas/.planning/i18n/translated-vi.json', JSON.stringify(vi, null, 2), 'utf8');
