// TODO(i18n-vi): translate from English placeholders. Structure must match en.ts exactly.
export const vi = {
  settings: {
    byom: {
      sidebarLabel: 'Nhà cung cấp mô hình',
      title: 'Nhà cung cấp mô hình',
      subtitle: 'Chọn mô hình AI mà các tác tử của bạn sử dụng',
      loadingSubtitle: 'Đang tải...',
      policyToggleTitle: 'Quy tắc nhà cung cấp mô hình',
      policyToggleDescription: 'Khi bật, việc chọn nhà cung cấp tuân theo các quy tắc bạn đã cấu hình',
      policyToggleLabel: 'Quy tắc nhà cung cấp mô hình',
      corruptTitle: 'Chính sách nhà cung cấp mô hình bị hỏng',
      unsavedSection: 'Chính sách nhà cung cấp mô hình',
    },
    qualityGates: {
      sidebarLabel: 'Bộ lọc nội dung',
      title: 'Bộ lọc nội dung',
      subtitle: '{count} quy tắc lọc đang hoạt động',
      loadingSubtitle: 'Đang tải...',
      errorSubtitle: 'Lỗi khi tải cấu hình',
      description:
        'Bộ lọc nội dung xem xét các bộ nhớ và đánh giá do AI tạo ra trong quá trình thực thi. ' +
        'Các mẫu được so khớp dưới dạng chuỗi con với tiêu đề và nội dung kết hợp của mỗi lần gửi. ' +
        'Khi một mẫu khớp, hành động đã cấu hình sẽ được áp dụng. Các bộ lọc này ngăn nhiễu vận hành làm ô nhiễm cơ sở tri thức của bạn.',
      loadingMessage: 'Đang tải cấu hình bộ lọc nội dung...',
    },
    configResolution: {
      sidebarLabel: 'Cấu hình tác tử',
      title: 'Tổng quan cấu hình tác tử',
      subtitle: 'Hiển thị tầng nào (tác tử / không gian làm việc / toàn cục) cung cấp mỗi cài đặt cho mỗi tác tử',
    },
    ambientContext: {
      title: 'Nhận biết màn hình',
      toggleLabel: 'Nhận biết màn hình',
      description:
        'Nhận biết màn hình thu thập tín hiệu clipboard, thay đổi tệp và tiêu điểm ứng dụng để cung cấp cho tác tử của bạn nhận thức về quy trình làm việc trên màn hình.',
    },
  },
};
