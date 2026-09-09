/* ============================================================
   Tiếng Việt — 사용자 화면 (pages-user.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {brand} {msg} 치환자는 그대로 남긴다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'vi',
    {
      // --- Analytics: AI 인사이트 ---
      analytics_19b9a2: 'Các giao dịch dựa trên tín hiệu AI cho kết quả tốt hơn rõ rệt so với giao dịch tự quyết.',
      analytics_c511d6: '✓ Phiên chiều cho kết quả tốt hơn',
      analytics_4b3b6f: 'Giao dịch trong khoảng 12:00–16:00 UTC có PnL trung bình cao hơn 34% so với các giờ khác.',
      analytics_d6aabf: '⚠ Giao dịch khi căng thẳng thua 40% số lần',
      analytics_4fa8b3: 'Vào lệnh khi tâm trạng ở mức "căng thẳng" làm tăng xác suất thua lỗ lên 2,3 lần.',

      // --- Notifications ---
      notifications_f53a6e: 'Bộ lọc',
      notifications_f6bc37: 'Đánh dấu tất cả đã đọc',

      // --- Order history ---
      order_history_ea8391: 'Tất cả lệnh · đang mở · đã khớp · đã hủy',

      // --- Wallet ---
      wallet_ed546c: 'Kết nối sàn giao dịch',
      wallet_95195c: 'Sàn được hỗ trợ · quản lý API key · tài sản · nạp và rút',
      wallet_ea90da: '🎁 Sàn đối tác của {brand}',
      wallet_ceef92: 'Các sàn dưới đây là đối tác của chúng tôi và cung cấp ',
      wallet_cbe9e9: 'hoàn phí giao dịch và tiền thưởng chào mừng',
      wallet_fc0c97: '. Hãy đăng ký qua liên kết giới thiệu, tạo API key, rồi kết nối tại trang này.',
      wallet_ecb4cc: 'Đăng ký',
      wallet_f23807: 'Số dư tài sản',
      wallet_b9ca11: 'Nạp tiền',
      wallet_972169: 'Rút tiền',
      wallet_57177e: 'Đến trang nạp tiền →',
      wallet_d3cdff: 'Đến trang rút tiền →',

      // --- Settings: 탭 ---
      settings_2d430b: 'Hồ sơ · bảo mật · thông báo · API key · trợ năng',
      settings_14fab1: 'Hồ sơ',
      settings_cfaa68: 'Bảo mật · 2FA',
      settings_e29d14: 'Thông báo',
      settings_643822: 'Tùy chọn',
      settings_3a4173: 'Trợ năng',
      settings_5a4346: 'Tài khoản',

      // --- Settings: 프로필 ---
      settings_0d64b7: 'Thông tin hồ sơ',
      settings_b7909f: 'Đổi ảnh',
      settings_9aa18e: 'Tên',
      settings_3c3776: 'Email',
      settings_84b6d0: 'Quốc gia',
      settings_76245e: 'Múi giờ',
      settings_6e081b: 'Tiếng Hàn',
      settings_1f1712: 'Lưu',
      settings_19b2d1: 'Hủy',

      // --- Settings: 보안 ---
      settings_965a8c: 'Mật khẩu & 2FA',
      settings_819738: 'Mật khẩu',
      settings_9074af: 'Đổi lần cuối 63 ngày trước',
      settings_ce0109: 'Đổi',
      settings_a5d18c: 'Xác thực hai yếu tố (TOTP)',
      settings_e33c1f: '✓ Đã bật · Google Authenticator',
      settings_ee3963: 'Đặt lại',
      settings_872543: 'Xác minh qua SMS',
      settings_4bd28a: 'Phiên đăng nhập',
      settings_2ac6ff: '3 phiên đang hoạt động',
      settings_b7a78a: 'Phiên hiện tại',
      settings_3c8a15: '2 ngày trước · ⚠ vị trí khác',
      settings_cafdc6: 'Kết thúc',
      settings_8eb853: 'API key sàn đã kết nối · quyền · giới hạn IP',

      // --- Settings: 알림 ---
      settings_16930c: 'Cài đặt thông báo',
      settings_b83309: 'Đã tạo tín hiệu AI',
      settings_37397b: 'Lệnh đã khớp · đã hủy',
      settings_716902: 'Cảnh báo margin · thanh lý',
      settings_15d236: 'Thông báo chung',
      settings_2207de: 'Khuyến mãi · sự kiện',

      // --- Settings: 접근성 ---
      settings_12d487: 'Giảm chuyển động',
      settings_dc3d8a: 'Giảm thiểu hiệu ứng và chuyển cảnh (WCAG 2.3.3)',
      settings_02bb1c: 'Tương phản cao',
      settings_a63c4a: 'Tương phản màu mạnh hơn (WCAG AAA)',
      settings_a5d169: 'Hỗ trợ người mù màu',
      settings_3f9048: 'Hiển thị long/short kèm hoa văn và biểu tượng',
      settings_c56d3c: 'Chữ lớn',
      settings_bbb99f: 'Tăng mọi cỡ chữ thêm 20%',
      settings_816538: 'Viền tiêu điểm đậm',
      settings_fa2fee: 'Viền 2px → 3px · nhấn mạnh màu',
      settings_c35257: 'Chế độ chỉ dùng bàn phím',
      settings_4599e3: 'Dùng được mọi chức năng mà không cần chuột',
      settings_625fc6: 'Tối ưu cho trình đọc màn hình',
      settings_da0cf0: 'Nhãn ARIA đầy đủ hơn · thứ tự duyệt được sắp lại',
      settings_a2d19e: 'Khôi phục mặc định',

      // --- Settings: 데이터 / 계정 ---
      settings_be6117: 'Quản lý dữ liệu',
      settings_2508a1: 'Tải dữ liệu về (GDPR)',
      settings_d15b63: 'Xuất toàn bộ tài khoản, giao dịch và cài đặt dưới dạng JSON',
      settings_74e36c: 'Yêu cầu',
      settings_0207e4: 'Tải nhật ký sử dụng API',
      settings_c523ec: '90 ngày gần nhất · CSV',
      settings_f1d559: '⚠ Vùng nguy hiểm',
      settings_7cbf79: 'Tạm ngưng tài khoản',
      settings_4957e1: 'Vô hiệu hóa tối đa 90 ngày · có thể kích hoạt lại sau',
      settings_340d4e: 'Tạm ngưng',
      settings_009e27: 'Xóa tài khoản vĩnh viễn',
      settings_560adc: 'Xóa toàn bộ dữ liệu · không thể phục hồi · cần 2FA + xác nhận qua email',
      settings_254a82: 'Yêu cầu xóa',

      wal_revoke_confirm: 'Thu hồi API key này? Việc đặt lệnh và đọc số dư sẽ dừng ngay lập tức. Không thể hoàn tác — sau đó bạn có thể kết nối key mới.',
      wal_revoke_failed: 'Không thể thu hồi key: {msg}. Key vẫn đang hoạt động — hãy thử lại, hoặc xóa nó tại sàn giao dịch.',

      strat_needs_key: 'Hãy kết nối API key của sàn để dùng chức năng này — đây là các chiến lược ví dụ.',
    },
    { label: 'Tiếng Việt', bcp47: 'vi' },
  );
})();
