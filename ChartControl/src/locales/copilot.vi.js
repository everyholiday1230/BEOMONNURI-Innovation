/* ============================================================
   Tiếng Việt — AI Copilot 사전
   ------------------------------------------------------------
   ★ 마크다운 기호(**강조**, - 목록, \n\n)를 그대로 유지한다.
   ★ 치환자 {symbol} {tf} {bars} {n} {brand} {price} {time} {fields} {done}
     {skipped} {from} {to} {lo} {hi} {items} {name} {detail} {text} 는 그대로 남긴다.
   ★★ ai_fu_* 에 매수·매도 권유 문구를 넣지 않는다. 투자자문 등록이 없다.
     제안은 검증·위험 점검·복기 범위로 제한한다.
   ★ 도구 이름(get_candles 등)은 번역하지 않는다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'vi',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'Đang thu thập dữ liệu biểu đồ · BTC/USDT 15m · 220 nến',
      ai_think_swinglow: 'Đang phát hiện các đáy swing gần đây (kiểm tra phân kỳ RSI)',
      ai_think_trendcand: 'Đã tìm được hai đáy hoặc hơn → đang tính các đường xu hướng khả dĩ',
      ai_think_mtf: 'Đang kiểm tra sự đồng thuận đa khung thời gian (15m / 1H / 4H)',
      ai_think_atr: 'Đang tính khoảng vào lệnh và cắt lỗ từ ATR',
      ai_think_rr: 'Đang mô phỏng ba phương án tối ưu R:R',
      ai_think_swings: 'Đang quét các đỉnh và đáy swing chính',
      ai_think_volnodes: 'Đang trích xuất các vùng khối lượng lớn',
      ai_think_context: 'Đang đọc ngữ cảnh',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'Đã tải ngữ cảnh. {symbol} · {tf} · {bars} nến.',
      ai_ctx_loaded_ind: 'Đã tải ngữ cảnh. {symbol} · {tf} · {bars} nến · {n} chỉ báo đang bật.',
      ai_welcome_beginner:
        'Xin chào, đây là Copilot của {brand}. Tôi đang phân tích biểu đồ **{symbol}**. '
        + 'Hãy hỏi tôi bằng lời lẽ thông thường và tôi có thể vẽ đường xu hướng, hỗ trợ và kháng cự trực tiếp trên biểu đồ, '
        + 'và đề xuất các mức vào lệnh, cắt lỗ và chốt lời. Tôi là một công cụ — lệnh thật chỉ được đặt sau khi bạn phê duyệt lần cuối.',
      ai_welcome_pro:
        'Copilot đã sẵn sàng. Mã: **{symbol}** · TF: **{tf}** · Giá cuối: **{price}** · Dữ liệu tính đến {time}. '
        + 'Hãy yêu cầu đường xu hướng, S/R, vào lệnh/SL/TP, R:R.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 Đã thêm đường xu hướng nháp vào biểu đồ · lớp: AI Draft',
      ai_overlay_updated: '✏️ Đã cập nhật {fields}',
      ai_overlay_updated_partial: '✏️ Đã cập nhật {done}. Không thể thay đổi {skipped} — màu và độ dày của đường do biểu đồ quy định và không điều chỉnh được.',
      ai_overlay_update_unsupported: 'Tôi không thể thay đổi {fields}. Màu và độ dày của đường do biểu đồ quy định (nét AI là nét gạch, đường của bạn là nét liền) và không thể điều chỉnh từ đây.',
      ai_drew_trendline: '📐 Đã vẽ đường xu hướng từ {from} đến {to}',
      ai_drew_level: '📍 Đã vẽ một mức tại {price}',
      ai_drew_support: '📍 Đã vẽ hỗ trợ tại {price}',
      ai_drew_resistance: '📍 Đã vẽ kháng cự tại {price}',
      ai_drew_entry_zone: '🎯 Đã vẽ vùng vào lệnh {lo} – {hi}',
      ai_drew_stop: '🛑 Đã vẽ đường cắt lỗ tại {price}',
      ai_drew_target: '🎯 Đã vẽ mục tiêu {n} tại {price}',
      ai_drew_invalidation: '⚠ Đã vẽ mức vô hiệu tại {price}',
      ai_drew_long_marker: '▲ Đã đánh dấu long tại {price}',
      ai_drew_short_marker: '▼ Đã đánh dấu short tại {price}',
      sv_plan_required: 'Việc lưu cần gói trả phí',
      sv_name_label: 'Đặt tên cho mục này',
      sv_save: 'Lưu',
      ai_my_setup: '◉ THIẾT LẬP CỦA TÔI',
      ai_setup_checked: 'ĐÃ KIỂM TRA',
      ai_setup_missing: 'Còn thiếu',
      ai_setup_against: 'Bằng chứng ngược lại thiết lập của bạn',
      ai_setup_against_hint: 'Đây không phải lý do để dừng — đây là điều mà thiết lập của bạn phải trụ được.',
      ai_setup_drawn: '📊 Đã vẽ {n} trên biểu đồ · {items}',
      ai_setup_nothing_drawn: 'Không vẽ được gì — thiết lập không có mức nào dùng được.',
      ai_setup_no_entry: 'Thiết lập này không có giá vào lệnh nên không thể chuẩn bị bản nháp.',
      toast_draft_failed: 'Không thể chuẩn bị bản nháp',
      ai_step_validating: 'Đang kiểm tra yêu cầu',
      ai_step_tool: 'Đang dùng {name}',
      ai_tool_edited: '✍️ Đã áp dụng thay đổi của bạn · {detail}',
      ai_hint_drag: '📌 Hãy kéo các vòng tròn ở hai đầu đường xu hướng để điều chỉnh. Thay đổi của bạn được phản ánh trong cuộc hội thoại.',
      ai_invalidation_note: '· tín hiệu tự động bị vô hiệu khi điều kiện này xảy ra',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'Đây là những gì tôi tìm được. Tôi đã vẽ một đường xu hướng tăng nối hai đáy gần nhất.\n\n'
        + '- **Hiệu lực**: còn hiệu lực khi nó giữ được vai trò hỗ trợ 3 lần trở lên mà không tạo đáy mới\n'
        + '- **Vô hiệu**: nến 15m đóng dưới đường này\n'
        + '- **Lưu ý**: đường xu hướng là một tham chiếu, không phải một quyết định. Hãy xác nhận bằng các chỉ báo khác.\n\n'
        + 'Tôi cũng có thể thêm các mức hỗ trợ và kháng cự nếu bạn muốn.',
      ai_reply_trendline_pro:
        'Đã vẽ đường xu hướng từ đáy swing **A** đến **B**.\n\n'
        + '- Độ dốc: +42,6 USDT / nến 15m\n'
        + '- Số lần chạm: 3\n'
        + '- Vô hiệu: nến 15m đóng < đường\n'
        + '- Phân kỳ RSI: không thấy\n'
        + '- Hấp thụ trên sổ lệnh gần đường: BID 68.150 (+3,2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'Đã phân tích xong. Tôi đặt một **kịch bản vào lệnh long** trong thẻ bên dưới.\n\n'
        + '- **Vùng vào lệnh**: vào từng phần trong khoảng 68.120 đến 68.360\n'
        + '- **Cắt lỗ**: thoát ngay khi phá 67.480 (khoảng -1,1%)\n'
        + '- **Mục tiêu**: ba mức (68.980 / 69.640 / 70.420)\n'
        + '- **Rủi ro/lợi nhuận**: 1 : 2,8\n'
        + '- **Độ tin cậy**: 74% (một số phần chưa hoàn toàn chắc chắn)\n'
        + '- **Lưu ý**: đây là phân tích của AI và có thể bị vô hiệu bởi những biến động đột ngột của thị trường.',
      ai_reply_signal_pro:
        'Thiết lập long đã sẵn sàng.\n\n'
        + '- Vào lệnh: 68.120–68.360 (vào từng phần)\n'
        + '- SL: 67.480 · R 1,1%\n'
        + '- TP: 68.980 / 69.640 / 70.420\n'
        + '- R:R 1 : 2,8 · độ tin cậy 74%\n'
        + '- Vô hiệu: nến 15m đóng < 67.480',

      // --- 일반 응답 ---
      ai_reply_general:
        'Đã nhận câu hỏi: "{text}".\n\nHãy thử các lệnh như "vẽ đường xu hướng", "đề xuất vào lệnh/SL/TP" hoặc "tìm hỗ trợ và kháng cự".',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 Vẽ đường xu hướng tăng',
      ai_chip_trendline_cmd: 'vẽ một đường xu hướng tăng từ các đáy gần đây',
      ai_chip_signal: '📊 Kịch bản vào lệnh',
      ai_chip_signal_cmd: 'giúp tôi đánh dấu điểm vào lệnh, cắt lỗ và chốt lời',
      ai_chip_sr: '📍 Tìm hỗ trợ / kháng cự',
      ai_chip_sr_cmd: 'tìm hỗ trợ và kháng cự',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 Máy tính R:R',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: 'Tôi có thể giúp gì? ví dụ: vẽ đường xu hướng',
      ai_input_pro: 'Nhập một lệnh… (vd: vẽ đường xu hướng / dựng nháp thiết lập của tôi / tìm S/R)',
      ai_reason_beginner: '💡 Vì sao',
      ai_reason_pro: 'Lý do',

      // --- 후속 제안 칩 ---
      ai_fu_title: 'Tiếp theo bạn có thể hỏi',
      ai_fu_risk_open_position: '⚠ Kiểm tra rủi ro vị thế đang mở của tôi',
      ai_fu_risk_open_position_q: 'Tôi đang có một vị thế mở. Khoảng cách thanh lý của tôi là bao nhiêu và điều gì sẽ làm nó vô hiệu?',
      ai_fu_invalidation: '❓ Ở đâu thì tôi sai?',
      ai_fu_invalidation_q: 'Tôi đã vẽ điểm vào lệnh và cắt lỗ nhưng chưa có mức vô hiệu. Đến mức nào thì tôi nên thừa nhận ý tưởng này sai?',
      ai_fu_no_stop: '🛑 Tôi chưa có mức cắt lỗ',
      ai_fu_no_stop_q: 'Tôi đã vẽ vùng vào lệnh nhưng chưa có mức cắt lỗ. Hãy giải thích các mức cấu trúc bên dưới và bên trên nó.',
      ai_fu_open_orders: '📋 Xem lại các lệnh chờ của tôi',
      ai_fu_open_orders_q: 'Tôi có các lệnh chờ. Chúng còn phù hợp với cấu trúc hiện tại không?',
      ai_fu_counter_case: '🔄 Lập luận cho hướng ngược lại',
      ai_fu_counter_case_q: 'Bây giờ hãy lập luận ngược lại điều bạn vừa nói. Lập luận mạnh nhất chống lại nó là gì?',
      ai_fu_review_trades: '📖 Xem lại các giao dịch trước của tôi',
      ai_fu_review_trades_q: 'Hãy xem lại các giao dịch trước của tôi. Tôi có tuân theo kế hoạch của chính mình không, và tôi đã đi lệch ở đâu?',
      ai_fu_higher_tf: '🔍 Kiểm tra khung thời gian lớn hơn',
      ai_fu_higher_tf_q: 'Khung thời gian lớn hơn có đồng thuận với cách đọc này hay không?',
      ai_fu_add_indicator: '📈 Đề xuất chỉ báo cho trường hợp này',
      ai_fu_add_indicator_q: 'Biểu đồ của tôi chưa có chỉ báo nào. Chỉ báo nào sẽ hữu ích ở đây, và giới hạn của chúng là gì?',
      ai_fu_funding: '💰 Funding đang thế nào?',
      ai_fu_funding_q: 'Tỷ lệ funding đang cho thấy điều gì về vị thế của thị trường lúc này?',
      ai_fu_order_book: '📊 Đọc sổ lệnh',
      ai_fu_order_book_q: 'Độ sâu sổ lệnh cho thấy điều gì quanh giá hiện tại?',
      ai_fu_explain_levels: '📍 Giải thích các mức quan trọng',
      ai_fu_explain_levels_q: 'Hãy giải thích các mức quan trọng trên {symbol} và bạn đã xác định từng mức bằng cách nào.',

      // --- 저장 / 알림 결과 ---
      ai_points_insufficient: 'Không đủ điểm để lưu mục này. Hãy nạp thêm ở trang Điểm.',
      ai_alert_no_price: 'Tín hiệu này không có giá vào lệnh nên không có gì để đặt cảnh báo.',
      ai_alert_created: 'Đã đặt cảnh báo tại {price}. Bạn sẽ được thông báo khi giá đạt mức này.',
      ai_alert_failed: 'Không thể đặt cảnh báo. Không có gì được lưu — hãy thử lại.',

      ai_layer_hide: 'Ẩn lớp này trên biểu đồ',
      ai_layer_show: 'Hiện lớp này trên biểu đồ',
    },
    { label: 'Tiếng Việt', bcp47: 'vi' },
  );
})();
