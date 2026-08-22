/**
 * 법적 문서 화면 — 이용약관 · 개인정보처리방침 · 위험 고지 · 보안 안내.
 *
 * 왜 별 파일인가
 * ------------
 * 디자이너 화면이 없는 신규 라우트다. 로그인 화면 하단 링크(`#/terms`,
 * `#/privacy`, `#/security`)가 존재하지 않는 라우트를 가리켜 404 였다 —
 * 회원가입에서 동의를 받는데 동의 대상을 볼 수 없는 상태였다.
 *
 * ★ 로그인 없이 열려야 한다. 가입 전에 읽어야 하기 때문이다.
 *   그래서 PageShell(로그인 필요) 대신 자체 레이아웃을 쓴다.
 *
 * ★ 본문을 innerHTML 로 넣지 않는다.
 *   약관 페이지는 로그인 전에도 열리므로, HTML 을 그대로 렌더하면 관리자
 *   계정이 침해될 때 모든 방문자에게 스크립트가 실린다. 마크다운 부분집합만
 *   React 요소로 변환한다.
 */
(function () {
  'use strict';

  const { useState, useEffect } = window.React;
  const t = (k, v) => (window.QTI18n ? window.QTI18n.t(k, v) : k);

  /* 라우트 → 문서 종류. 화면이 종류를 만들지 않고 정해진 것만 요청한다. */
  const KIND_BY_ROUTE = {
    '/terms': 'terms',
    '/privacy': 'privacy',
    '/risk': 'risk',
    '/security': 'security',
  };

  const TITLE_KEY = {
    terms: 'legal_terms',
    privacy: 'legal_privacy',
    risk: 'legal_risk',
    security: 'legal_security',
  };

  /**
   * 마크다운 부분집합 → React 요소.
   *
   * 지원: `# ## ###` 제목 / `- ` 목록 / `1. ` 번호 목록 / 빈 줄 단락 / `**굵게**`
   *
   * ★ 링크 문법을 지원하지 않는다. 지원하면 `javascript:` 스킴을 걸러야 하고,
   *   약관 본문에 링크가 꼭 필요한 경우는 드물다. 지원하지 않는 것이 더 안전하다.
   *
   * ★ 원문에 없는 것을 만들지 않는다 — 알 수 없는 표기는 그냥 글자로 둔다.
   */
  function renderBody(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let list = null;      // 모으고 있는 목록 항목
    let listType = null;  // 'ul' | 'ol'
    let para = [];        // 모으고 있는 단락 줄

    const bold = (s, keyBase) => {
      // **굵게** 만 처리한다. 나머지는 글자 그대로.
      const parts = String(s).split(/(\*\*[^*]+\*\*)/g);
      return parts.map((seg, i) =>
        /^\*\*[^*]+\*\*$/.test(seg)
          ? <strong key={`${keyBase}b${i}`}>{seg.slice(2, -2)}</strong>
          : <span key={`${keyBase}s${i}`}>{seg}</span>,
      );
    };

    const flushPara = () => {
      if (!para.length) return;
      out.push(
        <p key={`p${out.length}`} style={{margin:'0 0 12px', lineHeight:1.9, fontSize:13}}>
          {bold(para.join(' '), `p${out.length}`)}
        </p>,
      );
      para = [];
    };

    const flushList = () => {
      if (!list || !list.length) { list = null; listType = null; return; }
      const Tag = listType === 'ol' ? 'ol' : 'ul';
      out.push(
        <Tag key={`l${out.length}`} style={{margin:'0 0 12px', paddingLeft:22, lineHeight:1.9, fontSize:13}}>
          {list.map((item, i) => <li key={i} style={{marginBottom:4}}>{bold(item, `l${out.length}i${i}`)}</li>)}
        </Tag>,
      );
      list = null; listType = null;
    };

    lines.forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushPara(); flushList(); return; }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        const level = h[1].length;
        const size = level === 1 ? 19 : level === 2 ? 15.5 : 13.5;
        out.push(
          <div key={`h${out.length}`} style={{
            fontSize:size, fontWeight:600, margin:'20px 0 8px',
            color:'var(--color-text-primary)',
          }}>{h[2]}</div>,
        );
        return;
      }

      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (listType !== 'ul') { flushList(); listType = 'ul'; list = []; }
        list.push(ul[1]);
        return;
      }

      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (listType !== 'ol') { flushList(); listType = 'ol'; list = []; }
        list.push(ol[1]);
        return;
      }

      flushList();
      para.push(line.trim());
    });
    flushPara(); flushList();
    return out;
  }

  window.LegalPage = function LegalPage({ route }) {
    const kind = KIND_BY_ROUTE[route && route.path] || 'terms';
    const [doc, setDoc] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      setDoc(null); setFailed(false);
      const api = window.QTApi && window.QTApi.rest;
      if (!api || !api.legal) { setFailed(true); return; }
      api.legal(kind)
        .then((r) => setDoc(r))
        .catch(() => setFailed(true));
    }, [kind]);

    const brand = window.QTI18n ? window.QTI18n.brand() : 'ChartControl AI';
    const available = doc && doc.available;

    return (
      <div style={{
        minHeight:'100vh', background:'var(--color-bg-base)', color:'var(--color-text-primary)',
        display:'flex', flexDirection:'column',
      }}>
        {/* 머리말 — 로그인 상태와 무관하게 보인다. */}
        <div style={{
          borderBottom:'1px solid var(--color-border-subtle)', padding:'14px 20px',
          display:'flex', alignItems:'center', gap:12, flexWrap:'wrap',
        }}>
          <a href="#/" style={{
            fontWeight:600, fontSize:14, textDecoration:'none', color:'var(--color-text-primary)',
          }}>{brand}</a>
          <div style={{display:'flex', gap:10, marginLeft:'auto', fontSize:12, flexWrap:'wrap'}}>
            {/* 문서 사이를 오갈 수 있어야 한다. 하나만 보고 나가면 나머지를 못 찾는다. */}
            {Object.keys(KIND_BY_ROUTE).map((r) => (
              <a key={r} href={'#' + r} style={{
                textDecoration:'none',
                color: KIND_BY_ROUTE[r] === kind ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                fontWeight: KIND_BY_ROUTE[r] === kind ? 600 : 400,
              }}>{t(TITLE_KEY[KIND_BY_ROUTE[r]])}</a>
            ))}
          </div>
        </div>

        <div style={{flex:1, padding:'28px 20px 60px', maxWidth:820, width:'100%', margin:'0 auto'}}>
          {doc === null && !failed ? (
            <div style={{fontSize:13, color:'var(--color-text-tertiary)'}}>{t('legal_loading')}</div>
          ) : available ? (
            <>
              <h1 style={{fontSize:22, fontWeight:650, margin:'0 0 6px'}}>{doc.title}</h1>
              <div style={{fontSize:11.5, color:'var(--color-text-tertiary)', marginBottom:20, display:'flex', gap:12, flexWrap:'wrap'}}>
                <span>{t('legal_version', { v: doc.version })}</span>
                {doc.effectiveAt && <span>{t('legal_effective', { d: new Date(doc.effectiveAt).toLocaleDateString() })}</span>}
              </div>

              {/*
                 요청한 언어로 게시된 문서가 없어 다른 언어로 대체된 경우.

                 ★ 조용히 다른 언어를 보여주면 사용자는 자기 언어 약관이 있다고
                   생각한다. 대체됐다는 사실을 알린다.
              */}
              {doc.locale !== doc.requestedLocale && (
                <div style={{
                  padding:'10px 12px', borderRadius:6, fontSize:12, marginBottom:18,
                  background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
                  color:'var(--color-text-secondary)',
                }}>{t('legal_locale_fallback', { shown: doc.locale })}</div>
              )}

              <div>{renderBody(doc.body)}</div>
            </>
          ) : (
            /*
               아직 게시되지 않았을 때.

               ★★ 없는 약관을 지어내지 않는다.

                 문구를 만들어 채우면 그것이 회사의 법적 약속이 된다. 법무 검토를
                 거치지 않은 문장으로 책임 범위를 정하는 것은 위험하고, 나중에
                 실제 약관과 달라지면 어느 쪽이 유효한지 다툼이 된다.

               ★ 문의처를 함께 보여준다. 물어볼 곳이 없으면 사용자는 그냥 떠난다.
            */
            <div>
              <h1 style={{fontSize:22, fontWeight:650, margin:'0 0 10px'}}>{t(TITLE_KEY[kind])}</h1>
              <div style={{
                padding:'16px 18px', borderRadius:8, fontSize:13, lineHeight:1.9,
                background:'var(--color-bg-surface)', border:'1px solid var(--color-border-subtle)',
                color:'var(--color-text-secondary)',
              }}>
                <div style={{fontWeight:600, marginBottom:6, color:'var(--color-text-primary)'}}>
                  {t('legal_not_published')}
                </div>
                <div>{t('legal_not_published_body')}</div>
                {doc && doc.supportEmail && (
                  <div style={{marginTop:12}}>
                    {t('legal_ask')}{' '}
                    <a href={'mailto:' + doc.supportEmail} style={{color:'var(--color-brand)'}}>{doc.supportEmail}</a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{
          borderTop:'1px solid var(--color-border-subtle)', padding:'14px 20px',
          fontSize:11.5, color:'var(--color-text-tertiary)',
        }}>© {new Date().getFullYear()} {brand}</div>
      </div>
    );
  };
})();
