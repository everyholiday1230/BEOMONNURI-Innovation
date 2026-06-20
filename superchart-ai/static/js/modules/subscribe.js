/**
 * subscribe.js — 구독 플랜 UI
 */

window._showSubscribePlans = function() {
  const existing = document.getElementById('subscribePlansModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'subscribePlansModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(61,43,31,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#FFFDF9;border-radius:12px;padding:24px;max-width:420px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 12px 40px rgba(106,30,51,0.2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;font-size:14px;color:#032129">프리미엄 구독 플랜</h3>
        <button onclick="this.closest('#subscribePlansModal').remove()" style="background:none;border:none;font-size:14px;cursor:pointer;color:#8E7D72">✕</button>
      </div>

      <div style="padding:12px;background:rgba(196,56,75,0.08);border:1px solid rgba(196,56,75,0.2);border-radius:8px;margin-bottom:12px">
        <div style="font-weight:700;color:#C4384B;margin-bottom:4px">일반회원 지표 전체</div>
        <div style="font-size:14px;color:#8E7D72;margin-bottom:8px">자동추세선 · 범온MA · 추세전환 · 매매압력 · 자금흐름 · MA리본 · IMACD</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:800;color:#032129">₩29,000<span style="font-size:14px;font-weight:400;color:#8E7D72">/월</span></span>
          <button onclick="window._subscribe('member_all')" style="padding:6px 16px;background:#C4384B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">구독하기</button>
        </div>
      </div>

      <div style="font-weight:600;font-size:14px;color:#032129;margin:16px 0 8px">VIP 지표 (개별 구독)</div>
      
      ${[
        ['vip_ultra','범온 캔들','추세 방향·강도 AI 캔들'],
        ['vip_bimaco2','범온 캔들 PRO','고급 추세 분석'],
        ['vip_ob','거래밀집구간','지지/저항 자동 감지'],
        ['vip_tp','AI목표','진입·손절·익절 자동 표시'],
        ['vip_heat','과열분석','과열/침체 구간 감지'],
        ['vip_strength','강도측정','추세 강도 수치화'],
        ['vip_obsig','범온 추세시작','매수/매도 진입 시그널'],
        ['vip_align','정/역배열','이동평균선 배열 감지'],
        ['vip_ttr','단타 익절','익절 포인트 감지'],
        ['vip_buyscan','매수매도','매수/매도 스캐너'],
        ['vip_kvo','거래량분석','거래량 흐름 분석'],
      ].map(([code,name,desc])=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(216,182,106,0.15)">
          <div><div style="font-weight:600;font-size:14px">${name}</div><div style="font-size:14px;color:#8E7D72">${desc}</div></div>
          <button onclick="window._subscribe('${code}')" style="padding:4px 12px;background:#921230;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;white-space:nowrap">₩50,000/월</button>
        </div>
      `).join('')}

      <p style="font-size:14px;color:#8E7D72;margin-top:12px;line-height:1.5">※ 결제 시스템이 곧 오픈됩니다. 사전 등록하시면 할인 혜택을 드립니다.</p>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
};

window._subscribe = function(planCode) {
  window.showToast('결제 시스템이 곧 오픈됩니다. 사전 등록하시면 할인 혜택을 드립니다.', '#D8B66A');
};
