/* ============================================================
   Tweaks Panel — real-time UI mutation
   Priority per requirements:
   1. 레이아웃 프리셋  2. 밀도  3. Beginner/Pro
   4. Dark/Light  5. Long/Short 색상  6. 브랜드 팔레트
   7. 언어  8. 숫자 포맷
   ============================================================ */

(function () {
  const { useState, useEffect } = React;

  // 번역 조회. 사전(src/locales/*.js)이 단일 출처.
  const _t = (key, vars) => (window.QTI18n ? window.QTI18n.t(key, vars) : key);
  const I = window.Icons;

  const BRAND_PALETTES = [
    { id: 'institutional-cool', name: 'Institutional Cool', chips: ['#0D1520', '#0EA5C4', '#5EEAD4'] },
    { id: 'quantum-violet', name: 'Quantum Violet', chips: ['#120C1F', '#9D5CFF', '#DBB7FF'] },
    { id: 'onyx-emerald', name: 'Onyx Emerald', chips: ['#0A1512', '#10B981', '#6EE7B7'] },
    { id: 'graphite-amber', name: 'Graphite Amber', chips: ['#1A1611', '#F59E0B', '#FCD34D'] },
  ];

  const LONGSHORT_COLORS = [
    { id: 'teal-magenta', name: 'Teal / Magenta', chips: ['#14B8A6', '#EC4899'] },
    { id: 'green-red', name: 'Green / Red', chips: ['#22C55E', '#EF4444'] },
    { id: 'cyan-orange', name: 'Cyan / Orange', chips: ['#06B6D4', '#F97316'] },
    // 롱=빨강, 숏=파랑 (한국 증권사 관행). chips[0]=롱, chips[1]=숏.
    { id: 'red-blue', name: 'Red / Blue', chips: ['#EF4444', '#3B82F6'] },
  ];

  window.TweaksPanel = function TweaksPanel({ tweaks, setTweaks, open, onClose, t }) {
    const [pos, setPos] = useState({ x: null, y: null });
    const [drag, setDrag] = useState(null);

    useEffect(() => {
      if (!drag) return;
      const onMove = (e) => setPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
      const onUp = () => setDrag(null);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [drag]);

    if (!open) return null;

    const style = pos.x != null ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {};

    return (
      <div className="tweaks" style={style}>
        <div
          className="tweaks__header"
          onMouseDown={e => {
            const rect = e.currentTarget.parentElement.getBoundingClientRect();
            setDrag({ dx: e.clientX - rect.left, dy: e.clientY - rect.top });
          }}
        >
          <div className="tweaks__title">
            <I.Cog size={14}/>
            <span>{t('tweaks')}</span>
            <span style={{fontSize: 10, color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', fontWeight: 400, letterSpacing:'0.03em'}}>LIVE</span>
          </div>
          <button aria-label={t('close')} className="btn btn--icon" onClick={onClose} title={t('close')}>
            <I.X size={14}/>
          </button>
        </div>

        <div className="tweaks__body">
          {/* 1. LAYOUT PRESET */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_1_preset')}</div>
            <div className="tw-preset-grid">
              {Object.values(QT.LAYOUT_PRESETS).map(p => (
                <button
                  key={p.id}
                  className={`tw-preset ${tweaks.presetId === p.id ? 'is-active' : ''}`}
                  onClick={() => setTweaks({ presetId: p.id })}
                >
                  <strong>{p.name}</strong>
                  <span className="tw-preset__sub">{p.descKey ? t(p.descKey) : p.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. DENSITY */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_2_density')}</div>
            <div className="seg" style={{width:'100%'}}>
              {['comfortable', 'compact', 'dense'].map(d => (
                <button
                  key={d}
                  className={`seg__opt ${tweaks.density === d ? 'is-active' : ''}`}
                  style={{flex: 1}}
                  onClick={() => setTweaks({ density: d })}
                >
                  {t('tw_density_' + d)}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Beginner / Pro */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_3_mode')}</div>
            <div className="seg" style={{width:'100%'}}>
              <button className={`seg__opt ${!tweaks.pro ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTweaks({ pro: false })}>
                <I.Info size={11}/> {t('tw_mode_beginner')}
              </button>
              <button className={`seg__opt ${tweaks.pro ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTweaks({ pro: true })}>
                <I.Sparkles size={11}/> {t('tw_mode_pro')}
              </button>
            </div>
            <div style={{fontSize: 11, color:'var(--color-text-tertiary)'}}>
              {tweaks.pro
                ? t('tweaks_f9b33a')
                : t('tweaks_e28dd8')}
            </div>
          </div>

          {/* 4. Theme */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_4_theme')}</div>
            <div className="seg" style={{width:'100%'}}>
              <button className={`seg__opt ${tweaks.theme==='dark' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTweaks({ theme: 'dark' })}>
                <I.Moon size={11}/> {t('tw_theme_dark')}
              </button>
              <button className={`seg__opt ${tweaks.theme==='light' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTweaks({ theme: 'light' })}>
                <I.Sun size={11}/> {t('tw_theme_light')}
              </button>
            </div>
          </div>

          {/* 5. Long/Short colors */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_5_longshort')}</div>
            <div style={{display:'flex', flexDirection:'column', gap: 6}}>
              {LONGSHORT_COLORS.map(c => (
                <button
                  key={c.id}
                  className={`tw-preset ${tweaks.longshort === c.id ? 'is-active' : ''}`}
                  style={{display:'flex', flexDirection:'row', alignItems:'center', gap: 10, padding:'6px 10px'}}
                  onClick={() => setTweaks({ longshort: c.id })}
                >
                  <div style={{display:'flex', gap: 4}}>
                    <span style={{width:14, height:14, borderRadius:3, background:c.chips[0]}}/>
                    <span style={{width:14, height:14, borderRadius:3, background:c.chips[1]}}/>
                  </div>
                  <span style={{flex:1, textAlign:'left'}}>{c.name}</span>
                  {tweaks.longshort === c.id && <I.Check size={12}/>}
                </button>
              ))}
            </div>
          </div>

          {/* 6. Brand palette */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_6_brand')}</div>
            <div style={{display:'flex', flexDirection:'column', gap: 6}}>
              {BRAND_PALETTES.map(p => (
                <button
                  key={p.id}
                  className={`tw-preset ${tweaks.brand === p.id ? 'is-active' : ''}`}
                  style={{display:'flex', flexDirection:'row', alignItems:'center', gap: 10, padding:'6px 10px'}}
                  onClick={() => setTweaks({ brand: p.id })}
                >
                  <div style={{display:'flex', gap: 4}}>
                    {p.chips.map((c, i) => <span key={i} style={{width:14, height:14, borderRadius:3, background: c}}/>)}
                  </div>
                  <span style={{flex:1, textAlign:'left'}}>{p.name}</span>
                  {tweaks.brand === p.id && <I.Check size={12}/>}
                </button>
              ))}
            </div>
          </div>

          {/* 7. Language */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_7_language')}</div>
            {/*
               ★★ 원래 한국어·English **두 개만** 하드코딩돼 있었다. 일본어
                 사전을 등록해도 이 패널에서는 고를 수 없었다.
               ★ i18n 레지스트리를 단일 출처로 렌더한다. `src/locales/<code>.js`
                 를 추가하면 여기에 자동으로 나타난다 — 언어를 늘릴 때 이 파일을
                 고칠 필요가 없다.
               ★ 라벨은 각 사전이 등록한 `label`(한국어/English/日本語)을 쓴다.
                 코드(ko/en/ja)만 보여주면 어떤 언어인지 알기 어렵다.
            */}
            <div className="seg" style={{width:'100%', flexWrap:'wrap'}}>
              {(window.QTI18n && window.QTI18n.available ? window.QTI18n.available() : [])
                .map((L) => (
                  <button
                    key={L.code}
                    className={`seg__opt ${tweaks.lang === L.code ? 'is-active' : ''}`}
                    style={{flex:'1 1 auto', minWidth: 72}}
                    onClick={() => setTweaks({ lang: L.code })}
                    title={`${L.label} (${L.code})`}
                  >
                    {L.label}
                  </button>
                ))}
            </div>
          </div>

          {/* 8. Number format */}
          <div className="tw-section">
            <div className="tw-section__title">{t('tw_8_numfmt')}</div>
            <div className="seg" style={{width:'100%'}}>
              <button className={`seg__opt ${tweaks.numFmt==='standard' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTweaks({ numFmt: 'standard' })}>
                {t('tw_numfmt_standard')} <span style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginLeft: 4}}>18,240,000</span>
              </button>
              <button className={`seg__opt ${tweaks.numFmt==='compact' ? 'is-active' : ''}`} style={{flex:1}} onClick={() => setTweaks({ numFmt: 'compact' })}>
                {t('tw_numfmt_compact')} <span style={{color:'var(--color-text-tertiary)', fontFamily:'var(--font-mono)', marginLeft: 4}}>18.24M</span>
              </button>
            </div>
          </div>

          <div style={{fontSize: 10, color:'var(--color-text-tertiary)', textAlign:'center', padding: '8px 0 0', borderTop:'1px solid var(--color-border-subtle)'}}>
            {t('tweaks_da6cbd')}
          </div>
        </div>
      </div>
    );
  };
})();
