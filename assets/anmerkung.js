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
    for(let i=0;i<pts.length;i++){const p=pts[i];for(let j=i+1;j<pts.length;j++){const q=pts[j];const dx=p.x-q.x,dy=p.y-q.y;if(Math.abs(dx)<120&&Math.abs(dy)<120){const dSq=dx*dx+dy*dy;if(dSq<14400){const d=Math.sqrt(dSq);cx.strokeStyle=`rgba(${p.c},${(1-d/120)*.045})`;cx.lineWidth=.4;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(q.x,q.y);cx.stroke()}}}const mdx=p.x-mouse.x,mdy=p.y-mouse.y;if(Math.abs(mdx)<160&&Math.abs(mdy)<160){const mdSq=mdx*mdx+mdy*mdy;if(mdSq<25600){const md=Math.sqrt(mdSq);cx.strokeStyle=`rgba(${p.c},${(1-md/160)*.22})`;cx.lineWidth=.6;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(mouse.x,mouse.y);cx.stroke()}}}
    pts.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.a+=p.da*dt;if(p.a<.04||p.a>.48)p.da*=-1;if(p.x<-15)p.x=W+15;if(p.x>W+15)p.x=-15;if(p.y<-15)p.y=H+15;if(p.y>H+15)p.y=-15;const rdx=p.x-mouse.x,rdy=p.y-mouse.y;if(Math.abs(rdx)<100&&Math.abs(rdy)<100){const rdSq=rdx*rdx+rdy*rdy;if(rdSq<10000&&rdSq>0){const rd=Math.sqrt(rdSq);const f=(1-rd/100)*.4;p.vx+=(rdx/rd)*f*.035;p.vy+=(rdy/rd)*f*.035}}const spSq=p.vx*p.vx+p.vy*p.vy;if(spSq>.2025){const sp=Math.sqrt(spSq);p.vx*=.45/sp;p.vy*=.45/sp}const bx=.5*Math.sin(t*1.1+p.ph),by=.5*Math.cos(t*.88+p.ph*1.3);cx.beginPath();cx.arc(p.x+bx,p.y+by,p.r,0,Math.PI*2);cx.fillStyle=`rgba(${p.c},${p.a})`;cx.fill()});
    scheduleFrame();
  }
  window.addEventListener('resize',init);window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});window.addEventListener('mouseleave',()=>{mouse.x=-9999;mouse.y=-9999});
  init();
  if (window.Grimoire && window.Grimoire.reducedMotion) { frame(0); }
  else { scheduleFrame(); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) scheduleFrame(); }); }
})();

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
   STYLE TOGGLE — "Pro" professional vs "Mystic" grimoire look
   Independent of dark/light theme. Persists to localStorage.
══════════════════════════════════════════════════════════ */
const STYLE_KEY='anmerkung.style.v1';
function applyStyle(s){
  const pro=s==='pro';
  document.body.classList.toggle('theme-pro',pro);
  const btn=document.getElementById('btnStyle'),lbl=document.getElementById('styleLabel');
  if(btn){btn.setAttribute('aria-pressed',pro?'true':'false');btn.title=pro?'Switch back to mystic style':'Switch to professional style';}
  if(lbl)lbl.textContent=pro?'Pro':'Mystic';
}
function toggleStyle(){
  const cur=document.body.classList.contains('theme-pro')?'pro':'mystic';
  const next=cur==='pro'?'mystic':'pro';
  applyStyle(next);
  try{localStorage.setItem(STYLE_KEY,next);}catch(_){}
}
(function loadStyle(){try{const saved=localStorage.getItem(STYLE_KEY);if(saved==='pro'||saved==='mystic')applyStyle(saved);}catch(_){}})();

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
  terminzustellung:           'Terminzustellung',
  b2cLine:                    'hätte B2C-Line abrechnen dürfen',
  buendelMuessen:             'hätte gebündelt werden müssen',
  avisTelefonisch:            'hätte Avisgebühr telefonisch abrechnen dürfen',
  hebebuehne:                 'hätte Hebebühne abrechnen dürfen',
  differenzAvisOk:            'Differenz avis, ok?',
  differenzEnergiezuschlag:   'Differenz Energiezuschlag',
  dieselzuschlag:             'Dieselzuschlag ok?',
  returnOk:                   'Return, ok?',
  frachtDiff:                 'Frachtdifferenz',
};
/* Expose under shorter alias for compactness inside processors. */
const P=PHRASES;

/* ══════════════════════════════════════════════════════════
   PHRASE → KEY REVERSE INDEX (AI-friendly training output)
   Every phrase the rule engine emits should resolve to a stable
   identifier that maps 1-to-1 to a branch in process<Forwarder>.
   That way training-data consumers (humans OR LLMs) can read a
   row like  missing_phrase_keys: ["snkAvis", "kontierungQ"]
   and know exactly which PHRASES entries to fire / not-fire — no
   substring matching, no fuzzy alignment, no source dive.

   Three resolution layers (first hit wins):
     1. Exact match against PHRASES catalog (case-insensitive, trimmed)
     2. Exact match against PHRASE_LITERALS — phrases emitted directly
        as string literals from inside processors (not yet promoted
        to PHRASES). These get a synthetic key prefixed `lit_` so
        consumers can still find them in `rule_spec.phrase_literals`.
     3. Regex match against PHRASE_TEMPLATES — phrases that interpolate
        runtime values (PLZ/Ort, weight tier). The key here points to
        the template family, and a trimmed example is preserved in
        rule_spec.phrase_templates so an AI can see the variable parts.

   Anything that fails all three is returned as `?:<phrase>` so the
   consumer can spot truly unmapped emissions and add a key.
══════════════════════════════════════════════════════════ */
const PHRASES_REVERSE=(function(){
  const m=new Map();
  for(const[k,v]of Object.entries(PHRASES))m.set(String(v).toLowerCase().trim(),k);
  return m;
})();

/* Direct literals emitted by processors but NOT in PHRASES (yet).
   Keys are synthesized — prefer adding the entry to PHRASES proper if
   you find yourself reaching for one of these. Listed here as a
   fallback so AI consumers still get a stable identifier today. */
const PHRASE_LITERALS={
  'differenz hebebuehnen-zuschlag':'lit_differenzHebebuehnen',     /* Dachser SNK_DL=75 + tariff base */
  'pauschalfracht, ok?'           :'lit_pauschalfrachtOk',          /* Wackler |SNK|>=tariff flat-rate */
  'terminzustellung, ok?'         :'lit_terminzustellungOk',        /* Wackler |SNK|≈180 */
  'zone korrekt?'                 :'lit_zoneKorrekt',               /* Wackler NL-FIX zone corollary */
  'differenztreibstof'            :'lit_differenzTreibstofWackler', /* Wackler legacy fuel wording — superseded by PHRASES.differenzEnergiezuschlag; kept so older slot-A exports that used "DifferenzTreibstof" still resolve to a stable key */
  'differenzenergiezuschlag'      :'differenzEnergiezuschlag',      /* Wackler legacy no-space fuel wording — the canonical phrase is now "Differenz Energiezuschlag" (with a space, matching the auditor's ground truth); this maps the older glued spelling onto the SAME catalog key so historic exports stay mappable */
};

/* Phrases that interpolate runtime values. The key identifies the
   template family; the example shows the shape so an AI knows what
   varies. Order matters — first regex that matches wins. */
const PHRASE_TEMPLATES=[
  {key:'zwPrefix',         regex:/^differenz aufgrund abweichender zwischenempf/i,
   example:'Differenz aufgrund abweichender Zwischenempfänger 12345 Berlin',
   processor:'processDachser'},
  {key:'tpl_wacklerRechnet',regex:/^wackler rechnet frachtrate/i,
   example:'Wackler rechnet Frachtrate für 10000kg ab',
   processor:'processWackler'},
];

/* Resolve a single phrase string to a stable key. Returns null when
   nothing matches — callers that want a never-null result use the
   `?:<phrase>` sentinel via phraseKeysFor. */
function phraseToKey(phrase){
  if(phrase==null)return null;
  const norm=String(phrase).toLowerCase().trim();
  if(!norm)return null;
  if(PHRASES_REVERSE.has(norm))return PHRASES_REVERSE.get(norm);
  if(Object.prototype.hasOwnProperty.call(PHRASE_LITERALS,norm))return PHRASE_LITERALS[norm];
  for(const t of PHRASE_TEMPLATES)if(t.regex.test(norm))return t.key;
  return null;
}
function phraseKeysFor(arr){
  return(arr||[]).map(p=>phraseToKey(p)||('?:'+(p==null?'':String(p))));
}

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
      './assets/wackler-ratecard.js',
      './assets/wackler-national-ratecard.js',
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
/* Tier breakpoints are sourced from the standalone rate-card asset (assets/wackler-ratecard.js,
   generated from data/Wackler International Rate.xlsx) so the tier table and the EUR rate lookup
   share a single source of truth and the big rate matrix never has to live inside this engine.
   The literal below is an identical fallback for when the rate-card asset isn't loaded (e.g. a
   bare unit-test context), keeping the engine self-sufficient and deterministic. */
const WACKLER_RC=(typeof WACKLER_RATECARD!=='undefined'&&WACKLER_RATECARD)?WACKLER_RATECARD:null;
/* National (domestic German) rate card — standalone asset assets/wackler-national-ratecard.js,
   generated from data/Wackler National Rate.xlsx. It carries the EUR rates for the German zones
   DE1‑DE9 that the international card leaves blank, and is what enriches the "Wackler rechnet"
   note with the actual domestic rate Wackler billed against. Optional: null when not loaded
   (e.g. a bare unit-test context), in which case the note degrades to the plain tier wording. */
const WACKLER_NAT_RC=(typeof WACKLER_NATIONAL_RATECARD!=='undefined'&&WACKLER_NATIONAL_RATECARD)?WACKLER_NATIONAL_RATECARD:null;
const WACKLER_BP=(WACKLER_RC&&Array.isArray(WACKLER_RC.tiers)&&WACKLER_RC.tiers.length)
  ? WACKLER_RC.tiers.slice()
  : [50,100,150,200,250,300,350,400,450,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2200,2400,2600,2800,3000,3500,4000,4500,5000,5500,6000,6500,7000,7500,8000,8500,9000,9500,10000,999999];
function wacklerGetTier(kg){if(kg<=0)return 0;for(const b of WACKLER_BP)if(kg<=b)return b;return 999999;}
function wacklerGetTierIdx(kg){if(kg<=0)return -1;for(let i=0;i<WACKLER_BP.length;i++)if(kg<=WACKLER_BP[i])return i;return WACKLER_BP.length-1;}
/* Largest tier breakpoint at or below kg — the rate-card bracket a weight has already CLEARED
   (the floor, as opposed to wacklerGetTier's ceiling). Used by the volumetric "Wackler rechnet"
   note (rule 5) to report the lower tier Wackler billed against when VKG/VKG_DL are two
   measurements of one consignment. Returns 0 when kg is below the first step. */
function wacklerFloorTier(kg){let last=0;for(const b of WACKLER_BP){if(b<=kg)last=b;else break;}return last;}
/* Format a tier breakpoint for display: regular numbers as-is, the open ceiling as ">10000". */
function wacklerTierLabel(tierKg){return tierKg>=999999?'>10000':String(tierKg);}
/* Origin/destination country token for a row, normalised to its leading two letters
   ('DE','FR','PL','TR'…); '' when the column is absent or blank. */
function wacklerLand(ws,r,col){
  if(col==null||col<0)return'';
  return String(cellStr(ws,r,col)||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,2);
}
/* Classify a row from Abg.-Land / Empf.-Land into the lane that decides which rate card + zone its
   freight is published under. A German forwarder's DOMESTIC tariff applies when both ends are in
   Germany (the origin may be blank — a German destination dominates); a foreign end means an
   INTERNATIONAL lane, keyed by the NON-German country (the destination on an export, the origin on
   an import) and that side's PLZ. Returns {scope:'national'|'international',country,postal} or null
   when neither Land is known. Knowing the country here is what makes the numeric PLZ safe to read:
   a 'DE' classification guarantees a German postal code, so the old foreign-PLZ false positives
   (HR "10450"→DE8, SE "556 52"→DE5) can no longer happen — those rows now classify as
   international and never resolve a German zone. */
function wacklerLane(ws,r,cols){
  if(!cols)return null;
  const abg=wacklerLand(ws,r,cols.abg_land),empf=wacklerLand(ws,r,cols.empf_land);
  const plzOf=c=>(c!=null&&c>=0)?cellStr(ws,r,c):'';
  if(empf==='DE'&&(abg===''||abg==='DE'))return{scope:'national',country:'DE',postal:plzOf(cols.empf_plz)};
  if(empf&&empf!=='DE')return{scope:'international',country:empf,postal:plzOf(cols.empf_plz)};
  if(empf==='DE'&&abg&&abg!=='DE')return{scope:'international',country:abg,postal:plzOf(cols.abg_plz)};
  return null;
}
/* Resolve a row's destination to a German national rate zone (DE1..DE9), or null when it is not a
   resolvable domestic shipment. An explicit DEn token (Tarifzone) wins; otherwise we trust the
   Abg.-Land/Empf.-Land classification — only a genuinely domestic (DE→DE) lane resolves a zone
   from the numeric Empf.-PLZ. Because the country is known to be DE, that postal code is
   unambiguously German: this is the country-guarded successor to the bare-PLZ fallback that was
   removed for mis-tagging foreign rows (AI-bundle 2026-06-05 rows 68959963 HR & d97ce4ec SE),
   which now classify as international and never reach here. Used to enrich the note AND, via the
   rate probe, to re-tier "Wackler rechnet". */
function wacklerResolveNatZone(ws,r,cols){
  if(!WACKLER_NAT_RC||!cols)return null;
  if(cols.zone!=null&&cols.zone>=0){
    const z=WACKLER_NAT_RC.normalizeZone(cellStr(ws,r,cols.zone));
    if(z)return z;
  }
  const lane=wacklerLane(ws,r,cols);
  if(lane&&lane.scope==='national')return WACKLER_NAT_RC.resolveZone('DE',lane.postal);
  return null;
}
/* Compose the same-tier "Wackler rechnet Frachtrate für <tier>kg ab" note. On a DOMESTIC German
   shipment the note is now enriched with the actual national rate Wackler billed against, e.g.
   "Wackler rechnet Frachtrate für 150kg ab (DE2: 29,50 €)", sourced from the standalone national
   rate card (data/Wackler National Rate.xlsx). The auditor still gets the weight bracket; the
   EUR makes it instantly checkable against the rate card. Enrichment only appears when the zone
   resolves AND the national card has a published rate for that tier — international rows and
   rows without a usable destination keep the plain tier wording (the earlier international-card
   EUR enrichment that the auditor rejected stays gone). */
function wacklerRechnetNote(tierKg,ws,r,cols){
  let note='Wackler rechnet Frachtrate für '+wacklerTierLabel(tierKg)+'kg ab';
  if(WACKLER_NAT_RC){
    const zone=wacklerResolveNatZone(ws,r,cols);
    if(zone){
      const eur=WACKLER_NAT_RC.rate(tierKg,zone);
      if(eur>0)note+=' ('+zone+': '+WACKLER_NAT_RC.fmtEUR(eur)+')';
    }
  }
  return note;
}
/* ── International rate-card zone + actually-billed tier ──────────────────────────────────────
   The "Wackler rechnet Frachtrate für <tier>kg ab" note must name the tier Wackler ACTUALLY
   billed against — which is not always the tier the chargeable weight falls in. When the FR
   Differenz is exactly the rate-card gap between two neighbouring tiers, Wackler billed the
   *other* tier's rate (a half-tonne up or down), and the auditor reports that tier. Translating
   the FR delta back into a tier needs the destination's published rate, so we resolve the
   international rate-card zone and read WACKLER_RATECARD. */
/* EUR tolerance when matching an implied billed-rate back to a rate-card tier (covers cent
   rounding in the published cells). Tight on purpose: only a clean tier-step FR gap re-tiers the
   note; an arbitrary rounding residual leaves the weight tier untouched. */
const WACKLER_RATE_TOL=0.5;
/* Resolve a row to an INTERNATIONAL rate-card zone (AT1/CH2/FR3/TR/…). Primary path is the
   Abg.-Land/Empf.-Land classification: an international lane resolves via its non-German country
   code + that side's PLZ (Empf.-PLZ on an export, Abg.-PLZ on an import), which is exactly
   WACKLER_RATECARD.resolveZone's contract — a single-zone country resolves from the code alone,
   a multi-zone one (CH/FR/ES/PL…) is disambiguated by the postal code. Falls back to an explicit
   Tarifzone token when no Land columns are present. Returns null when the rate card isn't loaded
   or nothing resolves; a bare numeric PLZ is never trusted without a country (a foreign code can
   masquerade as a German prefix). */
function wacklerResolveIntlZone(ws,r,cols){
  if(!WACKLER_RC||typeof WACKLER_RC.resolveZone!=='function'||!cols)return null;
  const lane=wacklerLane(ws,r,cols);
  if(lane&&lane.scope==='international'){
    const z=WACKLER_RC.resolveZone(lane.country,lane.postal);
    if(z)return z;
  }
  if(cols.zone!=null&&cols.zone>=0){
    const raw=cellStr(ws,r,cols.zone);
    if(raw){
      const plz=(cols.empf_plz!=null&&cols.empf_plz>=0)?cellStr(ws,r,cols.empf_plz):'';
      const z=WACKLER_RC.resolveZone(raw,plz);
      if(z)return z;
    }
  }
  return null;
}
/* Bind a row to the rate card + zone its freight is published under, returned as a
   {rateAt(kg),tiers} probe so the billed-tier math is card-agnostic. The NATIONAL DE card is
   tried first (DE1‑DE9 — the international card leaves those cells blank) using the SAME
   explicit-zone-token guard wacklerResolveNatZone documents (a bare numeric PLZ is never trusted,
   so a foreign code can't masquerade as a German zone); then the international card
   (AT/CH/FR/TR/…). This is what lets the "Wackler rechnet" billed-tier re-tiering work for
   DOMESTIC German shipments too — not just international ones. Returns null when neither resolves
   or the rate cards aren't loaded. */
function wacklerRateProbe(ws,r,cols){
  const natZone=wacklerResolveNatZone(ws,r,cols);
  if(natZone&&WACKLER_NAT_RC)return{rateAt:kg=>WACKLER_NAT_RC.rate(kg,natZone),tiers:WACKLER_NAT_RC.tiers||WACKLER_BP};
  const intlZone=wacklerResolveIntlZone(ws,r,cols);
  if(intlZone&&WACKLER_RC)return{rateAt:kg=>WACKLER_RC.rate(kg,intlZone),tiers:WACKLER_BP};
  return null;
}
/* The rate-card tier whose published rate sits within WACKLER_RATE_TOL of targetRate, or null
   when none is close enough. `probe` (from wacklerRateProbe) carries the card-specific rate
   lookup AND tier list, so this resolves against the national and international cards alike. */
function wacklerTierByRate(probe,targetRate){
  if(!probe||!(targetRate>0))return null;
  let best=null,bestDiff=Infinity;
  for(const b of probe.tiers){
    const rt=probe.rateAt(b);
    if(rt>0){const d=Math.abs(rt-targetRate);if(d<bestDiff){bestDiff=d;best=b;}}
  }
  return(best!=null&&bestDiff<=WACKLER_RATE_TOL)?best:null;
}
/* The tier Wackler actually billed against on a "Wackler rechnet" row. The chargeable weight
   puts the shipment in `weightTierKg` (rate-card ceiling); the signed FR Differenz reveals when
   a neighbouring tier's rate was billed instead. FR Differenz is tariff − billed (a negative FR
   is an over-bill / credit), so the billed freight is systemRate(weightTier) − frVal, and the
   tier whose published rate matches that is the one to report. Falls back to weightTierKg when
   the rate card or destination zone is unavailable, or when the implied billed rate lands on no
   tier (a genuine rounding residual, not a clean tier step). Resolves AI-bundle 2026-06-05 row
   e40698ee: TR, VKG 6840 / VKG_DL 6862 weigh into the 7000 tier, but FR=−59.34 is exactly
   rate(7500,TR)−rate(7000,TR), so Wackler billed the 7500 tier. */
function wacklerBilledTier(weightTierKg,frVal,ws,r,cols){
  if(!(Math.abs(frVal)>T_WACKLER))return weightTierKg;
  const probe=wacklerRateProbe(ws,r,cols);
  if(!probe)return weightTierKg;
  const systemRate=probe.rateAt(weightTierKg);
  if(!(systemRate>0))return weightTierKg;
  const billed=wacklerTierByRate(probe,systemRate-frVal);
  return billed!=null?billed:weightTierKg;
}
/* Wackler SNK surcharge code book — sign-insensitive (reversibles like NL-FIX show as ±value).
   Tolerance handles real-world rounding (NL-FIX seen as 38.00 / 38.08). */
const WACKLER_SNK_CODES=[
  {abs:38,   tol:0.5,  label:'NL-FIX'},
  {abs:11.5, tol:0.1,  label:'hätte B2C-Line abrechnen dürfen'},
  {abs:22,   tol:0.5,  label:'2. Zustellung ok?'},
  {abs:25,   tol:0.5,  label:'Terminzustellung'},
  /* SNK≈170 is the same Terminzustellung surcharge billed at the higher (multi-stop / heavier)
     parcel rate — the auditor classifies it as plain "Terminzustellung", not as the ", ok?"
     query variant. Sits alongside an AVIS code on these rows (AI-bundle 2026-06-05 rows
     27104fc7 / 7d69dfc0: AVIS=7.5, SNK=170, FR domestic destinations → "Avis, ok? // Terminzustellung"). */
  {abs:170,  tol:0.5,  label:'Terminzustellung'},
  {abs:180,  tol:0.5,  label:'Terminzustellung, ok?'},
  /* SNK≈43 with no freight tariff backing is the auditor's "2.Zustellung ok?" finding — a second
     delivery attempt billed as a bare surcharge on an un-tariffed row (AI-bundle rows b7111e68 /
     fa68e7cb: TARIF blank, SNK=43, German destination). Note the spelling has no space after the
     dot ("2.Zustellung"), distinct from the freight-side "2. Zustellung ok?" code above. */
  {abs:43,   tol:0.5,  label:'2.Zustellung ok?'},
  /* SNK≈289 with no freight tariff backing is an "Umverfügung" (re-disposition / re-routing fee)
     billed as a bare surcharge on an un-tariffed row (AI-bundle row 0f1d3d96: TARIF blank,
     SNK=289, AT destination Pasching). */
  {abs:289,  tol:0.5,  label:'Umverfügung'}
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
function resolveWackler(ws,range){const fc=(h2,h3)=>findCol(ws,range,h2,h3);const fcAny=(...names)=>{for(const n of names){const c=fc('',n);if(c>=0)return c;}return -1;};return{target:fc('','Anmerkung'),stat:fc('','Stat_Freigabe'),tarif:fc('Total','Kosten lt. Tarif'),avis_diff:fc('AVIS','Differenz'),snk_diff:fc('SNK','Differenz'),fr:fc('FR','Differenz'),maut:fc('MT','Differenz'),tz:fc('TZ','Differenz'),referenz:fc('','ReferenzNr'),vkg:fc('','Volumen kg'),vkg_dl:fc('','Volumen kg DL'),empf_plz:fc('','Empf.-PLZ'),empf_ort:fc('','Empf.-Ort'),kostenstelle:fc('','KOSTENSTELLE'),sachkonto:fc('','SACHKONTO'),abg_land:fcAny('Abg.-Land','Absenderland','Versandland'),empf_land:fcAny('Empf.-Land','Empfängerland','Bestimmungsland','Zielland','Ländercode','Country','Land'),abg_plz:fcAny('Abg.-PLZ','Absender-PLZ','Versand-PLZ'),zone:fcAny('Tarifzone','Tarifgebiet','Zone')};}
/* SNK rounding-noise floor: sub-€5 SNK gaps on rows that already carry FR/MT/TZ/Gewichte
   evidence are the fuel-on-toll percentage trickling into SNK, not a real classification. */
const WACKLER_SNK_NOISE=5.0;
/* Pauschalfracht ratio: when SNK exceeds the booked tariff (|SNK| ≥ N × tariff) and there are
   no FR/MT/TZ deltas, the row is a flat-rate freight charge — system priced against tariff but
   the customer was billed a lump sum. Conservative cutoff (≥ 1.0 × tariff) matches the smallest
   training case (TARIF=54.95, SNK=80, ratio 1.45×) without overfiring on standard SNK Differenz
   residuals which run far below the booked tariff value. */
const WACKLER_PAUSCHAL_RATIO=1.0;
/* TZ additive threshold: TZ ≥ 2.0 fires DifferenzTreibstof alongside other classifications.
   Below 2.0 the TZ delta is fuel-on-toll math noise (typical FR/MT-percentage spill). */
const WACKLER_TZ_ADDITIVE=2.0;
/* Hebebühne (liftgate) credit signature: a large negative SNK ≈ -150 that matches no recognised
   SNK code is the auditor's "should have been allowed to bill the Hebebühne (liftgate) surcharge"
   finding — a specific classification, not a generic SNK gap. The window is deliberately narrow
   so it never poaches real SNK Differenz residuals. Resolves AI-bundle training rows 1 & 42. */
const WACKLER_HEBEBUEHNE_ABS=150;
const WACKLER_HEBEBUEHNE_TOL=2.0;
/* The engine is fully deterministic: every Anmerkung is recomputed from the
   row's inputs, regardless of any value already sitting in the target cell.
   There is no "preserve existing / protected phrase" short-circuit — the rules
   below are the single source of truth for a row's output. */
function processWackler(ws,r,cols){
  /* STAT gate: on stat≠10 only the Kontierung check runs; all other rules are skipped. */
  const statOk=(cols.stat<0)||(cellNum(ws,r,cols.stat)===10);
  if(!statOk){
    if(cols.kostenstelle>=0&&cols.sachkonto>=0){const kt=cellStr(ws,r,cols.kostenstelle).toUpperCase(),sk=cellStr(ws,r,cols.sachkonto).toUpperCase();if((kt===''||kt==='X')&&(sk===''||sk==='X'))return'Kontierung?';}
    return null;
  }
  /* 1. Fremdnummer doppelt — fires when the tariff baseline is missing AND there's a real
     cost signal on the row. Three TARIF signatures are accepted:
       - tarifRaw === '-'                                  (legacy duplicate-billing marker)
       - tarifNum === 0 with non-empty raw text            (legacy "0,00" / "0" placeholder)
       - tarifRaw === '' AND |FR|>T or |MT|>T or |TZ|>T    (training row 20 — empty tariff,
         FR/MT/TZ deltas are spurious comparisons against a zero baseline, so the row is
         a duplicate Fremdnummer billing). The cost-signal guard avoids firing on rows
         that are genuinely not yet rated (TARIF blank, every delta also blank).
     When this fires, all delta-derived rules (3–12) are suppressed since their inputs are
     comparing against a non-existent tariff. Kontierung (rule 13) still runs inline — when
     KOST/SACH are blank/X the row carries both classifications, matching training row 20's
     expected "Fremdnummer doppelt berechnet // Kontierung?". */
  if(cols.tarif>=0){
    const tarifRaw=cellStr(ws,r,cols.tarif),tarifNumEarly=cellNum(ws,r,cols.tarif);
    const _frEarly=cols.fr>=0?cellNum(ws,r,cols.fr):0;
    const _mtEarly=cols.maut>=0?cellNum(ws,r,cols.maut):0;
    const _tzEarly=cols.tz>=0?cellNum(ws,r,cols.tz):0;
    const dashOrZero=tarifRaw==='-'||(tarifNumEarly===0&&tarifRaw!=='');
    const emptyWithSignal=tarifRaw===''&&(Math.abs(_frEarly)>T_WACKLER||Math.abs(_mtEarly)>T_WACKLER||Math.abs(_tzEarly)>T_WACKLER);
    if(dashOrZero||emptyWithSignal){
      let out='Fremdnummer doppelt berechnet';
      if(cols.kostenstelle>=0&&cols.sachkonto>=0){
        const kt=cellStr(ws,r,cols.kostenstelle).toUpperCase(),sk=cellStr(ws,r,cols.sachkonto).toUpperCase();
        if((kt===''||kt==='X')&&(sk===''||sk==='X'))out=join(out,'Kontierung?');
      }
      return out;
    }
  }
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
  /* 1b. Lagergeld — warehouse storage fee. Signature: the booked tariff is BLANK (no freight
     tariff backing) and the ONLY cost signal on the row is an SNK charge (no FR/MT/TZ delta and
     no AVIS surcharge code) that does NOT match a recognised SNK code. A bare, code-less SNK gap
     on an un-tariffed row is a storage fee, not an SNK surcharge discrepancy, so it must NOT fall
     through to the generic "SNK Differenz" fallback (rule 10) — which is what these rows used to
     hit. The empty-tariff + FR/MT/TZ-signal case is already claimed by Fremdnummer above; this is
     the SNK-only remainder. The `!wacklerSnkCode(snkVal)` guard hands recognised bare-SNK codes
     (2.Zustellung ok? @43, Umverfügung @289, …) to the SNK code book in rule 4 instead — AI-bundle
     rows 0f1d3d96 (SNK=289 → Umverfügung) and b7111e68 / fa68e7cb (SNK=43 → 2.Zustellung ok?) were
     previously swallowed here as Lagergeld. Terminal: the expected wording is "Lagergeld" alone, so
     we early-return (still appending Kontierung? when KOST/SACH are blank/X, mirroring Fremdnummer). */
  if(cols.tarif>=0&&cellStr(ws,r,cols.tarif)===''&&snkHasVal&&!frHasVal&&!mtHasVal
     &&Math.abs(tzVal)<WACKLER_TZ_ADDITIVE&&!isWacklerAvisCode(avisVal)
     &&!wacklerSnkCode(snkVal)){
    let out=P.lagergeld;
    if(cols.kostenstelle>=0&&cols.sachkonto>=0){
      const kt=cellStr(ws,r,cols.kostenstelle).toUpperCase(),sk=cellStr(ws,r,cols.sachkonto).toUpperCase();
      if((kt===''||kt==='X')&&(sk===''||sk==='X'))out=join(out,'Kontierung?');
    }
    return out;
  }
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
  /* 4. SNK surcharge codes (NL-FIX / B2C / 2. Zustellung / Terminzustellung / Umverfügung). */
  let snkCodeLabel=null;
  if(cols.snk_diff>=0){
    snkCodeLabel=wacklerSnkCode(snkVal);
    if(snkCodeLabel)res=join(res,snkCodeLabel);
  }
  /* 5. Gewichte / Bundling cascade. Decision tree (both weights real + FR delta):
     ─ same rate tier + multi-ref bundle         → "hätte gebündelt werden müssen"
                                                   (consignments that should have ridden one
                                                    booking; bundling wins over the rate-card
                                                    wording — AI-bundle rows 6/27/28/58:
                                                    multi-ref, VKG==VKG_DL, large FR delta)
     ─ same rate tier, single ref                → "Wackler rechnet Frachtrate für <tier>kg ab"
                                                   (terminal: Wackler billed the tier rate, so the
                                                    FR/TZ deltas are systemic rounding for that
                                                    tier — see wacklerRechnetFired suppression below)
     ─ different rate tier                       → "Differenz aufgrund abweichender Gewichte"
                                                   (a genuine weight discrepancy)
     ─ no real weights + multi-ref + FR          → "hätte gebündelt werden müssen"   (legacy bundling)
     Note: a prior "cross-tier + far-apart → hätte gebündelt werden müssen" branch was removed —
     the auditor classifies far-apart multi-ref weight gaps as abweichende Gewichte, not bundling
     (training rows 7 & 61), and only flags bundling when the weights sit in one tier (or there is
     no weight signal at all). MT and TZ stay additive on every branch except same-tier "Wackler
     rechnet" (see rules 9 & 11). */
  let gewichteTriggered=false,wacklerRechnetFired=false,hebebuehneFired=false;
  if(cols.vkg>=0&&cols.vkg_dl>=0&&cols.fr>=0&&frHasVal){
    const vkg=cellNum(ws,r,cols.vkg),vkgDl=cellNum(ws,r,cols.vkg_dl);
    /* Both VKG and VKG_DL must carry a real weight. When they do, an FR delta is always a
       Wackler weight/rate-card finding — never a bare Frachtdifferenz. Blank weights
       (vkg/vkgDl === 0) fall through to the Frachtdifferenz fallback in rule 8. */
    if(vkg>0&&vkgDl>0){
      const tA=wacklerGetTier(vkg),tB=wacklerGetTier(vkgDl);
      /* The weight tier is the rate-card ceiling of the chargeable weight; a signed FR delta can
         reveal Wackler billed a neighbouring tier's rate, so report THAT tier in the "Wackler
         rechnet" note. Degrades to tA when the rate card / destination zone can't translate the
         FR gap into a clean tier step (AI-bundle row e40698ee: 7000 weight tier → billed 7500). */
      const reportTier=wacklerBilledTier(tA,frVal,ws,r,cols);
      if(tA===tB){
        /* A multi-reference row whose two weights share a rate tier is normally separate
           consignments that should have ridden one booking → "hätte gebündelt werden müssen".
           EXCEPTION — a non-integer (volumetric) chargeable weight, e.g. VKG 3058,5 vs VKG_DL
           3059: VKG/VKG_DL are then two measurements of ONE consignment, not distinct parcels.
           Wackler simply billed that tier's rate and the FR gap is systemic rounding, so the row
           reads as "Wackler rechnet Frachtrate für <tier>kg ab". The tier reported is the FLOOR
           bracket the weight has cleared (3058,5 → 3000), reflecting the lower rate Wackler billed
           against — AI-bundle training row 22 (3 refs, same tier, VKG 3058,5 / VKG_DL 3059). */
        const volumetric=(vkg%1!==0)||(vkgDl%1!==0);
        /* "Near-equal" weights: the two measurements differ by at most 1% of the larger (with a
           1 kg floor). At or below that, the references rode one shared tier rate — the gap is
           rounding, not two distinct parcels — so the row reads as "Wackler rechnet". Above it,
           a multi-ref row is separate consignments that should have been bundled. The 1% band
           keeps the genuine-bundle case intact (e.g. 120 vs 130 kg, ~8% apart → bundling) while
           catching AI-bundle row f04300d4 (6840 vs 6862 kg, 0.3% apart → one 7000 kg tier rate). */
        const sameWeight=Math.abs(vkg-vkgDl)<=Math.max(1,0.01*Math.max(vkg,vkgDl));
        if(isBundle&&!volumetric&&!sameWeight){
          /* Same-tier but materially UNEQUAL whole-kg weights on a multi-reference row: the auditor
             reads it as separate consignments that should have been combined onto a single booking,
             not a single-shipment rate-card rounding. Do NOT set wacklerRechnetFired, so MT and TZ
             stay additive below. */
          res=join(res,P.buendelMuessen);
        } else if(isBundle&&!volumetric&&sameWeight){
          /* Same-tier multi-reference row whose two weights are (near-)IDENTICAL whole-kg values:
             the references were billed against one shared tier rate, so the auditor classifies it
             as "Wackler rechnet Frachtrate für <tier>kg ab" rather than a "should have been bundled"
             finding. Crucially we do NOT set wacklerRechnetFired here — unlike the single-shipment
             rounding case below — because the auditor still itemises the Maut and (positive-FR)
             Energiezuschlag deltas on these rows (AI-bundle 2026-06-05 rows 08a0d985: 9000kg / 3 refs
             / AVIS=1 / MT+TZ kept, d97ce4ec: 10000kg / 2 refs / AVIS=6.5 / MT+TZ kept, and f04300d4:
             ~6850kg / 2 refs / MT kept, fuel absorbed by the FR credit). Tier = ceiling bracket the
             shared weight falls in. */
          res=join(res,wacklerRechnetNote(reportTier,ws,r,cols));
        } else if(isBundle&&volumetric){
          res=join(res,wacklerRechnetNote(wacklerFloorTier(Math.max(vkg,vkgDl)),ws,r,cols));
          wacklerRechnetFired=true;
        } else {
          res=join(res,wacklerRechnetNote(reportTier,ws,r,cols));
          wacklerRechnetFired=true;
        }
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
  /* 9. Mautdifferenz — the toll delta is always additive whenever it clears the threshold.
     (Previously suppressed on same-tier "Wackler rechnet" rows; the AI bundle shows the auditor
     keeps Mautdifferenz on those rows too — it appears on 23 of the 46 ground-truth rows,
     including every "Wackler rechnet …" case that carries an MT delta.) */
  if(cols.maut>=0&&hasErr(mtVal,T_WACKLER))res=join(res,'Mautdifferenz');
  /* 10. SNK Differenz fallback — unknown SNK code, above noise floor, not bundled. */
  if(cols.snk_diff>=0&&!snkCodeLabel&&snkHasVal
     &&Math.abs(snkVal)>=WACKLER_SNK_NOISE
     &&!res.toLowerCase().includes('gebündelt')){
    /* A large negative SNK ≈ -150 with no recognised SNK code is the Hebebühne (liftgate)
       credit signature: Wackler should have been allowed to bill the liftgate surcharge.
       Specific wording instead of the generic SNK Differenz. Resolves training rows 1 & 42. */
    if(snkVal<0&&Math.abs(Math.abs(snkVal)-WACKLER_HEBEBUEHNE_ABS)<=WACKLER_HEBEBUEHNE_TOL){
      res=join(res,P.hebebuehne);
      hebebuehneFired=true;
    }
    else
      res=join(res,'SNK Differenz');
  }
  /* 11. DifferenzEnergiezuschlag — the fuel/energy surcharge delta is additive above the 2.0
     threshold. It is emitted whenever it clears that threshold, EXCEPT:
       (a) same-tier "Wackler rechnet" rows, where the fuel gap is part of that tier's
           systemic rounding (wacklerRechnetFired), and
       (b) rows that carry a negative FR Differenz (an FR *credit*: frHasVal && frVal < 0).
           When Wackler over-billed the freight, the TZ gap is just the fuel percentage riding
           on that freight credit — it is absorbed into the freight/weight finding and the
           auditor does NOT list it as its own classification. (AI bundle 2026-06-05 rows
           f8ce2bae / 3aaa6bed / b47976d1 / 9de2427a / 8b5ae67c / f04300d4: every one carries a
           negative FR delta with a proportional TZ delta, and the ground truth has no fuel
           note.) A POSITIVE FR delta is different — the auditor itemises the fuel surcharge
           there (bundle rows 3ac4d429 / 89025060 / b8d93cb3), so only the credit case is
           suppressed.
     (A blanket FR&MT suppression was tried earlier and removed because the auditor keeps the
     fuel note when FR/MT are present on undercharge rows; the credit-only gate below is the
     correct, sign-aware refinement.)
     Wording: "DifferenzEnergiezuschlag" is the engine's canonical fuel wording; the legacy
     "DifferenzTreibstof" survives only as a literal so older exports still resolve (see
     PHRASE_LITERALS). */
  const frIsCredit=frHasVal&&frVal<0;
  /* On a Hebebühne (liftgate) credit row the auditor QUERIES the diesel surcharge
     ("Dieselzuschlag ok?") rather than flatly flagging a generic "Differenz Energiezuschlag" —
     AI-bundle 2026-06-05 row ce9f73d9 (SNK≈-150 Hebebühne credit + TZ=-19.5, no FR). The fuel
     gate itself is unchanged; only the wording switches when the Hebebühne branch fired. */
  if(cols.tz>=0&&Math.abs(tzVal)>=WACKLER_TZ_ADDITIVE&&!wacklerRechnetFired&&!frIsCredit)
    res=join(res,hebebuehneFired?P.dieselzuschlag:P.differenzEnergiezuschlag);
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
  /* 14. Pure fuel fallback — row had nothing but a fuel/energy delta above the noise floor. */
  if(res===''&&cols.tz>=0&&hasErr(tzVal,T_WACKLER))res=P.differenzEnergiezuschlag;
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
/* Normalise a single phrase for comparison the way the rule engine itself
   dedupes. `join()` folds case (`a.toLowerCase().includes(...)`), and stray
   double-spaces / tabs routinely creep into hand-corrected ground-truth
   cells. Folding both out means the phrase diff and the row labels reflect a
   REAL rule disagreement instead of cosmetic formatting noise — historically
   the single biggest source of false `wrong` rows in the exported training
   data fed to an AI. */
function normPhrase(p){return String(p==null?'':p).toLowerCase().replace(/\s+/g,' ').trim();}
/* Order-insensitive set equality of two phrase lists under normPhrase.
   The Anmerkung column is a list of independent rule outputs, so the order
   they were emitted in does not change correctness. */
function samePhraseSet(a,b){
  const A=new Set((a||[]).map(normPhrase)),B=new Set((b||[]).map(normPhrase));
  if(A.size!==B.size)return false;
  for(const x of A)if(!B.has(x))return false;
  return true;
}
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
  let total=0,filled=0,skipped=0,empty=0,unreachable=0;
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
        /* null === out of scope (Stat_Freigabe ≠ 10). No protected/preserved
           case anymore — the engine always recomputes in-scope rows. */
        skipped++;
        previewRows.push({sheet:name,row:excelRow,status:'skipped',value:'',reason:''});
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
  /* previewRows already has status flags set inline above (filled/empty/skipped). */
  return{total,filled,skipped,empty,unreachable,allResults,trigCounts,previewRows};
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
    showLog(`Dry-run — ${rep.filled} would be filled, ${rep.skipped} skipped, ${rep.empty} empty.`,'ok');
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
    showLog(`Ritual complete — ${rep.filled} rows transmuted, ${rep.skipped} skipped (Stat_Freigabe ≠ 10)${wantReason?' · reason column written':''}.`,'ok');
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
    {name:'Cross-tier weights',values:{stat:10,fr:5,vkg:120,vkg_dl:400,tarif:'100,00',kostenstelle:'1',sachkonto:'2'}},
    {name:'AVIS 7.5',values:{stat:10,avis_diff:7.5,tarif:'60,00'}},
    {name:'Riedlingen return',values:{stat:10,fr:10,empf_plz:'88499',empf_ort:'Riedlingen',tarif:'70,00'}},
    {name:'NL-FIX SNK 38',values:{stat:10,snk_diff:38,tarif:'80,00'}},
    {name:'TZ-only Treibstof',values:{stat:10,tarif:'40,04',tz:'-1.32',vkg:214,vkg_dl:214,kostenstelle:'211FO998',sachkonto:'612100'}},
    {name:'Fremdnummer empty tarif',values:{stat:10,tarif:'',fr:29.5,maut:2.6,tz:2.51,vkg:120,vkg_dl:120}},
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
    body='<div class="to-null">null — row would be skipped (Stat_Freigabe ≠ 10).</div>';
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

/* Bulk Diff state — two SETS of workbooks (predicted A-set + expected
   B-set) that get auto-paired by filename and compared pair-by-pair,
   all rows feeding the SAME diffState.results so the chips / filters /
   table / exports below operate on the combined, wider corpus. */
const bulkDiffFiles={a:[],b:[]};
let bulkDiffIdCounter=0;

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
  diffRenderLimit=DIFF_PAGE;_diffFilterSig='';
  const setCt=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  ['tcAll','tcWrong','tcMissed','tcOverfired','tcDrift','tcCorrect'].forEach(id=>setCt(id,'0'));
  ['ctDiffCsv','ctTrainCsv','ctTrainJsonl'].forEach(id=>setCt(id,''));
  document.querySelectorAll('#trainChips .train-chip').forEach(b=>b.classList.toggle('active',b.dataset.label==='all'));
  const fwSel=document.getElementById('diffFwFilter');if(fwSel)fwSel.innerHTML='<option value="all">all</option>';
  const shSel=document.getElementById('diffSheetFilter');if(shSel)shSel.innerHTML='<option value="all">all</option>';
  const q=document.getElementById('diffSearch');if(q)q.value='';
  /* Also clear any bulk-diff file sets so a global Clear truly resets. */
  if(typeof _resetBulkDiffInputs==='function')_resetBulkDiffInputs();
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
   the sheet. Tie-break: the user-selected forwarder wins, otherwise
   dachser → kn → dhl → wackler. Falls back to the currently-selected
   forwarder, then 'unknown'.

   Why the explicit-selection bias: K+N and Wackler share a lot of
   header names (FR/MT/TZ Differenz, Volumen kg, ReferenzNr, Stat_Freigabe,
   Total/Kosten lt. Tarif), so on a Wackler sheet whose AVIS/SNK or
   KOSTENSTELLE/SACHKONTO headers don't quite match Wackler's resolver
   the K+N score can edge ahead and silently override the user's
   click — tracked by the "diff mode shows wrong forwarder" report. */
function detectForwarderForSheet(ws,range){
  const order=['dachser','kn','dhl','wackler'];
  /* Honor the user's explicit forwarder pick when its resolver finds
     the Anmerkung target column on this sheet. Auto-detect still kicks
     in when the selected forwarder simply doesn't fit the sheet, so
     mixed-forwarder workbooks keep working. */
  if(selectedFW){
    const fn=_resolverFor(selectedFW);
    if(fn){
      let cols;try{cols=fn(ws,range);}catch(_){cols=null;}
      if(cols&&cols.target>=0)return selectedFW;
    }
  }
  let best=null,bestScore=-1;
  for(const fw of order){
    const fn=_resolverFor(fw);if(!fn)continue;
    let cols;try{cols=fn(ws,range);}catch(_){continue;}
    if(cols.target<0)continue;
    let score=0;for(const k of Object.keys(cols))if(cols[k]>=0)score++;
    /* Strict > keeps the order[] tie-break; if the selected forwarder
       ties, the early-return above already handled it. */
    if(score>bestScore){bestScore=score;best=fw;}
  }
  return best||selectedFW||'unknown';
}
/* Top-level label for a row. The Anmerkung column is an ORDER-INDEPENDENT,
   case-insensitively-deduped list of '//'-joined phrases (see join /
   normPhrase), so two cells holding the same phrase set that differ only by
   order, case, or whitespace are NOT a rule disagreement. Comparing phrase
   SETS instead of raw strings keeps those cosmetic-only rows out of the
   `wrong` / `missed` / `overfired` buckets — so the diff tiles and, crucially,
   the exported training set surface genuine rule errors only. */
function classifyDiff(vA,vB){
  const A=splitTriggers(vA||''), B=splitTriggers(vB||'');
  if(samePhraseSet(A,B))return 'correct';
  const aEmpty=A.length===0, bEmpty=B.length===0;
  if(aEmpty&&!bEmpty)return 'missed';
  if(!aEmpty&&bEmpty)return 'overfired';
  return 'wrong';
}

/* ──────────────────────────────────────────────────────────
   PRECISION HELPERS FOR TRAINING-DATA OUTPUT
   The Anmerkung column is a list of independent rule outputs
   joined by ' // '. Comparing the whole strings gives us
   wrong / missed / overfired / correct — useful but coarse.
   These helpers decompose each row into PHRASE-LEVEL signal
   so a row labeled "wrong" can still tell us exactly which
   phrase the engine missed and which it over-fired.

   Example:
     A = "Portalavisierung, ok?"
     B = "Portalavisierung, ok? // Differenz treibstoff"
       → missing_phrases = ["Differenz treibstoff"]
       → extra_phrases   = []
       → common_phrases  = ["Portalavisierung, ok?"]
       → phrase_jaccard  = 0.5
       → granular_label  = "phrase_subset"   (A ⊂ B  → MISSED a phrase)

   Phrase comparison is case- and whitespace-insensitive (matching the
   engine's own dedup) but the output preserves the original casing from
   whichever side it came.
────────────────────────────────────────────────────────── */
function computePhraseDiff(beforeRaw,afterRaw){
  const A=splitTriggers(beforeRaw||''), B=splitTriggers(afterRaw||'');
  const norm=normPhrase;
  const Bset=new Set(B.map(norm)), Aset=new Set(A.map(norm));
  /* Dedupe each bucket on the normalised form so a phrase that appears
     more than once on one side can't inflate the counts (or push the
     Jaccard score above 1). Original casing is preserved from whichever
     side the phrase came from. */
  const pick=(list,test)=>{
    const seen=new Set(),out=[];
    for(const p of list){const n=norm(p);if(test(n)&&!seen.has(n)){seen.add(n);out.push(p);}}
    return out;
  };
  const common =pick(A,n=>Bset.has(n));
  const missing=pick(B,n=>!Aset.has(n));
  const extra  =pick(A,n=>!Bset.has(n));
  const union=new Set([...Aset,...Bset]);
  const jaccard=union.size===0?1:(common.length/union.size);
  return{
    predicted_phrases:A,
    expected_phrases:B,
    common_phrases:common,
    missing_phrases:missing,
    extra_phrases:extra,
    phrase_jaccard:Math.round(jaccard*10000)/10000,
  };
}

/* Decompose a raw Anmerkung cell into per-phrase render parts for the
   diff table. `changedList` is the row's extra_phrases (for the A cell)
   or missing_phrases (for the B cell); phrases whose normalised form
   appears there are flagged `changed`, so the table can highlight ONLY
   the phrases that actually differ instead of striking/recoloring the
   whole cell — on multi-phrase rows the one disagreeing phrase is
   visible at a glance without opening the detail drawer. */
function phraseCellParts(raw,changedList){
  const changed=new Set((changedList||[]).map(normPhrase));
  return splitTriggers(raw||'').map(p=>({text:p,changed:changed.has(normPhrase(p))}));
}

/* Granular sub-label refines `wrong` along set-relation lines.
   - exact_match   : strings identical (incl. both empty → empty_match)
   - case_only     : differ only by case
   - whitespace    : differ only by whitespace/separator formatting
   - reordered     : same phrase set, different order (a match, not an error)
   - phrase_subset : every A-phrase appears in B, B has more (engine UNDER-fired)
   - phrase_superset: every B-phrase appears in A, A has more (engine OVER-fired)
   - phrase_overlap: both sides have unique phrases AND share at least one
   - phrase_disjoint: no shared phrases
   - missed_full   : A empty, B non-empty (lifted from top-level label)
   - overfired_full: A non-empty, B empty (lifted from top-level label) */
function granularLabel(beforeRaw,afterRaw,pd){
  const a=(beforeRaw||'').trim(), b=(afterRaw||'').trim();
  if(a===b)return a===''?'empty_match':'exact_match';
  if(a===''&&b!=='')return 'missed_full';
  if(a!==''&&b==='')return 'overfired_full';
  if(a.toLowerCase()===b.toLowerCase())return 'case_only';
  if(a.replace(/\s+/g,'')===b.replace(/\s+/g,''))return 'whitespace';
  const m=pd.missing_phrases.length, x=pd.extra_phrases.length, c=pd.common_phrases.length;
  /* No missing AND no extra phrases ⇒ identical phrase sets that the flat
     string checks above didn't catch — i.e. emitted in a different order
     (or with per-phrase case/whitespace noise). This is a match. */
  if(m===0&&x===0)return 'reordered';
  if(c===0)return 'phrase_disjoint';
  if(m>0&&x===0)return 'phrase_subset';
  if(m===0&&x>0)return 'phrase_superset';
  return 'phrase_overlap';
}

/* Stable short hash of (forwarder | sheet | row | sorted-inputs).
   Same row across multiple Train & Compare runs gets the same
   row_uid, so training CSVs from successive iterations can be
   joined / deduped / diffed across versions of the rule engine.
   FNV-1a 32-bit, hex-encoded — collision risk negligible at
   workbook scale.

   `sourceTag` (optional) namespaces the hash by file pair. Single-pair
   Diff Mode passes nothing, so its uids are unchanged (backward
   compatible). Bulk Diff passes the pairing key so two rows that share
   forwarder/sheet/row/inputs across DIFFERENT source files stay
   distinct instead of being deduped into one — the whole point of
   aggregating many pairs into one wider corpus. */
function rowUid(forwarder,sheet,row,inputs,sourceTag){
  const seedParts=[forwarder||'',sheet||'',String(row||'')];
  if(sourceTag)seedParts.push('@'+sourceTag);
  const keys=Object.keys(inputs||{}).sort();
  for(const k of keys)seedParts.push(k+'='+(inputs[k]==null?'':inputs[k]));
  const seed=seedParts.join('|');
  let h=2166136261>>>0;
  for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return ('00000000'+h.toString(16)).slice(-8);
}

/* Canonical input-key order per forwarder. Stabilises CSV column
   layout so successive Train & Compare runs produce diff-friendly
   files (same columns in the same positions, regardless of which
   row happened to fill which key first). Keys not in the canonical
   list (rare — only happens if collectInputsForRow grows a new key
   without this list being updated) are appended in first-seen order. */
const CANONICAL_INPUT_ORDER={
  dachser:['stat','tarif','fr_diff','vkg','vkg_dl',
           'snk_dl','snk_diff','snk_tarif',
           'zz_diff','sam_diff','dgr_diff',
           'exp_diff','exp_dl','maut_diff','sbfu_diff','tz_diff',
           'lg_diff','av_diff',
           'referenz3','empf_plz','empf_ort','anz_sdg','serv_art','sachkonto'],
  kn:['stat','tarif','fr_diff','exp_diff','mt_diff','tz_diff',
      'snk_dl','snk_diff',
      'referenz','recip','vkg','vkg_dl',
      'kostenstelle','sachkonto'],
  dhl:['stat','tarif','fr_diff','pal_diff','ow_diff',
       'yo_diff','yl_diff','nd_diff','sf_diff',
       'snk_diff','ac_diff','mt_diff','nx_diff','os_diff','tz_diff',
       'kostenstelle','sachkonto'],
  wackler:['stat','tarif','existing_anmerkung',
           'avis_diff','snk_diff','fr_diff','mt_diff','tz_diff',
           'referenz','vkg','vkg_dl','empf_plz','empf_ort',
           'kostenstelle','sachkonto'],
};

/* Build the ordered key list for a CSV: union of (canonical for each
   forwarder seen) ∪ (any keys observed but not canonical). Keeps
   per-forwarder columns clustered + deterministic. */
function orderedInputKeys(rows){
  const observed=new Set();
  const fwSeen=new Set();
  for(const r of rows){
    if(r.fw)fwSeen.add(r.fw);
    for(const k of Object.keys(r.inputs||{}))observed.add(k);
  }
  const ordered=[];
  const add=k=>{if(observed.has(k)&&!ordered.includes(k))ordered.push(k);};
  /* Emit canonical order for each forwarder we actually saw, in a
     stable forwarder order — dachser → kn → dhl → wackler. */
  ['dachser','kn','dhl','wackler'].forEach(fw=>{
    if(!fwSeen.has(fw))return;
    (CANONICAL_INPUT_ORDER[fw]||[]).forEach(add);
  });
  /* Any leftover observed keys (unknown forwarder / new key not yet
     in CANONICAL_INPUT_ORDER) — append in first-seen order. */
  for(const r of rows){
    for(const k of Object.keys(r.inputs||{}))add(k);
  }
  return ordered;
}

/* Walk ONE (A, B) workbook pair and produce the enriched row set +
   per-pair counters. Extracted from runDiff so that BOTH the
   single-pair flow and the bulk many-pairs flow share one code path —
   they only differ in how many pairs they feed through here and how the
   results are merged (see finalizeDiff).

   `source` is null for single-pair Diff Mode, or {tag,label} for bulk:
     • tag   → namespaces row_uid so identical rows from different
               source files stay distinct in the aggregated corpus.
     • label → shown in the table's Sheet cell + exported as source_file
               so every training row knows which file pair it came from. */
function diffWorkbooks(wbA,nameA,wbB,nameB,source){
  const rows=[];
  let total=0,wrong=0,missed=0,overfired=0,correct=0,drift=0;
  const fwSet=new Set(),sheetSet=new Set();
  const srcLabel=source?source.label:'';
  const srcTag=source?source.tag:'';
  const sheetsA=wbA.SheetNames,sheetsB=wbB.SheetNames;
  const allSheets=[...new Set([...sheetsA,...sheetsB])];

  for(const name of allSheets){
    const wsA=wbA.Sheets[name],wsB=wbB.Sheets[name];
    if(!wsA||!wsB){
      rows.push({sheet:name,row:'—',label:'sheet',change:'sheet',fw:'-',before:wsA?'(present)':'(missing in A)',after:wsB?'(present)':'(missing in B)',engineNow:'',engineMatchesA:true,reason:'',inputs:{},hasDrift:false,source:srcLabel});
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
      rows.push({sheet:name,row:'—',label:'sheet',change:'sheet',fw,before:cA<0?'(no Anmerkung col)':'(ok)',after:cB<0?'(no Anmerkung col)':'(ok)',engineNow:'',engineMatchesA:true,reason:'',inputs:{},hasDrift:false,source:srcLabel});
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
         have a resolver AND the row isn't a null-sheet error entry.
         `engineMatchesB` / `enginePd` stay null until the engine actually
         runs, so consumers can tell "engine not evaluated" (null) apart
         from "engine ran and matched/mismatched truth" (true/false). */
      let engineNow='',engineMatchesA=true,engineMatchesB=null,enginePd=null,reason='',inputs={};
      if(processor&&colsA){
        try{
          const p=processor(wsA,r,colsA);
          engineNow=(p==null?'':String(p));
          /* Engine-drift is a PHRASE-SET comparison, not a raw-string one,
             matching the latest engine rule (v1.11.0): the Anmerkung column is
             an order-independent, case/whitespace-insensitively-deduped list of
             ' // '-joined phrases (see join / normPhrase / classifyDiff). So the
             engine has only genuinely "drifted" from slot A when it emits a
             DIFFERENT phrase set — reordering, recasing, or respacing the same
             phrases is not drift. Using samePhraseSet here keeps the drift
             overlay, the drift chip, and the engine_matches_a export column
             consistent with how classifyDiff scores wrong/missed/overfired. */
          engineMatchesA=samePhraseSet(splitTriggers(engineNow),splitTriggers(vA||''));
          if(!engineMatchesA)drift++;
          /* Engine-vs-TRUTH (#26) — the precise training target. The rows
             being trained run the CURRENT engine, so what an AI (or human)
             must act on when fixing process<Forwarder> is how engineNow
             compares to GROUND TRUTH B, not how the (possibly stale, or
             foreign-tool) slot-A output compares to B. Same phrase-set
             semantics as classifyDiff so the engine_label below scores
             wrong/missed/overfired/correct identically to the A-vs-B label,
             just with engineNow on the predicted side. */
          engineMatchesB=samePhraseSet(splitTriggers(engineNow),splitTriggers(vB||''));
          enginePd=computePhraseDiff(engineNow,vB);
          try{reason=buildReason(fw,wsA,r,colsA)||'';}catch(_){reason='';}
          inputs=collectInputsForRow(fw,wsA,r,colsA);
        }catch(e){engineNow='';reason='engine error: '+(e.message||e);}
      }

      /* Only keep mismatches in the row set by default; 'correct' rows
         are kept too so the chip filter can reveal them when the user
         ticks "Include matching rows". They're hidden in the default
         table view via filterDiffRows(). Phrase-level diff + granular
         sub-label + stable row_uid are attached now so every consumer
         (table render, detail drawer, diff CSV, training-set CSV/JSONL)
         reads the same enriched record — no second pass. */
      const phraseDiff=computePhraseDiff(vA,vB);
      const granular=granularLabel(vA,vB,phraseDiff);
      /* AI-friendly enrichment (#21): every phrase array becomes a
         parallel array of stable PHRASES keys, the engine's current
         output gets the same treatment, and we stamp the active
         threshold + processor name so a downstream consumer can map
         a row to the exact source-code branch without re-reading
         anmerkung.js. Anything that doesn't resolve to a known key
         comes through as `?:<raw phrase>` so unmapped emissions are
         immediately visible. */
      const enginePhrases=splitTriggers(engineNow||'');
      const processorName=(fw&&fw!=='unknown'&&fw!=='-')
        ?('process'+fw[0].toUpperCase()+fw.slice(1))
        :'';
      const applicableThreshold=(TH&&TH[fw]!=null)?TH[fw]:null;
      /* Engine-vs-truth (#26) derived signal. Only populated when the
         engine actually ran (enginePd!=null); otherwise the row carries
         empty/null so a consumer can skip it the same way it skips an
         empty engineNow. `engine_missing_phrases` = phrases ground truth
         wants that the CURRENT engine fails to emit (→ a branch to add /
         loosen); `engine_extra_phrases` = phrases the CURRENT engine emits
         that truth rejects (→ a branch to guard / tighten). */
      const engineLabel   =enginePd?classifyDiff(engineNow,vB):'';
      const engineGranular=enginePd?granularLabel(engineNow,vB,enginePd):'';
      const engineMissing =enginePd?enginePd.missing_phrases:[];
      const engineExtra   =enginePd?enginePd.extra_phrases:[];
      const rowObj={
        sheet:name,row:r+1,label,
        change:label==='missed'?'added':(label==='overfired'?'removed':(label==='wrong'?'changed':'correct')),
        fw,before:vA,after:vB,
        engineNow,engineMatchesA,hasDrift:!engineMatchesA,
        engineMatchesB,
        reason,inputs,
        predicted_phrases:phraseDiff.predicted_phrases,
        expected_phrases :phraseDiff.expected_phrases,
        common_phrases   :phraseDiff.common_phrases,
        missing_phrases  :phraseDiff.missing_phrases,
        extra_phrases    :phraseDiff.extra_phrases,
        phrase_jaccard   :phraseDiff.phrase_jaccard,
        granular,
        /* === Phrase-key reverse-lookup payload (AI-friendly) === */
        predicted_phrase_keys:phraseKeysFor(phraseDiff.predicted_phrases),
        expected_phrase_keys :phraseKeysFor(phraseDiff.expected_phrases),
        common_phrase_keys   :phraseKeysFor(phraseDiff.common_phrases),
        missing_phrase_keys  :phraseKeysFor(phraseDiff.missing_phrases),
        extra_phrase_keys    :phraseKeysFor(phraseDiff.extra_phrases),
        engine_phrases       :enginePhrases,
        engine_phrase_keys   :phraseKeysFor(enginePhrases),
        /* === Engine-vs-truth payload (#26) — the current engine's gap
           against ground truth, the precise target for rule fixes. === */
        engine_label              :engineLabel,
        engine_granular           :engineGranular,
        engine_vs_expected_jaccard:enginePd?enginePd.phrase_jaccard:null,
        engine_missing_phrases    :engineMissing,
        engine_extra_phrases      :engineExtra,
        engine_missing_phrase_keys:phraseKeysFor(engineMissing),
        engine_extra_phrase_keys  :phraseKeysFor(engineExtra),
        /* === Source-code anchors === */
        processor            :processorName,
        applicable_threshold :applicableThreshold,
        /* === Provenance (which file pair this row came from) === */
        source               :srcLabel,
      };
      rowObj.row_uid=rowUid(fw,name,r+1,inputs,srcTag);
      rows.push(rowObj);
    }
  }
  return{rows,fwSet,sheetSet,counters:{total,wrong,missed,overfired,correct,drift}};
}

/* Merge one-or-more per-pair results (from diffWorkbooks) into a single
   diffState.results bundle and render. Single-pair Diff Mode feeds one
   part; Bulk Diff feeds many. `metaText` is shown in the meta line;
   `multiSource` toggles the per-row source label in the table. */
function finalizeDiff(parts,metaText,multiSource){
  const rows=[];const fwSet=new Set(),sheetSet=new Set();
  let total=0,wrong=0,missed=0,overfired=0,correct=0,drift=0;
  for(const p of parts){
    for(const r of p.rows)rows.push(r);
    p.fwSet.forEach(f=>fwSet.add(f));
    p.sheetSet.forEach(s=>sheetSet.add(s));
    total+=p.counters.total;wrong+=p.counters.wrong;missed+=p.counters.missed;
    overfired+=p.counters.overfired;correct+=p.counters.correct;drift+=p.counters.drift;
  }
  /* Keep classic tile semantics: "added" = missed (B filled, A empty),
     "removed" = overfired (A filled, B empty), "changed" = wrong. */
  const added=missed,removed=overfired,changed=wrong;
  diffState.results={rows,total,added,removed,changed,wrong,missed,overfired,correct,drift,
    forwarders:[...fwSet].sort(),sheets:[...sheetSet].sort(),
    meta:metaText||'',multiSource:!!multiSource};
  renderDiff();
}

/* Single-pair Diff Mode entry point (unchanged behavior). */
function runDiff(){
  if(!diffState.a||!diffState.b){showLog('Diff — load both files first.','err');return;}
  const part=diffWorkbooks(diffState.a.wb,diffState.a.name,diffState.b.wb,diffState.b.name,null);
  finalizeDiff([part],`A: ${diffState.a.name}  \u2194  B: ${diffState.b.name}`,false);
}

/* ══════════════════════════════════════════════════════════
   BULK DIFF — compare many (predicted, expected) pairs at once
   for a far wider training corpus than a single file pair. Drop
   a set of predicted workbooks (A) + expected workbooks (B);
   they're auto-paired by filename, every pair runs through
   diffWorkbooks, and all rows merge into one diffState.results.
══════════════════════════════════════════════════════════ */

/* Normalise a filename to a pairing key: drop the extension + any
   role words (predicted/expected/truth/output/…) + a trailing a/b
   marker, then collapse separators. So "Dachser_Jan_predicted.xlsx"
   and "Dachser-Jan-expected.xlsx" both key to "dachser jan" and pair
   up. Falls back to the bare basename if stripping leaves nothing. */
function bulkDiffKey(name){
  const base=String(name||'').toLowerCase().replace(/\.[^.]+$/,'');
  const roleWords=new Set(['predicted','prediction','expected','truth','groundtruth','ground','output','out','corrected','correct','actual','manual','tool','baseline','result','results']);
  let toks=base.split(/[\s_\-.()]+/).filter(Boolean).filter(t=>!roleWords.has(t));
  if(toks.length>1&&(toks[toks.length-1]==='a'||toks[toks.length-1]==='b'))toks.pop();
  return toks.join(' ').trim()||base;
}

/* Pair the two sets by key. 1:1 keys become clean pairs; keys with
   multiple files on a side are zipped by sorted name order (flagged
   `ambiguous` so the UI can warn). Leftovers surface as unmatched. */
function computeBulkDiffPairs(){
  const aByKey=new Map(),bByKey=new Map();
  const group=(arr,map)=>arr.forEach(f=>{const k=bulkDiffKey(f.name);if(!map.has(k))map.set(k,[]);map.get(k).push(f);});
  group(bulkDiffFiles.a,aByKey);group(bulkDiffFiles.b,bByKey);
  const pairs=[],unmatchedA=[],unmatchedB=[];
  const keys=[...new Set([...aByKey.keys(),...bByKey.keys()])].sort();
  for(const k of keys){
    const as=(aByKey.get(k)||[]).slice().sort((x,y)=>x.name.localeCompare(y.name));
    const bs=(bByKey.get(k)||[]).slice().sort((x,y)=>x.name.localeCompare(y.name));
    const n=Math.min(as.length,bs.length);
    const ambiguous=as.length>1||bs.length>1;
    for(let i=0;i<n;i++)pairs.push({key:k,a:as[i],b:bs[i],ambiguous});
    for(let i=n;i<as.length;i++)unmatchedA.push(as[i]);
    for(let i=n;i<bs.length;i++)unmatchedB.push(bs[i]);
  }
  return{pairs,unmatchedA,unmatchedB};
}

function onBulkDiffDrag(e,slot,over){e.preventDefault();const el=document.getElementById('diffBulkSlot'+slot.toUpperCase());if(el)el.classList.toggle('drag',over);}
function onBulkDiffDrop(e,slot){e.preventDefault();onBulkDiffDrag(e,slot,false);if(e.dataTransfer.files&&e.dataTransfer.files.length)addBulkDiffFiles(e.dataTransfer.files,slot);}
function onBulkDiffFile(e,slot){if(e.target.files&&e.target.files.length)addBulkDiffFiles(e.target.files,slot);e.target.value='';}

function addBulkDiffFiles(fileList,slot){
  let added=0;
  for(const file of fileList){
    if(!file.name.toLowerCase().endsWith('.xlsx')){showLog('Bulk Diff — skipped non-xlsx: '+file.name,'err');continue;}
    /* Read + parse synchronously-ish via FileReader so runBulkDiff can
       stay a plain loop. Each entry holds the parsed workbook. */
    const entry={id:++bulkDiffIdCounter,name:file.name,wb:null,slot};
    bulkDiffFiles[slot].push(entry);
    const r=new FileReader();
    r.onload=ev=>{
      try{entry.wb=XLSX.read(ev.target.result,{type:'array',cellNF:true});}
      catch(err){showLog('Bulk Diff — could not read '+file.name+': '+err.message,'err');
        const i=bulkDiffFiles[slot].indexOf(entry);if(i>=0)bulkDiffFiles[slot].splice(i,1);}
      renderBulkDiffPairs();
    };
    r.readAsArrayBuffer(file);
    added++;
  }
  if(added)showLog('Bulk Diff — added '+added+' file(s) to set '+slot.toUpperCase()+'.','ok');
  renderBulkDiffPairs();
}

function removeBulkDiffFile(slot,id){
  const arr=bulkDiffFiles[slot];const i=arr.findIndex(f=>f.id===id);
  if(i>=0)arr.splice(i,1);
  renderBulkDiffPairs();
}

/* Reset only the bulk inputs/preview (leaves any rendered results from a
   previous run untouched — the global Clear button wipes everything). */
function _resetBulkDiffInputs(){
  bulkDiffFiles.a=[];bulkDiffFiles.b=[];
  ['A','B'].forEach(s=>{
    const el=document.getElementById('diffBulkSlot'+s);if(el)el.classList.remove('loaded','drag');
    const nm=document.getElementById('diffBulkName'+s);if(nm)nm.textContent='Click or drop .xlsx files';
    const inp=document.getElementById('diffBulkInput'+s);if(inp)inp.value='';
  });
  renderBulkDiffPairs();
}
function clearBulkDiff(){_resetBulkDiffInputs();showLog('Bulk Diff — cleared file sets.','ok');}

function renderBulkDiffPairs(){
  /* Slot loaded-state + count labels */
  ['a','b'].forEach(s=>{
    const S=s.toUpperCase();
    const el=document.getElementById('diffBulkSlot'+S);
    const nm=document.getElementById('diffBulkName'+S);
    const n=bulkDiffFiles[s].length;
    if(el)el.classList.toggle('loaded',n>0);
    if(nm)nm.textContent=n?(n+' file(s) loaded'):'Click or drop .xlsx files';
  });
  const box=document.getElementById('diffBulkPairs');
  if(!box)return;
  const{pairs,unmatchedA,unmatchedB}=computeBulkDiffPairs();
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html='';
  if(pairs.length){
    html+=`<div class="bdp-section-label">${pairs.length} matched pair(s)</div>`;
    html+=pairs.map(p=>
      `<div class="bdp-pair">
        <span class="bdp-file bdp-a" title="${esc(p.a.name)}">${esc(p.a.name)}</span>
        <span class="bdp-arrow">\u2194</span>
        <span class="bdp-file bdp-b" title="${esc(p.b.name)}">${esc(p.b.name)}</span>
        ${p.ambiguous?'<span class="bdp-badge" title="Multiple files share this name key — paired by sorted name order. Rename for an exact 1:1 match if this is wrong.">by order</span>':''}
        <button type="button" class="bdp-rm" title="Remove this A file" onclick="removeBulkDiffFile('a',${p.a.id})">\u2715</button>
      </div>`).join('');
  }
  const unmatched=[...unmatchedA.map(f=>({f,slot:'a'})),...unmatchedB.map(f=>({f,slot:'b'}))];
  if(unmatched.length){
    html+=`<div class="bdp-section-label">${unmatched.length} unmatched \u2014 no partner found</div>`;
    html+=unmatched.map(({f,slot})=>
      `<div class="bdp-unmatched">
        <span class="bdp-file" title="${esc(f.name)}">${slot.toUpperCase()}: ${esc(f.name)}</span>
        <button type="button" class="bdp-rm" title="Remove" onclick="removeBulkDiffFile('${slot}',${f.id})">\u2715</button>
      </div>`).join('');
  }
  box.innerHTML=html;
  const btn=document.getElementById('btnBulkDiffRun');
  if(btn)btn.disabled=pairs.length===0;
  const ct=document.getElementById('ctBulkDiff');
  if(ct)ct.textContent=pairs.length?('\u00b7 '+pairs.length):'';
}

function runBulkDiff(){
  const{pairs}=computeBulkDiffPairs();
  if(!pairs.length){showLog('Bulk Diff — no matched A/B pairs. Name predicted & expected files alike (role words like "predicted"/"expected" are ignored).','err');return;}
  const notReady=pairs.filter(p=>!p.a.wb||!p.b.wb);
  if(notReady.length){showLog('Bulk Diff — '+notReady.length+' file(s) still parsing, try again in a moment.','err');return;}
  const parts=[];
  for(const p of pairs){
    const base=p.a.name.replace(/\.[^.]+$/,'');
    const source={tag:p.key||base,label:base};
    parts.push(diffWorkbooks(p.a.wb,p.a.name,p.b.wb,p.b.name,source));
  }
  finalizeDiff(parts,`Bulk diff \u00b7 ${pairs.length} file pair(s)`,true);
  showLog(`Bulk Diff — compared ${pairs.length} pair(s) into one corpus. Use the chips, filters, and exports below on the combined set.`,'ok');
  document.getElementById('diffResults').scrollIntoView({behavior:'smooth',block:'start'});
}

/* Collect the structured input cells the rules actually read, keyed by
   forwarder. This is the SINGLE source of input features for the whole
   Diff Mode pipeline — table detail drawer, diff CSV, and training set
   all read `row.inputs` produced here, so there is no second collector to
   drift out of sync. */
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
    /* In the default 'all' view, hide `correct` (A==B) rows — EXCEPT when
       the current engine disagrees with ground truth (engine_matches_b===
       false): the tool was right but the engine being trained is wrong, so
       surface it. Pure positives (engine also matches truth, or not
       evaluated → null) stay hidden until "Include matching rows" is on. */
    else {if(r.label==='correct'&&!includeMatches&&r.engineMatchesB!==false)return false;}
    if(fw!=='all'&&r.fw!==fw)return false;
    if(sheet!=='all'&&r.sheet!==sheet)return false;
    if(needle){
      const hay=((r.before||'')+' '+(r.after||'')+' '+(r.reason||'')+' '+(r.engineNow||'')+' '+(r.source||'')).toLowerCase();
      if(!hay.includes(needle))return false;
    }
    return true;
  });
}

function renderDiff(){
  if(!diffState.results)return;
  diffRenderLimit=DIFF_PAGE; /* fresh compare → snap the table back to one page */
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
    const tSpec=document.getElementById('btnDiffRuleSpec');if(tSpec)tSpec.style.display='none';
    const tBundle=document.getElementById('btnDiffAiBundle');if(tBundle)tBundle.style.display='none';
    const incWrap=document.getElementById('diffIncludeMatchWrap');if(incWrap)incWrap.style.display='none';
  } else {
    document.getElementById('diffResults').style.display='block';
    document.getElementById('diffEmpty').style.display='none';
    document.getElementById('btnDiffCsv').style.display='inline-block';
    const tCsv=document.getElementById('btnDiffTrainCsv');if(tCsv)tCsv.style.display='inline-block';
    const tJsonl=document.getElementById('btnDiffTrainJsonl');if(tJsonl)tJsonl.style.display='inline-block';
    const tSpec=document.getElementById('btnDiffRuleSpec');if(tSpec)tSpec.style.display='inline-block';
    const tBundle=document.getElementById('btnDiffAiBundle');if(tBundle)tBundle.style.display='inline-block';
    const incWrap=document.getElementById('diffIncludeMatchWrap');if(incWrap)incWrap.style.display='flex';
  }

  refreshDiffView();
  showLog(`Diff \u2014 ${wrong} wrong, ${missed} missed, ${overfired} overfired, ${drift} engine-drift (${total} rows scanned across ${forwarders.length||1} forwarder(s)).`,'ok');
}

/* Incremental render cap. The table renders DIFF_PAGE rows at a time;
   "Show more" in the footer raises the cap by another page instead of
   forcing the user to filter. The cap snaps back to one page whenever
   the filter state changes (tracked by signature) or a new compare runs,
   so a stale deep scroll never carries into an unrelated view. */
const DIFF_PAGE=500;
let diffRenderLimit=DIFF_PAGE;
let _diffFilterSig='';
function expandDiffLimit(){diffRenderLimit+=DIFF_PAGE;refreshDiffView();}

/* Rebuild the visible table + meta line + export-button counters from
   the current filter state. Called by runDiff, the chip buttons, the
   filter inputs, and the include-matches checkbox. */
function refreshDiffView(){
  if(!diffState.results)return;
  /* Pull the live control values FIRST. The inline onchange/oninput
     handlers on the selects + search box fire BEFORE the DOMContentLoaded
     mirror listeners (inline attributes register at parse time), so
     reading diffFilter here without this sync would filter on the
     previous value — and the old reverse-sync at the bottom of this
     function then wrote that stale value back into the select, reverting
     the user's dropdown choice outright. The DOM controls are the source
     of truth; diffFilter mirrors them for the export paths. */
  const qEl=document.getElementById('diffSearch');if(qEl)diffFilter.q=qEl.value;
  const fwEl=document.getElementById('diffFwFilter');if(fwEl)diffFilter.fw=fwEl.value;
  const shEl=document.getElementById('diffSheetFilter');if(shEl)diffFilter.sheet=shEl.value;
  const sig=[diffFilter.label,diffFilter.fw,diffFilter.sheet,diffFilter.q,
    !!document.getElementById('diffIncludeMatch')?.checked].join('\u0001');
  if(sig!==_diffFilterSig){_diffFilterSig=sig;diffRenderLimit=DIFF_PAGE;}
  const filtered=filterDiffRows();
  const{rows,total,forwarders}=diffState.results;
  const MAX=diffRenderLimit;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const metaPrefix=diffState.results.meta||(diffState.a&&diffState.b?`A: ${diffState.a.name}  \u2194  B: ${diffState.b.name}`:'');
  document.getElementById('diffMeta').textContent=
    `${metaPrefix}  \u00b7  ${total} rows scanned across ${forwarders.length||1} forwarder(s)`;

  const tbody=document.querySelector('#diffTable tbody');
  const slice=filtered.slice(0,MAX);
  tbody.innerHTML=slice.map((r,i)=>renderDiffRow(r,i,esc)).join('');

  const foot=document.getElementById('diffTableFoot');
  if(foot){
    if(!filtered.length){foot.textContent='// no rows match the current filter — loosen a chip or clear the search.';}
    else if(filtered.length>MAX){foot.innerHTML=`// showing first ${MAX} of ${filtered.length} matching rows — <button type="button" class="df-show-more" onclick="expandDiffLimit()">show ${Math.min(DIFF_PAGE,filtered.length-MAX)} more</button> or use filters to narrow.`;}
    else if(filtered.length<rows.length){foot.textContent=`// showing ${filtered.length} of ${rows.length} rows (filtered).`;}
    else{foot.textContent=`// showing all ${filtered.length} rows.`;}
  }

  /* Export-button counters — all reflect the current filter */
  const trainable=filtered.filter(r=>r.change!=='sheet').length;
  document.getElementById('ctDiffCsv').textContent=filtered.length?`\u00b7 ${filtered.length}`:'';
  document.getElementById('ctTrainCsv').textContent=trainable?`\u00b7 ${trainable}`:'';
  document.getElementById('ctTrainJsonl').textContent=trainable?`\u00b7 ${trainable}`:'';
  const ctBundle=document.getElementById('ctAiBundle');
  if(ctBundle)ctBundle.textContent=trainable?`\u00b7 ${trainable}`:'';

  /* Active chip visual state */
  document.querySelectorAll('#trainChips .train-chip').forEach(b=>
    b.classList.toggle('active',b.dataset.label===diffFilter.label));
  /* The classic summary tiles double as filter shortcuts (added→missed,
     removed→overfired, changed→wrong) — mirror the same active state. */
  document.querySelectorAll('.diff-summary .diff-stat[data-label]').forEach(b=>{
    const on=b.dataset.label===diffFilter.label;
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',on?'true':'false');
  });

}

function renderDiffRow(r,i,esc){
  const multi=diffState.results&&diffState.results.multiSource;
  const sheetCell=multi&&r.source
    ? `<span class="df-src" title="Source file pair">${esc(r.source)}</span>${esc(r.sheet)}`
    : esc(r.sheet);
  if(r.change==='sheet'){
    return `<tr class="df-sheet"><td>${sheetCell}</td><td>${r.row}</td><td><span class="fw-pill fw-${r.fw}">${esc(r.fw)}</span></td><td><span class="lbl-pill lbl-sheet">sheet</span></td><td class="df-before">${esc(r.before)}</td><td class="df-after">${esc(r.after)}</td><td class="df-engine"></td><td class="df-actions"></td></tr>`;
  }
  const labelCls=LABEL_CLASS[r.label]||'';
  const engine=renderEngineCell(r,esc);
  const actions=`<button type="button" class="df-expand-btn" aria-expanded="false" title="Show inputs + reason trace" onclick="toggleDiffDetail(${i})">›</button>`;
  /* Per-phrase highlighting: only the phrases that actually differ get
     the removed/added treatment; phrases both sides agree on render
     neutral, so on multi-phrase rows the disagreeing phrase pops out
     without opening the detail drawer. Empty cells render an em-dash. */
  const phraseCell=(cls,raw,changedList,changedCls)=>{
    const parts=phraseCellParts(raw,changedList);
    if(!parts.length)return `<td class="${cls}">\u2014</td>`;
    return `<td class="${cls}">${parts.map(p=>`<span class="dfp ${p.changed?changedCls:'dfp-common'}">${esc(p.text)}</span>`).join('<span class="dfp-sep"> // </span>')}</td>`;
  };
  const beforeCell=phraseCell('df-before',r.before,r.extra_phrases,'dfp-extra');
  const afterCell =phraseCell('df-after' ,r.after ,r.missing_phrases,'dfp-missing');
  return `<tr class="${labelCls}" data-row-i="${i}"><td>${sheetCell}</td><td>${r.row}</td><td><span class="fw-pill fw-${r.fw}">${esc(r.fw)}</span></td><td><span class="lbl-pill lbl-${r.label}">${r.label}</span></td>${beforeCell}${afterCell}${engine}<td class="df-actions">${actions}</td></tr>`;
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
  const srcKv=(diffState.results&&diffState.results.multiSource&&r.source)
    ? `<div class="df-detail-kv"><span class="kv-k">source_file</span><span class="kv-v" title="${esc(r.source)}">${esc(r.source)}</span></div>`
    : '';
  const kv=srcKv+(keys.length
    ? keys.map(k=>`<div class="df-detail-kv"><span class="kv-k">${esc(k)}</span><span class="kv-v" title="${esc(r.inputs[k])}">${esc(r.inputs[k])}</span></div>`).join('')
    : '<div class="df-detail-kv empty"><span class="kv-k">inputs</span><span class="kv-v">(no rule-visible cells captured — unknown forwarder)</span></div>');
  /* Phrase-level diff visualisation. Only render when meaningful — for
     `correct` rows there's nothing to show; for missed/overfired/wrong
     the breakdown is the whole point of the precision pass. */
  const phrChip=(cls,p)=>`<span class="df-phr-chip ${cls}">${esc(p)}</span>`;
  const phrSection=(label,arr,cls)=>arr&&arr.length
    ? `<div class="df-phr-row"><span class="df-phr-label">${label}</span><span class="df-phr-list">${arr.map(p=>phrChip(cls,p)).join('')}</span></div>`
    : '';
  const hasPhraseDiff=(r.missing_phrases&&r.missing_phrases.length)||
                     (r.extra_phrases&&r.extra_phrases.length)||
                     (r.common_phrases&&r.common_phrases.length);
  const phrBlock=hasPhraseDiff
    ? `<div class="df-phr-block">
         <div class="df-phr-head">
           <span class="df-phr-title">phrase diff</span>
           ${r.granular?`<span class="df-gran-badge df-gran-${esc(r.granular)}">${esc(r.granular.replace(/_/g,' '))}</span>`:''}
           ${r.phrase_jaccard!=null?`<span class="df-phr-jac" title="Jaccard similarity of predicted vs expected phrase sets (1.0 = identical, 0 = disjoint)">jaccard ${(r.phrase_jaccard).toFixed(2)}</span>`:''}
           ${r.row_uid?`<span class="df-uid" title="Stable row UID — identical rows across runs share this hash">uid ${esc(r.row_uid)}</span>`:''}
         </div>
         ${phrSection('missing',r.missing_phrases,'phr-missing')}
         ${phrSection('extra'  ,r.extra_phrases  ,'phr-extra')}
         ${phrSection('common' ,r.common_phrases ,'phr-common')}
       </div>`
    : '';
  /* Engine-vs-truth (#26): how the CURRENT engine compares to ground
     truth B — the actionable target for a rule fix. Rendered whenever the
     engine ran AND disagrees with truth (engine_label set and not
     'correct'), including the case where the tool (A) was right but the
     engine drifted. "should add" = phrases truth wants the engine to emit;
     "should remove" = phrases the engine emits that truth rejects. */
  const engineRan=r.engine_label!=='' && r.engine_label!=null;
  const engineWrong=engineRan && r.engine_label!=='correct';
  const evtBlock=engineWrong
    ? `<div class="df-phr-block df-evt-block">
         <div class="df-phr-head">
           <span class="df-phr-title" title="Current engine output vs ground truth B — this is what a rule fix must close">engine vs truth</span>
           <span class="lbl-pill lbl-${esc(r.engine_label)}">${esc(r.engine_label)}</span>
           ${r.engine_granular?`<span class="df-gran-badge df-gran-${esc(r.engine_granular)}">${esc(r.engine_granular.replace(/_/g,' '))}</span>`:''}
           ${r.engine_vs_expected_jaccard!=null?`<span class="df-phr-jac" title="Jaccard similarity of the CURRENT engine's output vs ground-truth phrase sets (1.0 = identical, 0 = disjoint)">jaccard ${(r.engine_vs_expected_jaccard).toFixed(2)}</span>`:''}
         </div>
         ${phrSection('should add'   ,r.engine_missing_phrases,'phr-missing')}
         ${phrSection('should remove',r.engine_extra_phrases  ,'phr-extra')}
       </div>`
    : '';
  const reasonHtml=r.reason
    ? `<div class="df-reason-block"><span class="rb-label">trigger trace</span>${esc(r.reason)}</div>`
    : '<div class="df-reason-block empty"><span class="rb-label">trigger trace</span>(engine produced no reason — either no rule fired or forwarder unknown)</div>';
  const canSend=r.fw&&r.fw!=='-'&&r.fw!=='unknown';
  const sendBtn=canSend
    ? `<button type="button" class="df-send-tester" onclick="sendDiffToTester(${i})" title="Open this case in the Rule Tester with every input pre-filled">✦ Send to Tester</button>`
    : '';
  const tr=document.createElement('tr');
  tr.className='df-detail';tr.dataset.for=String(i);
  tr.innerHTML=`<td colspan="8"><div class="df-detail-wrap"><div class="df-detail-grid">${kv}${phrBlock}${evtBlock}${reasonHtml}</div>${sendBtn?`<div>${sendBtn}</div>`:''}</div></td>`;
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
  /* Phrase arrays serialise to '|'-joined strings — readable in a
     spreadsheet AND parseable downstream. Empty arrays become ''. */
  const joinPhr=arr=>Array.isArray(arr)?arr.join(' | '):'';
  /* Use the per-forwarder canonical order so successive Diff CSVs from
     the same workbook line up column-for-column. Sheet rows (header
     warnings) are skipped before the union, since they don't have
     meaningful inputs. */
  const trainable=rows.filter(r=>r.change!=='sheet');
  const inputKeys=orderedInputKeys(trainable);
  const header=[
    'row_uid','source_file','sheet','row','forwarder','processor','applicable_threshold',
    'label','granular_label','change',
    'before','after','engine_now','engine_matches_a','phrase_jaccard',
    'predicted_phrases','expected_phrases','common_phrases',
    'missing_phrases','extra_phrases',
    'predicted_phrase_keys','expected_phrase_keys','common_phrase_keys',
    'missing_phrase_keys','extra_phrase_keys',
    'engine_phrases','engine_phrase_keys',
    'engine_label','engine_matches_b','engine_granular','engine_vs_expected_jaccard',
    'engine_missing_phrases','engine_extra_phrases',
    'engine_missing_phrase_keys','engine_extra_phrase_keys',
    'reason',
    ...inputKeys.map(k=>'in_'+k),
  ];
  const lines=[header.join(',')];
  for(const r of rows){
    const isSheet=r.change==='sheet';
    const base=[
      isSheet?'':(r.row_uid||''),
      r.source||'',
      r.sheet,r.row,r.fw,
      isSheet?'':(r.processor||''),
      isSheet?'':(r.applicable_threshold==null?'':r.applicable_threshold),
      r.label,isSheet?'':(r.granular||''),r.change,
      r.before,r.after,r.engineNow||'',r.engineMatchesA?'true':'false',
      isSheet?'':(r.phrase_jaccard==null?'':r.phrase_jaccard),
      isSheet?'':joinPhr(r.predicted_phrases),
      isSheet?'':joinPhr(r.expected_phrases),
      isSheet?'':joinPhr(r.common_phrases),
      isSheet?'':joinPhr(r.missing_phrases),
      isSheet?'':joinPhr(r.extra_phrases),
      isSheet?'':joinPhr(r.predicted_phrase_keys),
      isSheet?'':joinPhr(r.expected_phrase_keys),
      isSheet?'':joinPhr(r.common_phrase_keys),
      isSheet?'':joinPhr(r.missing_phrase_keys),
      isSheet?'':joinPhr(r.extra_phrase_keys),
      isSheet?'':joinPhr(r.engine_phrases),
      isSheet?'':joinPhr(r.engine_phrase_keys),
      isSheet?'':(r.engine_label||''),
      isSheet?'':(r.engineMatchesB==null?'':(r.engineMatchesB?'true':'false')),
      isSheet?'':(r.engine_granular||''),
      isSheet?'':(r.engine_vs_expected_jaccard==null?'':r.engine_vs_expected_jaccard),
      isSheet?'':joinPhr(r.engine_missing_phrases),
      isSheet?'':joinPhr(r.engine_extra_phrases),
      isSheet?'':joinPhr(r.engine_missing_phrase_keys),
      isSheet?'':joinPhr(r.engine_extra_phrase_keys),
      r.reason||'',
    ];
    for(const k of inputKeys){const v=isSheet?'':(r.inputs||{})[k];base.push(v==null?'':v);}
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

/* NOTE: the legacy per-sheet helpers that used to live here
   (FW_RESOLVERS / tsResolverScore / tsDetectForwarder / tsLabelFor /
   tsCollectInputs / tsRunRule) were removed once Diff Mode unified on the
   single `diffWorkbooks` walk. Forwarder detection now goes through
   `detectForwarderForSheet`, labels through `classifyDiff`, input capture
   through `collectInputsForRow`, and the engine re-run is inline in
   `diffWorkbooks`. The old copies had silently drifted from the live path
   (e.g. their K+N input collector dropped the `tarif` feature), which is
   exactly the kind of split-brain that corrupts the exported training set —
   so there is now ONE code path that the table, the detail drawer, and every
   export read from. */

/* Build the training-set records directly from the enriched rows
   produced by runDiff — no second sheet walk. Honors the current
   filter scope (chip + forwarder + sheet + search) so the user can
   e.g. export only the "missed" rows for one forwarder.

   Precision rules (all in service of cleaner training data):
     1. Sheet-level rows (header/missing-sheet warnings) are dropped.
     2. `correct` rows are dropped unless "Include matching rows" is on.
     3. Trivially-empty rows — A==B=='' AND no rule-visible inputs AND
        no engine output — are ALWAYS dropped (even with includeMatches),
        because they're padding rows below the data, not real negatives.
     4. Records are deduped by row_uid (stable hash of fw|sheet|row|inputs)
        so identical rows can't sneak in twice across runs that get
        concatenated downstream.
     5. Input columns are returned in canonical per-forwarder order so
        the CSV layout is stable across runs of the same workbook.

   Each record carries the full phrase-level diff produced by runDiff,
   not just the coarse top-level label — see computePhraseDiff. */
function buildTrainingSet(){
  if(!diffState.results||!diffState.results.rows.length)return{records:[],inputKeys:[]};
  const includeMatches=!!document.getElementById('diffIncludeMatch')?.checked;
  const scope=filterDiffRows();
  const records=[];
  const seenUids=new Set();
  for(const r of scope){
    if(r.change==='sheet')continue;
    /* Keep a `correct` (A==B) row when the CURRENT engine disagrees with
       ground truth (engine_matches_b===false): the tool was coincidentally
       right but the engine being trained is wrong here — a prime training
       case that would otherwise be dropped. Pure positives (engine also
       matches truth, or engine not evaluated → null) stay gated behind the
       "Include matching rows" toggle. */
    if(r.label==='correct'&&!includeMatches&&r.engineMatchesB!==false)continue;
    /* Drop padding rows: nothing on either side, no inputs, no engine. */
    const hasInputs=Object.keys(r.inputs||{}).length>0;
    const hasContent=(r.before||'').trim()!==''||(r.after||'').trim()!==''||(r.engineNow||'').trim()!=='';
    if(!hasContent&&!hasInputs)continue;
    /* Dedupe by stable row UID. */
    if(r.row_uid&&seenUids.has(r.row_uid))continue;
    if(r.row_uid)seenUids.add(r.row_uid);
    records.push({
      row_uid:r.row_uid||'',
      source_file:r.source||'',
      sheet:r.sheet,
      row:r.row,
      forwarder:r.fw,
      processor:r.processor||'',         /* exact source-code symbol to edit */
      applicable_threshold:r.applicable_threshold==null?null:r.applicable_threshold,
      label:r.label,
      granular_label:r.granular||'',
      predicted:r.before,                     /* what slot A (tool) says */
      expected:r.after,                       /* what slot B (truth) says */
      rule_engine_now:r.engineNow||'',        /* what the current engine would say today */
      engine_matches_a:!!r.engineMatchesA,
      reason:r.reason||'',                    /* trigger trace */
      /* Phrase-level diff — the precision payload. */
      phrase_jaccard   :r.phrase_jaccard,
      predicted_phrases:r.predicted_phrases||[],
      expected_phrases :r.expected_phrases||[],
      common_phrases   :r.common_phrases||[],
      missing_phrases  :r.missing_phrases||[],
      extra_phrases    :r.extra_phrases||[],
      /* Phrase-key reverse lookup — maps directly to PHRASES catalog
         keys (or `lit_*`/`tpl_*`/`?:*` for non-catalog/dynamic/unknown).
         These are the source-code identifiers an AI consumer can grep
         for to locate the rule branch in process<Forwarder>. */
      predicted_phrase_keys:r.predicted_phrase_keys||[],
      expected_phrase_keys :r.expected_phrase_keys||[],
      common_phrase_keys   :r.common_phrase_keys||[],
      missing_phrase_keys  :r.missing_phrase_keys||[],
      extra_phrase_keys    :r.extra_phrase_keys||[],
      engine_phrases       :r.engine_phrases||[],
      engine_phrase_keys   :r.engine_phrase_keys||[],
      /* Engine-vs-truth (#26): how the CURRENT engine compares to ground
         truth B — the precise target for rule fixes. `engine_label` scores
         the engine (not the tool) against truth; `engine_missing_phrase_keys`
         are PHRASES branches to ADD/loosen, `engine_extra_phrase_keys` are
         branches to GUARD/tighten. Null/empty when the engine wasn't run. */
      engine_label              :r.engine_label||'',
      engine_matches_b          :r.engineMatchesB==null?null:!!r.engineMatchesB,
      engine_granular           :r.engine_granular||'',
      engine_vs_expected_jaccard:r.engine_vs_expected_jaccard==null?null:r.engine_vs_expected_jaccard,
      engine_missing_phrases    :r.engine_missing_phrases||[],
      engine_extra_phrases      :r.engine_extra_phrases||[],
      engine_missing_phrase_keys:r.engine_missing_phrase_keys||[],
      engine_extra_phrase_keys  :r.engine_extra_phrase_keys||[],
      inputs:r.inputs||{},
    });
  }
  /* Deterministic record order: forwarder → source pair → sheet → row.
     The walk order above depends on workbook sheet order and (for Bulk)
     pair order, so without this sort two exports of the same corpus
     could disagree line-for-line — sorting makes successive bundles
     diffable and downstream dedup/join stable. */
  records.sort((a,b)=>
    String(a.forwarder).localeCompare(String(b.forwarder))||
    String(a.source_file||'').localeCompare(String(b.source_file||''))||
    String(a.sheet).localeCompare(String(b.sheet))||
    (a.row-b.row));
  /* Canonical, deterministic input-key ordering across all records. */
  const inputKeys=orderedInputKeys(records.map(r=>({fw:r.forwarder,inputs:r.inputs})));
  return{records,inputKeys};
}

/* Aggregate a training-record array (buildTrainingSet output) into the
   compact, AI-first failure-pattern summary shipped as summary.json in
   the AI Bundle. Pure — no DOM, no globals — so it's unit-testable and
   the caller stamps engine_version / exported_at / filter scope.

   Why: the documented rule-update workflow STARTS with "group records by
   forwarder, then by engine_missing/extra_phrase_keys patterns" — this
   does that grouping up front, so an AI consumer (often context-limited)
   can prioritise by pattern count and only then pull the matching JSONL
   records by row_uid.

   Pattern semantics:
     • Basis is engine-vs-truth (the authoritative fix target) whenever
       the engine ran; rows where it didn't (unknown forwarder) fall back
       to the A-vs-B keys and are marked basis:'a_vs_b'.
     • Rows the engine already solves (engine_label==='correct') count
       toward engine_solved but produce NO pattern — nothing to fix.
     • shared_inputs are the input cells that hold the IDENTICAL value on
       every row of the pattern — prime gate-signal candidates; keys
       present on every row but with differing values land in
       varying_inputs. Keys missing from some rows are omitted. */
function buildTrainingSummary(records){
  const byLabel={},byEngineLabel={},byForwarder={};
  let solved=0,actionable=0,notEvaluated=0;
  const patterns=new Map();
  for(const r of (records||[])){
    byLabel[r.label]=(byLabel[r.label]||0)+1;
    const el=r.engine_label||'not_evaluated';
    byEngineLabel[el]=(byEngineLabel[el]||0)+1;
    const fwB=byForwarder[r.forwarder]||(byForwarder[r.forwarder]={
      records:0,engine_correct:0,engine_wrong:0,engine_missed:0,engine_overfired:0,engine_not_evaluated:0});
    fwB.records++;
    const useEngine=!!r.engine_label;
    if(!useEngine){fwB.engine_not_evaluated++;notEvaluated++;}
    else if(r.engine_label==='correct'){fwB.engine_correct++;solved++;continue;}
    else{fwB['engine_'+r.engine_label]++;actionable++;}
    const missK =(useEngine?r.engine_missing_phrase_keys:r.missing_phrase_keys)||[];
    const extraK=(useEngine?r.engine_extra_phrase_keys :r.extra_phrase_keys )||[];
    if(!missK.length&&!extraK.length)continue;
    const key=r.forwarder+'|'+missK.slice().sort().join(',')+'|'+extraK.slice().sort().join(',')+'|'+(useEngine?'e':'a');
    let p=patterns.get(key);
    if(!p){
      p={forwarder:r.forwarder,processor:r.processor||'',
        basis:useEngine?'engine_vs_truth':'a_vs_b',
        missing_phrase_keys:missK.slice().sort(),
        extra_phrase_keys:extraK.slice().sort(),
        missing_phrases:((useEngine?r.engine_missing_phrases:r.missing_phrases)||[]).slice(),
        extra_phrases:((useEngine?r.engine_extra_phrases:r.extra_phrases)||[]).slice(),
        suggested_action:missK.length&&extraK.length?'fix_both'
          :(missK.length?'add_or_loosen_branch':'guard_or_tighten_branch'),
        count:0,labels:{},example_row_uids:[],_inputsList:[]};
      patterns.set(key,p);
    }
    p.count++;
    p.labels[r.label]=(p.labels[r.label]||0)+1;
    if(p.example_row_uids.length<5&&r.row_uid)p.example_row_uids.push(r.row_uid);
    p._inputsList.push(r.inputs||{});
  }
  const out=[...patterns.values()];
  for(const p of out){
    const lists=p._inputsList;delete p._inputsList;
    const allKeys=new Set();
    for(const o of lists)for(const k of Object.keys(o))allKeys.add(k);
    const shared={},varying=[];
    for(const k of [...allKeys].sort()){
      const vals=lists.map(o=>o[k]);
      if(vals.some(v=>v==null))continue; /* not on every row → omit */
      if(vals.every(v=>v===vals[0]))shared[k]=vals[0];
      else varying.push(k);
    }
    p.shared_inputs=shared;p.varying_inputs=varying;
  }
  out.sort((a,b)=>(b.count-a.count)||
    String(a.forwarder).localeCompare(String(b.forwarder))||
    String(a.missing_phrase_keys).localeCompare(String(b.missing_phrase_keys))||
    String(a.extra_phrase_keys).localeCompare(String(b.extra_phrase_keys)));
  return{
    schema:'anmerkung.training-summary/v1',
    total_records:(records||[]).length,
    by_label:byLabel,
    by_engine_label:byEngineLabel,
    by_forwarder:byForwarder,
    engine_solved:solved,
    engine_actionable:actionable,
    engine_not_evaluated:notEvaluated,
    pattern_count:out.length,
    patterns:out,
  };
}

function downloadTrainingSet(format){
  const{records,inputKeys}=buildTrainingSet();
  if(!records.length){showLog('Training set \u2014 no rows to export (maybe all rows matched; try "Include matching rows").','err');return;}
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  let blob,ext;
  if(format==='jsonl'){
    /* JSONL preserves phrase arrays as native JSON arrays — direct ML feed. */
    const lines=records.map(r=>JSON.stringify(r));
    blob=new Blob([lines.join('\n')+'\n'],{type:'application/x-ndjson;charset=utf-8'});
    ext='jsonl';
  } else {
    /* CSV: flatten inputs to one column per key, phrase arrays to ' | '
       joined strings. row_uid leads so successive runs can be joined. */
    const esc=s=>{const v=String(s==null?'':s);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
    const joinPhr=arr=>Array.isArray(arr)?arr.join(' | '):'';
    const header=[
      'row_uid','source_file','sheet','row','forwarder','processor','applicable_threshold',
      'label','granular_label',
      'predicted','expected','rule_engine_now','engine_matches_a',
      'phrase_jaccard',
      'predicted_phrases','expected_phrases','common_phrases',
      'missing_phrases','extra_phrases',
      'predicted_phrase_keys','expected_phrase_keys','common_phrase_keys',
      'missing_phrase_keys','extra_phrase_keys',
      'engine_phrases','engine_phrase_keys',
      'engine_label','engine_matches_b','engine_granular','engine_vs_expected_jaccard',
      'engine_missing_phrases','engine_extra_phrases',
      'engine_missing_phrase_keys','engine_extra_phrase_keys',
      'reason',
      ...inputKeys.map(k=>'in_'+k),
    ];
    const lines=[header.join(',')];
    for(const r of records){
      const row=[
        r.row_uid,r.source_file||'',r.sheet,r.row,r.forwarder,
        r.processor||'',
        r.applicable_threshold==null?'':r.applicable_threshold,
        r.label,r.granular_label||'',
        r.predicted,r.expected,r.rule_engine_now,r.engine_matches_a?'true':'false',
        r.phrase_jaccard==null?'':r.phrase_jaccard,
        joinPhr(r.predicted_phrases),
        joinPhr(r.expected_phrases),
        joinPhr(r.common_phrases),
        joinPhr(r.missing_phrases),
        joinPhr(r.extra_phrases),
        joinPhr(r.predicted_phrase_keys),
        joinPhr(r.expected_phrase_keys),
        joinPhr(r.common_phrase_keys),
        joinPhr(r.missing_phrase_keys),
        joinPhr(r.extra_phrase_keys),
        joinPhr(r.engine_phrases),
        joinPhr(r.engine_phrase_keys),
        r.engine_label||'',
        r.engine_matches_b==null?'':(r.engine_matches_b?'true':'false'),
        r.engine_granular||'',
        r.engine_vs_expected_jaccard==null?'':r.engine_vs_expected_jaccard,
        joinPhr(r.engine_missing_phrases),
        joinPhr(r.engine_extra_phrases),
        joinPhr(r.engine_missing_phrase_keys),
        joinPhr(r.engine_extra_phrase_keys),
        r.reason,
      ];
      for(const k of inputKeys)row.push(r.inputs[k]==null?'':r.inputs[k]);
      lines.push(row.map(esc).join(','));
    }
    blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    ext='csv';
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='anmerkung_training_'+stamp+'.'+ext;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  /* Quick summary in the log so users know what they got — top-level
     label counts AND granular sub-label counts, since the latter is
     where the precision lives. */
  const byLabel={};const byGran={};
  for(const r of records){
    byLabel[r.label]=(byLabel[r.label]||0)+1;
    if(r.granular_label)byGran[r.granular_label]=(byGran[r.granular_label]||0)+1;
  }
  const lblParts=Object.keys(byLabel).sort().map(k=>k+'='+byLabel[k]);
  const granParts=Object.keys(byGran).sort().map(k=>k+'='+byGran[k]);
  const scopeNote=(diffFilter.label!=='all'||diffFilter.fw!=='all'||diffFilter.sheet!=='all'||(diffFilter.q&&diffFilter.q.trim()))?' (filter-scoped)':'';
  showLog('Training set exported \u2014 '+records.length+' row(s) as '+ext.toUpperCase()+
    ' \u00b7 labels: '+lblParts.join(', ')+
    (granParts.length?' \u00b7 granular: '+granParts.join(', '):'')+
    scopeNote+'.','ok');
}

/* ══════════════════════════════════════════════════════════
   RULE SPEC + AI BUNDLE (#21) — make Diff-Mode exports
   self-describing so an AI consumer can update the rules in
   assets/anmerkung.js without re-reading the source.

   The JSONL training set already carries `forwarder`,
   `processor`, `*_phrase_keys`, and `inputs`. The Rule Spec
   sidecar provides the schema the keys/inputs are drawn from:
     • phrases       — PHRASES catalog (key → human string)
     • phrase_literals — direct literals not yet promoted to PHRASES
     • phrase_templates — dynamic interpolating phrases (zw, Wackler tier)
     • thresholds    — per-forwarder hasErr() tolerance
     • forwarders    — gate, processor symbol, resolver symbol,
                       canonical input order, and an English glossary
                       for every input key
     • instructions  — a prompt template telling an AI exactly which
                       file/symbol to edit and how to interpret the
                       missing/extra/expected_phrase_keys triple

   Pair (training.jsonl + rule_spec.json) is enough for an AI to
   propose source patches. The AI Bundle ZIP packages both plus a
   README so a single drag-drop is all the user needs.
══════════════════════════════════════════════════════════ */

/* English glossary keyed by the same identifiers collectInputsForRow
   emits. Helps an AI consumer know "fr_diff" means "freight delta"
   without having to grep header-string conventions. */
const INPUT_GLOSSARY={
  stat              :'Stat_Freigabe — approval state. 10 = approved (engine runs). Anything else gates most rules off.',
  tarif             :'Total Kosten lt. Tarif — booked tariff baseline (numeric). Empty / "-" / 0 means no tariff backing.',
  fr_diff           :'FR Differenz — freight-charge delta vs tariff (numeric, signed).',
  exp_diff          :'EXP Differenz — express/priority surcharge delta (numeric, signed).',
  exp_dl            :'EXP Kosten DL — DL-side express cost (Dachser-only signal).',
  mt_diff           :'MT/Maut Differenz — toll delta (numeric, signed).',
  maut_diff         :'Maut Differenz — toll delta (numeric, signed). Same signal as mt_diff for non-DHL forwarders.',
  tz_diff           :'TZ Differenz — fuel surcharge delta (numeric, signed).',
  snk_diff          :'SNK Differenz — surcharge delta (numeric, signed). Compared against forwarder threshold.',
  snk_dl            :'SNK Kosten DL — DL-side surcharge code (numeric). Carries the surcharge type (e.g. 5/9/14/18/25/30/34/60/75/95/130/190).',
  snk_tarif         :'SNK Kosten lt. Tarif — tariff-side surcharge baseline (numeric).',
  zz_diff           :'ZZ Differenz — second-attempt delivery delta (Dachser).',
  sam_diff          :'SAM Differenz — Saturday delivery delta (Dachser).',
  dgr_diff          :'DGR Differenz — dangerous-goods surcharge delta (Dachser).',
  sbfu_diff         :'SBFU Differenz — SBfU certificate delta (Dachser).',
  lg_diff           :'LG Differenz — storage-fee delta (Dachser).',
  av_diff           :'AV Differenz — failed-pickup-attempt delta (Dachser).',
  pal_diff          :'PAL Differenz — non-stackable surcharge (DHL).',
  ow_diff           :'OW Differenz — overweight surcharge (DHL).',
  yo_diff           :'YO Differenz — non-conveyable piece surcharge (DHL). Multiples of 15 are the piece-weight variant.',
  yl_diff           :'YL Differenz — non-conveyable irregular piece (DHL).',
  nd_diff           :'ND Differenz — neutral delivery (DHL).',
  sf_diff           :'SF Differenz — direct-signature surcharge (DHL).',
  ac_diff           :'AC Differenz — address-correction surcharge (DHL). Value 11 = "Addres Correction, ok?", others = "Address Correction ok?".',
  nx_diff           :'NX Differenz — generic demand surcharge (DHL).',
  os_diff           :'OS Differenz — oversize piece surcharge (DHL).',
  avis_diff         :'AVIS Differenz — Wackler-only avisierung delta. Codes ±7.5/±8.5/±6.5/±8.7 each map to a specific phrase. AVIS=1 has its own phrase.',
  vkg               :'Volumen kg — gross/volume weight on the audit row (numeric).',
  vkg_dl            :'Volumen kg DL — DL-side volume weight (numeric). Compared against vkg via the per-forwarder weight-tier table.',
  anz_sdg           :'Anz.Sdg — number of shipments on the row (Dachser).',
  referenz          :'ReferenzNr — Sendungs-Referenznummer. A "," in the value is the bundling signal.',
  referenz3         :'ReferenzNr3 — Dachser-specific tertiary reference column (used in trigger trace).',
  recip             :'Empf.-Name — recipient name. "amazon" substring triggers Amazon-tier branches in K+N.',
  empf_plz          :'Empf.-PLZ — recipient ZIP code. 88499 is the Wackler return hub.',
  empf_ort          :'Empf.-Ort — recipient city. RIEDLINGEN is the Wackler return hub city.',
  serv_art          :'Serv.-Art — service category code (Dachser). K1AV / K1AS gate several SNK branches.',
  kostenstelle      :'KOSTENSTELLE — cost-center. Empty or "X" triggers Kontierung?.',
  sachkonto         :'SACHKONTO — GL account. Empty or "X" triggers Kontierung? (or VORHOLUNG on Dachser when "X").',
  existing_anmerkung:'Existing Anmerkung — Wackler reads this; matching any WACKLER_PROTECTED phrase causes the row to be preserved (no overwrite).',
};

/* Per-forwarder gate + signature. Mirrors the gate doc-comments in
   each processor. Kept as data so the spec can re-export it. */
const FORWARDER_SPEC={
  dachser:{
    processor:'processDachser',
    resolver :'resolveDachser',
    gate     :'Stat_Freigabe == 10',
    notes    :'Position-based reads for ReferenzNr3/Empf.-PLZ/Ort/Anz.Sdg/Serv.-Art/Sachkonto (DA_COL_*). Threshold T_DACHSER applied via hasErr() to every *_diff cell.',
  },
  kn:{
    processor:'processKN',
    resolver :'resolveKN',
    gate     :'Stat_Freigabe == 10',
    notes    :'Bundling check (`,` in ReferenzNr) wins early. Amazon recipient + single ref + tier match triggers amazonMuessen/amazonDuerfen branches.',
  },
  dhl:{
    processor:'processDHL',
    resolver :'resolveDHL',
    gate     :'Stat_Freigabe == 10',
    notes    :'Fremdnummer dup early-return. Blocker set (FR/PAL/OW/YO/YL/ND/SF/SNK) suppresses the secondary set (AC/MT/NX/OS).',
  },
  wackler:{
    processor:'processWackler',
    resolver :'resolveWackler',
    gate     :'Stat_Freigabe == 10 (partial: Kontierung still emitted on stat≠10 if KOST/SACH blank)',
    notes    :'Existing Anmerkung is read first; if it matches WACKLER_PROTECTED it short-circuits to null (preserved). AVIS/SNK code-book is sign-insensitive with rounding tolerance.',
  },
};

/* Build the Rule Spec object. Pure — no DOM, no I/O. Caller decides
   whether to download as JSON or include in the bundle ZIP. */
function buildRuleSpec(){
  const fwsSeen=(diffState.results&&diffState.results.forwarders)||['dachser','kn','dhl','wackler'];
  const forwarders={};
  for(const fw of ['dachser','kn','dhl','wackler']){
    const spec=FORWARDER_SPEC[fw]||{};
    const inputKeys=CANONICAL_INPUT_ORDER[fw]||[];
    const glossary={};
    for(const k of inputKeys)glossary[k]=INPUT_GLOSSARY[k]||'(no glossary entry)';
    forwarders[fw]={
      processor:spec.processor||'',
      resolver :spec.resolver||'',
      gate     :spec.gate||'',
      threshold:(TH&&TH[fw]!=null)?TH[fw]:null,
      notes    :spec.notes||'',
      input_keys:inputKeys.slice(),
      input_glossary:glossary,
      seen_in_export:fwsSeen.includes(fw),
    };
  }
  const phraseTemplates=PHRASE_TEMPLATES.map(t=>({
    key:t.key,regex:t.regex.source,flags:t.regex.flags,
    example:t.example,processor:t.processor||'',
  }));
  const phraseLiterals={};
  for(const[k,v]of Object.entries(PHRASE_LITERALS)){
    /* Invert the lookup: the key in PHRASE_LITERALS is the lowercased
       phrase, the value is the synthetic id. AI consumers want
       id → phrase (matches PHRASES shape). */
    phraseLiterals[v]=k;
  }
  return{
    schema:'anmerkung.rule-spec/v1',
    engine_version:VERSION,
    exported_at:new Date().toISOString(),
    source_file:'assets/anmerkung.js',
    phrases:{...PHRASES},
    phrase_literals:phraseLiterals,
    phrase_templates:phraseTemplates,
    thresholds:{...TH},
    label_taxonomy:{
      wrong:'A and B both non-empty and their phrase sets genuinely differ (content, not just order/case/whitespace).',
      missed:'A empty, B filled — engine should have fired.',
      overfired:'A filled, B empty — engine should NOT have fired.',
      drift:'Current engine disagrees with slot A — rules already changed since A was generated.',
      correct:'A and B carry the same phrase set, ignoring order, case, and whitespace — positive example. Phrases are compared per-phrase (the column is a "//"-joined list), so reordered/recased/respaced rows count as correct, not as rule errors.',
    },
    granular_label_taxonomy:{
      exact_match:'Strings identical (non-empty).',
      empty_match:'Both sides empty.',
      case_only:'Differ only by case.',
      whitespace:'Differ only by whitespace/separator formatting.',
      reordered:'Same phrase set, emitted in a different order (or with per-phrase case/whitespace differences). Counts as a match (top-level label "correct"), not a rule error.',
      phrase_subset:'Every A-phrase appears in B, B has more (engine UNDER-fired).',
      phrase_superset:'Every B-phrase appears in A, A has more (engine OVER-fired).',
      phrase_overlap:'Both sides have unique phrases AND share at least one.',
      phrase_disjoint:'No shared phrases.',
      missed_full:'Promoted from top-level missed.',
      overfired_full:'Promoted from top-level overfired.',
    },
    forwarders,
    instructions:{
      summary:'Each training record describes one rule-engine output vs ground truth. Use forwarder + processor to find the function in assets/anmerkung.js. The CURRENT engine\'s gap against truth is carried by engine_missing_phrase_keys (branches to ADD/loosen) and engine_extra_phrase_keys (branches to GUARD/tighten) — prefer these over the A-vs-B missing_/extra_phrase_keys when fixing rules, because A may be a stale or foreign-tool output. Use inputs.* as the gating signals.',
      edit_target:'process<Forwarder> functions in assets/anmerkung.js (resolver columns are already wired; add/edit branches inside the processor).',
      phrase_catalog_target:'PHRASES object near the top of assets/anmerkung.js — add new entries here, then reference via P.<key> with join().',
      threshold_helper:'hasErr(value, T_FORWARDER) — returns true when |value| > threshold. Use this as the gating predicate on numeric *_diff inputs.',
      engine_vs_truth:'engine_label / engine_matches_b / engine_missing_phrase_keys / engine_extra_phrase_keys / engine_vs_expected_jaccard compare what process<Forwarder> emits TODAY against ground truth B — this is the precise fix target. The top-level label (and missing_/extra_phrase_keys) compare slot A (the tool output) against B and can differ from the engine\'s own gap; when label=="correct" but engine_label!="correct" the engine has regressed on a row the tool got right. Treat engine_label as authoritative for rule edits; a fix is complete when engine_matches_b flips to true and engine_missing/extra_phrase_keys are empty.',
      rule_update_workflow:[
        '1. Group records by forwarder, then by engine_missing_phrase_keys / engine_extra_phrase_keys patterns (fall back to missing_/extra_phrase_keys when engine_label is blank, e.g. unknown forwarder).',
        '2. For engine_missing (engine UNDER-fired vs truth): locate the existing branch that emits the missing key (or add one). Loosen its gate using the inputs.* signals on the failing rows.',
        '3. For engine_extra (engine OVER-fired vs truth): locate the branch that emits the extra key. Tighten its gate so the inputs.* signature on these rows no longer matches.',
        '4. For rows that are both: handle the missing and extra key sets independently.',
        '5. Preserve the join() pattern — phrases are de-duplicated case-insensitively automatically.',
        '6. After editing, the user re-runs Train & Compare; engine_matches_b flips to true and the row drops out of the wrong/missed/overfired (and engine-drift) buckets.',
      ],
    },
  };
}

function downloadRuleSpec(){
  const spec=buildRuleSpec();
  const blob=new Blob([JSON.stringify(spec,null,2)+'\n'],{type:'application/json;charset=utf-8'});
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='anmerkung_rule_spec_'+stamp+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showLog('Rule Spec exported \u2014 '+Object.keys(spec.phrases).length+' phrases, '+
    Object.keys(spec.forwarders).length+' forwarders, engine v'+spec.engine_version+'.','ok');
}

/* Build prompt.md — the READY-TO-PASTE prompt the bundle has always
   promised. The user attaches the bundle files to any AI assistant and
   pastes this verbatim; it encodes the authoritative-field rule
   (engine_* over A-vs-B), the pattern-first workflow, the engine
   constraints, and the expected output shape, with the live pattern
   counts interpolated so the assistant knows the size of the job. */
function buildAiBundlePrompt(spec,summary){
  const topPatterns=(summary.patterns||[]).slice(0,3).map(p=>
    '  - '+p.forwarder+' · '+p.count+'× · '+p.suggested_action+
    (p.missing_phrase_keys.length?' · missing: '+p.missing_phrase_keys.join(', '):'')+
    (p.extra_phrase_keys.length?' · extra: '+p.extra_phrase_keys.join(', '):'')).join('\n');
  return [
'# Prompt — paste into your AI assistant together with this bundle\'s files',
'',
'> Attach `training.jsonl`, `rule_spec.json`, and `summary.json` (and `assets/anmerkung.js` if the assistant cannot read the repository), then paste everything below the line.',
'',
'---',
'',
'You are maintaining `assets/anmerkung.js` (engine v'+spec.engine_version+'), a deterministic, browser-side rule engine that fills the German "Anmerkung" column of forwarder invoice audits. I am giving you labeled training data from the engine\'s Diff Mode:',
'',
'- `summary.json` — failure patterns, pre-grouped by forwarder and by the phrase keys the CURRENT engine gets wrong vs ground truth. '+summary.pattern_count+' pattern(s) over '+summary.engine_actionable+' actionable row(s); '+summary.engine_solved+' row(s) the engine already solves. Top patterns:',
topPatterns||'  - (none)',
'- `training.jsonl` — one JSON record per row; join to patterns via `row_uid`.',
'- `rule_spec.json` — the PHRASES catalog, per-forwarder thresholds, processor/resolver symbols, and an English glossary for every `inputs.*` key.',
'',
'## Task',
'',
'Propose a minimal patch to `assets/anmerkung.js` that closes the failure patterns, largest `count` first.',
'',
'## Rules',
'',
'1. The `engine_*` fields are authoritative: `engine_missing_phrase_keys` = phrases ground truth wants that the engine fails to emit (ADD a branch or LOOSEN its gate); `engine_extra_phrase_keys` = phrases the engine emits that truth rejects (GUARD or TIGHTEN the branch). Ignore the plain `predicted`/`missing_*`/`extra_*` fields unless `engine_label` is blank — they compare a possibly-stale tool output, not the current engine.',
'2. Diagnose gates from `summary.json` first: each pattern\'s `shared_inputs` are the cell values identical on EVERY failing row (prime gate signals); `varying_inputs` differ across rows and must not become gate conditions. Pull the matching `training.jsonl` records by `example_row_uids` for the full picture.',
'3. Emit phrases only via the existing `PHRASES` catalog and `join()` helper (it dedupes case-insensitively). New wording goes into `PHRASES` first; keys prefixed `lit_`/`tpl_`/`?:` are explained in `rule_spec.json`.',
'4. Respect each forwarder\'s `hasErr(value, threshold)` numeric guard and gate (see `rule_spec.forwarders.<fw>`). Do not weaken a gate so far that it would fire on rows the engine currently gets right ('+summary.engine_solved+' solved rows are the regression set).',
'5. Keep edits inside the `process<Forwarder>` functions (resolvers are already wired) unless a pattern clearly needs a new resolver column.',
'',
'## Output format',
'',
'For each pattern you fix, in priority order:',
'1. **Diagnosis** — which branch/gate is wrong and why, citing the `shared_inputs` evidence.',
'2. **Patch** — the exact code change (unified diff or before/after snippet).',
'3. **Coverage** — the `row_uid`s this change fixes, and any solved rows it could plausibly affect.',
'',
'A fix is complete when re-running Train & Compare flips the row\'s `engine_matches_b` to `true` and empties its `engine_missing_phrase_keys` / `engine_extra_phrase_keys`.',
''].join('\n');
}

/* Build the README.md a downstream AI agent reads first. Hard-coded
   so the bundle is self-explanatory; the schema description echoes
   what's actually in rule_spec.json. */
function buildAiBundleReadme(spec,recordCount,filterScope){
  const lines=[];
  lines.push('# Anmerkung Rule-Update Bundle');
  lines.push('');
  lines.push('Engine version: **v'+spec.engine_version+'**  ');
  lines.push('Exported: '+spec.exported_at+'  ');
  lines.push('Records: **'+recordCount+'** training case(s)'+(filterScope?'  (filter: '+filterScope+')':''));
  lines.push('Source file: `'+spec.source_file+'`');
  lines.push('');
  lines.push('## Files in this bundle');
  lines.push('');
  lines.push('- `prompt.md` — ready-to-paste prompt. Attach the other files to your AI assistant and paste this; it encodes the whole workflow below.');
  lines.push('- `summary.json` — failure patterns, pre-grouped: every (forwarder × engine_missing/extra_phrase_keys) combination with its row count, label distribution, example `row_uid`s, and the input cells shared by every failing row (gate-signal candidates). Records are sorted deterministically (forwarder → source pair → sheet → row) so bundles diff cleanly across runs.');
  lines.push('- `training.jsonl` — one JSON record per line, one record per failing/correct row from Diff Mode.');
  lines.push('- `rule_spec.json` — the schema. Lists every PHRASES key, every threshold, every input field per forwarder, and the exact source-code symbol an AI should edit to update rules.');
  lines.push('- `README.md` — this file.');
  lines.push('');
  lines.push('## How an AI assistant should use this bundle');
  lines.push('');
  lines.push('### 0. Start with `summary.json`');
  lines.push('It already does workflow step 1 (grouping) for you: patterns are sorted by row count, each carries `suggested_action` (`add_or_loosen_branch` / `guard_or_tighten_branch` / `fix_both`), `shared_inputs` (cell values identical on every failing row — prime gate signals), `varying_inputs` (present everywhere but differing — must NOT become gate conditions), and `example_row_uids` to pull the full records from `training.jsonl`. Rows the engine already solves are counted in `engine_solved` and excluded from patterns — they are the regression set a fix must not break.');
  lines.push('');
  lines.push('### 1. Read `rule_spec.json`');
  lines.push('It tells you:');
  lines.push('- The exact source file (`assets/anmerkung.js`) and the four processor symbols to edit (`processDachser`, `processKN`, `processDHL`, `processWackler`).');
  lines.push('- The `PHRASES` catalog: every key you can emit and the German string it produces.');
  lines.push('- The threshold per forwarder for the `hasErr()` numeric guard.');
  lines.push('- The English glossary for every input field on every forwarder.');
  lines.push('- The exact label / granular_label taxonomy.');
  lines.push('');
  lines.push('### 2. Walk `training.jsonl`');
  lines.push('Each line is a JSON object with these fields (selected):');
  lines.push('');
  lines.push('| field | meaning |');
  lines.push('| --- | --- |');
  lines.push('| `forwarder` | one of `dachser` / `kn` / `dhl` / `wackler` |');
  lines.push('| `processor` | exact JS symbol to edit, e.g. `processWackler` |');
  lines.push('| `applicable_threshold` | the `hasErr()` tolerance for this forwarder |');
  lines.push('| `label` | `wrong` / `missed` / `overfired` / `correct` |');
  lines.push('| `granular_label` | `phrase_subset` / `phrase_superset` / `phrase_disjoint` / etc. |');
  lines.push('| `expected_phrase_keys` | PHRASES keys ground truth wants — use `rule_spec.phrases[key]` to see the German string |');
  lines.push('| `predicted_phrase_keys` | PHRASES keys the engine output |');
  lines.push('| `missing_phrase_keys` | in expected, NOT in predicted → engine UNDER-fired |');
  lines.push('| `extra_phrase_keys` | in predicted, NOT in expected → engine OVER-fired |');
  lines.push('| `engine_phrase_keys` | what `process<Forwarder>` would output today (drift detector) |');
  lines.push('| `engine_label` | how the CURRENT engine scores against ground truth B (`correct`/`wrong`/`missed`/`overfired`) — **the authoritative fix target** |');
  lines.push('| `engine_matches_b` | `true` once the current engine matches truth; the goal is to flip this to `true` |');
  lines.push('| `engine_missing_phrase_keys` | in truth, NOT in the current engine output → branch to **add / loosen** |');
  lines.push('| `engine_extra_phrase_keys` | in the current engine output, NOT in truth → branch to **guard / tighten** |');
  lines.push('| `engine_vs_expected_jaccard` | phrase-set similarity of current engine output vs truth (1.0 = solved) |');
  lines.push('| `inputs` | per-row map of cell values the rules read; keys explained in `rule_spec.forwarders.<fw>.input_glossary` |');
  lines.push('| `reason` | trigger trace (raw cell values that fired branches) |');
  lines.push('| `row_uid` | stable hash for joining across runs |');
  lines.push('| `source_file` | which predicted/expected file pair this row came from (set when exported from Bulk Diff; blank for a single-pair run) |');
  lines.push('');
  lines.push('> **Use the `engine_*` fields, not the plain `predicted`/`missing`/`extra` fields, to drive rule edits.** The plain fields compare slot A (your tool output, which may be stale or from another tool) against truth B; the `engine_*` fields compare what `process<Forwarder>` emits *today* against truth B. When `label == "correct"` but `engine_label != "correct"`, the tool was right but the current engine regressed on that row — fix it.');
  lines.push('');
  lines.push('Synthetic key prefixes:');
  lines.push('- `lit_*` — phrase string is hard-coded inside a processor (not yet in `PHRASES`). Promote it to `PHRASES` if you need to fire it from a new branch.');
  lines.push('- `tpl_*` — dynamic phrase that interpolates runtime values (see `rule_spec.phrase_templates`).');
  lines.push('- `?:<raw>` — phrase did not resolve. Add it to `PHRASES` or `PHRASE_LITERALS` first.');
  lines.push('');
  lines.push('### 3. Apply the rule-update workflow');
  lines.push('');
  for(const step of (spec.instructions.rule_update_workflow||[])){
    lines.push('- '+step);
  }
  lines.push('');
  lines.push('### 4. Common patterns');
  lines.push('');
  lines.push('**`missed`** — engine should have emitted a phrase but didn\'t.');
  lines.push('- Find the existing branch in `process<Forwarder>` that emits the `missing_phrase_keys[i]` (search for `P.<key>` or the literal phrase).');
  lines.push('- Diagnose why the gate didn\'t match: compare the failing row\'s `inputs` against the gate condition.');
  lines.push('- Loosen the gate or add a parallel branch using `inputs` as new gating signals.');
  lines.push('');
  lines.push('**`overfired`** — engine emitted a phrase that shouldn\'t appear.');
  lines.push('- Find the branch that emits the `extra_phrase_keys[i]`.');
  lines.push('- Add a guard using `inputs` so the branch no longer matches the row\'s signature.');
  lines.push('- Be careful not to break `correct` rows for the same forwarder — re-run Diff Mode to verify.');
  lines.push('');
  lines.push('**`wrong`** — both missed AND extra keys present.');
  lines.push('- Treat the missing and extra sets independently. Often a single branch picked the wrong phrase: change the phrase emitted, not the gate.');
  lines.push('');
  lines.push('### 5. Verify');
  lines.push('Re-run Diff Mode → Train & Compare. Each fixed row\'s `engine_matches_b` flips to `true`, its `engine_missing_phrase_keys` / `engine_extra_phrase_keys` empty out, and the `engine drift` overlay clears. Watch the chip counts move from `wrong`/`missed`/`overfired` toward `correct`.');
  return lines.join('\n')+'\n';
}

async function downloadAiBundle(){
  if(!diffState.results){showLog('AI Bundle \u2014 run Train & Compare first.','err');return;}
  if(typeof JSZip==='undefined'){showLog('AI Bundle \u2014 JSZip not loaded yet, retry in a moment.','err');return;}
  const{records}=buildTrainingSet();
  if(!records.length){showLog('AI Bundle \u2014 no training rows in current filter scope.','err');return;}
  const spec=buildRuleSpec();
  const filterScope=(diffFilter.label!=='all'||diffFilter.fw!=='all'||diffFilter.sheet!=='all'||(diffFilter.q&&diffFilter.q.trim()))
    ?[diffFilter.label!=='all'?'label='+diffFilter.label:'',
      diffFilter.fw!=='all'?'fw='+diffFilter.fw:'',
      diffFilter.sheet!=='all'?'sheet='+diffFilter.sheet:'',
      diffFilter.q?'search='+diffFilter.q:''].filter(Boolean).join(', ')
    :'';
  const jsonl=records.map(r=>JSON.stringify(r)).join('\n')+'\n';
  /* summary.json: pure aggregation + provenance stamps the tests don't
     need to see (kept out of buildTrainingSummary so it stays pure). */
  const summary=buildTrainingSummary(records);
  summary.engine_version=spec.engine_version;
  summary.exported_at=spec.exported_at;
  summary.filter_scope=filterScope||'';
  const readme=buildAiBundleReadme(spec,records.length,filterScope);
  const prompt=buildAiBundlePrompt(spec,summary);
  const zip=new JSZip();
  zip.file('README.md',readme);
  zip.file('prompt.md',prompt);
  zip.file('summary.json',JSON.stringify(summary,null,2)+'\n');
  zip.file('training.jsonl',jsonl);
  zip.file('rule_spec.json',JSON.stringify(spec,null,2)+'\n');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='anmerkung_ai_bundle_'+stamp+'.zip';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showLog('AI Bundle exported \u2014 '+records.length+' record(s) \u00b7 '+summary.pattern_count+
    ' failure pattern(s) ('+summary.engine_actionable+' actionable, '+summary.engine_solved+' already solved)'+
    ' \u00b7 training.jsonl + summary.json + rule_spec.json + prompt.md + README.md'+
    (filterScope?' (filter: '+filterScope+')':'')+'.','ok');
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
