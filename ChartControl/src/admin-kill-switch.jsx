/* ============================================================
   킬스위치 조작 패널 (운영자)

   ★★ 왜 이 파일이 생겼나

     킬스위치는 **끄고 켜는 화면이 없었다.** 관리자 화면은 "몇 개 켜져 있음" 만
     보여줬고, api-client 의 setKillSwitch 는 구현돼 있지만 부르는 UI 가 없었다
     (그 사실이 주석에 적혀 있었다). 그런데 부팅 로그는 운영자에게
     "관리자 콘솔에서 끄십시오" 라고 안내한다 — 갈 곳이 없는 안내다.

     게다가 이제 이 스위치들이 실주문을 **실제로 막는다.** 누군가 켜면 화면에서
     되돌릴 방법이 없어 DB 를 직접 만져야 한다. 비상정지 장치를 비상시에 못
     끄는 상태다.

   ★ 되돌릴 수 없는 작업은 아니지만 즉시 거래를 멈춘다. 그래서 사유를 반드시
     받고(왜 멈췄는지 모르면 언제 풀지도 모른다), 서버가 요구하는 재인증과
     낙관적 잠금(version)을 그대로 전달한다.
   ============================================================ */
(function () {
  'use strict';

  const { useState, useCallback } = React;
  const I18n = window.QTI18n;
  const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);

  /** 서버 응답의 활성 여부. 필드 이름이 구현마다 달라 모두 본다. */
  const isOn = (k) => Boolean(k && (k.active || k.enabled || k.engaged));

  /*
     실주문을 막는 스코프. 서버의 ORDER_BLOCKING_KILL_SCOPES 와 같은 목록이다.
     ★ 화면은 이 목록을 **표시 강조**에만 쓴다. 실제 차단 판정은 서버가 한다 —
       화면 목록이 뒤처져도 차단이 약해지지 않는다.
  */
  const BLOCKING = ['global_live_trading', 'exchange_live_trading', 'bitmart_live_trading', 'new_positions'];

  window.AdminKillSwitchPanel = function AdminKillSwitchPanel() {
    const adm = window.useAdminData ? window.useAdminData() : { version: 0, refresh: () => {} };
    const switches = window.QTAdmin ? window.QTAdmin.getKillSwitches() : null;
    const [busyId, setBusyId] = useState(null);
    const [msg, setMsg] = useState(null);

    const canWrite = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.kill_switch.write'));

    const toggle = useCallback(async (k) => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.setKillSwitch) return;
      const turningOn = !isOn(k);

      /*
         ★ 사유를 받는다. 취소하면 아무 일도 하지 않는다 — 실수로 거래를 멈추거나
           반대로 푸는 것을 막는 유일한 확인 단계다.
      */
      // eslint-disable-next-line no-alert
      const reason = window.prompt(
        turningOn ? t('ks_reason_on', { scope: k.scope }) : t('ks_reason_off', { scope: k.scope }),
        '',
      );
      if (reason === null) return;
      if (String(reason).trim().length < 4) { setMsg({ ok: false, text: t('ks_reason_too_short') }); return; }

      setBusyId(k.id);
      setMsg(null);
      try {
        const r = await api.setKillSwitch(k.id, {
          scope: k.scope,
          active: turningOn,
          target: k.target != null ? k.target : null,
          reason: String(reason).trim(),
          // 서버가 재인증 확인을 요구한다. 사유 입력이 그 확인 절차다.
          reauth: true,
          version: Number(k.version) || 0,
        });
        if (r && r.error) {
          /*
             ★ 낙관적 잠금 충돌은 다르게 알린다. 다른 운영자가 방금 바꿨다는
               뜻이므로, 덮어쓰지 말고 다시 읽어야 한다.
          */
          const code = r.error.code || '';
          setMsg({
            ok: false,
            text: code === 'VERSION_CONFLICT' ? t('ks_conflict') : (r.error.message || t('ks_failed')),
          });
        } else {
          setMsg({ ok: true, text: turningOn ? t('ks_turned_on', { scope: k.scope }) : t('ks_turned_off', { scope: k.scope }) });
        }
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('ks_failed') });
      }
      setBusyId(null);
      // 성공이든 실패든 서버 상태를 다시 읽는다 — 화면이 실제 상태와 어긋나면 안 된다.
      if (adm.refresh) adm.refresh();
    }, [adm]);

    if (!Array.isArray(switches)) {
      return (
        <window.SectionCard title={t('ks_title')} subtitle={t('ks_subtitle')}>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
            {switches === null ? '…' : t('ks_unavailable')}
          </div>
        </window.SectionCard>
      );
    }

    const onCount = switches.filter(isOn).length;

    return (
      <window.SectionCard
        title={t('ks_title')}
        subtitle={t('ks_subtitle_count', { n: onCount, total: switches.length })}
        noPadding
      >
        {msg && (
          <div
            role="status"
            style={{
              padding: '7px 11px', fontSize: 11.5,
              borderBottom: '1px solid var(--color-border-subtle)',
              color: msg.ok ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)',
            }}
          >
            {msg.text}
          </div>
        )}
        {!canWrite && (
          <div style={{ padding: '7px 11px', fontSize: 11.5, color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border-subtle)' }}>
            {t('ks_read_only')}
          </div>
        )}
        {switches.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{t('ks_none')}</div>
        )}
        {switches.map((k) => {
          const on = isOn(k);
          const blocks = BLOCKING.indexOf(k.scope) >= 0;
          return (
            <div
              key={k.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 11px', borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <span
                style={{
                  fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, minWidth: 44, textAlign: 'center',
                  background: on ? 'var(--color-danger, #dc2626)' : 'var(--color-bg-elevated)',
                  color: on ? '#fff' : 'var(--color-text-secondary)',
                }}
              >
                {on ? t('ks_on') : t('ks_off')}
              </span>
              <span style={{ flex: 1, fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--font-num)' }}>{k.scope}</span>
                {k.target ? <span style={{ color: 'var(--color-text-tertiary)' }}>{' · ' + k.target}</span> : null}
                {/* ★ 이 스위치가 실주문을 막는지 밝힌다. 막지 않는 스위치를 켜고
                      "멈췄다" 고 믿는 것이 이 화면이 없던 동안의 실제 문제였다. */}
                {blocks && (
                  <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
                    {t('ks_blocks_orders')}
                  </span>
                )}
                {k.reason ? (
                  <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{k.reason}</div>
                ) : null}
              </span>
              <button aria-label={canWrite ? undefined : t('ks_read_only')}
                type="button"
                className="btn btn--sm"
                disabled={!canWrite || busyId === k.id}
                onClick={() => toggle(k)}
                title={canWrite ? undefined : t('ks_read_only')}
              >
                {busyId === k.id ? '…' : (on ? t('ks_turn_off') : t('ks_turn_on'))}
              </button>
            </div>
          );
        })}
      </window.SectionCard>
    );
  };
}());
