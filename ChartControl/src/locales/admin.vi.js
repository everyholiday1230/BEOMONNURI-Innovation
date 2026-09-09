/* ============================================================
   Tiếng Việt — 관리자 화면 (pages-admin.jsx / pages-admin-more.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {tab} {n} {pending} 치환자는 그대로 남긴다.
   ★ 사람 이름(Dohyun Kim · Kuri Kwon)은 표본 데이터다 — 번역하지 않는다.
   ★ 화면 문자열에 그대로 쓰이는 HTML 엔티티(&#10;)는 유지한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'vi',
    {
      // --- 대시보드 / 목록 부제 ---
      admin_dashboard_0ccafd: 'Trạng thái nền tảng trực tiếp · bất thường · rủi ro · AI · hệ thống',
      admin_users_3fefdf: 'Tìm tên · email · ID',
      admin_trades_bc077b: 'Lệnh trực tiếp · khớp lệnh · phát hiện bất thường',
      admin_risk_a1edf2: 'Mức phơi nhiễm vị thế · hàng đợi thanh lý · rủi ro thị trường',
      admin_fees_65feac: 'Bậc phí · hoàn phí · khuyến mãi · hoàn tiền',
      admin_notices_15d236: 'Thông báo',
      admin_notices_11300f: 'Đăng thông báo · quản lý yêu cầu của khách hàng',

      // --- 사용자 상세 ---
      admin_user_detail_106e43: 'Tìm kiếm · lọc · xuất CSV',
      admin_user_detail_170f7b: 'Ngày tham gia',
      admin_user_detail_22d6d2: 'Khối lượng 30 ngày',
      admin_user_detail_33103c: 'Phí lũy kế',
      admin_user_detail_3f4319: 'Giấy tờ tùy thân',
      admin_user_detail_0057bd: 'Tài liệu KYC',
      admin_user_detail_43a4e1: 'Nhật ký hoạt động',
      admin_user_detail_8f5d10: 'Nhật ký hoạt động · 20 mục gần nhất',
      admin_user_detail_8797eb: 'Lịch sử giao dịch',
      admin_user_detail_80a094: 'Lịch sử giao dịch',
      admin_user_detail_81922a: 'Vị thế',
      admin_user_detail_40ce13: 'Tài sản',
      admin_user_detail_e4ec3e: 'Xem tài sản',
      admin_user_detail_a5e5da: 'Bảo mật',
      admin_user_detail_8dd7e4: 'Sự kiện bảo mật',
      admin_user_detail_915cf6: 'Ghi chú của nhân viên',
      admin_user_detail_f35682: 'Ghi chú của nhân viên (được lưu vào sổ kiểm toán)',
      admin_user_detail_12614e: 'Dòng thời gian · dạng tổng hợp',
      admin_user_detail_d65b24: 'Tự động tính',
      admin_user_detail_44650a: 'Khác',
      admin_user_detail_a43b70: 'Kết quả xét duyệt KYC',
      admin_user_detail_a74a3f: 'Cần xác minh KYC lại',
      admin_user_detail_851473: 'Yêu cầu KYC lại',
      admin_user_detail_219da4: 'Nâng lên L3',
      admin_user_detail_afc528: 'Yêu cầu xét duyệt lại',
      admin_user_detail_a1d12d: 'Phát hiện giao dịch bất thường',
      admin_user_detail_2d003e: 'Vấn đề AML/CTF',
      admin_user_detail_ca5360: 'Yêu cầu của người dùng',
      admin_user_detail_63c279: 'Lý do',
      admin_user_detail_96330a: 'Nội dung',
      admin_user_detail_941ad1: 'Gửi email',
      admin_user_detail_04f2aa: 'Gửi liên kết đặt lại qua email',
      admin_user_detail_e03d2f: 'Đặt lại 2FA',
      admin_user_detail_82d3e7: 'Tạm ngưng tài khoản',
      admin_user_detail_94cd06: '⚠ Tạm ngưng tài khoản',
      admin_user_detail_1d441e: 'Tạm ngưng',
      admin_user_detail_f63bf7: 'Bỏ tạm ngưng',
      admin_user_detail_ebe503: 'Bạn có chắc muốn tạm ngưng người dùng này?',
      admin_user_detail_bd464c: 'Khi tạm ngưng, người dùng sẽ được thông báo qua email tự động và hành động này được lưu vào sổ kiểm toán.',
      admin_user_detail_ff8aa0: 'Xác nhận tạm ngưng',
      admin_user_detail_19b2d1: 'Hủy',
      admin_user_detail_4def42: 'Đã tạm ngưng người dùng (mô phỏng)',
      admin_user_tab_data: 'Đang hiển thị dữ liệu {tab} của người dùng này',
      admin_users_subtitle: 'Tổng {n} người dùng · KYC · quyền · tạm ngưng · kiểm toán',

      // --- KYC 심사 ---
      admin_k_y_c_queue_46072a: 'Xét duyệt KYC',
      admin_k_y_c_queue_d167fe: 'Dohyun Kim',
      admin_kyc_sla: '{pending} đang chờ · SLA 24 giờ',
      flag_auto_detected: ' · tự động phát hiện · ',
      flag_investigate: 'điều tra',

      // --- 입출금 승인 ---
      admin_deposits_e9e567: 'Phê duyệt nạp tiền',
      admin_deposits_48f252: 'Hàng đợi nạp tiền',
      admin_deposits_df0901: 'Nạp tiền on-chain · xác nhận · xét duyệt AML',
      admin_withdrawals_372dac: 'Phê duyệt rút tiền',
      admin_withdrawals_d336c8: 'Hàng đợi rút tiền',
      admin_withdrawals_4af6f5: 'Đã xong 2FA · yêu cầu rút tiền đang chờ',

      // --- 지갑 / 자산 ---
      admin_assets_7c2e10: 'Ví · phê duyệt nạp và rút · luân chuyển tài sản',
      admin_assets_16f852: 'Tổng số dư ví (hot / cold)',
      admin_assets_d52d75: 'Hàng đợi phê duyệt nạp và rút',
      admin_assets_293d08: 'Luân chuyển tài sản · đối chiếu (batch hằng đêm)',
      admin_assets_657644: 'Bộ lọc cảnh báo AML',
      admin_assets_hi_fi_60cb06: 'Ví · luân chuyển tài sản · đối chiếu',
      admin_assets_hi_fi_dc00b9: 'Ví hot · theo tài sản',
      admin_assets_hi_fi_24e2e8: 'Ví cold · theo tài sản',
      admin_assets_hi_fi_503c9d: 'Có thể rút ngay',
      admin_assets_hi_fi_4b4b97: 'So với số dư người dùng',
      admin_assets_hi_fi_48aeb1: 'Yêu cầu luân chuyển tài sản (hot → cold, cold → hot)',

      // --- AI Ops ---
      admin_a_i_ops_50ede2: '💡 v1.4.2 cải thiện tỷ lệ chính xác 7 điểm phần trăm so với v1.3.9. Đề xuất chuyển toàn bộ lưu lượng vào cuối tuần này.',
      admin_a_i_ops_ed2648: '3 ngày trước · Kuri Kwon',

      // --- 공지 에디터 ---
      admin_notice_editor_db8cc8: 'Soạn thông báo',
      admin_notice_editor_3d991a: 'Thông báo mới · hỗ trợ Markdown',
      admin_notice_editor_a2ee94: 'Tiêu đề thông báo',
      admin_notice_editor_c3d57e: 'Nội dung (hỗ trợ Markdown)&#10;&#10;vd:&#10;## Tiêu đề phụ&#10;Viết nội dung của bạn…&#10;- Mục 1&#10;- Mục 2&#10;&#10;**in đậm** · [liên kết](url)',
      admin_notice_editor_a8e5c8: '(không có tiêu đề)',
      admin_notice_editor_c4c626: '(không có nội dung)',
      admin_notice_editor_0a94de: 'Tùy chọn đăng',
      admin_notice_editor_189dd9: '📌 Ghim lên đầu',
      admin_notice_editor_a2fa30: 'Banner trong ứng dụng cho mọi người dùng',
      admin_notice_editor_41c60b: 'Hiện trên trang chủ',
      admin_notice_editor_492974: 'Thông báo đẩy',
      admin_notice_editor_61187b: 'Gửi email',
      admin_notice_editor_11a5df: '(đặt tự động khi đăng)',
      admin_notice_editor_102c1f: 'Kuri Kwon',
      admin_notice_editor_7148d7: 'Đăng',

      // --- 전체 발송 (Broadcast) ---
      admin_broadcast_b7f563: 'Gửi hàng loạt trong ứng dụng · email · push',
      admin_broadcast_f724cc: 'Soạn tin nhắn',
      admin_broadcast_078b3a: 'Tiêu đề',
      admin_broadcast_a7bc1f: 'vd: Khuyến mãi hoàn phí tháng Tám',
      admin_broadcast_c67b87: 'Nội dung',
      admin_broadcast_1a8f0f: 'Hãy viết nội dung. Hỗ trợ Markdown (**in đậm** · `code` · [liên kết](url)).',
      admin_broadcast_90bbad: 'Đối tượng',
      admin_broadcast_95066f: 'Tất cả (1.242)',
      admin_broadcast_be1a1a: 'Chỉ Pro/VIP (642)',
      admin_broadcast_1395f0: 'KYC L3 (312)',
      admin_broadcast_050529: 'Hoạt động trong 7 ngày (820)',
      admin_broadcast_9c1758: 'Bộ lọc tùy chỉnh',
      admin_broadcast_7aeb7e: 'Kênh',
      admin_broadcast_4c0460: 'Phạm vi dự kiến',
      admin_broadcast_140c08: 'Chi phí dự kiến:',
      admin_broadcast_626099: 'Gửi ngay',
      admin_broadcast_1a911b: 'Lên lịch',
      admin_broadcast_265106: 'Lên lịch gửi',
      admin_broadcast_e6f9c4: 'Lưu bản nháp',
      admin_broadcast_f1f368: 'Đã gửi gần đây',
      admin_broadcast_743fe1: '📢 Thông báo bảo trì theo kế hoạch (1.242)',
      admin_broadcast_63c075: '🎉 Khuyến mãi tháng Tám (1.242)',
      admin_broadcast_bc4cc1: '📄 Cập nhật điều khoản dịch vụ (1.242)',
      admin_bc_recipients: 'người nhận · {n} kênh',

      // --- CS 티켓 ---
      admin_c_s_ticket_5c8747: 'Chi tiết ticket',
      admin_c_s_ticket_5c50d9: 'Người dùng',
      admin_c_s_ticket_65b9cf: 'Hồ sơ người dùng',
      admin_c_s_ticket_00ecd1: 'Giao dịch gần đây',
      admin_c_s_ticket_c65f61: 'Hội thoại',
      admin_c_s_ticket_a6c22d: 'Nhập câu trả lời…',
      admin_c_s_ticket_95bf7b: 'Gửi trả lời',
      admin_c_s_ticket_3f0669: 'Lưu (nội bộ)',
      admin_c_s_ticket_15e878: 'Tác vụ nhanh',
      admin_c_s_ticket_efefae: 'Câu trả lời mẫu',
      admin_c_s_ticket_291781: 'Xin chào. Chúng tôi sẽ kiểm tra và phản hồi bạn trong thời gian ngắn. Cảm ơn bạn đã chờ đợi.',
      admin_c_s_ticket_5be08a: 'Một số tài liệu KYC của bạn được chụp quá mờ nên cần xét duyệt lại. Vui lòng gửi lại tại đây: /kyc/resubmit',
      admin_c_s_ticket_165627: 'Vâng, xin hãy xác nhận.',
      admin_c_s_ticket_e31e52: ' — Tôi có một câu hỏi về việc này. Đã vài ngày mà không có tiến triển và tôi thấy khó chịu.',

      // --- Design Ops ---
      admin_design_ops_247f98: 'Token UI · thành phần · quản lý trang · thêm trang và thành phần mới',
      admin_design_ops_127e5c: 'Tạo và thêm trang, thành phần và hộp thoại mới',
      admin_design_ops_631818: 'Trang mới',
      admin_design_ops_ad367e: 'Bắt đầu từ một mẫu',
      admin_design_ops_b31be6: 'Thành phần mới',
      admin_design_ops_376325: 'Thêm vào danh mục thành phần',
      admin_design_ops_b1169b: 'Hộp thoại / modal mới',
      admin_design_ops_23188a: 'Sao chép đoạn mã modal',
      admin_design_ops_454af0: 'Quy trình · quy ước',
      admin_design_ops_341930: 'Tài liệu hướng dẫn',
    },
    { label: 'Tiếng Việt', bcp47: 'vi' },
  );
})();
