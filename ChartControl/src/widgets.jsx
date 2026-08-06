/* ============================================================
   Widget Components
   ------------------------------------------------------------
   Each widget is self-contained and reads from a shared store
   provided via context. All expose:
     - min/preferred sizes (in mock-data LAYOUT_PRESETS)
     - loading/empty/error states
   ============================================================ */

(function () {
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const I = window.Icons;

  // ---------- Number utils ----------
  const fmt = (n, d = 2) => {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtPct = (n, d = 2) => (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
  const fmtCompact = (n) => {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return fmt(n);
  };
  const fmtAuto = (n) => {
    if (n == null) return '—';
    if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (Math.abs(n) >= 1) return n.toFixed(3);
    return n.toFixed(5);
  };
  const fmtQty = (n, d = 3) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  /**
   * tickSize 로부터 표시 소수점 자리수를 구한다.
   * 예: 0.1 -> 1, 0.001 -> 3, 1e-05 -> 5
   */
  const decimalsForTick = (tick) => {
    if (!tick || !isFinite(tick) || tick <= 0) return null;
    const d = Math.round(-Math.log10(tick));
    return Math.max(0, Math.min(8, d));
  };

  /** 심볼의 tickSize 를 조회한다. 실데이터 연결 시 QT.MARKETS 에 채워진다. */
  const tickSizeFor = (symbol) => {
    if (!symbol || !window.QT || !Array.isArray(window.QT.MARKETS)) return null;
    const key = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const m of window.QT.MARKETS) {
      if ((m.base + m.quote).toUpperCase() === key) return m.tickSize || null;
    }
    return null;
  };

  /**
   * 가격 표시. 자리수를 하드코딩하지 않는다.
   *
   * 기존 목업은 BTC(약 68,000) 만 가정해 fmt(price, 0) / fmt(price, 1) 처럼
   * 고정 자리수를 썼다. 실데이터로 전환하면 심볼마다 가격 스케일이 달라
   * ETH 는 센트가 사라지고(1872.02 -> "1,872"), DOGE 는 아예 "0" 이 된다.
   * 그래서 거래소 tickSize 를 우선 쓰고, 없으면 가격 크기로 추정한다.
   *
   * @param {number} n
   * @param {string|number} [symbolOrTick] 심볼 문자열 또는 tickSize 숫자
   */
  const fmtPrice = (n, symbolOrTick) => {
    if (n == null || isNaN(n)) return '—';
    let d = null;
    if (typeof symbolOrTick === 'number') d = decimalsForTick(symbolOrTick);
    else if (typeof symbolOrTick === 'string') d = decimalsForTick(tickSizeFor(symbolOrTick));

    if (d === null) {
      const a = Math.abs(n);
      d = a >= 10000 ? 1 : a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 6;
    }
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  const timeAgo = (t) => {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m`;
    if (s < 86400) return `${Math.floor(s/3600)}h`;
    return `${Math.floor(s/86400)}d`;
  };

  /**
   * 심볼의 현재 마크가격을 조회한다.
   *
   * 실데이터 연결 시 QT.MARKETS 의 각 행에 실시간 price/mark 가 채워지므로,
   * 포지션마다 자기 심볼의 가격으로 평가할 수 있다.
   *
   * 왜 필요한가: 기존 목업은 단일 심볼(BTC)만 가정해 화면의 lastPrice 하나로
   * 모든 포지션의 손익을 계산했다. 실데이터에서 심볼을 ETH 로 바꾸면
   * BTC 포지션이 ETH 가격으로 평가되어 손익이 완전히 엉뚱해진다.
   * (진입 67,285 / 마크 1,871 -> -12,101 USDT 로 표시되는 것을 확인했다)
   *
   * @param {string} symbol   'BTCUSDT' 또는 'BTC/USDT'
   * @param {number} fallback 조회 실패 시 쓸 값
   */
  const markPriceFor = (symbol, fallback) => {
    if (!symbol || !window.QT || !Array.isArray(window.QT.MARKETS)) return fallback;
    const key = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const m of window.QT.MARKETS) {
      if ((m.base + m.quote).toUpperCase() !== key) continue;
      const px = m.mark || m.price;
      return typeof px === 'number' && px > 0 ? px : fallback;
    }
    return fallback;
  };

  window.QTFmt = { fmt, fmtPct, fmtCompact, fmtAuto, fmtQty, fmtPrice, decimalsForTick, tickSizeFor, markPriceFor, timeAgo };

  // ============================================================
  // MARKET WATCH
  // ============================================================
  window.MarketWatch = function MarketWatch({ current, onSelect, t }) {
    const [q, setQ] = useState('');
    const [tab, setTab] = useState('USDT-PERP');
    const [sort, setSort] = useState({ key: 'vol', dir: 'desc' });
    // 실시세가 QT.MARKETS 를 제자리 갱신하므로, 재계산 트리거가 필요하다.
    const liveVersion = window.QTLive ? window.QTLive.useLiveVersion() : 0;
    const list = useMemo(() => {
      let arr = [...QT.MARKETS];
      if (tab === 'Favorites') arr = arr.filter(m => m.fav);
      if (q) arr = arr.filter(m => m.base.toLowerCase().includes(q.toLowerCase()));
      arr.sort((a, b) => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        const k = sort.key === 'chg' ? 'chg24h' : sort.key === 'price' ? 'price' : 'vol24h';
        return (a[k] - b[k]) * dir;
      });
      return arr;
    }, [q, tab, sort, liveVersion]);

    return (
      <div className="panel" style={{height: '100%'}}>
        <div className="panel__header">
          <div className="panel__title">
            <I.Grid size={14}/>
            <span>{t('market_watch')}</span>
          </div>
          <div className="panel__actions">
            <button className="btn btn--icon" title="Filter"><I.Filter size={14}/></button>
            <button className="btn btn--icon"><I.More size={14}/></button>
          </div>
        </div>
        <div className="panel__body" style={{padding: 0}}>
          <div className="mw-search">
            <I.Search size={12}/>
            <input placeholder="Search symbols..." value={q} onChange={e => setQ(e.target.value)} />
            {q ? <button onClick={() => setQ('')} style={{color:'var(--color-text-tertiary)'}}><I.X size={12}/></button> : <kbd>/</kbd>}
          </div>
          <div className="mw-tabs">
            {['Favorites', 'USDT-PERP', 'USDC', 'BTC', 'Movers', 'New'].map(x => (
              <button key={x} className={`mw-tab ${tab === x ? 'is-active' : ''}`} onClick={() => setTab(x)}>{x}</button>
            ))}
          </div>
          <div className="mw-list-head">
            <span/>
            <span>Pair</span>
            <span style={{textAlign:'right'}}>Price / Vol</span>
            <span style={{textAlign:'right'}}>24h</span>
          </div>
          <div style={{flex: 1, overflowY: 'auto'}}>
            {list.map(m => {
              const isActive = current === `${m.base}${m.quote}`;
              return (
                <div key={m.base + m.quote} className={`mw-row ${isActive ? 'is-active' : ''}`} onClick={() => onSelect && onSelect(m)}>
                  <span className={`mw-row__star ${m.fav ? 'is-fav' : ''}`}>{m.fav ? '★' : '☆'}</span>
                  <div className="mw-row__sym">
                    <span className="mw-row__base">{m.base}<span style={{color:'var(--color-text-tertiary)', fontWeight:400}}>/{m.quote}</span></span>
                    <span className="mw-row__quote">{m.type}</span>
                  </div>
                  <div className="mw-row__price">
                    <div>{fmtAuto(m.price)}</div>
                    <div style={{color:'var(--color-text-tertiary)', fontSize:'10px'}}>{fmtCompact(m.vol24h)}</div>
                  </div>
                  <div className={`mw-row__chg ${m.chg24h >= 0 ? 't-long' : 't-short'}`}>
                    {m.chg24h >= 0 ? '▲' : '▼'} {fmtPct(m.chg24h).replace('+', '').replace('-', '')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // SYMBOL HEADER
  // ============================================================
  window.SymbolHeader = function SymbolHeader({ price, prev, market, t }) {
    const changeAbs = market.price * market.chg24h / 100;
    const isUp = price >= prev;
    const isUp24 = market.chg24h >= 0;
    return (
      <div className="symbol-header--v2">
        {/* GROUP 1: Identity — what am I looking at? */}
        <div className="sh-group sh-group--identity">
          <div className="sh-identity">
            <span className="sh-identity__star" title="Favorite">★</span>
            <div className="sh-identity__block">
              <div className="sh-identity__row1">
                <span className="sh-identity__sym">{market.base}<span className="quote">/</span>{market.quote}</span>
                <span className="badge badge--perp">{market.type}</span>
                <span className="sh-identity__caret" title="Change symbol">▼</span>
              </div>
              <div className="sh-identity__sub">
                <span>Perpetual · USDT-Margined</span>
                <span>·</span>
                <span className="badge badge--warning" style={{padding: '0 4px', fontSize: 9}}>20× LEV</span>
              </div>
            </div>
          </div>
        </div>

        {/* GROUP 2: Price — what is it worth? (largest visual weight) */}
        <div className="sh-group sh-price--v2">
          <div className={`val ${isUp ? 'is-up' : 'is-dn'}`}>{fmtAuto(price)}</div>
          <div className="change">
            <span className={`change__pill ${isUp24 ? 'is-up' : 'is-dn'}`}>
              {isUp24 ? '▲' : '▼'} {fmt(Math.abs(changeAbs), 2)} ({fmtPct(market.chg24h)})
            </span>
            <span className="change__usd">≈ ${fmt(price * 1)}</span>
          </div>
        </div>

        {/* GROUP 3: Meta — Mark / Index / Funding (secondary weight) */}
        <div className="sh-group sh-group--meta">
          <div className="sh-meta-cell">
            <span className="sh-meta-cell__k">{t('mark_price')}</span>
            <span className="sh-meta-cell__v sh-meta-cell__v--muted">{fmtAuto(price + 3.7)}</span>
          </div>
          <div className="sh-meta-cell">
            <span className="sh-meta-cell__k">{t('index_price')}</span>
            <span className="sh-meta-cell__v sh-meta-cell__v--muted">{fmtAuto(price - 1.7)}</span>
          </div>
          <div className="sh-meta-cell">
            <span className="sh-meta-cell__k">
              {t('funding')} <span className="tt-wrap"><I.Info size={9}/><span className="tt">{t('funding_countdown_tip')}</span></span>
            </span>
            <span className="sh-meta-cell__v">
              <span className="t-long">+0.0084%</span><span className="cd">54m</span>
            </span>
          </div>
          <div className="sh-meta-cell sh-group--range" style={{borderLeft:'1px solid var(--color-border-subtle)', paddingLeft: 12, marginLeft: 4}}>
            <span className="sh-meta-cell__k">{t('hi_24')}</span>
            <span className="sh-meta-cell__v sh-meta-cell__v--muted">{fmtAuto(market.hi)}</span>
          </div>
          <div className="sh-meta-cell sh-group--range">
            <span className="sh-meta-cell__k">{t('lo_24')}</span>
            <span className="sh-meta-cell__v sh-meta-cell__v--muted">{fmtAuto(market.lo)}</span>
          </div>
          <div className="sh-meta-cell sh-group--range">
            <span className="sh-meta-cell__k">{t('vol_24')}</span>
            <span className="sh-meta-cell__v sh-meta-cell__v--muted">{fmtCompact(market.vol24h)}</span>
          </div>
        </div>

        {/* GROUP 4: Actions */}
        <div className="sh-actions">
          <button className="btn btn--xs" title="Alerts">
            {window.Icons?.Bell ? <window.Icons.Bell size={11}/> : '🔔'}
          </button>
          <button className="btn btn--xs" title="Share">
            {window.Icons?.Share ? <window.Icons.Share size={11}/> : '↗'}
          </button>
          <button className="btn btn--xs" title="More">
            {window.Icons?.More ? <window.Icons.More size={11}/> : '⋯'}
          </button>
        </div>
      </div>
    );
  };

  // ============================================================
  // ORDER BOOK
  // ============================================================
  window.OrderBook = function OrderBook({ book, lastPrice, prevPrice, onClickPrice, t }) {
    // 표시 자리수는 거래소 tickSize 를 따른다. 심볼마다 가격 스케일이 다르므로
    // 고정 자리수를 쓰면 ETH 는 센트가 사라지고 DOGE 는 0 으로 표시된다.
    const tick = tickSizeFor(book && book.symbol);
    const [precision, setPrecision] = useState(0.1);
    const [mode, setMode] = useState('both');
    const [display, setDisplay] = useState('amount'); // amount | cumulative
    if (!book) return <div className="panel" style={{height:'100%'}}><div className="empty"><span className="empty__icon">📖</span><span>Loading order book...</span></div></div>;

    const maxCum = Math.max(book.asks[book.asks.length-1]?.cumulative || 0, book.bids[book.bids.length-1]?.cumulative || 0);
    const rows = 12;
    const asks = book.asks.slice(0, rows).reverse();
    const bids = book.bids.slice(0, rows);
    const spread = book.spread;
    const isUp = lastPrice >= prevPrice;

    const renderRow = (r, side, i) => {
      const depthPct = (r.cumulative / maxCum) * 100;
      return (
        <div key={side + '-' + i + '-' + r.price} className={`ob-row ob-row--${side}`} onClick={() => onClickPrice && onClickPrice(r.price)} title={`Click to fill price ${r.price}`}>
          <div className="ob-row__depth" style={{width: `${depthPct}%`}}/>
          <span className="ob-row__price">{fmtPrice(r.price, tick)}</span>
          <span className="ob-row__amt">{r.amount.toFixed(3)}</span>
          <span className="ob-row__total">{r.cumulative.toFixed(2)}</span>
        </div>
      );
    };

    return (
      <div className="panel" style={{height:'100%'}}>
        <div className="panel__header">
          <div className="panel__title"><I.Book size={14}/><span>{t('order_book')}</span></div>
          <div className="panel__actions">
            <button className="btn btn--icon"><I.Cog size={12}/></button>
          </div>
        </div>
        <div className="panel__body" style={{padding: 0}}>
          <div className="ob-head">
            <span>Price</span>
            <span>{display === 'cumulative' ? 'Cum' : 'Size'}</span>
            <span>Total</span>
          </div>
          <div className="ob-rows">
            {(mode !== 'buy') && asks.map((r, i) => renderRow(r, 'ask', i))}
          </div>
          <div className="ob-mid">
            <div className="ob-mid__last">
              <span className={isUp ? 't-long' : 't-short'}>{isUp ? '▲' : '▼'} {fmtPrice(lastPrice, tick)}</span>
            </div>
            <div className="ob-mid__spread">Spread {fmtPrice(spread, tick)} · {((spread/lastPrice)*100).toFixed(3)}%</div>
          </div>
          <div className="ob-rows">
            {(mode !== 'sell') && bids.map((r, i) => renderRow(r, 'bid', i))}
          </div>
          <div className="ob-controls">
            <div style={{display:'inline-flex', alignItems:'center', gap: 6}}>
              <select value={precision} onChange={e => setPrecision(parseFloat(e.target.value))} className="input" style={{height:22, padding:'0 6px', fontSize: 11, width: 60}}>
                <option value="0.01">0.01</option>
                <option value="0.1">0.1</option>
                <option value="1">1</option>
                <option value="10">10</option>
              </select>
              <button className="btn btn--icon" onClick={() => setDisplay(display === 'amount' ? 'cumulative' : 'amount')} title={display}>
                <I.Layers size={12}/>
              </button>
            </div>
            <div className="ob-side-toggle">
              <button className={`ob-side-btn ${mode==='both'?'is-active':''}`} onClick={() => setMode('both')} title="Both">
                <div style={{display:'flex', flexDirection:'column', gap: 1}}>
                  <span style={{width:8, height:2, background:'var(--color-trade-short)'}}/>
                  <span style={{width:8, height:2, background:'var(--color-trade-long)'}}/>
                </div>
              </button>
              <button className={`ob-side-btn ${mode==='buy'?'is-active':''}`} onClick={() => setMode('buy')} title="Bids only">
                <span style={{width:8, height:2, background:'var(--color-trade-long)'}}/>
              </button>
              <button className={`ob-side-btn ${mode==='sell'?'is-active':''}`} onClick={() => setMode('sell')} title="Asks only">
                <span style={{width:8, height:2, background:'var(--color-trade-short)'}}/>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RECENT TRADES
  // ============================================================
  window.RecentTrades = function RecentTrades({ trades, t }) {
    return (
      <div className="panel" style={{height:'100%'}}>
        <div className="panel__header">
          <div className="panel__title"><I.Zap size={14}/><span>{t('recent_trades')}</span></div>
          <div className="panel__actions"><button className="btn btn--icon"><I.More size={12}/></button></div>
        </div>
        <div className="panel__body" style={{padding: 0}}>
          <div className="rt-head">
            <span>Price</span><span>Size</span><span>Time</span>
          </div>
          <div style={{flex:1, overflowY: 'auto'}}>
            {trades.slice(0, 60).map((tr, i) => (
              <div key={i} className="rt-row">
                <div className={`rt-row__price ${tr.side === 'buy' ? 'is-buy' : 'is-sell'}`}>
                  {tr.side === 'buy' ? '▲' : '▼'} {fmtPrice(tr.price, tr.symbol)}
                </div>
                <div className="rt-row__amt">{tr.amount.toFixed(3)}</div>
                <div className="rt-row__time">{new Date(tr.time).toLocaleTimeString('en-GB', {hour12:false}).slice(0, 8)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // ORDER ENTRY
  // ============================================================
  window.OrderEntry = function OrderEntry({
    lastPrice, market, assets, marginMode, leverage, prefillPrice, prefillSize, prefillSide, tpsl, onPlaceOrder, isBeginner, t
  }) {
    const [side, setSide] = useState(prefillSide || 'long'); // long | short
    const [orderType, setOrderType] = useState('limit');
    const symbolKey = market ? market.base + market.quote : '';
    const [price, setPrice] = useState(prefillPrice || String(lastPrice));
    // 심볼이 바뀌면 가격 입력값을 새 심볼의 현재가로 되돌린다.
    // 그러지 않으면 ETH 화면에 BTC 가격(68,432)이 남아 잘못된 주문을 유발한다.
    // 심볼 전환 직후에는 lastPrice 가 아직 이전 심볼 값일 수 있다(상태 갱신 순서).
    // 그래서 "동기화 필요" 플래그를 세우고, 새 심볼의 가격이 실제로 들어온
    // 시점에 한 번만 반영한다.
    const prevSymbolRef = useRef(symbolKey);
    // 마운트 시점의 lastPrice 는 아직 목업 시드(예: 68432.5)일 수 있다.
    // 그래서 처음부터 동기화 대기 상태로 두고, 첫 실가격이 들어오면 한 번 맞춘다.
    const needsPriceSyncRef = useRef(true);
    const syncBaseRef = useRef(lastPrice);
    useEffect(() => {
      if (prevSymbolRef.current === symbolKey) return;
      prevSymbolRef.current = symbolKey;
      needsPriceSyncRef.current = true;
      syncBaseRef.current = lastPrice;
    }, [symbolKey, lastPrice]);
    useEffect(() => {
      if (!needsPriceSyncRef.current || !(lastPrice > 0)) return;
      // 이전 심볼 가격 그대로면 아직 새 심볼 시세가 도착하지 않은 것이다.
      if (lastPrice === syncBaseRef.current) return;
      needsPriceSyncRef.current = false;
      setPrice(String(lastPrice));
    }, [lastPrice]);
    const [size, setSize] = useState(prefillSize || '0.05');
    const [pct, setPct] = useState(25);
    const [reduceOnly, setReduceOnly] = useState(false);
    const [postOnly, setPostOnly] = useState(false);
    const [tif, setTif] = useState('GTC');
    const [enableTpsl, setEnableTpsl] = useState(!!tpsl);

    // Re-sync when parent prefill changes
    useEffect(() => {
      if (prefillPrice == null) return;
      // 오더북 클릭 / AI 주문 초안으로 채운 값은 시세 동기화가 덮어쓰지 않게 한다.
      needsPriceSyncRef.current = false;
      setPrice(String(prefillPrice));
    }, [prefillPrice]);
    useEffect(() => { if (prefillSize != null) setSize(String(prefillSize)); }, [prefillSize]);
    useEffect(() => { if (prefillSide != null) setSide(prefillSide); }, [prefillSide]);
    useEffect(() => { if (tpsl) setEnableTpsl(true); }, [tpsl]);

    const px = parseFloat(price) || lastPrice;
    const sz = parseFloat(size) || 0;
    const totalUSDT = px * sz;
    const fee = totalUSDT * 0.0004;
    const requiredMargin = totalUSDT / leverage;
    const availAfter = assets.availableBalance - requiredMargin;
    const estLiq = side === 'long' ? px * (1 - 0.92 / leverage) : px * (1 + 0.92 / leverage);
    const priceDev = ((px - lastPrice) / lastPrice) * 100;

    const errors = [];
    if (sz <= 0) errors.push({ level: 'warn', text: t('oe_err_no_size') });
    if (totalUSDT < 5) errors.push({ level: 'warn', text: t('oe_err_min_notional') });
    if (requiredMargin > assets.availableBalance) errors.push({ level: 'danger', text: t('oe_err_insufficient', { amount: fmt(requiredMargin - assets.availableBalance) }) });
    if (Math.abs(priceDev) > 3) errors.push({ level: 'warn', text: t('oe_err_price_dev', { pct: `${priceDev >= 0 ? '+' : ''}${priceDev.toFixed(2)}` }) });
    if (leverage > 50) errors.push({ level: 'warn', text: t('oe_err_high_leverage', { lev: leverage }) });

    return (
      <div className="panel" style={{height:'100%'}}>
        <div className="panel__header">
          <div className="panel__title"><I.Wallet size={14}/><span>{t('order_entry')}</span></div>
          <div className="panel__actions"><button className="btn btn--icon" title="Calculator"><I.More size={12}/></button></div>
        </div>

        <div className="panel__body" style={{padding: 0}}>
          <div className="oe-margin">
            <div className="oe-margin__group">
              <div className="seg">
                <button className={`seg__opt ${marginMode==='CROSS'?'is-active':''}`}>{t('cross')}</button>
                <button className={`seg__opt ${marginMode==='ISOLATED'?'is-active':''}`}>{t('isolated')}</button>
              </div>
            </div>
            <div className="oe-margin__group">
              <span className="oe-lev">{leverage}×</span>
            </div>
          </div>

          <div className="oe-tabs">
            <button className={`oe-tab ${orderType==='limit'?'is-active':''}`} onClick={() => setOrderType('limit')}>{t('limit')}</button>
            <button className={`oe-tab ${orderType==='market'?'is-active':''}`} onClick={() => setOrderType('market')}>{t('market')}</button>
            <button className={`oe-tab ${orderType==='trigger'?'is-active':''}`} onClick={() => setOrderType('trigger')}>{t('trigger')}</button>
            {!isBeginner && <button className="oe-tab" title={t('oe_more_types')}>{t('advanced')} ▾</button>}
          </div>

          <div className="oe-body">
            {isBeginner && (
              <div className="beg-tip">
                <I.Info size={14}/>
                <div>
                  {t('oe_limit_help_a')}<strong>{t('oe_limit_help_em')}</strong>{t('oe_limit_help_b')}
                </div>
              </div>
            )}

            <div className="oe-balance">
              <span>{t('available')}</span>
              <span><strong>{fmt(assets.availableBalance)}</strong> USDT</span>
            </div>

            {orderType !== 'market' && (
              <div className="input-group">
                <span className="input-group__label">Price</span>
                <input type="text" value={price} onChange={e => { needsPriceSyncRef.current = false; setPrice(e.target.value); }} />
                <span className="input-group__suffix">USDT</span>
              </div>
            )}
            {orderType === 'trigger' && (
              <div className="input-group">
                <span className="input-group__label">Trigger</span>
                <input type="text" defaultValue={(lastPrice * 0.99).toFixed(1)} />
                <span className="input-group__suffix">Last ≤</span>
              </div>
            )}
            <div className="input-group">
              <span className="input-group__label">Size</span>
              <input type="text" value={size} onChange={e => setSize(e.target.value)} />
              <span className="input-group__suffix">{market.base}</span>
            </div>

            <div>
              <div className="pct-slider">
                <div className="pct-slider__track"/>
                <div className="pct-slider__fill" style={{width: `${pct}%`}}/>
                <div className="pct-slider__stops">
                  {[0, 25, 50, 75, 100].map(v => (
                    <button key={v}
                      className={`pct-slider__stop ${pct === v ? 'is-active' : ''}`}
                      onClick={() => {
                        setPct(v);
                        const newSize = (assets.availableBalance * leverage * (v/100)) / px;
                        setSize(newSize.toFixed(4));
                      }}
                      title={`${v}%`}
                    />
                  ))}
                </div>
              </div>
              <div className="pct-slider__labels">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>

            <div style={{display:'flex', gap:12, flexWrap:'wrap', fontSize: 12}}>
              <label className="chk">
                <input type="checkbox" checked={reduceOnly} onChange={e => setReduceOnly(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                Reduce Only
              </label>
              <label className="chk">
                <input type="checkbox" checked={postOnly} onChange={e => setPostOnly(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                Post Only
              </label>
              <label className="chk">
                <input type="checkbox" checked={enableTpsl} onChange={e => setEnableTpsl(e.target.checked)}/>
                <span className="chk__box"><I.Check size={10}/></span>
                TP/SL
              </label>
            </div>

            {enableTpsl && (
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 6}}>
                <div className="input-group">
                  <span className="input-group__label">TP</span>
                  <input type="text" defaultValue={tpsl?.tp?.[0] ? tpsl.tp[0].toFixed(1) : (px * 1.02).toFixed(1)} />
                </div>
                <div className="input-group">
                  <span className="input-group__label">SL</span>
                  <input type="text" defaultValue={tpsl?.sl ? tpsl.sl.toFixed(1) : (px * 0.98).toFixed(1)}/>
                </div>
              </div>
            )}

            {!isBeginner && (
              <div style={{display:'flex', gap: 6}}>
                {['GTC','IOC','FOK'].map(v => (
                  <button key={v} className={`btn btn--xs ${tif===v?'btn--primary':''}`} onClick={() => setTif(v)}>{v}</button>
                ))}
              </div>
            )}

            <div className="oe-summary">
              <div className="oe-summary__row"><span>Order Value</span><strong>{fmt(totalUSDT)} USDT</strong></div>
              <div className="oe-summary__row"><span>Required Margin</span><strong>{fmt(requiredMargin)} USDT</strong></div>
              <div className="oe-summary__row"><span>Est. Fee (0.04%)</span><strong>{fmt(fee, 4)} USDT</strong></div>
              <div className="oe-summary__row"><span>Est. Liq. Price</span><strong className="t-warning">{fmt(estLiq, 1)}</strong></div>
              <div className="oe-summary__row"><span>Avail. After Order</span><strong>{fmt(availAfter)} USDT</strong></div>
            </div>

            {errors.map((err, i) => (
              <div key={i} className={`oe-warn ${err.level==='danger'?'oe-warn--danger':''}`}>
                <span className="oe-warn__icon"><I.Alert size={12}/></span>
                <span>{err.text}</span>
              </div>
            ))}

            <div className="oe-buttons">
              <button
                className={`btn btn--long btn--lg ${side!=='long' ? 'btn--outline' : ''}`}
                style={side !== 'long' ? { background: 'var(--color-trade-long-bg)', color:'var(--color-trade-long)', border:'1px solid var(--color-trade-long)'} : undefined}
                onClick={() => {
                  setSide('long');
                  if (onPlaceOrder) onPlaceOrder({ side: 'long', type: orderType, price: px, size: sz, totalUSDT, fee, requiredMargin, estLiq, tif, reduceOnly, postOnly, tpsl: enableTpsl ? { tp: tpsl?.tp || [(px*1.02)], sl: tpsl?.sl || (px*0.98) } : null, hasErrors: errors.some(e => e.level === 'danger') });
                }}
              >
                ▲ {t('buy_long')}
              </button>
              <button
                className={`btn btn--short btn--lg ${side!=='short' ? 'btn--outline' : ''}`}
                style={side !== 'short' ? { background: 'var(--color-trade-short-bg)', color:'var(--color-trade-short)', border:'1px solid var(--color-trade-short)'} : undefined}
                onClick={() => {
                  setSide('short');
                  if (onPlaceOrder) onPlaceOrder({ side: 'short', type: orderType, price: px, size: sz, totalUSDT, fee, requiredMargin, estLiq, tif, reduceOnly, postOnly, tpsl: enableTpsl ? { tp: tpsl?.tp || [(px*0.98)], sl: tpsl?.sl || (px*1.02) } : null, hasErrors: errors.some(e => e.level === 'danger') });
                }}
              >
                ▼ {t('sell_short')}
              </button>
            </div>

            {!isBeginner && (
              <button className="oe-adv-btn">
                <span>Advanced Order (Stop-Limit / Trailing / OCO / Iceberg / TWAP)</span>
                <I.ChevronRight size={12}/>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // POSITIONS & ORDERS
  // ============================================================
  window.PositionsPanel = function PositionsPanel({ lastPrice, positions, orders, onClose, t }) {
    const [tab, setTab] = useState('positions');
    return (
      <div className="panel" style={{height:'100%'}}>
        <div className="pos-tabs">
          <button className={`tab ${tab==='positions'?'is-active':''}`} onClick={() => setTab('positions')}>{t('positions')} <span className="tab__count">{positions.length}</span></button>
          <button className={`tab ${tab==='orders'?'is-active':''}`} onClick={() => setTab('orders')}>{t('open_orders')} <span className="tab__count">{orders.length}</span></button>
          <button className={`tab ${tab==='history'?'is-active':''}`} onClick={() => setTab('history')}>{t('order_history')}</button>
          <button className={`tab ${tab==='trades'?'is-active':''}`} onClick={() => setTab('trades')}>{t('trade_history')}</button>
          <button className={`tab ${tab==='tx'?'is-active':''}`} onClick={() => setTab('tx')}>{t('transaction_history')}</button>
          <button className={`tab ${tab==='signals'?'is-active':''}`} onClick={() => setTab('signals')}><span style={{color:'var(--color-ai)'}}>✦</span> {t('ai_signals')} <span className="tab__count">2</span></button>
          <div className="pos-tabs__right">
            <label className="chk" style={{whiteSpace:'nowrap'}}><input type="checkbox"/><span className="chk__box"><I.Check size={10}/></span>{t('symbol_only')}</label>
            <button className="btn btn--xs btn--danger" style={{whiteSpace:'nowrap'}}>{t('close_all')}</button>
          </div>
        </div>

        <div className="pos-body">
          {tab === 'positions' && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Entry</th>
                  <th>Mark</th>
                  <th>Liq. Price</th>
                  <th>Margin</th>
                  <th>PnL (ROE)</th>
                  <th>TP / SL</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => {
                  // 화면의 lastPrice 는 "현재 보고 있는 심볼"의 가격이다.
                  // 포지션 손익은 해당 포지션 심볼의 가격으로 계산해야 한다.
                  const mark = markPriceFor(p.symbol, lastPrice);
                  const pnl = p.side === 'long' ? (mark - p.entry) * p.size : (p.entry - mark) * p.size;
                  const roe = (pnl / p.margin) * 100;
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{display:'flex', alignItems:'center', gap: 6}}>
                          <strong>{p.symbol.replace('USDT', '/USDT')}</strong>
                          <span className="badge badge--perp" style={{fontSize:9, padding:'0 4px'}}>{p.type}</span>
                          <span className="badge badge--neutral" style={{fontSize:9, padding:'0 4px'}}>{p.mode}</span>
                          <span className="badge badge--neutral" style={{fontSize:9, padding:'0 4px'}}>{p.leverage}×</span>
                        </div>
                      </td>
                      <td>
                        <span className={`pos-side ${p.side === 'long' ? 't-long' : 't-short'}`}>
                          {p.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                        </span>
                      </td>
                      <td>{fmtQty(p.size, 3)}</td>
                      <td>{fmt(p.entry, 1)}</td>
                      <td>{fmtPrice(mark, p.symbol)}</td>
                      <td className="t-warning">{fmt(p.liq, 1)}</td>
                      <td>{fmt(p.margin)}</td>
                      <td>
                        <div className="pos-pnl-cell">
                          <span className={pnl >= 0 ? 't-long' : 't-short'}>{pnl >= 0 ? '+' : ''}{fmt(pnl)} USDT</span>
                          <span style={{fontSize: 10, color:'var(--color-text-tertiary)'}} className={roe >= 0 ? 't-long' : 't-short'}>{roe >= 0 ? '+' : ''}{fmt(roe)}%</span>
                        </div>
                      </td>
                      <td style={{color:'var(--color-text-secondary)'}}>
                        <span className="t-long">{fmt(p.tp, 0)}</span> / <span className="t-short">{fmt(p.sl, 0)}</span>
                      </td>
                      <td>
                        <div className="pos-actions">
                          <button className="btn btn--xs">TP/SL</button>
                          <button className="btn btn--xs">Margin</button>
                          <button className="btn btn--xs btn--danger" onClick={() => onClose && onClose(p.id)}>Close</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {tab === 'orders' && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side / Type</th>
                  <th>Price</th>
                  <th>Amount</th>
                  <th>Filled</th>
                  <th>Trigger</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td><strong>{o.symbol.replace('USDT', '/USDT')}</strong></td>
                    <td>
                      <span className={`pos-side ${o.side==='long'?'t-long':'t-short'}`}>{o.side==='long'?'▲ LONG':'▼ SHORT'}</span>
                      <span style={{color:'var(--color-text-tertiary)', marginLeft: 6, fontSize:11}}>{o.type}</span>
                    </td>
                    <td>{fmtPrice(o.price, o.symbol)}</td>
                    <td>{fmtQty(o.amount, 3)}</td>
                    <td>{fmtQty(o.filled, 3)}</td>
                    <td style={{color:'var(--color-text-tertiary)'}}>{o.trigger || '—'}</td>
                    <td style={{color:'var(--color-text-tertiary)', fontSize:11}}>{timeAgo(o.time)} ago</td>
                    <td>
                      <span className={`badge ${o.status==='partial'?'badge--warning':'badge--neutral'}`}>{o.status}</span>
                    </td>
                    <td><button className="btn btn--xs btn--danger">Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'signals' && (
            <div style={{padding:'12px 16px', display:'flex', flexDirection:'column', gap: 8, fontSize: 12}}>
              <div style={{display:'flex', alignItems:'center', gap: 8}}>
                <span className="badge badge--draft">AI DRAFT</span>
                <strong>BTC/USDT · Long · 15m</strong>
                <span style={{color:'var(--color-text-tertiary)'}}>Entry 68,120–68,360 · SL 67,480 · TP 68,980 / 69,640 / 70,420</span>
                <span style={{marginLeft:'auto'}}>Confidence <strong className="t-ai">74%</strong></span>
                <button className="btn btn--xs btn--primary">Approve</button>
                <button className="btn btn--xs">Edit</button>
                <button className="btn btn--xs">Reject</button>
              </div>
              <div style={{display:'flex', alignItems:'center', gap: 8, color:'var(--color-text-tertiary)'}}>
                <span className="badge badge--approved">APPROVED</span>
                <strong style={{color:'var(--color-text-primary)'}}>ETH/USDT · Short · 4H</strong>
                <span>Entry 3,560 · SL 3,624 · TP 3,420</span>
                <span style={{marginLeft:'auto'}}>Confidence <strong style={{color:'var(--color-signal-approved)'}}>68%</strong></span>
                <button className="btn btn--xs">Create Order</button>
              </div>
            </div>
          )}

          {(tab === 'history' || tab === 'trades' || tab === 'tx') && (
            <div className="empty">
              <span className="empty__icon">◇</span>
              <span>No {tab === 'history' ? 'order history' : tab === 'trades' ? 'trades' : 'transactions'} in the selected range</span>
              <button className="btn btn--sm btn--ghost">Change filter</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================================
  // ASSETS / RISK PANEL
  // ============================================================
  window.AssetsRisk = function AssetsRisk({ assets, t }) {
    const marginPct = assets.marginRatio * 100;
    return (
      <div className="panel" style={{height:'100%'}}>
        <div className="panel__header">
          <div className="panel__title"><I.Wallet size={14}/><span>{t('assets_risk')}</span></div>
          <div className="panel__actions"><button className="btn btn--xs">Transfer</button></div>
        </div>
        <div className="panel__body" style={{padding: '12px 16px', gap: 12}}>
          <div style={{display:'flex', flexDirection:'column', gap: 2}}>
            <span style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>Equity (USDT)</span>
            <span style={{fontFamily:'var(--font-num)', fontSize: 22, fontWeight: 600, fontVariantNumeric:'tabular-nums'}}>{fmt(assets.equity)}</span>
            <span style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>
              Unrealized: <span className="t-long">+{fmt(assets.unrealizedPnl)}</span>
            </span>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, fontSize: 11}}>
            <div>
              <div style={{color:'var(--color-text-tertiary)'}}>Available</div>
              <div style={{fontFamily:'var(--font-num)', fontWeight: 500, fontVariantNumeric:'tabular-nums'}}>{fmt(assets.availableBalance)}</div>
            </div>
            <div>
              <div style={{color:'var(--color-text-tertiary)'}}>Wallet</div>
              <div style={{fontFamily:'var(--font-num)', fontWeight: 500, fontVariantNumeric:'tabular-nums'}}>{fmt(assets.walletBalance)}</div>
            </div>
            <div>
              <div style={{color:'var(--color-text-tertiary)'}}>Used Margin</div>
              <div style={{fontFamily:'var(--font-num)', fontWeight: 500, fontVariantNumeric:'tabular-nums'}}>{fmt(assets.usedMargin)}</div>
            </div>
            <div>
              <div style={{color:'var(--color-text-tertiary)'}}>Maint. Margin</div>
              <div style={{fontFamily:'var(--font-num)', fontWeight: 500, fontVariantNumeric:'tabular-nums'}}>{fmt(assets.maintenanceMargin)}</div>
            </div>
          </div>

          <div>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom: 4}}>
              <span style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>Margin Ratio</span>
              <span style={{fontSize: 11, fontFamily:'var(--font-num)', fontVariantNumeric:'tabular-nums'}} className={marginPct > 60 ? 't-warning' : ''}>{marginPct.toFixed(2)}%</span>
            </div>
            <div style={{height: 6, background:'var(--color-bg-input)', borderRadius: 999, overflow:'hidden'}}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, marginPct)}%`,
                background: marginPct > 80 ? 'var(--color-danger)' : marginPct > 60 ? 'var(--color-warning)' : 'var(--color-success)',
                transition: 'width 300ms ease'
              }}/>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', marginTop: 4}}>
              <span style={{fontSize: 10, color:'var(--color-text-tertiary)'}}>Safe</span>
              <span style={{fontSize: 10, color:'var(--color-text-tertiary)'}}>Liquidation</span>
            </div>
          </div>

          <div style={{display:'flex', gap: 6}}>
            <button className="btn btn--sm" style={{flex:1}}>Add Margin</button>
            <button className="btn btn--sm" style={{flex:1}}>Calculator</button>
          </div>

          <div style={{fontSize: 10, color:'var(--color-text-tertiary)', borderTop:'1px solid var(--color-border-subtle)', paddingTop: 8, display:'flex', justifyContent:'space-between'}}>
            <span>PnL Basis</span>
            <div className="seg">
              <button className="seg__opt is-active" style={{height:18, padding:'0 6px', fontSize:10}}>Mark</button>
              <button className="seg__opt" style={{height:18, padding:'0 6px', fontSize:10}}>Last</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // MINI CHART (SVG) — for Multi-chart preview
  // ============================================================
  window.MiniChart = function MiniChart({ symbol, timeframe = '15m', height = 200, hideHeader = false }) {
    const candles = useMemo(() => QT.generateCandles({ symbol, tf: timeframe, count: 60, endPrice: 100 }), [symbol, timeframe]);
    const w = 300;
    const h = height;
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const barW = w / candles.length;
    const y = (p) => (hi - p) / (hi - lo) * h;

    return (
      <div className={hideHeader ? '' : 'panel'} style={{height:'100%', ...(hideHeader ? {background:'transparent'} : {})}}>
        {!hideHeader && (
        <div className="panel__header">
          <div className="panel__title" style={{fontSize: 12}}>
            <strong>{symbol}</strong>
            <span style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', fontSize: 10}}>{timeframe}</span>
          </div>
          <div className="panel__actions">
            <button className="btn btn--icon"><I.Expand size={12}/></button>
          </div>
        </div>
        )}
        <div className={hideHeader ? '' : 'panel__body'} style={{padding: 8, position:'relative', height: hideHeader ? '100%' : undefined}}>
          <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{position:'absolute', inset:8, width:'calc(100% - 16px)', height:'calc(100% - 16px)'}}>
            {[0.25,0.5,0.75].map(f => (
              <line key={f} x1="0" x2={w} y1={h*f} y2={h*f} stroke="var(--chart-grid)" strokeDasharray="2 4"/>
            ))}
            {candles.map((c, i) => {
              const isUp = c.close >= c.open;
              const x = i * barW + barW/2;
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={isUp?'var(--chart-candle-up)':'var(--chart-candle-dn)'} strokeWidth="1"/>
                  <rect x={x - barW*0.35} y={Math.min(y(c.open), y(c.close))} width={barW*0.7} height={Math.max(1, Math.abs(y(c.close)-y(c.open)))} fill={isUp?'var(--chart-candle-up)':'var(--chart-candle-dn)'}/>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };
})();
