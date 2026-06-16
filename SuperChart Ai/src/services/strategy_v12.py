"""v12 전략: PRO — 1h메인+5m타이밍, 점수기반, 시너지+레짐+분할청산+변동성사이징"""
import json
import numpy as np
from src.services.beom_sub import _ema, _rsi, _stoch, _sma, _rolling_min, _rolling_max

try:
    PARAMS = json.load(open('data/v12_params.json'))
except FileNotFoundError:
    PARAMS = {'th':4.91,'sl':2.94,'tr':1.0,'w_tg':0.23,'w_stn':1.26,'w_ur':1.94,'w_us':0.36,
              'w_bss':1.13,'w_5stn':1.53,'w_5ur':0.85,'w_5bss':1.96,'w_syn':0.96,
              'rev_r':0.39,'crash_th':0.019,'crash_exit_th':0.013,'tp1_r':2.75,'tp1_close':0.31}

def tema(d,p):
    e1=_ema(d,p);e2=_ema(e1,p);e3=_ema(e2,p)
    return 3*e1-3*e2+e3

def calc_indicators(candles):
    c=np.array([float(x['close']) for x in candles])
    h=np.array([float(x['high']) for x in candles])
    l=np.array([float(x['low']) for x in candles])
    n=len(c)
    d1=_ema(c,23)-_ema(c,80);l1=_rolling_min(d1,100);h1=_rolling_max(d1,100)
    stk=(d1-l1)/np.maximum(h1-l1,1e-10)-0.5
    d3=_ema(c,12)-_ema(c,26);l3=_rolling_min(d3,60);h3=_rolling_max(d3,60)
    stn=(d3-l3)/np.maximum(h3-l3,1e-10)-0.5
    rs=_stoch(c,h,l,14);ks=_sma(rs,9);ls_=_rolling_min(ks,240);hs_=_rolling_max(ks,240)
    us=(ks-ls_)/np.maximum(hs_-ls_,1e-10)-0.5
    rv=_ema(_rsi(c,60),3);lr=_rolling_min(rv,300);hr=_rolling_max(rv,300)
    ur=(rv-lr)/np.maximum(hr-lr,1e-10)-0.5
    t60=tema(c,60);t200=tema(c,200)
    tr=np.maximum(h[1:]-l[1:],np.maximum(np.abs(h[1:]-c[:-1]),np.abs(l[1:]-c[:-1])))
    atr=np.zeros(n);atr[1]=np.mean(tr[:min(200,len(tr))])
    for i in range(2,n): atr[i]=(atr[i-1]*199+(tr[i-1] if i-1<len(tr) else 0))/200
    atr_ma=np.zeros(n)
    for i in range(200,n): atr_ma[i]=np.mean(atr[i-200:i])
    tg=(t60-t200)/np.maximum(atr,1)
    t60_slope=np.zeros(n)
    for i in range(3,n): t60_slope[i]=(t60[i]-t60[i-3])/max(atr[i],1)
    return {'c':c,'stn':stn,'us':us,'ur':ur,'t60':t60,'t200':t200,'atr':atr,'atr_ma':atr_ma,'tg':tg,'t60_slope':t60_slope}

def compute_score(m1h, t5_stn, t5_ur, t5_bss, bm_arrow, stc_cross, stoch_cross, direction):
    """점수 계산 (시너지 포함)"""
    P=PARAMS;dr=direction
    s =min(max(m1h['tg']*P['w_tg']*dr,-1),2)
    s+=min(max(m1h['stn']*P['w_stn']*dr,-0.5),1.5)
    s+=min(max(m1h['ur']*P['w_ur']*dr,-0.3),1.0)
    s+=min(max(m1h['us']*P['w_us']*dr,-0.2),0.5)
    s+=min(max(m1h['bss']/5*P['w_bss']*dr,-0.5),2.0)
    s+=min(max(t5_stn*P['w_5stn']*dr,-0.5),1.5)
    s+=min(max(t5_ur*P['w_5ur']*dr,-0.2),0.5)
    s+=min(max(t5_bss/7*P['w_5bss']*dr,-0.3),1.0)
    # 시너지
    h_agree=(m1h['stn']*dr>0)+(m1h['ur']*dr>0)+(m1h['us']*dr>0)
    f_agree=(t5_stn*dr>0)+(t5_ur*dr>0)
    s+=(h_agree*f_agree)/6.0*P['w_syn']
    if bm_arrow: s+=0.5
    if stc_cross and stoch_cross: s+=0.3
    return s

def decide_v12(m1h_state, t5_state, position=None):
    """v12 매매 결정
    m1h_state: {'stn','ur','us','tg','bss','atr','atr_ma','slope','stn_prev','tb'}
    t5_state: {'price','stn','stn_prev','ur','us','us_prev','bss','bm_buy','bm_sell'}
    position: None or {'side','entry','ep','ep_orig','peak','atr','sl','tr','tp1','tp1_hit'}
    """
    P=PARAMS
    price=t5_state['price']
    
    # 5m 크로스
    sx_up=t5_state['stn']>0 and t5_state['stn_prev']<=0
    sx_dn=t5_state['stn']<0 and t5_state['stn_prev']>=0
    su_up=t5_state['us']>0 and t5_state['us_prev']<=0
    su_dn=t5_state['us']<0 and t5_state['us_prev']>=0
    has_tl=sx_up or t5_state.get('bm_buy') or su_up
    has_ts=sx_dn or t5_state.get('bm_sell') or su_dn
    
    # 1h 추세
    ht=(1 if m1h_state['tb'] else -1)+(1 if m1h_state['stn']>0.2 else(-1 if m1h_state['stn']<-0.2 else 0))
    
    # 레짐
    is_ranging=abs(m1h_state['slope'])<0.3 and abs(m1h_state['tg'])<0.5
    high_vol=m1h_state['atr']>m1h_state['atr_ma']*1.5 if m1h_state['atr_ma']>0 else False
    
    # 급변
    pc=t5_state.get('price_chg_1h',0)
    
    if position is None and (has_tl or has_ts):
        ls=compute_score(m1h_state,t5_state['stn'],t5_state['ur'],t5_state['bss'],
                         t5_state.get('bm_buy'),sx_up,su_up,1) if has_tl else 0
        ss=compute_score(m1h_state,t5_state['stn'],t5_state['ur'],t5_state['bss'],
                         t5_state.get('bm_sell'),sx_dn,su_dn,-1) if has_ts else 0
        # 전환감지
        if ht>=1 and m1h_state['stn']<m1h_state['stn_prev'] and m1h_state['stn']<0.3: ss+=1.0
        if ht<=-1 and m1h_state['stn']>m1h_state['stn_prev'] and m1h_state['stn']>-0.3: ls+=1.0
        
        th_adj=P['th']+(0.5 if is_ranging else 0)
        enter=0;score=0
        if has_tl and ls>=th_adj and ls>ss: enter=1;score=ls
        elif has_ts and ss>=th_adj and ss>ls: enter=-1;score=ss
        
        if enter!=0:
            ep=min(max((score-3)/4,0.3),1.0)
            if(enter==1 and ht<0)or(enter==-1 and ht>0): ep*=P['rev_r']
            if high_vol: ep*=0.6
            if pc<-P['crash_th'] and enter==1: return {'action':'none'}
            if pc>P['crash_th'] and enter==-1: return {'action':'none'}
            
            sl_m=P['sl']+score*0.1;tr_m=P['tr']+score*0.1
            tp1=price+enter*m1h_state['atr']*P['tp1_r']
            return {'action':'enter','side':'long' if enter==1 else 'short',
                    'ep':ep,'sl':sl_m,'tr':tr_m,'tp1':tp1,'score':score}
    
    elif position is not None:
        sd=1 if position['side']=='long' else -1
        entry=position['entry'];pnl=(price-entry)/entry*sd
        atr=position['atr']
        
        # TP1 체크
        tp1_hit=position.get('tp1_hit',False)
        if not tp1_hit:
            if(sd==1 and price>=position['tp1'])or(sd==-1 and price<=position['tp1']):
                return {'action':'partial_close','ratio':P['tp1_close'],'reason':'TP1'}
        
        # 청산 조건
        pk=position.get('peak',price)
        
        # ── 단계별 트레일링 (수익 보호 강화) ──
        if pnl>0.03:
            tr_mult=0.3
        elif pnl>0.015:
            tr_mult=0.6
        elif pnl>0.005:
            tr_mult=position['tr']
        else:
            tr_mult=None
        
        if sd==1:
            if price<entry-atr*position['sl']: return {'action':'close','reason':'SL'}
            if tr_mult and price<pk-atr*tr_mult: return {'action':'close','reason':'trailing'}
            # ── 지표 반전 청산 강화 ──
            if ht<=-1 and t5_state['stn']<-0.3: return {'action':'close','reason':'1h_reversal'}
            if t5_state['stn']<-0.4 and t5_state.get('bm_sell'): return {'action':'close','reason':'5m_reversal'}
            if m1h_state['stn']<0 and m1h_state['stn_prev']>=0: return {'action':'close','reason':'1h_stn_cross'}
            if pc<-P['crash_exit_th']: return {'action':'close','reason':'crash'}
        else:
            if price>entry+atr*position['sl']: return {'action':'close','reason':'SL'}
            if tr_mult and price>pk+atr*tr_mult: return {'action':'close','reason':'trailing'}
            # ── 지표 반전 청산 강화 ──
            if ht>=1 and t5_state['stn']>0.3: return {'action':'close','reason':'1h_reversal'}
            if t5_state['stn']>0.4 and t5_state.get('bm_buy'): return {'action':'close','reason':'5m_reversal'}
            if m1h_state['stn']>0 and m1h_state['stn_prev']<=0: return {'action':'close','reason':'1h_stn_cross'}
            if pc>P['crash_exit_th']: return {'action':'close','reason':'crash'}
    
    return {'action':'none'}
