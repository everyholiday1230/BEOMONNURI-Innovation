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
  const { useState, useEffect, useMemo } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처이며 코드에 문자열을 두지 않는다.
  const t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);

  /** 언어 변경 시 재렌더되도록 하는 훅. */
  const useLocale = () => (window.useI18nLocale ? window.useI18nLocale() : null);
  const I = window.Icons;
  const { fmt, fmtCompact } = window.QTFmt;

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
  window.AdminUserDetailPage = function AdminUserDetailPage({ shellProps, userId }) {
    const user = window.QTApp.ADMIN_USERS.find(u => u.id === (userId || 'usr_kuri001')) || window.QTApp.ADMIN_USERS[0];
    const [tab, setTab] = useState('overview');
    const [showAction, setShowAction] = useState(null);

    return (
      <window.PageShell
        {...shellProps}
        title={user.name}
        subtitle={user.email + ' · ' + user.id}
        breadcrumb={['Home','Admin','Users', user.name]}
        badge={
          <>
            <span className={`status-pill status-pill--${user.status}`}>{user.status.toUpperCase()}</span>
            <span className="badge badge--neutral">{user.tier}</span>
            <span className="badge badge--success">KYC L{user.kyc}</span>
          </>
        }
        actions={
          <>
            <button className="btn btn--sm"><I.Send size={13}/> {t('admin_user_detail_96330a')}</button>
            <button className="btn btn--sm"><I.Camera size={13}/> Export</button>
            {user.status === 'active' && <button className="btn btn--sm btn--danger" onClick={() => setShowAction('suspend')}><I.Alert size={13}/> {t('admin_user_detail_1d441e')}</button>}
            {user.status === 'suspended' && <button className="btn btn--sm btn--primary" onClick={() => setShowAction('unsuspend')}><I.Check size={13}/> {t('admin_user_detail_f63bf7')}</button>}
          </>
        }
      >
        <div className="grid-4">
          <window.KPICard label={t('admin_user_detail_22d6d2')} value={'$' + fmtCompact(user.vol30)} tone="brand"/>
          <window.KPICard label={t('admin_user_detail_33103c')} value={'$' + fmtCompact(user.vol30 * 0.0004)} tone="warning"/>
          <window.KPICard label={t('admin_user_detail_81922a')} value="3" sub="1 long · 2 short"/>
          <window.KPICard label={t('admin_user_detail_170f7b')} value={user.joined}/>
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
              <window.SectionCard title="Profile Information">
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, fontSize: 12}}>
                  <div><div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Name</div><div style={{fontWeight:500, marginTop:2}}>{user.name}</div></div>
                  <div><div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Email</div><div style={{fontWeight:500, marginTop:2}}>{user.email}</div></div>
                  <div><div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Country</div><div style={{fontWeight:500, marginTop:2}}>{user.country}</div></div>
                  <div><div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Tier</div><div style={{fontWeight:500, marginTop:2}}>{user.tier}</div></div>
                  <div><div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>KYC Level</div><div style={{fontWeight:500, marginTop:2}}>L{user.kyc}</div></div>
                  <div><div style={{fontSize:10, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Joined</div><div style={{fontWeight:500, marginTop:2}}>{user.joined}</div></div>
                </div>
              </window.SectionCard>

              {user.flags.length > 0 && (
                <window.SectionCard title="⚠ Flags">
                  {user.flags.map(f => (
                    <div key={f} className="auth-alert auth-alert--warning" style={{marginBottom: 6}}>
                      <I.Alert size={12}/>
                      <div><strong>{f}</strong>{t('flag_auto_detected')}<a href="#" style={{color:'var(--color-warning)'}}>{t('flag_investigate')}</a></div>
                    </div>
                  ))}
                </window.SectionCard>
              )}

              <window.SectionCard title="Connected Exchanges">
                <div style={{display:'flex', flexDirection:'column', gap: 6}}>
                  <div style={{display:'flex', alignItems:'center', gap: 10, padding: 10, background: 'var(--color-bg-surface)', borderRadius: 4}}>
                    <div className="exchange-card__logo" style={{width:28, height:28, borderRadius:5, background:'#F0B90B', color:'#0A0E14', fontSize:11}}>B</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12, fontWeight:500}}>Binance</div>
                      <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>Read + Trade + Futures · IP restricted</div>
                    </div>
                    <span className="status-pill status-pill--ok">ACTIVE</span>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap: 10, padding: 10, background: 'var(--color-bg-surface)', borderRadius: 4}}>
                    <div className="exchange-card__logo" style={{width:28, height:28, borderRadius:5, background:'#00CED1', color:'#0A0E14', fontSize:11}}>Bg</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12, fontWeight:500}}>Bitget</div>
                      <div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>Read + Trade · No IP restriction</div>
                    </div>
                    <span className="status-pill status-pill--ok">ACTIVE</span>
                  </div>
                </div>
              </window.SectionCard>
            </div>

            <div style={{display:'flex', flexDirection:'column', gap: 16}}>
              <window.SectionCard title="Quick Actions">
                <div style={{display:'flex', flexDirection:'column', gap: 6}}>
                  <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Send size={12}/> {t('admin_user_detail_941ad1')}</button>
                  <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Wallet size={12}/> {t('admin_user_detail_e4ec3e')}</button>
                  <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Chart size={12}/> {t('admin_user_detail_80a094')}</button>
                  <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Lock size={12}/> {t('admin_user_detail_e03d2f')}</button>
                  <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Refresh size={12}/> {t('admin_user_detail_04f2aa')}</button>
                  <button className="btn btn--sm" style={{justifyContent:'flex-start'}}><I.Camera size={12}/> {t('admin_user_detail_851473')}</button>
                  <button className="btn btn--sm btn--danger" style={{justifyContent:'flex-start'}} onClick={() => setShowAction('suspend')}><I.Alert size={12}/> {t('admin_user_detail_82d3e7')}</button>
                </div>
              </window.SectionCard>

              <window.SectionCard title="Risk Score" subtitle={t('admin_user_detail_d65b24')}>
                <div style={{fontFamily:'var(--font-num)', fontSize: 32, fontWeight: 700, color: 'var(--color-success)'}}>18/100</div>
                <div style={{fontSize:11, color:'var(--color-text-tertiary)', marginBottom: 12}}>Low risk · KYC L{user.kyc} · No flags</div>
                <div style={{height:8, background:'var(--color-bg-input)', borderRadius:999, overflow:'hidden'}}>
                  <div style={{height:'100%', width:'18%', background:'var(--color-success)'}}/>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--color-text-tertiary)', marginTop:4}}>
                  <span>Low</span><span>Medium</span><span>High</span>
                </div>
              </window.SectionCard>
            </div>
          </div>
        )}

        {tab === 'kyc' && (
          <div className="grid-2">
            <window.SectionCard title={t('admin_user_detail_3f4319')}>
              <div style={{aspectRatio: '1.6/1', background:'linear-gradient(135deg, var(--color-bg-elevated), var(--color-bg-surface))', border: '1px dashed var(--color-border-default)', borderRadius: 8, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap: 4, color:'var(--color-text-tertiary)'}}>
                <I.Camera size={32}/>
                <div style={{fontSize:11, fontFamily:'var(--font-mono)'}}>ID_FRONT.jpg · 2.4MB</div>
                <div style={{fontSize:10}}>Uploaded 2025-11-18 · Verified</div>
              </div>
              <div style={{aspectRatio: '1.6/1', background:'linear-gradient(135deg, var(--color-bg-elevated), var(--color-bg-surface))', border: '1px dashed var(--color-border-default)', borderRadius: 8, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap: 4, color:'var(--color-text-tertiary)', marginTop: 8}}>
                <I.User size={32}/>
                <div style={{fontSize:11, fontFamily:'var(--font-mono)'}}>SELFIE.jpg · 1.8MB</div>
                <div style={{fontSize:10}}>Uploaded 2025-11-18 · Verified</div>
              </div>
            </window.SectionCard>

            <window.SectionCard title={t('admin_user_detail_a43b70')}>
              <div style={{display:'flex', flexDirection:'column', gap: 10, fontSize: 12}}>
                {[
                  { k:'Face match', v:'98.4%', ok: true },
                  { k:'Document authenticity', v:'Passed', ok: true },
                  { k:'PEP check', v:'Clear', ok: true },
                  { k:'Sanctions list', v:'Clear', ok: true },
                  { k:'Address verification', v:'Passed', ok: true },
                  { k:'Duplicate account', v:'None', ok: true },
                ].map(r => (
                  <div key={r.k} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)'}}>
                    <span>{r.k}</span>
                    <span style={{color: r.ok ? 'var(--color-success)' : 'var(--color-danger)', fontFamily:'var(--font-mono)', fontWeight: 500}}>{r.ok ? '✓ ' : '✗ '}{r.v}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop: 12, display: 'flex', gap: 8}}>
                <button className="btn btn--sm">{t('admin_user_detail_afc528')}</button>
                <button className="btn btn--sm btn--primary">{t('admin_user_detail_219da4')}</button>
              </div>
            </window.SectionCard>
          </div>
        )}

        {tab === 'activity' && (
          <window.SectionCard title={t('admin_user_detail_8f5d10')} noPadding>
            <window.DataTable
              columns={[
                { key:'time', label:'Time', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{r.time}</span> },
                { key:'action', label:'Action', render: r => <span style={{fontFamily:'var(--font-mono)', color:'var(--color-brand)'}}>{r.action}</span> },
                { key:'detail', label:'Detail' },
                { key:'ip', label:'IP', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{r.ip}</span> },
              ]}
              rows={[
                { time:'2026-08-02 09:14', action:'login',           detail:'Seoul, KR · Chrome', ip:'59.10.20.4' },
                { time:'2026-08-02 08:14', action:'order.submit',    detail:'BTC/USDT Long 0.185',ip:'59.10.20.4' },
                { time:'2026-08-01 15:44', action:'order.submit',    detail:'ETH/USDT Short 1.5', ip:'59.10.20.4' },
                { time:'2026-08-01 09:32', action:'ai.signal.approve', detail:'sig-btc-01', ip:'59.10.20.4' },
                { time:'2026-08-01 09:14', action:'login',           detail:'Seoul, KR · Chrome', ip:'59.10.20.4' },
                { time:'2026-07-30 22:20', action:'deposit',         detail:'USDT 1000 · TRC20',  ip:'59.10.20.4' },
                { time:'2026-07-28 14:22', action:'api.key.rotate',  detail:'Binance Main', ip:'59.10.20.4' },
              ]}
            />
          </window.SectionCard>
        )}

        {(tab === 'trades' || tab === 'assets' || tab === 'security' || tab === 'notes') && (
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
                  <div><strong>User:</strong> {user.name}</div>
                  <div><strong>ID:</strong> {user.id}</div>
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
                  <span className="input-group__label">Note</span>
                  <input placeholder={t('admin_user_detail_f35682')}/>
                </div>
                <div className="auth-alert auth-alert--warning" style={{marginTop: 12}}>
                  <I.Info size={12}/>
                  <div>{t('admin_user_detail_bd464c')}</div>
                </div>
              </div>
              <div className="modal__footer">
                <button className="btn btn--sm" onClick={() => setShowAction(null)}>{t('admin_user_detail_19b2d1')}</button>
                <button className="btn btn--sm btn--danger" onClick={() => { alert(t('admin_user_detail_4def42')); setShowAction(null); }}>{t('admin_user_detail_ff8aa0')}</button>
              </div>
            </div>
          </div>
        )}
      </window.PageShell>
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

    const [filter, setFilter] = useState('pending');
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
              { key:'user', label:'User', render: r => <div><strong>{r.name}</strong><div style={{fontSize:10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)'}}>{r.user}</div></div> },
              { key:'country', label:'Country' },
              { key:'level', label:'KYC', render: r => `L${r.level} → L${r.target}` },
              { key:'submitted', label:'Submitted', render: r => timeAgo(r.submitted) },
              { key:'risk', label:'Risk Score', render: r => <span style={{color: r.riskScore > 40 ? 'var(--color-danger)' : r.riskScore > 25 ? 'var(--color-warning)' : 'var(--color-success)', fontFamily:'var(--font-mono)', fontWeight: 500}}>{r.riskScore}</span> },
              { key:'flags', label:'Auto Flags', render: r => r.flags?.length || r.autoFlags?.length ? (r.autoFlags || r.flags).map(f => <span key={f} className="severity-pill severity-pill--medium" style={{marginRight:3}}>{f}</span>) : <span style={{color:'var(--color-text-tertiary)'}}>·</span> },
              { key:'status', label:'Status', render: r => <span className={`status-pill status-pill--${r.status === 'pending' ? 'warn' : r.status === 'reviewing' ? 'neutral' : r.status === 'approved' ? 'ok' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key:'act', label:'', align:'right', render: r => <><button className="tbl-action">Review</button> <button className="tbl-action" style={{marginLeft:3}}>Approve</button> <button className="tbl-action tbl-action--danger" style={{marginLeft:3}}>Reject</button></> },
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
          <window.KPICard label="Flagged" value={items.filter(i => i.status === 'flagged').length} tone="danger"/>
          <window.KPICard label="24h Volume" value="$142,340" tone="long"/>
          <window.KPICard label="Confirmed · 24h" value="98"/>
        </div>
        <window.SectionCard title={t('admin_deposits_48f252')} noPadding>
          <window.DataTable
            columns={[
              { key:'id', label:'ID', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10}}>{r.id}</span> },
              { key:'user', label:'User', render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.user}</span> },
              { key:'amount', label:'Amount', align:'right', render: r => <strong style={{fontFamily:'var(--font-num)'}}>{r.amount} {r.asset}</strong> },
              { key:'network', label:'Network' },
              { key:'conf', label:'Confirmations', align:'right', render: r => r.confirmations },
              { key:'time', label:'Time', render: r => timeAgo(r.time) },
              { key:'tx', label:'TX', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-brand)'}}>{r.txHash}</span> },
              { key:'status', label:'Status', render: r => <span className={`status-pill status-pill--${r.status === 'confirmed' ? 'ok' : r.status === 'pending' ? 'warn' : 'danger'}`}>{r.status.toUpperCase()}</span> },
              { key:'act', label:'', align:'right', render: r => (r.status !== 'confirmed' ? <><button className="tbl-action">Inspect</button> <button className="tbl-action" style={{marginLeft:3}}>Approve</button></> : <button className="tbl-action">View</button>) },
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
              { key:'user', label:'User', render: r => <span style={{fontFamily:'var(--font-mono)'}}>{r.user}</span> },
              { key:'amount', label:'Amount', align:'right', render: r => <strong>{r.amount} {r.asset}</strong> },
              { key:'network', label:'Network' },
              { key:'to', label:'To Address', render: r => <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-tertiary)'}}>{r.to}</span> },
              { key:'time', label:'Time', render: r => timeAgo(r.time) },
              { key:'risk', label:'Risk', render: r => <span className={`severity-pill severity-pill--${r.risk === 'high' ? 'high' : r.risk === 'medium' ? 'medium' : 'low'}`}>{r.risk.toUpperCase()}</span> },
              { key:'status', label:'Status', render: r => <span className={`status-pill status-pill--${r.status === 'sent' ? 'ok' : 'warn'}`}>{r.status.toUpperCase()}</span> },
              { key:'act', label:'', align:'right', render: r => (r.status === 'pending-approval' ? <><button className="tbl-action">Inspect</button> <button className="tbl-action" style={{marginLeft:3}}>Approve</button> <button className="tbl-action tbl-action--danger" style={{marginLeft:3}}>Reject</button></> : <button className="tbl-action">View</button>) },
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
    const [schedAt, setSchedAt] = useState('');
    const [pinned, setPinned] = useState(false);

    const api = window.QTApi && window.QTApi.admin;
    const canWrite = Boolean(window.QTAdmin && window.QTAdmin.can && window.QTAdmin.can('admin.notice.write'));

    const loadRecent = React.useCallback(() => {
      if (!api || !api.notices) return;
      api.notices(10).then((r) => setRecent(r.data || [])).catch(() => setRecent([]));
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
        title="Broadcast"
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
                  <div className="input-group"><span className="input-group__label">Date</span><input type="date"/></div>
                  <div className="input-group"><span className="input-group__label">Time (UTC)</span><input type="time"/></div>
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
                    <button className="btn btn--sm">Preview</button>
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
                Array.isArray(recent) && recent.length > 0 ? recent.map((n) => (
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
              <div style={{fontSize:11, color:'var(--color-text-tertiary)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Category:</div>
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
              <div>Author · <strong style={{color:'var(--color-text-primary)'}}>{t('admin_notice_editor_102c1f')}</strong></div>
              <div>Published · <strong style={{color:'var(--color-text-primary)'}}>{t('admin_notice_editor_11a5df')}</strong></div>
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
        .catch(() => { setList([]); return []; });
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
              {list === null ? t('cs_loading') : (ticketId ? t('cs_not_found') : t('cs_none_yet'))}
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
                <button className="btn btn--sm">Assign to me</button>
                <button className="btn btn--sm btn--primary"><I.Check size={13}/> Resolve</button>
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
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>User</span><span style={{fontFamily:'var(--font-mono)'}}>{ticket.user}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>Priority</span><span>{ticket.priority}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>Status</span><span>{ticket.status}</span></div>
                <div style={{display:'flex', justifyContent:'space-between'}}><span style={{color:'var(--color-text-tertiary)'}}>Updated</span><span>{timeAgo(ticket.updated)}</span></div>
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
    if (backend !== false && window.AdminAssetsPage) {
      return <window.AdminAssetsPage shellProps={shellProps}/>;
    }

    return (
      <window.PageShell {...shellProps} title="Assets & Withdrawals" subtitle={t('admin_assets_hi_fi_60cb06')} breadcrumb={['Home','Admin','Assets']}>
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
              { key:'time', label:'Time', render: () => '2h ago' },
              { key:'kind', label:'Direction', render: () => <span className="status-pill status-pill--neutral">HOT → COLD</span> },
              { key:'asset', label:'Asset', render: () => <strong>USDT</strong> },
              { key:'amount', label:'Amount', align:'right', render: () => '500,000' },
              { key:'signers', label:'Signers', render: () => '2/3 signed' },
              { key:'status', label:'Status', render: () => <span className="status-pill status-pill--warn">PENDING SIGNATURES</span> },
              { key:'act', label:'', align:'right', render: () => <><button className="tbl-action">Sign</button> <button className="tbl-action" style={{marginLeft:3}}>Details</button></> },
            ]}
            rows={[{id:1},{id:2}]}
          />
        </window.SectionCard>
      </window.PageShell>
    );
  };
})();
