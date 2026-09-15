/**
 * 리더보드 — 대회 순위 화면.
 *
 * 왜 별 파일인가: 포인트 화면과 같은 원칙 — 기존 페이지 파일을 건드리지 않고
 * 기존 컴포넌트(PageShell·DataTable·seg 버튼)만으로 조립해 테마·밀도를 따라간다.
 *
 * ★ 정직성 규칙
 *   · 순위는 서버가 trade_journal 에서 직접 집계한다. 화면은 받아서 보여줄 뿐.
 *   · 상단 배지가 지금이 실거래(LIVE) 기준인지 모의(PAPER) 기준인지 말한다 —
 *     모의 순위를 실거래 순위처럼 보여주면 안 된다.
 *   · 항목이 없으면 "기록 없음" 이라고 말한다. 빈 표는 고장으로 보인다.
 */
(function () {
  'use strict';
  const { useState, useEffect, useCallback } = window.React;
  const I = window.Icons;
  const t = (k, v) => (window.QTI18n ? window.QTI18n.t(k, v) : k);

  window.LeaderboardPage = function LeaderboardPage({ shellProps }) {
    const [win, setWin] = useState('7d');
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
      setBusy(true);
      fetch('/api/competition/leaderboard?window=' + encodeURIComponent(win), { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((j) => { setData(j); setErr(null); })
        .catch((e) => setErr((e && e.message) || 'load failed'))
        .finally(() => setBusy(false));
    }, [win]);
    useEffect(() => { load(); }, [load]);

    const entries = (data && data.entries) || [];
    const isLive = data && data.disclosure === 'LIVE';

    return (
      <window.PageShell
        {...shellProps}
        title={t('lb_title')}
        subtitle={t('lb_subtitle')}
        breadcrumb={['Home', t('lb_title')]}
        actions={<button aria-label={t('lb_refresh')} className="btn btn--sm" onClick={load} title={t('lb_refresh')} disabled={busy}><I.Refresh size={13}/></button>}
      >
        {/* ★ 실거래/모의 기준 배지 — 이 순위가 무엇의 순위인지 먼저 말한다. */}
        <div style={{
          padding:'11px 14px', borderRadius:7, fontSize:12.5, lineHeight:1.7,
          marginBottom:14, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
          background: isLive ? 'color-mix(in srgb, var(--color-warning) 10%, transparent)' : 'var(--color-bg-surface)',
          border:'1px solid ' + (isLive ? 'var(--color-warning)' : 'var(--color-border-subtle)'),
        }}>
          <strong>{isLive ? t('lb_basis_live') : t('lb_basis_paper')}</strong>
          <span style={{color:'var(--color-text-secondary)'}}>{t('lb_source_note')}</span>
        </div>

        <div className="seg" style={{width:'auto', marginBottom:14}}>
          {['7d','30d','all'].map((w) => (
            <button key={w} className={`seg__opt ${win === w ? 'is-active' : ''}`} onClick={() => setWin(w)}>
              {t('lb_window_' + w)}
            </button>
          ))}
        </div>

        {err && (
          <div style={{padding:'12px 14px', borderRadius:6, fontSize:12.5, border:'1px solid var(--color-danger)', color:'var(--color-danger)'}}>
            {t('lb_load_failed')} · {err}
          </div>
        )}

        {!err && entries.length === 0 && (
          <div style={{padding:'14px 16px', fontSize:12.5, color:'var(--color-text-secondary)', border:'1px solid var(--color-border-subtle)', borderRadius:7}}>
            {t('lb_empty')}
          </div>
        )}

        {entries.length > 0 && (
          <window.DataTable
            noPadding
            columns={[
              { key:'rank', label:t('lb_col_rank'), render:(r) => (
                <strong style={{fontFamily:'var(--font-num)'}}>{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</strong>
              ) },
              { key:'alias', label:t('lb_col_trader'), render:(r) => (
                <span style={{fontFamily:'var(--font-mono)', fontSize:12}}>{r.alias}</span>
              ) },
              { key:'pnl', label:t('lb_col_pnl'), align:'right', render:(r) => (
                <strong style={{fontFamily:'var(--font-num)', color: r.realizedPnl > 0 ? 'var(--color-trade-long)' : r.realizedPnl < 0 ? 'var(--color-trade-short)' : 'inherit'}}>
                  {(r.realizedPnl > 0 ? '+$' : r.realizedPnl < 0 ? '-$' : '$') + Math.abs(r.realizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              ) },
              { key:'fees', label:t('lb_col_fees'), align:'right', render:(r) => (
                <span style={{fontFamily:'var(--font-num)', color:'var(--color-text-tertiary)'}}>${(r.fees || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              ) },
              { key:'trades', label:t('lb_col_trades'), align:'right', render:(r) => (
                <span style={{fontFamily:'var(--font-num)'}}>{r.trades}</span>
              ) },
              { key:'winRate', label:t('lb_col_winrate'), align:'right', render:(r) => (
                <span style={{fontFamily:'var(--font-num)'}}>{Math.round(r.winRate * 100)}%</span>
              ) },
            ]}
            rows={entries}
          />
        )}
      </window.PageShell>
    );
  };
})();
