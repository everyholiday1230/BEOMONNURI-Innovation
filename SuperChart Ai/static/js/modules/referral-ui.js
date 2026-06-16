/**
 * referral-ui.js — 레퍼럴 시스템 (거래소 벤치마킹)
 * 초대 링크 + 포인트 적립 + 티어 + 대시보드
 */
const API = window.API || '';
const _urlRef = new URLSearchParams(window.location.search).get('ref') || '';

// ═══ 회원가입 폼에 추천 코드 입력란 ═══
const _authObs = new MutationObserver(() => {
  const modal = document.getElementById('authModal');
  if (modal && modal.offsetHeight > 0 && !modal.querySelector('#authRefCode')) {
    setTimeout(_injectRefCodeInput, 300);
  }
});
_authObs.observe(document.body, {attributes: true, subtree: true, attributeFilter: ['style','class']});

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
    const r1 = await fetch(`${API}/v1/referral/my-code`, {credentials:'include'});
    const d1 = await r1.json();
    if (d1.success) {
      code = d1.data.code;
      tier = d1.data.tier || 'bronze';
      totalEarned = d1.data.total_earned || 0;
    }
    const r2 = await fetch(`${API}/v1/referral/points`, {credentials:'include'});
    const d2 = await r2.json();
    if (d2.success) { points = d2.data.points; referrals = d2.data.referrals; window._refPaidCount = d2.data.paid_referrals || 0; }
  } catch(e) {}

  const inviteLink = `${window.location.origin}?ref=${code}`;
  const tierColors = {bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', diamond:'#B9F2FF'};
  const tierNames = {bronze:'Bronze', silver:'Silver', gold:'Gold', diamond:'Diamond'};
  const nextTier = {bronze:{name:'Silver',need:5}, silver:{name:'Gold',need:20}, gold:{name:'Diamond',need:50}, diamond:{name:'Max',need:0}};
  const nt = nextTier[tier] || {name:'',need:0};

  const inner = modal.querySelector('div > div') || modal;
  const section = document.createElement('div');
  section.id = 'referralDashboard';
  section.dataset.filled = '1';
  section.style.cssText = 'border-top:1px solid var(--border);padding-top:16px;margin-top:16px';
  section.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:16px;font-weight:700;color:var(--gold-text)">레퍼럴 프로그램</span>
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
  inner.appendChild(section);

  // ── 프리미엄 지표 스토어 ──
  try {
    const pr = await fetch(`${API}/v1/purchases/products`).then(r=>r.json());
    const products = pr.data || [];
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

// ═══ 가입 성공 후 추천 코드 자동 적용 ═══
const _origRefreshAuth = window.refreshAuthState;
window.refreshAuthState = async function(silent) {
  const result = await (_origRefreshAuth ? _origRefreshAuth(silent) : undefined);
  const refInput = document.getElementById('authRefCode');
  const code = refInput?.value?.trim() || _urlRef;
  if (code && window.isLoggedIn && window.isLoggedIn()) {
    try {
      await fetch(`${API}/v1/referral/apply`, {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({code})
      });
    } catch(e) {}
  }
  return result;
};
