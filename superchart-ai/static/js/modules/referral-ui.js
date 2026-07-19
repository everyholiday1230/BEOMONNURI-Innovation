/**
 * referral-ui.js — 레퍼럴 시스템 (거래소 벤치마킹)
 * 초대 링크 + 포인트 적립 + 티어 + 대시보드
 */
const API = window.API || '';
const _urlRef = new URLSearchParams(window.location.search).get('ref') || '';

async function _safeFetchJson(url, opts) {
  try {
    const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
    const r = await requester(url, Object.assign({ credentials: 'include' }, opts || {}));
    if (!r || !r.ok) return null;
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (!/application\/json/i.test(ct)) return null;
    return await r.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

// ═══ 회원가입 폼에 추천 코드 입력란 ═══
// 추천 코드는 "회원가입" 모드에서만 노출한다. authTermsRow(약관 동의)가
// 로그인=숨김 / 회원가입=표시 로 토글되므로, 추천 코드 행도 그 표시 상태를
// 따라가도록 동기화한다(로그인 화면에 추천 코드가 뜨던 문제 수정).
const _authObs = new MutationObserver(() => {
  const modal = document.getElementById('authModal');
  if (!modal || modal.offsetHeight <= 0) return;
  if (!modal.querySelector('#authRefCode')) {
    setTimeout(_injectRefCodeInput, 300);
  } else {
    _syncRefCodeVisibility();
  }
});
_authObs.observe(document.body, {attributes: true, subtree: true, attributeFilter: ['style','class']});

function _syncRefCodeVisibility() {
  const refRow = document.getElementById('authRefCodeRow');
  const termsRow = document.getElementById('authTermsRow');
  if (!refRow || !termsRow) return;
  // 약관 동의 행과 동일한 표시 상태(회원가입에서만 보임)로 맞춘다.
  refRow.style.display = (termsRow.style.display === 'none') ? 'none' : '';
}

function _injectRefCodeInput() {
  const modal = document.getElementById('authModal');
  if (!modal || modal.querySelector('#authRefCode')) return;
  const termsRow = document.getElementById('authTermsRow');
  if (!termsRow) return;
  const refRow = document.createElement('div');
  refRow.id = 'authRefCodeRow';
  refRow.style.cssText = 'margin-bottom:8px';
  refRow.innerHTML = `<input id="authRefCode" placeholder="추천 코드 입력 (선택)" value="${_urlRef}" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px">`;
  termsRow.parentNode.insertBefore(refRow, termsRow);
  // 초기 표시 상태를 약관 행과 동일하게(로그인 모드면 숨김)
  _syncRefCodeVisibility();
  if (_urlRef) {
    const signupTab = document.getElementById('authTabSignup');
    if (signupTab) signupTab.click();
  }
}

// ═══ 설정 모달에 레퍼럴 대시보드 삽입 ═══
const _settingsObs = new MutationObserver(() => {
  const modal = document.getElementById('settingsModal');
  if (!modal || modal.offsetHeight <= 0) return;
  const dash = modal.querySelector('#referralDashboard');
  if (!dash || dash.dataset.filled !== '1') {
    setTimeout(_injectReferralDashboard, 300);
  }
});
_settingsObs.observe(document.body, {attributes: true, subtree: true, attributeFilter: ['style','class']});

async function _injectReferralDashboard() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  if (!window.isLoggedIn || !window.isLoggedIn()) return;
  // _showSettings가 만든 '로딩 중' placeholder(같은 id)를 실제 대시보드로 교체.
  // 이미 채워진 대시보드(_filled)면 중복 주입 방지.
  const _existing = modal.querySelector('#referralDashboard');
  if (_existing) {
    if (_existing.dataset.filled === '1') return;
    _existing.remove();
  }
  if (_injectReferralDashboard._busy) return;
  _injectReferralDashboard._busy = true;
  try {

  let code = '', points = 0, referrals = 0, tier = 'bronze', totalEarned = 0;
  try {
    const d1 = await _safeFetchJson(`${API}/v1/referral/my-code`);
    if (d1?.success && d1?.data) {
      code = d1.data.code;
      tier = d1.data.tier || 'bronze';
      totalEarned = d1.data.total_earned || 0;
    }
    const d2 = await _safeFetchJson(`${API}/v1/referral/points`);
    if (d2?.success && d2?.data) { points = d2.data.points; referrals = d2.data.referrals; window._refPaidCount = d2.data.paid_referrals || 0; }
  } catch(e) {}

  const inviteLink = `${window.location.origin}?ref=${code}`;
  const tierColors = {bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', diamond:'#B9F2FF'};
  const tierNames = {bronze:'Bronze', silver:'Silver', gold:'Gold', diamond:'Diamond'};
  const nextTier = {bronze:{name:'Silver',need:5}, silver:{name:'Gold',need:20}, gold:{name:'Diamond',need:50}, diamond:{name:'Max',need:0}};
  const nt = nextTier[tier] || {name:'',need:0};

  // 모달 내 기존 #referralDashboard(플레이스홀더 또는 이전 주입분)를 모두 제거해 중복 방지.
  // 첫 번째 플레이스홀더 위치를 기억해 그 자리에 새 대시보드를 넣는다.
  const _dupes = modal.querySelectorAll('#referralDashboard');
  let _anchor = null, _anchorParent = null;
  _dupes.forEach((el, idx) => {
    if (idx === 0) { _anchor = el.nextSibling; _anchorParent = el.parentNode; }
    el.remove();
  });
  const inner = _anchorParent || modal.querySelector('div > div') || modal;
  const section = document.createElement('div');
  section.id = 'referralDashboard';
  section.dataset.filled = '1';
  section.style.cssText = 'border-top:1px solid var(--border);padding-top:16px;margin-top:16px';
  section.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:16px;font-weight:700;color:var(--gold-text)">친구 초대</span>
      <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${tierColors[tier]}22;color:${tierColors[tier]};border:1px solid ${tierColors[tier]}55">${tierNames[tier]}</span>
    </div>

    <div style="background:linear-gradient(135deg,#D8B66A11,#92123011);border:1px solid #D8B66A33;border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">내 초대 링크</div>
      <div style="display:flex;gap:6px">
        <input id="refLinkInput" value="${inviteLink}" readonly style="flex:1;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text)">
        <button onclick="navigator.clipboard.writeText('${inviteLink}');this.textContent='✓';setTimeout(()=>this.textContent='복사',1000)" style="padding:8px 14px;background:#D8B66A;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">복사</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <div style="flex:1;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;text-align:center">
          <div style="font-size:11px;color:var(--muted)">내 코드</div>
          <div style="font-size:14px;font-weight:700;color:var(--gold-text);letter-spacing:1px">${code}</div>
        </div>
        <button onclick="navigator.clipboard.writeText('${code}');window.showToast&&showToast('코드 복사됨','#D8B66A')" style="padding:6px 12px;background:none;border:1px solid #D8B66A;color:var(--gold-text);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">코드 복사</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px">
      <div style="text-align:center;padding:10px 4px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:18px;font-weight:700;color:var(--text)">${referrals}</div>
        <div style="font-size:10px;color:var(--muted)">초대한 친구</div>
      </div>
      <div style="text-align:center;padding:10px 4px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:18px;font-weight:700;color:var(--gold-text)">${(window._refPaidCount??0)}</div>
        <div style="font-size:10px;color:var(--muted)">유료 전환</div>
      </div>
      <div style="text-align:center;padding:10px 4px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:18px;font-weight:700;color:#22A16B">${totalEarned.toLocaleString()}P</div>
        <div style="font-size:10px;color:var(--muted)">총 수익</div>
      </div>
      <div style="text-align:center;padding:10px 4px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:18px;font-weight:700;color:var(--text)">${points.toLocaleString()}P</div>
        <div style="font-size:10px;color:var(--muted)">잔여 포인트</div>
      </div>
    </div>

    <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;margin-bottom:6px">티어</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.6">
        <div style="display:flex;justify-content:space-between"><span>Bronze</span><span>0~4명</span></div>
        <div style="display:flex;justify-content:space-between"><span>Silver</span><span>5~19명</span></div>
        <div style="display:flex;justify-content:space-between"><span>Gold</span><span>20~49명</span></div>
        <div style="display:flex;justify-content:space-between"><span>Diamond</span><span>50명+</span></div>
      </div>
      ${nt.need > 0 ? `<div style="margin-top:6px;font-size:11px;color:var(--gold-text)">다음 티어(${nt.name})까지 ${nt.need - referrals}명 남음</div>` : ''}
    </div>

    <div style="font-size:11px;color:var(--muted);line-height:1.5">
      • 친구가 추천 코드로 가입하면 <b>포인트</b>가 적립됩니다<br>
      • 친구가 유료 전환하면 추가 포인트가 적립됩니다<br>
      • 적립 포인트는 서비스 내 혜택에 사용됩니다
    </div>
  `;
  if (_anchor && _anchor.parentNode === inner) inner.insertBefore(section, _anchor);
  else inner.appendChild(section);

  // ── 프리미엄 지표 스토어 ──
  try {
    const pr = await _safeFetchJson(`${API}/v1/purchases/products`);
    const products = (pr && Array.isArray(pr.data)) ? pr.data : [];
    if (products.length) {
      const owned = (window._purchased || []);
      const store = document.createElement('div');
      store.id = 'indStoreSection';
      store.style.cssText = 'border-top:1px solid var(--border);padding-top:16px;margin-top:16px';
      const _e = s => { const d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; };
      store.innerHTML = `
        <div style="font-size:16px;font-weight:700;color:var(--gold-text);margin-bottom:12px">프리미엄 지표</div>
        ${products.map(p=>{
          const has = owned.includes(p.indicator_code);
          const price = (p.price||0).toLocaleString() + (p.currency==='USD'?' USD':'원');
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
            <div><div style="font-size:13px;font-weight:600">${_e(p.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${_e(p.description||'')}</div></div>
            ${has ? '<span style="font-size:12px;color:#16A34A;font-weight:600">보유중</span>'
                  : `<button onclick="window._buyIndicator&&window._buyIndicator('${_e(p.indicator_code)}')" style="padding:5px 12px;background:var(--color-primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">${price} 구매</button>`}
          </div>`;
        }).join('')}`;
      inner.appendChild(store);
    }
  } catch(e) {}
  } finally { _injectReferralDashboard._busy = false; }
}

// ═══ 가입 성공 후 추천 코드 자동 적용 (중복 방지/멱등 처리) ═══
const _origRefreshAuth = window.refreshAuthState;
let _refApplyInFlight = null;

function _refApplyDoneKey(user, code) {
  return `chartOS_refApplied_${(user || 'guest').toLowerCase()}_${(code || '').toUpperCase()}`;
}

window.refreshAuthState = async function(silent) {
  const result = await (_origRefreshAuth ? _origRefreshAuth(silent) : undefined);
  const refInput = document.getElementById('authRefCode');
  const code = (refInput?.value?.trim() || _urlRef || '').toUpperCase();

  if (!code || !(window.isLoggedIn && window.isLoggedIn())) {
    return result;
  }

  const user = (window.userName || localStorage.getItem('userName') || 'guest').trim();
  const doneKey = _refApplyDoneKey(user, code);
  if (sessionStorage.getItem(doneKey) === '1') {
    return result;
  }

  if (_refApplyInFlight) {
    return result;
  }

  _refApplyInFlight = (async () => {
    try {
      const requester = (typeof window.dedupFetch === 'function') ? window.dedupFetch : fetch;
      const resp = await requester(`${API}/v1/referral/apply`, {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ code })
      });
      const json = await resp.json().catch(() => ({}));

      // 성공 또는 이미 적용 상태는 모두 완료 상태로 기록해 중복 요청 차단
      if (resp.ok || /이미 추천 코드를 사용/.test(json?.detail || '') || /이미 적용된 추천 코드/.test(json?.data?.message || '')) {
        sessionStorage.setItem(doneKey, '1');
      }

      if (resp.ok && window.showToast) {
        window.showToast(json?.data?.message || '추천 코드가 적용되었습니다.', '#C4384B');
      }
    } catch (e) {
      // 네트워크 오류는 무시(다음 refreshAuth에서 재시도 가능)
    } finally {
      _refApplyInFlight = null;
    }
  })();

  return result;
};

// ═══ 차트 상태 안정화 핫픽스 (타임프레임/지표 저장-복원) ═══
(function attachChartStabilityHotfix() {
  let _saveTimer = null;
  let _tfRestoreTimer = null;

  function _manualDrawings(chart) {
    const arr = chart?.overlay?.drawings || [];
    return arr.filter((d) => ['hline', 'vline', 'trendline', 'fib', 'text'].includes(d?.type));
  }

  function _scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { window._saveUserSettings && window._saveUserSettings(); } catch (_) {}
      try { window._saveDrawings && window._saveDrawings(); } catch (_) {}
      try { window._saveChartSettingsToServer && window._saveChartSettingsToServer(); } catch (_) {}
    }, 350);
  }

  // 지표 on/off, 전략 on/off, 타임프레임 변경 후 자동 저장
  document.addEventListener('click', (ev) => {
    const el = ev.target?.closest?.('[data-ind], [data-sub], [data-strategy], [data-tf]');
    if (!el) return;
    _scheduleSave();
  }, true);

  // 타임프레임 전환 직전 수동 드로잉 백업 → 전환 후 소실 시 복원
  document.addEventListener('click', (ev) => {
    const tfBtn = ev.target?.closest?.('[data-tf]');
    if (!tfBtn || !window.chart) return;

    const backup = _manualDrawings(window.chart);
    clearTimeout(_tfRestoreTimer);
    _tfRestoreTimer = setTimeout(() => {
      try {
        const chart = window.chart;
        if (!chart || typeof chart.addDrawing !== 'function') return;

        const now = _manualDrawings(chart);
        if (!now.length && backup.length) {
          backup.forEach((d) => {
            try { chart.addDrawing(d); } catch (_) {}
          });
          chart._dirty = true;
          _scheduleSave();
        }
      } catch (_) {}
    }, 1200);
  }, true);
})();
