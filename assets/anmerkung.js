/* ── BACKGROUND PARTICLES ── */
(function(){
  const cv=document.getElementById('bg-canvas'),cx=cv.getContext('2d');
  let W,H,t=0,pts=[];
  const PAL=[[52,211,153],[91,156,246],[212,175,100],[167,139,250]];
  let mouse={x:-9999,y:-9999};
  function resize(){W=cv.width=window.innerWidth;H=cv.height=window.innerHeight}
  function mkpt(){const c=PAL[Math.floor(Math.random()*PAL.length)];return{x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.18,vy:(Math.random()-.5)*.13,r:Math.random()*1.8+.5,a:Math.random()*.35+.05,da:(Math.random()*.0006+.0002)*(Math.random()<.5?1:-1),c,ph:Math.random()*Math.PI*2}}
  function init(){resize();pts=Array.from({length:Math.min(Math.floor(W*H/11000),100)},mkpt)}
  let last=0;
  /* A `running` flag guards against concurrent RAF chains. Without it, a rapid
     hide/show sequence could queue one RAF from the visibilitychange handler
     AND from inside a completing frame, leaving two animation loops running
     in parallel (particles moving at 2× speed, CPU doubled). The guard
     ensures at most one frame is ever in flight. */
  let running=false;
  function scheduleFrame(){
    if (running) return;
    if (document.hidden) return;
    if (window.Grimoire && window.Grimoire.reducedMotion) return;
    running=true;
    requestAnimationFrame(frame);
  }
  function frame(ts){
    running=false;
    const dt=Math.min((ts-last)/16.67,2.5);last=ts;t+=.003*dt;cx.clearRect(0,0,W,H);
    [{x:W*.15,y:H*-.08,rx:W*.55,ry:H*.35,c:[52,211,153],a:.022},{x:W*.8,y:H*-.1,rx:W*.45,ry:H*.3,c:[91,156,246],a:.02},{x:W*.5,y:H*1.05,rx:W*.55,ry:H*.35,c:[212,175,100],a:.014}].forEach(a=>{
      const p=a.a+.007*Math.sin(t*1.3+a.x*.004);const g=cx.createRadialGradient(a.x,a.y,0,a.x,a.y,Math.hypot(a.rx,a.ry)*.62);g.addColorStop(0,`rgba(${a.c},${p})`);g.addColorStop(.5,`rgba(${a.c},${p*.25})`);g.addColorStop(1,'transparent');cx.save();cx.translate(a.x,a.y);cx.scale(a.rx/a.ry,1);cx.translate(-a.x,-a.y);cx.fillStyle=g;cx.beginPath();cx.arc(a.x,a.y,a.ry,0,Math.PI*2);cx.fill();cx.restore();
    });
    for(let i=0;i<pts.length;i++){const p=pts[i];for(let j=i+1;j<pts.length;j++){const q=pts[j];const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<120){cx.strokeStyle=`rgba(${p.c},${(1-d/120)*.045})`;cx.lineWidth=.4;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(q.x,q.y);cx.stroke()}}const md=Math.hypot(p.x-mouse.x,p.y-mouse.y);if(md<160){cx.strokeStyle=`rgba(${p.c},${(1-md/160)*.22})`;cx.lineWidth=.6;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(mouse.x,mouse.y);cx.stroke()}}
    pts.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.a+=p.da*dt;if(p.a<.04||p.a>.48)p.da*=-1;if(p.x<-15)p.x=W+15;if(p.x>W+15)p.x=-15;if(p.y<-15)p.y=H+15;if(p.y>H+15)p.y=-15;const rdx=p.x-mouse.x,rdy=p.y-mouse.y,rd=Math.sqrt(rdx*rdx+rdy*rdy);if(rd<100&&rd>0){const f=(1-rd/100)*.4;p.vx+=(rdx/rd)*f*.035;p.vy+=(rdy/rd)*f*.035}const sp=Math.hypot(p.vx,p.vy);if(sp>.45){p.vx*=.45/sp;p.vy*=.45/sp}const bx=.5*Math.sin(t*1.1+p.ph),by=.5*Math.cos(t*.88+p.ph*1.3);cx.beginPath();cx.arc(p.x+bx,p.y+by,p.r,0,Math.PI*2);cx.fillStyle=`rgba(${p.c},${p.a})`;cx.fill()});
    scheduleFrame();
  }
  window.addEventListener('resize',init);window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});window.addEventListener('mouseleave',()=>{mouse.x=-9999;mouse.y=-9999});
  init();
  if (window.Grimoire && window.Grimoire.reducedMotion) { frame(0); }
  else { scheduleFrame(); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) scheduleFrame(); }); }
})();

/* ══════════════════════════════════════════════════════════
   SUBSCRIPTION GATE
══════════════════════════════════════════════════════════ */
let subPendingAction = null;

function openRunGate() {
  subPendingAction = 'run';
  openSubModal();
}
function openSubModal() {
  document.getElementById('sub-default').style.display = '';
  document.getElementById('sub-thankyou').classList.remove('show');
  document.getElementById('sub-overlay').classList.add('open');
}
function closeSubModal() {
  document.getElementById('sub-overlay').classList.remove('open');
  subPendingAction = null;
}
function handleSubBgClick(e) {
  if (e.target === document.getElementById('sub-overlay')) closeSubModal();
}
function handleBuySubscription() {
  document.getElementById('sub-default').style.display = 'none';
  document.getElementById('sub-thankyou').classList.add('show');
}
function proceedAfterPurchase() {
  document.getElementById('sub-overlay').classList.remove('open');
  const action = subPendingAction;
  subPendingAction = null;
  if (action === 'run') runProcess();
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSubModal(); });

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
let selectedFW=null,rawFileBytes=null,workbook=null,resultBlob=null,originalFileName='';
/* Thresholds are mutable + persisted (feature #8). Defaults chosen to preserve original behavior. */
const TH_DEFAULTS={dachser:0.08,kn:0.09,dhl:0.04,wackler:0.09};
const TH_KEY='anmerkung.thresholds.v1';
let TH={...TH_DEFAULTS};
(function loadTh(){try{const saved=JSON.parse(localStorage.getItem(TH_KEY)||'null');if(saved&&typeof saved==='object')TH={...TH_DEFAULTS,...saved};}catch(_){}})();
/* Dynamic threshold accessors — used everywhere the old constants were used. */
let T_DACHSER=TH.dachser,T_KN=TH.kn,T_DHL=TH.dhl,T_WACKLER=TH.wackler;
function applyThresholds(){T_DACHSER=TH.dachser;T_KN=TH.kn;T_DHL=TH.dhl;T_WACKLER=TH.wackler;}
function saveThresholds(){try{localStorage.setItem(TH_KEY,JSON.stringify(TH));}catch(_){}}
function syncThFields(){document.getElementById('thDachser').value=TH.dachser;document.getElementById('thKN').value=TH.kn;document.getElementById('thDHL').value=TH.dhl;document.getElementById('thWackler').value=TH.wackler;}
function onThInput(key,el){const n=parseFloat(el.value);if(!isNaN(n)&&n>=0){TH[key]=n;applyThresholds();saveThresholds();}}
function resetThresholds(){TH={...TH_DEFAULTS};applyThresholds();saveThresholds();syncThFields();}
function toggleAdv(){const t=document.getElementById('advToggle'),p=document.getElementById('advPanel');const open=!p.classList.contains('open');p.classList.toggle('open',open);t.classList.toggle('open',open);t.setAttribute('aria-expanded',open?'true':'false');}
document.addEventListener('DOMContentLoaded',()=>{
  syncThFields();
  [['thDachser','dachser'],['thKN','kn'],['thDHL','dhl'],['thWackler','wackler']].forEach(([id,key])=>{
    const el=document.getElementById(id);
    el.addEventListener('input',()=>onThInput(key,el));
    el.addEventListener('change',()=>onThInput(key,el));
  });
  setVersionBadge();
  loadChangelog();
});

/* Changelog Escape key handling (separate because theme modal uses same key). */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    const cl=document.getElementById('cl-overlay');
    if(cl&&cl.classList.contains('open'))closeChangelog();
  }
});

/* ══════════════════════════════════════════════════════════
   VERSION + CHANGELOG (#24)
   Data lives in assets/anmerkung-changelog.json so the release
   notes can be edited without touching the app shell. The file
   is precached by the service worker so offline mode still has
   the full history.
══════════════════════════════════════════════════════════ */
const CHANGELOG_URL='assets/anmerkung-changelog.json';
let VERSION='0.0.0';
let CHANGELOG=[];
async function loadChangelog(){
  try{
    const r=await fetch(CHANGELOG_URL,{cache:'no-cache'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    VERSION=String(d.version||'0.0.0');
    CHANGELOG=Array.isArray(d.entries)?d.entries:[];
  }catch(err){
    /* Leave defaults; render an explanatory empty state. */
    console.warn('[changelog] load failed:',err);
  }
  setVersionBadge();
  renderChangelog();
}
function setVersionBadge(){const b=document.getElementById('verBadge');if(b)b.textContent='v'+VERSION;const sub=document.getElementById('clSub');if(sub)sub.textContent='// The Alchemist \u00b7 v'+VERSION;}
function renderChangelog(){
  const list=document.getElementById('clList');if(!list)return;
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if(!CHANGELOG.length){
    list.innerHTML='<div class="cl-entry" style="opacity:.6"><span class="cl-ver">—</span><span class="cl-date">offline</span><ul class="cl-items"><li>Changelog data could not be loaded.</li></ul></div>';
    return;
  }
  list.innerHTML=CHANGELOG.map(e=>
    `<div class="cl-entry"><span class="cl-ver">v${esc(e.ver)}</span><span class="cl-date">${esc(e.date)}</span>`+
    `<ul class="cl-items">${(e.items||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`
  ).join('');
}
function openChangelog(){document.getElementById('cl-overlay').classList.add('open');}
function closeChangelog(){document.getElementById('cl-overlay').classList.remove('open');}
function handleClBgClick(e){if(e.target===document.getElementById('cl-overlay'))closeChangelog();}

/* ══════════════════════════════════════════════════════════
   THEME TOGGLE — "Scriptorium" light (#13)
══════════════════════════════════════════════════════════ */
const THEME_KEY='anmerkung.theme.v1';
function applyTheme(t){
  const light=t==='light';
  document.body.classList.toggle('theme-light',light);
  const btn=document.getElementById('btnTheme'),lbl=document.getElementById('themeLabel');
  if(btn)btn.setAttribute('aria-pressed',light?'true':'false');
  if(lbl)lbl.textContent=light?'Light':'Dark';
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',light?'#f4efe3':'#02020a');
}
function toggleTheme(){
  const cur=document.body.classList.contains('theme-light')?'light':'dark';
  const next=cur==='light'?'dark':'light';
  applyTheme(next);
  try{localStorage.setItem(THEME_KEY,next);}catch(_){}
}
(function loadTheme(){try{const saved=localStorage.getItem(THEME_KEY);if(saved==='light'||saved==='dark')applyTheme(saved);}catch(_){}})();

/* ══════════════════════════════════════════════════════════
   PHRASE CATALOG (#11 partial) — single source of truth for all
   rule output strings. Rule engine imports from here; Rule Tester
   uses the same catalog. Changing wording is now a 1-line edit.
══════════════════════════════════════════════════════════ */
const PHRASES={
  // Dachser
  ausfallfracht:              'AUSFALLFRACHT',
  standgeld:                  'Standgeld',
  speditionskostenGemText:    'Speditionskosten gem. Text',
  ausfallfrachtSchadensersatz:'Ausfallfracht/Schadensersatz',
  snkTelAnk:                  'Differenz Telefonische Zustellankündigung - Laderaumzuschlag',
  snkAutoZustell:             'Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag',
  snkLaderaumEntw:            'Differenz Laderaumkostenentwicklung',
  adminZeitfenster:           'Admin Zeitfensterbuchung Handel',
  adminZeitfensterDiff:       'Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag',
  snkTelZustell:              'Differenz Telefonische Zustellterminvereinbarung - Laderaumzuschlag',
  terminZuschlag:             'Termin-zuschlag',
  produktZuschlag:            'Produktzuschlag',
  einlagern:                  'Einlagern',
  auslagern:                  'Auslagern',
  lagergeld:                  'Lagergeld',
  gebuehrVergeblich:          'Gebühr für vergeblichen Abholversuch',
  zustell2:                   '2. Zustellung',
  samstag:                    'Samstagzustellung',
  gefahrgut:                  'Gefahrgut-Zuschlag',
  mautDiff:                   'Mautdifferenz',
  sbfu:                       'SBfU-Bescheinigung f. Umsatzsteuerzwecke',
  vorholung:                  'VORHOLUNG',
  sonderfahrt:                'Sonderfahrt',
  buendelKoennen:             'hätte gebündelt werden können?',
  abweichGewicht:             'Differenz aufgrund von abweichendem Gewicht',
  frachtzuAbschlag:           'Differenz Frachtzu/ abschlag',
  abholtermin:                'Abholterminvereinbarung',
  treibstof:                  'Differenz treibstof',
  zwPrefix:                   'Differenz aufgrund abweichender Zwischenempfänger',
  // K+N
  buendelMuessenOk:           'hätte gebündelt werden müssen, ok?',
  amazonMuessen:              'hätte nach Amazon Tarif abrechnen müssen',
  amazonDuerfen:              'hätte nach Amazon Tarif abrechnen dürfen',
  abweichGewichte:            'Differenz aufgrund abweichender Gewichte',
  fixtermin:                  'FIXTERMIN',
  portalavisOk:               'Portalavisierung, ok?',
  avisOk:                     'Avis, ok?',
  snkDifferenz:               'SNK Differenz',
  treibstoff:                 'Differenz treibstoff',
  kontierungQ:                'Kontierung?',
  pauschalfracht:             'Pauschalfracht',
  differenzAvis:              'Differenz avis',
  b2cZuschlag:                'B2C-zuschlag, ok?',
  // DHL
  fremdnummerDotPunkt:        'Fremdnummer doppelt berechnet.',
  kontierungLower:            'kontierung?',
  abweichGewichtVolumen:      'Differenz aufgrund von abweichendem Gewicht/Volumen',
  nichtStapelbar:             'nicht stapelbar ok?',
  overweight:                 'overweight ok?',
  nonConvWeight:              'Non conveyable piece-weight ok?',
  nonConvPiece:               'non conveyable piece ok?',
  nonConvIrregular:           'Non-conveyable piece irregular ok?',
  neutralDelivery:            'Neutral delivery ok?',
  directSignature:            'Direct signature ok?',
  limitedQuantities:          'Limited quantities ok?',
  elevatedRisk:               'Elevated Risk, ok?',
  elevatedRestricted:         'Eelevated risk ok? // Restricted destination ok?',
  addressCorrectionOk:        'Addres Correction, ok?',
  addressCorrectionQ:         'Address Correction ok?',
  demandSurcharge:            'demand surcharge ok?',
  oversizePiece:              'Oversize piece ok?',
  // Wackler
  fremdnummer:                'Fremdnummer Doppelt berechnet',
  nlFix:                      'NL-FIX',
  b2cLine:                    'hätte B2C-Line abrechnen dürfen',
  buendelMuessen:             'hätte gebündelt werden müssen',
  avisTelefonisch:            'hätte Avisgebühr telefonisch abrechnen dürfen',
  differenzAvisOk:            'Differenz avis, ok?',
  returnOk:                   'Return, ok?',
  frachtDiff:                 'Frachtdifferenz',
};
/* Expose under shorter alias for compactness inside processors. */
const P=PHRASES;

/* ══════════════════════════════════════════════════════════
   TIMESTAMPED STREAMING LOG (#16) — replaces original showLog
   with an append-only stream. Kept the same public signature
   so all existing call sites work unchanged.
══════════════════════════════════════════════════════════ */
function pad2(n){return n<10?'0'+n:''+n;}
function nowTs(){const d=new Date();return pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds());}
let _logHasClear=false;
function ensureLogClear(el){
  if(_logHasClear)return;
  _logHasClear=true;
  const btn=document.createElement('button');
  btn.type='button';btn.className='log-clear';btn.textContent='clear';
  btn.onclick=clearLog;
  el.parentNode.insertBefore(btn,el);
}
function clearLog(){const el=document.getElementById('log');el.innerHTML='';el.style.display='none';}
/* Override showLog. Previous behavior: replace content each call.
   New behavior: append timestamped line; 'err' / 'ok' color the line.
   Signature preserved: showLog(msg, type). */
function showLog(msg,type){
  const el=document.getElementById('log');
  el.style.display='block';
  el.className='log'; /* clear any legacy single-line coloring */
  ensureLogClear(el);
  const lines=String(msg==null?'':msg).split('\n');
  for(const line of lines){
    const div=document.createElement('div');
    div.className='log-line '+(type==='err'?'err-line':(type==='ok'?'ok-line':'info-line'));
    const ts=document.createElement('span');ts.className='ts';ts.textContent=nowTs();
    div.appendChild(ts);
    div.appendChild(document.createTextNode(line));
    el.appendChild(div);
  }
  el.scrollTop=el.scrollHeight;
}

/* ══════════════════════════════════════════════════════════
   A11Y: forwarder radiogroup keyboard nav (#17)
══════════════════════════════════════════════════════════ */
function fwKeydown(e){
  const btns=[...document.querySelectorAll('#fwGroup .fw-btn')];
  const i=btns.indexOf(e.currentTarget);if(i<0)return;
  let next=null;
  if(e.key==='ArrowRight'||e.key==='ArrowDown')next=btns[(i+1)%btns.length];
  else if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=btns[(i-1+btns.length)%btns.length];
  else if(e.key==='Home')next=btns[0];
  else if(e.key==='End')next=btns[btns.length-1];
  else if(e.key===' '||e.key==='Enter'){e.preventDefault();e.currentTarget.click();return;}
  if(next){e.preventDefault();btns.forEach(b=>b.tabIndex=-1);next.tabIndex=0;next.focus();next.click();}
}

/* ══════════════════════════════════════════════════════════
   PWA REGISTRATION + OFFLINE DOWNLOAD BUTTON (#21)
   Uses Grimoire.Offline (see assets/grimoire-core.js) which:
     • registers sw.js
     • posts { type:'PRECACHE', urls:[…] } to the active SW
     • reports progress back via a MessageChannel
     • reflects state on the button via data-offline-state
══════════════════════════════════════════════════════════ */
(function setupOffline(){
  if(!window.Grimoire || !window.Grimoire.Offline) return; /* core failed to load */
  /* Register first so the SW is ready by the time a user clicks. */
  window.Grimoire.Offline.register();
  /* Wait until DOM is parsed — this script runs at end of body, so it is. */
  window.Grimoire.Offline.mount('#btnOffline', {
    urls: window.Grimoire.Offline.defaultUrls().concat([
      './assets/anmerkung.css',
      './assets/anmerkung.js',
      './assets/anmerkung-changelog.json'
    ]),
    idleLabel:    'Download for offline',
    readyLabel:   'Available offline',
    workingLabel: 'Downloading…',
    failLabel:    'Retry download'
  });
})();

/* ══════════════════════════════════════════════════════════
   BONUS PANEL TOGGLES (Tester + Diff)
══════════════════════════════════════════════════════════ */
function toggleBonus(which){
  const m={tester:['testerToggle','testerPanel'],diff:['diffToggle','diffPanel'],bulk:['bulkToggle','bulkPanel']};
  const [tId,pId]=m[which];
  const t=document.getElementById(tId),p=document.getElementById(pId);
  const open=!p.classList.contains('open');
  p.classList.toggle('open',open);t.classList.toggle('open',open);
  t.setAttribute('aria-expanded',open?'true':'false');
  if(open&&which==='tester')renderTesterFields();
}

/* ── UI HELPERS ── */
function selectFW(btn){document.querySelectorAll('.fw-btn').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-checked','false');b.tabIndex=-1;});btn.classList.add('selected');btn.setAttribute('aria-checked','true');btn.tabIndex=0;selectedFW=btn.dataset.fw;checkReady();renderTesterFields();}
function onDrag(e,over){e.preventDefault();document.getElementById('dropArea').classList.toggle('drag',over);}
function onDrop(e){e.preventDefault();onDrag(e,false);if(e.dataTransfer.files[0])loadFile(e.dataTransfer.files[0]);}
function onFileSelect(e){if(e.target.files[0])loadFile(e.target.files[0]);}
function loadFile(file){originalFileName=file.name;const reader=new FileReader();reader.onload=ev=>{try{rawFileBytes=ev.target.result;workbook=XLSX.read(rawFileBytes,{type:'array',cellNF:true});const fn=document.getElementById('fileName');fn.textContent=file.name+' — '+workbook.SheetNames.length+' sheet(s)';fn.style.display='block';showLog('Scroll loaded: '+file.name,'ok');checkReady();}catch(err){showLog('Could not read scroll: '+err.message,'err');}};reader.readAsArrayBuffer(file);}
function checkReady(){const ok=!!(selectedFW&&workbook);document.getElementById('btnRun').disabled=!ok;document.getElementById('btnPreview').disabled=!ok;}
function setProgress(pct){document.getElementById('progressWrap').style.display='block';document.getElementById('progressFill').style.width=pct+'%';}

/* ── CELL READING HELPERS ── */
/* Header-row cache: row 2 and row 3 are the lookup rows `findCol` scans.
   Pre-compute them once per (worksheet, range) pair as lowercased string
   arrays so every subsequent `findCol` call is a plain array walk with
   no object lookups or case-folding per column. WeakMap keyed on the ws
   object so it's GC'd automatically when the workbook is released.

   Each processor invokes `findCol` 10-20 times per sheet; without the cache
   that's 20 × range.e.c × 2 object lookups + 2 `toLowerCase` calls per cell.
   With the cache, the expensive part happens once per sheet. */
const _hdrCache = new WeakMap();
function _getHeaders(ws, range){
  let cached = _hdrCache.get(ws);
  if (cached && cached.lastCol === range.e.c) return cached;
  const lastCol = range.e.c;
  const row2 = new Array(lastCol + 1);
  const row3 = new Array(lastCol + 1);
  for (let c = 0; c <= lastCol; c++){
    const cell2 = ws[XLSX.utils.encode_cell({r:1,c})];
    const cell3 = ws[XLSX.utils.encode_cell({r:2,c})];
    row2[c] = cell2 && cell2.v != null ? String(cell2.v).toLowerCase() : '';
    row3[c] = cell3 && cell3.v != null ? String(cell3.v).toLowerCase() : '';
  }
  cached = { lastCol, row2, row3 };
  _hdrCache.set(ws, cached);
  return cached;
}
function findCol(ws,range,h2,h3){
  const {row2, row3, lastCol} = _getHeaders(ws, range);
  const needle2 = h2.toLowerCase();
  const needle3 = h3.toLowerCase();
  for (let c = 0; c <= lastCol; c++){
    if ((h2 === '' || row2[c].includes(needle2)) && row3[c].includes(needle3)) return c;
  }
  return -1;
}
function cellNum(ws,r,c){if(c<0)return 0;const cell=ws[XLSX.utils.encode_cell({r,c})];if(!cell||cell.v==null)return 0;let s=String(cell.v).trim().replace(/,(?=[^.]*$)/,'.').replace(/[^0-9.\-]/g,'');const n=parseFloat(s);return isNaN(n)?0:n;}
function cellStr(ws,r,c){if(c<0)return'';const cell=ws[XLSX.utils.encode_cell({r,c})];return cell?String(cell.v||'').trim():'';}
function hasErr(v,t){return Math.abs(v)>t;}
function join(a,b){if(!b)return a;if(a.toLowerCase().includes(b.toLowerCase()))return a;return a?a+' // '+b:b;}

/* ── DACHSER ── */
const DA_COL_REFERENZ3=15,DA_COL_EMPF_PLZ=13,DA_COL_EMPF_ORT=14,DA_COL_ANZ_SDG=3,DA_COL_SERV_ART=16,DA_COL_SACHKONTO=35;

function resolveDachser(ws,range){
  const fc=(h2,h3)=>findCol(ws,range,h2,h3);
  return{
    target:   fc('','Anmerkung'),
    stat:     fc('','Stat_Freigabe'),
    tarif:    fc('Total','Kosten lt. Tarif'),
    zz:       fc('ZZ','Differenz'),
    dgr:      fc('DGR','Differenz'),
    exp:      fc('EXP','Differenz'),
    exp_dl:   fc('EXP','Kosten DL'),
    snk_diff: fc('SNK','Differenz'),
    snk_dl:   fc('SNK','Kosten DL'),
    snk_tar:  fc('SNK','Kosten lt. Tarif'),
    sbfu:     fc('SBFU','Differenz'),
    sam:      fc('SAM','Differenz'),
    fr:       fc('FR','Differenz'),
    maut:     fc('MT','Differenz'),
    tz:       fc('TZ','Differenz'),
    c502_dl:  fc('502','Kosten DL'),
    c503_dl:  fc('503','Kosten DL'),
    lg_diff:  fc('LG','Differenz'),
    av_diff:  fc('AV','Differenz'),
    vkg:      fc('','Volumen kg'),
    vkg_dl:   fc('','Volumen kg DL'),
  };
}

/* Dachser weight tier breakpoints (kg "bis" upper bounds) — taken DIRECTLY from
   the supplied `data/Dachser-weight.xlsx` rate card (Staffel column, 44 brackets:
   0-50, 51-100, …, 9501-10000). Used by the FR-branch weight guard to decide
   whether `Volumen kg` vs `Volumen kg DL` cross a tariff bucket
   (→ plural "Differenz aufgrund abweichender Gewichte", a real weight miscalc)
   or stay inside the same bucket (→ singular "Differenz aufgrund von abweichendem
   Gewicht", the legacy wording — FR delta exists but it's not a tier crossing).

     ── 50 kg steps in the very low band:    50,100,...,500
     ── 100 kg steps:                       600,700,...,2000
     ── 200 kg steps:                       2200,2400,2600,2800,3000
     ── 500 kg steps in the heavy band:     3500,4000,...,7500,8000,8500,9000,9500,10000
     ── single open bucket above 10000:     999999 (rates flatline above the rate-card ceiling)

   Differs from `KN_BP` in two places: Dachser keeps every 500 kg step in the
   8000–10000 band (K+N collapses 8500/9500 only) and tops out at a real 10000
   ceiling (K+N has an open 99999). Both differences come straight from the
   supplied rate card. */
const DACHSER_BP=[50,100,150,200,250,300,350,400,450,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2200,2400,2600,2800,3000,3500,4000,4500,5000,5500,6000,6500,7000,7500,8000,8500,9000,9500,10000,999999];
function dachserGetTier(kg){if(kg<=0)return 0;for(const b of DACHSER_BP)if(kg<=b)return b;return 999999;}

function daIsTarifZero(ws,r,col){if(col<0)return false;const raw=cellStr(ws,r,col);if(!raw)return false;if(raw==='-')return true;return(cellNum(ws,r,col)===0&&raw.includes('0'));}
function daIsNonInteger(n){return n!==Math.floor(n);}
/* When SNK_DL has a non-integer tariff component (e.g. 14.72, 7.57), the "surcharge
   code" (11/14/5/9 …) is not visible in SNK_DL directly — it lives in SNK_DIFF which
   equals DL minus the tariff-derived base. Training rows 14/352/354 showed that
   SNK_DIFF rounds to a clean surcharge value (9.01→9, 5.01→5) on these rows, so
   classify by the rounded SNK_DIFF instead of letting the row fall through to the
   generic "Laderaumkostenentwicklung" branch. Only kicks in when SNK_DL is non-integer
   AND the difference is within 0.05 of a known surcharge code — a very narrow window
   so we don't accidentally grab real Laderaum rows. */
const DA_SNK_SURCHARGE_CODES=[5,9,11,14];
function daDetectSurchargeFromDiff(snkDl,snkDiff){
  if(!daIsNonInteger(snkDl))return 0;
  const rounded=Math.round(snkDiff);
  if(!DA_SNK_SURCHARGE_CODES.includes(rounded))return 0;
  if(Math.abs(snkDiff-rounded)>0.05)return 0;
  return rounded;
}

function daEvalSNK(ws,r,cols,isTarifZero,servArt){
  if(cols.snk_diff<0||cols.snk_dl<0)return'';
  const snkDl=cellNum(ws,r,cols.snk_dl),
        snkDiff=cellNum(ws,r,cols.snk_diff),
        snkTar=cols.snk_tar>=0?cellNum(ws,r,cols.snk_tar):0,
        T=T_DACHSER;
  if(snkDl===0&&snkTar===0&&snkDiff===0)return'';

  /* Non-integer SNK_DL (tariff base with cents) — re-derive the surcharge code from
     SNK_DIFF when it rounds cleanly to 5/9/11/14. Then fall through to the same
     switch so the downstream phrase mapping stays the single source of truth. */
  const derivedCode=daDetectSurchargeFromDiff(snkDl,snkDiff);
  const effectiveDl=derivedCode||snkDl;

  switch(effectiveDl){
    case 190:return'AUSFALLFRACHT';
    case 95:return'AUSFALLFRACHT';
    case 130:return'Standgeld';
    case 75:
      if(servArt.toUpperCase()==='K1AV')return'Speditionskosten gem. Text';
      /* SNK_DL=75 splits along whether the surcharge has a tariff base.
         When SNK_TARIF>0, the row is a Hebebühnen (tail-lift) tariff line that's
         been miscalculated — training row 47 (SNK_TARIF=85, SNK_DL=75, SNK_DIFF=-10):
         tariff says €85, billed €75, the -€10 gap is a Differenz on a real
         Hebebühnen-Zuschlag, not an ad-hoc fee. Conversely when SNK_TARIF is
         empty/0 with SNK_DIFF==SNK_DL=75 (training row 343) the line is a
         standalone Ausfallfracht/Schadensersatz fee with no tariff backing.
         Note the spelling "Hebebuehnen" matches the auditor's ASCII wording. */
      if(snkTar>0){
        if(!hasErr(snkDiff,T))return'';
        return'Differenz Hebebuehnen-Zuschlag';
      }
      return'Ausfallfracht/Schadensersatz';
    case 11:
      if(!hasErr(snkDiff,T))return'';
      return'Differenz Telefonische Zustellankündigung - Laderaumzuschlag';
    case 14:
      if(!hasErr(snkDiff,T)||isTarifZero)return'';
      if(servArt.toUpperCase()==='K1AV')return'Differenz Laderaumkostenentwicklung';
      return'Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag';
    case 5:
      if(!hasErr(snkDiff,T))return'';
      if(servArt.toUpperCase()==='K1AV'){
        return(snkTar===0)?'Admin Zeitfensterbuchung Handel':'Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag';
      }
      if(isTarifZero)return'';
      return'Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag';
    case 9:
      if(!hasErr(snkDiff,T)||isTarifZero)return'';
      return'Differenz Telefonische Zustellterminvereinbarung - Laderaumzuschlag';
    default:
      if(!hasErr(snkDiff,T))return'';
      /* K1AV with a non-standard SNK_DL value classifies as Laderaumkostenentwicklung.
         Training row 324: SNK_DL=19, SNK_DIFF=19, SERV=K1AV → expected
         "Differenz Laderaumkostenentwicklung". The non-integer fallback below
         already catches K1AV rows with cents-bearing SNK_DL (rows 303/304/307/342);
         this catches the integer-only K1AV cases that previously fell through to
         "Differenz Automatische Zustellterminvereinbarung — Laderaumzuschlag".
         K1AV's standard codes (5/14) are still handled higher up in the switch. */
      if(servArt.toUpperCase()==='K1AV')return'Differenz Laderaumkostenentwicklung';
      if(daIsNonInteger(snkDl)&&daIsNonInteger(snkDiff)){
        return'Differenz Laderaumkostenentwicklung';
      }
      return'Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag';
  }
}

function daEvalEXP(ws,r,cols){if(cols.exp<0)return'';const expDiff=cellNum(ws,r,cols.exp);if(!hasErr(expDiff,T_DACHSER))return'';const expDl=cols.exp_dl>=0?cellNum(ws,r,cols.exp_dl):0;return(expDl===95)?'Termin-zuschlag':'Produktzuschlag';}
function daZWNote(ws,r){const plz=cellStr(ws,r,DA_COL_EMPF_PLZ),ort=cellStr(ws,r,DA_COL_EMPF_ORT),loc=(plz&&ort)?plz+' '+ort:(plz||ort);return'Differenz aufgrund abweichender Zwischenempfänger'+(loc?' '+loc:'');}

function processDachser(ws,r,cols){
  const T=T_DACHSER;
  if(cols.stat>=0&&cellNum(ws,r,cols.stat)!==10)return null;
  const isZW=cellStr(ws,r,DA_COL_REFERENZ3).toUpperCase().trim()==='ZW',
        servArt=cellStr(ws,r,DA_COL_SERV_ART),
        sachkonto=cellStr(ws,r,DA_COL_SACHKONTO),
        anzSdg=parseInt(cellStr(ws,r,DA_COL_ANZ_SDG))||0,
        isTarifZero=daIsTarifZero(ws,r,cols.tarif);

  /* Blank-TARIF + significant FR pattern. When the TARIF cell is completely empty
     (not '-' which daIsTarifZero already catches) AND FR exceeds threshold, the
     row is an accounting artifact, not a billing differential. Two flavors:
       - No SACH and no SERV_ART → Vorholung advance-freight line (training row 344:
         FR=646.7, every other input column blank → expected "VORHOLUNG").
       - SACH+SERV present → Fremdnummer doppelt berechnet (training row 345:
         FR=47.2, EXP=10, MAUT=1.15, SERV=DA01, SACH=612100 → expected
         "Fremdnummer Doppelt berechnet" alone, with every other classification
         suppressed).
     Returns early so the standard Produktzuschlag/Mautdifferenz/Gewichte cascade
     doesn't pile irrelevant labels onto these accounting rows. */
  if(cols.tarif>=0&&cols.fr>=0){
    const tarifRaw=cellStr(ws,r,cols.tarif);
    if(tarifRaw===''&&hasErr(cellNum(ws,r,cols.fr),T)){
      if(!sachkonto&&!servArt)return PHRASES.vorholung;
      return'Fremdnummer Doppelt berechnet';
    }
  }

  let res='',hasFR=false;

  if(cols.c502_dl>=0){const v=cellStr(ws,r,cols.c502_dl);if(v&&v!=='-'&&v!=='0'&&cellNum(ws,r,cols.c502_dl)!==0)res=join(res,'Einlagern');}
  if(cols.c503_dl>=0){const v=cellStr(ws,r,cols.c503_dl);if(v&&v!=='-'&&v!=='0'&&cellNum(ws,r,cols.c503_dl)!==0)res=join(res,'Auslagern');}
  if(cols.lg_diff>=0&&hasErr(cellNum(ws,r,cols.lg_diff),T))res=join(res,'Lagergeld');
  if(cols.av_diff>=0&&hasErr(cellNum(ws,r,cols.av_diff),T))res=join(res,'Gebühr für vergeblichen Abholversuch');
  if(cols.zz>=0&&hasErr(cellNum(ws,r,cols.zz),T))res=join(res,'2. Zustellung');
  res=join(res,daEvalSNK(ws,r,cols,isTarifZero,servArt));
  if(cols.sam>=0&&hasErr(cellNum(ws,r,cols.sam),T))res=join(res,'Samstagzustellung');
  if(isTarifZero)return res;
  if(cols.dgr>=0&&hasErr(cellNum(ws,r,cols.dgr),T))res=join(res,'Gefahrgut-Zuschlag');
  res=join(res,daEvalEXP(ws,r,cols));
  if(cols.maut>=0&&hasErr(cellNum(ws,r,cols.maut),T))res=join(res,'Mautdifferenz');
  if(cols.sbfu>=0&&hasErr(cellNum(ws,r,cols.sbfu),T))res=join(res,'SBfU-Bescheinigung f. Umsatzsteuerzwecke');
  if(cols.fr>=0&&hasErr(cellNum(ws,r,cols.fr),T)){
    hasFR=true;
    const frVal=cellNum(ws,r,cols.fr);
    if(isZW)res=join(res,daZWNote(ws,r));
    else if(sachkonto.toUpperCase()==='X')res=join(res,'VORHOLUNG');
    else if(servArt.toUpperCase()==='K1AS')res=join(res,'Sonderfahrt');
    else if(anzSdg>1)res=join(res,'hätte gebündelt werden können?');
    /* Negative FR with no special flags (no ZW, no Vorholung, no Sonderfahrt, single
       shipment). The audit splits these along magnitude: a small-magnitude negative
       FR (just above the rounding threshold) is a Frachtzu/abschlag — a freight
       surcharge/credit adjustment (training row 357: FR=-0.09 → expected
       "Differenz Frachtzu/ abschlag" alongside other triggers). A large-magnitude
       FR is a real freight discrepancy that falls through to the weight-deviation
       wording (training row 241: FR=-26.24, no VKG → expected
       "Differenz aufgrund von abweichendem Gewicht", NOT Frachtzu/abschlag). The
       1.0-EUR cutoff sits comfortably between the two observed cases (0.09 vs 26.24). */
    else if(frVal<0&&Math.abs(frVal)<1.0)res=join(res,'Differenz Frachtzu/ abschlag');
    else {
      /* Weight-tier guard, consistent with the K+N and Wackler engines. When
         `Volumen kg` and `Volumen kg DL` are both populated AND fall into
         DIFFERENT Dachser tariff buckets (DACHSER_BP), the FR delta is a real
         weight miscalc → plural "Differenz aufgrund abweichender Gewichte".
         When they stay in the same bucket (or one of the volumes is missing /
         non-positive — e.g. dummy-zero rows where the auditor doesn't attribute
         the gap to weight at all), the row falls through to the legacy singular
         "Differenz aufgrund von abweichendem Gewicht". Tier table is
         `DACHSER_BP` above — sourced from the data/Dachser-weight.xlsx rate
         card.

         Trade-off note: training row 346 (VKG=54, VKG_DL=40) crosses the 50/100
         bracket boundary so this rule labels it plural; the auditor labeled it
         singular. Choosing tier-crossing here mirrors the K+N / Wackler
         behavior and keeps the three forwarder engines consistent — the row 346
         label is treated as a one-off auditor variation. */
      const v1=cols.vkg>=0?cellNum(ws,r,cols.vkg):0;
      const v2=cols.vkg_dl>=0?cellNum(ws,r,cols.vkg_dl):0;
      const tiersKnown=(cols.vkg>=0&&cols.vkg_dl>=0&&v1>0&&v2>0);
      const crossTier=tiersKnown&&(dachserGetTier(v1)!==dachserGetTier(v2));
      res=join(res, crossTier
        ? 'Differenz aufgrund abweichender Gewichte'      /* plural — tiers crossed */
        : 'Differenz aufgrund von abweichendem Gewicht'); /* singular — same tier or weights unknown */
    }
  }
  if(cols.snk_dl>=0&&cellNum(ws,r,cols.snk_dl)===14&&cols.snk_diff>=0&&hasErr(cellNum(ws,r,cols.snk_diff),T))
    res=join(res,'Abholterminvereinbarung');
  if(res===''&&!hasFR&&cols.tz>=0&&hasErr(cellNum(ws,r,cols.tz),T))res='Differenz treibstof';
  return res;
}

/* ── K+N ── */
const KN_BP=[50,100,150,200,250,300,350,400,450,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2200,2400,2600,2800,3000,3500,4000,4500,5000,5500,6000,6500,7000,7500,8500,9500,99999];
function knGetTier(kg){if(kg<=0)return 0;for(const b of KN_BP)if(kg<=b)return b;return 99999;}
function resolveKN(ws,range){const fc=(h2,h3)=>findCol(ws,range,h2,h3);return{target:fc('','Anmerkung'),stat:fc('','Stat_Freigabe'),tarif:fc('Total','Kosten lt. Tarif'),recip:fc('','Empf.-Name'),referenz:fc('','ReferenzNr'),vkg:fc('','Volumen kg'),vkg_dl:fc('','Volumen kg DL'),kost:fc('','Kostenstelle'),sach:fc('','Sachkonto'),fr:fc('FR','Differenz'),exp:fc('EXP','Differenz'),toll:fc('MT','Differenz'),snk_dl:fc('SNK','Kosten DL'),snk_diff:fc('SNK','Differenz'),fuel:fc('TZ','Differenz')};}

function processKN(ws,r,cols){
  const T=T_KN;
  if(cols.stat>=0&&cellNum(ws,r,cols.stat)!==10)return null;
  const frDiff=cellNum(ws,r,cols.fr),snkDl=cellNum(ws,r,cols.snk_dl),snkDiff=cellNum(ws,r,cols.snk_diff),expDiff=cellNum(ws,r,cols.exp),tollDiff=cellNum(ws,r,cols.toll),fuelDiff=cellNum(ws,r,cols.fuel),refNr=cellStr(ws,r,cols.referenz),recip=cellStr(ws,r,cols.recip).toLowerCase(),kost=cellStr(ws,r,cols.kost),sach=cellStr(ws,r,cols.sach);
  /* Tarif is "empty" when the cell is blank or rendered as '-' (no tariff on record).
     An FR difference on an empty-tarif row is a Pauschalfracht situation — the freight
     is a flat-rate charge, not a tier/weight miscalc. Checked before the Amazon / Gewichte
     cascade below so it wins out. */
  const tarifRaw=cols.tarif>=0?cellStr(ws,r,cols.tarif):'';
  const tarifEmpty=(tarifRaw===''||tarifRaw==='-');
  let res='';
  if(hasErr(frDiff,T)){
    /* Bundling wins over everything — if ReferenzNr lists multiple docs, the
       row represents an unbundled stack that should've been billed together.
       Kept as an early return to match legacy behavior. */
    if(refNr&&refNr!=='-'&&refNr.includes(','))return'hätte gebündelt werden müssen, ok?';
    if(tarifEmpty){res=join(res,'Pauschalfracht');}
    else if(recip.includes('amazon')&&(!refNr||refNr==='-'||!refNr.includes(','))){
      /* Amazon row + single ReferenzNr. Previously this always attributed the FR
         delta to "hätte nach Amazon Tarif abrechnen müssen", but when Volumen kg
         vs Volumen kg DL cross a tariff tier the delta is actually a weight-tier
         miscalc, not an Amazon pricing miss. Mirror the Wackler same-tier/cross-tier
         precedence: same tier (or missing weights) → Amazon tarif branch;
         different tier → Differenz aufgrund abweichender Gewichte. */
      const v1=cellNum(ws,r,cols.vkg),v2=cellNum(ws,r,cols.vkg_dl);
      const tiersKnown=(cols.vkg>=0&&cols.vkg_dl>=0&&v1>0&&v2>0);
      const crossTier=tiersKnown&&(knGetTier(v1)!==knGetTier(v2));
      res=join(res,crossTier?'Differenz aufgrund abweichender Gewichte':'hätte nach Amazon Tarif abrechnen müssen');
    }
    else if(frDiff>0&&snkDl===5){const v1=cellNum(ws,r,cols.vkg),v2=cellNum(ws,r,cols.vkg_dl);res=join(res,(knGetTier(v1)===knGetTier(v2))?'hätte nach Amazon Tarif abrechnen dürfen':'Differenz aufgrund abweichender Gewichte');}
    else{res=join(res,'Differenz aufgrund abweichender Gewichte');}
  }
  if(hasErr(expDiff,T))res=join(res,'FIXTERMIN');
  if(hasErr(tollDiff,T))res=join(res,'Mautdifferenz');
  /* SNK classification. Values are small integers in the typical cases we
     classify; the cascade below checks both SNK_DIFF exact matches first,
     then SNK_DL exact matches, then the generic tolerance-based fallback. */
  if(Math.abs(snkDiff-9)<0.01){res=join(res,'Avis, ok?');}
  else if(Math.abs(snkDiff+9)<0.01){res=join(res,'Differenz avis');}
  else if(Math.abs(Math.abs(snkDiff)-25)<0.01){res=join(res,'Portalavisierung, ok?');}
  else if(hasErr(snkDiff,T)){
    if(snkDl===5||snkDl===25)res=join(res,'Portalavisierung, ok?');
    else if(snkDl===9)res=join(res,'Avis, ok?');
    else if(snkDl===12)res=join(res,'B2C-zuschlag, ok?');
    else if(snkDl===18){if(!res.toLowerCase().includes('avis, ok?'))res=join(res,'Avis, ok?');}
    else if(snkDl===34){res=join(res,'Portalavisierung, ok?');res=join(res,'Avis, ok?');}
    else res=join(res,'SNK Differenz');
  }
  /* TZ (fuel surcharge) difference. Treibstoffzuschlag is calculated as a percentage of
     freight, so when FR or MT are already classified as differing, the TZ gap is a
     mathematical byproduct of the freight/toll recalc — not a separate classification.
     Only emit "Differenz treibstoff" as an independent trigger when neither FR nor MT
     fired. This additively coexists with SNK-only rows (e.g. Portalavisierung + real
     standalone fuel gap), unlike the previous rule which suppressed treibstoff whenever
     any other trigger fired and lost those cases. */
  if(hasErr(fuelDiff,T)&&!hasErr(frDiff,T)&&!hasErr(tollDiff,T))res=join(res,'Differenz treibstoff');
  if(!kost||kost==='-'||!sach||sach==='-')res=join(res,'Kontierung?');
  return res;
}

/* ── DHL Express ── */
function resolveDHL(ws,range){const fc=(h2,h3)=>findCol(ws,range,h2,h3);return{target:fc('','Anmerkung'),stat:fc('','Stat_Freigabe'),tarif:fc('Total','Kosten lt. Tarif'),sach:fc('','SACHKONTO'),kost:fc('','KOSTENSTELLE'),addr:fc('FR','Differenz'),stack:fc('PAL','Differenz'),weight:fc('OW','Differenz'),conv:fc('YO','Differenz'),irr:fc('YL','Differenz'),neut:fc('ND','Differenz'),sign:fc('SF','Differenz'),snk:fc('SNK','Differenz'),diff:fc('AC','Differenz'),maut:fc('MT','Differenz'),surc:fc('NX','Differenz'),over:fc('OS','Differenz'),tz:fc('TZ','Differenz')};}
function processDHL(ws,r,cols){const T=T_DHL;if(cols.stat>=0&&cellNum(ws,r,cols.stat)!==10)return null;if(cols.tarif>=0){const raw=cellStr(ws,r,cols.tarif),v=cellNum(ws,r,cols.tarif);if(raw&&v===0&&(raw.includes('0')||raw==='-'))return'Fremdnummer doppelt berechnet.';}let res='';if(cols.sach>=0&&!cellStr(ws,r,cols.sach))res=join(res,'kontierung?');if(cols.kost>=0&&!cellStr(ws,r,cols.kost))res=join(res,'kontierung?');let block=false;[[cols.addr,'Differenz aufgrund von abweichendem Gewicht/Volumen'],[cols.stack,'nicht stapelbar ok?'],[cols.weight,'overweight ok?']].forEach(([c,m])=>{if(c>=0&&hasErr(cellNum(ws,r,c),T)){res=join(res,m);block=true;}});const yo=cols.conv>=0?cellNum(ws,r,cols.conv):0;if(cols.conv>=0){if(yo>0&&yo%15===0){res=join(res,'Non conveyable piece-weight ok?');block=true;}else if(hasErr(yo,T)){res=join(res,'non conveyable piece ok?');block=true;}}[[cols.irr,'Non-conveyable piece irregular ok?'],[cols.neut,'Neutral delivery ok?'],[cols.sign,'Direct signature ok?']].forEach(([c,m])=>{if(c>=0&&hasErr(cellNum(ws,r,c),T)){res=join(res,m);block=true;}});const snk=cols.snk>=0?cellNum(ws,r,cols.snk):0;if(cols.snk>=0){if(snk===25){res=join(res,'Limited quantities ok?');block=true;}else if(snk===30){res=join(res,'Elevated Risk, ok?');block=true;}else if(snk===60){res=join(res,'Eelevated risk ok? // Restricted destination ok?');block=true;}else if(hasErr(snk,T)){res=join(res,'SNK Differenz');block=true;}}if(!block){const ac=cols.diff>=0?cellNum(ws,r,cols.diff):0;if(cols.diff>=0){if(ac===11)res=join(res,'Addres Correction, ok?');else if(hasErr(ac,T))res=join(res,'Address Correction ok?');}[[cols.maut,'Mautdifferenz'],[cols.surc,'demand surcharge ok?'],[cols.over,'Oversize piece ok?']].forEach(([c,m])=>{if(c>=0&&hasErr(cellNum(ws,r,c),T))res=join(res,m);});}if(res===''&&cols.tz>=0&&hasErr(cellNum(ws,r,cols.tz),T))res='Differenz treibstof';return res;}

/* ── Wackler ── */
/* Weight tier breakpoints (kg "bis" upper bounds) — taken DIRECTLY from the supplied
   Wackler rate cards: data/Wackler national Rate.xlsx and data/Wackler international Rate.xlsx.
   Both rate sheets share the same breakpoints up to 10000 kg, so a single table covers both.

     ── 50 kg steps in the very low band:    50,100,...,500
     ── 100 kg steps:                       600,700,...,2000
     ── 200 kg steps:                       2200,2400,2600,2800,3000
     ── 500 kg steps in the heavy band:     3500,4000,...,7500,8000,8500,9000,9500,10000
     ── single open bucket above 10000:     999999 (rates flatline; matches both sheets)

   Used to decide whether Volumen kg vs Volumen kg DL still falls into the SAME tariff
   bucket (→ "Wackler rechnet Frachtrate für <tier>kg ab", systemic rounding) or crosses
   into a different bucket (→ "Differenz aufgrund abweichender Gewichte", real classification
   discrepancy). The matched tier is also reported in the output so the auditor sees which
   rate-card row Wackler billed against. */
const WACKLER_BP=[50,100,150,200,250,300,350,400,450,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2200,2400,2600,2800,3000,3500,4000,4500,5000,5500,6000,6500,7000,7500,8000,8500,9000,9500,10000,999999];
function wacklerGetTier(kg){if(kg<=0)return 0;for(const b of WACKLER_BP)if(kg<=b)return b;return 999999;}
function wacklerGetTierIdx(kg){if(kg<=0)return -1;for(let i=0;i<WACKLER_BP.length;i++)if(kg<=WACKLER_BP[i])return i;return WACKLER_BP.length-1;}
/* Format a tier breakpoint for display: regular numbers as-is, the open ceiling as ">10000". */
function wacklerTierLabel(tierKg){return tierKg>=999999?'>10000':String(tierKg);}
/* Wackler SNK surcharge code book — sign-insensitive (reversibles like NL-FIX show as ±value).
   Tolerance handles real-world rounding (NL-FIX seen as 38.00 / 38.08). */
const WACKLER_SNK_CODES=[
  {abs:38,   tol:0.5,  label:'NL-FIX'},
  {abs:11.5, tol:0.1,  label:'hätte B2C-Line abrechnen dürfen'},
  {abs:22,   tol:0.5,  label:'2. Zustellung ok?'},
  {abs:180,  tol:0.5,  label:'Terminzustellung, ok?'}
];
function wacklerSnkCode(snk){const a=Math.abs(snk);for(const c of WACKLER_SNK_CODES)if(Math.abs(a-c.abs)<=c.tol)return c.label;return null;}
/* Wackler AVIS surcharge codes — sign-insensitive (a credit AVIS=-6.5 is the same code as 6.5).
   AVIS=1 stays separate — that's a per-shipment "Avisnachweis" line, not a surcharge.
   AVIS≈-8.7 is also split out: a negative 8.7 credit is the audit signature for "billed the
   standard Avisgebühr, should have used the cheaper telephonic rate" → see wacklerAvisLabel. */
const WACKLER_AVIS_CODES=[7.5,8.5,6.5,8.7];
function isWacklerAvisCode(v){const a=Math.abs(v);return WACKLER_AVIS_CODES.some(c=>Math.abs(a-c)<0.01);}
/* Resolve the audit wording for a Wackler AVIS code. The 8.7 credit (negative) is the
   "should have billed telephonically" signature; everything else is the generic "Avis, ok?". */
function wacklerAvisLabel(v){if(!isWacklerAvisCode(v))return null;if(v<0&&Math.abs(Math.abs(v)-8.7)<0.01)return'hätte Avisgebühr telefonisch abrechnen dürfen';return'Avis, ok?';}
function resolveWackler(ws,range){const fc=(h2,h3)=>findCol(ws,range,h2,h3);return{target:fc('','Anmerkung'),stat:fc('','Stat_Freigabe'),tarif:fc('Total','Kosten lt. Tarif'),avis_diff:fc('AVIS','Differenz'),snk_diff:fc('SNK','Differenz'),fr:fc('FR','Differenz'),maut:fc('MT','Differenz'),tz:fc('TZ','Differenz'),referenz:fc('','ReferenzNr'),vkg:fc('','Volumen kg'),vkg_dl:fc('','Volumen kg DL'),empf_plz:fc('','Empf.-PLZ'),empf_ort:fc('','Empf.-Ort'),kostenstelle:fc('','KOSTENSTELLE'),sachkonto:fc('','SACHKONTO')};}
const WACKLER_PROTECTED=['Fremdnummer Doppelt berechnet','hätte gebündelt werden müssen','hätte Avisgebühr telefonisch abrechnen dürfen','Return, ok?','Differenz aufgrund abweichender Gewichte','Wackler rechnet'];
/* SNK rounding-noise floor: sub-€5 SNK gaps on rows that already carry FR/MT/TZ/Gewichte
   evidence are the fuel-on-toll percentage trickling into SNK, not a real classification. */
const WACKLER_SNK_NOISE=5.0;
/* Pauschalfracht ratio: when SNK exceeds the booked tariff (|SNK| ≥ N × tariff) and there are
   no FR/MT/TZ deltas, the row is a flat-rate freight charge — system priced against tariff but
   the customer was billed a lump sum. Conservative cutoff (≥ 1.0 × tariff) matches the smallest
   training case (TARIF=54.95, SNK=80, ratio 1.45×) without overfiring on standard SNK Differenz
   residuals which run far below the booked tariff value. */
const WACKLER_PAUSCHAL_RATIO=1.0;
/* TZ additive threshold: TZ ≥ 2.0 fires DifferenzEnergiezuschlag alongside other classifications.
   Below 2.0 the TZ delta is fuel-on-toll math noise (typical FR/MT-percentage spill). */
const WACKLER_TZ_ADDITIVE=2.0;
function processWackler(ws,r,cols){const existing=cellStr(ws,r,cols.target);for(const p of WACKLER_PROTECTED){if(existing.toLowerCase().includes(p.toLowerCase()))return null;}
  /* STAT gate: on stat≠10 only the Kontierung check runs; all other rules are skipped. */
  const statOk=(cols.stat<0)||(cellNum(ws,r,cols.stat)===10);
  if(!statOk){
    if(cols.kostenstelle>=0&&cols.sachkonto>=0){const kt=cellStr(ws,r,cols.kostenstelle).toUpperCase(),sk=cellStr(ws,r,cols.sachkonto).toUpperCase();if((kt===''||kt==='X')&&(sk===''||sk==='X'))return'Kontierung?';}
    return null;
  }
  /* 1. Fremdnummer doppelt — tariff cell is '-' or numerically zero with non-empty raw text. */
  if(cols.tarif>=0){const tarifRaw=cellStr(ws,r,cols.tarif),tarifNum=cellNum(ws,r,cols.tarif);if(tarifRaw&&(tarifRaw==='-'||(tarifNum===0&&tarifRaw!=='')))return'Fremdnummer Doppelt berechnet';}
  /* Pre-read deltas once. */
  const avisVal=cols.avis_diff>=0?cellNum(ws,r,cols.avis_diff):0;
  const snkVal=cols.snk_diff>=0?cellNum(ws,r,cols.snk_diff):0;
  const frVal=cols.fr>=0?cellNum(ws,r,cols.fr):0;
  const mtVal=cols.maut>=0?cellNum(ws,r,cols.maut):0;
  const tzVal=cols.tz>=0?cellNum(ws,r,cols.tz):0;
  const tarifNum=cols.tarif>=0?cellNum(ws,r,cols.tarif):0;
  const refNr=cols.referenz>=0?cellStr(ws,r,cols.referenz):'';
  const isBundle=refNr.includes(',');
  const frHasVal=Math.abs(frVal)>T_WACKLER;
  const mtHasVal=Math.abs(mtVal)>T_WACKLER;
  const snkHasVal=Math.abs(snkVal)>T_WACKLER;
  /* 2. Pauschalfracht — |SNK| ≥ tariff, no FR/MT/TZ, SNK not a known code, no AVIS surcharge.
     The booked tariff was a placeholder and the actual was a flat-rate freight charge. */
  if(cols.tarif>=0&&cols.snk_diff>=0&&snkHasVal&&!frHasVal&&!mtHasVal
     &&Math.abs(tzVal)<WACKLER_TZ_ADDITIVE
     &&tarifNum>0&&Math.abs(snkVal)>=WACKLER_PAUSCHAL_RATIO*tarifNum
     &&!wacklerSnkCode(snkVal)
     &&!isWacklerAvisCode(avisVal)){
    return'Pauschalfracht, ok?';
  }
  let res='';
  /* 3. AVIS surcharge codes (sign-insensitive: 7.5 / 8.5 / 6.5 / 8.7 ± credit).
     AVIS=-8.7 is the "should have billed telephonically" signature → specific wording. */
  if(cols.avis_diff>=0){const al=wacklerAvisLabel(avisVal);if(al)res=join(res,al);}
  /* 4. SNK surcharge codes (NL-FIX / B2C / 2. Zustellung / Terminzustellung). */
  let snkCodeLabel=null;
  if(cols.snk_diff>=0){snkCodeLabel=wacklerSnkCode(snkVal);if(snkCodeLabel)res=join(res,snkCodeLabel);}
  /* 5. Gewichte / Bundling cascade. Decision tree:
     ─ same-tier + FR delta              → "Wackler rechnet Frachtrate für <tier>kg ab"
     ─ cross-tier + multi-ref + far apart → "hätte gebündelt werden müssen"   (separate shipments)
     ─ cross-tier + multi-ref + adjacent  → "Differenz aufgrund abweichender Gewichte" (rounding crossed one boundary)
     ─ cross-tier + single-ref            → "Differenz aufgrund abweichender Gewichte"
     ─ no weight diff + multi-ref + FR    → "hätte gebündelt werden müssen"   (legacy bundling)
     The "far apart" cutoff is tier-index distance > 1: non-adjacent BP buckets imply genuinely
     different shipments, not rounding spillover. */
  let gewichteTriggered=false;
  if(cols.vkg>=0&&cols.vkg_dl>=0&&cols.fr>=0){
    const vkg=cellNum(ws,r,cols.vkg),vkgDl=cellNum(ws,r,cols.vkg_dl);
    const vkgStr=cellStr(ws,r,cols.vkg),vkgDlStr=cellStr(ws,r,cols.vkg_dl);
    const volDiff=(vkgStr!==vkgDlStr)&&(vkg!==vkgDl);
    if(volDiff&&frHasVal){
      const tA=wacklerGetTier(vkg),tB=wacklerGetTier(vkgDl);
      if(tA===tB){
        res=join(res,'Wackler rechnet Frachtrate für '+wacklerTierLabel(tA)+'kg ab');
      } else if(isBundle&&Math.abs(wacklerGetTierIdx(vkg)-wacklerGetTierIdx(vkgDl))>1){
        res=join(res,'hätte gebündelt werden müssen');
      } else {
        res=join(res,'Differenz aufgrund abweichender Gewichte');
      }
      gewichteTriggered=true;
    }
  }
  if(!gewichteTriggered&&isBundle&&frHasVal){
    res=join(res,'hätte gebündelt werden müssen');
    gewichteTriggered=true;
  }
  /* 6. AVIS=1 — Avisnachweis line, separate from the surcharge codes above. */
  if(cols.avis_diff>=0&&Math.abs(avisVal-1)<0.01)res=join(res,'Differenz avis, ok?');
  /* 7. Return-Lager (Wackler hub). */
  if(cols.empf_plz>=0&&cols.empf_ort>=0){const plz=cellStr(ws,r,cols.empf_plz),ort=cellStr(ws,r,cols.empf_ort).toUpperCase();if(plz==='88499'&&ort==='RIEDLINGEN')res=join(res,'Return, ok?');}
  /* 8. Frachtdifferenz fallback — FR delta uncovered by Gewichte/bundling/return paths. */
  if(cols.fr>=0&&!gewichteTriggered&&hasErr(frVal,T_WACKLER)&&!res.toLowerCase().includes('gebündelt')&&!res.toLowerCase().includes('return')){
    res=join(res,'Frachtdifferenz');
  }
  /* 9. Mautdifferenz — toll delta is additive. */
  if(cols.maut>=0&&hasErr(mtVal,T_WACKLER))res=join(res,'Mautdifferenz');
  /* 10. SNK Differenz fallback — unknown SNK code, above noise floor, not bundled. */
  if(cols.snk_diff>=0&&!snkCodeLabel&&snkHasVal
     &&Math.abs(snkVal)>=WACKLER_SNK_NOISE
     &&!res.toLowerCase().includes('gebündelt')){
    res=join(res,'SNK Differenz');
  }
  /* 11. DifferenzEnergiezuschlag — TZ is additive above the 2.0 threshold; below it the delta
     is fuel-on-(freight+toll) math spillover, not a separate classification. */
  if(cols.tz>=0&&Math.abs(tzVal)>=WACKLER_TZ_ADDITIVE)res=join(res,'DifferenzEnergiezuschlag');
  /* 12. NL-FIX zone corollary: when NL-FIX fires AND there's an FR delta AND KOST/SACH are blank,
     the destination zone may be miscoded — surface "Zone korrekt?" up front and drop the
     Frachtdifferenz it triggered (the FR gap is the zone miscode, not a real freight discrepancy). */
  if(snkCodeLabel==='NL-FIX'&&frHasVal&&cols.kostenstelle>=0&&cols.sachkonto>=0){
    const kt=cellStr(ws,r,cols.kostenstelle).toUpperCase(),sk=cellStr(ws,r,cols.sachkonto).toUpperCase();
    if((kt===''||kt==='X')&&(sk===''||sk==='X')){
      res=res.split(' // ').filter(p=>p.toLowerCase()!=='frachtdifferenz').join(' // ');
      res='Zone korrekt? // '+res;
    }
  }
  /* 13. Kontierung? — both KOST and SACH blank/X. */
  if(cols.kostenstelle>=0&&cols.sachkonto>=0){const kt=cellStr(ws,r,cols.kostenstelle).toUpperCase(),sk=cellStr(ws,r,cols.sachkonto).toUpperCase();if((kt===''||kt==='X')&&(sk===''||sk==='X'))res=join(res,'Kontierung?');}
  /* 14. Pure TZ fallback — row had nothing but a fuel delta above the noise floor. */
  if(res===''&&cols.tz>=0&&hasErr(tzVal,T_WACKLER))res='DifferenzEnergiezuschlag';
  return res;
}

/* ── COLUMN HELPERS ── */
function idxToCol(idx){let r='',n=idx+1;while(n>0){const rem=(n-1)%26;r=String.fromCharCode(65+rem)+r;n=Math.floor((n-1)/26);}return r;}
function colToIdx(col){let n=0;for(let i=0;i<col.length;i++)n=n*26+(col.charCodeAt(i)-64);return n-1;}

/* ── SHARED STRINGS ── */
function parseSharedStrings(xml){const strings=[];for(const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)){const parts=[...m[1].matchAll(/<t(?:[^>]*)>([\s\S]*?)<\/t>/g)];strings.push(parts.map(p=>p[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")).join(''));}return strings;}
function getOrAdd(strings,str){const i=strings.indexOf(str);if(i!==-1)return i;strings.push(str);return strings.length-1;}
function escXml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function rebuildSharedStrings(strings){const n=strings.length,sis=strings.map(s=>`<si><t xml:space="preserve">${escXml(s)}</t></si>`).join('');return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${n}" uniqueCount="${n}">${sis}</sst>`;}
function ensureSharedStringsContentType(ctXml){const ssType='application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';if(ctXml.includes(ssType))return ctXml;return ctXml.replace('</Types>',`<Override PartName="/xl/sharedStrings.xml" ContentType="${ssType}"/></Types>`);}
function ensureSharedStringsRel(relXml){if(relXml.includes('sharedStrings'))return relXml;const ssType='http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';return relXml.replace('</Relationships>',`<Relationship Id="rIdSS" Type="${ssType}" Target="sharedStrings.xml"/></Relationships>`);}

/* ── SHEET XML PATCHER ── */
function patchSheet(sheetXml,targetCol,rowResults,strings){const tIdx=colToIdx(targetCol);for(const[rowNum,value]of rowResults){if(value===null)continue;const cellRef=targetCol+rowNum,ssIdx=getOrAdd(strings,value);const existRe=new RegExp(`<c\\b([^>]*?)\\br="${cellRef}"([^>]*?)(?:>([\\s\\S]*?)<\\/c>|\\s*\\/?>(?=\\s*<))`);const existMatch=existRe.exec(sheetXml);if(existMatch){const rawAttrs=(existMatch[1]+' '+(existMatch[2]||'')).replace(/\s*\bt="[^"]*"/g,'').replace(/\s+/g,' ').trim();const attrStr=rawAttrs?' '+rawAttrs:'';sheetXml=sheetXml.slice(0,existMatch.index)+`<c r="${cellRef}"${attrStr} t="s"><v>${ssIdx}</v></c>`+sheetXml.slice(existMatch.index+existMatch[0].length);continue;}const rowOpenRe=new RegExp(`<row\\b[^>]*\\br="${rowNum}"[^/][^>]*>`);const rowOpenMatch=rowOpenRe.exec(sheetXml);if(!rowOpenMatch)continue;const afterOpen=rowOpenMatch.index+rowOpenMatch[0].length;const closeTag='</row>';const closeIdx=sheetXml.indexOf(closeTag,afterOpen);if(closeIdx<0)continue;const rowContent=sheetXml.slice(afterOpen,closeIdx);const sVals=[...rowContent.matchAll(/\bs="(\d+)"/g)].map(m=>m[1]);const freq={};sVals.forEach(v=>{freq[v]=(freq[v]||0)+1;});const styleIdx=sVals.length?Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0]:'0';const newCell=`<c r="${cellRef}" s="${styleIdx}" t="s"><v>${ssIdx}</v></c>`;let insertAt=rowContent.length;for(const m of rowContent.matchAll(/<c\s+r="([A-Z]+)(\d+)"/g)){if(colToIdx(m[1])>tIdx){insertAt=m.index;break;}}const newContent=rowContent.slice(0,insertAt)+newCell+rowContent.slice(insertAt);sheetXml=sheetXml.slice(0,afterOpen)+newContent+sheetXml.slice(closeIdx);}return sheetXml;}

/* ── MAIN RUNNER ── */
/* Split a processor result into distinct triggers (they're joined with ' // '). */
function splitTriggers(s){if(!s)return[];return s.split(/\s*\/\/\s*/).map(x=>x.trim()).filter(Boolean);}
/* Build a compact "why" string for the reason column. Captures raw values of the cells
   the processor actually reads, per-forwarder. Purely diagnostic — never affects rules. */
function buildReason(fw,ws,r,cols){
  const parts=[];const push=(k,v)=>{if(v!==''&&v!=null&&v!=='0'&&v!=='-')parts.push(k+'='+v);};
  const num=c=>c>=0?cellStr(ws,r,c):'';
  if(fw==='dachser'){
    push('STAT',num(cols.stat));push('TARIF',num(cols.tarif));
    push('FR',num(cols.fr));push('SNK_DL',num(cols.snk_dl));push('SNK_DIFF',num(cols.snk_diff));
    push('ZZ',num(cols.zz));push('SAM',num(cols.sam));push('DGR',num(cols.dgr));
    push('EXP',num(cols.exp));push('EXP_DL',num(cols.exp_dl));push('MAUT',num(cols.maut));
    push('LG',num(cols.lg_diff));push('AV',num(cols.av_diff));push('TZ',num(cols.tz));
    push('VKG',num(cols.vkg));push('VKG_DL',num(cols.vkg_dl));
    const ref3=cellStr(ws,r,DA_COL_REFERENZ3);if(ref3)parts.push('REF3='+ref3);
    const sa=cellStr(ws,r,DA_COL_SERV_ART);if(sa)parts.push('SERV='+sa);
    const sk=cellStr(ws,r,DA_COL_SACHKONTO);if(sk)parts.push('SACH='+sk);
  } else if(fw==='kn'){
    push('STAT',num(cols.stat));push('TARIF',num(cols.tarif));push('FR',num(cols.fr));
    push('SNK_DL',num(cols.snk_dl));push('SNK_DIFF',num(cols.snk_diff));
    push('EXP',num(cols.exp));push('MT',num(cols.toll));push('TZ',num(cols.fuel));
    const ref=cellStr(ws,r,cols.referenz);if(ref)parts.push('REF='+ref);
    const rc=cellStr(ws,r,cols.recip);if(rc)parts.push('RECIP='+rc);
    push('VKG',num(cols.vkg));push('VKG_DL',num(cols.vkg_dl));
    push('KOST',cellStr(ws,r,cols.kost));push('SACH',cellStr(ws,r,cols.sach));
  } else if(fw==='dhl'){
    push('STAT',num(cols.stat));push('TARIF',num(cols.tarif));
    push('FR',num(cols.addr));push('PAL',num(cols.stack));push('OW',num(cols.weight));
    push('YO',num(cols.conv));push('YL',num(cols.irr));push('ND',num(cols.neut));push('SF',num(cols.sign));
    push('SNK',num(cols.snk));push('AC',num(cols.diff));push('MT',num(cols.maut));
    push('NX',num(cols.surc));push('OS',num(cols.over));push('TZ',num(cols.tz));
    push('KOST',cellStr(ws,r,cols.kost));push('SACH',cellStr(ws,r,cols.sach));
  } else if(fw==='wackler'){
    push('STAT',num(cols.stat));push('TARIF',num(cols.tarif));
    push('AVIS',num(cols.avis_diff));push('SNK',num(cols.snk_diff));push('FR',num(cols.fr));
    push('MT',num(cols.maut));push('TZ',num(cols.tz));
    const ref=cellStr(ws,r,cols.referenz);if(ref)parts.push('REF='+ref);
    push('VKG',num(cols.vkg));push('VKG_DL',num(cols.vkg_dl));
    const plz=cellStr(ws,r,cols.empf_plz),ort=cellStr(ws,r,cols.empf_ort);
    if(plz||ort)parts.push('DEST='+[plz,ort].filter(Boolean).join(' '));
    push('KOST',cellStr(ws,r,cols.kostenstelle));push('SACH',cellStr(ws,r,cols.sachkonto));
  }
  return parts.join(' | ');
}

/* Run rules across the workbook without mutating files. Returns in-memory results + stats. */
function runRules(){
  let total=0,filled=0,skipped=0,empty=0,preserved=0,unreachable=0;
  const allResults={};
  const trigCounts=new Map();
  const previewRows=[];
  for(const name of workbook.SheetNames){
    const ws=workbook.Sheets[name],range=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
    let cols,fn;
    if(selectedFW==='dachser'){cols=resolveDachser(ws,range);fn=processDachser;}
    else if(selectedFW==='kn'){cols=resolveKN(ws,range);fn=processKN;}
    else if(selectedFW==='dhl'){cols=resolveDHL(ws,range);fn=processDHL;}
    else{cols=resolveWackler(ws,range);fn=processWackler;}
    if(cols.target<0){showLog(`Sheet "${name}": Anmerkung column not found.`,'err');unreachable++;continue;}
    const targetCol=idxToCol(cols.target),rowMap=new Map(),reasonMap=new Map();
    for(let r=3;r<=range.e.r;r++){
      total++;
      const excelRow=r+1;
      const result=fn(ws,r,cols);
      if(result===null){
        let isPreserved=false;
        /* For Wackler, processor returns null for both stat≠10 and protected existing value.
           Distinguish via current Stat_Freigabe. */
        if(selectedFW==='wackler'){
          const statOk=cols.stat<0||cellNum(ws,r,cols.stat)===10;
          if(statOk){isPreserved=true;preserved++;}
          else{skipped++;}
        } else {
          skipped++;
        }
        previewRows.push({sheet:name,row:excelRow,status:isPreserved?'preserved':'skipped',value:'',reason:''});
        continue;
      }
      rowMap.set(excelRow,result);
      const trigs=splitTriggers(result);
      trigs.forEach(t=>trigCounts.set(t,(trigCounts.get(t)||0)+1));
      if(result){filled++;}else{empty++;}
      const reason=buildReason(selectedFW,ws,r,cols);
      reasonMap.set(excelRow,reason);
      previewRows.push({sheet:name,row:excelRow,status:result?'filled':'empty',value:result,reason});
    }
    allResults[name]={targetCol,rowMap,reasonMap,targetIdx:cols.target};
  }
  /* previewRows already has status flags set inline above (filled/empty/skipped/preserved). */
  return{total,filled,skipped,empty,preserved,unreachable,allResults,trigCounts,previewRows};
}

/* ── PREVIEW (#1) ── */
function runPreview(){
  const btn=document.getElementById('btnPreview');btn.disabled=true;btn.textContent='Computing dry-run...';
  document.getElementById('stats-wrap').style.display='none';
  document.getElementById('btnDl').style.display='none';
  try{
    const rep=runRules();
    renderStats(rep);
    renderPreview(rep);
    showLog(`Dry-run — ${rep.filled} would be filled, ${rep.skipped} skipped, ${rep.empty} empty, ${rep.preserved} preserved.`,'ok');
  }catch(e){showLog('Preview failed: '+e.message,'err');console.error(e);}
  btn.disabled=false;btn.textContent='Preview — dry-run without writing';
}
function renderPreview(rep){
  const wrap=document.getElementById('previewWrap'),tbody=document.querySelector('#previewTable tbody');
  const MAX=200;const rows=rep.previewRows.slice(0,MAX);
  tbody.innerHTML=rows.map(r=>{
    const cls=r.status==='filled'?'pr-filled':(r.status==='empty'?'pr-empty':'pr-skipped');
    const dot=`<span class="pr-dot ${r.status}"></span>`;
    const label=r.status==='filled'?'filled':r.status==='empty'?'empty':'skipped';
    const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<tr class="${cls}"><td>${esc(r.sheet)}</td><td>${r.row}</td><td>${dot}${label}</td><td class="pr-value">${esc(r.value)}</td><td class="pr-reason">${esc(r.reason)}</td></tr>`;
  }).join('');
  document.getElementById('previewMeta').textContent=`showing ${rows.length} of ${rep.previewRows.length} rows · ${rep.filled} filled · ${rep.empty} empty · ${rep.skipped} skipped`;
  wrap.style.display='block';
}
function closePreview(){document.getElementById('previewWrap').style.display='none';}

/* ── STATS + TRIGGER BREAKDOWN (#12) ── */
function renderStats(rep){
  document.getElementById('sTotal').textContent=rep.total;
  document.getElementById('sFilled').textContent=rep.filled;
  document.getElementById('sSkipped').textContent=rep.skipped;
  document.getElementById('sEmpty').textContent=rep.empty;
  document.getElementById('sPreserved').textContent=rep.preserved;
  const list=document.getElementById('trigList');
  const entries=[...rep.trigCounts.entries()].sort((a,b)=>b[1]-a[1]);
  if(!entries.length){list.innerHTML='<div class="trig-empty">No triggers fired — all clean.</div>';}
  else{
    const max=entries[0][1];
    const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    list.innerHTML=entries.map(([name,count])=>{
      const pct=Math.max(4,Math.round(count/max*100));
      return `<div class="trig-row"><div class="trig-label" title="${esc(name)}">${esc(name)}</div><div class="trig-count">${count}</div><div class="trig-bar-bg"><div class="trig-bar-fill" style="width:${pct}%"></div></div></div>`;
    }).join('');
  }
  document.getElementById('stats-wrap').style.display='block';
}

async function runProcess(){
  const btn=document.getElementById('btnRun');btn.disabled=true;btn.textContent='Invoking ritual...';
  document.getElementById('btnDl').style.display='none';document.getElementById('stats-wrap').style.display='none';setProgress(5);
  try{
    const rep=runRules();
    const allResults=rep.allResults;
    const wantReason=document.getElementById('optReason').checked;
    setProgress(25);
    const zip=await JSZip.loadAsync(rawFileBytes);setProgress(40);
    const ssFile=zip.file('xl/sharedStrings.xml');let ssXml=ssFile?await ssFile.async('string'):'';const strings=ssXml?parseSharedStrings(ssXml):[];
    const wbXml=await zip.file('xl/workbook.xml').async('string'),wbRelXml=await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const sheetRids={};for(const m of wbXml.matchAll(/<sheet\b[^>]+\bname="([^"]+)"[^>]+\br:id="(rId\d+)"/g))sheetRids[m[1]]=m[2];
    const ridPaths={};for(const m of wbRelXml.matchAll(/\bId="(rId\d+)"[^>]+\bTarget="([^"]+)"/g))ridPaths[m[1]]=m[2];
    const sheetNames=Object.keys(allResults);
    for(let si=0;si<sheetNames.length;si++){
      const name=sheetNames[si],{targetCol,rowMap,reasonMap,targetIdx}=allResults[name];
      if(!rowMap.size&&!(wantReason&&reasonMap&&reasonMap.size)){continue;}
      const rId=sheetRids[name];if(!rId)continue;
      let rel=ridPaths[rId]||'';rel=rel.replace(/^\/+/,'');if(!rel.startsWith('xl/'))rel='xl/'+rel;
      let sheetXml=await zip.file(rel).async('string');
      sheetXml=patchSheet(sheetXml,targetCol,rowMap,strings);
      if(wantReason){
        /* Reason column is placed one column to the right of Anmerkung. Header goes in row 3 (the
           header row used by the processors' findCol). */
        const reasonColIdx=targetIdx+1;
        const reasonCol=idxToCol(reasonColIdx);
        const headerMap=new Map([[3,'Anmerkung_Reason']]);
        sheetXml=patchSheet(sheetXml,reasonCol,headerMap,strings);
        sheetXml=patchSheet(sheetXml,reasonCol,reasonMap,strings);
      }
      zip.file(rel,sheetXml);
      setProgress(40+Math.round(40*(si+1)/sheetNames.length));
    }
    zip.file('xl/sharedStrings.xml',rebuildSharedStrings(strings));
    const ctFile=zip.file('[Content_Types].xml');if(ctFile){let ctXml=await ctFile.async('string');ctXml=ensureSharedStringsContentType(ctXml);zip.file('[Content_Types].xml',ctXml);}
    const wbRelFile=zip.file('xl/_rels/workbook.xml.rels');if(wbRelFile){let wbRel=await wbRelFile.async('string');wbRel=ensureSharedStringsRel(wbRel);zip.file('xl/_rels/workbook.xml.rels',wbRel);}
    setProgress(85);
    resultBlob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE',compressionOptions:{level:6}});
    setProgress(100);
    renderStats(rep);
    showLog(`Ritual complete — ${rep.filled} rows transmuted, ${rep.skipped} skipped (Stat_Freigabe ≠ 10)${rep.preserved?`, ${rep.preserved} preserved`:''}${wantReason?' · reason column written':''}.`,'ok');
    document.getElementById('btnDl').style.display='block';
  }catch(e){showLog('Ritual failed: '+e.message+'\n'+e.stack,'err');console.error(e);}
  btn.disabled=false;btn.textContent='Invoke the Ritual';
}

/* ── DOWNLOAD ── */
function downloadResult(){if(!resultBlob)return;const url=URL.createObjectURL(resultBlob),a=document.createElement('a');a.href=url;a.download=originalFileName||'anmerkung_processed.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

/* ══════════════════════════════════════════════════════════
   RULE TESTER (#18) — builds a synthetic worksheet + cols from
   user-entered values and runs the actual processor. Guarantees
   identical behavior to the production engine, not a mock.
══════════════════════════════════════════════════════════ */

/* Per-forwarder field catalog — [key, label, type] where key matches
   the cols.* property the resolver returns. The tester writes values
   into a synthetic ws at stable column indices. */
const TESTER_FIELDS={
  dachser:[
    ['stat','Stat_Freigabe','num'],['tarif','Tarif (raw)','str'],
    ['fr','FR Differenz','num'],['snk_diff','SNK Differenz','num'],['snk_dl','SNK Kosten DL','num'],['snk_tar','SNK Kosten lt.Tarif','num'],
    ['zz','ZZ Differenz','num'],['sam','SAM Differenz','num'],['dgr','DGR Differenz','num'],
    ['exp','EXP Differenz','num'],['exp_dl','EXP Kosten DL','num'],
    ['maut','MT Differenz','num'],['sbfu','SBFU Differenz','num'],['tz','TZ Differenz','num'],
    ['lg_diff','LG Differenz','num'],['av_diff','AV Differenz','num'],
    ['c502_dl','502 Kosten DL','str'],['c503_dl','503 Kosten DL','str'],
    ['_referenz3','ReferenzNr3','str'],['_serv','Serv.-Art','str'],['_sach','Sachkonto','str'],
    ['_plz','Empf.-PLZ','str'],['_ort','Empf.-Ort','str'],['_anzSdg','Anz.Sdg','str'],
  ],
  kn:[
    ['stat','Stat_Freigabe','num'],['tarif','Tarif (raw)','str'],
    ['fr','FR Differenz','num'],['snk_diff','SNK Differenz','num'],['snk_dl','SNK Kosten DL','num'],
    ['exp','EXP Differenz','num'],['toll','MT Differenz','num'],['fuel','TZ Differenz','num'],
    ['referenz','ReferenzNr','str'],['recip','Empf.-Name','str'],
    ['vkg','Volumen kg','num'],['vkg_dl','Volumen kg DL','num'],
    ['kost','Kostenstelle','str'],['sach','Sachkonto','str'],
  ],
  dhl:[
    ['stat','Stat_Freigabe','num'],['tarif','Tarif (raw)','str'],
    ['addr','FR Differenz','num'],['stack','PAL Differenz','num'],['weight','OW Differenz','num'],
    ['conv','YO Differenz','num'],['irr','YL Differenz','num'],['neut','ND Differenz','num'],['sign','SF Differenz','num'],
    ['snk','SNK Differenz','num'],['diff','AC Differenz','num'],['maut','MT Differenz','num'],
    ['surc','NX Differenz','num'],['over','OS Differenz','num'],['tz','TZ Differenz','num'],
    ['kost','KOSTENSTELLE','str'],['sach','SACHKONTO','str'],
  ],
  wackler:[
    ['stat','Stat_Freigabe','num'],['tarif','Tarif (raw)','str'],['target','Existing Anmerkung','str'],
    ['avis_diff','AVIS Differenz','num'],['snk_diff','SNK Differenz','num'],['fr','FR Differenz','num'],
    ['maut','MT Differenz','num'],['tz','TZ Differenz','num'],
    ['referenz','ReferenzNr','str'],
    ['vkg','Volumen kg','num'],['vkg_dl','Volumen kg DL','num'],
    ['empf_plz','Empf.-PLZ','str'],['empf_ort','Empf.-Ort','str'],
    ['kostenstelle','KOSTENSTELLE','str'],['sachkonto','SACHKONTO','str'],
  ],
};

/* Presets that exercise common rule branches — great smoke tests. */
const TESTER_PRESETS={
  dachser:[
    {name:'AUSFALLFRACHT 190',values:{stat:10,snk_dl:190,snk_diff:0}},
    {name:'Saturday delivery',values:{stat:10,sam:25,tarif:'150,00'}},
    {name:'ZW intermediary',values:{stat:10,fr:15,_referenz3:'ZW',_plz:'88499',_ort:'Riedlingen',tarif:'200,00'}},
    {name:'K1AV zeitfenster',values:{stat:10,snk_dl:5,snk_diff:12,_serv:'K1AV',tarif:'100,00'}},
    {name:'SNK non-int → 9 (Tel. ZTV)',values:{stat:10,snk_dl:14.72,snk_diff:9.01,snk_tar:5.71,tarif:'156,88',maut:-6.23,_serv:'DA01',_sach:'612100'}},
    {name:'SNK non-int → 5 (Auto ZTV)',values:{stat:10,snk_dl:7.57,snk_diff:5.01,snk_tar:2.56,tarif:'73,21',tz:0.01}},
    {name:'Negative FR (Frachtzu/abschlag)',values:{stat:10,fr:-28.58,snk_dl:5,snk_diff:-4.52,tarif:'277,48',_anzSdg:'1',tz:-0.01}},
  ],
  kn:[
    {name:'Bundled, should be',values:{stat:10,fr:15,referenz:'123,456',tarif:'200,00'}},
    {name:'Amazon tariff miss',values:{stat:10,fr:12,recip:'Amazon Logistics',referenz:'single',tarif:'150,00'}},
    {name:'Amazon cross-tier Gewichte',values:{stat:10,fr:22.77,snk_diff:25,recip:'Amazon - BRQ2',referenz:'2542943859',vkg:'434.336',vkg_dl:'494.6',tarif:'223,13',kost:'211FO012',sach:'612100'}},
    {name:'Portal avis 5',values:{stat:10,snk_diff:5,snk_dl:5,tarif:'100,00'}},
    {name:'Pauschalfracht',values:{stat:10,fr:3980,referenz:'2543011467'}},
    {name:'Differenz avis (-9)',values:{stat:10,snk_diff:-9,tarif:'119,17'}},
    {name:'Portal (SNK diff 25)',values:{stat:10,snk_diff:25,tarif:'223,13'}},
    {name:'SNK_DL=12 B2C-zuschlag',values:{stat:10,fr:7.5,snk_dl:12,snk_diff:3,toll:0.31,fuel:2.02,recip:'Tefal',referenz:'2543116871',vkg:'171,087',vkg_dl:'202,5',tarif:'69,32',kost:'211FO012',sach:'612100'}},
    {name:'Portal + Treibstoff combo',values:{stat:10,snk_dl:5,snk_diff:5,fuel:-5.91,recip:'Amazon - DTM1',referenz:'2543101960,2543109101',vkg:'524,273',vkg_dl:'569,4',tarif:'123,61',kost:'211FO012',sach:'612100'}},
    {name:'Clean row',values:{stat:10,kost:'1234',sach:'5678'}},
  ],
  dhl:[
    {name:'Overweight trigger',values:{stat:10,weight:20,tarif:'120,00'}},
    {name:'Non-conv ×15',values:{stat:10,conv:30,tarif:'100,00'}},
    {name:'Elevated risk 60',values:{stat:10,snk:60,tarif:'80,00'}},
    {name:'Fremdnummer dup',values:{stat:10,tarif:'0'}},
  ],
  wackler:[
    {name:'Protected existing',values:{stat:10,target:'Return, ok?'}},
    {name:'AVIS 7.5',values:{stat:10,avis_diff:7.5,tarif:'60,00'}},
    {name:'Riedlingen return',values:{stat:10,fr:10,empf_plz:'88499',empf_ort:'Riedlingen',tarif:'70,00'}},
    {name:'NL-FIX SNK 38',values:{stat:10,snk_diff:38,tarif:'80,00'}},
  ],
};

function renderTesterFields(){
  const fw=selectedFW,wrap=document.getElementById('testerFields'),presetsWrap=document.getElementById('testerPresets'),out=document.getElementById('testerOutput');
  if(!wrap)return;
  if(!fw){
    wrap.innerHTML='';
    presetsWrap.innerHTML='<span class="tester-presets-label">// select a forwarder above to begin</span>';
    if(out)out.innerHTML='<div class="to-label">Result — select a forwarder above and fill in any fields to test</div>';
    return;
  }
  const fields=TESTER_FIELDS[fw]||[];
  wrap.innerHTML=fields.map(([k,l,t])=>
    `<div class="tester-field"><label for="t_${k}">${l}</label><input type="${t==='num'?'text':'text'}" id="t_${k}" data-k="${k}" inputmode="${t==='num'?'decimal':'text'}" autocomplete="off"></div>`
  ).join('');
  const presets=TESTER_PRESETS[fw]||[];
  presetsWrap.innerHTML='<span class="tester-presets-label">// presets:</span>'+
    presets.map((p,i)=>`<button type="button" class="tester-preset" data-i="${i}" onclick="applyTesterPreset(${i})">${p.name}</button>`).join('');
}

function applyTesterPreset(idx){
  const fw=selectedFW;if(!fw)return;
  const preset=(TESTER_PRESETS[fw]||[])[idx];if(!preset)return;
  clearTester();
  Object.entries(preset.values).forEach(([k,v])=>{
    const el=document.getElementById('t_'+k);if(el)el.value=String(v);
  });
  runTester();
}

function clearTester(){
  document.querySelectorAll('#testerFields input').forEach(el=>el.value='');
  const out=document.getElementById('testerOutput');
  if(out)out.innerHTML='<div class="to-label">Result — fill in any fields to test</div>';
}

/* Build a synthetic ws that maps column index -> {v}. Keep column
   indices assigned in a Map keyed by the cols.* property name. */
function buildSyntheticWs(fw,userVals){
  const ws={};
  const cols={};
  let nextCol=1; /* column 0 reserved, anything starting >=1 is fine */
  /* cols.target has special meaning — only assign if user provided value
     or if wackler (so it can exist and be empty for rules that read it). */
  const realFields=(TESTER_FIELDS[fw]||[]).filter(([k])=>!k.startsWith('_'));
  for(const [k] of realFields){
    const col=nextCol++;
    cols[k]=col;
    const v=userVals[k];
    if(v!==undefined&&v!==''){
      ws[XLSX.utils.encode_cell({r:3,c:col})]={v};
    }
  }
  /* Dachser reads a handful of values from hard-coded indices — we need
     to place them at those exact DA_COL_* indices for the processor to find. */
  if(fw==='dachser'){
    const placeAt=(idx,v)=>{if(v!==undefined&&v!=='')ws[XLSX.utils.encode_cell({r:3,c:idx})]={v};};
    placeAt(DA_COL_REFERENZ3,userVals._referenz3);
    placeAt(DA_COL_SERV_ART,userVals._serv);
    placeAt(DA_COL_SACHKONTO,userVals._sach);
    placeAt(DA_COL_EMPF_PLZ,userVals._plz);
    placeAt(DA_COL_EMPF_ORT,userVals._ort);
    placeAt(DA_COL_ANZ_SDG,userVals._anzSdg);
  }
  /* Fill missing cols with -1 so processors know the field is absent. */
  const allKeys={
    dachser:['target','stat','tarif','zz','dgr','exp','exp_dl','snk_diff','snk_dl','snk_tar','sbfu','sam','fr','maut','tz','c502_dl','c503_dl','lg_diff','av_diff'],
    kn:['target','stat','tarif','recip','referenz','vkg','vkg_dl','kost','sach','fr','exp','toll','snk_dl','snk_diff','fuel'],
    dhl:['target','stat','tarif','sach','kost','addr','stack','weight','conv','irr','neut','sign','snk','diff','maut','surc','over','tz'],
    wackler:['target','stat','tarif','avis_diff','snk_diff','fr','maut','tz','referenz','vkg','vkg_dl','empf_plz','empf_ort','kostenstelle','sachkonto'],
  }[fw]||[];
  for(const k of allKeys)if(cols[k]===undefined)cols[k]=-1;
  return{ws,cols};
}

function runTester(){
  const fw=selectedFW,out=document.getElementById('testerOutput');
  if(!fw){out.innerHTML='<div class="to-label">Result</div><div class="to-null">Select a forwarder first.</div>';return;}
  const userVals={};
  document.querySelectorAll('#testerFields input').forEach(el=>{
    const v=el.value.trim();if(v!=='')userVals[el.dataset.k]=v;
  });
  const{ws,cols}=buildSyntheticWs(fw,userVals);
  let result;
  try{
    if(fw==='dachser')result=processDachser(ws,3,cols);
    else if(fw==='kn')result=processKN(ws,3,cols);
    else if(fw==='dhl')result=processDHL(ws,3,cols);
    else result=processWackler(ws,3,cols);
  }catch(e){
    out.innerHTML='<div class="to-label">Error</div><div class="to-null">'+String(e.message||e)+'</div>';
    return;
  }
  const reason=buildReason(fw,ws,3,cols);
  const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let body;
  if(result===null){
    body='<div class="to-null">null — row would be skipped (Stat_Freigabe ≠ 10 or protected existing value).</div>';
  } else if(result===''){
    body='<div class="to-empty">empty — no trigger fired, row would be filled with blank.</div>';
  } else {
    body='<div class="to-result">'+esc(result)+'</div>';
  }
  out.innerHTML=
    '<div class="to-label">Result — '+fw+'</div>'+body+
    (reason?'<div class="to-reason">Reason trace: '+esc(reason)+'</div>':'');
}

/* ══════════════════════════════════════════════════════════
   DIFF MODE (#19) — compare two processed xlsx files on the
   Anmerkung column per sheet/row. Purely client-side.
══════════════════════════════════════════════════════════ */
const diffState={a:null,b:null,results:null};

function onDiffDrag(e,slot,over){e.preventDefault();const el=document.getElementById('diffSlot'+slot.toUpperCase());if(el)el.classList.toggle('drag',over);}
function onDiffDrop(e,slot){e.preventDefault();onDiffDrag(e,slot,false);const f=e.dataTransfer.files&&e.dataTransfer.files[0];if(f)loadDiffFile(slot,f);}
function onDiffFile(e,slot){const f=e.target.files&&e.target.files[0];if(f)loadDiffFile(slot,f);}
function loadDiffFile(slot,file){
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'array',cellNF:true});
      diffState[slot]={name:file.name,wb};
      const el=document.getElementById('diffSlot'+slot.toUpperCase());el.classList.add('loaded');
      document.getElementById('diffName'+slot.toUpperCase()).textContent=file.name+' \u00b7 '+wb.SheetNames.length+' sheet(s)';
      document.getElementById('btnDiffRun').disabled=!(diffState.a&&diffState.b);
      showLog('Diff — loaded '+slot.toUpperCase()+': '+file.name,'ok');
    }catch(err){showLog('Diff — could not read '+slot.toUpperCase()+': '+err.message,'err');}
  };
  r.readAsArrayBuffer(file);
}
function clearDiff(){
  diffState.a=null;diffState.b=null;diffState.results=null;
  ['a','b'].forEach(s=>{
    const el=document.getElementById('diffSlot'+s.toUpperCase());el.classList.remove('loaded','drag');
    document.getElementById('diffName'+s.toUpperCase()).textContent='Click or drop an .xlsx';
    document.getElementById('diffInput'+s.toUpperCase()).value='';
  });
  document.getElementById('btnDiffRun').disabled=true;
  document.getElementById('btnDiffCsv').style.display='none';
  const tCsv=document.getElementById('btnDiffTrainCsv');if(tCsv)tCsv.style.display='none';
  const tJsonl=document.getElementById('btnDiffTrainJsonl');if(tJsonl)tJsonl.style.display='none';
  const incWrap=document.getElementById('diffIncludeMatchWrap');if(incWrap)incWrap.style.display='none';
  const incCb=document.getElementById('diffIncludeMatch');if(incCb)incCb.checked=false;
  document.getElementById('diffResults').style.display='none';
  document.getElementById('diffEmpty').style.display='none';
  /* Reset filter state + counters */
  diffFilter.label='all';diffFilter.fw='all';diffFilter.sheet='all';diffFilter.q='';
  const setCt=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  ['tcAll','tcWrong','tcMissed','tcOverfired','tcDrift','tcCorrect'].forEach(id=>setCt(id,'0'));
  ['ctDiffCsv','ctTrainCsv','ctTrainJsonl'].forEach(id=>setCt(id,''));
  document.querySelectorAll('#trainChips .train-chip').forEach(b=>b.classList.toggle('active',b.dataset.label==='all'));
  const fwSel=document.getElementById('diffFwFilter');if(fwSel)fwSel.innerHTML='<option value="all">all</option>';
  const shSel=document.getElementById('diffSheetFilter');if(shSel)shSel.innerHTML='<option value="all">all</option>';
  const q=document.getElementById('diffSearch');if(q)q.value='';
}

/* Locate the Anmerkung column by scanning row 3 (and row 2 as a fallback). */
function findAnmerkungCol(ws,range){
  for(let c=0;c<=range.e.c;c++){
    const v3=(ws[XLSX.utils.encode_cell({r:2,c})]||{v:''}).v;
    if(String(v3||'').trim().toLowerCase()==='anmerkung')return c;
  }
  for(let c=0;c<=range.e.c;c++){
    const v2=(ws[XLSX.utils.encode_cell({r:1,c})]||{v:''}).v;
    if(String(v2||'').trim().toLowerCase()==='anmerkung')return c;
  }
  return -1;
}

/* ──────────────────────────────────────────────────────────
   TRAINING CONSOLE STATE + HELPERS
   Every diff row is enriched with forwarder / label /
   engine-now prediction / trigger trace / input cells so both
   the table and the training-set export can consume the same
   records — no second sheet walk.
────────────────────────────────────────────────────────── */
const diffFilter={label:'all',fw:'all',sheet:'all',q:''};
const LABEL_CLASS={wrong:'df-wrong',missed:'df-missed',overfired:'df-overfired',correct:'df-correct'};
function _resolverFor(fw){
  if(fw==='dachser')return resolveDachser;
  if(fw==='kn')return resolveKN;
  if(fw==='dhl')return resolveDHL;
  if(fw==='wackler')return resolveWackler;
  return null;
}
function _processorFor(fw){
  if(fw==='dachser')return processDachser;
  if(fw==='kn')return processKN;
  if(fw==='dhl')return processDHL;
  if(fw==='wackler')return processWackler;
  return null;
}
/* Pick the forwarder whose resolver finds the most known columns on
   the sheet. Tie-break: dachser → kn → dhl → wackler. Falls back to
   the currently-selected forwarder, then 'unknown'. */
function detectForwarderForSheet(ws,range){
  const order=['dachser','kn','dhl','wackler'];
  let best=null,bestScore=-1;
  for(const fw of order){
    const fn=_resolverFor(fw);if(!fn)continue;
    let cols;try{cols=fn(ws,range);}catch(_){continue;}
    if(cols.target<0)continue;
    let score=0;for(const k of Object.keys(cols))if(cols[k]>=0)score++;
    if(score>bestScore){bestScore=score;best=fw;}
  }
  return best||selectedFW||'unknown';
}
function classifyDiff(vA,vB){
  const a=(vA||'').trim(),b=(vB||'').trim();
  if(a===b)return 'correct';
  if(!a&&b)return 'missed';
  if(a&&!b)return 'overfired';
  return 'wrong';
}

function runDiff(){
  if(!diffState.a||!diffState.b){showLog('Diff — load both files first.','err');return;}
  const rows=[];
  let added=0,removed=0,changed=0,total=0;
  let wrong=0,missed=0,overfired=0,correct=0,drift=0;
  const fwSet=new Set(),sheetSet=new Set();
  const sheetsA=diffState.a.wb.SheetNames,sheetsB=diffState.b.wb.SheetNames;
  const allSheets=[...new Set([...sheetsA,...sheetsB])];

  for(const name of allSheets){
    const wsA=diffState.a.wb.Sheets[name],wsB=diffState.b.wb.Sheets[name];
    if(!wsA||!wsB){
      rows.push({sheet:name,row:'—',label:'sheet',change:'sheet',fw:'-',before:wsA?'(present)':'(missing in A)',after:wsB?'(present)':'(missing in B)',engineNow:'',engineMatchesA:true,reason:'',inputs:{},hasDrift:false});
      sheetSet.add(name);
      continue;
    }
    const rA=XLSX.utils.decode_range(wsA['!ref']||'A1:A1'),rB=XLSX.utils.decode_range(wsB['!ref']||'A1:A1');
    const fw=detectForwarderForSheet(wsA,rA);
    const resolver=_resolverFor(fw),processor=_processorFor(fw);
    const colsA=resolver?resolver(wsA,rA):null,colsB=resolver?resolver(wsB,rB):null;
    const cA=colsA&&colsA.target>=0?colsA.target:findAnmerkungCol(wsA,rA);
    const cB=colsB&&colsB.target>=0?colsB.target:findAnmerkungCol(wsB,rB);
    if(cA<0||cB<0){
      rows.push({sheet:name,row:'—',label:'sheet',change:'sheet',fw,before:cA<0?'(no Anmerkung col)':'(ok)',after:cB<0?'(no Anmerkung col)':'(ok)',engineNow:'',engineMatchesA:true,reason:'',inputs:{},hasDrift:false});
      sheetSet.add(name);
      continue;
    }
    sheetSet.add(name);
    fwSet.add(fw);

    const lastRow=Math.max(rA.e.r,rB.e.r);
    for(let r=3;r<=lastRow;r++){
      total++;
      const vA=cellStr(wsA,r,cA),vB=cellStr(wsB,r,cB);
      const label=classifyDiff(vA,vB);

      /* Training labels — the top 4 classic tiles are derived from these
         afterward (added = missed, removed = overfired, changed = wrong). */
      if(label==='correct'){correct++;}
      else if(label==='wrong'){wrong++;}
      else if(label==='missed'){missed++;}
      else if(label==='overfired'){overfired++;}

      /* Engine-now prediction + trigger trace: only meaningful when we
         have a resolver AND the row isn't a null-sheet error entry. */
      let engineNow='',engineMatchesA=true,reason='',inputs={};
      if(processor&&colsA){
        try{
          const p=processor(wsA,r,colsA);
          engineNow=(p==null?'':String(p));
          engineMatchesA=engineNow===(vA||'');
          if(!engineMatchesA)drift++;
          try{reason=buildReason(fw,wsA,r,colsA)||'';}catch(_){reason='';}
          inputs=collectInputsForRow(fw,wsA,r,colsA);
        }catch(e){engineNow='';reason='engine error: '+(e.message||e);}
      }

      /* Only keep mismatches in the row set by default; 'correct' rows
         are kept too so the chip filter can reveal them when the user
         ticks "Include matching rows". They're hidden in the default
         table view via filterDiffRows(). */
      rows.push({sheet:name,row:r+1,label,change:label==='missed'?'added':(label==='overfired'?'removed':(label==='wrong'?'changed':'correct')),fw,before:vA,after:vB,engineNow,engineMatchesA,hasDrift:!engineMatchesA,reason,inputs});
    }
  }

  /* Keep classic tile semantics: "added" = missed (B filled, A empty),
     "removed" = overfired (A filled, B empty), "changed" = wrong. */
  added=missed;removed=overfired;changed=wrong;

  diffState.results={rows,total,added,removed,changed,wrong,missed,overfired,correct,drift,
    forwarders:[...fwSet].sort(),sheets:[...sheetSet].sort()};
  renderDiff();
}

/* Collect the structured input cells the rules actually read. Mirrors
   tsCollectInputs but keyed directly by forwarder for the runDiff pass. */
function collectInputsForRow(fw,ws,r,cols){
  const o={};
  const get=(k,c)=>{if(c===undefined||c<0)return;const v=cellStr(ws,r,c);if(v!=='')o[k]=v;};
  if(fw==='dachser'){
    get('stat',cols.stat);get('tarif',cols.tarif);get('fr_diff',cols.fr);
    get('vkg',cols.vkg);get('vkg_dl',cols.vkg_dl);
    get('snk_dl',cols.snk_dl);get('snk_diff',cols.snk_diff);get('snk_tarif',cols.snk_tar);
    get('zz_diff',cols.zz);get('sam_diff',cols.sam);get('dgr_diff',cols.dgr);
    get('exp_diff',cols.exp);get('exp_dl',cols.exp_dl);
    get('maut_diff',cols.maut);get('sbfu_diff',cols.sbfu);get('tz_diff',cols.tz);
    get('lg_diff',cols.lg_diff);get('av_diff',cols.av_diff);
    const placeIf=(k,idx)=>{const v=cellStr(ws,r,idx);if(v)o[k]=v;};
    placeIf('referenz3',DA_COL_REFERENZ3);placeIf('empf_plz',DA_COL_EMPF_PLZ);
    placeIf('empf_ort',DA_COL_EMPF_ORT);placeIf('anz_sdg',DA_COL_ANZ_SDG);
    placeIf('serv_art',DA_COL_SERV_ART);placeIf('sachkonto',DA_COL_SACHKONTO);
  } else if(fw==='kn'){
    get('stat',cols.stat);get('tarif',cols.tarif);
    get('fr_diff',cols.fr);get('exp_diff',cols.exp);get('mt_diff',cols.toll);get('tz_diff',cols.fuel);
    get('snk_dl',cols.snk_dl);get('snk_diff',cols.snk_diff);
    get('referenz',cols.referenz);get('recip',cols.recip);
    get('vkg',cols.vkg);get('vkg_dl',cols.vkg_dl);
    get('kostenstelle',cols.kost);get('sachkonto',cols.sach);
  } else if(fw==='dhl'){
    get('stat',cols.stat);get('tarif',cols.tarif);
    get('fr_diff',cols.addr);get('pal_diff',cols.stack);get('ow_diff',cols.weight);
    get('yo_diff',cols.conv);get('yl_diff',cols.irr);get('nd_diff',cols.neut);get('sf_diff',cols.sign);
    get('snk_diff',cols.snk);get('ac_diff',cols.diff);get('mt_diff',cols.maut);
    get('nx_diff',cols.surc);get('os_diff',cols.over);get('tz_diff',cols.tz);
    get('kostenstelle',cols.kost);get('sachkonto',cols.sach);
  } else if(fw==='wackler'){
    get('stat',cols.stat);get('tarif',cols.tarif);get('existing_anmerkung',cols.target);
    get('avis_diff',cols.avis_diff);get('snk_diff',cols.snk_diff);get('fr_diff',cols.fr);
    get('mt_diff',cols.maut);get('tz_diff',cols.tz);
    get('referenz',cols.referenz);
    get('vkg',cols.vkg);get('vkg_dl',cols.vkg_dl);
    get('empf_plz',cols.empf_plz);get('empf_ort',cols.empf_ort);
    get('kostenstelle',cols.kostenstelle);get('sachkonto',cols.sachkonto);
  }
  return o;
}

/* Apply every active filter (label chip + forwarder + sheet + search)
   to the enriched row set. 'drift' is pseudo-label — rows whose engine
   disagrees with A, regardless of their wrong/missed/overfired label. */
function filterDiffRows(){
  if(!diffState.results)return [];
  const{rows}=diffState.results;
  const{label,fw,sheet,q}=diffFilter;
  const includeMatches=!!document.getElementById('diffIncludeMatch')?.checked;
  const needle=q.trim().toLowerCase();
  return rows.filter(r=>{
    if(r.change==='sheet')return label==='all'&&fw==='all'&&(sheet==='all'||sheet===r.sheet);
    if(label==='drift'){if(!r.hasDrift)return false;}
    else if(label!=='all'){if(r.label!==label)return false;}
    else {if(r.label==='correct'&&!includeMatches)return false;}
    if(fw!=='all'&&r.fw!==fw)return false;
    if(sheet!=='all'&&r.sheet!==sheet)return false;
    if(needle){
      const hay=((r.before||'')+' '+(r.after||'')+' '+(r.reason||'')+' '+(r.engineNow||'')).toLowerCase();
      if(!hay.includes(needle))return false;
    }
    return true;
  });
}

function renderDiff(){
  if(!diffState.results)return;
  const{total,added,removed,changed,wrong,missed,overfired,correct,drift,forwarders,sheets}=diffState.results;

  /* Classic top-4 tiles */
  document.getElementById('dCount').textContent=total;
  document.getElementById('dAdded').textContent=added;
  document.getElementById('dRemoved').textContent=removed;
  document.getElementById('dChanged').textContent=changed;

  /* Training chips */
  const totalNonSheet=wrong+missed+overfired+correct;
  document.getElementById('tcAll').textContent=totalNonSheet;
  document.getElementById('tcWrong').textContent=wrong;
  document.getElementById('tcMissed').textContent=missed;
  document.getElementById('tcOverfired').textContent=overfired;
  document.getElementById('tcDrift').textContent=drift;
  document.getElementById('tcCorrect').textContent=correct;

  /* Forwarder filter dropdown */
  const fwSel=document.getElementById('diffFwFilter');
  if(fwSel){
    const prev=diffFilter.fw;
    fwSel.innerHTML='<option value="all">all</option>'+forwarders.map(f=>`<option value="${f}">${f}</option>`).join('');
    fwSel.value=forwarders.includes(prev)?prev:'all';
    diffFilter.fw=fwSel.value;
  }
  /* Sheet filter dropdown */
  const shSel=document.getElementById('diffSheetFilter');
  if(shSel){
    const prev=diffFilter.sheet;
    shSel.innerHTML='<option value="all">all</option>'+sheets.map(s=>`<option value="${s}">${s}</option>`).join('');
    shSel.value=sheets.includes(prev)?prev:'all';
    diffFilter.sheet=shSel.value;
  }

  /* Visibility of the results block */
  const anyDiff=(wrong+missed+overfired)>0;
  const hasSheetWarnings=diffState.results.rows.some(r=>r.change==='sheet');
  if(!anyDiff&&!correct&&!hasSheetWarnings){
    document.getElementById('diffResults').style.display='none';
    document.getElementById('diffEmpty').style.display='block';
    document.getElementById('btnDiffCsv').style.display='none';
    const tCsv=document.getElementById('btnDiffTrainCsv');if(tCsv)tCsv.style.display='none';
    const tJsonl=document.getElementById('btnDiffTrainJsonl');if(tJsonl)tJsonl.style.display='none';
    const incWrap=document.getElementById('diffIncludeMatchWrap');if(incWrap)incWrap.style.display='none';
  } else {
    document.getElementById('diffResults').style.display='block';
    document.getElementById('diffEmpty').style.display='none';
    document.getElementById('btnDiffCsv').style.display='inline-block';
    const tCsv=document.getElementById('btnDiffTrainCsv');if(tCsv)tCsv.style.display='inline-block';
    const tJsonl=document.getElementById('btnDiffTrainJsonl');if(tJsonl)tJsonl.style.display='inline-block';
    const incWrap=document.getElementById('diffIncludeMatchWrap');if(incWrap)incWrap.style.display='flex';
  }

  refreshDiffView();
  showLog(`Diff \u2014 ${wrong} wrong, ${missed} missed, ${overfired} overfired, ${drift} engine-drift (${total} rows scanned across ${forwarders.length||1} forwarder(s)).`,'ok');
}

/* Rebuild the visible table + meta line + export-button counters from
   the current filter state. Called by runDiff, the chip buttons, the
   filter inputs, and the include-matches checkbox. */
function refreshDiffView(){
  if(!diffState.results)return;
  const filtered=filterDiffRows();
  const{rows,total,forwarders}=diffState.results;
  const MAX=500;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  document.getElementById('diffMeta').textContent=
    `A: ${diffState.a.name}  \u2194  B: ${diffState.b.name}  \u00b7  ${total} rows scanned across ${forwarders.length||1} forwarder(s)`;

  const tbody=document.querySelector('#diffTable tbody');
  const slice=filtered.slice(0,MAX);
  tbody.innerHTML=slice.map((r,i)=>renderDiffRow(r,i,esc)).join('');

  const foot=document.getElementById('diffTableFoot');
  if(foot){
    if(!filtered.length){foot.textContent='// no rows match the current filter — loosen a chip or clear the search.';}
    else if(filtered.length>MAX){foot.textContent=`// showing first ${MAX} of ${filtered.length} matching rows — use filters to narrow.`;}
    else if(filtered.length<rows.length){foot.textContent=`// showing ${filtered.length} of ${rows.length} rows (filtered).`;}
    else{foot.textContent=`// showing all ${filtered.length} rows.`;}
  }

  /* Export-button counters — all reflect the current filter */
  const trainable=filtered.filter(r=>r.change!=='sheet').length;
  document.getElementById('ctDiffCsv').textContent=filtered.length?`\u00b7 ${filtered.length}`:'';
  document.getElementById('ctTrainCsv').textContent=trainable?`\u00b7 ${trainable}`:'';
  document.getElementById('ctTrainJsonl').textContent=trainable?`\u00b7 ${trainable}`:'';

  /* Active chip visual state */
  document.querySelectorAll('#trainChips .train-chip').forEach(b=>
    b.classList.toggle('active',b.dataset.label===diffFilter.label));

  /* Keep select values in sync (handles programmatic changes). */
  const fwSel=document.getElementById('diffFwFilter');if(fwSel&&fwSel.value!==diffFilter.fw)fwSel.value=diffFilter.fw;
  const shSel=document.getElementById('diffSheetFilter');if(shSel&&shSel.value!==diffFilter.sheet)shSel.value=diffFilter.sheet;
}

function renderDiffRow(r,i,esc){
  if(r.change==='sheet'){
    return `<tr class="df-sheet"><td>${esc(r.sheet)}</td><td>${r.row}</td><td><span class="fw-pill fw-${r.fw}">${esc(r.fw)}</span></td><td><span class="lbl-pill lbl-sheet">sheet</span></td><td class="df-before">${esc(r.before)}</td><td class="df-after">${esc(r.after)}</td><td class="df-engine"></td><td class="df-actions"></td></tr>`;
  }
  const labelCls=LABEL_CLASS[r.label]||'';
  const engine=renderEngineCell(r,esc);
  const actions=`<button type="button" class="df-expand-btn" aria-expanded="false" title="Show inputs + reason trace" onclick="toggleDiffDetail(${i})">›</button>`;
  return `<tr class="${labelCls}" data-row-i="${i}"><td>${esc(r.sheet)}</td><td>${r.row}</td><td><span class="fw-pill fw-${r.fw}">${esc(r.fw)}</span></td><td><span class="lbl-pill lbl-${r.label}">${r.label}</span></td><td class="df-before">${esc(r.before||'\u2014')}</td><td class="df-after">${esc(r.after||'\u2014')}</td>${engine}<td class="df-actions">${actions}</td></tr>`;
}

function renderEngineCell(r,esc){
  if(!r.engineNow&&!r.reason){return '<td class="df-engine empty"><span class="df-engine-val">\u2014</span></td>';}
  if(r.engineMatchesA){
    return `<td class="df-engine match"><span class="match-dot"></span><span class="df-engine-val">${esc(r.engineNow||'\u2014')}</span></td>`;
  }
  return `<td class="df-engine drift" title="Engine disagrees with slot A"><span class="drift-dot"></span><span class="df-engine-val">${esc(r.engineNow||'(empty)')}</span></td>`;
}

/* Expand/collapse the detail drawer for a single row. Shows the
   structured inputs the rule engine read + the trigger trace + a
   "Send to Tester" button that pre-fills the Rule Tester with that
   exact case and scrolls to it. */
function toggleDiffDetail(i){
  const btn=document.querySelector(`.diff-table tr[data-row-i="${i}"] .df-expand-btn`);
  const mainTr=document.querySelector(`.diff-table tr[data-row-i="${i}"]`);
  if(!mainTr||!btn)return;
  const existing=document.querySelector(`.diff-table tr.df-detail[data-for="${i}"]`);
  if(existing){existing.remove();btn.classList.remove('open');btn.setAttribute('aria-expanded','false');btn.textContent='›';return;}
  const filtered=filterDiffRows();const r=filtered[i];if(!r)return;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const keys=Object.keys(r.inputs||{});
  const kv=keys.length
    ? keys.map(k=>`<div class="df-detail-kv"><span class="kv-k">${esc(k)}</span><span class="kv-v" title="${esc(r.inputs[k])}">${esc(r.inputs[k])}</span></div>`).join('')
    : '<div class="df-detail-kv empty"><span class="kv-k">inputs</span><span class="kv-v">(no rule-visible cells captured — unknown forwarder)</span></div>';
  const reasonHtml=r.reason
    ? `<div class="df-reason-block"><span class="rb-label">trigger trace</span>${esc(r.reason)}</div>`
    : '<div class="df-reason-block empty"><span class="rb-label">trigger trace</span>(engine produced no reason — either no rule fired or forwarder unknown)</div>';
  const canSend=r.fw&&r.fw!=='-'&&r.fw!=='unknown';
  const sendBtn=canSend
    ? `<button type="button" class="df-send-tester" onclick="sendDiffToTester(${i})" title="Open this case in the Rule Tester with every input pre-filled">✦ Send to Tester</button>`
    : '';
  const tr=document.createElement('tr');
  tr.className='df-detail';tr.dataset.for=String(i);
  tr.innerHTML=`<td colspan="8"><div class="df-detail-wrap"><div class="df-detail-grid">${kv}${reasonHtml}</div>${sendBtn?`<div>${sendBtn}</div>`:''}</div></td>`;
  mainTr.after(tr);
  btn.classList.add('open');btn.setAttribute('aria-expanded','true');btn.textContent='\u00b7';
}

/* Programmatically switch forwarder (mirrors selectFW's side effects),
   open the tester panel if collapsed, pre-fill every matching field
   from the diff row's captured inputs, and auto-evaluate. */
function sendDiffToTester(i){
  const filtered=filterDiffRows();const r=filtered[i];if(!r)return;
  if(!r.fw||r.fw==='unknown'){showLog('Send to Tester \u2014 unknown forwarder, cannot pre-fill.','err');return;}
  /* 1. Select forwarder tile */
  const tile=document.querySelector(`.fw-btn[data-fw="${r.fw}"]`);
  if(tile&&tile.getAttribute('aria-checked')!=='true')selectFW(tile);
  /* 2. Open the Rule Tester panel if collapsed */
  const testerPanel=document.getElementById('testerPanel');
  if(testerPanel&&!testerPanel.classList.contains('open'))toggleBonus('tester');
  else renderTesterFields();
  /* 3. Map diff-input keys (collectInputsForRow) -> tester field ids
     (TESTER_FIELDS[fw][*][0], rendered as `t_<key>`). The two key sets
     were historically out of sync for every forwarder except wackler,
     which silently dropped numeric inputs like fr/maut/tz/exp into the
     tester and caused the tester's output to diverge from the engine
     (classic symptom: "Portalavisierung, ok? // Kontierung?" instead
     of "Differenz aufgrund abweichender Gewichte // …" because the FR
     value and Kostenstelle/Sachkonto never made it across). This map
     is exhaustive per forwarder. */
  const REMAP_BY_FW={
    dachser:{
      fr_diff:'fr',snk_tarif:'snk_tar',zz_diff:'zz',sam_diff:'sam',dgr_diff:'dgr',
      exp_diff:'exp',maut_diff:'maut',sbfu_diff:'sbfu',tz_diff:'tz',
      referenz3:'_referenz3',empf_plz:'_plz',empf_ort:'_ort',anz_sdg:'_anzSdg',
      serv_art:'_serv',sachkonto:'_sach',
    },
    kn:{
      fr_diff:'fr',exp_diff:'exp',mt_diff:'toll',tz_diff:'fuel',
      kostenstelle:'kost',sachkonto:'sach',
    },
    dhl:{
      fr_diff:'addr',pal_diff:'stack',ow_diff:'weight',
      yo_diff:'conv',yl_diff:'irr',nd_diff:'neut',sf_diff:'sign',
      snk_diff:'snk',ac_diff:'diff',mt_diff:'maut',
      nx_diff:'surc',os_diff:'over',tz_diff:'tz',
      kostenstelle:'kost',sachkonto:'sach',
    },
    wackler:{
      existing_anmerkung:'target',fr_diff:'fr',mt_diff:'maut',tz_diff:'tz',
    },
  };
  const remap=REMAP_BY_FW[r.fw]||{};
  clearTester();
  const vals=r.inputs||{};
  Object.entries(vals).forEach(([k,v])=>{
    const tk=remap[k]||k;
    const el=document.getElementById('t_'+tk);
    if(el)el.value=String(v);
  });
  /* 4. Also inject the existing Anmerkung value so wackler's "protected"
     branch can exercise when relevant. */
  if(r.before){
    const tgt=document.getElementById('t_target');if(tgt&&!tgt.value)tgt.value=r.before;
  }
  runTester();
  /* 5. Scroll the tester into view so the user sees the result. */
  document.getElementById('testerPanel').scrollIntoView({behavior:'smooth',block:'start'});
  showLog(`Send to Tester \u2014 loaded ${r.fw} row ${r.row} (${r.label}). Tweak the rule, re-evaluate, then re-run Train & Compare.`,'ok');
}

/* Chip handler — 'drift' is a pseudo-label that bypasses the
   label-match check and filters on hasDrift instead. */
function setDiffLabelFilter(label){diffFilter.label=label;refreshDiffView();}

function resetDiffFilters(){
  diffFilter.label='all';diffFilter.fw='all';diffFilter.sheet='all';diffFilter.q='';
  const fwSel=document.getElementById('diffFwFilter');if(fwSel)fwSel.value='all';
  const shSel=document.getElementById('diffSheetFilter');if(shSel)shSel.value='all';
  const q=document.getElementById('diffSearch');if(q)q.value='';
  const inc=document.getElementById('diffIncludeMatch');if(inc)inc.checked=false;
  refreshDiffView();
}

/* Keep the free-text search in sync with diffFilter (oninput handler
   on #diffSearch calls refreshDiffView which reads this via
   filterDiffRows — but we also mirror into diffFilter so the export
   honors it even if the input is read late). */
(function bindDiffSearch(){
  document.addEventListener('DOMContentLoaded',()=>{
    const q=document.getElementById('diffSearch');
    if(q)q.addEventListener('input',()=>{diffFilter.q=q.value;});
    const fwSel=document.getElementById('diffFwFilter');
    if(fwSel)fwSel.addEventListener('change',()=>{diffFilter.fw=fwSel.value;});
    const shSel=document.getElementById('diffSheetFilter');
    if(shSel)shSel.addEventListener('change',()=>{diffFilter.sheet=shSel.value;});
  });
})();

function downloadDiffCsv(){
  if(!diffState.results)return;
  const rows=filterDiffRows();
  if(!rows.length){showLog('Diff CSV \u2014 nothing to export (filter scope is empty).','err');return;}
  const esc=s=>{const v=String(s==null?'':s);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  /* Collect every input key that appears in the filtered scope so we can
     emit one column per rule-visible cell (Volumen kg, FR Differenz, MT
     Differenz, TZ Differenz, Tarif, Stat_Freigabe, Sachkonto, …). Without
     these the diff CSV was just before/after/reason — useless for triage
     unless you also opened the source xlsx side-by-side. */
  const inputKeys=[];const seen=new Set();
  for(const r of rows){
    if(r.change==='sheet')continue;
    for(const k of Object.keys(r.inputs||{})){
      if(!seen.has(k)){seen.add(k);inputKeys.push(k);}
    }
  }
  const header=['sheet','row','forwarder','label','change','before','after','engine_now','engine_matches_a','reason',...inputKeys.map(k=>'in_'+k)];
  const lines=[header.join(',')];
  for(const r of rows){
    const base=[r.sheet,r.row,r.fw,r.label,r.change,r.before,r.after,r.engineNow||'',r.engineMatchesA?'true':'false',r.reason||''];
    for(const k of inputKeys){const v=(r.inputs||{})[k];base.push(v==null?'':v);}
    lines.push(base.map(esc).join(','));
  }
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.href=url;a.download='anmerkung_diff_'+stamp+'.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showLog(`Diff CSV exported \u2014 ${rows.length} row(s), ${inputKeys.length} input column(s).`,'ok');
}

/* ══════════════════════════════════════════════════════════
   TRAINING SET EXPORT (#20) — build (predicted, expected) pairs
   from the diff, enriched with the input cells each forwarder's
   rules actually read + the trigger trace (reason).

   A = your tool's output (predicted)
   B = hand-corrected truth (expected)

   Row label:
     • "wrong"     — both non-empty, disagree
     • "missed"    — A empty, B non-empty (rule should have fired)
     • "overfired" — A non-empty, B empty (rule fired when it shouldn't have)
     • "correct"   — A === B (only exported when the "Include matching rows" checkbox is ticked)

   Forwarder is auto-detected per sheet by scanning which resolver finds
   the most known columns; falls back to the currently-selected forwarder.
══════════════════════════════════════════════════════════ */

const FW_RESOLVERS={dachser:resolveDachser,kn:resolveKN,dhl:resolveDHL,wackler:resolveWackler};

/* Count how many known columns a resolver finds for a given sheet.
   More matches = better confidence that this is the right forwarder. */
function tsResolverScore(resolveFn,ws,range){
  try{
    const cols=resolveFn(ws,range);
    let score=0;
    for(const k of Object.keys(cols))if(cols[k]>=0)score++;
    return score;
  }catch(_){return 0;}
}

/* Pick the best forwarder for a sheet. Requires target (Anmerkung) col present.
   Ties broken in this order: dachser, kn, dhl, wackler (most-specific first). */
function tsDetectForwarder(ws,range){
  const order=['dachser','kn','dhl','wackler'];
  let best=null,bestScore=-1;
  for(const fw of order){
    const cols=FW_RESOLVERS[fw](ws,range);
    if(cols.target<0)continue;
    const score=tsResolverScore(FW_RESOLVERS[fw],ws,range);
    if(score>bestScore){bestScore=score;best=fw;}
  }
  if(best)return best;
  return selectedFW||'unknown';
}

/* Classify a mismatch — see comment block above for the label taxonomy. */
function tsLabelFor(before,after){
  const a=(before||'').trim(),b=(after||'').trim();
  if(a===b)return 'correct';
  if(!a&&b)return 'missed';
  if(a&&!b)return 'overfired';
  return 'wrong';
}

/* Collect structured (key -> value) input features for a single row,
   joined by forwarder. Returns an ordered array of {key,value} pairs
   so column order is stable in CSV output. */
function tsCollectInputs(fw,ws,r,cols){
  const pairs=[];
  const push=(k,c)=>{
    if(c===undefined||c<0)return;
    const v=cellStr(ws,r,c);
    pairs.push({key:k,value:v});
  };
  if(fw==='dachser'){
    push('stat',cols.stat);push('tarif',cols.tarif);
    push('fr_diff',cols.fr);
    push('vkg',cols.vkg);push('vkg_dl',cols.vkg_dl);
    push('snk_dl',cols.snk_dl);push('snk_diff',cols.snk_diff);push('snk_tarif',cols.snk_tar);
    push('zz_diff',cols.zz);push('sam_diff',cols.sam);push('dgr_diff',cols.dgr);
    push('exp_diff',cols.exp);push('exp_dl',cols.exp_dl);
    push('maut_diff',cols.maut);push('sbfu_diff',cols.sbfu);push('tz_diff',cols.tz);
    push('lg_diff',cols.lg_diff);push('av_diff',cols.av_diff);
    /* Hard-coded Dachser columns (position-based, same as processor). */
    pairs.push({key:'referenz3',value:cellStr(ws,r,DA_COL_REFERENZ3)});
    pairs.push({key:'empf_plz', value:cellStr(ws,r,DA_COL_EMPF_PLZ)});
    pairs.push({key:'empf_ort', value:cellStr(ws,r,DA_COL_EMPF_ORT)});
    pairs.push({key:'anz_sdg',  value:cellStr(ws,r,DA_COL_ANZ_SDG)});
    pairs.push({key:'serv_art', value:cellStr(ws,r,DA_COL_SERV_ART)});
    pairs.push({key:'sachkonto',value:cellStr(ws,r,DA_COL_SACHKONTO)});
  } else if(fw==='kn'){
    push('stat',cols.stat);
    push('fr_diff',cols.fr);push('exp_diff',cols.exp);push('mt_diff',cols.toll);push('tz_diff',cols.fuel);
    push('snk_dl',cols.snk_dl);push('snk_diff',cols.snk_diff);
    push('referenz',cols.referenz);push('recip',cols.recip);
    push('vkg',cols.vkg);push('vkg_dl',cols.vkg_dl);
    push('kostenstelle',cols.kost);push('sachkonto',cols.sach);
  } else if(fw==='dhl'){
    push('stat',cols.stat);push('tarif',cols.tarif);
    push('fr_diff',cols.addr);push('pal_diff',cols.stack);push('ow_diff',cols.weight);
    push('yo_diff',cols.conv);push('yl_diff',cols.irr);push('nd_diff',cols.neut);push('sf_diff',cols.sign);
    push('snk_diff',cols.snk);push('ac_diff',cols.diff);push('mt_diff',cols.maut);
    push('nx_diff',cols.surc);push('os_diff',cols.over);push('tz_diff',cols.tz);
    push('kostenstelle',cols.kost);push('sachkonto',cols.sach);
  } else if(fw==='wackler'){
    push('stat',cols.stat);push('tarif',cols.tarif);push('existing_anmerkung',cols.target);
    push('avis_diff',cols.avis_diff);push('snk_diff',cols.snk_diff);push('fr_diff',cols.fr);
    push('mt_diff',cols.maut);push('tz_diff',cols.tz);
    push('referenz',cols.referenz);
    push('vkg',cols.vkg);push('vkg_dl',cols.vkg_dl);
    push('empf_plz',cols.empf_plz);push('empf_ort',cols.empf_ort);
    push('kostenstelle',cols.kostenstelle);push('sachkonto',cols.sachkonto);
  }
  return pairs;
}

/* Re-run the actual production processor on slot-A's row to capture
   the trigger trace + verify what the rule engine would produce right
   now. This is how we recover the "reason" / "why" for training data. */
function tsRunRule(fw,ws,r,cols){
  try{
    let predicted=null;
    if(fw==='dachser')predicted=processDachser(ws,r,cols);
    else if(fw==='kn')predicted=processKN(ws,r,cols);
    else if(fw==='dhl')predicted=processDHL(ws,r,cols);
    else if(fw==='wackler')predicted=processWackler(ws,r,cols);
    const reason=buildReason(fw,ws,r,cols);
    return{predicted,reason};
  }catch(e){return{predicted:null,reason:'error: '+(e.message||e)};}
}

/* Build the training-set records directly from the enriched rows
   produced by runDiff — no second sheet walk. Honors the current
   filter scope (chip + forwarder + sheet + search) so the user can
   e.g. export only the "missed" rows for one forwarder. */
function buildTrainingSet(){
  if(!diffState.results||!diffState.results.rows.length)return{records:[],inputKeys:[]};
  const includeMatches=!!document.getElementById('diffIncludeMatch')?.checked;
  const scope=filterDiffRows();
  const records=[];
  const allKeys=new Set();
  for(const r of scope){
    if(r.change==='sheet')continue;
    if(r.label==='correct'&&!includeMatches)continue;
    Object.keys(r.inputs||{}).forEach(k=>allKeys.add(k));
    records.push({
      sheet:r.sheet,
      row:r.row,
      forwarder:r.fw,
      label:r.label,
      predicted:r.before,                     /* what slot A (tool) says */
      expected:r.after,                       /* what slot B (truth) says */
      rule_engine_now:r.engineNow||'',        /* what the current engine would say today */
      engine_matches_a:!!r.engineMatchesA,
      reason:r.reason||'',                    /* trigger trace */
      inputs:r.inputs||{},
    });
  }
  /* Stable ordering of input keys: keep first-seen order from Set iteration. */
  const inputKeys=[...allKeys];
  return{records,inputKeys};
}

function downloadTrainingSet(format){
  const{records,inputKeys}=buildTrainingSet();
  if(!records.length){showLog('Training set \u2014 no rows to export (maybe all rows matched; try "Include matching rows").','err');return;}
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  let blob,ext;
  if(format==='jsonl'){
    const lines=records.map(r=>JSON.stringify(r));
    blob=new Blob([lines.join('\n')+'\n'],{type:'application/x-ndjson;charset=utf-8'});
    ext='jsonl';
  } else {
    /* CSV: flatten inputs to one column per key. */
    const esc=s=>{const v=String(s==null?'':s);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
    const header=['sheet','row','forwarder','label','predicted','expected','rule_engine_now','engine_matches_a','reason',...inputKeys.map(k=>'in_'+k)];
    const lines=[header.join(',')];
    for(const r of records){
      const row=[r.sheet,r.row,r.forwarder,r.label,r.predicted,r.expected,r.rule_engine_now,r.engine_matches_a?'true':'false',r.reason];
      for(const k of inputKeys)row.push(r.inputs[k]==null?'':r.inputs[k]);
      lines.push(row.map(esc).join(','));
    }
    blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    ext='csv';
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='anmerkung_training_'+stamp+'.'+ext;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  /* Quick summary in the log so users know what they got. */
  const by={};for(const r of records)by[r.label]=(by[r.label]||0)+1;
  const parts=Object.keys(by).sort().map(k=>k+'='+by[k]);
  const scopeNote=(diffFilter.label!=='all'||diffFilter.fw!=='all'||diffFilter.sheet!=='all'||(diffFilter.q&&diffFilter.q.trim()))?' (filter-scoped)':'';
  showLog('Training set exported \u2014 '+records.length+' row(s) as '+ext.toUpperCase()+' ('+parts.join(', ')+')'+scopeNote+'.','ok');
}

/* ══════════════════════════════════════════════════════════
   BULK PROCESSING — process multiple files at once,
   each with its own download button + download-all ZIP.
══════════════════════════════════════════════════════════ */
const bulkFiles = []; /* Array of { id, name, file, rawBytes, workbook, resultBlob, status } */
let bulkIdCounter = 0;

function onBulkDrag(e, over) { e.preventDefault(); document.getElementById('bulkDropArea').classList.toggle('drag', over); }
function onBulkDrop(e) { e.preventDefault(); onBulkDrag(e, false); if (e.dataTransfer.files.length) addBulkFiles(e.dataTransfer.files); }
function onBulkFileSelect(e) { if (e.target.files.length) addBulkFiles(e.target.files); e.target.value = ''; }

function addBulkFiles(fileList) {
  for (const file of fileList) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) { showLog('Bulk — skipped non-xlsx: ' + file.name, 'err'); continue; }
    bulkFiles.push({ id: ++bulkIdCounter, name: file.name, file, rawBytes: null, workbook: null, resultBlob: null, status: 'pending' });
  }
  renderBulkList();
  checkBulkReady();
  const fc = document.getElementById('bulkFileCount');
  fc.textContent = bulkFiles.length + ' file(s) queued';
  fc.style.display = bulkFiles.length ? 'block' : 'none';
  showLog('Bulk — ' + bulkFiles.length + ' file(s) queued.', 'ok');
}

function removeBulkFile(id) {
  const idx = bulkFiles.findIndex(f => f.id === id);
  if (idx >= 0) bulkFiles.splice(idx, 1);
  renderBulkList();
  checkBulkReady();
  const fc = document.getElementById('bulkFileCount');
  fc.textContent = bulkFiles.length + ' file(s) queued';
  fc.style.display = bulkFiles.length ? 'block' : 'none';
}

function renderBulkList() {
  const ul = document.getElementById('bulkList');
  if (!bulkFiles.length) { ul.style.display = 'none'; ul.innerHTML = ''; return; }
  ul.style.display = 'block';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  ul.innerHTML = bulkFiles.map(f => {
    const statusCls = f.status === 'done' ? 'done' : (f.status === 'error' ? 'err' : (f.status === 'processing' ? 'processing' : ''));
    const statusText = f.status === 'done' ? '✓ done' : (f.status === 'error' ? '✗ error' : (f.status === 'processing' ? '⟳ ...' : 'pending'));
    const dlVisible = f.status === 'done' ? 'visible' : '';
    return `<li class="bulk-item" data-id="${f.id}">
      <span class="bulk-item-name" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="bulk-item-status ${statusCls}">${statusText}</span>
      <button type="button" class="bulk-item-dl ${dlVisible}" onclick="downloadBulkFile(${f.id})">↓ Download</button>
      <button type="button" class="bulk-item-remove" onclick="removeBulkFile(${f.id})" title="Remove">✕</button>
    </li>`;
  }).join('');
}

function checkBulkReady() {
  const btn = document.getElementById('btnBulkRun');
  btn.disabled = !(selectedFW && bulkFiles.length > 0);
}

function setBulkProgress(pct) {
  const wrap = document.getElementById('bulkProgress');
  wrap.style.display = 'block';
  document.getElementById('bulkProgressFill').style.width = pct + '%';
}

async function runBulkProcess() {
  if (!selectedFW) { showLog('Bulk — select a forwarder first.', 'err'); return; }
  if (!bulkFiles.length) { showLog('Bulk — no files queued.', 'err'); return; }

  const btn = document.getElementById('btnBulkRun');
  btn.disabled = true; btn.textContent = 'Processing...';
  document.getElementById('btnBulkDlAll').style.display = 'none';
  setBulkProgress(2);

  const wantReason = document.getElementById('optReason').checked;
  let doneCount = 0;

  for (let i = 0; i < bulkFiles.length; i++) {
    const entry = bulkFiles[i];
    entry.status = 'processing';
    renderBulkList();

    try {
      /* Read file */
      if (!entry.rawBytes) {
        const buf = await readFileAsArrayBuffer(entry.file);
        entry.rawBytes = buf;
        entry.workbook = XLSX.read(buf, { type: 'array', cellNF: true });
      }

      /* Process using the same engine as single-file mode */
      const savedWb = workbook;
      workbook = entry.workbook;
      const rep = runRules();
      workbook = savedWb;

      const allResults = rep.allResults;
      const zip = await JSZip.loadAsync(entry.rawBytes);
      const ssFile = zip.file('xl/sharedStrings.xml');
      let ssXml = ssFile ? await ssFile.async('string') : '';
      const strings = ssXml ? parseSharedStrings(ssXml) : [];
      const wbXml = await zip.file('xl/workbook.xml').async('string');
      const wbRelXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

      const sheetRids = {};
      for (const m of wbXml.matchAll(/<sheet\b[^>]+\bname="([^"]+)"[^>]+\br:id="(rId\d+)"/g)) sheetRids[m[1]] = m[2];
      const ridPaths = {};
      for (const m of wbRelXml.matchAll(/\bId="(rId\d+)"[^>]+\bTarget="([^"]+)"/g)) ridPaths[m[1]] = m[2];

      const sheetNames = Object.keys(allResults);
      for (const name of sheetNames) {
        const { targetCol, rowMap, reasonMap, targetIdx } = allResults[name];
        if (!rowMap.size && !(wantReason && reasonMap && reasonMap.size)) continue;
        const rId = sheetRids[name]; if (!rId) continue;
        let rel = ridPaths[rId] || '';
        rel = rel.replace(/^\/+/, ''); if (!rel.startsWith('xl/')) rel = 'xl/' + rel;
        let sheetXml = await zip.file(rel).async('string');
        sheetXml = patchSheet(sheetXml, targetCol, rowMap, strings);
        if (wantReason) {
          const reasonColIdx = targetIdx + 1;
          const reasonCol = idxToCol(reasonColIdx);
          const headerMap = new Map([[3, 'Anmerkung_Reason']]);
          sheetXml = patchSheet(sheetXml, reasonCol, headerMap, strings);
          sheetXml = patchSheet(sheetXml, reasonCol, reasonMap, strings);
        }
        zip.file(rel, sheetXml);
      }

      zip.file('xl/sharedStrings.xml', rebuildSharedStrings(strings));
      const ctFile = zip.file('[Content_Types].xml');
      if (ctFile) { let ctXml = await ctFile.async('string'); ctXml = ensureSharedStringsContentType(ctXml); zip.file('[Content_Types].xml', ctXml); }
      const wbRelFile = zip.file('xl/_rels/workbook.xml.rels');
      if (wbRelFile) { let wbRel = await wbRelFile.async('string'); wbRel = ensureSharedStringsRel(wbRel); zip.file('xl/_rels/workbook.xml.rels', wbRel); }

      entry.resultBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      entry.status = 'done';
      doneCount++;
      showLog('Bulk — ✓ ' + entry.name + ' (' + rep.filled + ' filled, ' + rep.skipped + ' skipped)', 'ok');
    } catch (e) {
      entry.status = 'error';
      showLog('Bulk — ✗ ' + entry.name + ': ' + e.message, 'err');
      console.error('Bulk error for', entry.name, e);
    }

    setBulkProgress(Math.round(((i + 1) / bulkFiles.length) * 100));
    renderBulkList();
  }

  btn.disabled = false; btn.textContent = 'Transmute All Scrolls';
  if (doneCount > 0) {
    document.getElementById('btnBulkDlAll').style.display = 'block';
    showLog('Bulk — complete: ' + doneCount + '/' + bulkFiles.length + ' files processed successfully.', 'ok');
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}

function downloadBulkFile(id) {
  const entry = bulkFiles.find(f => f.id === id);
  if (!entry || !entry.resultBlob) return;
  const url = URL.createObjectURL(entry.resultBlob);
  const a = document.createElement('a');
  a.href = url; a.download = entry.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadAllBulk() {
  const done = bulkFiles.filter(f => f.status === 'done' && f.resultBlob);
  if (!done.length) { showLog('Bulk — no processed files to download.', 'err'); return; }
  const zip = new JSZip();
  for (const entry of done) {
    zip.file(entry.name, entry.resultBlob);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url; a.download = 'anmerkung_bulk_' + stamp + '.zip'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showLog('Bulk — ZIP downloaded with ' + done.length + ' file(s).', 'ok');
}

/* Re-check bulk ready state when forwarder changes */
const _origSelectFW = selectFW;
selectFW = function(btn) { _origSelectFW(btn); checkBulkReady(); };
