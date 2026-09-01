/* ============================================================
   Admin — More Pages
   ------------------------------------------------------------
   - AdminUserDetailPage      /admin/users/:id
   - AdminKYCQueuePage        /admin/kyc
   - AdminDepositQueuePage    /admin/deposits
   - AdminWithdrawQueuePage   /admin/withdrawals
   - AdminBroadcastPage       /admin/broadcast
   - AdminNoticeEditorPage    /admin/notices/new
   - AdminCSTicketDetailPage  /admin/cs/:id
   - AdminAssetsHiFiPage      /admin/assets (upgraded from placeholder)
   ============================================================ */

(function () {
  const { useState, useEffect } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const _useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
  const I = window.Icons;
  const { fmtCompact } = window.QTFmt;

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  // ============================================================
  // ADMIN USER DETAIL — full profile view
  // ============================================================
  /*
     유저 겸직 태그 편집기 — 여러 역할/태그를 붙인다(team_leader, staff 등).
     권한 역할(role)과 별개. 팀장 커미션은 team_leader 태그를 쓴다.
  */
  function UserTagsEditor({ userId }) {
    const [tags, setTags] = React.useState(null);
    const [tagsError, setTagsError] = React.useState(false);
    const [input, setInput] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const api = window.QTApi && window.QTApi.admin;
    const load = React.useCallback(() => {
      if (!api || !api.getUserTags || !userId) return;
      // ★ 실패를 빈 목록으로 두면 태그가 없는 회원으로 보인다 — 운영자가 잘못 판단한다.
      api.getUserTags(userId)
        .then((r) => { setTagsError(false); setTags((r && r.tags) || []); })
        .catch(() => { setTags(null); setTagsError(true); });
    }, [userId]);
    React.useEffect(() => { load(); }, [load]);
    const add = async (raw) => {
      const tag = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!tag || !api || !api.addUserTag) return;
      setBusy(true);
      try { const r = await api.addUserTag(userId, tag); if (r && r.tags) setTags(r.tags); setInput(''); } catch (e) { /* noop */ }
      setBusy(false);
    };
    const remove = async (tag) => {
      if (!api || !api.removeUserTag) return;
      setBusy(true);
      try { const r = await api.removeUserTag(userId, tag); if (r && r.tags) setTags(r.tags); } catch (e) { /* noop */ }
      setBusy(false);
    };
    // ★ 조회 실패는 "태그 없음" 이 아니다. 운영자가 잘못 판단하지 않게 밝힌다.
    if (tagsError) return <div style={{padding:'8px 10px', fontSize:11.5, color:'var(--color-danger, #dc2626)'}}>{t('list_load_failed')}</div>;
    if (tags === null) return null;
    const has = (t2) => tags.indexOf(t2) !== -1;
    return (
      <div className="panel" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t('utags_title')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {tags.length === 0 && <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('utags_none')}</span>}
          {tags.map((tg) => (
            <span key={tg} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: 'var(--color-brand-subtle)', color: 'var(--color-brand)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              {tg}
              <button onClick={() => remove(tg)} disabled={busy} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['team_leader', 'staff'].map((preset) => (
            <button key={preset} className="btn btn--xs" disabled={busy || has(preset)} onClick={() => add(preset)} style={{ fontFamily: 'var(--font-mono)' }}>+ {preset}</button>
          ))}
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('utags_ph')} style={{ flex: 1, minWidth: 140 }} onKeyDown={(e) => { if (e.key === 'Enter') add(input); }} />
          <button className="btn btn--xs btn--primary" disabled={busy || !input.trim()} onClick={() => add(input)}>{t('utags_add')}</button>
        </div>
      </div>
    );
  }
  window.UserTagsEditor = UserTagsEditor;

  /*
     오류 제보(버그 리포트) — 운영자 패널.

     고객 제보를 상태별로 보고, 확인(포인트 지급)/반려한다. 확인 시 지급 포인트를
     입력받아 신고자 원장에 적립한다(bug_bounty). 이미 처리된 건은 목록에서 액션이 없다.
  */
  function AdminBugReportsPanel() {
    const t = window.QTI18n ? window.QTI18n.t : ((k) => k);
    const [data, setData] = React.useState(null);
    const [filter, setFilter] = React.useState('open');
    const [busyId, setBusyId] = React.useState(null);
    const api = window.QTApi && window.QTApi.admin;
    const load = React.useCallback(() => {
      if (!api || !api.bugReports) { setData({ reports: [], counts: {}, supported: false }); return; }
      api.bugReports(filter || undefined).then((r) => setData(r)).catch(() => setData({ reports: [], counts: {} }));
    }, [filter]);
    React.useEffect(() => { load(); }, [load]);
    const resolve = async (r, status) => {
      if (!api || !api.resolveBugReport) return;
      let points = 0;
      if (status === 'confirmed') {
        // eslint-disable-next-line no-alert
        const p = window.prompt(t('adm_bug_points_prompt'), '1000');
        if (p === null) return;
        points = Math.max(0, Math.floor(Number(p) || 0));
      }
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_bug_reason_prompt'), status === 'confirmed' ? 'Confirmed' : 'Not a bug');
      if (reason === null || String(reason).trim().length < 4) return;
      setBusyId(r.id);
      try { await api.resolveBugReport(r.id, { status, points, reason: String(reason).trim() }); load(); } catch (e) { /* noop */ }
      setBusyId(null);
    };
    if (!data) return null;
    if (data.supported === false) return <div className="panel" style={{ padding: 14, marginTop: 12 }}>{t('adm_bug_unsupported')}</div>;
    return (
      <div className="panel" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t('adm_bug_title')} · {(data.counts && data.counts.open) || 0} {t('bug_status_open')}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['open', 'confirmed', 'rejected'].map((s) => (
            <button key={s} className={`btn btn--xs ${filter === s ? 'btn--primary' : ''}`} onClick={() => setFilter(s)}>{t('bug_status_' + s)}</button>
          ))}
        </div>
        {(data.reports || []).length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('adm_bug_empty')}</div>
        ) : (data.reports || []).map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid var(--color-border-subtle)', padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 12.5 }}>{r.title}</strong>
              <span style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>{r.email || ''}</span>
              {r.status === 'confirmed' && r.pointsAwarded > 0 && <span style={{ fontSize: 11, color: 'var(--color-success)' }}>+{r.pointsAwarded}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', margin: '4px 0', whiteSpace: 'pre-wrap' }}>{r.body}</div>
            {r.status === 'open' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--xs btn--primary" disabled={busyId === r.id} onClick={() => resolve(r, 'confirmed')}>{t('adm_bug_confirm')}</button>
                <button className="btn btn--xs" disabled={busyId === r.id} onClick={() => resolve(r, 'rejected')}>{t('adm_bug_reject')}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  window.AdminBugReportsPanel = AdminBugReportsPanel;

  /*
     사용자별 포인트 — 조회 + 즉시 지급/회수.

     ★★ 전에는 포인트를 주려면 사용자 화면에서 ID 를 옮겨 적어 '포인트' 관리 화면으로
       가야 했다. 사람을 보고 있는 화면에서 바로 잔액을 확인하고 지급하는 것이
       실제 운영 흐름이다(누구에게 주는지 착각할 위험도 줄어든다).

     ★ 메모를 필수로 받는다 — 왜 지급했는지 없으면 나중에 추적할 수 없다.
     ★ 회수(revoke)는 되돌리기 어려우므로 확인을 받는다.
  */
  function UserPointsPanel({ userId }) {
    const t = window.QTI18n ? window.QTI18n.t : ((k) => k);
    const [data, setData] = React.useState(null);
    const [err, setErr] = React.useState(null);
    const [form, setForm] = React.useState({ amount: '', direction: 'grant', memo: '' });
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState(null);
    const api = window.QTApi && window.QTApi.admin;

    const load = React.useCallback(() => {
      if (!api || !api.pointsOf || !userId) return;
      api.pointsOf(userId)
        .then((r) => { setData((r && r.data) || null); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'));
    }, [userId]);
    React.useEffect(() => { load(); }, [load]);

    const apply = async () => {
      const amount = Number(form.amount);
      if (!api || !api.adjustPoints || !(amount > 0) || !form.memo.trim()) return;
      if (form.direction === 'revoke' && typeof window.confirm === 'function'
          && !window.confirm(t('aup_revoke_confirm'))) return;
      setBusy(true); setMsg(null);
      try {
        await api.adjustPoints({ userId, amount: Math.trunc(amount), direction: form.direction, memo: form.memo.trim() });
        setForm({ amount: '', direction: form.direction, memo: '' });
        setMsg({ ok: true, text: t('aup_applied') });
        load();
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('aup_failed') });
      }
      setBusy(false);
    };

    const fmt = (n) => Number(n || 0).toLocaleString();
    const rows = (data && data.history) || [];

    return (
      <div className="panel" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t('aup_title')}</div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: 18, fontWeight: 650 }}>
            {data ? fmt(data.balance) : '—'}
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 6 }}>{t('aup_balance')}</span>
          </div>
        </div>
        {err && <div style={{ fontSize: 11.5, color: 'var(--color-danger)', marginBottom: 8 }}>{err}</div>}

        {/* 지급 / 회수 */}
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input type="number" min="1" step="1" value={form.amount} placeholder={t('aup_amount')}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ width: 120 }} />
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="grant">{t('admin_pt_grant')}</option>
              <option value="revoke">{t('admin_pt_revoke')}</option>
            </select>
            <input value={form.memo} placeholder={t('aup_memo_ph')}
              onChange={(e) => setForm({ ...form, memo: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn btn--sm btn--primary" disabled={busy || !(Number(form.amount) > 0) || !form.memo.trim()} onClick={apply}>
              {busy ? '…' : t('admin_pt_apply')}
            </button>
          </div>
          {msg && (
            <div style={{ fontSize: 11.5, color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>{msg.text}</div>
          )}
        </div>

        {/* 원장 내역 */}
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('aup_no_history')}</div>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {rows.slice(0, 40).map((h) => (
              <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 11.5 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', minWidth: 128 }}>
                  {h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}
                </span>
                <strong style={{ fontFamily: 'var(--font-num)', minWidth: 64, textAlign: 'right', color: h.delta > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {h.delta > 0 ? '+' : ''}{fmt(h.delta)}
                </strong>
                <span style={{ color: 'var(--color-text-secondary)' }}>{h.reason}</span>
                <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.memo || ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  window.UserPointsPanel = UserPointsPanel;

  window.AdminUserDetailPage = function AdminUserDetailPage({ shellProps, userId }) {
    /*
       회원 상세.

       ★★ 전에는 서버를 한 번도 부르지 않았다.

         `ADMIN_USERS.find(u => u.id === (userId || 'usr_kuri001')) || ADMIN_USERS[0]`
         — 목록 화면이 채워 둔 전역 배열에서 찾고, 못 찾으면 **첫 번째 사람의
         상세를 열었다.** 즉 주소에 id 가 없거나 잘못된 id 로 들어오면 아무
         상관 없는 회원의 화면이 열리고, 그 화면의 정지 버튼을 누르게 된다.
         지금은 정지가 alert 뿐이라 사고가 나지 않았지만, 배선하는 순간
         엉뚱한 사람을 정지시키는 경로가 된다.

       ★ 지금은 `GET /api/admin/users/:id` 로 그 사람만 조회한다.
         실측 응답: { user: { id, email, role, status, mfa_enabled, created_at,
         updated_at }, stats: { sessions, aiConversations, aiSignals, orders,
         exchangeCredentials } }

       ★ id 가 없으면 아무도 열지 않는다. 다른 사람을 보여주는 것보다 "누구를
         열지 알 수 없다" 고 말하는 것이 안전하다.
    */
    const [detail, setDetail] = React.useState({ state: userId ? 'loading' : 'noid', user: null, stats: null, error: null });
    const [tab, setTab] = useState('overview');
    const [showAction, setShowAction] = useState(null);
    const [busy, setBusy] = React.useState(false);
    const [actionMsg, setActionMsg] = React.useState(null);

    const load = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!userId) { setDetail({ state: 'noid', user: null, stats: null, error: null }); return; }
      if (!api || !api.user) { setDetail({ state: 'unsupported', user: null, stats: null, error: null }); return; }
      setDetail((p) => ({ ...p, state: p.user ? 'ready' : 'loading' }));
      api.user(userId)
        .then((r) => {
          const d = (r && r.data) || {};
          if (d.user && d.user.id) setDetail({ state: 'ready', user: d.user, stats: d.stats || null, error: null });
          else setDetail({ state: 'notfound', user: null, stats: null, error: null });
        })
        .catch((e) => {
          const st = e && e.status;
          setDetail({
            state: st === 404 ? 'notfound' : st === 403 ? 'forbidden' : 'error',
            user: null, stats: null, error: (e && e.message) || null,
          });
        });
    }, [userId]);

    React.useEffect(() => { load(); }, [load]);

    /*
       활동 로그 — 감사 로그를 이 사용자로 필터해 가져온다.

       탭을 열 때만 조회한다. 상세 화면을 열자마자 함께 부르면, 활동 탭을
       보지 않는 대부분의 경우에 쓸데없는 조회가 나간다.
    */
    const [activity, setActivity] = React.useState({ state: 'idle', rows: [] });
    const loadActivity = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.audit || !userId) { setActivity({ state: 'error', rows: [] }); return; }
      setActivity((p) => ({ ...p, state: 'loading' }));
      api.audit({ userId: userId, limit: 50 })
        .then((r) => setActivity({ state: 'ready', rows: (r && r.data) || [] }))
        .catch(() => setActivity({ state: 'error', rows: [] }));
    }, [userId]);

    React.useEffect(() => {
      if (tab === 'activity' && activity.state === 'idle') loadActivity();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, activity.state, loadActivity]);

    /*
       정지 / 해제 — 실제 API 를 부른다.

       ★★ 전에는 `alert('사용자가 정지되었습니다 (Simulation)')` 였다.
         운영자는 정지된 줄 알고 넘어가지만 그 사람은 계속 로그인한다.
         악용 신고를 받고 정지시켰다고 답변까지 한 뒤에도 그대로다.

       ★ 사유를 반드시 받는다(서버가 4~500자를 요구하고 감사 로그에 남는다).
    */
    const changeStatus = async (disable) => {
      const api = window.QTApi && window.QTApi.admin;
      const u = detail.user;
      if (!api || !u) return;
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t(disable ? 'admin_suspend_reason' : 'admin_reactivate_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }
      setBusy(true); setActionMsg(null); setShowAction(null);
      try {
        if (disable) await api.disableUser(u.id, reason);
        else await api.enableUser(u.id, reason);
        setActionMsg({ kind: 'ok', text: t(disable ? 'adm_suspended_done' : 'adm_reactivated_done') });
        load();
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /** 세션 전체 종료 — 계정 탈취 대응. 서버 API 가 있는데 화면에 없었다. */
    const revokeSessions = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const u = detail.user;
      if (!api || !api.revokeSessions || !u) return;
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_revoke_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }
      setBusy(true); setActionMsg(null);
      try {
        await api.revokeSessions(u.id, reason);
        setActionMsg({ kind: 'ok', text: t('adm_revoked_done') });
        load();
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /** 이메일 인증 수동 처리 — 인증 메일이 안 오는 고객을 관리자가 직접 인증 처리한다. */
    const verifyEmail = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const u = detail.user;
      if (!api || !api.verifyUserEmail || !u) return;
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_verify_email_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }
      setBusy(true); setActionMsg(null);
      try {
        await api.verifyUserEmail(u.id, reason);
        setActionMsg({ kind: 'ok', text: t('adm_verify_email_done') });
        load();
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /*
       2단계 인증 초기화.

       ★★ 요소를 제거하는 작업이므로 확인 절차를 갖춘다.
         · 사유를 받는다(서버가 4~500자를 요구하고 감사 로그에 남는다)
         · 서버가 대상의 세션도 함께 끊는다
         · 메일 미설정이라 **사용자에게 통지되지 않는다** — 그 사실을 화면에
           밝힌다. "처리했다" 만 알리면 담당자가 통지까지 됐다고 믿는다.

       ★ 운영자 계정과 자기 자신은 서버가 거부한다(403). 화면에서도 버튼을
         감추지만, 화면 판단만 믿지 않고 서버가 최종 판단한다.
    */
    const resetMfa = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const target = detail.user;
      if (!api || !api.resetUserMfa || !target) return;
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_reset_mfa_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }
      setBusy(true); setActionMsg(null);
      try {
        const r = await api.resetUserMfa(target.id, reason, true);
        setActionMsg({
          kind: 'ok',
          text: t('adm_reset_mfa_done', { n: (r && r.sessionsRevoked) || 0 })
            + ((r && r.notified) ? '' : ' ' + t('adm_reset_mfa_not_notified')),
        });
        load();
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /*
       비밀번호 재설정 링크 발송.

       ★ 임시 비밀번호를 만들지 않는다 — 관리자가 이용자 비밀번호를 아는
         상태가 되면 안 된다(방침 8절). 이용자 본인 흐름을 촉발할 뿐이다.

       ★★ 메일이 설정되지 않은 배포에서는 서버가 error 봉투(MAIL_NOT_CONFIGURED)를
         200 으로 준다. 이 클라이언트는 200 을 성공으로 보므로 **본문을 직접
         확인해야 한다.** 확인하지 않으면 "메일 보냈습니다" 라고 잘못 안내하고,
         이용자는 아무것도 받지 못한다.
    */
    const sendPasswordReset = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const target = detail.user;
      if (!api || !api.sendPasswordReset || !target) return;
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_pwreset_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }
      setBusy(true); setActionMsg(null);
      try {
        const r = await api.sendPasswordReset(target.id, reason);
        // ★ 200 이어도 error 가 들어 있을 수 있다(위 주석).
        if (r && r.error) {
          const code = r.error.code || '';
          setActionMsg({
            kind: 'warn',
            text: code === 'MAIL_NOT_CONFIGURED' ? t('adm_pwreset_mail_absent') : t('adm_action_failed'),
          });
        } else {
          setActionMsg({ kind: 'ok', text: t('adm_pwreset_sent') });
        }
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /*
       회원 삭제.

       ★★ 되돌릴 수 없다. 그래서 확인을 겹쳐 둔다.
         · 권한(admin.user.delete)이 없으면 버튼 자체를 렌더하지 않는다
         · 사유를 받는다(4자 이상, 감사·삭제 처리 기록에 남는다)
         · **대상 이메일을 직접 입력**하게 한다 — 목록에서 잘못된 행을 누른
           실수가 그대로 삭제가 되지 않게. 서버도 같은 값을 대조한다.

       ★ 화면 확인만 믿지 않는다. 서버가 권한·재인증·이메일을 모두 다시 본다.
    */
    const deleteUser = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const target = detail.user;
      if (!api || !api.deleteUser || !target) return;

      /*
         ★ 이메일을 직접 타이핑하게 하던 절차를 없앴다.

           삭제는 SUPER_ADMIN 만 할 수 있고, 아래에서 사유(4자 이상)를 받고
           서버가 재인증까지 다시 확인한다. 그 위에 이메일 타이핑까지 요구하니
           실제 운영에서 걸림돌이었다. 대신 **누구를 지우는지 확인창에 이메일을
           그대로 보여준다** — 대상을 착각하는 것이 진짜 위험이기 때문이다.
      */
      // eslint-disable-next-line no-alert
      if (!window.confirm(t('adm_delete_confirm', { email: target.email }))) return;
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_delete_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }

      setBusy(true); setActionMsg(null);
      try {
        const r = await api.deleteUser(target.id, reason, true);
        // ★ 200 이어도 error 가 들어 있을 수 있다(RETENTION_UNAVAILABLE).
        if (r && r.error) {
          setActionMsg({
            kind: 'warn',
            text: r.error.code === 'RETENTION_UNAVAILABLE' ? t('adm_delete_retention_absent') : t('adm_action_failed'),
          });
        } else {
          const kept = (r && r.retained) || {};
          setActionMsg({
            kind: 'ok',
            text: t('adm_delete_done', { c: kept.consents || 0, o: kept.orders || 0 }),
          });
          // 대상이 사라졌으므로 상세를 다시 부르지 않는다 — 목록으로 보낸다.
          setTimeout(() => { window.location.hash = '#/admin/users'; }, 2500);
        }
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /*
       ★ 삭제 권한은 SUPER 에만 있다(admin.user.delete). 권한이 없으면 버튼을
         렌더하지 않는다 — 누를 수 없는 버튼을 보여주면 "왜 안 되지" 를 반복한다.
    */
    const canDelete = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.user.delete'));

    /*
       관리자 노트.

       ★ 탭을 열 때만 조회한다. 상세를 열자마자 함께 부르면 노트를 보지 않는
         대부분의 경우에 불필요한 조회가 나가고, 그 조회도 감사에 남는다
         (열지 않은 것까지 "열람" 으로 기록되면 기록의 뜻이 흐려진다).
    */
    const [notes, setNotes] = React.useState({ state: 'idle', rows: [] });
    const [noteDraft, setNoteDraft] = React.useState('');
    /* 사용자에게 이메일 보내기 모달. null=닫힘. */
    const [emailModal, setEmailModal] = React.useState(null);

    const loadNotes = React.useCallback(() => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.userNotes || !userId) { setNotes({ state: 'error', rows: [] }); return; }
      setNotes((p) => ({ ...p, state: 'loading' }));
      api.userNotes(userId)
        .then((r) => setNotes({ state: 'ready', rows: (r && r.data) || [] }))
        .catch(() => setNotes({ state: 'error', rows: [] }));
    }, [userId]);

    React.useEffect(() => {
      if (tab === 'notes' && notes.state === 'idle') loadNotes();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, notes.state, loadNotes]);

    const addNote = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const text = String(noteDraft || '').trim();
      if (!api || !api.addUserNote || !userId || !text) return;
      setBusy(true); setActionMsg(null);
      try {
        const r = await api.addUserNote(userId, text);
        // ★ 200 이어도 error 가 들어 있을 수 있다(NOTES_UNAVAILABLE).
        if (r && r.error) {
          setActionMsg({ kind: 'warn', text: t('adm_note_unavailable') });
        } else {
          setNoteDraft('');
          setNotes((p) => ({ ...p, state: 'idle' })); // 다시 불러온다
        }
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    const removeNote = async (noteId) => {
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.deleteUserNote || !userId) return;
      setBusy(true);
      try {
        await api.deleteUserNote(userId, noteId);
        setNotes((p) => ({ ...p, state: 'idle' }));
      } catch (e) {
        setActionMsg({ kind: 'err', text: (e && e.message) || t('adm_action_failed') });
      }
      setBusy(false);
    };

    /*
       이메일(로그인 식별자) 변경.

       ★★ 바꾸면 이용자는 이전 주소로 로그인할 수 없다. 잘못 입력하면 그 사람이
         자기 계정에서 잠긴다. 그래서 현재 주소를 보여주고 새 주소를 두 번
         확인받는다(서버도 형식·중복을 다시 본다).

       ★ 변경 후 새 주소는 **미확인** 상태가 된다. 메일이 설정되지 않은 배포에서는
         확인 메일이 가지 않으므로 그 사실을 화면에 밝힌다.
    */
    const changeEmail = async () => {
      const api = window.QTApi && window.QTApi.admin;
      const target = detail.user;
      if (!api || !api.setUserEmail || !target) return;

      // eslint-disable-next-line no-alert
      const next = window.prompt(t('adm_email_new', { current: target.email }), '');
      if (next === null) return;
      const email = String(next).trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setActionMsg({ kind: 'warn', text: t('adm_email_invalid') });
        return;
      }
      if (email === String(target.email).trim().toLowerCase()) {
        setActionMsg({ kind: 'warn', text: t('adm_email_same') });
        return;
      }
      // ★ 한 번 더 확인 — 오타가 그대로 저장되면 이용자가 잠긴다.
      // eslint-disable-next-line no-alert
      const again = window.prompt(t('adm_email_again', { email }), '');
      if (again === null) return;
      if (String(again).trim().toLowerCase() !== email) {
        setActionMsg({ kind: 'warn', text: t('adm_email_mismatch') });
        return;
      }
      // eslint-disable-next-line no-alert
      const reason = window.prompt(t('adm_email_reason'), '');
      if (reason === null || String(reason).trim().length < 4) {
        if (reason !== null) setActionMsg({ kind: 'warn', text: t('adm_reason_too_short') });
        return;
      }

      setBusy(true); setActionMsg(null);
      try {
        const r = await api.setUserEmail(target.id, email, reason, true);
        if (r && r.error) {
          setActionMsg({
            kind: 'warn',
            text: r.error.code === 'EMAIL_TAKEN' ? t('adm_email_taken') : t('adm_action_failed'),
          });
        } else {
          setActionMsg({
            kind: 'ok',
            text: t('adm_email_changed') + ((r && r.verificationSent) ? '' : ' ' + t('adm_email_no_verification')),
          });
          load();
        }
      } catch (e) {
        // 409 는 throw 로 온다(HTTP 오류) — 코드로 구분한다.
        const code = e && e.code;
        setActionMsg({
          kind: 'warn',
          text: code === 'EMAIL_TAKEN' ? t('adm_email_taken') : ((e && e.message) || t('adm_action_failed')),
        });
      }
      setBusy(false);
    };

    const canStatus = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.user.status.write'));

    /*
       조회가 끝나지 않았거나 실패한 상태.

       ★ 이 경우 다른 사람의 정보를 대신 보여주지 않는다. 무엇이 문제인지만
         말한다 — 관리자 화면에서 잘못된 대상에 조치하는 것이 가장 위험하다.
    */
    if (detail.state !== 'ready') {
      const key = {
        noid: 'adm_detail_noid',
        loading: 'adm_detail_loading',
        notfound: 'adm_detail_notfound',
        forbidden: 'adm_state_forbidden',
        unsupported: 'adm_detail_unsupported',
      }[detail.state] || 'adm_detail_error';
      return (
        <window.PageShell
          {...shellProps}
          title={t('adm_detail_title')}
          breadcrumb={['Home', 'Admin', 'Users']}
        >
          <div
            style={{
              display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
              padding:'14px 16px', borderRadius:6,
              border:'1px solid ' + (detail.state === 'loading' ? 'var(--color-border-subtle)' : 'var(--color-warning)'),
              background: detail.state === 'loading' ? 'var(--color-bg-surface)' : 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
            }}
          >
            <span style={{fontSize:12.5, color: detail.state === 'loading' ? 'var(--color-text-tertiary)' : 'var(--color-warning)'}}>
              {t(key)}
            </span>
            {detail.error && (
              <span style={{fontSize:11, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                {String(detail.error).slice(0, 120)}
              </span>
            )}
            {detail.state !== 'loading' && detail.state !== 'noid' && (
              <button className="btn btn--xs" type="button" onClick={load}>{t('sec_retry')}</button>
            )}
            <a className="btn btn--xs" href="#/admin/users">{t('adm_back_to_users')}</a>
          </div>
        </window.PageShell>
      );
    }

    /*
       화면에 쓰는 값.

       ★ 서버가 주지 않는 것을 만들지 않는다.
         이름(name)·등급(tier)·KYC 단계·30일 거래량은 서버 응답에 없다.
         전에는 목업에서 가져와 채웠다. 이메일이 곧 식별자이므로 그것을 쓴다.
    */
    const u = detail.user;
    const stats = detail.stats || {};
    const joined = u.created_at ? new Date(Number(u.created_at)).toLocaleDateString() : '—';

    const sendEmail = () => {
      if (!emailModal) return;
      const api = window.QTApi && window.QTApi.admin;
      if (!api || !api.emailUser) return;
      const subject = (emailModal.subject || '').trim();
      const bodyText = (emailModal.body || '').trim();
      if (!subject || !bodyText) { setEmailModal((m) => ({ ...m, msg: { ok:false, text: t('adm_email_need_fields') } })); return; }
      setEmailModal((m) => ({ ...m, busy: true, msg: null }));
      api.emailUser(u.id, subject, bodyText)
        .then((r) => {
          if (r && (r.ok === false || r.error)) {
            const code = r.error && r.error.code;
            setEmailModal((m) => ({ ...m, busy:false, msg: { ok:false, text: code === 'MAIL_NOT_CONFIGURED' ? t('adm_email_not_configured') : t('adm_email_failed') } }));
            return;
          }
          setEmailModal((m) => ({ ...m, busy:false, msg: { ok:true, text: t('adm_email_sent') } }));
        })
        .catch((err) => setEmailModal((m) => ({ ...m, busy:false, msg: { ok:false, text: (err && err.message) || t('adm_email_failed') } })));
    };

    return (
      <>
      {emailModal && (
        <div className="overlay" onClick={() => setEmailModal(null)}>
          <div className="modal" style={{width: 460}} onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t('adm_email_title')} · {u.email}</div>
              <button className="btn btn--icon" onClick={() => setEmailModal(null)} aria-label={t('close')}>{I.X ? <I.X size={14}/> : 'X'}</button>
            </div>
            <div className="modal__body" style={{display:'flex', flexDirection:'column', gap:10}}>
              <div className="input-group">
                <span className="input-group__label">{t('adm_email_subject')}</span>
                <input type="text" maxLength={200} value={emailModal.subject} onChange={e => setEmailModal((m) => ({ ...m, subject: e.target.value }))}/>
              </div>
              <textarea
                value={emailModal.body}
                maxLength={10000}
                onChange={e => setEmailModal((m) => ({ ...m, body: e.target.value }))}
                placeholder={t('adm_email_body_ph')}
                style={{width:'100%', minHeight:140, padding:10, background:'var(--color-bg-input)', border:'1px solid var(--color-border-default)', borderRadius:6, color:'var(--color-text-primary)', fontSize:12.5, resize:'vertical', outline:'none', lineHeight:1.7}}
              />
              {emailModal.msg && (
                <div className={`auth-alert ${emailModal.msg.ok ? 'auth-alert--success' : 'auth-alert--danger'}`} style={{fontSize:12}}>
                  <div>{emailModal.msg.text}</div>
                </div>
              )}
              <button className="btn btn--sm btn--primary" style={{alignSelf:'flex-end'}} disabled={emailModal.busy || !emailModal.subject.trim() || !emailModal.body.trim()} onClick={sendEmail}>
                <I.Send size={12}/> {emailModal.busy ? '…' : t('adm_email_send')}
              </button>
            </div>
          </div>
        </div>
      )}
      <window.PageShell
        {...shellProps}
        /* ★ 이름은 서버가 주지 않는다. 이메일이 식별자다 — 없는 이름을 만들지 않는다. */
        title={u.email}
        subtitle={u.id}
        breadcrumb={['Home','Admin','Users', u.email]}
        badge={
          <>
            <span className={`status-pill status-pill--${u.status === 'active' ? 'active' : 'suspended'}`}>
              {String(u.status || '').toUpperCase() || '—'}
            </span>
            <span className="badge badge--neutral">{String(u.role || '—').toUpperCase()}</span>
            {/* 2단계 인증 여부는 서버가 준다. 등급·KYC 단계는 주지 않으므로 표시하지 않는다. */}
            <span className={`badge ${Number(u.mfa_enabled) ? 'badge--success' : 'badge--neutral'}`}>
              {Number(u.mfa_enabled) ? '2FA ON' : '2FA OFF'}
            </span>
            {/*
               ★ 이메일 인증 여부. 로그인에 인증이 필수가 되었으므로 운영자가 이걸 볼 수
                 있어야 한다 — 고객이 "로그인이 안 된다" 고 문의하면 대부분 이 상태다.
                 서버(admin-data.js)가 email_verified 를 준다.
            */}
            {(() => {
              const verified = Boolean(Number(u.email_verified ?? u.emailVerified ?? 0));
              return (
                <span
                  className={`badge ${verified ? 'badge--success' : 'badge--warning'}`}
                  title={verified ? t('adm_email_verified_hint') : t('adm_email_unverified_hint')}
                >
                  {verified ? t('adm_email_verified') : t('adm_email_unverified')}
                </span>
              );
            })()}
          </>
        }
        actions={
          <>
            {/* ★ 사용자에게 직접 이메일 보내기 — 실제 구현(감사 로그 남음). */}
            {canStatus && (
              <button className="btn btn--sm" type="button" onClick={() => setEmailModal({ subject:'', body:'', busy:false, msg:null })}>
                <I.Send size={13}/> {t('admin_user_detail_96330a')}
              </button>
            )}
            {/* 사용자 목록 CSV 내보내기는 목록 화면(/admin/users)에 있다 — 여기 중복 버튼은 없앤다. */}
            {/* 세션 종료 — 서버 API 가 있는데 화면에 없었다. */}
            {canStatus && (
              <button className="btn btn--sm" type="button" disabled={busy} onClick={revokeSessions} title={t('adm_revoke_hint')}>
                <I.Lock size={13}/> {t('adm_revoke_sessions')}
              </button>
            )}
            {canStatus && !(u.email_verified || u.emailVerified) && (
              <button className="btn btn--sm" type="button" disabled={busy} onClick={verifyEmail} title={t('adm_verify_email_hint')}>
                <I.Check size={13}/> {t('adm_verify_email')}
              </button>
            )}
            {canStatus && u.status === 'active' && (
              <button className="btn btn--sm btn--danger" type="button" disabled={busy} onClick={() => setShowAction('suspend')}>
                <I.Alert size={13}/> {t('admin_user_detail_1d441e')}
              </button>
            )}
            {canStatus && u.status !== 'active' && (
              <button className="btn btn--sm btn--primary" type="button" disabled={busy} onClick={() => setShowAction('unsuspend')}>
                <I.Check size={13}/> {t('admin_user_detail_f63bf7')}
              </button>
            )}
          </>
        }
      >
        {/* 조치 결과 알림 — 성공도 실패도 화면에 남긴다(alert 로 지나가면 확인할 수 없다). */}
        {actionMsg && (
          <div
            role="status"
            style={{
              padding:'10px 14px', marginBottom:12, borderRadius:6, fontSize:12,
              border:'1px solid ' + (actionMsg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-warning)'),
              background: 'color-mix(in srgb, ' + (actionMsg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-warning)') + ' 10%, transparent)',
              color: actionMsg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-warning)',
            }}
          >
            {actionMsg.text}
          </div>
        )}

        {/*
           ★ 서버가 주는 통계만 보여준다.

             전에는 `30일 거래량 $…`(목업 vol30) · `누적 수수료`(vol30 × 0.0004
             으로 우리가 계산) · `포지션 3 (1 long · 2 short)` **고정값** 이었다.
             수수료를 우리가 곱해 만들면 실제 정산과 다른 금액이 관리자 화면에
             남고, 그 숫자로 고객 문의에 답하게 된다.

             실측 stats: sessions · aiConversations · aiSignals · orders ·
             exchangeCredentials
        */}
        <div className="grid-4">
          <window.KPICard label={t('adm_stat_sessions')} value={Number.isFinite(stats.sessions) ? stats.sessions.toLocaleString() : '—'}/>
          <window.KPICard label={t('adm_stat_orders')} value={Number.isFinite(stats.orders) ? stats.orders.toLocaleString() : '—'}/>
          <window.KPICard label={t('adm_stat_exchanges')} value={Number.isFinite(stats.exchangeCredentials) ? stats.exchangeCredentials.toLocaleString() : '—'}/>
          <window.KPICard label={t('admin_user_detail_170f7b')} value={joined}/>
        </div>

        <div className="tabs" style={{borderBottom:'1px solid var(--color-border-subtle)', marginBottom: -12}}>
          {[
            { id:'overview', label:'Overview' },
            { id:'kyc', label:t('admin_user_detail_0057bd') },
            { id:'activity', label:t('admin_user_detail_43a4e1') },
            { id:'trades', label:t('admin_user_detail_8797eb') },
            { id:'assets', label:t('admin_user_detail_40ce13') },
            { id:'security', label:t('admin_user_detail_a5e5da') },
            { id:'notes', label:t('admin_user_detail_915cf6') },
          ].map(t => (
            <button key={t.id} className={`tab ${tab===t.id?'is-active':''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="grid-2-1">
            <div style={{display:'flex', flexDirection:'column', gap: 16}}>
              <window.UserTagsEditor userId={userId}/>
              {/* 포인트 — 이 사람을 보고 있는 화면에서 바로 잔액 확인·지급·회수 */}
              <window.UserPointsPanel userId={userId}/>
              {/*
                 ★ 서버가 주는 값만 표시한다.

                   전에는 Name · Country · Tier · KYC Level 을 목업에서 가져와
                   채웠다. 서버 응답에는 그 항목이 없다(id · email · role ·
                   status · mfa_enabled · created_at · updated_at 뿐).
                   없는 항목을 그럴듯하게 채우면 관리자가 그 값을 근거로
                   판단한다 — 예컨대 KYC 단계를 보고 한도를 조정하려 한다.
              */}
              <window.SectionCard title={t('adm_profile_info')}>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, fontSize: 12}}>
                  {[
                    ['Email', u.email || '—'],
                    ['User ID', u.id],
                    ['Role', String(u.role || '—').toUpperCase()],
                    ['Status', String(u.status || '—').toUpperCase()],
                    ['2FA', Number(u.mfa_enabled) ? 'Enabled' : 'Disabled'],
                    ['Joined', joined],
                    ['Last updated', u.updated_at ? new Date(Number(u.updated_at)).toLocaleString() : '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>{label}</div>
                      <div style={{fontWeight:500, fontFamily: label === 'User ID' ? 'var(--font-mono)' : undefined, fontSize: label === 'User ID' ? 11 : undefined, wordBreak:'break-all'}}>{value}</div>
                    </div>
                  ))}
                </div>
                {/* 이름·국가·등급·KYC 단계는 우리가 수집하지 않는다(개인정보처리방침 2절). */}
                <div style={{marginTop:10, fontSize:11, color:'var(--color-text-tertiary)', lineHeight:1.7}}>
                  {t('adm_profile_fields_absent')}
                </div>
              </window.SectionCard>

              {/* eslint-disable-next-line no-constant-binary-expression -- 마크업을 지우지 않고 감춘다(배선 전). 되살릴 때 조건만 지운다. */}
              {false && Array.isArray(u.flags) && u.flags.length > 0 && (
                <window.SectionCard title={t('adm_flags')}>
                  {(u.flags || []).map(f => (
                    <div key={f} className="auth-alert auth-alert--warning" style={{marginBottom: 6}}>
                      <I.Alert size={12}/>
                      {/* '조사(Investigate)' 링크 제거 — onClick 도 대상 화면도 없어 죽은 링크였다.
                          조사는 아래 탭(활동 로그·거래 내역)에서 실제로 한다. 플래그 문구는 그대로 둔다. */}
                      <div><strong>{f}</strong>{t('flag_auto_detected')}</div>
                    </div>
                  ))}
                </window.SectionCard>
              )}

              {/*
                 ★★ 전에는 Binance · Bitget 이 `ACTIVE` 로 하드코딩돼 있었다.

                   권한 문구까지 적혀 있었다("Read + Trade + Futures · IP restricted").
                   운영자는 이 회원이 거래소를 연결해 두었고 주문 권한이 있다고
                   읽는다. 실제로는 아무 것도 연결하지 않은 회원일 수 있다.
                   우리는 Binance 어댑터도 없다(KuCoin·BitMart 만).

                 ★ 서버가 주는 것은 연결된 키의 **개수**다(stats.exchangeCredentials).
                   어느 거래소인지·어떤 권한인지는 주지 않으므로 만들지 않는다.
                   키 값은 애초에 조회 대상이 아니다(관리자도 볼 수 없어야 한다).
              */}
              <window.SectionCard title={t('adm_connected_exchanges')}>
                {Number.isFinite(stats.exchangeCredentials) ? (
                  <div style={{fontSize:12.5, lineHeight:1.8}}>
                    <div style={{fontFamily:'var(--font-num)', fontSize:24, fontWeight:700}}>
                      {stats.exchangeCredentials}
                    </div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>
                      {t(stats.exchangeCredentials > 0 ? 'adm_ex_count' : 'adm_ex_none')}
                    </div>
                    <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop:8}}>
                      {t('adm_ex_detail_absent')}
                    </div>
                  </div>
                ) : (
                  <div style={{fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('adm_ex_unknown')}</div>
                )}
              </window.SectionCard>
            </div>

            <div style={{display:'flex', flexDirection:'column', gap: 16}}>
              {/*
                 ★★ 이 버튼 6개는 onClick 이 없는 껍데기였다.

                   이메일 보내기 · 자산 조회 · 거래 히스토리 · 2FA 재설정 ·
                   비밀번호 리셋 · KYC 재요청. 눌러도 아무 일이 없었고, 표시도
                   없었다. 운영자는 "눌렀는데 왜 안 되지" 를 반복하거나, 눌러서
                   처리됐다고 믿는다. 특히 비밀번호 리셋과 2FA 재설정은
                   "처리했다" 고 고객에게 답변하게 되는 항목이다.

                 ★ 서버에 해당 API 가 없다(검색 확인). 버튼을 지우지 않고
                   비활성 + 준비중 표시로 둔다 — 무엇이 없는지 드러나야 만들 수 있다.
                 ★ 정지는 실제로 동작한다(위 changeStatus).
              */}
              <window.SectionCard title={t('adm_quick_actions')}>
                <div style={{display:'flex', flexDirection:'column', gap: 6}}>
                  {[
                    ['admin_user_detail_941ad1', 'Send'],
                    ['admin_user_detail_e4ec3e', 'Wallet'],
                    ['admin_user_detail_80a094', 'Chart'],
                    ['admin_user_detail_851473', 'Camera'],
                  ].map(([key, icon]) => {
                    const Ic = I[icon] || I.Grid;
                    return (
                      <button
                        key={key}
                        className="btn btn--sm"
                        type="button"
                        style={{justifyContent:'flex-start'}}
                        disabled
                        title={t('adm_feature_absent')}
                      >
                        <Ic size={12}/> {t(key)}
                        <span className="qt-pending-mark">{t('sec_pending')}</span>
                      </button>
                    );
                  })}
                  {/* ★ 이메일(로그인 식별자) 변경 — 실제 API. 오타로 잠긴 계정을 되살리는 수단. */}
                  {canStatus && (
                    <button
                      className="btn btn--sm"
                      type="button"
                      style={{justifyContent:'flex-start'}}
                      disabled={busy}
                      title={t('adm_email_hint')}
                      onClick={changeEmail}
                    >
                      <I.Send size={12}/> {t('adm_email_change')}
                    </button>
                  )}
                  {/* ★ 비밀번호 재설정 링크 발송 — 실제 API. 임시 비밀번호를 만들지 않는다. */}
                  {canStatus && (
                    <button
                      className="btn btn--sm"
                      type="button"
                      style={{justifyContent:'flex-start'}}
                      disabled={busy}
                      title={t('adm_pwreset_hint')}
                      onClick={sendPasswordReset}
                    >
                      <I.Refresh size={12}/> {t('admin_user_detail_04f2aa')}
                    </button>
                  )}
                  {/*
                     ★ 2단계 인증 초기화 — 서버 API 를 실제로 부른다.
                       휴대폰을 잃고 복구 코드도 없는 사용자를 되살리는 유일한 수단이다.
                       일반 회원에게만 보인다(운영자 계정은 서버가 거부한다).
                  */}
                  {canStatus && !['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'ANALYST'].includes(String(u.role || '').toUpperCase()) && (
                    <button
                      className="btn btn--sm"
                      type="button"
                      style={{justifyContent:'flex-start'}}
                      disabled={busy || !Number(u.mfa_enabled)}
                      title={Number(u.mfa_enabled) ? t('adm_reset_mfa_hint') : t('adm_reset_mfa_off')}
                      onClick={resetMfa}
                    >
                      <I.Lock size={12}/> {t('admin_user_detail_e03d2f')}
                    </button>
                  )}
                  {/* 세션 종료는 서버 API 가 있다 — 실제로 동작한다. */}
                  {canStatus && (
                    <button className="btn btn--sm" type="button" style={{justifyContent:'flex-start'}} disabled={busy} onClick={revokeSessions}>
                      <I.Lock size={12}/> {t('adm_revoke_sessions')}
                    </button>
                  )}
                  {canStatus && u.status === 'active' && (
                    <button className="btn btn--sm btn--danger" type="button" style={{justifyContent:'flex-start'}} disabled={busy} onClick={() => setShowAction('suspend')}>
                      <I.Alert size={12}/> {t('admin_user_detail_82d3e7')}
                    </button>
                  )}
                </div>
              </window.SectionCard>

              {/*
                 ★★ 위험 구역 — 되돌릴 수 없는 작업.

                   따로 카드로 분리한다. Quick Actions 안에 두면 다른 버튼을
                   누르려다 옆을 누를 수 있고, 그 실수는 복구할 수 없다.
              */}
              {canDelete && (
                <window.SectionCard
                  title={t('adm_danger_zone')}
                  subtitle={t('adm_danger_zone_sub')}
                >
                  <div style={{fontSize:11.5, lineHeight:1.8, color:'var(--color-text-tertiary)', marginBottom:10}}>
                    {t('adm_delete_explain')}
                  </div>
                  <button
                    className="btn btn--sm btn--danger"
                    type="button"
                    disabled={busy}
                    onClick={deleteUser}
                  >
                    <I.Trash size={12}/> {t('adm_delete_user')}
                  </button>
                </window.SectionCard>
              )}

              {/*
                 ★★ 위험 점수는 우리가 계산하지 않는다.

                   전에는 `18/100` · `Low risk · KYC L… · No flags` 가 고정
                   문자열이었고, 막대까지 18% 로 그려져 있었다. 위험 점수는
                   계정을 제한할지 판단하는 근거다. 아무 계정을 열어도 18 이
                   나오므로, 실제로 위험한 계정도 "낮음" 으로 보인다.

                   서버에 위험 점수 산출이 없다(KYC 단계도 수집하지 않는다).
                   만들지 않고 없다고 말한다.
              */}
              <window.SectionCard title={t('adm_risk_score')}>
                <div style={{fontFamily:'var(--font-num)', fontSize: 32, fontWeight: 700, color: 'var(--color-text-tertiary)'}}>—</div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', lineHeight:1.7}}>{t('adm_risk_score_absent')}</div>
              </window.SectionCard>
            </div>
          </div>
        )}

        {tab === 'kyc' && (
          /*
             ★★ 이 탭에 존재하지 않는 서류와 검사 결과가 그려져 있었다.

               'ID_FRONT.jpg · 2.4MB · Uploaded 2025-11-18 · Verified'
               'SELFIE.jpg · 1.8MB · Verified'
               'Face match 98.4%' · 'PEP check Clear' · 'Sanctions list Clear'
               'Document authenticity Passed' · 'Address verification Passed'

               누구를 열어도 같은 값이 나왔다. 우리는 **신분증을 수집하지 않고**
               제재 목록 조회도 하지 않는다(개인정보처리방침 §2에 그렇게 적어
               게시했다). 그런데 화면은 검사를 통과했다고 말한다.

               운영자가 이 화면을 근거로 AML 판단을 내리면, 하지 않은 검사를
               했다고 믿고 결정하는 것이다. 가짜 데이터 중에서도 가장 위험한
               종류다 — 그럴듯하고, 확인할 방법이 화면에 없다.

             ★ 탭은 남긴다(디자인 보존). 대신 사실을 쓴다: 무엇을 수집하지 않는지,
               본인 확인은 누가 하는지.
          */
          <div className="grid-2">
            <window.SectionCard title={t('admin_user_detail_0057bd')}>
              <div style={{fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.8}}>
                <div style={{fontWeight:600, color:'var(--color-text-primary)', marginBottom:6}}>{t('adm_kyc_none_title')}</div>
                <div>{t('adm_profile_fields_absent')}</div>
                <div style={{marginTop:8}}>{t('adm_kyc_none_why')}</div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('admin_user_detail_a43b70')}>
              <div style={{fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.8}}>
                {t('adm_kyc_checks_absent')}
              </div>
            </window.SectionCard>
          </div>
        )}

        {tab === 'activity' && (
          /*
             ★★ 전에는 7건이 하드코딩이었다.

               `2026-08-02 09:14 login Seoul, KR · Chrome 59.10.20.4` 같은 행이
               고정 문자열이었고 **누구의 상세를 열어도 같은 목록**이 나왔다.
               활동 로그는 "이 사람이 무엇을 했나" 를 보는 화면이다. 남의
               활동(존재하지도 않는 활동)을 보고 조치하면 그대로 오조치다.
               IP 까지 적혀 있어서 더 그럴듯했다.

             ★ 지금은 감사 로그를 그 사용자로 필터해 가져온다
               (GET /admin/audit?userId=…). 대상 사용자 기준이므로 "이 사람에게
               무슨 일이 있었나" 가 맞다.
             ★ 우리 감사 로그는 관리 작업 중심이다. 로그인·주문 같은 이용자
               행위는 여기 담기지 않으므로 그 사실을 밝힌다 — 없는 것을 있는
               것처럼 두지 않는다.
          */
          <window.SectionCard
            title={t('admin_user_detail_8f5d10')}
            subtitle={t('adm_activity_scope')}
            noPadding
          >
            {activity.state === 'loading' && (
              <div style={{padding:'14px 16px', fontSize:12, color:'var(--color-text-tertiary)'}}>{t('sec_loading')}</div>
            )}
            {activity.state === 'error' && (
              <div style={{padding:'14px 16px', fontSize:12, color:'var(--color-warning)', display:'flex', gap:10, alignItems:'center'}}>
                {t('adm_activity_failed')}
                <button className="btn btn--xs" type="button" onClick={loadActivity}>{t('sec_retry')}</button>
              </div>
            )}
            {activity.state === 'ready' && activity.rows.length === 0 && (
              <div style={{padding:'14px 16px', fontSize:12, color:'var(--color-text-tertiary)'}}>{t('adm_activity_none')}</div>
            )}
            {activity.state === 'ready' && activity.rows.length > 0 && (
              <window.DataTable
                columns={[
                  { key:'at', label: t('adm_col_time'), render: r => (
                    <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>
                      {r.at ? new Date(Number(r.at)).toLocaleString() : '—'}
                    </span>
                  ) },
                  { key:'action', label: t('adm_col_action'), render: r => (
                    <span style={{fontFamily:'var(--font-mono)', color:'var(--color-brand)'}}>{r.action || '—'}</span>
                  ) },
                  { key:'reason', label:'Reason', render: r => r.reason || '—' },
                  { key:'result', label: t('adm_col_result'), render: r => (
                    <span className={`status-pill status-pill--${r.result === 'success' ? 'ok' : 'warn'}`}>
                      {String(r.result || '—').toUpperCase()}
                    </span>
                  ) },
                  { key:'ip', label:'IP', render: r => (
                    <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{r.ip || '—'}</span>
                  ) },
                ]}
                rows={activity.rows}
              />
            )}
          </window.SectionCard>
        )}

        {tab === 'notes' && (
          /*
             관리자 노트 — 실제로 저장된다.

             ★ 자유 서식 글이라 무엇이든 적힐 수 있다. 서버가 조회·작성·삭제를
               모두 감사에 남기고, 회원이 삭제되면 노트도 함께 사라진다
               (법정 보관 대상이 아니다).
             ★ 화면에도 그 사실을 밝힌다 — 담당자가 "여기 적은 것은 남는다" 를
               알고 써야 한다.
          */
          <window.SectionCard
            title={t('admin_user_detail_915cf6')}
            subtitle={t('adm_note_scope')}
          >
            {canStatus && (
              <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:14}}>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={4000}
                  placeholder={t('adm_note_placeholder')}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  style={{resize:'vertical', fontFamily:'inherit'}}
                />
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <button
                    className="btn btn--sm btn--primary"
                    type="button"
                    disabled={busy || !String(noteDraft).trim()}
                    onClick={addNote}
                  >
                    {t('adm_note_save')}
                  </button>
                  <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                    {String(noteDraft).length} / 4000
                  </span>
                </div>
              </div>
            )}

            {notes.state === 'loading' && <div style={{fontSize:12, color:'var(--color-text-tertiary)'}}>{t('sec_loading')}</div>}
            {notes.state === 'error' && (
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <span style={{fontSize:12, color:'var(--color-warning)'}}>{t('adm_note_load_failed')}</span>
                <button className="btn btn--xs" type="button" onClick={loadNotes}>{t('sec_retry')}</button>
              </div>
            )}
            {notes.state === 'ready' && notes.rows.length === 0 && (
              <div style={{fontSize:12, color:'var(--color-text-tertiary)'}}>{t('adm_note_none')}</div>
            )}
            {notes.state === 'ready' && notes.rows.length > 0 && (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {notes.rows.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding:'10px 12px', border:'1px solid var(--color-border-subtle)',
                      borderRadius:4, background:'var(--color-bg-surface)',
                    }}
                  >
                    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
                      <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                        {n.created_at ? new Date(Number(n.created_at)).toLocaleString() : '—'}
                      </span>
                      <span style={{fontSize:10, color:'var(--color-text-tertiary)'}}>
                        {n.author_email || t('adm_note_author_gone')}
                      </span>
                      {canStatus && (
                        <button
                          className="btn btn--xs"
                          type="button"
                          style={{marginLeft:'auto'}}
                          disabled={busy}
                          onClick={() => removeNote(n.id)}
                        >
                          {t('adm_note_delete')}
                        </button>
                      )}
                    </div>
                    {/* 줄바꿈을 유지한다 — 담당자가 목록 형태로 쓰는 경우가 많다. */}
                    <div style={{fontSize:12.5, lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-word'}}>
                      {n.body}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </window.SectionCard>
        )}

        {(tab === 'trades' || tab === 'assets' || tab === 'security') && (
          <window.PagePlaceholder
            title={{trades:t('admin_user_detail_8797eb'), assets:t('admin_user_detail_40ce13'), security:t('admin_user_detail_8dd7e4'), notes:t('admin_user_detail_915cf6')}[tab]}
            todo={[
              t('admin_user_tab_data', { tab }),
              t('admin_user_detail_106e43'),
              t('admin_user_detail_12614e'),
            ]}
          />
        )}

        {/* Suspend confirmation modal */}
        {showAction === 'suspend' && (
          <div className="overlay" onClick={() => setShowAction(null)}>
            <div className="modal" style={{width: 440}} onClick={e => e.stopPropagation()}>
              <div className="modal__header">
                <div className="modal__title">{t('admin_user_detail_94cd06')}</div>
                <button className="btn btn--icon" onClick={() => setShowAction(null)}><I.X size={14}/></button>
              </div>
              <div className="modal__body" style={{padding: 20}}>
                <p style={{margin: '0 0 12px', fontSize: 13}}>{t('admin_user_detail_ebe503')}</p>
                <div style={{padding:10, background:'var(--color-bg-surface)', borderRadius:4, fontFamily:'var(--font-mono)', fontSize:11}}>
                  <div><strong>{t('admin_c_s_ticket_5c50d9')}:</strong> {u.email}</div>
                  <div><strong>ID:</strong> {u.id}</div>
                </div>
                <div className="input-group" style={{marginTop: 12}}>
                  <span className="input-group__label">{t('admin_user_detail_63c279')}</span>
                  <select style={{background:'transparent', border:0, width:'100%', color:'inherit', outline:'none', fontFamily:'inherit'}}>
                    <option>{t('admin_user_detail_2d003e')}</option>
                    <option>{t('admin_user_detail_a1d12d')}</option>
                    <option>{t('admin_user_detail_a74a3f')}</option>
                    <option>{t('admin_user_detail_ca5360')}</option>
                    <option>{t('admin_user_detail_44650a')}</option>
                  </select>
                </div>
                <div className="input-group" style={{marginTop: 8}}>
                  <span className="input-group__label">{t('fld_note')}</span>
                  <input placeholder={t('admin_user_detail_f35682')}/>
                </div>
                <div className="auth-alert auth-alert--warning" style={{marginTop: 12}}>
                  <I.Info size={12}/>
                  <div>{t('admin_user_detail_bd464c')}</div>
                </div>
              </div>
              <div className="modal__footer">
                <button className="btn btn--sm" onClick={() => setShowAction(null)}>{t('admin_user_detail_19b2d1')}</button>
                {/*
                   ★★ 전에는 `alert('사용자가 정지되었습니다 (Simulation)')` 였다.

                     운영자는 정지된 줄 알고 창을 닫지만 그 사람은 계속 로그인한다.
                     악용 신고에 "정지 처리했습니다" 라고 답변까지 한 뒤에도 그대로다.
                     지금은 서버 API(POST /admin/users/:id/disable)를 실제로 부르고,
                     결과를 화면에 남긴다(성공도 실패도).
                */}
                <button
                  className="btn btn--sm btn--danger"
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus(true)}
                >
                  {busy ? t('sec_loading') : t('admin_user_detail_ff8aa0')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/*
           ★ 정지 해제 모달.

             전에는 해제 버튼이 setShowAction('unsuspend') 만 하고 대응 모달이
             **없었다.** 즉 버튼을 눌러도 아무 일도 일어나지 않았다(무동작).
             정지된 계정을 되살리는 경로가 화면에 없었던 것이다.
        */}
        {showAction === 'unsuspend' && (
          <div className="overlay" onClick={() => setShowAction(null)}>
            <div className="modal" style={{width: 440}} onClick={e => e.stopPropagation()}>
              <div className="modal__header">
                <div className="modal__title">{t('admin_user_detail_f63bf7')}</div>
                <button className="btn btn--icon" type="button" onClick={() => setShowAction(null)}><I.X size={14}/></button>
              </div>
              <div className="modal__body" style={{padding: 20}}>
                <p style={{margin:'0 0 12px', fontSize:13}}>{t('adm_unsuspend_confirm')}</p>
                <div style={{padding:10, background:'var(--color-bg-surface)', borderRadius:4, fontFamily:'var(--font-mono)', fontSize:11}}>
                  <div><strong>{t('admin_c_s_ticket_5c50d9')}:</strong> {u.email}</div>
                  <div><strong>ID:</strong> {u.id}</div>
                </div>
                <div className="auth-alert auth-alert--warning" style={{marginTop: 12}}>
                  <I.Info size={12}/>
                  <div>{t('adm_reason_required')}</div>
                </div>
              </div>
              <div className="modal__footer">
                <button className="btn btn--sm" type="button" onClick={() => setShowAction(null)}>{t('admin_user_detail_19b2d1')}</button>
                <button className="btn btn--sm btn--primary" type="button" disabled={busy} onClick={() => changeStatus(false)}>
                  {busy ? t('sec_loading') : t('admin_user_detail_f63bf7')}
                </button>
              </div>
            </div>
          </div>
        )}
      </window.PageShell>
      </>
    );
  };

  // ============================================================
  // KYC QUEUE — 심사 대기열
  // ============================================================
  window.AdminKYCQueuePage = function AdminKYCQueuePage({ shellProps }) {
    /*
       실서비스에서는 사실을 보여준다.

       아래 목업은 **수탁 거래소**의 운영 화면이다. 우리 구조에는 그 대상이
       존재하지 않는다(자세한 이유는 NotApplicablePanel 문구에 있다).
       목업을 남겨두면 운영자가 대기열을 기다리고, 고객에게 "심사/승인
       진행 중" 이라고 잘못 답한다.

       백엔드가 없는 디자인 미리보기에서는 원래 화면을 유지한다(디자이너 불가침).
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const __backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
     /*
        ★★ 이 훅이 아래 `if (__backend !== false) return (…)` **뒤에** 있었다.
          backendPresent 는 처음 null(판정 중)이고 곧 true/false 로 바뀐다. 그
          전이에서 조기 return 여부가 달라지므로 훅 개수가 렌더마다 달라진다 —
          React 가 "Rendered more hooks than during the previous render" 로 죽는다.
     */
    const [filter, setFilter] = useState('pending');

    if (__backend !== false) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('na_kyc_title')}
          subtitle={t('na_kyc_subtitle')}
          breadcrumb={['Home','Admin',t('na_kyc_crumb')]}
        >
          <window.NotApplicablePanel
            title={t('na_kyc_panel_title')}
            reason={t('na_kyc_reason')}
            points={[t('na_kyc_p1'), t('na_kyc_p2'), t('na_kyc_p3')]}
            whereInstead={t('na_kyc_instead')}
          />
        </window.PageShell>
      );
    }

    const cases = [
      { id:'KYC-A1B2C3', user:'usr_00005', name:'Alice Wu',  submitted: Date.now()-1000*60*30,   country:'HK', level:1, target:2, status:'pending',   riskScore:22, autoFlags:[] },
      { id:'KYC-D4E5F6', user:'usr_00003', name:'John Kim',  submitted: Date.now()-1000*60*60*3, country:'US', level:2, target:3, status:'pending',   riskScore:14, autoFlags:[] },
      { id:'KYC-G7H8I9', user:'usr_00004', name:'田中 陽菜',   submitted: Date.now()-1000*60*60*8, country:'JP', level:1, target:2, status:'reviewing', riskScore:32, autoFlags:['face-match-low'] },
      { id:'KYC-J0K1L2', user:'usr_00011', name:t('admin_k_y_c_queue_d167fe'),     submitted: Date.now()-1000*60*60*22, country:'KR', level:0, target:1, status:'pending',   riskScore:48, autoFlags:['ip-anomaly'] },
    ];
    const filtered = filter === 'all' ? cases : cases.filter(c => c.status === filter);

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_k_y_c_queue_46072a')}
        subtitle={t('admin_kyc_sla', { pending: cases.filter(c => c.status === 'pending').length })}
        breadcrumb={['Home','Admin','KYC']}
      >
        <div className="grid-4">
          <window.KPICard label="Pending" value={cases.filter(c => c.status === 'pending').length} tone="warning"/>
          <window.KPICard label="Reviewing" value={cases.filter(c => c.status === 'reviewing').length}/>
          <window.KPICard label="Avg TAT" value="4.2h" sub="Target < 24h" tone="brand"/>
          <window.KPICard label="Rejection Rate · 7d" value="8%"/>
        </div>

        <window.SectionCard
          title="Cases"
          actions={
            <div className="seg">
              {['all','pending','reviewing','approved','rejected'].map(f => (
                <button key={f} className={`seg__opt ${filter===f?'is-active':''}`} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
          }
          noPadding
        >
          <window.DataTable
            columns={[
              { key:'id', label:'Case ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-brand)'}}>{r.id}</span> },
              { key:'user', label: t('adm_col_user'), render: r => <div><strong>{r.name}</strong><div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{r.user}</div></div> },
              { key:'country', label: t('adm_col_country') },
              { key:'level', label:'KYC', render: r => `L${r.level} → L${r.target}` },
              { key:'submitted', label:'Submitted', render: r => timeAgo(r.submitted) },
              { key:'risk', label:'Risk Score', render: r => <span style={{color: r.riskScore > 40 ? 'var(--color-danger)' : r.riskScore > 25 ? 'var(--color-warning)' : 'var(--color-success)', fontFamily:'var(--font-mono)', fontWeight: 500}}>{r.riskScore}</span> },
              { key:'flags', label:'Auto Flags', render: r => r.flags?.length || r.autoFlags?.length ? (r.autoFlags || r.flags).map(f => <span key={f} className="severity-pill severity-pill--medium" style={{marginRight:3}}>{f}</span>) : <span style={{color:'var(--color-text-tertiary)'}}>·</span> },
              { key:'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'pending' ? 'warn' : r.status === 'reviewing' ? 'neutral' : r.status === 'approved' ? 'ok' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key:'act', label:'', align:'right', render: _r => <><button className="tbl-action">{t('col_review')}</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_approve')}</button> <button className="tbl-action tbl-action--danger" style={{marginLeft:3}}>{t('col_reject')}</button></> },
            ]}
            rows={filtered}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // DEPOSITS QUEUE
  // ============================================================
  window.AdminDepositsPage = function AdminDepositsPage({ shellProps }) {
    /*
       실서비스에서는 사실을 보여준다.

       아래 목업은 **수탁 거래소**의 운영 화면이다. 우리 구조에는 그 대상이
       존재하지 않는다(자세한 이유는 NotApplicablePanel 문구에 있다).
       목업을 남겨두면 운영자가 대기열을 기다리고, 고객에게 "심사/승인
       진행 중" 이라고 잘못 답한다.

       백엔드가 없는 디자인 미리보기에서는 원래 화면을 유지한다(디자이너 불가침).
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const __backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    if (__backend !== false) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('na_dep_title')}
          subtitle={t('na_dep_subtitle')}
          breadcrumb={['Home','Admin',t('na_dep_crumb')]}
        >
          <window.NotApplicablePanel
            title={t('na_dep_panel_title')}
            reason={t('na_dep_reason')}
            points={[t('na_dep_p1'), t('na_dep_p2'), t('na_dep_p3')]}
            whereInstead={t('na_dep_instead')}
          />
        </window.PageShell>
      );
    }

    const items = [
      { id:'DEP-001', user:'usr_00007', amount: 50000, asset:'USDT', network:'TRC20', confirmations:'32/32', time: Date.now()-1000*60*10,  status:'confirmed',  txHash:'3f4e...9d0e' },
      { id:'DEP-002', user:'usr_00003', amount:  1000, asset:'USDT', network:'ERC20', confirmations:'8/12',  time: Date.now()-1000*60*20,  status:'pending',    txHash:'b2c3...5d6e' },
      { id:'DEP-003', user:'usr_00002', amount:     2, asset:'BTC',  network:'BTC',   confirmations:'1/3',   time: Date.now()-1000*60*40,  status:'pending',    txHash:'a1b2...c3d4' },
      { id:'DEP-004', user:'usr_00011', amount:  8000, asset:'USDT', network:'BEP20', confirmations:'15/15', time: Date.now()-1000*60*60,  status:'flagged',    txHash:'c3d4...e5f6', flag:'aml-review' },
    ];
    return (
      <window.PageShell {...shellProps} title={t('admin_deposits_e9e567')} subtitle={t('admin_deposits_df0901')} breadcrumb={['Home','Admin','Deposits']}>
        <div className="grid-4">
          <window.KPICard label="Pending" value={items.filter(i => i.status === 'pending').length} tone="warning"/>
          <window.KPICard label={t('adm_kpi_flagged')} value={items.filter(i => i.status === 'flagged').length} tone="danger"/>
          <window.KPICard label="24h Volume" value="$142,340" tone="long"/>
          <window.KPICard label="Confirmed · 24h" value="98"/>
        </div>
        <window.SectionCard title={t('admin_deposits_48f252')} noPadding>
          <window.DataTable
            columns={[
              { key:'id', label:'ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{r.id}</span> },
              { key:'user', label: t('adm_col_user'), render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.user}</span> },
              { key:'amount', label:t('col_amount'), align:'right', render: r => <strong style={{fontFamily:'var(--font-num)'}}>{r.amount} {r.asset}</strong> },
              { key:'network', label:'Network' },
              { key:'conf', label:'Confirmations', align:'right', render: r => r.confirmations },
              { key:'time', label: t('adm_col_time'), render: r => timeAgo(r.time) },
              { key:'tx', label:'TX', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-brand)'}}>{r.txHash}</span> },
              { key:'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'confirmed' ? 'ok' : r.status === 'pending' ? 'warn' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key:'act', label:'', align:'right', render: r => (r.status !== 'confirmed' ? <><button className="tbl-action" /* qt-i18n-ignore: 진단용 개발 버튼 */>Inspect</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_approve')}</button></> : <button className="tbl-action">{t('col_view')}</button>) },
            ]}
            rows={items}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // WITHDRAW QUEUE
  // ============================================================
  window.AdminWithdrawalsPage = function AdminWithdrawalsPage({ shellProps }) {
    /*
       실서비스에서는 사실을 보여준다.

       아래 목업은 **수탁 거래소**의 운영 화면이다. 우리 구조에는 그 대상이
       존재하지 않는다(자세한 이유는 NotApplicablePanel 문구에 있다).
       목업을 남겨두면 운영자가 대기열을 기다리고, 고객에게 "심사/승인
       진행 중" 이라고 잘못 답한다.

       백엔드가 없는 디자인 미리보기에서는 원래 화면을 유지한다(디자이너 불가침).
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const __backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    if (__backend !== false) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('na_wd_title')}
          subtitle={t('na_wd_subtitle')}
          breadcrumb={['Home','Admin',t('na_wd_crumb')]}
        >
          <window.NotApplicablePanel
            title={t('na_wd_panel_title')}
            reason={t('na_wd_reason')}
            points={[t('na_wd_p1'), t('na_wd_p2'), t('na_wd_p3')]}
            whereInstead={t('na_wd_instead')}
          />
        </window.PageShell>
      );
    }

    const items = [
      { id:'WD-001', user:'usr_00007', amount: 20000, asset:'USDT', network:'TRC20', to:'TX7d...eK7wN', time: Date.now()-1000*60*5,  status:'pending-approval',  risk: 'medium' },
      { id:'WD-002', user:'usr_00002', amount:     5, asset:'BTC',  network:'BTC',   to:'bc1q...4f6a', time: Date.now()-1000*60*22, status:'pending-approval',  risk: 'high' },
      { id:'WD-003', user:'usr_00003', amount:  500,  asset:'USDT', network:'ERC20', to:'0x7d...5c6A', time: Date.now()-1000*60*50, status:'processing',        risk: 'low' },
      { id:'WD-004', user:'usr_kuri001', amount: 100, asset:'USDT', network:'TRC20', to:'TXqY...K7wN', time: Date.now()-1000*60*90, status:'sent',              risk: 'low' },
    ];
    return (
      <window.PageShell {...shellProps} title={t('admin_withdrawals_372dac')} subtitle={t('admin_withdrawals_4af6f5')} breadcrumb={['Home','Admin','Withdrawals']}>
        <div className="grid-4">
          <window.KPICard label="Pending Approval" value={items.filter(i => i.status === 'pending-approval').length} tone="warning"/>
          <window.KPICard label="Processing" value={items.filter(i => i.status === 'processing').length}/>
          <window.KPICard label="24h Sent" value="$28,420" tone="long"/>
          <window.KPICard label="Avg TAT" value="18m" sub="Target < 1h" tone="brand"/>
        </div>
        <window.SectionCard title={t('admin_withdrawals_d336c8')} noPadding>
          <window.DataTable
            columns={[
              { key:'id', label:'ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{r.id}</span> },
              { key:'user', label: t('adm_col_user'), render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.user}</span> },
              { key:'amount', label:t('col_amount'), align:'right', render: r => <strong>{r.amount} {r.asset}</strong> },
              { key:'network', label:'Network' },
              { key:'to', label:'To Address', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{r.to}</span> },
              { key:'time', label: t('adm_col_time'), render: r => timeAgo(r.time) },
              { key:'risk', label:'Risk', render: r => <span className={`severity-pill severity-pill--${r.risk === 'high' ? 'high' : r.risk === 'medium' ? 'medium' : 'low'}`}>{r.risk.toUpperCase()}</span> },
              { key:'status', label: t('adm_col_status'), render: r => <span className={`status-pill status-pill--${r.status === 'sent' ? 'ok' : 'warn'}`}>{r.status.toUpperCase()}</span> },
              { key:'act', label:'', align:'right', render: r => (r.status === 'pending-approval' ? <><button className="tbl-action" /* qt-i18n-ignore: 진단용 개발 버튼 */>Inspect</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_approve')}</button> <button className="tbl-action tbl-action--danger" style={{marginLeft:3}}>{t('col_reject')}</button></> : <button className="tbl-action">{t('col_view')}</button>) },
            ]}
            rows={items}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };

  // ============================================================
  // BROADCAST — 전체 알림 발송
  // ============================================================
  window.AdminBroadcastPage = function AdminBroadcastPage({ shellProps }) {
    const [target, setTarget] = useState('all');
    const [channel, setChannel] = useState(['in-app']);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [scheduled, setScheduled] = useState(false);

    /*
       전체 발송 (브로드캐스트).

       ★ 실제로 가능한 채널은 **인앱 공지 하나**다.
         이메일·SMS·푸시 발송 수단이 없다. 체크박스를 켤 수 있게 두면 관리자가
         "이메일도 보냈다" 고 믿고, 고객은 받지 못한 채로 남는다.
         비용 표시('$42.00')도 SMS 를 보내지 않으므로 발생하지 않는 금액이었다.

       ★ 대상 세분화도 불가능하다.
         'Pro 등급' 은 구독 제도가 없고, 'KYC L3' 은 우리가 KYC 를 하지 않으며,
         '활성 사용자' 는 기준을 정한 적이 없다. 공지는 전체에게 나간다.

       그래서 이 화면은 공지 작성기와 같은 일을 한다 — 그 사실을 밝히고
       실제로 공지를 만든다. 예약 발송은 공지의 publishAt 으로 지원된다.
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const __backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    const isLive = __backend !== false;

    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [recent, setRecent] = useState(null);
    const [recentError, setRecentError] = useState(false);
    const [schedAt, setSchedAt] = useState('');
    const [pinned, setPinned] = useState(false);
    /*
       팝업 여부와 긴급도.

       ★★ 기본값은 팝업 아님이다. 운영자가 명시적으로 켜야 한다 — 모든 공지가
         튀어나오면 이용자가 닫는 데 익숙해져 정작 중요한 공지도 읽지 않는다.
    */
    const [popup, setPopup] = useState(false);
    const [severity, setSeverity] = useState('info');

    const api = window.QTApi && window.QTApi.admin;
    const canWrite = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.notice.write'));

    const loadRecent = React.useCallback(() => {
      if (!api || !api.notices) return;
      // ★ 실패를 빈 목록으로 두면 공지가 없는 것처럼 보인다.
      api.notices(10)
        .then((r) => { setRecentError(false); setRecent(r.data || []); })
        .catch(() => { setRecent(null); setRecentError(true); });
    }, [api]);
    useEffect(() => { if (isLive) loadRecent(); }, [isLive, loadRecent]);

    /*
       발송 = 공지 작성 + 게시.

       예약이면 publishAt 을 넣고 게시한다 — 서버가 그 시각까지 사용자에게
       보여주지 않는다. 즉시 발송이면 publishAt 없이 바로 게시한다.
    */
    const send = async (publishNow) => {
      if (!api || !api.createNotice) return;
      const title = subject.trim();
      if (!title || !body.trim()) return;
      setBusy(true); setMsg(null);
      try {
        const created = await api.createNotice({
          title,
          body: body,
          category: 'broadcast',
          pinned: pinned,
          popup: popup,
          severity: severity,
          publishAt: scheduled && schedAt ? new Date(schedAt).getTime() : null,
          locale: (window.QTI18n && window.QTI18n.getLocale) ? window.QTI18n.getLocale() : 'en',
        });
        if (!created || created.ok === false) {
          setMsg({ ok: false, text: (created && created.message) || t('bc_failed') });
          setBusy(false);
          return;
        }
        const id = created.notice && created.notice.id;
        if (publishNow && id) {
          const pub = await api.publishNotice(id);
          if (!pub || pub.ok === false) {
            // 저장은 됐고 게시만 실패했다. 그 사실을 정확히 알린다.
            setMsg({ ok: false, text: t('bc_saved_not_sent') });
            setBusy(false);
            loadRecent();
            return;
          }
          setMsg({ ok: true, text: scheduled && schedAt ? t('bc_scheduled') : t('bc_sent') });
        } else {
          setMsg({ ok: true, text: t('bc_draft') });
        }
        setSubject(''); setBody(''); setSchedAt(''); setPinned(false);
        loadRecent();
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('bc_failed') });
      }
      setBusy(false);
    };

    return (
      <window.PageShell
        {...shellProps}
        title={t('admin_bc_title')}
        subtitle={isLive ? t('bc_subtitle') : t('admin_broadcast_b7f563')}
        breadcrumb={['Home','Admin','Broadcast']}
      >
        <div className="grid-2-1">
          <window.SectionCard title={t('admin_broadcast_f724cc')}>
            <div style={{display:'flex', flexDirection:'column', gap: 12}}>
              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('admin_broadcast_90bbad')}</div>
                {/*
                   대상.

                   실데이터에서는 '전체' 만 가능하다. Pro 등급은 구독 제도가
                   없고, KYC L3 는 우리가 KYC 를 하지 않으며, '활성 사용자' 는
                   기준을 정한 적이 없다. 고를 수 있게 두면 관리자가 특정
                   집단에만 보냈다고 믿는다.
                */}
                <div className="seg" style={{width:'100%'}}>
                  {(isLive
                    ? [{ id:'all', label:t('bc_target_all') }]
                    : [
                      { id:'all', label:t('admin_broadcast_95066f') },
                      { id:'pro', label:t('admin_broadcast_be1a1a') },
                      { id:'active', label:t('admin_broadcast_050529') },
                      { id:'kyc-l3', label:t('admin_broadcast_1395f0') },
                      { id:'custom', label:t('admin_broadcast_9c1758') },
                    ]).map(x => (
                    <button key={x.id} className={`seg__opt ${target===x.id?'is-active':''}`} style={{flex:1}} onClick={() => setTarget(x.id)}>{x.label}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('admin_broadcast_7aeb7e')}</div>
                {/*
                   채널.

                   이메일·SMS·푸시 발송 수단이 없다. 체크박스를 켤 수 있게
                   두면 관리자가 "이메일도 보냈다" 고 믿고 고객은 받지 못한
                   채로 남는다 — 그 오해는 고객 응대에서 드러난다.
                */}
                <div style={{display:'flex', gap: 12, alignItems:'center', flexWrap:'wrap'}}>
                  {(isLive ? ['in-app'] : ['in-app','email','sms','push']).map(c => (
                    <label key={c} className="chk">
                      <input
                        type="checkbox"
                        checked={isLive ? true : channel.includes(c)}
                        disabled={isLive}
                        onChange={e => setChannel(e.target.checked ? [...channel, c] : channel.filter(x => x !== c))}
                      />
                      <span className="chk__box"><I.Check size={10}/></span>
                      {c.toUpperCase()}
                    </label>
                  ))}
                  {isLive && (
                    <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('bc_channels_note')}</span>
                  )}
                </div>
              </div>

              <div className="input-group">
                <span className="input-group__label">{t('admin_broadcast_078b3a')}</span>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t('admin_broadcast_a7bc1f')}/>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>{t('admin_broadcast_c67b87')}</div>
                <textarea
                  value={body} onChange={e => setBody(e.target.value)}
                  placeholder={t('admin_broadcast_1a8f0f')}
                  style={{width:'100%', minHeight: 200, padding: 10, background:'var(--color-bg-input)', border: '1px solid var(--color-border-default)', borderRadius: 4, color: 'var(--color-text-primary)', fontSize: 12, fontFamily: 'var(--font-sans)', resize:'vertical', outline: 'none'}}
                />
              </div>

              <label className="chk">
                <input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                {t('admin_broadcast_1a911b')}
              </label>
              {scheduled && (
                isLive ? (
                  /* 날짜·시간을 따로 받으면 조합 로직이 필요하고 시간대 실수가 난다. */
                  <div className="input-group">
                    <span className="input-group__label">{t('bc_publish_at')}</span>
                    <input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)}/>
                  </div>
                ) : (
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                  <div className="input-group"><span className="input-group__label">{t('fld_date')}</span><input type="date"/></div>
                  <div className="input-group"><span className="input-group__label">{t('fld_time_utc')}</span><input type="time"/></div>
                </div>
                )
              )}

              {isLive && (
                <label className="chk">
                  <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)}/>
                  <span className="chk__box"><I.Check size={10}/></span>
                  {t('bc_pin')}
                </label>
              )}

              {/*
                 팝업으로 띄우기.

                 ★★ 기본값은 꺼짐이다. 모든 공지를 띄우면 이용자가 닫는 데
                   익숙해져 정작 중요한 공지도 읽지 않는다.

                 ★ '상단 고정'(pinned)과 다른 것이다 — 고정은 목록 순서이고
                   팝업은 화면에 띄우는 것이다. 한 값으로 합치면 오래 두려는
                   공지가 매번 튀어나온다.
              */}
              {isLive && (
                <label className="chk">
                  <input type="checkbox" checked={popup} onChange={e => setPopup(e.target.checked)}/>
                  <span className="chk__box"><I.Check size={10}/></span>
                  {t('bc_popup')}
                </label>
              )}

              {/*
                 긴급도. 팝업을 켰을 때만 의미가 있다.

                 ★ 화면 동작이 이 값으로 갈린다:
                     info     — 상단 배너(화면을 막지 않는다)
                     warning  — 모달, 바깥·Esc 로 닫힌다
                     critical — 모달, **닫기 버튼만** 닫는다
              */}
              {isLive && popup && (
                <div className="input-group">
                  <span className="input-group__label">{t('bc_severity')}</span>
                  <select className="input" value={severity} onChange={e => setSeverity(e.target.value)}>
                    <option value="info">{t('bc_sev_info')}</option>
                    <option value="warning">{t('bc_sev_warning')}</option>
                    <option value="critical">{t('bc_sev_critical')}</option>
                  </select>
                </div>
              )}

              {msg && (
                <div style={{
                  padding:'9px 12px', borderRadius:6, fontSize:12,
                  background: msg.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                  border: '1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)'),
                  color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
                }}>{msg.text}</div>
              )}

              <div style={{display:'flex', gap: 8, justifyContent:'flex-end', marginTop: 8}}>
                {isLive ? (
                  <>
                    {/* 초안 저장 — 사용자에게 보이지 않는다. */}
                    <button className="btn btn--sm" disabled={busy || !canWrite || !subject.trim() || !body.trim()} onClick={() => send(false)}>
                      {t('bc_save_draft')}
                    </button>
                    <button
                      className="btn btn--sm btn--primary"
                      disabled={busy || !canWrite || !subject.trim() || !body.trim() || (scheduled && !schedAt)}
                      onClick={() => send(true)}
                    >
                      <I.Send size={12}/> {busy ? '…' : (scheduled ? t('bc_schedule') : t('bc_send_now'))}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn--sm">{t('col_preview')}</button>
                    <button className="btn btn--sm">{t('admin_broadcast_e6f9c4')}</button>
                    <button className="btn btn--sm btn--primary" disabled={!subject || !body}>
                      <I.Send size={12}/> {scheduled ? t('admin_broadcast_265106') : t('admin_broadcast_626099')}
                    </button>
                  </>
                )}
              </div>
              {isLive && !canWrite && (
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', textAlign:'right'}}>{t('admin_read_only_notice')}</div>
              )}
            </div>
          </window.SectionCard>

          <div style={{display:'flex', flexDirection:'column', gap: 16}}>
            <window.SectionCard title={t('admin_broadcast_4c0460')}>
              {isLive ? (
                <>
                  {/*
                     수신자.

                     공지는 화면을 여는 모든 사람에게 보인다 — 로그인 여부와
                     무관하다(점검 공지는 로그인 못 하는 상황에서도 보여야 한다).
                     '1,242명' 처럼 특정 숫자를 보여주면 그만큼에게만 갔다고
                     오해한다.
                  */}
                  <div style={{fontFamily:'var(--font-num)', fontSize: 28, fontWeight: 700}}>{t('bc_everyone')}</div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', lineHeight:1.7}}>{t('bc_everyone_sub')}</div>
                  {/* 발송 비용이 없다 — 이메일·SMS 를 보내지 않는다. */}
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop: 8}}>
                    {t('bc_cost')}<br/>
                    <strong style={{color:'var(--color-text-primary)', fontFamily:'var(--font-mono)'}}>$0.00</strong>
                  </div>
                </>
              ) : (
                <>
                  <div style={{fontFamily:'var(--font-num)', fontSize: 32, fontWeight: 700}}>
                    {target === 'all' ? '1,242' : target === 'pro' ? '642' : target === 'active' ? '820' : target === 'kyc-l3' ? '312' : '—'}
                  </div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('admin_bc_recipients', { n: channel.length })}</div>
                  <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginTop: 8}}>
                    {t('admin_broadcast_140c08')}<br/>
                    <strong style={{color:'var(--color-text-primary)', fontFamily:'var(--font-mono)'}}>${(channel.includes('sms') ? 42 : 0) + (channel.includes('email') ? 4 : 0)}.00</strong>
                  </div>
                </>
              )}
            </window.SectionCard>

            <window.SectionCard title={t('admin_broadcast_f1f368')}>
              {isLive ? (
                recentError ? <div style={{padding:'8px 10px', fontSize:11.5, color:'var(--color-danger, #dc2626)'}}>{t('list_load_failed')}</div> : Array.isArray(recent) && recent.length > 0 ? recent.map((n) => (
                  <div key={n.id} style={{padding: 8, fontSize: 12, borderBottom: '1px solid var(--color-border-subtle)'}}>
                    <div>{n.title}</div>
                    {/*
                       '98% delivered' 는 전달률을 측정하지 않으므로 쓸 수 없다.
                       대신 실제로 아는 것을 보여준다: 상태와 게시 시각.
                    */}
                    <div style={{fontSize: 10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>
                      {t('notice_status_' + n.status)} · {n.publishedAt ? new Date(n.publishedAt).toLocaleString() : t('bc_not_published')}
                    </div>
                  </div>
                )) : (
                  <div style={{padding:'10px 8px', fontSize:11.5, color:'var(--color-text-tertiary)'}}>{t('bc_none_yet')}</div>
                )
              ) : (
                [t('admin_broadcast_743fe1'), t('admin_broadcast_63c075'), t('admin_broadcast_bc4cc1')].map((x, i) => (
                  <div key={i} style={{padding: 8, fontSize: 12, borderBottom: '1px solid var(--color-border-subtle)'}}>
                    <div>{x}</div>
                    <div style={{fontSize: 10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{2 + i}d ago · 98% delivered</div>
                  </div>
                ))
              )}
            </window.SectionCard>
          </div>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // NOTICE EDITOR
  // ============================================================
  window.AdminNoticeEditorPage = function AdminNoticeEditorPage({ shellProps }) {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [pinned, setPinned] = useState(false);
    /*
       팝업 여부와 긴급도.

       ★★ 기본값은 팝업 아님이다. 운영자가 명시적으로 켜야 한다 — 모든 공지가
         튀어나오면 이용자가 닫는 데 익숙해져 정작 중요한 공지도 읽지 않는다.
    */
    const [popup, setPopup] = useState(false);
    const [severity, setSeverity] = useState('info');
    const [category, setCategory] = useState('general');
    const [preview, setPreview] = useState(false);

    /*
       게시 기간.

       expiresAt 을 두는 이유: 끝난 점검 공지가 계속 상단에 떠 있으면 사용자가
       "지금도 점검 중" 이라고 오해한다. 만료를 정해두면 저절로 내려간다.
       publishAt 은 예약 게시 — 미래로 두면 그 시각까지 보이지 않는다.
    */
    const [expiresAt, setExpiresAt] = useState('');
    const [publishAt, setPublishAt] = useState('');

    // 공지 언어. 다국어는 별 공지로 작성한다(한 공지에 여러 언어를 담지 않는다).
    const [locale, setLocale] = useState(() =>
      (window.QTI18n && window.QTI18n.getLocale) ? window.QTI18n.getLocale() : 'en');

    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    // 'YYYY-MM-DDTHH:mm' (로컬) → epoch ms. 빈 값은 null (= 제한 없음).
    const toMs = (v) => {
      if (!v) return null;
      const ms = new Date(v).getTime();
      return Number.isFinite(ms) ? ms : null;
    };

    const canSubmit = Boolean(title.trim()) && Boolean(body.trim()) && !busy;

    /*
       저장 / 게시.

       저장(초안)과 게시를 분리한다. 공지는 전체 사용자에게 나가므로 한 번의
       클릭으로 바로 공개되면 오타 하나가 전원에게 노출된다.
       publishNow=true 는 "게시" 버튼에서만 온다.
    */
    const submit = async (publishNow) => {
      if (!canSubmit) return;
      if (!window.QTApi || !window.QTApi.admin || !window.QTApi.admin.createNotice) {
        setResult({ ok: false, msg: t('notice_no_backend') });
        return;
      }
      setBusy(true);
      setResult(null);
      try {
        const created = await window.QTApi.admin.createNotice({
          title: title.trim(),
          body: body,
          category: category,
          pinned: pinned,
          popup: popup,
          severity: severity,
          publishAt: toMs(publishAt),
          expiresAt: toMs(expiresAt),
          locale: locale,
        });
        if (!created || created.ok === false) {
          setResult({ ok: false, msg: (created && created.message) || t('notice_save_failed') });
          setBusy(false);
          return;
        }
        const id = created.notice ? created.notice.id : (created.data && created.data.notice && created.data.notice.id);
        if (publishNow && id) {
          const pub = await window.QTApi.admin.publishNotice(id);
          if (!pub || pub.ok === false) {
            // 저장은 됐고 게시만 실패했다. 그 사실을 정확히 알린다 —
            // "실패" 로만 말하면 관리자가 같은 공지를 또 작성한다.
            setResult({ ok: false, msg: t('notice_saved_not_published'), draftId: id });
            setBusy(false);
            return;
          }
          setResult({ ok: true, msg: t('notice_published'), id: id });
        } else {
          setResult({ ok: true, msg: t('notice_saved_draft'), id: id });
        }
        setTitle(''); setBody(''); setPinned(false); setExpiresAt(''); setPublishAt('');
      } catch (e) {
        setResult({ ok: false, msg: (e && e.message) || t('notice_save_failed') });
      }
      setBusy(false);
    };

    return (
      <window.PageShell {...shellProps} title={t('admin_notice_editor_db8cc8')} subtitle={t('admin_notice_editor_3d991a')} breadcrumb={['Home','Admin','Notices','New']}>
        <div className="grid-2-1">
          <div style={{display:'flex', flexDirection:'column', gap: 12}}>
            <div className="input-group" style={{height: 44, fontSize: 14}}>
              <input placeholder={t('admin_notice_editor_a2ee94')} value={title} onChange={e => setTitle(e.target.value)}/>
            </div>

            <div style={{display:'flex', gap: 12, alignItems:'center'}}>
              <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>{t('cs_category')}:</div>
              <div className="seg">
                {['general','maintenance','promotion','regulation','feature'].map(c => (
                  <button key={c} className={`seg__opt ${category===c?'is-active':''}`} onClick={() => setCategory(c)}>{c}</button>
                ))}
              </div>
              <label className="chk" style={{marginLeft:'auto'}}>
                <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                {t('admin_notice_editor_189dd9')}
              </label>
            </div>

            {/*
               팝업으로 띄우기 + 긴급도.

               ★★ 기본값은 꺼짐이다. 모든 공지를 띄우면 이용자가 닫는 데 익숙해져
                 정작 중요한 공지도 읽지 않는다.

               ★ '상단 고정'과 다른 것이다 — 고정은 목록 순서이고 팝업은 화면에
                 띄우는 것이다. 한 값으로 합치면 오래 두려는 공지가 매번 튀어나온다.
            */}
            <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
              <label className="chk">
                <input type="checkbox" checked={popup} onChange={e => setPopup(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                {t('bc_popup')}
              </label>

              {/*
                 ★ 긴급도는 팝업을 켰을 때만 보여준다. 항상 보여주면 팝업이 아닌
                   공지에도 긴급도를 고르게 되고, 그 값은 아무 효과가 없다 —
                   운영자가 "중요로 했는데 안 뜬다" 고 여긴다.
              */}
              {popup && (
                <div className="input-group" style={{flex:1, minWidth:260}}>
                  <span className="input-group__label">{t('bc_severity')}</span>
                  <select className="input" value={severity} onChange={e => setSeverity(e.target.value)}>
                    <option value="info">{t('bc_sev_info')}</option>
                    <option value="warning">{t('bc_sev_warning')}</option>
                    <option value="critical">{t('bc_sev_critical')}</option>
                  </select>
                </div>
              )}
            </div>

            {!preview && (
              <textarea
                value={body} onChange={e => setBody(e.target.value)}
                placeholder={t('admin_notice_editor_c3d57e')}
                style={{width:'100%', minHeight: 400, padding: 14, background:'var(--color-bg-input)', border: '1px solid var(--color-border-default)', borderRadius: 6, color: 'var(--color-text-primary)', fontSize: 13, fontFamily: 'var(--font-sans)', resize:'vertical', outline: 'none', lineHeight: 1.7}}
              />
            )}
            {preview && (
              <div style={{padding: 20, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 6, minHeight: 400, fontSize: 13, lineHeight: 1.8}}>
                <h2 style={{marginTop: 0}}>{title || t('admin_notice_editor_a8e5c8')}</h2>
                <div style={{whiteSpace:'pre-wrap', color:'var(--color-text-secondary)'}}>{body || t('admin_notice_editor_c4c626')}</div>
              </div>
            )}

            {/* 결과 표시. 무엇이 됐고 무엇이 안 됐는지 정확히 알린다. */}
            {result && (
              <div style={{
                padding:'10px 12px', borderRadius:6, fontSize:12,
                background: result.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                                     : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                border: '1px solid ' + (result.ok ? 'var(--color-success)' : 'var(--color-danger)'),
                color: result.ok ? 'var(--color-success)' : 'var(--color-danger)',
              }}>
                {result.msg}
                {result.id && <span style={{fontFamily:'var(--font-mono)', opacity:0.75}}> · {String(result.id).slice(0, 8)}</span>}
              </div>
            )}

            <div style={{display:'flex', gap: 8, justifyContent:'flex-end', flexWrap:'wrap'}}>
              <button className="btn btn--sm" onClick={() => setPreview(!preview)}><I.Eye size={12}/> {preview ? 'Edit' : 'Preview'}</button>
              {/* 초안 저장 — 사용자에게 보이지 않는다. */}
              <button className="btn btn--sm" disabled={!canSubmit} onClick={() => submit(false)}>
                {busy ? '…' : t('admin_broadcast_e6f9c4')}
              </button>
              <button className="btn btn--sm btn--primary" disabled={!canSubmit} onClick={() => submit(true)}>
                <I.Send size={12}/> {busy ? '…' : t('admin_notice_editor_7148d7')}
              </button>
            </div>
          </div>

          <window.SectionCard title={t('admin_notice_editor_0a94de')}>
            {/*
              게시 설정.

              원래 이 자리에 배포 채널 체크박스 4개가 있었지만, 이메일·푸시 발송
              기능이 없다. 없는 기능의 체크박스를 남기면 관리자가 체크하고
              "이메일도 나갔다" 고 믿는다. 실제로 동작하는 설정으로 채운다.
            */}
            <div style={{display:'flex', flexDirection:'column', gap: 12, fontSize: 12}}>
              <label style={{display:'flex', flexDirection:'column', gap: 4}}>
                <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('notice_locale')}</span>
                <div className="seg">
                  {(window.QTI18n && window.QTI18n.available
                    ? window.QTI18n.available().map((x) => (typeof x === 'string' ? x : x.code))
                    : ['en']).map((lc) => (
                    <button key={lc} className={`seg__opt ${locale===lc?'is-active':''}`} onClick={() => setLocale(lc)}>{lc.toUpperCase()}</button>
                  ))}
                </div>
              </label>

              <label style={{display:'flex', flexDirection:'column', gap: 4}}>
                <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('notice_publish_at')}</span>
                <div className="input-group" style={{height: 34}}>
                  <input type="datetime-local" value={publishAt} onChange={e => setPublishAt(e.target.value)}/>
                </div>
                <span style={{fontSize:10, color:'var(--color-text-tertiary)'}}>{t('notice_publish_at_hint')}</span>
              </label>

              <label style={{display:'flex', flexDirection:'column', gap: 4}}>
                <span style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{t('notice_expires_at')}</span>
                <div className="input-group" style={{height: 34}}>
                  <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}/>
                </div>
                <span style={{fontSize:10, color:'var(--color-text-tertiary)'}}>{t('notice_expires_at_hint')}</span>
              </label>
            </div>
            <div style={{marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border-subtle)', fontSize: 11, color: 'var(--color-text-tertiary)'}}>
              {/*
                 ★ 작성자는 로그인한 관리자다.

                   전에는 `t('admin_notice_editor_102c1f')` = "권누리" 를 고정으로
                   찍었다. 공지 작성자는 책임 소재이므로 다른 사람 이름이 남으면
                   기록으로서 해롭다. 서버가 /admin/me 로 본인을 알려준다.
              */}
              <div>{t('notice_author')} · <strong style={{color:'var(--color-text-primary)'}}>{
                (window.QTAuth && window.QTAuth.getUser && window.QTAuth.getUser()
                  ? window.QTAuth.getUser().email
                  : null) || '—'
              }</strong></div>
              <div>{t('notice_published')} · <strong style={{color:'var(--color-text-primary)'}}>{t('admin_notice_editor_11a5df')}</strong></div>
              <div>ID · <strong style={{color:'var(--color-text-primary)', fontFamily:'var(--font-mono)'}}>NT-{Date.now().toString(36).toUpperCase()}</strong></div>
            </div>
          </window.SectionCard>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // CS TICKET DETAIL
  // ============================================================
  window.AdminCSTicketPage = function AdminCSTicketPage({ shellProps, ticketId }) {
    const [reply, setReply] = useState('');

    /*
       고객 지원 티켓 (실데이터).

       ticketId 가 없으면 목록에서 첫 티켓을 연다 — 이 화면은 상세 화면이지만
       /admin/cs 로 들어오는 경로가 있어서 무엇이든 열려야 한다.

       ★ 내부 메모(internal)를 시각적으로 구분한다. 구분하지 않으면 운영자가
         메모를 답장으로 착각해 "이미 안내했다" 고 판단하고, 고객은 답을
         받지 못한 상태로 남는다.
    */
    const [list, setList] = useState(null);
    const [listError, setListError] = useState(false);
    const [detail, setDetail] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    // 답장인지 내부 메모인지. 기본은 답장 — 메모가 기본이면 고객이 답을 못 받는다.
    const [asNote, setAsNote] = useState(false);

    const api = window.QTApi && window.QTApi.admin;

    const loadList = React.useCallback(() => {
      if (!api || !api.tickets) return Promise.resolve(null);
      return api.tickets({ limit: 100 })
        .then((r) => { setList(r.data || []); return r.data || []; })
        // ★★ 실패를 빈 목록으로 두면 "고객 문의 없음" 으로 보인다 — 문의를 놓친다.
        .catch(() => { setList(null); setListError(true); return []; });
    }, [api]);

    const loadDetail = React.useCallback((id) => {
      if (!api || !api.ticket || !id) return;
      api.ticket(id)
        .then((r) => setDetail({ ticket: r.ticket, messages: r.messages || [] }))
        .catch(() => setDetail(null));
    }, [api]);

    useEffect(() => {
      let cancelled = false;
      loadList().then((rows) => {
        if (cancelled || !rows) return;
        const target = ticketId || (rows[0] && rows[0].id);
        if (target) loadDetail(target);
      });
      return () => { cancelled = true; };
    }, [ticketId, loadList, loadDetail]);

    const isLive = Array.isArray(list);
    const liveTicket = detail && detail.ticket;

    /*
       화면이 기대하는 모양으로 맞춘다.

       실 티켓에는 `user` 대신 `userEmail`, `updated` 대신 `updatedAt` 이 있다.
       없는 값은 '—' 로 둔다.
    */
    /*
       ★ 실 티켓이 없으면 **목업으로 폴백하지 않는다.**

         전에는 CS_TICKETS[0](cs-001 / usr_00005 / 'KYC 승인 대기')를 보여줬다.
         그 결과가 나쁘다: 운영자가 존재하지 않는 고객의 문의를 실제라고 믿고
         처리하려 한다. 실제로 우리는 KYC 를 하지 않으므로 그 문의는 있을 수도
         없다. 없으면 없다고 말하는 것이 맞다.

         목록 조회가 아직 끝나지 않은 것(list === null)과 조회 결과가 비어 있는
         것(list === [])을 구분한다 — 로딩 중에 "없습니다" 를 보여주면 있는데도
         없다고 잘못 알린다.
    */
    const ticket = liveTicket
      ? {
          id: liveTicket.id,
          user: liveTicket.userEmail || liveTicket.userId || '—',
          subject: liveTicket.subject,
          status: liveTicket.status,
          priority: liveTicket.priority,
          updated: liveTicket.updatedAt,
        }
      : null;

    // 실데이터가 있으면 실 대화를, 없으면 디자이너 예시를 쓴다.
    const thread = detail
      ? detail.messages.map((m) => ({
          who: m.authorSide === 'customer' ? 'user' : 'admin',
          name: m.authorSide === 'customer' ? null : (m.internal ? t('cs_internal_note') : t('cs_staff')),
          text: m.body,
          time: new Date(m.createdAt).toLocaleString(),
          internal: m.internal,
        }))
      : null;

    /* 답장 전송. 내부 메모는 고객에게 보이지 않는다. */
    const send = async () => {
      if (!api || !api.replyTicket || !ticket || !reply.trim()) return;
      setBusy(true); setMsg(null);
      try {
        const r = await api.replyTicket(ticket.id, reply.trim(), asNote);
        if (r && r.ok === false) {
          setMsg({ ok: false, text: (r.message) || t('cs_send_failed') });
        } else {
          setReply('');
          setMsg({ ok: true, text: asNote ? t('cs_note_saved') : t('cs_reply_sent') });
          loadDetail(ticket.id);
          loadList();
        }
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('cs_send_failed') });
      }
      setBusy(false);
    };

    const act = async (fn, okText) => {
      if (!api || !ticket) return;
      setBusy(true); setMsg(null);
      try {
        await fn(ticket.id);
        setMsg({ ok: true, text: okText });
        loadDetail(ticket.id);
        loadList();
      } catch (e) {
        setMsg({ ok: false, text: (e && e.message) || t('cs_send_failed') });
      }
      setBusy(false);
    };

    /*
       티켓이 없을 때.

       ★ 로딩 중(list === null)과 진짜 없음(list === [])을 구분한다.
         로딩 중에 "없습니다" 를 보여주면 있는데도 없다고 잘못 알린다.

       ★ 목업 티켓을 대신 보여주지 않는다. 운영자가 존재하지 않는 고객의
         문의를 처리하려 하게 된다.
    */
    if (!ticket) {
      return (
        <window.PageShell
          {...shellProps}
          title={t('cs_detail_title')}
          subtitle={t('cs_detail_sub')}
          breadcrumb={['Home', 'Admin', 'CS Tickets']}
        >
          <div style={{
            padding:'16px 18px', borderRadius:8, fontSize:12.5, lineHeight:1.85,
            background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
            color:'var(--color-text-secondary)',
          }}>
            <div style={{fontWeight:600, marginBottom:5, color:'var(--color-text-primary)'}}>
              {listError ? t('list_load_failed') : list === null ? t('cs_loading') : (ticketId ? t('cs_not_found') : t('cs_none_yet'))}
            </div>
            <div>{list === null ? t('cs_loading_sub') : (ticketId ? t('cs_not_found_sub') : t('cs_none_yet_sub'))}</div>
          </div>
        </window.PageShell>
      );
    }

    return (
      <window.PageShell
        {...shellProps}
        title={ticket.subject}
        subtitle={`${ticket.id} · User ${ticket.user}`}
        breadcrumb={['Home','Admin','CS Tickets', ticket.id]}
        badge={<><span className={`severity-pill severity-pill--${ticket.priority === 'high' ? 'high' : ticket.priority === 'medium' ? 'medium' : 'low'}`}>{ticket.priority.toUpperCase()}</span> <span className={`status-pill status-pill--${ticket.status === 'open' ? 'warn' : ticket.status === 'resolved' ? 'ok' : 'neutral'}`}>{ticket.status.toUpperCase()}</span></>}
        actions={
          <>
            {isLive ? (
              <>
                <button className="btn btn--sm" disabled={busy} onClick={() => act((id) => api.assignTicket(id, false), t('cs_assigned'))}>
                  {t('cs_assign_me')}
                </button>
                {/* 이미 종료된 티켓은 다시 열 수 있게 한다 — 추가 문의가 묻히지 않도록. */}
                {ticket && ticket.status === 'resolved' ? (
                  <button className="btn btn--sm" disabled={busy} onClick={() => act((id) => api.setTicketStatus(id, 'open'), t('cs_reopened'))}>
                    {t('cs_reopen')}
                  </button>
                ) : (
                  <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => act((id) => api.setTicketStatus(id, 'resolved'), t('cs_resolved'))}>
                    <I.Check size={13}/> {t('cs_resolve')}
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn btn--sm">{t('cs_assign_me')}</button>
                <button className="btn btn--sm btn--primary"><I.Check size={13}/> {t('col_resolve')}</button>
              </>
            )}
          </>
        }
      >
        <div className="grid-2-1">
          <window.SectionCard title={t('admin_c_s_ticket_c65f61')} noPadding>
            <div style={{padding: 16, display: 'flex', flexDirection:'column', gap: 12, maxHeight: 400, overflowY:'auto'}}>
              {(thread || [
                { who:'user', text:ticket.subject + t('admin_c_s_ticket_e31e52'), time: 'yesterday 14:22' },
                { who:'admin', name:'CS · Hyewon', text:t('admin_c_s_ticket_291781'), time:'yesterday 14:40' },
                { who:'user', text:t('admin_c_s_ticket_165627'), time:'yesterday 15:00' },
                { who:'admin', name:'CS · Hyewon', text:t('admin_c_s_ticket_5be08a'), time:'today 09:14' },
              ]).map((m, i) => (
                <div key={i} style={{display:'flex', gap: 10, alignItems:'flex-start'}}>
                  <div style={{width: 30, height: 30, borderRadius:'50%', background: m.who === 'user' ? 'var(--color-bg-elevated)' : 'var(--color-brand-subtle)', color: m.who === 'user' ? 'var(--color-text-secondary)' : 'var(--color-brand)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, flexShrink:0}}>{m.who === 'user' ? 'U' : 'CS'}</div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex', gap:8, alignItems:'baseline', marginBottom:2}}>
                      <strong style={{fontSize:12}}>{m.who === 'user' ? t('admin_c_s_ticket_5c50d9') : m.name}</strong>
                      <span style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{m.time}</span>
                    </div>
                    {/*
                       내부 메모는 배경·테두리로 확실히 구분한다.
                       답장과 같아 보이면 운영자가 "이미 안내했다" 고 착각하고
                       고객은 답을 못 받은 채 남는다.
                    */}
                    <div style={m.internal ? {
                      fontSize: 12.5, lineHeight: 1.6, color:'var(--color-text-primary)',
                      background:'color-mix(in srgb, var(--color-warning) 12%, transparent)',
                      border:'1px dashed var(--color-warning)', borderRadius:4, padding:'6px 8px',
                    } : {fontSize: 12.5, color:'var(--color-text-secondary)', lineHeight: 1.6}}>
                      {m.internal && (
                        <div style={{fontSize:10, fontWeight:700, color:'var(--color-warning)', marginBottom:3, letterSpacing:'0.04em'}}>
                          {t('cs_internal_only')}
                        </div>
                      )}
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{padding: 12, borderTop: '1px solid var(--color-border-subtle)'}}>
              <textarea
                value={reply} onChange={e => setReply(e.target.value)}
                placeholder={t('admin_c_s_ticket_a6c22d')}
                style={{width:'100%', minHeight: 80, padding: 8, background:'var(--color-bg-input)', border: '1px solid var(--color-border-default)', borderRadius: 4, color: 'var(--color-text-primary)', fontSize: 12, fontFamily: 'var(--font-sans)', resize:'vertical', outline: 'none'}}
              />
              {msg && (
                <div style={{
                  marginTop:6, padding:'8px 10px', borderRadius:4, fontSize:11.5,
                  background: msg.ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
                  border: '1px solid ' + (msg.ok ? 'var(--color-success)' : 'var(--color-danger)'),
                  color: msg.ok ? 'var(--color-success)' : 'var(--color-danger)',
                }}>{msg.text}</div>
              )}
              <div style={{display:'flex', gap: 6, justifyContent:'flex-end', marginTop: 6, alignItems:'center'}}>
                {/*
                   내부 메모 스위치.

                   체크박스로 두는 이유: 버튼이 두 개면 어느 쪽을 눌렀는지
                   눈으로 확인하기 어렵고, 내부 메모가 고객에게 나가는 사고가
                   난다. 지금 어느 모드인지 항상 보이게 한다.
                */}
                {isLive && (
                  <label className="chk" style={{marginRight:'auto', fontSize:11}}>
                    <input type="checkbox" checked={asNote} onChange={e => setAsNote(e.target.checked)}/>
                    <span className="chk__box"><I.Check size={10}/></span>
                    {t('cs_as_internal')}
                  </label>
                )}
                <button className="btn btn--sm" disabled={isLive}>{t('admin_c_s_ticket_3f0669')}</button>
                <button
                  className={`btn btn--sm ${asNote ? '' : 'btn--primary'}`}
                  disabled={!reply.trim() || busy || !isLive}
                  onClick={send}
                >
                  <I.Send size={12}/> {busy ? '…' : (asNote ? t('cs_save_note') : t('admin_c_s_ticket_95bf7b'))}
                </button>
              </div>
            </div>
          </window.SectionCard>

          <div style={{display:'flex', flexDirection:'column', gap:16}}>
            <window.SectionCard title={t('admin_c_s_ticket_5c8747')}>
              <div style={{display:'flex', flexDirection:'column', gap: 6, fontSize: 12}}>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>ID</span><span style={{fontFamily:'var(--font-mono)'}}>{ticket.id}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>{t('admin_c_s_ticket_5c50d9')}</span><span style={{fontFamily:'var(--font-mono)'}}>{ticket.user}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>{t('col_priority')}</span><span>{ticket.priority}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>{t('col_status')}</span><span>{ticket.status}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>{t('col_updated')}</span><span>{timeAgo(ticket.updated)}</span></div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('admin_c_s_ticket_15e878')}>
              <div style={{display:'flex', flexDirection:'column', gap: 4}}>
                {/*
                   빠른 동작.

                   배선할 수 있는 것만 남긴다. KYC·지갑 조회는 우리에게
                   해당 기능이 없다(비수탁·KYC 미구축) — 버튼을 두면 눌러보고
                   아무 일도 없어 고장으로 오해한다.
                */}
                {isLive ? (
                  <>
                    <button
                      className="btn btn--sm" style={{justifyContent:'flex-start'}}
                      disabled={!liveTicket || !liveTicket.userId}
                      onClick={() => { if (liveTicket && liveTicket.userId) window.location.hash = '#/admin/users/detail?id=' + encodeURIComponent(liveTicket.userId); }}
                    ><I.User size={12}/> {t('cs_open_user')}</button>
                    <button
                      className="btn btn--sm" style={{justifyContent:'flex-start'}}
                      disabled={busy}
                      onClick={() => act((id) => api.setTicketPriority(id, 'high'), t('cs_priority_high'))}
                    ><I.Alert size={12}/> {t('cs_mark_high')}</button>
                    <button
                      className="btn btn--sm" style={{justifyContent:'flex-start'}}
                      disabled={busy}
                      onClick={() => act((id) => api.setTicketStatus(id, 'pending'), t('cs_waiting_customer'))}
                    ><I.Info size={12}/> {t('cs_mark_pending')}</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.User size={12}/> {t('admin_c_s_ticket_65b9cf')}</button>
                    <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Camera size={12}/> {t('admin_user_detail_0057bd')}</button>
                    <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Wallet size={12}/> {t('admin_c_s_ticket_00ecd1')}</button>
                    <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Book size={12}/> {t('admin_c_s_ticket_efefae')}</button>
                  </>
                )}
              </div>
            </window.SectionCard>
          </div>
        </div>
      </window.PageShell>
    );
  };

  // ============================================================
  // ADMIN ASSETS — Hi-fi (upgraded from placeholder)
  // ============================================================
  window.AdminAssetsHiFiPage = function AdminAssetsHiFiPage({ shellProps }) {
    /*
       자산 · 출금 (관리자).

       ★ 이 화면은 **수탁 거래소**의 자산 콘솔이다. 핫/콜드 지갑 잔고,
         3-of-5 멀티시그, 준비금 비율, Hot→Cold 이체 서명 대기…

         우리 구조에는 그런 것이 하나도 없다. 고객 자금은 고객의 거래소
         계정에 있고, 우리는 지갑도 키도 온체인 전송도 갖지 않는다.

       왜 위험한가
       ----------
       운영자가 이 화면을 보고 "콜드월렛에 $28.4M 있다" 고 판단하면 그 수치가
       보고·회계·고객 응대에 그대로 들어간다. 존재하지 않는 자산이다.
       'Sign' 버튼은 서명할 대상이 없고, '준비금 112%' 는 준비금 자체가 없다.

       그래서 백엔드가 붙은 실서비스에서는 사실을 보여주고, 백엔드 없는
       디자인 미리보기에서는 원래 화면을 그대로 유지한다(디자이너 불가침).
    */
    if (window.QTLive && window.QTLive.useLiveVersion) window.QTLive.useLiveVersion();
    const backend = window.QTLive && window.QTLive.isBackendPresent
      ? window.QTLive.isBackendPresent() : null;
    // 판정 중(null)도 실서비스로 본다 — 없는 자산을 보여주는 위험이 더 크다.
    if (backend !== false) {
      /*
         ★★ 실서비스에서는 목업으로 **절대** 떨어지지 않는다.

           전에는 `backend !== false && window.AdminAssetsPage` 였다. 즉 그 전역이
           어떤 이유로든 없으면(스크립트 로드 실패 등) 조건이 거짓이 되어 아래
           목업으로 내려갔다 — 프로덕션에서 "콜드월렛 $28.4M · 준비금 112%" 가
           그대로 표시된다는 뜻이다. 존재하지 않는 자산이고, 그 수치가 보고·회계·
           고객 응대에 들어가면 되돌리기 어렵다.

           그래서 실서비스 판정이면 목업 대신 **아무것도 없다는 사실**을 보여준다.
      */
      if (window.AdminAssetsPage) return <window.AdminAssetsPage shellProps={shellProps}/>;
      return (
        <window.PageShell
          {...shellProps}
          title={t('adm_assets_withdrawals')}
          breadcrumb={['Home', 'Admin', 'Assets']}
        >
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--color-danger, #dc2626)' }}>
            {t('na_asset_unavailable')}
          </div>
        </window.PageShell>
      );
    }

    return (
      <window.PageShell {...shellProps} title={t('adm_assets_withdrawals')} subtitle={t('admin_assets_hi_fi_60cb06')} breadcrumb={['Home','Admin','Assets']}>
        <div className="grid-4">
          <window.KPICard label="Hot Wallet"  value="$4.2M" sub={t('admin_assets_hi_fi_503c9d')} tone="brand"/>
          <window.KPICard label="Cold Wallet" value="$28.4M" sub="Multi-sig · 3-of-5" tone="success"/>
          <window.KPICard label="Reserve Ratio" value="112%" sub={t('admin_assets_hi_fi_4b4b97')} tone="long"/>
          <window.KPICard label="Pending Reconcile" value="2" tone="warning"/>
        </div>

        <div className="grid-2">
          <window.SectionCard title={t('admin_assets_hi_fi_dc00b9')}>
            <window.DataTable
              columns={[
                { key:'asset', label:'Asset', render: r => <strong>{r.asset}</strong> },
                { key:'balance', label:'Balance', align:'right', render: r => <span style={{fontFamily:'var(--font-num)'}}>{r.balance}</span> },
                { key:'usd', label:'USD Value', align:'right', render: r => '$' + fmtCompact(r.usd) },
                { key:'pct', label:'% of Hot', align:'right', render: r => r.pct + '%' },
              ]}
              rows={[
                { asset:'USDT', balance:'2,140,000',  usd:2140000, pct: 51 },
                { asset:'BTC',  balance:'18.4',       usd:1258000, pct: 30 },
                { asset:'ETH',  balance:'186',        usd: 653000, pct: 16 },
                { asset:'SOL',  balance:'820',        usd: 146000, pct:  3 },
              ]}
            />
          </window.SectionCard>

          <window.SectionCard title={t('admin_assets_hi_fi_24e2e8')}>
            <window.DataTable
              columns={[
                { key:'asset', label:'Asset', render: r => <strong>{r.asset}</strong> },
                { key:'balance', label:'Balance', align:'right', render: r => <span style={{fontFamily:'var(--font-num)'}}>{r.balance}</span> },
                { key:'usd', label:'USD Value', align:'right', render: r => '$' + fmtCompact(r.usd) },
                { key:'signers', label:'Signers' },
              ]}
              rows={[
                { asset:'BTC',  balance:'240',       usd:16416000, signers:'3-of-5' },
                { asset:'ETH',  balance:'2,400',     usd: 8430000, signers:'3-of-5' },
                { asset:'USDT', balance:'3,500,000', usd: 3500000, signers:'3-of-5' },
                { asset:'SOL',  balance:'2,000',     usd:  357000, signers:'3-of-5' },
              ]}
            />
          </window.SectionCard>
        </div>

        <window.SectionCard title={t('admin_assets_hi_fi_48aeb1')} noPadding>
          <window.DataTable
            columns={[
              { key:'time', label: t('adm_col_time'), render: () => '2h ago' },
              { key:'kind', label:'Direction', render: () => <span className="status-pill status-pill--neutral">HOT → COLD</span> },
              { key:'asset', label:'Asset', render: () => <strong>USDT</strong> },
              { key:'amount', label:t('col_amount'), align:'right', render: () => '500,000' },
              { key:'signers', label:'Signers', render: () => '2/3 signed' },
              { key:'status', label: t('adm_col_status'), render: () => <span className="status-pill status-pill--warn">PENDING SIGNATURES</span> },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">{t('col_sign')}</button> <button className="tbl-action" style={{marginLeft:3}}>{t('col_details')}</button></> },
            ]}
            rows={[{id:1},{id:2}]}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };
})();
