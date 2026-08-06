/* ============================================================
   한국어 — AI Copilot 사전
   ------------------------------------------------------------
   기준 언어는 src/locales/copilot.en.js 다. 키가 빠지면 영어로 폴백한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'ko',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: '차트 데이터 수집 중 · BTC/USDT 15m · 220 candles',
      ai_think_swinglow: '최근 스윙 저점 탐지 (RSI 다이버전스 여부 확인)',
      ai_think_trendcand: '저점 2개 이상 확보 → 추세선 후보 산정',
      ai_think_mtf: '멀티 타임프레임 정렬 확인 (15m / 1H / 4H)',
      ai_think_atr: 'ATR 기반 진입/손절 폭 계산',
      ai_think_rr: 'R:R 최적화 후보 3개 시뮬레이션',
      ai_think_swings: '주요 스윙 고/저점 스캔',
      ai_think_volnodes: '거래량 밀집 구간 추출',
      ai_think_context: '컨텍스트 파악 중',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: '컨텍스트 로드 완료. BTC/USDT Perp · 15m · 220 candles · 5개 지표 활성.',
      ai_welcome_beginner:
        '안녕하세요, QuantumTrade AI Copilot입니다. **{symbol}** 차트를 분석하고 있어요. '
        + '궁금하신 걸 자연어로 물어보시면 차트에 직접 추세선·지지·저항선을 그려드리고, 진입·손절·익절도 제안해드릴 수 있어요. '
        + '저는 도구이며, 실제 주문은 항상 최종 승인 후에만 실행됩니다.',
      ai_welcome_pro:
        'Copilot 준비됨. 심볼: **{symbol}** · TF: **{tf}** · 최근가: **{price}** · 기준 시각 {time}. '
        + '추세선, 지지·저항, 진입/손절/익절, R:R 을 요청하세요.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 차트에 Draft Trendline 추가됨 · Layer: AI Draft',
      ai_tool_signal: '📊 5개 오버레이 생성됨 · Entry Zone / SL / TP1-3 / Long Marker',
      ai_tool_sr: '📍 지지/저항 2개 추가됨',
      ai_tool_edited: '✍️ 사용자 수정 반영 · {detail}',
      ai_hint_drag: '📌 추세선 양 끝의 원을 드래그해서 위치를 조정할 수 있어요. 수정하시면 대화창에 반영됩니다.',
      ai_invalidation_note: '· 이 조건 발생 시 신호 자동 무효화',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        '분석을 정리했습니다. 최근 저점 두 곳을 이어 상승 추세선을 그렸어요.\n\n'
        + '- **추세선 유효성**: 저점 갱신 없이 3회 이상 지지 확인 시 유효\n'
        + '- **추세선 이탈**: 15m 종가 기준 이탈 시 무효화\n'
        + '- **주의**: 추세선은 참고 지표입니다. 다른 지표와 함께 확인해주세요.\n\n'
        + '원하시면 지지선/저항선을 함께 그려드릴 수 있어요.',
      ai_reply_trendline_pro:
        '스윙 저점 **A** 에서 **B** 로 추세선을 그렸습니다.\n\n'
        + '- 기울기: +42.6 USDT / 15m bar\n'
        + '- 터치 횟수: 3\n'
        + '- 무효화: 15m 종가 < 추세선\n'
        + '- RSI 다이버전스: 관측되지 않음\n'
        + '- 추세선 근처 호가 흡수: BID 68,150 (+3.2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        '분석이 끝났어요. **롱 진입 시나리오**를 아래 카드에 정리했습니다.\n\n'
        + '- **진입 구간**: 68,120 ~ 68,360 사이에서 분할 진입 권장\n'
        + '- **손절**: 67,480 이탈 시 즉시 청산 (예상 손실 약 1.1%)\n'
        + '- **목표가**: 3단계 (68,980 / 69,640 / 70,420)\n'
        + '- **위험/보상 비율**: 1 : 2.8\n'
        + '- **신뢰도**: 74% (충분히 확실하지 않은 부분도 있어요)\n'
        + '- **주의**: AI 분석 결과이며 시장 급변 시 무효화됩니다.',
      ai_reply_signal_pro:
        '롱 셋업 준비됨.\n\n'
        + '- 진입: 68,120–68,360 (분할)\n'
        + '- 손절: 67,480 · R 1.1%\n'
        + '- 익절: 68,980 / 69,640 / 70,420\n'
        + '- R:R 1 : 2.8 · 신뢰도 74%\n'
        + '- 무효화: 15m 종가 < 67,480',

      // --- 지지/저항 응답 ---
      ai_reply_sr_beginner:
        '주요 **저항**은 69,120 부근, **지지**는 67,200 근처예요. 이 구간을 넘거나 이탈할 때 큰 변화가 있을 수 있어요.',
      ai_reply_sr_pro:
        '저항: 69,120 (07-16 이후 미검증). 지지: 67,200 (2회 터치, 거래량 많음).',

      // --- 일반 응답 ---
      ai_reply_general:
        '질문 감지: "{text}".\n\n"추세선을 그려줘", "진입/손절/익절 제안", "지지·저항 찾기" 같은 명령을 시도해 보세요.',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 상승 추세선 그리기',
      ai_chip_trendline_cmd: '최근 저점 기준으로 상승 추세선을 그려줘',
      ai_chip_signal: '📊 진입 시나리오',
      ai_chip_signal_cmd: '진입가·손절가·익절가를 제안해줘',
      ai_chip_sr: '📍 지지·저항 찾기',
      ai_chip_sr_cmd: '지지·저항 찾아줘',
      ai_chip_fib: '📐 피보나치',
      ai_chip_rr: '🔀 R:R 계산',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: '무엇을 도와드릴까요? 예) 추세선을 그려줘',
      ai_input_pro: '명령 입력... (예: draw trendline / propose signal / find S/R)',
      ai_reason_beginner: '💡 이유',
      ai_reason_pro: 'Reason',
    },
    { label: '한국어', bcp47: 'ko-KR' },
  );
})();
