// ── CONSTANTS ──
const LOW_STOCK = 3;
const LIVE_MODE = true;

// ── STATE ──
let txs, customers, stock, profitTransfers;
let activeTab='home', hFilter='all';
let _mode='mpesa', _cart={onesie:0,glasses:0}, _payType='full', _wdType='restock';
let _otherType='charge', _rstO=0, _rstG=0, _so=5, _sg=5;
let _resId=null, _parsedMpesa=null;
let _mpesaSelected=new Set(); // multi-select classify
let _mpesaAllocs={}; // amount allocated per type
let _mpesaSplitProd='onesie';
function loadAll(){
  try{txs=JSON.parse(localStorage.getItem('sc_txs'))||(LIVE_MODE?[]:[])}catch(e){txs=[]}
  try{customers=JSON.parse(localStorage.getItem('sc_customers'))||{}}catch(e){customers={}}
  try{stock=JSON.parse(localStorage.getItem('sc_stock'))||{onesies:0,glasses:0}}catch(e){stock={onesies:0,glasses:0}}
  try{profitTransfers=JSON.parse(localStorage.getItem('sc_profit'))||[]}catch(e){profitTransfers=[]}
}
loadAll();

// ──
function saveAll(){
  try{localStorage.setItem('sc_txs',JSON.stringify(txs))}catch(e){}
  try{localStorage.setItem('sc_customers',JSON.stringify(customers))}catch(e){}
  try{localStorage.setItem('sc_stock',JSON.stringify(stock))}catch(e){}
  try{localStorage.setItem('sc_profit',JSON.stringify(profitTransfers))}catch(e){}
}

// ──
function f(n){return Math.round(n).toLocaleString()}

// ──
function fmt(n){return'KSH '+f(n)}

// ──
function today(){return new Date().toISOString().split('T')[0]}

// ──
function daysBetween(d1,d2){return Math.floor((new Date(d2)-new Date(d1))/86400000)}

// ── TOTALS ──

// ──
function tots(){
  let pr=0,rs=0,ms=0,ts=0,oc=0,gc=0,os=0,gs=0,wd=0,ch=0,unres=0,laundry=0,laundryUnits=0,delIn=0,delCost=0;
  const sgs={};
  txs.forEach(x=>{
    if(x.t==='split_part'){
      if(!sgs[x.splitGroup])sgs[x.splitGroup]={parts:[],product:x.splitProduct,total:x.splitTotal};
      sgs[x.splitGroup].parts.push(x.a);
    }
  });
  const done=new Set();
  txs.forEach(x=>{
    if(x.t==='test')return;
    if(x.t==='unresolved'){unres+=x.a;return;}
    if(x.t==='split_part'){
      const g=sgs[x.splitGroup];
      if(!g||done.has(x.splitGroup))return;
      const s=g.parts.reduce((a,b)=>a+b,0);
      if(s>=g.total){
        done.add(x.splitGroup);
        if(g.product==='onesie'){pr+=799;rs+=100;ms+=100;os+=s;oc+=1;ts+=s;}
        else{pr+=270;rs+=100;ms+=50;gs+=s;gc+=1;ts+=s;}
      }
      return;
    }
    if(x.t==='onesie'){const u=x.units||1;pr+=799*u;rs+=100*u;ms+=100*u;os+=x.a;oc+=u;ts+=x.a;}
    else if(x.t==='glasses'){const u=x.units||1;pr+=270*u;rs+=100*u;ms+=50*u;gs+=x.a;gc+=u;ts+=x.a;}
    else if(x.t==='delivery_income'){delIn+=x.a;pr+=x.netProfit||0;}
    else if(x.t==='withdrawal'){
      wd+=x.a;
      if(x.p==='laundry'){laundry+=x.a;laundryUnits+=(x.washUnits||0);pr-=x.a;}
      if(x.p==='delivery_cost'){delCost+=x.a;}
    }
    else if(x.t==='charge'){ch+=x.a;}
  });
  const realProfit=pr;
  return{pr,realProfit,rs,ms,ts,oc,gc,os,gs,wd,ch,unres,laundry,laundryUnits,delIn,delCost};
}

// ──
function velocity(){
  const st=txs.filter(x=>x.t==='onesie'||x.t==='glasses');
  if(!st.length)return{weeklyAvg:0,trend:'new',daysSinceLast:null,totalDays:0};
  const dates=st.map(x=>x.d).sort();
  const first=dates[0],last=dates[dates.length-1];
  const span=Math.max(1,daysBetween(first,today())+1);
  const weeks=span/7;
  const wAvg=st.length/weeks;
  const t=today();
  const l7=st.filter(x=>daysBetween(x.d,t)<=7).length;
  const p7=st.filter(x=>{const d=daysBetween(x.d,t);return d>7&&d<=14;}).length;
  const trend=st.length<3?'new':l7>p7?'up':l7===p7?'flat':'down';
  return{weeklyAvg:wAvg,trend,daysSinceLast:daysBetween(last,today()),totalDays:span};
}

// ──
function animCount(el,to){
  if(!el)return;
  to=Math.round(to);
  const steps=40,dur=700;
  let i=0;
  const iv=setInterval(()=>{
    i++;
    el.textContent=f(Math.round(to*(i/steps)));
    if(i>=steps){el.textContent=f(to);clearInterval(iv);}
  },dur/steps);
}

// ── M-PESA PARSER ──

// ──
function parseSaccoMsg(msg){
  // Format: "...credited with KES 420 received from Sammy on 2026-04-08 20:11:34. Ref: UD8O9BOBR7..."
  // Also handle sent/debit messages
  const result={raw:msg,direction:null,amount:null,party:null,date:null,ref:null};
  // Amount
  const amtMatch=msg.match(/(?:KES|KSH|Ksh)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if(amtMatch)result.amount=parseFloat(amtMatch[1].replace(/,/g,''));
  // Direction
  if(/credited|received from/i.test(msg))result.direction='credit';
  else if(/debited|sent to|transferred to|paid to/i.test(msg))result.direction='debit';
  // Party name (credit: "received from NAME on", debit: "sent to NAME on" or "to NAME")
  const creditParty=msg.match(/received from ([A-Za-z\s]+?) on /i);
  const debitParty=msg.match(/(?:sent to|transferred to|paid to) ([A-Za-z\s]+?) on /i);
  if(creditParty)result.party=creditParty[1].trim();
  else if(debitParty)result.party=debitParty[1].trim();
  // Date
  const dateMatch=msg.match(/(\d{4}-\d{2}-\d{2})/);
  if(dateMatch)result.date=dateMatch[1];
  // Ref
  const refMatch=msg.match(/Ref[:\s]+([A-Z0-9]+)/i);
  if(refMatch)result.ref=refMatch[1];
  return result;
}

// ──
function parseMpesa(){
  const msg=document.getElementById('mpesa-msg').value.trim();
  if(msg.length<20){
    document.getElementById('parse-result').style.display='none';
    document.getElementById('mpesa-classify').style.display='none';
    document.getElementById('mpesa-extra').style.display='none';
    return;
  }
  const p=parseSaccoMsg(msg);
  _parsedMpesa=p;
  _mpesaSelected=new Set();
  _mpesaAllocs={};
  if(!p.amount){
    document.getElementById('parse-result').style.display='none';
    return;
  }
  document.getElementById('parse-result').style.display='block';
  document.getElementById('parse-rows').innerHTML=`
    <div class="pr-row"><span class="pr-k">direction</span><span class="pr-v">${p.direction==='credit'?'💰 money IN':'💸 money OUT'}</span></div>
    <div class="pr-row"><span class="pr-k">amount</span><span class="pr-v">${fmt(p.amount)}</span></div>
    ${p.party?`<div class="pr-row"><span class="pr-k">from/to</span><span class="pr-v">${p.party}</span></div>`:''}
    ${p.date?`<div class="pr-row"><span class="pr-k">date</span><span class="pr-v">${p.date}</span></div>`:''}
    ${p.ref?`<div class="pr-row"><span class="pr-k">ref</span><span class="pr-v">${p.ref}</span></div>`:''}`;
  document.getElementById('mpesa-classify').style.display='block';
  // Credit types — multi-selectable (except split and test which are solo)
  if(p.direction==='credit'||!p.direction){
    document.getElementById('mpesa-type-grid').innerHTML=`
      <button class="tbtn" id="mc-onesie" onclick="toggleMpesaType('onesie')"><span class="tbi">👕</span>Onesie</button>
      <button class="tbtn" id="mc-glasses" onclick="toggleMpesaType('glasses')"><span class="tbi">🕶</span>Glasses</button>
      <button class="tbtn" id="mc-delivery" onclick="toggleMpesaType('delivery')"><span class="tbi">🛵</span>Delivery fee</button>
      <button class="tbtn solo" id="mc-split" onclick="toggleMpesaType('split')"><span class="tbi">✂️</span>Split part</button>
      <button class="tbtn solo" id="mc-test" onclick="toggleMpesaType('test')"><span class="tbi">🧪</span>Test</button>`;
  } else {
    document.getElementById('mpesa-type-grid').innerHTML=`
      <button class="tbtn" id="mc-restock" onclick="toggleMpesaType('restock')"><span class="tbi">📦</span>Restock</button>
      <button class="tbtn" id="mc-laundry" onclick="toggleMpesaType('laundry')"><span class="tbi">🧺</span>Laundry</button>
      <button class="tbtn" id="mc-del-cost" onclick="toggleMpesaType('del-cost')"><span class="tbi">🛵</span>Delivery cost</button>
      <button class="tbtn solo" id="mc-profit-transfer" onclick="toggleMpesaType('profit-transfer')"><span class="tbi">◐</span>Profit transfer</button>
      <button class="tbtn solo" id="mc-misc" onclick="toggleMpesaType('misc')"><span class="tbi">⋯</span>Misc / ops</button>`;
  }
  if(p.date)document.getElementById('l-date').value=p.date;
}

// ── MULTI-SELECT CLASSIFY ──
// Solo types: selecting them clears all others
const SOLO_TYPES=new Set(['split','test','profit-transfer','misc','del-cost','laundry','restock']);

function toggleMpesaType(type){
  const isSolo=SOLO_TYPES.has(type);
  if(isSolo){
    // Solo: clear everything and select only this
    _mpesaSelected=new Set([type]);
  } else {
    // Multi: deselect any solo types first
    SOLO_TYPES.forEach(s=>_mpesaSelected.delete(s));
    if(_mpesaSelected.has(type)){
      _mpesaSelected.delete(type);
    } else {
      _mpesaSelected.add(type);
    }
  }
  refreshClassifyUI();
}

function refreshClassifyUI(){
  // Update button highlights
  document.querySelectorAll('#mpesa-type-grid .tbtn').forEach(b=>{
    const id=b.id.replace('mc-','');
    b.className='tbtn'+(b.classList.contains('solo')?' solo':'')+(
      _mpesaSelected.has(id)?' sg':''
    );
  });

  const p=_parsedMpesa;
  const total=p?.amount||0;
  const name=p?.party||'';
  const extra=document.getElementById('mpesa-extra');

  if(_mpesaSelected.size===0){
    extra.style.display='none';
    extra.innerHTML='';
    return;
  }
  extra.style.display='block';

  // Auto-suggest allocation when multiple types selected
  if(_mpesaSelected.size>1){
    autoSuggestAlloc(total);
  } else {
    // Single selection — set full amount
    const type=[..._mpesaSelected][0];
    _mpesaAllocs[type]=total;
  }

  buildExtraFields(name, total);
}

// Auto-suggest split based on known prices
function autoSuggestAlloc(total){
  const types=[..._mpesaSelected];
  // Known prices for auto-detection
  const prices={onesie:999, glasses:420, delivery:300};
  let remaining=total;
  // First pass: assign known product prices
  types.forEach(t=>{
    if(prices[t]&&!_mpesaAllocs[t]){
      _mpesaAllocs[t]=prices[t];
      remaining-=prices[t];
    }
  });
  // Second pass: give remainder to delivery or first unpriced type
  types.forEach(t=>{
    if(!prices[t]&&!_mpesaAllocs[t]){
      _mpesaAllocs[t]=Math.max(0,remaining);
    }
  });
  // If remaining is off, put difference on delivery
  const allocTotal=Object.values(_mpesaAllocs).reduce((a,b)=>a+b,0);
  if(allocTotal!==total&&_mpesaAllocs['delivery']!==undefined){
    _mpesaAllocs['delivery']=Math.max(0,_mpesaAllocs['delivery']+(total-allocTotal));
  }
}

function buildExtraFields(name, total){
  const types=[..._mpesaSelected];
  const extra=document.getElementById('mpesa-extra');
  let html='';

  // Customer name field (shared across all product types)
  const needsCust=types.some(t=>['onesie','glasses','delivery','split'].includes(t));
  if(needsCust){
    html+=`<div class="fg">
      <label class="fl">customer name</label>
      <div class="ac-wrap">
        <input class="finput" id="mc-name" value="${name}" placeholder="e.g. Joan"
          oninput="acInput(this,'mc-name-list')" onblur="acBlur('mc-name-list')" autocomplete="off">
        <div class="ac-list" id="mc-name-list"></div>
      </div>
    </div>`;
  }

  // Amount allocation section — only when multi-select
  if(types.length>1){
    html+=`<div class="fg">
      <label class="fl">amount split — total ${fmt(total)}</label>
      <div style="display:flex;flex-direction:column;gap:6px" id="alloc-rows">`;
    types.forEach(t=>{
      const label={onesie:'👕 Onesie',glasses:'🕶 Glasses',delivery:'🛵 Delivery fee'}[t]||t;
      const val=_mpesaAllocs[t]||0;
      html+=`<div style="display:flex;align-items:center;gap:8px;background:var(--sf2);border:1px solid var(--bd);border-radius:var(--rs);padding:9px 12px">
        <span style="font-size:12px;font-family:'DM Mono',monospace;color:var(--mu);flex:1">${label}</span>
        <input type="number" id="alloc-${t}" value="${val}"
          style="width:90px;background:transparent;border:none;font-size:14px;font-weight:700;font-family:'DM Mono',monospace;color:var(--gr);text-align:right;outline:none"
          oninput="onAllocChange('${t}',${total})">
      </div>`;
    });
    html+=`</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;font-family:'DM Mono',monospace;margin-top:6px;padding:0 2px">
        <span style="color:var(--mu)">allocated</span>
        <span id="alloc-total" style="color:var(--gr)">KSH 0</span>
      </div>
    </div>`;
  }

  // Per-type extra fields
  types.forEach(t=>{
    if(t==='onesie'){
      const qty=Math.max(1,Math.round((types.length>1?(_mpesaAllocs['onesie']||999):total)/999));
      html+=`<div class="fg">
        <label class="fl">onesie quantity</label>
        <div style="display:flex;align-items:center">
          <button class="sb" onclick="mpesaQtyStep('onesie',-1)">−</button>
          <span class="sv" id="mq-onesie">${qty}</span>
          <button class="sb" onclick="mpesaQtyStep('onesie',1)">+</button>
          <span style="font-size:11px;color:var(--mu);font-family:'DM Mono',monospace;margin-left:10px" id="mq-onesie-total">${fmt(qty*999)}</span>
        </div>
      </div>`;
    } else if(t==='glasses'){
      const qty=Math.max(1,Math.round((types.length>1?(_mpesaAllocs['glasses']||420):total)/420));
      html+=`<div class="fg">
        <label class="fl">glasses quantity</label>
        <div style="display:flex;align-items:center">
          <button class="sb" onclick="mpesaQtyStep('glasses',-1)">−</button>
          <span class="sv" id="mq-glasses">${qty}</span>
          <button class="sb" onclick="mpesaQtyStep('glasses',1)">+</button>
          <span style="font-size:11px;color:var(--mu);font-family:'DM Mono',monospace;margin-left:10px" id="mq-glasses-total">${fmt(qty*420)}</span>
        </div>
      </div>`;
    } else if(t==='delivery'){
      const fee=_mpesaAllocs['delivery']||0;
      html+=`<div class="fg">
        <label class="fl">actual delivery cost (KSH)</label>
        <input class="finput" id="mc-del-cost" type="number" placeholder="e.g. 450" oninput="updateDelCalc()">
        <div style="background:var(--pkd);border:1px solid rgba(244,114,182,.2);border-radius:var(--rs);padding:9px 12px;margin-top:8px;font-size:11px;font-family:'DM Mono',monospace;color:var(--pk)" id="del-calc">enter cost above to see net profit</div>
      </div>`;
    } else if(t==='split'){
      html+=`<div class="fg">
        <label class="fl">what product?</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
          <button class="tbtn sg" id="msp-onesie" onclick="setMpesaSplitProd('onesie')"><span class="tbi">👕</span>Onesie</button>
          <button class="tbtn" id="msp-glasses" onclick="setMpesaSplitProd('glasses')"><span class="tbi">🕶</span>Glasses</button>
        </div>
      </div>
      <div class="split-hint" id="mc-sp-hint">
        <div class="sh2-title" id="mc-sph-title"></div>
        <div class="sh2-text" id="mc-sph-text"></div>
        <div class="sh2-bar"><div class="sh2-fill" id="mc-sph-fill"></div></div>
      </div>`;
    } else if(t==='restock'){
      html+=`<div class="fg">
        <label class="fl">onesies restocked</label>
        <div style="display:flex;align-items:center">
          <button class="sb" onclick="mpesaQtyStep('rst-o',-1)">−</button>
          <span class="sv" id="mq-rst-o">0</span>
          <button class="sb" onclick="mpesaQtyStep('rst-o',1)">+</button>
        </div>
      </div>
      <div class="fg">
        <label class="fl">glasses restocked</label>
        <div style="display:flex;align-items:center">
          <button class="sb" onclick="mpesaQtyStep('rst-g',-1)">−</button>
          <span class="sv" id="mq-rst-g">0</span>
          <button class="sb" onclick="mpesaQtyStep('rst-g',1)">+</button>
        </div>
      </div>`;
    } else if(t==='laundry'){
      html+=`<div class="fg">
        <label class="fl">onesies in this wash</label>
        <input class="finput" id="mc-wash-units" type="number" placeholder="e.g. 5">
      </div>`;
    } else if(t==='profit-transfer'){
      html+=`<div class="fg">
        <label class="fl">note</label>
        <input class="finput" id="mc-pt-note" placeholder="e.g. April profit">
      </div>`;
    }
  });

  extra.innerHTML=html;
  updateAllocTotal(total);
  // Always force-fill name from parsed message — works for first-time customers too
  const mcName=document.getElementById('mc-name');
  if(mcName){
    if(!mcName.value && _parsedMpesa && _parsedMpesa.party){
      mcName.value=_parsedMpesa.party;
    }
    if(types.includes('split')) mcName.addEventListener('input',checkExistingSplit);
  }
}

function onAllocChange(type, total){
  const val=parseFloat(document.getElementById('alloc-'+type)?.value)||0;
  _mpesaAllocs[type]=val;
  updateAllocTotal(total);
  // update del-calc if delivery is one of the types
  if(type==='delivery')updateDelCalc();
}

function updateAllocTotal(total){
  const types=[..._mpesaSelected];
  if(types.length<2)return;
  const sum=types.reduce((a,t)=>a+(parseFloat(document.getElementById('alloc-'+t)?.value)||0),0);
  const el=document.getElementById('alloc-total');
  if(el){
    el.textContent=fmt(sum);
    el.style.color=sum===total?'var(--gr)':'var(--re)';
  }
}

// ──
function setMpesaType(type){
  _mpesaClassify=type;
  // highlight button
  document.querySelectorAll('#mpesa-type-grid .tbtn').forEach(b=>b.className='tbtn');
  const el=document.getElementById('mc-'+type);
  if(el)el.className='tbtn sg';
  // Show extra fields based on type
  const extra=document.getElementById('mpesa-extra');
  extra.style.display='block';
  const p=_parsedMpesa;
  const name=p?.party||'';
  if(type==='onesie'){
    const qty=p?.amount?Math.round(p.amount/999):1;
    extra.innerHTML=`
      <div class="fg"><label class="fl">quantity (auto-detected)</label>
      <div style="display:flex;align-items:center"><button class="sb" onclick="mpesaQtyStep('onesie',-1)">−</button><span class="sv" id="mq-onesie">${qty}</span><button class="sb" onclick="mpesaQtyStep('onesie',1)">+</button>
      <span style="font-size:11px;color:var(--mu);font-family:'DM Mono',monospace;margin-left:10px" id="mq-onesie-total">${fmt(qty*999)}</span></div></div>
      <div class="fg"><label class="fl">customer name</label><input class="finput" id="mc-name" value="${name}" placeholder="e.g. Joan"></div>`;
  } else if(type==='glasses'){
    const qty=p?.amount?Math.round(p.amount/420):1;
    extra.innerHTML=`
      <div class="fg"><label class="fl">quantity (auto-detected)</label>
      <div style="display:flex;align-items:center"><button class="sb" onclick="mpesaQtyStep('glasses',-1)">−</button><span class="sv" id="mq-glasses">${qty}</span><button class="sb" onclick="mpesaQtyStep('glasses',1)">+</button>
      <span style="font-size:11px;color:var(--mu);font-family:'DM Mono',monospace;margin-left:10px" id="mq-glasses-total">${fmt(qty*420)}</span></div></div>
      <div class="fg"><label class="fl">customer name</label><input class="finput" id="mc-name" value="${name}" placeholder="e.g. Joan"></div>`;
  } else if(type==='mixed'){
    extra.innerHTML=`
      <div class="fg"><label class="fl">onesies</label><div style="display:flex;align-items:center"><button class="sb" onclick="mpesaQtyStep('mix-onesie',-1)">−</button><span class="sv" id="mq-mix-onesie">1</span><button class="sb" onclick="mpesaQtyStep('mix-onesie',1)">+</button></div></div>
      <div class="fg"><label class="fl">sunglasses</label><div style="display:flex;align-items:center"><button class="sb" onclick="mpesaQtyStep('mix-glasses',-1)">−</button><span class="sv" id="mq-mix-glasses">0</span><button class="sb" onclick="mpesaQtyStep('mix-glasses',1)">+</button></div></div>
      <div class="fg"><label class="fl">customer name</label><input class="finput" id="mc-name" value="${name}" placeholder="e.g. Joan"></div>`;
  } else if(type==='delivery'){
    extra.innerHTML=`
      <div class="fg"><label class="fl">actual delivery cost (KSH)</label><input class="finput" id="mc-del-cost" type="number" placeholder="e.g. 450"></div>
      <div class="fg"><label class="fl">customer name</label><input class="finput" id="mc-name" value="${name}" placeholder="e.g. Anna"></div>
      <div style="background:var(--pkd);border:1px solid rgba(244,114,182,.2);border-radius:var(--rs);padding:10px 12px;margin-bottom:14px;font-size:11px;font-family:'DM Mono',monospace;color:var(--pk)" id="del-calc">enter delivery cost above to see net</div>`;
    document.getElementById('mc-del-cost').addEventListener('input',updateDelCalc);
  } else if(type==='split'){
    extra.innerHTML=`
      <div class="fg"><label class="fl">what product?</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
        <button class="tbtn sg" id="msp-onesie" onclick="setMpesaSplitProd('onesie')"><span class="tbi">👕</span>Onesie</button>
        <button class="tbtn" id="msp-glasses" onclick="setMpesaSplitProd('glasses')"><span class="tbi">🕶</span>Glasses</button>
      </div></div>
      <div class="fg"><label class="fl">customer name</label><input class="finput" id="mc-name" value="${name}" oninput="checkExistingSplit()" placeholder="e.g. Sammy"></div>
      <div class="split-hint" id="mc-sp-hint">
        <div class="sh2-title" id="mc-sph-title"></div>
        <div class="sh2-text" id="mc-sph-text"></div>
        <div class="sh2-bar"><div class="sh2-fill" id="mc-sph-fill"></div></div>
      </div>`;
  } else if(type==='restock'){
    extra.innerHTML=`
      <div class="fg"><label class="fl">onesies restocked</label><div style="display:flex;align-items:center"><button class="sb" onclick="mpesaQtyStep('rst-o',-1)">−</button><span class="sv" id="mq-rst-o">0</span><button class="sb" onclick="mpesaQtyStep('rst-o',1)">+</button></div></div>
      <div class="fg"><label class="fl">glasses restocked</label><div style="display:flex;align-items:center"><button class="sb" onclick="mpesaQtyStep('rst-g',-1)">−</button><span class="sv" id="mq-rst-g">0</span><button class="sb" onclick="mpesaQtyStep('rst-g',1)">+</button></div></div>`;
  } else if(type==='laundry'){
    extra.innerHTML=`<div class="fg"><label class="fl">onesies in this wash</label><input class="finput" id="mc-wash-units" type="number" placeholder="e.g. 5"></div>`;
  } else if(type==='del-cost'){
    extra.innerHTML=`<div style="background:var(--rd);border:1px solid rgba(255,95,95,.2);border-radius:var(--rs);padding:10px 12px;font-size:11px;font-family:'DM Mono',monospace;color:var(--re);margin-bottom:14px">Delivery cost: ${fmt(p?.amount||0)} logged against delivery income</div>`;
  } else if(type==='profit-transfer'){
    extra.innerHTML=`<div class="fg"><label class="fl">note</label><input class="finput" id="mc-pt-note" placeholder="e.g. April profit"></div>`;
  } else {
    extra.innerHTML='';
  }
}

function setMpesaSplitProd(p){
  _mpesaSplitProd=p;
  document.getElementById('msp-onesie').className='tbtn'+(p==='onesie'?' sg':'');
  document.getElementById('msp-glasses').className='tbtn'+(p==='glasses'?' sg':'');
  checkExistingSplit();
}

// ──
function checkExistingSplit(){
  const nameEl=document.getElementById('mc-name');
  if(!nameEl)return;
  const name=nameEl.value.trim().toLowerCase();
  const hint=document.getElementById('mc-sp-hint');
  if(!hint)return;
  if(!name){hint.style.display='none';return;}
  const existing=txs.filter(x=>x.t==='split_part'&&x.c.toLowerCase()===name&&x.splitProduct===_mpesaSplitProd);
  if(!existing.length){hint.style.display='none';return;}
  const sum=existing.reduce((a,x)=>a+x.a,0);
  const target=existing[0].splitTotal;
  const pct=Math.min(100,Math.round(sum/target*100));
  hint.style.display='block';
  document.getElementById('mc-sph-title').textContent=existing[0].c+' — split in progress';
  document.getElementById('mc-sph-text').textContent=existing.length+' part(s) · '+fmt(sum)+' of '+fmt(target)+' · '+(sum>=target?'complete!':fmt(target-sum)+' remaining');
  document.getElementById('mc-sph-fill').style.width=pct+'%';
}

function mpesaQtyStep(key,dir){
  if(!_mpesaQtys[key])_mpesaQtys[key]=parseInt(document.getElementById('mq-'+key)?.textContent)||1;
  _mpesaQtys[key]=Math.max(0,_mpesaQtys[key]+dir);
  if(key==='onesie'||key==='mix-onesie')_mpesaQtys[key]=Math.max(key==='mix-onesie'?0:1,_mpesaQtys[key]);
  const el=document.getElementById('mq-'+key);
  if(el)el.textContent=_mpesaQtys[key];
  // update total label
  if(key==='onesie'){const t=document.getElementById('mq-onesie-total');if(t)t.textContent=fmt(_mpesaQtys[key]*999);}
  if(key==='glasses'){const t=document.getElementById('mq-glasses-total');if(t)t.textContent=fmt(_mpesaQtys[key]*420);}
}

// ──
function updateDelCalc(){
  const fee=_parsedMpesa?.amount||0;
  const cost=parseFloat(document.getElementById('mc-del-cost')?.value)||0;
  const net=fee-cost;
  const el=document.getElementById('del-calc');
  if(el)el.innerHTML=`fee charged: ${fmt(fee)} · actual cost: ${fmt(cost)} · <strong style="color:${net>=0?'var(--gr)':'var(--re)'}">${net>=0?'net profit':'net loss'}: ${fmt(Math.abs(net))}</strong>`;
}

// ── MANUAL SALE ──

// ──
function cartStep(prod,dir){
  _cart[prod]=Math.max(0,_cart[prod]+dir);
  document.getElementById('cart-'+prod).textContent=_cart[prod];
  updateCart();
  if(_payType==='split')checkSplitExisting();
}

// ──
function updateCart(){
  const total=_cart.onesie*999+_cart.glasses*420;
  const cs=document.getElementById('cart-summary');
  if(total===0){cs.style.display='none';return;}
  cs.style.display='block';
  let lines='';
  if(_cart.onesie>0)lines+=`<div class="cart-line"><span>Onesie ×${_cart.onesie}</span><span>${fmt(_cart.onesie*999)}</span></div>`;
  if(_cart.glasses>0)lines+=`<div class="cart-line"><span>Glasses ×${_cart.glasses}</span><span>${fmt(_cart.glasses*420)}</span></div>`;
  document.getElementById('cart-lines').innerHTML=lines;
  document.getElementById('cart-total').textContent=fmt(total);
  const profit=_cart.onesie*799+_cart.glasses*270;
  const rst=(_cart.onesie+_cart.glasses)*100;
  const misc=_cart.onesie*100+_cart.glasses*50;
  document.getElementById('cart-split').innerHTML=`
    <div class="spm-ttl">fund split</div>
    <div class="spm-row"><span style="color:var(--mu)">Profit</span><span style="color:var(--gr)">${fmt(profit)}</span></div>
    <div class="spm-row"><span style="color:var(--mu)">Restock</span><span style="color:var(--am)">${fmt(rst)}</span></div>
    <div class="spm-row"><span style="color:var(--mu)">Misc</span><span style="color:var(--bl)">${fmt(misc)}</span></div>`;
}

// ──
function setPayType(pt){
  _payType=pt;
  document.getElementById('pt-full').className='tbtn'+(pt==='full'?' sg':'');
  document.getElementById('pt-split').className='tbtn'+(pt==='split'?' sa':'');
  document.getElementById('split-part-field').style.display=pt==='split'?'block':'none';
}

// ──
function checkSplitExisting(){
  const name=document.getElementById('sale-name').value.trim().toLowerCase();
  const hint=document.getElementById('sp-hint');
  if(!name||_payType!=='split'){hint.style.display='none';return;}
  const total=_cart.onesie*999+_cart.glasses*420;
  const existing=txs.filter(x=>x.t==='split_part'&&x.c.toLowerCase()===name&&x.splitTotal===total);
  if(!existing.length){hint.style.display='none';return;}
  const sum=existing.reduce((a,x)=>a+x.a,0);
  const pct=Math.min(100,Math.round(sum/total*100));
  hint.style.display='block';
  document.getElementById('sph-title').textContent=existing[0].c+' — split in progress';
  document.getElementById('sph-text').textContent=fmt(sum)+' of '+fmt(total)+' paid · '+fmt(total-sum)+' remaining';
  document.getElementById('sph-fill').style.width=pct+'%';
}

// ── WITHDRAWAL ──

// ──
function setWdType(t){
  _wdType=t;
  ['restock','laundry','delivery','misc'].forEach(k=>{document.getElementById('wd-'+k).className='tbtn';});
  document.getElementById('wd-'+t).className='tbtn sa';
  const wf=document.getElementById('wd-fields');
  if(t==='restock'){
    wf.innerHTML=`
      <div class="fg"><label class="fl">amount paid (KSH)</label><input class="finput" id="wd-amt" type="number" placeholder="0"></div>
      <div class="fg"><label class="fl">onesies restocked</label><div style="display:flex;align-items:center"><button class="sb" onclick="wdRstStep('o',-1)">−</button><span class="sv" id="wd-rst-o">0</span><button class="sb" onclick="wdRstStep('o',1)">+</button></div></div>
      <div class="fg"><label class="fl">glasses restocked</label><div style="display:flex;align-items:center"><button class="sb" onclick="wdRstStep('g',-1)">−</button><span class="sv" id="wd-rst-g">0</span><button class="sb" onclick="wdRstStep('g',1)">+</button></div></div>`;
    _rstO=0;_rstG=0;
  } else if(t==='laundry'){
    wf.innerHTML=`
      <div class="fg"><label class="fl">amount (KSH)</label><input class="finput" id="wd-amt" type="number" placeholder="0"></div>
      <div class="fg"><label class="fl">onesies in this wash</label><input class="finput" id="wd-wash-units" type="number" placeholder="e.g. 5"></div>`;
  } else if(t==='delivery'){
    wf.innerHTML=`
      <div class="fg"><label class="fl">actual delivery cost (KSH)</label><input class="finput" id="wd-amt" type="number" placeholder="0"></div>
      <div class="fg"><label class="fl">customer (optional)</label><input class="finput" id="wd-cust" placeholder="e.g. Anna"></div>`;
  } else {
    wf.innerHTML=`
      <div class="fg"><label class="fl">amount (KSH)</label><input class="finput" id="wd-amt" type="number" placeholder="0"></div>
      <div class="fg"><label class="fl">note (optional)</label><input class="finput" id="wd-note" placeholder="what was this for?"></div>`;
  }
}
let _wdRstO=0,_wdRstG=0;

// ──
function wdRstStep(w,d){
  if(w==='o'){_wdRstO=Math.max(0,_wdRstO+d);const el=document.getElementById('wd-rst-o');if(el)el.textContent=_wdRstO;}
  else{_wdRstG=Math.max(0,_wdRstG+d);const el=document.getElementById('wd-rst-g');if(el)el.textContent=_wdRstG;}
}

// ──
function setOther(t){
  _otherType=t;
  document.getElementById('tb-charge').className='tbtn'+(t==='charge'?' sr':'');
  document.getElementById('tb-test').className='tbtn'+(t==='test'?' sg':'');
}

// ── SET MODE ──

// ──
function setMode(m){
  _mode=m;
  ['mpesa','sale','withdrawal','other'].forEach(k=>{document.getElementById('tb-'+k).className='tbtn';});
  const col=m==='withdrawal'||m==='other'?'sr':m==='sale'?'sa':'sg';
  document.getElementById('tb-'+m).className='tbtn '+col;
  ['mpesa','sale','withdrawal','other'].forEach(k=>{document.getElementById('mode-'+k).style.display='none';});
  document.getElementById('mode-'+m).style.display='block';
  if(m==='sale'){_cart={onesie:0,glasses:0};updateCart();setPayType('full');}
  if(m==='withdrawal'){setWdType('restock');}
}

// ── SUBMIT ──

// ──
function submitTx(){
  const dt=document.getElementById('l-date').value||today();
  const nid='u'+Date.now();

  if(_mode==='mpesa'){
    if(!_parsedMpesa||_mpesaSelected.size===0){showToast('Parse a message and classify it');return;}
    const p=_parsedMpesa;
    const ref=p.ref||'MPESA';
    const name=document.getElementById('mc-name')?.value.trim()||p.party||'';
    const types=[..._mpesaSelected];

    // Save customer if name provided
    if(name) customers[name]=customers[name]||{};

    // Process each selected type
    types.forEach((type,idx)=>{
      const am=types.length>1?(parseFloat(document.getElementById('alloc-'+type)?.value)||0):p.amount;
      const tid=nid+(idx>0?String.fromCharCode(98+idx-1):''); // nid, nida, nidb...

      if(type==='onesie'){
        const qty=parseInt(document.getElementById('mq-onesie')?.textContent)||1;
        stock.onesies=Math.max(0,stock.onesies-qty);
        txs.push({id:tid,d:dt,t:'onesie',c:name,a:am,units:qty,note:qty>1?qty+' onesies':'',doc:ref});

      } else if(type==='glasses'){
        const qty=parseInt(document.getElementById('mq-glasses')?.textContent)||1;
        stock.glasses=Math.max(0,stock.glasses-qty);
        txs.push({id:tid,d:dt,t:'glasses',c:name,a:am,units:qty,note:qty>1?qty+' glasses':'',doc:ref});

      } else if(type==='delivery'){
        const cost=parseFloat(document.getElementById('mc-del-cost')?.value)||0;
        const net=am-cost;
        txs.push({id:tid,d:dt,t:'delivery_income',c:name,a:am,deliveryCost:cost,netProfit:net,note:`delivery · cost ${fmt(cost)} · net ${fmt(net)}`,doc:ref});
        if(cost>0)txs.push({id:tid+'x',d:dt,t:'withdrawal',c:name,a:cost,p:'delivery_cost',note:`delivery cost for ${name}`,doc:ref});

      } else if(type==='split'){
        const prod=_mpesaSplitProd;
        const target=(prod==='onesie'?999:420);
        const existing=txs.filter(x=>x.t==='split_part'&&x.c.toLowerCase()===name.toLowerCase()&&x.splitProduct===prod);
        const grp=existing.length?existing[0].splitGroup:name.toLowerCase().replace(/\s+/g,'-')+'-split-'+Date.now();
        const sum=existing.reduce((a,x)=>a+x.a,0)+am;
        const isDone=sum>=target;
        if(isDone){if(prod==='onesie')stock.onesies=Math.max(0,stock.onesies-1);else stock.glasses=Math.max(0,stock.glasses-1);}
        txs.push({id:tid,d:dt,t:'split_part',c:name,a:am,splitGroup:grp,splitTotal:target,splitProduct:prod,note:`split part ${existing.length+1}${isDone?' ✓':''}`,doc:ref});

      } else if(type==='restock'){
        const qo=parseInt(document.getElementById('mq-rst-o')?.textContent)||0;
        const qg=parseInt(document.getElementById('mq-rst-g')?.textContent)||0;
        stock.onesies+=qo;stock.glasses+=qg;
        txs.push({id:tid,d:dt,t:'withdrawal',c:'',a:am,p:'restock',rstO:qo,rstG:qg,note:`restock · ${qo} onesies, ${qg} glasses`,doc:ref});

      } else if(type==='laundry'){
        const wu=parseInt(document.getElementById('mc-wash-units')?.value)||0;
        txs.push({id:tid,d:dt,t:'withdrawal',c:'',a:am,p:'laundry',washUnits:wu,note:`laundry · ${wu} onesies`,doc:ref});

      } else if(type==='del-cost'){
        txs.push({id:tid,d:dt,t:'withdrawal',c:'',a:am,p:'delivery_cost',note:'delivery cost',doc:ref});

      } else if(type==='profit-transfer'){
        const note=document.getElementById('mc-pt-note')?.value.trim()||'';
        profitTransfers.push({id:tid,d:dt,a:am,note,ref});
        txs.push({id:tid+'p',d:dt,t:'withdrawal',c:'',a:am,p:'profit_transfer',note:'profit transfer to separate account',doc:ref});

      } else if(type==='test'){
        txs.push({id:tid,d:dt,t:'test',c:name,a:am,note:'test payment',doc:ref});

      } else if(type==='misc'){
        txs.push({id:tid,d:dt,t:'withdrawal',c:'',a:am,p:'misc',note:'misc / ops',doc:ref});
      }
    });

    saveAll();closeSheet();renderAll();
    showToast(types.length>1?`${types.length} items logged ✓`:`${types[0]} logged ✓`);

  } else if(_mode==='sale'){
    const total=_cart.onesie*999+_cart.glasses*420;
    if(total===0){showToast('Add at least one item');return;}
    const name=document.getElementById('sale-name').value.trim();
    const phone=document.getElementById('sale-phone').value.trim();
    if(!name){showToast('Enter customer name');return;}
    if(phone){customers[name]=customers[name]||{};customers[name].phone=phone;}

    if(_payType==='split'){
      const partAmt=parseFloat(document.getElementById('split-now').value)||0;
      if(!partAmt){showToast('Enter amount received now');return;}
      const grp=name.toLowerCase().replace(/\s+/g,'-')+'-split-'+Date.now();
      const prod=_cart.onesie>0&&_cart.glasses===0?'onesie':'glasses';
      txs.push({id:nid,d:dt,t:'split_part',c:name,a:partAmt,splitGroup:grp,splitTotal:total,splitProduct:prod,note:'split part 1',doc:'MANUAL'});
    } else {
      const orderId='ord-'+Date.now();
      if(_cart.onesie>0){stock.onesies=Math.max(0,stock.onesies-_cart.onesie);txs.push({id:nid,d:dt,t:'onesie',c:name,a:_cart.onesie*999,units:_cart.onesie,note:_cart.onesie>1?_cart.onesie+' onesies':'',doc:'MANUAL',orderId});}
      if(_cart.glasses>0){stock.glasses=Math.max(0,stock.glasses-_cart.glasses);txs.push({id:nid+'b',d:dt,t:'glasses',c:name,a:_cart.glasses*420,units:_cart.glasses,note:_cart.glasses>1?_cart.glasses+' glasses':'',doc:'MANUAL',orderId});}
    }
    saveAll();closeSheet();renderAll();showToast('Sale logged ✓');

  } else if(_mode==='withdrawal'){
    const am=parseFloat(document.getElementById('wd-amt')?.value)||0;
    if(!am){showToast('Enter amount');return;}
    if(_wdType==='restock'){
      stock.onesies+=_wdRstO;stock.glasses+=_wdRstG;
      txs.push({id:nid,d:dt,t:'withdrawal',c:'',a:am,p:'restock',rstO:_wdRstO,rstG:_wdRstG,note:`restock · ${_wdRstO} onesies, ${_wdRstG} glasses`,doc:'MANUAL'});
    } else if(_wdType==='laundry'){
      const wu=parseInt(document.getElementById('wd-wash-units')?.value)||0;
      txs.push({id:nid,d:dt,t:'withdrawal',c:'',a:am,p:'laundry',washUnits:wu,note:`laundry · ${wu} onesies`,doc:'MANUAL'});
    } else if(_wdType==='delivery'){
      const cust=document.getElementById('wd-cust')?.value.trim()||'';
      txs.push({id:nid,d:dt,t:'withdrawal',c:cust,a:am,p:'delivery_cost',note:`delivery cost${cust?' for '+cust:''}`,doc:'MANUAL'});
    } else {
      const note=document.getElementById('wd-note')?.value.trim()||'misc';
      txs.push({id:nid,d:dt,t:'withdrawal',c:'',a:am,p:'misc',note,doc:'MANUAL'});
    }
    saveAll();closeSheet();renderAll();showToast('Withdrawal logged ✓');

  } else if(_mode==='other'){
    const am=parseFloat(document.getElementById('other-amt')?.value)||0;
    const name=document.getElementById('other-name')?.value.trim()||'';
    if(!am){showToast('Enter amount');return;}
    txs.push({id:nid,d:dt,t:_otherType,c:name,a:am,note:'',doc:'MANUAL'});
    saveAll();closeSheet();renderAll();showToast('Logged ✓');
  }
}


// ── AUTOCOMPLETE ──
function getCustomerNames(){
  const fromTxs=txs.filter(x=>x.c).map(x=>x.c);
  const fromCusts=Object.keys(customers);
  return [...new Set([...fromTxs,...fromCusts])].filter(Boolean).sort();
}

function acInput(input, listId){
  const val=input.value.trim().toLowerCase();
  const list=document.getElementById(listId);
  if(!list)return;
  if(!val){list.innerHTML='';list.style.display='none';return;}
  const matches=getCustomerNames().filter(n=>n.toLowerCase().startsWith(val));
  if(!matches.length){list.style.display='none';return;}
  list.style.display='block';
  list.innerHTML=matches.map(n=>`
    <div class="ac-item" onmousedown="acSelect('${input.id}','${listId}','${n}')">${n}</div>`
  ).join('');
}

function acSelect(inputId, listId, name){
  const el=document.getElementById(inputId);
  if(el){
    el.value=name;
    // Trigger any linked listeners
    el.dispatchEvent(new Event('input'));
  }
  const list=document.getElementById(listId);
  if(list){list.innerHTML='';list.style.display='none';}
  // Auto-fill phone if known
  const phone=customers[name]?.phone;
  const phoneEl=document.getElementById('sale-phone');
  if(phone&&phoneEl&&!phoneEl.value)phoneEl.value=phone;
}

function acBlur(listId){
  setTimeout(()=>{
    const list=document.getElementById(listId);
    if(list){list.innerHTML='';list.style.display='none';}
  },150);
}

// ──
function openSheet(){
  document.getElementById('ov').classList.add('on');
  document.getElementById('sh').classList.add('on');
  document.getElementById('l-date').value=today();
  _parsedMpesa=null;_mpesaSelected=new Set();_mpesaAllocs={};_mpesaQtys={};
  _wdRstO=0;_wdRstG=0;
  setMode('mpesa');
  document.getElementById('mpesa-msg').value='';
  document.getElementById('parse-result').style.display='none';
  document.getElementById('mpesa-classify').style.display='none';
  document.getElementById('mpesa-extra').style.display='none';
}

// ──
function closeSheet(){
  document.getElementById('ov').classList.remove('on');
  document.getElementById('sh').classList.remove('on');
}

// ── PROFIT SHEET ──

// ──
function openProfitSheet(){
  document.getElementById('pt-ov').classList.add('on');
  document.getElementById('pt-sh').classList.add('on');
  document.getElementById('pt-date').value=today();
}

// ──
function closeProfitSheet(){
  document.getElementById('pt-ov').classList.remove('on');
  document.getElementById('pt-sh').classList.remove('on');
}

// ──
function parseProfitMsg(){
  const msg=document.getElementById('pt-msg').value.trim();
  if(msg.length<10)return;
  const p=parseSaccoMsg(msg);
  if(!p.amount)return;
  document.getElementById('pt-amt').value=p.amount;
  if(p.date)document.getElementById('pt-date').value=p.date;
  document.getElementById('pt-parse-result').style.display='block';
  document.getElementById('pt-parse-rows').innerHTML=`
    <div class="pr-row"><span class="pr-k">amount</span><span class="pr-v">${fmt(p.amount)}</span></div>
    ${p.date?`<div class="pr-row"><span class="pr-k">date</span><span class="pr-v">${p.date}</span></div>`:''}
    ${p.ref?`<div class="pr-row"><span class="pr-k">ref</span><span class="pr-v">${p.ref}</span></div>`:''}`;
}

// ──
function submitProfitTransfer(){
  const am=parseFloat(document.getElementById('pt-amt').value)||0;
  const note=document.getElementById('pt-note').value.trim();
  const dt=document.getElementById('pt-date').value||today();
  if(!am){showToast('Enter amount');return;}
  const nid='pt'+Date.now();
  profitTransfers.push({id:nid,d:dt,a:am,note:note||'profit transfer'});
  txs.push({id:nid+'t',d:dt,t:'withdrawal',c:'',a:am,p:'profit_transfer',note:note||'profit transfer to profit account',doc:'MANUAL'});
  saveAll();closeProfitSheet();renderAll();showToast('Transfer logged ✓');
}

// ── TX HTML ──

// ──
function txHTML(x){
  const icos={onesie:'👕',glasses:'🕶️',withdrawal:'💸',charge:'🏦',test:'🧪',unresolved:'❓',split_part:'✂️',delivery_income:'🛵'};
  const ibgs={onesie:'var(--gd)',glasses:'var(--bld)',withdrawal:'var(--rd)',charge:'rgba(255,255,255,.04)',test:'rgba(255,255,255,.03)',unresolved:'var(--ad)',split_part:'var(--pd)',delivery_income:'var(--pkd)'};
  const isOut=x.t==='withdrawal'||x.t==='charge';
  const isTest=x.t==='test', isUnres=x.t==='unresolved', isSplit=x.t==='split_part', isDel=x.t==='delivery_income';
  let spBar='';
  if(isSplit){
    const parts=txs.filter(y=>y.t==='split_part'&&y.splitGroup===x.splitGroup);
    const sum=parts.reduce((a,y)=>a+y.a,0);
    const pct=Math.min(100,Math.round(sum/x.splitTotal*100));
    spBar=`<div class="sp-prog"><div class="sp-fill" style="width:${pct}%"></div></div><div class="sp-lbl">${pct}% · ${fmt(sum)} of ${fmt(x.splitTotal)}</div>`;
  }
  let tags='';
  if(isTest) tags='<span class="tag t-te">test</span>';
  else if(isUnres) tags=`<span class="tag t-ur" onclick="event.stopPropagation();openResolve('${x.id}')">⚠ classify</span>`;
  else if(isSplit) tags='<span class="tag t-sp">split</span>';
  else if(isDel) tags=`<span class="tag t-del">delivery · net ${fmt(x.netProfit||0)}</span>`;
  else if(x.t==='onesie') tags=`<span class="tag t-on">onesie${(x.units||1)>1?' ×'+x.units:''}</span>`;
  else if(x.t==='glasses') tags=`<span class="tag t-gl">glasses${(x.units||1)>1?' ×'+x.units:''}</span>`;
  else if(x.t==='withdrawal'&&x.p==='laundry') tags=`<span class="tag t-la">laundry${x.washUnits?' · '+x.washUnits+' onesies':''}</span>`;
  else if(x.t==='withdrawal'&&x.p==='delivery_cost') tags='<span class="tag t-dc">delivery cost</span>';
  else if(x.t==='withdrawal'&&x.p==='profit_transfer') tags='<span class="tag t-pt">profit transfer</span>';
  else if(x.t==='withdrawal') tags=`<span class="tag t-wd">${x.p||'withdrawal'}</span>`;
  else if(x.t==='charge') tags='<span class="tag t-ch">charge</span>';
  const amtCls=isTest?'gr-t':isOut?'dr':'cr';
  const sign=isTest?'':isOut?'−':'+';
  return `<div class="tx" onclick="txTap('${x.id}')">
    <div class="tx-ico" style="background:${ibgs[x.t]||'rgba(255,255,255,.03)'}">${icos[x.t]||'•'}</div>
    <div class="tx-body">
      <div class="tx-name">${x.c||x.t}</div>
      <div class="tx-date">${x.d} · ${x.doc}</div>
      ${x.note?`<div class="tx-note">${x.note}</div>`:''}
      <div class="tx-tags">${tags}</div>
      ${spBar}
    </div>
    <div class="tx-amt"><div class="am ${amtCls}">${sign}${fmt(x.a)}</div></div>
  </div>`;
}

// ──
function txTap(id){
  const x=txs.find(t=>t.id===id);
  if(!x)return;
  if(x.t==='unresolved')openResolve(id);
  else showToast(`${x.c||x.t} · ${fmt(x.a)}`);
}

// ── HOME ──

// ──
function renHome(){
  document.getElementById('live-date').textContent=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}).toLowerCase();
  const t=tots(), total=t.pr+t.rs+t.ms||1;
  const bal=Math.max(0,t.ts+t.delIn-t.wd-t.ch);
  animCount(document.getElementById('h-bal'),bal);
  const hasData=txs.filter(x=>x.t!=='test').length>0;
  document.getElementById('h-sub').innerHTML=hasData?`<span class="up">↑ ${fmt(t.ts)}</span> in verified sales`:'tap + to log your first transaction';

  // fund cards
  document.getElementById('fund-row').innerHTML=[
    {cls:'profit',label:'PROFIT',val:t.realProfit,pct:Math.round(t.pr/total*100)},
    {cls:'restock',label:'RESTOCK',val:t.rs,pct:Math.round(t.rs/total*100)},
    {cls:'misc',label:'MISC',val:t.ms,pct:Math.round(t.ms/total*100)}
  ].map(b=>`<div class="fc ${b.cls}" onclick="showToast('${b.label}: ${fmt(b.val)}')">
    <div class="fc-glow"></div>
    <div class="fc-lbl">${b.label}</div>
    <div class="fc-val" id="fc-${b.cls}">0</div>
    <div class="fc-pct">${b.pct}%</div>
  </div>`).join('');
  setTimeout(()=>{
    animCount(document.getElementById('fc-profit'),t.realProfit);
    animCount(document.getElementById('fc-restock'),t.rs);
    animCount(document.getElementById('fc-misc'),t.ms);
  },80);
  setTimeout(()=>{
    document.getElementById('bp').style.width=(t.pr/total*100)+'%';
    document.getElementById('br').style.width=(t.rs/total*100)+'%';
    document.getElementById('bm').style.width=(t.ms/total*100)+'%';
  },160);

  // alerts
  const al=[];
  if(t.unres>0){const uid=txs.find(x=>x.t==='unresolved')?.id;al.push(`<div class="alert" onclick="openResolve('${uid}')"><div class="alert-l"><div class="alert-dot"></div><div><div class="alert-title">Unclassified payment — ${fmt(t.unres)}</div><div class="alert-sub">tap to resolve</div></div></div><div class="alert-arr">›</div></div>`);}
  if(stock.onesies<=LOW_STOCK)al.push(`<div class="alert red" onclick="goTab('rst')"><div class="alert-l"><div class="alert-dot"></div><div><div class="alert-title">Onesie stock low — ${stock.onesies} left</div><div class="alert-sub">tap to restock →</div></div></div><div class="alert-arr">›</div></div>`);
  if(stock.glasses<=LOW_STOCK)al.push(`<div class="alert red" onclick="goTab('rst')"><div class="alert-l"><div class="alert-dot"></div><div><div class="alert-title">Glasses stock low — ${stock.glasses} left</div><div class="alert-sub">tap to restock →</div></div></div><div class="alert-arr">›</div></div>`);
  document.getElementById('alerts').innerHTML=al.join('');

  // stats
  document.getElementById('stat-row').innerHTML=`
    <div class="stat"><div class="stat-lbl">onesies sold</div><div class="stat-val" style="color:var(--gr)" id="sc-oc">0</div><div class="stat-sub">${fmt(t.os)}</div></div>
    <div class="stat"><div class="stat-lbl">glasses sold</div><div class="stat-val" style="color:var(--bl)" id="sc-gc">0</div><div class="stat-sub">${fmt(t.gs)}</div></div>`;
  setTimeout(()=>{animCount(document.getElementById('sc-oc'),t.oc);animCount(document.getElementById('sc-gc'),t.gc);},100);

  // velocity
  const vel=velocity();
  const tCls={up:'t-up',flat:'t-flat',down:'t-down',new:'t-new'}[vel.trend];
  const tLbl={up:'↑ trending up',flat:'→ steady',down:'↓ slowing',new:'— just started'}[vel.trend];
  document.getElementById('vel-inner').innerHTML=vel.weeklyAvg>0?`
    <div class="vel-row"><span class="vel-k">weekly avg</span><span class="vel-v">${vel.weeklyAvg.toFixed(1)} orders</span></div>
    <div class="vel-row"><span class="vel-k">trend</span><span class="vel-v ${tCls}">${tLbl}</span></div>
    <div class="vel-row"><span class="vel-k">last sale</span><span class="vel-v ${vel.daysSinceLast>7?'t-down':''}">${vel.daysSinceLast===0?'today':vel.daysSinceLast===1?'yesterday':vel.daysSinceLast+' days ago'}</span></div>`
    :`<div style="font-size:12px;color:var(--mu);font-family:'DM Mono',monospace;padding:6px 0">no sales yet</div>`;

  // delivery
  const delTxs=txs.filter(x=>x.t==='delivery_income');
  const di=document.getElementById('del-inner');
  if(!delTxs.length){di.innerHTML=`<div style="font-size:12px;color:var(--mu);font-family:'DM Mono',monospace;padding:6px 0">no deliveries yet</div>`;}
  else{
    const totalFee=delTxs.reduce((a,x)=>a+x.a,0);
    const totalCost=delTxs.reduce((a,x)=>a+(x.deliveryCost||0),0);
    const totalNet=delTxs.reduce((a,x)=>a+(x.netProfit||0),0);
    di.innerHTML=`
      <div class="del-row"><span class="del-k">total fees charged</span><span class="del-v" style="color:var(--gr)">${fmt(totalFee)}</span></div>
      <div class="del-row"><span class="del-k">total delivery costs</span><span class="del-v" style="color:var(--re)">${fmt(totalCost)}</span></div>
      <div class="del-row"><span class="del-k">net delivery income</span><span class="del-v" style="color:${totalNet>=0?'var(--gr)':'var(--re)'}">${fmt(totalNet)}</span></div>
      <div class="del-row"><span class="del-k">deliveries made</span><span class="del-v">${delTxs.length}</span></div>`;
  }

  // laundry
  const laTxs=txs.filter(x=>x.t==='withdrawal'&&x.p==='laundry');
  const li=document.getElementById('laundry-inner');
  if(!laTxs.length){li.innerHTML=`<div style="font-size:12px;color:var(--mu);font-family:'DM Mono',monospace;padding:6px 0">no laundry costs yet</div>`;}
  else{
    const totalW=laTxs.reduce((a,x)=>a+x.a,0);
    const totalU=laTxs.reduce((a,x)=>a+(x.washUnits||0),0);
    const cpu=totalU>0?Math.round(totalW/totalU):0;
    li.innerHTML=`
      <div class="lc-row"><span class="lc-k">total spent</span><span class="lc-v">${fmt(totalW)}</span></div>
      <div class="lc-row"><span class="lc-k">wash cycles</span><span class="lc-v">${laTxs.length}</span></div>
      <div class="lc-row"><span class="lc-k">onesies washed</span><span class="lc-v">${totalU}</span></div>
      <div class="lc-row"><span class="lc-k">cost per onesie</span><span class="lc-v">${cpu>0?fmt(cpu):'—'}</span></div>
      <div class="lc-row"><span class="lc-k">deducted from profit</span><span class="lc-v" style="color:var(--re)">−${fmt(totalW)}</span></div>`;
  }

  // chart
  const custMap={};
  txs.filter(x=>x.c&&(x.t==='onesie'||x.t==='glasses'||x.t==='split_part'||x.t==='delivery_income'))
    .forEach(x=>{custMap[x.c]=(custMap[x.c]||0)+x.a;});
  const sorted=Object.entries(custMap).sort((a,b)=>b[1]-a[1]).slice(0,7);
  const maxV=sorted[0]?.[1]||1;
  const cols=['var(--gr)','var(--bl)','var(--pu)','var(--am)','var(--re)','var(--gr)','var(--bl)'];
  const ci=document.getElementById('chart-inner');
  if(!sorted.length){ci.innerHTML=`<div style="font-size:12px;color:var(--mu);font-family:'DM Mono',monospace;text-align:center;padding:16px 0">no sales yet</div>`;}
  else{
    ci.innerHTML=`<div class="bars">${sorted.map(([n,v],i)=>`
      <div class="bar-col">
        <div class="bar-b" style="height:0%;background:${cols[i]};flex:1" data-h="${Math.round(v/maxV*100)}">
          <div class="bar-tip">${n}: ${fmt(v)}</div>
        </div>
        <div class="bar-lbl">${n.slice(0,4)}</div>
      </div>`).join('')}</div>`;
    setTimeout(()=>{document.querySelectorAll('.bar-b').forEach(b=>{b.style.transition='height .7s cubic-bezier(.4,0,.2,1)';b.style.height=b.dataset.h+'%';});},250);
  }

  // recent
  const recent=[...txs].reverse().filter(x=>x.t!=='test').slice(0,4);
  const rl=document.getElementById('recent-list');
  rl.innerHTML=recent.length?recent.map(txHTML).join(''):`<div class="empty"><div class="empty-ico">📦</div><div class="empty-title">Nothing here yet</div><div class="empty-sub">Tap + to log your first transaction</div></div>`;
}

// ── HISTORY ──
const FILTERS=[{k:'all',l:'All'},{k:'onesie',l:'👕 Onesies'},{k:'glasses',l:'🕶 Glasses'},{k:'split_part',l:'✂️ Splits'},{k:'delivery_income',l:'🛵 Delivery'},{k:'withdrawal',l:'💸 Withdrawals'},{k:'charge',l:'🏦 Charges'},{k:'test',l:'🧪 Tests'}];

// ──
function renHist(){
  document.getElementById('pills').innerHTML=FILTERS.map(f=>`<button class="pill${hFilter===f.k?' on':''}" onclick="setFilter('${f.k}')">${f.l}</button>`).join('');
  const list=hFilter==='all'?[...txs].reverse():[...txs].filter(x=>x.t===hFilter).reverse();
  const hl=document.getElementById('hist-list');
  hl.innerHTML=list.length?list.map(txHTML).join(''):`<div class="empty"><div class="empty-ico">🔍</div><div class="empty-title">Nothing here</div><div class="empty-sub">No entries in this category</div></div>`;
}

// ──
function setFilter(f){hFilter=f;renHist();}

// ── CUSTOMERS ──

// ──
function renCust(){
  const custMap={};
  txs.filter(x=>x.c&&(x.t==='onesie'||x.t==='glasses'||x.t==='split_part'||x.t==='delivery_income'))
    .forEach(x=>{
      if(!custMap[x.c])custMap[x.c]={name:x.c,total:0,orders:0,lastDate:'',phone:customers[x.c]?.phone||''};
      custMap[x.c].total+=x.a;custMap[x.c].orders+=1;
      if(!custMap[x.c].lastDate||x.d>custMap[x.c].lastDate)custMap[x.c].lastDate=x.d;
    });
  const list=Object.values(custMap).sort((a,b)=>b.total-a.total);
  const cl=document.getElementById('cust-list');
  if(!list.length){cl.innerHTML=`<div class="empty"><div class="empty-ico">👥</div><div class="empty-title">No customers yet</div><div class="empty-sub">Customers appear after first sale</div></div>`;return;}
  cl.innerHTML=list.map(c=>{
    const initials=c.name.slice(0,2).toUpperCase();
    const ds=daysBetween(c.lastDate,today());
    const churn=ds>21;
    return `<div class="cust-item" onclick="custTap('${c.name}')">
      <div class="cust-av">${initials}</div>
      <div class="cust-body">
        <div class="cust-name">${c.name}</div>
        <div class="cust-meta">last order ${ds===0?'today':ds===1?'yesterday':ds+' days ago'}</div>
        ${c.phone?`<div class="cust-phone">📞 ${c.phone}</div>`:`<div class="cust-phone" style="color:var(--dim)">tap to add phone</div>`}
        ${churn?`<div style="margin-top:4px"><span class="tag" style="background:var(--rd);color:var(--re)">⚠ ${ds}d — follow up</span></div>`:''}
      </div>
      <div class="cust-right">
        <div class="cust-total">${fmt(c.total)}</div>
        <div class="cust-orders">${c.orders} order${c.orders===1?'':'s'}</div>
      </div>
    </div>`;
  }).join('');
}

// ──
function custTap(name){
  const c=customers[name];
  if(c?.phone){if(confirm(`Call ${name}?\n${c.phone}`))window.location.href='tel:'+c.phone.replace(/\s/g,'');}
  else{const p=prompt(`Add phone number for ${name}:`);if(p&&p.trim()){customers[name]=customers[name]||{};customers[name].phone=p.trim();saveAll();renCust();showToast('Phone saved ✓');}}
}

// ── PROFIT ACCOUNT ──

// ──
function renProfit(){
  const total=profitTransfers.reduce((a,x)=>a+x.a,0);
  animCount(document.getElementById('profit-total'),total);
  document.getElementById('profit-sub').textContent=profitTransfers.length?`${profitTransfers.length} transfer${profitTransfers.length===1?'':'s'} logged`:'nothing transferred yet';
  const pl=document.getElementById('profit-transfers');
  if(!profitTransfers.length){pl.innerHTML=`<div class="empty"><div class="empty-ico">◐</div><div class="empty-title">No transfers yet</div><div class="empty-sub">Paste your SACCO transfer message<br>each time you move profit out</div></div>`;return;}
  pl.innerHTML=[...profitTransfers].reverse().map(pt=>`
    <div class="pt-item">
      <div class="pt-left">
        <div class="pt-name">${pt.note||'profit transfer'}</div>
        <div class="pt-date">${pt.d}${pt.ref?' · '+pt.ref:''}</div>
      </div>
      <div class="pt-amt">+${fmt(pt.a)}</div>
    </div>`).join('');
}

// ── RESTOCK ──

// ──
function renRst(){
  const t=tots(), net=Math.max(0,t.rs-txs.filter(x=>x.t==='withdrawal'&&x.p==='restock').reduce((a,x)=>a+x.a,0));
  animCount(document.getElementById('rst-amt'),net);
  document.getElementById('rst-units').textContent=Math.floor(net/100)+' units affordable @ KSH 100 each';
  const oLow=stock.onesies<=LOW_STOCK, gLow=stock.glasses<=LOW_STOCK;
  document.getElementById('stock-row').innerHTML=`
    <div class="stock-card${oLow?' low':''}">
      <div class="sc-lbl">onesies in stock</div>
      <div class="sc-val" style="color:${oLow?'var(--re)':'var(--gr)'}">${stock.onesies}</div>
      <div class="sc-sub">units</div>
      ${oLow?`<div class="sc-alert">⚠ restock soon</div>`:''}
    </div>
    <div class="stock-card${gLow?' low':''}">
      <div class="sc-lbl">glasses in stock</div>
      <div class="sc-val" style="color:${gLow?'var(--re)':'var(--bl)'}">${stock.glasses}</div>
      <div class="sc-sub">units</div>
      ${gLow?`<div class="sc-alert">⚠ restock soon</div>`:''}
    </div>`;
  calcRs();
  const ws=txs.filter(x=>x.t==='withdrawal');
  const wl=document.getElementById('rst-wds');
  wl.innerHTML=ws.length?ws.map(txHTML).join(''):`<div class="empty"><div class="empty-ico">💸</div><div class="empty-title">No withdrawals yet</div><div class="empty-sub">Restock and laundry appear here</div></div>`;
}

// ──
function step(w,d){
  if(w==='o'){_so=Math.max(0,_so+d);document.getElementById('sv-o').textContent=_so;}
  else{_sg=Math.max(0,_sg+d);document.getElementById('sv-g').textContent=_sg;}
  calcRs();
}

// ──
function calcRs(){
  const t=tots(), net=Math.max(0,t.rs-txs.filter(x=>x.t==='withdrawal'&&x.p==='restock').reduce((a,x)=>a+x.a,0));
  const cost=(_so+_sg)*100, ok=cost<=net, short=cost-net;
  document.getElementById('pl-result').innerHTML=`
    <div class="pl-row"><span>Onesies (${_so})</span><span>${fmt(_so*100)}</span></div>
    <div class="pl-row"><span>Sunglasses (${_sg})</span><span>${fmt(_sg*100)}</span></div>
    <div class="pl-total"><span>Total</span><span style="color:${ok?'var(--gr)':'var(--re)'}">${fmt(cost)}</span></div>
    <div class="pl-verdict" style="color:${ok?'var(--gr)':'var(--re)'}">${ok?'✓ fund covers this':'✗ short by '+fmt(short)}</div>`;
}

// ── RESOLVE ──

// ──
function openResolve(id){
  if(!id)return;
  _resId=id;
  const x=txs.find(t=>t.id===id);
  if(!x)return;
  document.getElementById('res-title').textContent=`Classify ${x.c}'s payment`;
  document.getElementById('res-sub').textContent=fmt(x.a)+' · '+x.d+' · '+x.doc;
  document.getElementById('res-opts').innerHTML=`
    <div class="ropt" onclick="resolveAs('onesie',1)"><div class="ropt-title">👕 1 Onesie</div><div class="ropt-sub">KSH 999 · profit KSH 799</div></div>
    <div class="ropt" onclick="resolveAs('onesie',2)"><div class="ropt-title">👕👕 2 Onesies</div><div class="ropt-sub">KSH 1,998 · profit KSH 1,598</div></div>
    <div class="ropt" onclick="resolveAs('glasses',1)"><div class="ropt-title">🕶 1 Sunglasses</div><div class="ropt-sub">KSH 420 · profit KSH 270</div></div>
    <div class="ropt" onclick="resolveAs('glasses',3)"><div class="ropt-title">🕶🕶🕶 3 Sunglasses</div><div class="ropt-sub">KSH 1,260 · profit KSH 810</div></div>
    <div class="ropt" onclick="resolveAs('mixed',0)"><div class="ropt-title">👕 + 🕶 Mixed order</div><div class="ropt-sub">1 onesie + 1 sunglasses</div></div>
    <div class="ropt danger" onclick="resolveAs('test',0)"><div class="ropt-title">🧪 Mark as test</div><div class="ropt-sub">exclude from all calculations</div></div>`;
  document.getElementById('res-ov').classList.add('on');
}

// ──
function closeResolve(){document.getElementById('res-ov').classList.remove('on');}

// ──
function resolveAs(product,units){
  const idx=txs.findIndex(x=>x.id===_resId);
  if(idx<0){closeResolve();return;}
  const tx=txs[idx];
  if(product==='test') txs[idx]={...tx,t:'test',note:'marked as test'};
  else if(product==='mixed'){
    txs[idx]={...tx,t:'onesie',units:1,note:'classified: 1 onesie'};
    txs.splice(idx+1,0,{id:tx.id+'b',d:tx.d,t:'glasses',c:tx.c,a:420,units:1,note:'classified: 1 sunglasses',doc:tx.doc});
  } else txs[idx]={...tx,t:product,units,note:`classified: ${units} ${product}(s)`};
  saveAll();closeResolve();renderAll();showToast('Classified ✓');
}

// ── PDF EXPORT ──

// ──
function exportPDF(){
  const t=tots();
  const vel=velocity();
  const bal=Math.max(0,t.ts+t.delIn-t.wd-t.ch);
  const profitOut=profitTransfers.reduce((a,x)=>a+x.a,0);
  const ds=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  const rows=[...txs].reverse().filter(x=>x.t!=='test').map(x=>{
    const isOut=x.t==='withdrawal'||x.t==='charge';
    return `<tr><td>${x.d}</td><td>${x.c||x.t}</td><td>${x.t==='withdrawal'&&x.p?x.p:x.t}</td><td style="color:${isOut?'#c00':'#060'};font-weight:600">${isOut?'−':'+'}KSH ${f(x.a)}</td><td>${x.note||''}</td></tr>`;
  }).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;color:#111;padding:32px;max-width:720px;margin:0 auto}h1{font-size:24px;margin-bottom:2px}p{font-size:12px;color:#888;margin-bottom:20px}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px}.box{border:1px solid #e0e0e0;border-radius:8px;padding:12px}.box .l{font-size:10px;color:#888;text-transform:uppercase;margin-bottom:3px}.box .v{font-size:20px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;padding:7px 9px;background:#f5f5f5;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase}td{padding:6px 9px;border-bottom:1px solid #f0f0f0}.ft{margin-top:20px;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:10px}</style></head><body>
  <h1>Solance & Co</h1><p>Statement · ${ds} · Acc 315172421011</p>
  <div class="grid">
    <div class="box"><div class="l">Balance</div><div class="v">KSH ${f(bal)}</div></div>
    <div class="box"><div class="l">Sales</div><div class="v">KSH ${f(t.ts)}</div></div>
    <div class="box"><div class="l">Real profit</div><div class="v" style="color:#060">KSH ${f(t.realProfit)}</div></div>
    <div class="box"><div class="l">Restock fund</div><div class="v" style="color:#c70">KSH ${f(t.rs)}</div></div>
    <div class="box"><div class="l">Delivery income</div><div class="v">KSH ${f(t.delIn)}</div></div>
    <div class="box"><div class="l">Laundry costs</div><div class="v">KSH ${f(t.laundry)}</div></div>
    <div class="box"><div class="l">Onesies sold</div><div class="v">${t.oc} units</div></div>
    <div class="box"><div class="l">Glasses sold</div><div class="v">${t.gc} units</div></div>
    <div class="box"><div class="l">Profit transferred</div><div class="v" style="color:#060">KSH ${f(profitOut)}</div></div>
  </div>
  <table><thead><tr><th>Date</th><th>From/To</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="ft">Solance & Co · ${ds}</div></body></html>`;
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`solance-${today()}.html`;a.click();
  URL.revokeObjectURL(url);
  showToast('Statement downloaded ✓');
}


// ── DATA EXPORT / IMPORT ──

function exportData(){
  const payload={
    version: 1,
    exported: new Date().toISOString(),
    txs,
    customers,
    stock,
    profitTransfers
  };
  const json=JSON.stringify(payload, null, 2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`solance-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded ✓');
}

function triggerImport(){
  document.getElementById('import-file-input').click();
}

function handleImport(e){
  const file=e.target.files[0];
  if(!file){return;}
  const reader=new FileReader();
  reader.onload=function(ev){
    try{
      const data=JSON.parse(ev.target.result);
      // Validate it looks like our backup
      if(!data.txs||!Array.isArray(data.txs)){
        showToast('Invalid backup file');
        return;
      }
      // Show confirmation with counts
      const msg=`Import ${data.txs.length} transactions, ${Object.keys(data.customers||{}).length} customers?\n\nThis will REPLACE your current data.`;
      if(!confirm(msg)){return;}
      // Apply
      txs=data.txs||[];
      customers=data.customers||{};
      stock=data.stock||{onesies:0,glasses:0};
      profitTransfers=data.profitTransfers||[];
      saveAll();
      renderAll();
      showToast(`Imported ${txs.length} transactions ✓`);
    } catch(err){
      showToast('Could not read file');
    }
  };
  reader.readAsText(file);
  // Reset input so same file can be re-imported if needed
  e.target.value='';
}

// ── NAV ──

// ──
function goTab(t){
  activeTab=t;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  document.getElementById('s-'+t).classList.add('on');
  const te=document.getElementById('tab-'+t);if(te)te.classList.add('on');
  if(t==='home')renHome();
  else if(t==='hist')renHist();
  else if(t==='cust')renCust();
  else if(t==='profit')renProfit();
  else if(t==='rst')renRst();
}

// ──
function renderAll(){
  if(activeTab==='home')renHome();
  else if(activeTab==='hist')renHist();
  else if(activeTab==='cust')renCust();
  else if(activeTab==='profit')renProfit();
  else if(activeTab==='rst')renRst();
}

// ──
function showToast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('on');
  setTimeout(()=>el.classList.remove('on'),2200);
}

// ── INIT ──
renHome();
// Hidden file input for import
const _fi=document.createElement('input');
_fi.type='file';
_fi.accept='.json';
_fi.id='import-file-input';
_fi.style.display='none';
_fi.addEventListener('change',handleImport);
document.body.appendChild(_fi);
document.querySelector('.app').insertAdjacentHTML('beforeend',`<button class="pdf-btn" onclick="exportPDF()">📄 Export statement</button>`);
