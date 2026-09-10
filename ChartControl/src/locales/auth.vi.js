/* ============================================================
   Tiếng Việt — 인증 화면 (pages-auth.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.

   ★ 빠진 키는 i18n 이 en 으로 자동 폴백한다(src/i18n.js fallback='en').
   ★ {brand} {step} {total} {email} 같은 치환자는 **그대로 남겨야 한다.**
     번역하거나 지우면 화면에 값이 채워지지 않는다.
   ★ 금융 성과를 약속하는 표현을 넣지 않는다 — 이 제품은 차트 분석 도구이고
     실주문이 고객 거래소 계정으로 나간다. 원문의 면책 톤을 유지한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'vi',
    {
      // --- 공용 푸터 / 브랜드 패널 ---
      auth_3b9e30: 'Điều khoản',
      auth_d629d0: 'Bảo mật',
      auth_a5e5da: 'An toàn',
      auth_e2654a: 'Trợ giúp',
      auth_77edb5: 'Đặt câu hỏi về bất kỳ biểu đồ nào.',
      auth_9ab22f: 'bạn toàn quyền kiểm soát mọi lệnh.',
      auth_7e2510:
        '{brand} là phần mềm phân tích biểu đồ. Hãy hỏi về biểu đồ bằng lời lẽ thông thường và AI sẽ giải thích '
        + 'các chỉ báo đang cho thấy điều gì; nếu bạn quyết định hành động, lệnh sẽ được thực hiện trên chính tài '
        + 'khoản sàn của bạn sau khi bạn phê duyệt. Chúng tôi không giữ tiền của bạn, không quản lý tiền của bạn, '
        + 'và không khuyến nghị bạn nên mua gì.',
      auth_833f52: 'Ngôn ngữ thông thường → bạn vẽ overlay → tự dựng thiết lập của mình',
      auth_66cdd9: 'Kéo, đổi kích thước và lưu preset bố cục của riêng bạn',
      auth_2d0495: 'Phê duyệt ≠ Gửi lệnh · kiểm tra rủi ro nhiều lớp',

      // --- 로그인 ---
      login_e225a6: 'Đăng nhập',
      login_3f05db: 'Đăng nhập vào tài khoản {brand} của bạn',
      login_92c6f3: 'Quên mật khẩu',
      login_a89650: 'Ghi nhớ thiết bị này (30 ngày)',
      login_33c1f7: 'Đang xác minh…',
      login_e2d231: 'Đăng nhập →',
      login_46bed0: 'hoặc',
      login_68a92d: 'Chưa có tài khoản?',
      login_49f561: 'Đăng ký →',
      login_13d6ae: 'Nhập email và mật khẩu bất kỳ, rồi nhập mã 2FA 6 chữ số bất kỳ để vào ứng dụng',
      login_241c96: 'Xác minh →',
      login_f3047a: 'Chưa nhận được mã?',
      login_6adb8b: 'Gửi lại qua SMS',
      login_f787eb: '← Quay lại',

      // --- 회원가입 ---
      signup_ecb4cc: 'Tạo tài khoản',
      signup_a6f945: 'Chỉ mất khoảng một phút',
      signup_1ff941: 'Tài khoản',
      signup_32b217: 'Email',
      signup_d284fa: 'KYC',
      signup_10c83d: 'Tối thiểu 10 ký tự',
      signup_711154: 'Nhập lại mật khẩu',
      signup_5ca401: 'Mật khẩu phải có ít nhất 8 ký tự',
      signup_dd3243: 'Mật khẩu không khớp',
      signup_591c17: 'Rất yếu',
      signup_24bb15: 'Yếu',
      signup_2179da: 'Trung bình',
      signup_5f67e6: 'Mạnh',
      signup_dff519: 'Rất mạnh',
      signup_b329a3: '🇰🇷 Hàn Quốc',
      signup_44650a: 'Khác',
      signup_75a112: 'Tôi đồng ý (bắt buộc)',
      signup_532136: 'Chính sách bảo mật',
      signup_21e2e3: 'Nhận email tiếp thị (không bắt buộc)',
      signup_24cd06: 'Đang xử lý…',
      signup_3929bb: 'Tạo tài khoản →',
      signup_9922a0: 'Đã có tài khoản?',

      // --- 이메일 인증 ---
      email_verify_5eb00e: 'Chúng tôi đã gửi liên kết xác minh đến email của bạn. Hãy mở liên kết để xác minh, sau đó đăng nhập.',
      email_verify_0fa353: 'Nếu không thấy, hãy kiểm tra thư mục spam.',
      email_verify_37a414: 'Gửi lại',
      email_verify_089bb3: '✓ Đã gửi lại',
      email_verify_455f7c: 'Tiếp tục →',

      // --- KYC ---
      k_y_c_onboarding_5f6780: 'Xác minh danh tính (KYC)',
      k_y_c_onboarding_9334ed: '👤 Thông tin cơ bản',
      k_y_c_onboarding_31fbff: 'Ngày sinh',
      k_y_c_onboarding_ff63ca: 'Quốc tịch',
      k_y_c_onboarding_c22557: 'Chọn',
      k_y_c_onboarding_ebce71: '🏠 Địa chỉ',
      k_y_c_onboarding_dad291: 'Địa chỉ dòng 2',
      k_y_c_onboarding_02220b: 'Giấy tờ chứng minh địa chỉ sẽ được tải lên ở bước sau.',
      k_y_c_onboarding_8ff495: '🪪 Giấy tờ tùy thân · ảnh selfie',
      k_y_c_onboarding_3f327d: 'Chọn loại giấy tờ của bạn.',
      k_y_c_onboarding_3ba1d5: 'Căn cước công dân',
      k_y_c_onboarding_311122: 'Giấy phép lái xe',
      k_y_c_onboarding_8e5bec: 'Hộ chiếu',
      k_y_c_onboarding_26c302: 'Mặt trước giấy tờ',
      k_y_c_onboarding_2b9e56: 'Mặt sau giấy tờ',
      k_y_c_onboarding_f8bbc7: 'Không cần thiết với hộ chiếu',
      k_y_c_onboarding_51672c: 'Tải lên',
      k_y_c_onboarding_6cfe7d: 'JPG · PNG · PDF (tối đa 10MB)',
      k_y_c_onboarding_de4a5c: 'Ảnh selfie trực tiếp',
      k_y_c_onboarding_90745c: 'Chụp khuôn mặt cùng với giấy tờ tùy thân của bạn',
      k_y_c_onboarding_e07e2e: 'Mở camera',
      k_y_c_onboarding_0f797f: '📋 Nguồn tiền · mục đích',
      k_y_c_onboarding_f01127: 'Nguồn tiền',
      k_y_c_onboarding_edd43e: 'Thu nhập từ việc làm',
      k_y_c_onboarding_7fb985: 'Thu nhập từ kinh doanh',
      k_y_c_onboarding_f27c14: 'Lợi nhuận đầu tư',
      k_y_c_onboarding_98ae59: 'Tiền tiết kiệm',
      k_y_c_onboarding_7340b7: 'Thừa kế hoặc quà tặng',
      k_y_c_onboarding_898ed0: 'Mục đích giao dịch',
      k_y_c_onboarding_aa6c8f: 'Đầu tư dài hạn',
      k_y_c_onboarding_e18ea9: 'Đầu cơ · lợi nhuận ngắn hạn',
      k_y_c_onboarding_5d5aea: 'Phòng hộ · quản trị rủi ro',
      k_y_c_onboarding_d66780: 'Arbitrage',
      k_y_c_onboarding_810016: '← Quay lại',
      k_y_c_onboarding_c5798c: 'Tiếp →',
      k_y_c_onboarding_4f67fa: 'Gửi để xét duyệt →',
      k_y_c_onboarding_dc301f: 'Đã gửi để xét duyệt',
      k_y_c_onboarding_2ecb11: 'Đã gửi KYC 🎉',
      k_y_c_onboarding_55af46: 'Được duyệt trong 1-24 giờ · bạn sẽ được thông báo qua email',
      k_y_c_onboarding_03e1e5: 'Bắt đầu dùng ứng dụng →',
      kyc_step_progress: 'Bước {step} / {total} · khoảng 3-5 phút',

      // --- 비밀번호 재설정 ---
      password_reset_8d8082: 'Đặt lại mật khẩu',
      password_reset_d196c8: 'Chúng tôi sẽ gửi liên kết đặt lại đến địa chỉ email đã đăng ký của bạn',
      password_reset_7badb1: 'Gửi liên kết đặt lại →',
      password_reset_5ee6ba: '← Quay lại đăng nhập',
      password_reset_d09993: 'Đã gửi email',
      password_reset_a40b90: 'Đến trang đăng nhập →',
      pwreset_link_sent: 'Đã gửi liên kết đặt lại tới {email}.',

      // --- 랜딩 ---
      landing_66a662: 'Chúng tôi là một công ty phần mềm. Chúng tôi không giữ tiền của bạn, không quản lý tiền của bạn, và không nói cho bạn biết nên mua gì.',
      landing_7bbd5b: 'Bắt đầu miễn phí',
      landing_1ea899: 'Xem demo',
      landing_4c1fc3: 'Đừng căng mắt dò biểu đồ nữa',
      landing_af3947: ' — chỉ cần hỏi.',
      landing_5f6b64: 'Nói cho ChartControl AI biết bạn muốn xem gì, nó sẽ vẽ hỗ trợ, kháng cự, đường xu hướng và chỉ báo lên biểu đồ trước mắt bạn. Mức giá của bạn, quyết định của bạn — chỉ trong vài giây thay vì vài phút.',
      landing_44cbb3: 'Kéo và đổi kích thước tự do · 7 preset (Standard / Scalper / Multi / AI và nhiều hơn)',
      landing_40f668: 'AI phê duyệt ≠ gửi lệnh · kiểm tra rủi ro 9 lớp · luôn hiển thị dải simulation',
      landing_69704c: 'Thẻ tâm lý · hiệu suất theo thời điểm trong ngày · tự động phát hiện mô hình',
      landing_1351e7: 'Cho người mới',
      landing_74f8f5: 'Cho trader toàn thời gian',
      landing_b7f95d: 'Tổ chức · tần suất cao',
      landing_b8adca: 'Bắt đầu miễn phí',
      landing_0077f3: 'Bắt đầu Pro',
      landing_531f6a: 'Liên hệ với chúng tôi',
      landing_0fc1ee: 'Liên hệ',
      landing_04b7df: '/tháng',
      landing_9c7f54: '5 mã yêu thích',
      landing_4f403f: 'Tất cả các mã',
      landing_724991: 'Công cụ biểu đồ AI · 5 lần/ngày',
      landing_6e9bb1: 'Công cụ biểu đồ AI · không giới hạn',
      landing_8466e2: 'Chỉ báo cốt lõi',
      landing_d3219e: 'Giao dịch cốt lõi',
      landing_bc5424: 'Đa biểu đồ',
      landing_c3d5f3: 'Loại lệnh nâng cao',
      landing_1a4272: 'Backtest chiến lược',
      landing_91e9d6: 'Cảnh báo thời gian thực',
      landing_633158: 'Quản lý tài khoản riêng',
      landing_6587f1: 'API riêng',
      landing_860f96: 'Thương lượng phí',
      landing_0af146: 'Tùy chọn on-premise',

      // --- 404 ---
      not_found_eeedd6: 'Chúng tôi không tìm thấy trang đó',
      not_found_9acdbe: 'Địa chỉ có thể sai hoặc trang đã bị xóa.',
      not_found_e62d56: 'Hãy thử một trong các trang sau:',
      not_found_e87cf6: 'Giao dịch →',
      not_found_7f5914: 'Thị trường',
      not_found_d9477a: 'Danh mục',
      not_found_1c767f: 'Trang chủ →',
    },
    { label: 'Tiếng Việt', bcp47: 'vi' },
  );
})();
