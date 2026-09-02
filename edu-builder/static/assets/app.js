// edu-builder 공통 클라이언트 헬퍼
const EB = {
  // ── 토큰 저장 ──
  tok:{
    getAdmin(){return localStorage.getItem('eb_admin_token')},
    setAdmin(t){localStorage.setItem('eb_admin_token',t)},
    clearAdmin(){localStorage.removeItem('eb_admin_token')},
    getStudent(){return localStorage.getItem('eb_student_token')},
    setStudent(t){localStorage.setItem('eb_student_token',t)},
    clearStudent(){localStorage.removeItem('eb_student_token')},
  },

  // ── API ──
  async api(method, path, body, token){
    const h={'Content-Type':'application/json'};
    if(token) h['Authorization']='Bearer '+token;
    const res=await fetch(path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
    let data=null; const ct=res.headers.get('content-type')||'';
    if(ct.includes('json')) data=await res.json().catch(()=>null);
    else data=await res.text().catch(()=>null);
    if(!res.ok){
      const msg=(data&&data.detail)||(typeof data==='string'?data:'')||('오류('+res.status+')');
      throw new Error(msg);
    }
    return data;
  },

  // ── 토스트 ──
  toast(msg){
    let t=document.getElementById('eb-toast');
    if(!t){t=document.createElement('div');t.id='eb-toast';t.className='toast';document.body.appendChild(t);}
    t.textContent=msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt=setTimeout(()=>t.classList.remove('show'),2600);
  },

  esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))},

  // WebSocket URL (현재 호스트 기준, http→ws)
  wsUrl(path){
    const proto=location.protocol==='https:'?'wss:':'ws:';
    return proto+'//'+location.host+path;
  },
};
