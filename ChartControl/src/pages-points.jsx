/**
 * 포인트 — 사용자 화면.
 *
 * 왜 별 파일인가
 * ------------
 * 디자이너가 만든 화면이 없는 신규 기능이다. 기존 페이지 파일에 넣으면
 * "디자이너 화면 + 신규 화면" 이 섞여 나중에 원본을 확인하기 어려워진다.
 * 기존 컴포넌트(PageShell·KPICard·SectionCard·DataTable)만 써서 조립하므로
 * 테마·밀도 전환은 그대로 따라간다.
 *
 * ★ 이 화면이 반드시 말해야 하는 것
 *   · 포인트는 현금이 아니다. 출금할 수 없다.
 *   · 사이트 안에서만 쓰인다.
 *   이 문장이 없으면 사용자가 적립된 포인트를 인출하려 하고, 안 된다는 것을
 *   나중에 알게 된다. 서버가 disclosures 로 같은 사실을 보낸다.
 */
(function () {
  'use strict';

  const { useState, useEffect } = window.React;
  const I = window.Icons;
  const t = (k, v) => (window.QTI18n ? window.QTI18n.t(k, v) : k);
  const fmt = (n, d) => (window.QTFmt ? window.QTFmt.fmt(n, d) : String(n));

  /*
     적립·사용 이유를 사람이 읽는 문구로.

     서버는 열거값(referral_signup 등)을 준다. 화면이 그대로 보여주면
     사용자가 무슨 뜻인지 모른다. 사전 키로 매핑한다 — 코드에 한국어를
     박으면 영어 화면에서 한국어가 나온다.
  */
  const REASON_KEY = {
    referral_signup: 'pt_reason_referral',
    event_reward: 'pt_reason_event',
    competition_prize: 'pt_reason_prize',
    admin_grant: 'pt_reason_grant',
    admin_revoke: 'pt_reason_revoke',
    purchase: 'pt_reason_purchase',
    redeem: 'pt_reason_redeem',
    refund: 'pt_reason_refund',
    expiry: 'pt_reason_expiry',
  };

  window.PointsPage = function PointsPage({ shellProps }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [msg, setMsg] = useState(null);
    const [topup, setTopup] = useState(null);        // { supported:{paypal,usdt}, packages, enabled }
    const [topupBusy, setTopupBusy] = useState(null); // 진행 중 패키지 id
    const [usdtInvoice, setUsdtInvoice] = useState(null); // { address, network, amount }
    const [saved, setSaved] = useState(null);         // { supported, items, saveCost }

    const load = window.React.useCallback(() => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.points) return;
      // 백엔드가 없는 디자인 미리보기에서는 요청하지 않는다(콘솔 404 방지).
      if (window.QTLive && window.QTLive.isBackendPresent && window.QTLive.isBackendPresent() === false) return;
      api.points()
        .then((r) => { setData(r); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'));
      if (api.topupPackages) api.topupPackages().then((r) => setTopup(r)).catch(() => { /* 비치명 */ });
      if (api.savedList) api.savedList().then((r) => setSaved(r)).catch(() => { /* 비치명 */ });
    }, []);
    useEffect(() => { load(); }, [load]);

    /*
       PayPal 승인 후 복귀 처리.

       사용자가 PayPal 에서 승인하고 return_url(#/points?topup=paypal&order=...)로 돌아오면
       그 주문을 캡처(결제 확정)해 포인트를 적립한다. 캡처 후 쿼리를 지워 새로고침해도
       재캡처되지 않게 한다(서버도 멱등이지만 UI 도 정리한다).
    */
    useEffect(() => {
      const h = window.location.hash || '';
      const m = h.match(/[?&]order=([^&]+)/);
      const isPaypalReturn = /[?&]topup=paypal/.test(h) && m;
      if (!isPaypalReturn) return;
      const orderId = decodeURIComponent(m[1]);
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.topupPaypalCapture) return;
      try { window.history.replaceState(null, '', '#/points'); } catch (e) { /* noop */ }
      api.topupPaypalCapture(orderId)
        .then((r) => {
          if (r && r.credited) { setMsg({ ok: true, text: t('pt_topup_credited', { n: r.points }) }); load(); }
          else if (r && r.alreadyPaid) { setMsg({ ok: true, text: t('pt_topup_already') }); }
          else { setMsg({ ok: false, text: t('pt_topup_failed') }); }
        })
        .catch((e) => setMsg({ ok: false, text: (e && e.message) || t('pt_topup_failed') }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /*
       Toss 결제 성공 후 successUrl(#/points?topup=toss&paymentKey=..&orderId=..&amount=..)로
       돌아오면 서버에 confirm 요청해 결제를 확정하고 포인트를 적립한다.
    */
    useEffect(() => {
      const h = window.location.hash || '';
      if (!/[?&]topup=toss/.test(h)) return;
      const pk = (h.match(/[?&]paymentKey=([^&]+)/) || [])[1];
      const oid = (h.match(/[?&]orderId=([^&]+)/) || [])[1];
      const amt = (h.match(/[?&]amount=([^&]+)/) || [])[1];
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.tossConfirm || !pk || !oid || !amt) return;
      try { window.history.replaceState(null, '', '#/points'); } catch (e) { /* noop */ }
      api.tossConfirm(decodeURIComponent(pk), decodeURIComponent(oid), Number(amt))
        .then((r) => {
          if (r && r.credited) { setMsg({ ok: true, text: t('pt_topup_credited', { n: r.points }) }); load(); }
          else if (r && r.alreadyPaid) { setMsg({ ok: true, text: t('pt_topup_already') }); }
          else { setMsg({ ok: false, text: t('pt_topup_failed') }); }
        })
        .catch((e) => setMsg({ ok: false, text: (e && e.message) || t('pt_topup_failed') }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const live = Boolean(data && data.supported);
    const on = Boolean(data && data.enabled);
    const unit = (data && data.settings && data.settings.unitName) || t('pt_unit_default');
    const balance = data && typeof data.balance === 'number' ? data.balance : null;

    const redeem = async (item) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.redeemPoints) return;
      setBusyId(item.id); setMsg(null);
      try {
        const r = await api.redeemPoints(item.id);
        if (r && r.ok === false) {
          /*
             잔액 부족(402)과 다른 실패를 구분해 안내한다.

             "실패했습니다" 만 보여주면 사용자가 무엇을 해야 하는지 모른다 —
             포인트를 더 모아야 하는지, 잠시 뒤 다시 해야 하는지가 다르다.
          */
          const insufficient = r.status === 402 || /INSUFFICIENT/i.test(String(r.code || r.message || ''));
          setMsg({ ok: false, text: insufficient ? t('pt_not_enough', { unit }) : (r.message || t('pt_redeem_failed')) });
        } else {
          setMsg({ ok: true, text: t('pt_redeemed', { name: t(item.nameKey) }) });
          load();
        }
      } catch (e) {
        const insufficient = (e && e.status === 402) || /INSUFFICIENT/i.test(String((e && e.message) || ''));
        setMsg({ ok: false, text: insufficient ? t('pt_not_enough', { unit }) : ((e && e.message) || t('pt_redeem_failed')) });
      }
      setBusyId(null);
    };

    // PayPal: 주문 생성 후 승인 페이지로 이동. 복귀 시 위 useEffect 가 캡처한다.
    const payWithPaypal = async (pk) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.topupPaypalCreate) return;
      setTopupBusy(pk.id); setMsg(null); setUsdtInvoice(null);
      try {
        const r = await api.topupPaypalCreate(pk.id);
        if (r && r.approveUrl) { window.location.href = r.approveUrl; return; }
        setMsg({ ok: false, text: t('pt_topup_failed') });
      } catch (e) { setMsg({ ok: false, text: (e && e.message) || t('pt_topup_failed') }); }
      setTopupBusy(null);
    };

    // USDT: 인보이스(수신 주소/금액) 생성. 송금 후 웹훅이 적립한다.
    const payWithUsdt = async (pk) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.topupUsdtCreate) return;
      setTopupBusy(pk.id); setMsg(null); setUsdtInvoice(null);
      try {
        const r = await api.topupUsdtCreate(pk.id);
        if (r && (r.address !== undefined)) setUsdtInvoice({ address: r.address, network: r.network, amount: r.amount });
        else setMsg({ ok: false, text: t('pt_topup_failed') });
      } catch (e) { setMsg({ ok: false, text: (e && e.message) || t('pt_topup_failed') }); }
      setTopupBusy(null);
    };

    // Toss 결제 SDK(v2 standard) 를 한 번만 로드한다. v2 는 gck(클라이언트) 키를 쓴다.
    const loadTossSdk = () => new Promise((resolve, reject) => {
      if (window.TossPayments) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v2/standard';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('toss sdk load failed'));
      document.head.appendChild(s);
    });
    // Toss(한국결제): 주문 생성 → v2 결제창 → 성공 시 successUrl 로 리다이렉트(위 useEffect 가 confirm).
    const payWithToss = async (pk) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.tossCreate) return;
      setTopupBusy(pk.id); setMsg(null); setUsdtInvoice(null);
      try {
        const r = await api.tossCreate(pk.id);
        if (!r || !r.clientKey || !r.orderId) { setMsg({ ok: false, text: t('pt_topup_failed') }); setTopupBusy(null); return; }
        await loadTossSdk();
        const base = window.location.origin + window.location.pathname;
        const tossPayments = window.TossPayments(r.clientKey);
        const payment = tossPayments.payment({ customerKey: window.TossPayments.ANONYMOUS });
        await payment.requestPayment({
          method: 'CARD',
          amount: { currency: 'KRW', value: r.amount },
          orderId: r.orderId,
          orderName: r.orderName,
          successUrl: base + '#/points?topup=toss',
          failUrl: base + '#/points?topup=cancel',
        });
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('pt_topup_failed') });
        setTopupBusy(null);
      }
    };

    // 현재 차트에 켜둔 지표를 저장(포인트 차감). ChartKlineUtil 브리지에서 활성 지표를 읽는다.
    const saveCurrentIndicators = async () => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedCreate) return;
      const util = window.ChartKlineUtil;
      const inds = util && util.listIndicators ? util.listIndicators() : [];
      if (!inds || inds.length === 0) { setMsg({ ok: false, text: t('sv_no_indicators') }); return; }
      setMsg(null);
      try {
        // 지표 프리셋은 모든 종목에서 재사용 가능 → scope 'global'(차등가격).
        const r = await api.savedCreate({ kind: 'indicator', scope: 'global', name: t('sv_indicator_preset_name', { n: inds.length }), payload: { indicators: inds } });
        if (r && r.ok !== false) { setMsg({ ok: true, text: t('sv_saved_ok', { n: (r && r.charged) || 0 }) }); load(); }
        else setMsg({ ok: false, text: (r && r.message) || t('sv_save_failed') });
      } catch (e) {
        const insuff = e && e.status === 402;
        setMsg({ ok: false, text: insuff ? t('pt_not_enough', { unit }) : ((e && e.message) || t('sv_save_failed')) });
      }
    };
    const deleteSaved = async (id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedDelete) return;
      try { await api.savedDelete(id); load(); } catch (e) { /* noop */ }
    };
    const extendSaved = async (id) => {
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.savedExtend) return;
      try {
        const r = await api.savedExtend(id);
        if (r && r.ok !== false) { setMsg({ ok: true, text: t('sv_extended_ok', { n: (r && r.charged) || 0 }) }); load(); }
        else setMsg({ ok: false, text: (r && r.message) || t('sv_save_failed') });
      } catch (e) {
        const insuff = e && e.status === 402;
        setMsg({ ok: false, text: insuff ? t('pt_not_enough', { unit }) : ((e && e.message) || t('sv_save_failed')) });
      }
    };
    // 만료까지 남은 일수(음수면 만료됨)
    const daysLeft = (ms) => (ms ? Math.ceil((ms - Date.now()) / 86400000) : null);

    return (
      <window.PageShell
        {...shellProps}
        title={t('pt_title', { unit })}
        subtitle={t('pt_subtitle')}
        breadcrumb={['Home', t('pt_title', { unit })]}
        actions={<button className="btn btn--sm" onClick={load} title={t('refresh')}><I.Refresh size={13}/></button>}
      >
        {!live ? (
          <window.NotApplicablePanel
            title={t('pt_unavailable')}
            reason={t('pt_unavailable_why')}
            points={[]}
          />
        ) : !on ? (
          <div style={{
            padding:'14px 16px', borderRadius:8, fontSize:12.5, lineHeight:1.8,
            background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
            color:'var(--color-text-secondary)',
          }}>
            <div style={{fontWeight:600, marginBottom:4, color:'var(--color-text-primary)'}}>{t('pt_off_title')}</div>
            <div>{t('pt_off_body')}</div>
          </div>
        ) : (
          <>
            <div className="grid-4">
              <window.KPICard
                label={t('pt_balance', { unit })}
                value={balance === null ? '—' : fmt(balance, 0)}
                sub={data.settings.expiryDays > 0
                  ? t('pt_expiry_sub', { n: data.settings.expiryDays })
                  : t('pt_no_expiry')}
                icon="Zap" tone="brand"
              />
              {/*
                 이용권.

                 잔액만 보여주면 "포인트를 썼는데 뭘 받았지" 를 알 수 없다.
                 사용 가능한 이용권 수를 함께 보여준다.
              */}
              <window.KPICard
                label={t('pt_entitlements')}
                value={Object.keys(data.entitlements).reduce((a, k) => a + Number(data.entitlements[k] || 0), 0)}
                sub={t('pt_entitlements_sub')}
              />
              <window.KPICard
                label={t('pt_earned')}
                value={fmt(data.history.filter(h => h.delta > 0).reduce((a, h) => a + h.delta, 0), 0)}
                sub={t('pt_earned_sub')}
                tone="long"
              />
              <window.KPICard
                label={t('pt_spent')}
                value={fmt(Math.abs(data.history.filter(h => h.delta < 0).reduce((a, h) => a + h.delta, 0)), 0)}
                sub={t('pt_spent_sub')}
              />
            </div>

            {/*
               ★★ 반드시 표시하는 고지 ★★

               포인트는 현금이 아니고 출금할 수 없다. 서버 disclosures 와
               같은 내용이다. 이 문구가 없으면 사용자가 인출을 시도한다.
            */}
            <div style={{
              padding:'13px 15px', borderRadius:7, fontSize:12.5, lineHeight:1.85,
              background:'color-mix(in srgb, var(--color-brand) 8%, transparent)',
              border:'1px solid var(--color-brand)',
            }}>
              <div style={{fontWeight:600, marginBottom:5, display:'flex', alignItems:'center', gap:6}}>
                <I.Info size={13}/> {t('pt_rules_title', { unit })}
              </div>
              <ul style={{margin:0, paddingLeft:20}}>
                <li>{t('pt_rule_1', { unit })}</li>
                <li>{t('pt_rule_2')}</li>
                <li>{t('pt_rule_3')}</li>
                {/*
                   구매 가능 여부.

                   purchaseAvailable 이 유일한 근거다. 설정만 켜져 있고 결제
                   대행사가 없으면 false 이고, 그 사실을 그대로 알린다 —
                   "곧 구매 가능" 같은 기대를 만들지 않는다.
                */}
                {!data.settings.purchaseAvailable && <li>{t('pt_rule_no_purchase', { unit })}</li>}
              </ul>
            </div>

            {msg && (
              <div style={{
                padding:'10px 12px', borderRadius:6, fontSize:12,
                background: msg.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                border: '1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)'),
                color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
              }}>{msg.text}</div>
            )}

            {/* 포인트 충전(결제): PayPal / USDT. 결제수단 미설정이면 정직하게 "준비 중". */}
            {topup && (
              <window.SectionCard title={t('pt_topup_title', { unit })} subtitle={t('pt_topup_sub')}>
                {!topup.enabled ? (
                  <div style={{
                    padding:'12px 14px', borderRadius:7, fontSize:12.5, lineHeight:1.8,
                    background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)', color:'var(--color-text-secondary)',
                  }}>{t('pt_topup_pending')}</div>
                ) : (
                  <>
                    <div className="grid-3">
                      {topup.packages.map((pk) => (
                        <div key={pk.id} style={{
                          padding:14, borderRadius:8, background:'var(--color-bg-surface)',
                          border:'1px solid var(--color-border-subtle)', display:'flex', flexDirection:'column', gap:8,
                        }}>
                          <div style={{fontWeight:700, fontSize:16}}>{fmt(pk.points, 0)} {unit}</div>
                          <div style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>${pk.amount}</div>
                          <div style={{display:'flex', gap:6, marginTop:2}}>
                            {topup.supported.paypal && (
                              <button className="btn btn--sm btn--primary" style={{flex:1}} disabled={topupBusy === pk.id} onClick={() => payWithPaypal(pk)}>{t('pt_pay_paypal')}</button>
                            )}
                            {topup.supported.usdt && (
                              <button className="btn btn--sm" style={{flex:1}} disabled={topupBusy === pk.id} onClick={() => payWithUsdt(pk)}>{t('pt_pay_usdt')}</button>
                            )}
                            {topup.supported.toss && (
                              <button className="btn btn--sm" style={{flex:1}} disabled={topupBusy === pk.id} onClick={() => payWithToss(pk)}>{t('pt_pay_toss')}</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {usdtInvoice && (
                      <div style={{
                        marginTop:12, padding:'13px 15px', borderRadius:7, fontSize:12.5, lineHeight:1.8,
                        background:'color-mix(in srgb, var(--color-brand) 8%, transparent)', border:'1px solid var(--color-brand)',
                      }}>
                        <div style={{fontWeight:600, marginBottom:6}}>{t('pt_usdt_send', { amount: usdtInvoice.amount, network: usdtInvoice.network })}</div>
                        <code style={{userSelect:'all', wordBreak:'break-all', fontFamily:'var(--font-mono)', fontSize:12}}>{usdtInvoice.address || '—'}</code>
                        <div style={{marginTop:6, fontSize:11, color:'var(--color-text-tertiary)'}}>{t('pt_usdt_note')}</div>
                      </div>
                    )}
                  </>
                )}
              </window.SectionCard>
            )}

            {/* 내 저장 항목 — 신호·지표 저장(포인트 차감) + 목록/삭제 */}
            {saved && saved.supported && (
              <window.SectionCard title={t('sv_section_title')} subtitle={t('sv_section_sub_tiered', { sym: (saved.saveCost && saved.saveCost.symbol) || 100, glob: (saved.saveCost && saved.saveCost.global) || 300 })}>
                <div style={{marginBottom:10}}>
                  <button className="btn btn--sm" onClick={saveCurrentIndicators}>{t('sv_save_current_indicators')}</button>
                </div>
                {saved.items.length === 0 ? (
                  <div style={{padding:'10px 12px', fontSize:12.5, color:'var(--color-text-secondary)'}}>{t('sv_empty')}</div>
                ) : (
                  <div style={{display:'flex', flexDirection:'column', gap:6}}>
                    {saved.items.map((it) => {
                      const dl = daysLeft(it.expiresAt);
                      const expiring = dl !== null && dl <= 3;
                      return (
                      <div key={it.id} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 10px', border:'1px solid var(--color-border-subtle)', borderRadius:6}}>
                        <span style={{fontSize:10.5, fontWeight:700, padding:'2px 6px', borderRadius:4, background:'var(--color-bg-surface)', color:'var(--color-text-secondary)'}}>{t('sv_kind_' + it.kind)}</span>
                        <span style={{flex:1, fontSize:12.5}}>{it.name}{it.symbol ? ' · ' + it.symbol : ''}{it.timeframe ? ' · ' + it.timeframe : ''}</span>
                        {dl !== null && (
                          <span style={{fontSize:11, color: expiring ? 'var(--color-warning)' : 'var(--color-text-tertiary)'}}>
                            {dl < 0 ? t('sv_expired') : t('sv_days_left', { n: dl })}
                          </span>
                        )}
                        <button className="btn btn--sm" title={t('sv_extend_hint', { n: (saved.extendCost || 50) })} onClick={() => extendSaved(it.id)}>{t('sv_extend', { n: (saved.extendCost || 50) })}</button>
                        <button className="btn btn--icon btn--sm" title={t('sv_delete')} onClick={() => deleteSaved(it.id)}><I.Trash size={12}/></button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </window.SectionCard>
            )}

            {/* 상품 */}
            <window.SectionCard title={t('pt_shop')} subtitle={t('pt_shop_sub')}>
              {data.catalog.length > 0 ? (
                <div className="grid-3">
                  {data.catalog.map((item) => {
                    const have = Number(data.entitlements[item.id] || 0);
                    const affordable = balance !== null && balance >= item.cost;
                    return (
                      <div key={item.id} style={{
                        padding:14, borderRadius:8,
                        background:'var(--color-bg-surface)',
                        border:'1px solid var(--color-border-subtle)',
                        display:'flex', flexDirection:'column', gap:8,
                      }}>
                        <div style={{display:'flex', alignItems:'center', gap:8}}>
                          <span style={{
                            width:30, height:30, borderRadius:6, flexShrink:0,
                            background:'var(--color-brand-subtle)', color:'var(--color-brand)',
                            display:'inline-flex', alignItems:'center', justifyContent:'center',
                          }}>
                            {item.kind === 'ai_run' ? <I.Sparkles size={14}/> : item.kind === 'competition' ? <I.Chart size={14}/> : <I.Zap size={14}/>}
                          </span>
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:13, fontWeight:600}}>{t(item.nameKey)}</div>
                            <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>
                              {t('pt_grants', { n: item.grants, kind: t('pt_kind_' + item.kind) })}
                            </div>
                          </div>
                        </div>

                        {item.descKey && (
                          <div style={{fontSize:11.5, lineHeight:1.6, color:'var(--color-text-secondary)'}}>{t(item.descKey)}</div>
                        )}

                        {/* 보유 중인 이용권을 보여준다 — 중복 구매를 막지는 않되 알려준다. */}
                        {have > 0 && (
                          <div style={{fontSize:11, color:'var(--color-success)'}}>{t('pt_you_have', { n: have })}</div>
                        )}

                        <div style={{display:'flex', alignItems:'center', gap:8, marginTop:'auto'}}>
                          <strong style={{fontFamily:'var(--font-num)', fontSize:15}}>{fmt(item.cost, 0)}</strong>
                          <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{unit}</span>
                          <button
                            className="btn btn--sm btn--primary"
                            style={{marginLeft:'auto'}}
                            disabled={busyId === item.id || !affordable}
                            title={affordable ? undefined : t('pt_not_enough', { unit })}
                            onClick={() => redeem(item)}
                          >{busyId === item.id ? '…' : t('pt_get')}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{fontSize:12, color:'var(--color-text-tertiary)'}}>{t('pt_no_items')}</div>
              )}
            </window.SectionCard>

            {/* 원장 내역 */}
            {data.history.length > 0 && (
              <window.SectionCard title={t('pt_history')} subtitle={t('pt_history_sub')} noPadding>
                <window.DataTable
                  columns={[
                    { key:'when', label:t('pt_col_when'), render: r => (
                      <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-tertiary)'}}>
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
                      </span>
                    ) },
                    { key:'reason', label:t('pt_col_reason'), render: r => t(REASON_KEY[r.reason] || 'pt_reason_other') },
                    { key:'delta', label:t('pt_col_change'), align:'right', render: r => (
                      <strong style={{fontFamily:'var(--font-num)', color: r.delta > 0 ? 'var(--color-success)' : 'var(--color-danger)'}}>
                        {r.delta > 0 ? '+' : ''}{fmt(r.delta, 0)}
                      </strong>
                    ) },
                    /* 각 항목 직후 잔액. 원장이 맞는지 사용자도 확인할 수 있다. */
                    { key:'after', label:t('pt_col_after'), align:'right', render: r => (
                      <span style={{fontFamily:'var(--font-num)'}}>{fmt(r.balanceAfter, 0)}</span>
                    ) },
                  ]}
                  rows={data.history}
                />
              </window.SectionCard>
            )}

            {err && <div style={{fontSize:11.5, color:'var(--color-danger)'}}>{t('admin_load_failed')} · {err}</div>}
          </>
        )}
      </window.PageShell>
    );
  };
})();
