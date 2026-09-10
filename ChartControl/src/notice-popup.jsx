/* ============================================================
   공지 팝업 — window.NoticePopup

   무엇을 하는가
   -----------
   운영자가 `popup` 으로 발행한 공지를 로그인 직후 화면에 띄운다.

   ★★ 왜 전부 띄우지 않는가

     모든 공지를 띄우면 이용자가 **닫는 데 익숙해진다.** 그러면 정작 점검·장애
     공지도 읽지 않고 닫는다. 그래서 운영자가 공지마다 정하고 기본값은 꺼짐이다.

   ★★ 왜 읽음을 서버에 저장하는가

     로컬에만 두면 다른 기기·다른 브라우저에서 또 뜬다. 이미 읽은 이용자에게
     반복해서 보여주면 그 다음부터는 내용을 보지 않는다.

   ★★ 거래 중에는 띄우지 않는다

     주문 패널이 열린 화면에서 모달이 뜨면 **클릭을 가로챈다.** 매수 버튼을
     누르려던 손이 팝업을 누르고, 그 사이 호가가 바뀐다. 돈이 걸린 화면에서는
     보류하고 다음 화면 이동에서 띄운다.

   긴급도별 동작
   -----------
     info     — 상단 배너. 바깥을 눌러도 닫힌다.
     warning  — 모달. 바깥·Esc 로 닫힌다.
     critical — 모달. **닫기 버튼만** 닫는다(바깥·Esc 로 닫히지 않는다).
                긴급 공지를 무심코 지나치지 못하게 한다.
   ============================================================ */
(function () {
  'use strict';
  const { useState, useEffect, useCallback, useRef } = React;

  const t = (k, p) => (window.QTI18n ? window.QTI18n.t(k, p) : k);

  /**
   * 지금 이 화면에서 팝업을 띄워도 되는가.
   *
   * ★ 주문 패널이 있으면 보류한다. 화면 경로가 아니라 **주문 패널의 존재**로
   *   판단한다 — 레이아웃 프리셋에 따라 주문 패널이 있는 화면이 달라진다.
   */
  function safeToShow() {
    try {
      /*
         ★★★ **예전에는 주문 패널이 화면에 "있으면" 무조건 보류했다. 그래서 공지가
           사실상 영구히 뜨지 않았다.**

           실측: 기본 레이아웃의 /trade 에는 orderEntry 가 **항상** 있다. 그리고 이
           함수는 hashchange 에서만 다시 평가되므로, 트레이드 화면에 머무르는 동안에는
           기회가 오지 않는다. 프로덕션에 공지를 넣고 확인했더니 실제로 안 떴다 —
           기능은 만들어져 있는데 닿을 수 없는 상태였다.

         ★★ 원래 의도는 맞다: 주문을 내려던 손이 팝업을 누르고 그 사이 호가가 바뀌는
           것을 막는 것이다. 그런데 막아야 할 것은 **패널의 존재**가 아니라
           **주문 중이라는 상태**다.

         ★ 그래서 판정을 좁힌다:
             (a) 주문 패널의 입력칸에 **초점이 있으면** 보류 — 지금 입력 중이다.
             (b) 주문 패널 입력칸에 **값이 들어 있으면** 보류 — 작성 중이다.
           둘 다 아니면 화면에 패널이 있어도 띄운다. 손이 그 위에 있지 않다.
      */
      const oe = document.querySelector('[data-widget-id="orderEntry"]');
      if (oe) {
        /* (a) 초점이 주문 패널 안에 있다 */
        const act = document.activeElement;
        if (act && oe.contains(act)) return false;
        /*
           ★★★ **"값이 있으면 보류" 는 쓸 수 없다.** 주문 패널은 열릴 때부터 기본값이
             채워져 있다(실측: 레버리지 `10` · 가격 `78196` · 수량 `0.05`).
             그래서 이 규칙은 "항상 보류" 와 같았다 — 고치려던 문제를 그대로 재현했다.

           ★ 대신 **초점**만 본다(위 (a)). 초점이 주문 패널에 없다면 손이 그 위에
             있지 않다는 뜻이고, 그때 띄우는 것은 클릭을 가로채지 않는다.

           ★ 그리고 팝업은 스스로 초점을 가져가지 않는다 — 이용자가 닫기를 누를 때까지
             주문 패널의 초점은 그대로다.
        */
      }
      /*
         이미 **다른** 모달이 열려 있으면 겹치지 않는다.

         ★★ 자기 자신을 제외해야 한다. 이 팝업도 `role="dialog"` 이므로, 제외하지
           않으면 렌더된 순간 "다른 모달이 있다" 가 되어 스스로를 감춘다 —
           그러면 팝업이 **깜빡이고**, 닫기 버튼을 누르려는 순간 사라져 읽음이
           기록되지 않는다. 실측으로 그 상태를 겪었다(Esc 로 닫힌 것처럼 보였다).
      */
      const others = document.querySelectorAll('.modal-backdrop, [role="dialog"]');
      for (const el of others) {
        if (el.closest('.qt-noticeback') || el.classList.contains('qt-noticeback')) continue;
        return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  window.NoticePopup = function NoticePopup() {
    const [queue, setQueue] = useState([]);
    const [busy, setBusy] = useState(false);
    /*
       ★ 한 세션에 한 번만 불러온다. 화면을 옮길 때마다 부르면 같은 요청이
         반복되고, 서버가 매번 안 읽은 목록을 계산한다.
    */
    const loadedRef = useRef(false);
    // 화면 이동을 감지해 보류된 팝업을 다시 시도한다.
    const [tick, setTick] = useState(0);

    useEffect(() => {
      const bump = () => setTick((n) => n + 1);
      window.addEventListener('hashchange', bump);
      /*
         ★★ **화면 이동만 기다리면 기회가 오지 않는다.**

           보류 사유(다른 모달이 열려 있다 · 주문 입력 중이다)는 화면을 옮기지 않아도
           사라진다. 예전에는 hashchange 만 들었기 때문에, 첫 진입 때 위험고지 모달이
           열려 있으면 그 모달을 닫아도 공지가 **다시 시도되지 않았다.**
           실측으로 그 상태를 확인했다(위험고지만 뜨고 공지는 끝까지 안 떴다).

         ★ 그래서 잠깐 동안만 주기적으로 다시 본다. **영구 타이머가 아니다** —
           30초 뒤 스스로 멈춘다. 그 안에 조건이 풀리지 않으면 다음 화면 이동을
           기다리는 것이 맞다(계속 노리면 주문 중에 끼어든다).

         ★ 2초 간격이다. 더 짧게 하면 모달을 닫는 손동작 중에 끼어들 수 있다.
      */
      const iv = setInterval(bump, 2000);
      const stop = setTimeout(() => clearInterval(iv), 30_000);
      return () => {
        window.removeEventListener('hashchange', bump);
        clearInterval(iv);
        clearTimeout(stop);
      };
    }, []);

    useEffect(() => {
      if (loadedRef.current) return undefined;
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.popupNotices) return undefined;
      /*
         ★ 로그인 상태가 아니면 부르지 않는다. 인증이 필요한 조회이므로 401 이
           브라우저 콘솔에 남고, 그것이 "이 화면에 오류가 있다" 로 보고된다.
      */
      if (!(window.QTAuth && window.QTAuth.isLoggedIn && window.QTAuth.isLoggedIn())) return undefined;
      if (window.QTLive && window.QTLive.isBackendPresent
        && window.QTLive.isBackendPresent() === false) return undefined;

      loadedRef.current = true;
      let alive = true;
      /*
         ★★★ **`QTI18n.get` 은 존재하지 않는다. 실제 이름은 `getLocale` 이다.**

           그래서 이 조건이 항상 거짓이 되어 `locale = undefined` 로 서버를 불렀다.
           이 파일만 `get()` 을 썼고 다른 5곳(ai-copilot·pages-admin-more·pages-auth 등)
           은 모두 `getLocale()` 이다 — 오타다.

         ★ 자바스크립트는 없는 메서드를 조용히 넘긴다(`&&` 로 감싸 두었으므로 오류도
           나지 않는다). 그래서 화면에서는 아무 문제가 보이지 않았다.
           이번 라운드에서 네 번째로 겪는 유형이다 — 없는 CSS 변수, 없는 토큰 이름,
           빗나간 선택자, 그리고 이것.
      */
      const locale = (window.QTI18n && window.QTI18n.getLocale)
        ? window.QTI18n.getLocale()
        : undefined;
      api.popupNotices(locale)
        .then((r) => {
          if (!alive) return;
          const list = (r && r.notices) || [];
          setQueue(list);
        })
        /*
           ★ 실패하면 아무 것도 띄우지 않는다. 공지를 못 불러온 것을 "공지 없음"
             으로 보여줄 자리가 없다 — 팝업은 있을 때만 나타나는 것이 정상이다.
        */
        .catch(() => { if (alive) setQueue([]); });
      return () => { alive = false; };
    }, [tick]);

    const current = queue.length > 0 ? queue[0] : null;
    const canShow = current && safeToShow();

    /**
     * 닫는다 — 서버에 읽음을 기록한 뒤에만 큐에서 뺀다.
     *
     * ★★ 기록에 실패하면 큐에서 빼지 않는다. 빼 버리면 이용자는 닫았다고
     *   생각하는데 다음 로그인에 또 뜬다 — 우리 화면이 고장난 것으로 보인다.
     */
    const dismiss = useCallback(() => {
      if (!current || busy) return;
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.markNoticeRead) {
        // 기록할 방법이 없으면 이 세션에서만 감춘다(사실을 바꾸지 않는다).
        setQueue((prev) => prev.slice(1));
        return;
      }
      setBusy(true);
      api.markNoticeRead(current.id)
        .then(() => { setQueue((prev) => prev.slice(1)); })
        .catch(() => {
          if (window.QTToast) {
            window.QTToast({ title: t('notice_dismiss_failed'), variant: 'danger' });
          }
        })
        .finally(() => setBusy(false));
    }, [current, busy]);

    // Esc — critical 은 닫히지 않는다.
    useEffect(() => {
      if (!canShow || current.severity === 'critical') return undefined;
      const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [canShow, current, dismiss]);

    if (!canShow) return null;

    const sev = current.severity === 'critical' ? 'critical'
      : current.severity === 'warning' ? 'warning' : 'info';

    /* info 는 모달이 아니라 상단 배너다 — 화면을 막지 않는다. */
    if (sev === 'info') {
      return (
        <div className="qt-noticebar" role="status">
          <div className="qt-noticebar__body">
            <strong className="qt-noticebar__title">{current.title}</strong>
            {current.body ? <span className="qt-noticebar__text">{current.body}</span> : null}
          </div>
          <button
            type="button"
            className="btn btn--xs qt-noticebar__close"
            onClick={dismiss}
            disabled={busy}
          >
            {t('notice_got_it')}
          </button>
        </div>
      );
    }

    return (
      <div
        className="qt-noticeback"
        /*
           ★★ critical 은 바깥 클릭으로 닫히지 않는다. 급하게 화면을 누르다
             긴급 공지를 지나치는 것을 막는다.
        */
        onClick={sev === 'critical' ? undefined : dismiss}
      >
        <div
          className={`qt-noticemodal qt-noticemodal--${sev}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qt-notice-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="qt-noticemodal__head">
            <span className={`qt-noticemodal__sev qt-noticemodal__sev--${sev}`}>
              {t(sev === 'critical' ? 'notice_sev_critical' : 'notice_sev_warning')}
            </span>
            <strong id="qt-notice-title" className="qt-noticemodal__title">{current.title}</strong>
          </div>
          {/*
             ★ 본문을 HTML 로 그리지 않는다. 운영자 입력이 그대로 실행되면
               저장형 XSS 가 된다 — 공지는 모든 이용자에게 나가므로 피해가 크다.
          */}
          {current.body ? <div className="qt-noticemodal__body">{current.body}</div> : null}
          <div className="qt-noticemodal__foot">
            {queue.length > 1 && (
              <span className="qt-noticemodal__count">
                {t('notice_more_count', { count: queue.length - 1 })}
              </span>
            )}
            <button type="button" className="btn btn--primary" onClick={dismiss} disabled={busy}>
              {busy ? t('notice_saving') : t('notice_got_it')}
            </button>
          </div>
        </div>
      </div>
    );
  };
})();
