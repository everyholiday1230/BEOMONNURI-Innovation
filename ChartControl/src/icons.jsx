/* Simple inline SVG icons — stroke-based, inherit currentColor */
(function () {
  const S = ({ children, size = 14, sw = 1.5 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
  const Icons = {
    Search: (p) => <S {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></S>,
    Star: (p) => <S {...p}><path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9L6.7 19.5l1.1-6L3.4 9.3l6-.8L12 3z"/></S>,
    Bell: (p) => <S {...p}><path d="M6 8a6 6 0 1112 0v5l1.5 3h-15L6 13V8z"/><path d="M10 20a2 2 0 004 0"/></S>,
    Cog: (p) => <S {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1A2 2 0 013.4 17l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8L3.2 7a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H8a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1A2 2 0 0120.6 7l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/></S>,
    Grid: (p) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></S>,
    Sun: (p) => <S {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></S>,
    Moon: (p) => <S {...p}><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></S>,
    Sparkles: (p) => <S {...p}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/></S>,
    Send: (p) => <S {...p}><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></S>,
    Wifi: (p) => <S {...p}><path d="M5 12.5a11 11 0 0114 0"/><path d="M8.5 15.5a6 6 0 017 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></S>,
    Down: (p) => <S {...p}><path d="M6 9l6 6 6-6"/></S>,
    Up: (p) => <S {...p}><path d="M6 15l6-6 6 6"/></S>,
    Plus: (p) => <S {...p}><path d="M12 5v14M5 12h14"/></S>,
    Minus: (p) => <S {...p}><path d="M5 12h14"/></S>,
    X: (p) => <S {...p}><path d="M18 6L6 18M6 6l12 12"/></S>,
    Check: (p) => <S {...p}><path d="M20 6L9 17l-5-5"/></S>,
    Info: (p) => <S {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></S>,
    Alert: (p) => <S {...p}><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></S>,
    Eye: (p) => <S {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></S>,
    EyeOff: (p) => <S {...p}><path d="M17.9 17.9A11 11 0 0112 19c-7 0-11-7-11-7a19.8 19.8 0 015.1-5.9M9.9 4.2A11 11 0 0112 4c7 0 11 7 11 7a19.7 19.7 0 01-3.2 4.1M14.1 14.1A3 3 0 019.9 9.9M1 1l22 22"/></S>,
    Lock: (p) => <S {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></S>,
    Unlock: (p) => <S {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0"/></S>,
    Drag: (p) => <S {...p}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></S>,
    Cursor: (p) => <S {...p}><path d="M4 4l7 16 2-7 7-2L4 4z"/></S>,
    Line: (p) => <S {...p}><path d="M4 20L20 4"/></S>,
    Horizontal: (p) => <S {...p}><path d="M3 12h18"/></S>,
    Fib: (p) => <S {...p}><path d="M3 6h18M3 10h18M3 14h18M3 18h18"/></S>,
    LongPos: (p) => <S {...p}><path d="M4 20L20 4M20 4h-6M20 4v6"/></S>,
    ShortPos: (p) => <S {...p}><path d="M4 4L20 20M20 20h-6M20 20v-6"/></S>,
    Measure: (p) => <S {...p}><path d="M3 3l4 4M3 3h4v4"/><path d="M17 17l4 4M17 17v4h4"/><path d="M7 7l10 10"/></S>,
    Text: (p) => <S {...p}><path d="M4 6h16M12 6v14M8 20h8"/></S>,
    Magnet: (p) => <S {...p}><path d="M4 14V6a3 3 0 116 0v8a3 3 0 006 0V6M4 14a3 3 0 006 0M14 14a3 3 0 006 0"/></S>,
    Trash: (p) => <S {...p}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14"/></S>,
    ChevronDown: (p) => <S {...p}><path d="M6 9l6 6 6-6"/></S>,
    ChevronUp: (p) => <S {...p}><path d="M6 15l6-6 6 6"/></S>,
    ChevronLeft: (p) => <S {...p}><path d="M15 6l-6 6 6 6"/></S>,
    ChevronRight: (p) => <S {...p}><path d="M9 6l6 6-6 6"/></S>,
    Refresh: (p) => <S {...p}><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></S>,
    Save: (p) => <S {...p}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></S>,
    Undo: (p) => <S {...p}><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a6 6 0 016 6"/></S>,
    Redo: (p) => <S {...p}><path d="M15 14l4-4-4-4"/><path d="M19 10h-9a6 6 0 00-6 6"/></S>,
    Zap: (p) => <S {...p}><path d="M13 2L4 13h7l-1 9 9-11h-7l1-9z"/></S>,
    Camera: (p) => <S {...p}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></S>,
    Expand: (p) => <S {...p}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></S>,
    Layers: (p) => <S {...p}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></S>,
    Copy: (p) => <S {...p}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></S>,
    More: (p) => <S {...p}><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></S>,
    Share: (p) => <S {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></S>,
    Stop: (p) => <S {...p}><rect x="6" y="6" width="12" height="12" rx="2"/></S>,
    Reset: (p) => <S {...p}><path d="M3 12a9 9 0 109-9v4M3 12l3-3M3 12l3 3"/></S>,
    Filter: (p) => <S {...p}><path d="M22 3H2l8 9v7l4 2v-9l8-9z"/></S>,
    ArrowRight: (p) => <S {...p}><path d="M5 12h14M13 5l7 7-7 7"/></S>,
    Building: (p) => <S {...p}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 12h.01M15 12h.01M9 17h.01M15 17h.01"/></S>,
    Wallet: (p) => <S {...p}><path d="M20 12V7H5a2 2 0 010-4h11v4M20 12V17a2 2 0 01-2 2H5a2 2 0 01-2-2V7"/><path d="M17 12h4v4h-4z"/></S>,
    Chart: (p) => <S {...p}><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></S>,
    Book: (p) => <S {...p}><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></S>,
    User: (p) => <S {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></S>,
    Globe: (p) => <S {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></S>,
    LayoutIcon: (p) => <S {...p}><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="12" y="3" width="9" height="10" rx="1"/><rect x="12" y="15" width="9" height="6" rx="1"/></S>,
  };
  window.Icons = Icons;

  /*
     거래소 브랜드 로고.

     ★ 실제로 연동하는 거래소를 식별하기 위한 명목적 사용이다(그 거래소가
       맞다는 것을 사용자에게 보여준다). 형태는 각 거래소의 공개 브랜드 마크를
       그대로 옮긴 것이다:
         · KuCoin  — simple-icons 의 공식 심볼 경로 (24x24)
         · BitMart — 공식 벡터 로고 (233.91x281)

     ★ 인라인 SVG 다. 외부 요청이 없으므로 오프라인·CSP('self')에서도 뜬다.
       이미지 파일로 두면 CSP img-src 와 경로 관리가 필요하고, 백엔드 없는
       미리보기에서 404 가 난다.

     ★ id 는 거래소 카탈로그의 id 와 같다(kucoin/bitmart). 로고가 없는
       거래소는 null 을 돌려주고, 호출부가 기존 글자 배지로 폴백한다 —
       디자이너 원본 표시를 지우지 않기 위해서다.
  */
  const ExchangeLogos = {
    kucoin: (p) => (
      <svg
        width={p && p.size ? p.size : 20}
        height={p && p.size ? p.size : 20}
        viewBox="0 0 24 24"
        fill={p && p.color ? p.color : 'currentColor'}
        aria-hidden="true"
      >
        <path d="m7.928 11.996 7.122 7.122 4.49-4.49a2.004 2.004 0 0 1 2.865 0 2.004 2.004 0 0 1 0 2.865l-5.918 5.918a2.058 2.058 0 0 1-2.883 0l-8.541-8.542v5.07a2.034 2.034 0 1 1-4.07 0V4.043a2.034 2.034 0 1 1 4.07 0v5.088L13.604.589a2.058 2.058 0 0 1 2.883 0l5.918 5.918c.785.803.785 2.088 0 2.865-.804.785-2.089.785-2.865 0l-4.49-4.49zM15.05 9.96a2.038 2.038 0 0 0-2.053 2.035c0 1.133.902 2.052 2.035 2.052a2.038 2.038 0 0 0 2.053-2.035v-.018a2.07 2.07 0 0 0-2.035-2.034z" />
      </svg>
    ),
    bitmart: (p) => (
      <svg
        width={p && p.size ? p.size : 20}
        height={p && p.size ? p.size : 20}
        viewBox="0 0 233.91 281"
        aria-hidden="true"
      >
        <path d="m202 136.19a84.68 84.68 0 0 0 18.25-52.65c0-47-38.08-83.54-85.06-83.54h-103.29v10.63h101c41.52 0 75.18 32.15 75.18 73.67a74.88 74.88 0 0 1 -14.8 44.81z" fill="#55a49f"/>
        <path d="m190.48 127.39a61.34 61.34 0 0 0 17.61-43.09 61.52 61.52 0 0 0 -61.51-61.52h-87.34v10.64h89.61a50.12 50.12 0 0 1 50.15 50.12 50 50 0 0 1 -17.86 38.36z" fill="#4a8c89"/>
        <path d="m173.63 119.37c14.37-6.28 25.37-19.96 25.37-35.83 0-21.81-20.72-39.49-42.53-39.49h-75.97v6.07h75.19c18 0 35.69 14.63 35.69 32.66 0 14.61-11.58 27-25.57 31.15z" fill="#5aaba5"/>
        <path d="m1.52 270.37h16.71v10.63h-16.71z" fill="#4a8c8a"/>
        <path d="m18.23 249.1h66.83v7.59h-66.83z" fill="#5aaba6"/>
        <path d="m18.23 202.02h71.39v6.08h-71.39z" fill="#4b8f8e"/>
        <path d="m103.29 202.02h45.57v6.08h-45.57z" fill="#7cc6c7"/>
        <path d="m31.9 180.75h24.3v6.08h-24.3z" fill="#5ab5b4"/>
        <path d="m69.87 180.75h78.98v6.08h-78.98z" fill="#428989"/>
        <path d="m95.69 85.06h51.64v6.08h-51.64z" fill="#549391"/>
        <path d="m34.94 44.05h28.86v6.08h-28.86z" fill="#306563"/>
        <path d="m42.53 66.83h106.32v6.08h-106.32z" fill="#64b9b9"/>
        <path d="m15.19 85.06h65.31v6.08h-65.31z" fill="#7fd6d5"/>
        <path d="m33.42 268.85v10.63h115.43c47 0 85.06-36.56 85.06-83.54a85.06 85.06 0 0 0 -85.06-85.06h-74.42v9.12h72.15a75.19 75.19 0 0 1 75.18 75.19c0 41.53-33.66 73.67-75.18 73.67z" fill="#55a49f"/>
        <path d="m51.64 133.66v10.64h110.88a50.12 50.12 0 0 1 50.13 50.12 50.13 50.13 0 0 1 -50.13 50.13h-65.31v12.15h63a61.51 61.51 0 0 0 61.51-61.52 61.52 61.52 0 0 0 -61.51-61.52z" fill="#4a8c89"/>
        <path d="m83.54 156.45v6.07h85.82c18 0 35.69 14.63 35.69 32.66 0 18-17.65 32.66-35.69 32.66h-169.36v7.59h170.12c21.81 0 42.53-17.68 42.53-39.49 0-21.81-20.72-39.49-42.53-39.49z" fill="#5aaba5"/>
      </svg>
    ),
  };
  window.ExchangeLogos = ExchangeLogos;

  /**
   * 거래소 로고가 있으면 그 SVG, 없으면 null.
   * @param {string} id 거래소 id (kucoin/bitmart)
   * @param {object} props { size, color }
   */
  window.exchangeLogo = function exchangeLogo(id, props) {
    const L = ExchangeLogos[String(id || '').toLowerCase()];
    return L ? L(props || {}) : null;
  };
})();
