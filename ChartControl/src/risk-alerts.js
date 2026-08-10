/* ============================================================
   위험 경고 — 청산 접근 감지
   ------------------------------------------------------------
   순수 JS. React 의존성이 없다.

   왜 클라이언트에서 계산하는가
   -------------------------
   가장 확실한 경로이기 때문이다. 필요한 값(청산가·마크가·증거금)이 이미
   포지션 조회에 들어 있고, 그 값은 거래소가 직접 준 것이다.

   서버 푸시(웹훅·알림 저장)를 쓰면 알림 생성 시점과 화면 표시 시점 사이에
   지연이 생긴다. 청산은 몇 초 만에 일어나므로 그 지연이 곧 손실이다.
   서버 알림은 "놓친 알림 확인" 용도로 나중에 추가하고, 즉시 경고는 여기서 한다.

   ★ 경고를 과하게 내지 않는다
   같은 포지션에 대해 같은 단계의 경고를 반복하면 사용자가 알림을 무시하게 된다.
   그러면 정작 위험할 때 못 본다. 단계가 올라갈 때만 다시 알린다.
   ============================================================ */

(function () {
  'use strict';

  /**
   * 경고 단계.
   *
   * 기준은 "청산가까지 남은 거리 / 현재가" 다. 절대 금액으로 잡으면
   * BTC(64,000)와 DOGE(0.07)에서 전혀 다른 의미가 된다.
   *
   *   danger    5% 이내  — 즉시 조치가 필요하다
   *   warning  12% 이내  — 주의가 필요하다
   */
  var LEVELS = [
    { id: 'danger', maxDistancePct: 5, variant: 'error', durationMs: 20000 },
    { id: 'warning', maxDistancePct: 12, variant: 'warning', durationMs: 12000 },
  ];

  /** 같은 포지션·같은 단계를 다시 알리지 않기 위한 기록. `symbol|side` → level */
  var notified = new Map();

  /** 마지막 평가 결과. 화면이 배지·목록으로 쓸 수 있다. */
  var alerts = [];
  var listeners = new Set();

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(alerts); } catch (e) { console.warn('[QTRisk] 리스너 오류', e); }
    });
  }

  function t(key, vars) {
    return window.QTI18n ? window.QTI18n.t(key, vars) : key;
  }

  /**
   * 포지션 하나의 위험도를 계산한다.
   *
   * @returns {{level:string, distancePct:number}|null} 위험하지 않으면 null.
   */
  function assess(p) {
    var mark = Number(p.mark);
    var liq = Number(p.liq);

    // 값이 없으면 판단하지 않는다. 0 을 청산가로 오해하면 "안전" 이라는 거짓이 된다.
    if (!Number.isFinite(mark) || !Number.isFinite(liq) || mark <= 0 || liq <= 0) return null;

    /*
       방향에 따라 위험한 쪽이 다르다.
         롱  가격이 내려가면 청산 (liq < mark)
         숏  가격이 올라가면 청산 (liq > mark)
       방향과 청산가가 어긋나면(예: 롱인데 liq > mark) 데이터가 잘못된 것이므로
       경고하지 않는다 — 잘못된 경고는 신뢰를 깎는다.
    */
    var isLong = p.side !== 'short';
    if (isLong && liq >= mark) return null;
    if (!isLong && liq <= mark) return null;

    var distancePct = (Math.abs(mark - liq) / mark) * 100;

    for (var i = 0; i < LEVELS.length; i += 1) {
      if (distancePct <= LEVELS[i].maxDistancePct) {
        return { level: LEVELS[i].id, distancePct: distancePct };
      }
    }
    return null;
  }

  function levelRank(id) {
    for (var i = 0; i < LEVELS.length; i += 1) if (LEVELS[i].id === id) return LEVELS.length - i;
    return 0;
  }

  function levelConfig(id) {
    for (var i = 0; i < LEVELS.length; i += 1) if (LEVELS[i].id === id) return LEVELS[i];
    return LEVELS[LEVELS.length - 1];
  }

  /**
   * 포지션 목록을 평가하고, 단계가 올라간 것만 알린다.
   *
   * 실데이터가 아니면 아무것도 하지 않는다 — 목업 포지션으로 청산 경고를 내면
   * 사용자가 실제 위험으로 오해한다.
   */
  function evaluate() {
    var Acct = window.QTAccount;
    if (!Acct || !Acct.isLive()) {
      if (alerts.length) { alerts = []; notified.clear(); notify(); }
      return alerts;
    }

    var positions = Acct.getPositions();
    var next = [];
    var seen = new Set();

    for (var i = 0; i < positions.length; i += 1) {
      var p = positions[i];
      var verdict = assess(p);
      var key = p.symbol + '|' + p.side;
      seen.add(key);
      if (!verdict) {
        // 위험 구간을 벗어났다. 다시 진입하면 알릴 수 있게 기록을 지운다.
        notified.delete(key);
        continue;
      }

      next.push({
        key: key,
        symbol: p.symbol,
        side: p.side,
        level: verdict.level,
        distancePct: verdict.distancePct,
        mark: Number(p.mark),
        liq: Number(p.liq),
      });

      // 단계가 올라갈 때만 알린다. 같은 단계를 반복하면 사용자가 무시하게 된다.
      var prev = notified.get(key);
      if (!prev || levelRank(verdict.level) > levelRank(prev)) {
        notified.set(key, verdict.level);
        var cfg = levelConfig(verdict.level);
        if (window.QTToast) {
          window.QTToast({
            title: t('risk_liq_' + verdict.level, { symbol: p.symbol }),
            desc: t('risk_liq_desc', {
              distance: verdict.distancePct.toFixed(1),
              liq: formatPrice(p.liq, p.symbol),
            }),
            variant: cfg.variant,
            duration: cfg.durationMs,
          });
        }
      }
    }

    // 닫힌 포지션의 기록을 지운다. 남겨두면 같은 심볼을 다시 열 때 알림이 안 온다.
    notified.forEach(function (_v, k) { if (!seen.has(k)) notified.delete(k); });

    var changed = next.length !== alerts.length
      || next.some(function (a, idx) { return !alerts[idx] || alerts[idx].key !== a.key || alerts[idx].level !== a.level; });
    alerts = next;
    if (changed) notify();
    return alerts;
  }

  /** 심볼 자리수에 맞춘 가격 표기. widgets.jsx 의 계산을 재사용한다. */
  function formatPrice(v, symbol) {
    try {
      var fmt = window.QTFmt;
      if (fmt && typeof fmt.fmtPrice === 'function') return fmt.fmtPrice(Number(v), symbol);
    } catch (e) { /* 아래 기본 표기 */ }
    return String(v);
  }

  // 계정 데이터가 갱신될 때마다 평가한다. 별도 타이머를 두지 않는다 —
  // 포지션이 바뀌지 않았는데 반복 평가하면 낭비다.
  if (window.QTAccount && window.QTAccount.subscribe) {
    window.QTAccount.subscribe(function () { evaluate(); });
  }

  window.QTRisk = {
    LEVELS: LEVELS,
    assess: assess,
    evaluate: evaluate,
    getAlerts: function () { return alerts.slice(); },
    /** 가장 높은 단계. 헤더 배지 색을 정하는 데 쓴다. */
    highestLevel: function () {
      var best = null;
      for (var i = 0; i < alerts.length; i += 1) {
        if (!best || levelRank(alerts[i].level) > levelRank(best)) best = alerts[i].level;
      }
      return best;
    },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    debug: function () {
      return { alerts: alerts, notified: Array.from(notified.entries()) };
    },
  };
})();
