(function(){
const cv=document.getElementById('bg'),cx=cv.getContext('2d');
let W,H,t=0,pts=[],runeChars=[];
const PAL=[[91,156,246],[167,139,250],[52,211,153],[244,114,182],[212,175,100]];
let mouse={x:-9999,y:-9999};
function resize(){W=cv.width=window.innerWidth;H=cv.height=window.innerHeight}
function mkpt(){const c=PAL[Math.floor(Math.random()*PAL.length)];return{x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.2,vy:(Math.random()-.5)*.15,r:Math.random()*2+.5,a:Math.random()*.4+.05,da:(Math.random()*.0008+.0003)*(Math.random()<.5?1:-1),c,ph:Math.random()*Math.PI*2}}
const RUNES='\u16A0\u16A2\u16A6\u16A8\u16B1\u16B2\u16B7\u16B9\u16BA\u16BE\u16C1\u16C3\u16C7\u16C8\u16C9\u16CA\u16CF\u16D2\u16D6\u16D7\u16DA\u16DC\u16DE\u16DF\u263D\u263F\u2644\u2295\u2297\u2726';
function mkRune(){return{ch:RUNES[Math.floor(Math.random()*RUNES.length)],x:Math.random()*W,y:Math.random()*H,vy:-(Math.random()*.3+.1),a:Math.random()*.12+.02,size:Math.floor(Math.random()*8)+10,c:PAL[Math.floor(Math.random()*PAL.length)],life:1}}
function init(){resize();pts=Array.from({length:Math.min(Math.floor(W*H/9000),120)},mkpt);for(let i=0;i<30;i++)runeChars.push(mkRune())}
let last=0;
function frame(ts){
  const dt=Math.min((ts-last)/16.67,2.5);last=ts;t+=.003*dt;
  cx.clearRect(0,0,W,H);
  [{x:W*.1,y:H*-.1,rx:W*.55,ry:H*.4,c:[244,114,182],a:.025},{x:W*.82,y:H*-.1,rx:W*.5,ry:H*.35,c:[167,139,250],a:.022},{x:W*.5,y:H*1.1,rx:W*.6,ry:H*.4,c:[52,211,153],a:.016},{x:W*.05,y:H*.5,rx:W*.3,ry:H*.4,c:[212,175,100],a:.013}].forEach(a=>{
    const p=a.a+.008*Math.sin(t*1.4+a.x*.004);
    const g=cx.createRadialGradient(a.x,a.y,0,a.x,a.y,Math.hypot(a.rx,a.ry)*.62);
    g.addColorStop(0,`rgba(${a.c},${p})`);g.addColorStop(.5,`rgba(${a.c},${p*.25})`);g.addColorStop(1,'transparent');
    cx.save();cx.translate(a.x,a.y);cx.scale(a.rx/a.ry,1);cx.translate(-a.x,-a.y);cx.fillStyle=g;cx.beginPath();cx.arc(a.x,a.y,a.ry,0,Math.PI*2);cx.fill();cx.restore();
  });
  runeChars.forEach(r=>{r.y+=r.vy*dt;r.life-=.0004*dt;if(r.y<-40||r.life<=0)Object.assign(r,mkRune(),{y:H+20});cx.font=`${r.size}px 'Cinzel',serif`;cx.fillStyle=`rgba(${r.c},${r.a*r.life})`;cx.fillText(r.ch,r.x,r.y)});
  for(let i=0;i<pts.length;i++){const p=pts[i];for(let j=i+1;j<pts.length;j++){const q=pts[j];const dx=p.x-q.x,dy=p.y-q.y;if(Math.abs(dx)<120&&Math.abs(dy)<120){const dSq=dx*dx+dy*dy;if(dSq<14400){const d=Math.sqrt(dSq);cx.strokeStyle=`rgba(${p.c},${(1-d/120)*.05})`;cx.lineWidth=.4;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(q.x,q.y);cx.stroke()}}}const mdx=p.x-mouse.x,mdy=p.y-mouse.y;if(Math.abs(mdx)<160&&Math.abs(mdy)<160){const mdSq=mdx*mdx+mdy*mdy;if(mdSq<25600){const md=Math.sqrt(mdSq);cx.strokeStyle=`rgba(${p.c},${(1-md/160)*.24})`;cx.lineWidth=.7;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(mouse.x,mouse.y);cx.stroke()}}}
  pts.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.a+=p.da*dt;if(p.a<.04||p.a>.5)p.da*=-1;if(p.x<-20)p.x=W+20;if(p.x>W+20)p.x=-20;if(p.y<-20)p.y=H+20;if(p.y>H+20)p.y=-20;const rdx=p.x-mouse.x,rdy=p.y-mouse.y;if(Math.abs(rdx)<110&&Math.abs(rdy)<110){const rdSq=rdx*rdx+rdy*rdy;if(rdSq<12100&&rdSq>0){const rd=Math.sqrt(rdSq);const f=(1-rd/110)*.5;p.vx+=(rdx/rd)*f*.04;p.vy+=(rdy/rd)*f*.04}}const spSq=p.vx*p.vx+p.vy*p.vy;if(spSq>.25){const sp=Math.sqrt(spSq);p.vx*=.5/sp;p.vy*=.5/sp}const bx=.5*Math.sin(t*1.1+p.ph),by=.5*Math.cos(t*.88+p.ph*1.3);if(p.r>1.7){cx.beginPath();cx.arc(p.x+bx,p.y+by,p.r*3.5,0,Math.PI*2);cx.fillStyle=`rgba(${p.c},${p.a*.08})`;cx.fill()}cx.beginPath();cx.arc(p.x+bx,p.y+by,p.r,0,Math.PI*2);cx.fillStyle=`rgba(${p.c},${p.a})`;cx.fill()});
  if (!document.hidden && !(window.Grimoire && window.Grimoire.reducedMotion)) requestAnimationFrame(frame);
}
window.addEventListener('resize',init);
window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
window.addEventListener('touchmove',e=>{const tt=e.touches[0];mouse.x=tt.clientX;mouse.y=tt.clientY},{passive:true});
window.addEventListener('mouseleave',()=>{mouse.x=-9999;mouse.y=-9999});
init();
if (window.Grimoire && window.Grimoire.reducedMotion) { frame(0); }
else { requestAnimationFrame(frame); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) requestAnimationFrame(frame); }); }
})();

Grimoire.Theme.init({
  defaultMode:'dark', mode:'light', className:'light',
  iconEl:'#theme-icon', labelEl:'#theme-label',
  icons:{light:'\u2600',dark:'\u263D'},
  labels:{light:'Light',dark:'Dark'},
  onChange:function(m){document.body.style.color=m==='light'?'rgba(20,12,36,.9)':'#ede8ff';}
});

if(!firebase.apps.length)firebase.initializeApp(window.firebaseConfig);
const db=firebase.firestore(),col=db.collection('wmf_tasks');
const fwdCol=db.collection('wmf_forwarders');
const scribeCol=db.collection('wmf_scribes');
const DEFAULT_FWDS=['Dachser','K+N','DHL Express','Wackler','Honold','ERKA'];
const LS_KEY='wmf_todo_state_v1';

let tasks=[],saving=false,curView='forwarder',openGroups=new Set(),selectedScribe=null,pendingToggleId=null,searchQuery='',pendingEditId=null,customFwds=[],customScribes=[];

/* â”€â”€ LOCAL STATE PERSISTENCE â”€â”€ */
function saveState(){
  try{
    localStorage.setItem(LS_KEY,JSON.stringify({
      curView,
      openGroups:Array.from(openGroups),
      selectedScribe,
      searchQuery
    }));
  }catch(e){/* ignore */}
}
function loadState(){
  try{
    const raw=localStorage.getItem(LS_KEY);if(!raw)return;
    const s=JSON.parse(raw);
    if(s.curView&&['forwarder','scribes','chronicle'].includes(s.curView))curView=s.curView;
    if(Array.isArray(s.openGroups))openGroups=new Set(s.openGroups);
    if(typeof s.selectedScribe==='string'||s.selectedScribe===null)selectedScribe=s.selectedScribe;
    if(typeof s.searchQuery==='string'){
      searchQuery=s.searchQuery;
      const inp=document.getElementById('search-input');
      if(inp){inp.value=searchQuery;document.getElementById('search-clear').classList.toggle('visible',searchQuery.trim().length>0);}
    }
  }catch(e){/* ignore */}
}

/* â”€â”€ FORWARDERS (default + custom) â”€â”€ */
function getAllForwarders(){
  const fromTasks=[...new Set(tasks.map(t=>t.fwd).filter(Boolean))];
  const merged=[...DEFAULT_FWDS];
  [...customFwds,...fromTasks].forEach(f=>{if(!merged.includes(f))merged.push(f);});
  return merged;
}
function populateForwarderSelect(selectEl,selectedVal){
  if(!selectEl)return;
  const cur=selectedVal!==undefined?selectedVal:selectEl.value;
  const all=getAllForwarders();
  selectEl.innerHTML='<option value="">\u2014 select \u2014</option>'+
    all.map(f=>`<option${f===cur?' selected':''}>${esc(f)}</option>`).join('')+
    '<option value="__new__">\u2795 Add new forwarder...</option>';
  if(cur&&!all.includes(cur)&&cur!=='__new__'){
    // insert a one-off option so the current value stays visible
    const o=document.createElement('option');o.value=cur;o.textContent=cur;o.selected=true;
    selectEl.insertBefore(o,selectEl.options[1]);
  }
}
function loadForwarders(){
  fwdCol.orderBy('name').onSnapshot(snap=>{
    customFwds=snap.docs.map(d=>d.data().name).filter(n=>n&&!DEFAULT_FWDS.includes(n));
    populateForwarderSelect(document.getElementById('inp-fwd'));
  },err=>{console.warn('Forwarder list unavailable:',err);});
}

/* â”€â”€ SCRIBES (persons who complete tasks) â”€â”€ */
function getAllScribes(){
  const fromTasks=[...new Set(tasks.map(t=>(t.completedBy||'').trim()).filter(Boolean))];
  const merged=[];
  [...customScribes,...fromTasks].forEach(n=>{if(!merged.some(x=>x.toLowerCase()===n.toLowerCase()))merged.push(n);});
  return merged.sort((a,b)=>a.localeCompare(b));
}
function populateScribeSelect(selectEl,selectedVal){
  if(!selectEl)return;
  const cur=selectedVal!==undefined?selectedVal:selectEl.value;
  const all=getAllScribes();
  selectEl.innerHTML='<option value="">\u2014 select \u2014</option>'+
    all.map(n=>`<option${n===cur?' selected':''}>${esc(n)}</option>`).join('')+
    '<option value="__new__">\u2795 Add new scribe...</option>';
  if(cur&&!all.includes(cur)&&cur!=='__new__'){
    const o=document.createElement('option');o.value=cur;o.textContent=cur;o.selected=true;
    selectEl.insertBefore(o,selectEl.options[1]);
  }
}
function onScribeChange(){
  const sel=document.getElementById('modal-scribe-select');
  const wrap=document.getElementById('new-scribe-wrap');
  if(sel.value==='__new__'){
    wrap.classList.add('open');
    sel.value='';
    setTimeout(()=>document.getElementById('modal-new-scribe').focus(),50);
  }
}
async function saveNewScribe(){
  const input=document.getElementById('modal-new-scribe');
  const name=input.value.trim();
  if(!name){shake(input);return;}
  const existing=getAllScribes().some(n=>n.toLowerCase()===name.toLowerCase());
  if(existing){
    // already on the list â€” just select it
    populateScribeSelect(document.getElementById('modal-scribe-select'),name);
    input.value='';
    document.getElementById('new-scribe-wrap').classList.remove('open');
    showToast(`"${name}" selected.`);
    return;
  }
  try{
    await scribeCol.add({name,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    if(!customScribes.includes(name))customScribes.push(name);
    populateScribeSelect(document.getElementById('modal-scribe-select'),name);
    input.value='';
    document.getElementById('new-scribe-wrap').classList.remove('open');
    showToast(`"${name}" added to the scribes.`);
  }catch(e){showToast('Could not save scribe.',true);console.error(e);}
}
function cancelNewScribe(){
  document.getElementById('modal-new-scribe').value='';
  document.getElementById('new-scribe-wrap').classList.remove('open');
}
function loadScribes(){
  scribeCol.orderBy('name').onSnapshot(snap=>{
    customScribes=snap.docs.map(d=>d.data().name).filter(Boolean);
    // refresh the modal dropdown if it's open
    const sel=document.getElementById('modal-scribe-select');
    if(sel&&document.getElementById('complete-modal').classList.contains('open')){
      populateScribeSelect(sel,sel.value);
    }
  },err=>{console.warn('Scribe list unavailable:',err);});
}

function setView(v){
  curView=v;
  document.getElementById('btn-view-fwd').classList.toggle('active',v==='forwarder');
  document.getElementById('btn-view-scribes').classList.toggle('active',v==='scribes');
  document.getElementById('btn-view-scribes').classList.toggle('scribe-active',v==='scribes');
  document.getElementById('btn-view-chronicle').classList.toggle('active',v==='chronicle');
  document.getElementById('btn-view-chronicle').classList.toggle('chronicle-active',v==='chronicle');
  // Show forwarder toolbar only on forwarder view
  document.getElementById('fwd-toolbar').style.display=v==='forwarder'?'flex':'none';
  document.getElementById('fwd-view').style.display=v==='forwarder'?'flex':'none';
  document.getElementById('scribes-view').style.display=v==='scribes'?'flex':'none';
  document.getElementById('chronicle-view').style.display=v==='chronicle'?'block':'none';
  // Hide search on chronicle view (it doesn't filter charts)
  document.getElementById('search-wrap').style.display=v==='chronicle'?'none':'block';
  saveState();
  render();
}
function setStatus(s,l){document.getElementById('status-dot').className='status-dot '+(s||'');document.getElementById('status-label').textContent=l;}

/* â”€â”€ SEARCH â”€â”€ */
function onSearch(){
  searchQuery=document.getElementById('search-input').value;
  const hasTerm=searchQuery.trim().length>0;
  document.getElementById('search-clear').classList.toggle('visible',hasTerm);
  if(hasTerm&&curView==='forwarder'){
    // Auto-expand all groups that have matches
    const q=searchQuery.trim().toLowerCase();
    tasks.forEach(t=>{if(taskMatchesSearch(t,q))openGroups.add(t.fwd);});
  }
  saveState();
  render();
}
function clearSearch(){
  document.getElementById('search-input').value='';
  searchQuery='';
  document.getElementById('search-clear').classList.remove('visible');
  document.getElementById('search-count').textContent='';
  saveState();
  render();
}
function taskMatchesSearch(t,q){
  if(!q)return true;
  return [t.title,t.notes,t.fwd,t.total,t.completedBy].some(f=>f&&String(f).toLowerCase().includes(q));
}
/* Wrap matched text in a highlight span, safely escaping HTML first */
function highlight(raw,q){
  const safe=esc(raw||'');
  if(!q)return safe;
  const qi=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return safe.replace(new RegExp(qi,'gi'),m=>`<span class="srch-hl">${m}</span>`);
}
function startListener(){setStatus('','Connecting to ether...');col.orderBy('createdAt','desc').onSnapshot(snap=>{tasks=snap.docs.map(d=>({id:d.id,...d.data()}));setStatus('online','Online \u00b7 Live sync');render();},err=>{setStatus('error','Connection failed');showToast('Could not reach the ether.',true);console.error(err);});}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showToast(msg,isError){const t=document.getElementById('toast');t.textContent=msg;t.className=isError?'error show':'show';clearTimeout(t._timer);t._timer=setTimeout(()=>{t.className='';},2600);}
function shake(el){el.style.borderColor='rgba(244,114,182,.6)';setTimeout(()=>{el.style.borderColor='';},600);}
function initials(n){if(!n)return'?';return n.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function fmtDate(ts,opts){if(!ts)return null;const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleDateString('en-GB',opts||{day:'2-digit',month:'short',year:'numeric'});}
function fmtDateShort(ts){return fmtDate(ts,{day:'2-digit',month:'short',year:'numeric'});}
function tsToMonthKey(ts){if(!ts)return null;const d=ts.toDate?ts.toDate():new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function monthKeyToLabel(k){const[y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});}

/* â”€â”€ DUE DATE HELPERS â”€â”€ */
function tsToDate(ts){if(!ts)return null;return ts.toDate?ts.toDate():new Date(ts);}
function dueInfo(task){
  if(!task.dueAt||task.status==='done')return null;
  const due=tsToDate(task.dueAt);if(!due||isNaN(due))return null;
  const today=new Date();today.setHours(0,0,0,0);
  const dd=new Date(due.getFullYear(),due.getMonth(),due.getDate());
  const diffDays=Math.round((dd-today)/86400000);
  let state='future',label='';
  if(diffDays<0){state='overdue';label=`Overdue by ${-diffDays} day${-diffDays!==1?'s':''}`;}
  else if(diffDays===0){state='soon';label='Due today';}
  else if(diffDays===1){state='soon';label='Due tomorrow';}
  else if(diffDays<=3){state='soon';label=`Due in ${diffDays} days`;}
  else{state='future';label=`Due ${dd.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`;}
  return{state,label,diffDays,date:dd};
}
function isOverdue(task){const i=dueInfo(task);return!!i&&i.state==='overdue';}
function dateInputValue(ts){
  const d=tsToDate(ts);if(!d||isNaN(d))return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseDateInput(s){
  if(!s)return null;
  const[y,m,d]=s.split('-').map(Number);if(!y||!m||!d)return null;
  return new Date(y,m-1,d,12,0,0); // noon to avoid TZ edge
}

/* â”€â”€ PROGRESS BAR GRADIENT (red \u2192 amber \u2192 green) â”€â”€ */
function progressGradient(pct){
  // 0% red \u2192 50% amber \u2192 100% green
  let a,b;
  if(pct<50){
    // red \u2192 amber
    const k=pct/50;
    a=`rgba(${Math.round(248-(248-251)*k)},${Math.round(113+(191-113)*k)},${Math.round(113-(113-36)*k)},.75)`;
    b=`rgba(${Math.round(248-(248-251)*k)},${Math.round(113+(191-113)*k)},${Math.round(113-(113-36)*k)},.95)`;
  }else{
    // amber \u2192 green
    const k=(pct-50)/50;
    a=`rgba(${Math.round(251-(251-52)*k)},${Math.round(191+(211-191)*k)},${Math.round(36+(153-36)*k)},.75)`;
    b=`rgba(${Math.round(251-(251-52)*k)},${Math.round(191+(211-191)*k)},${Math.round(36+(153-36)*k)},.95)`;
  }
  return`linear-gradient(90deg,${a},${b})`;
}

async function addTask(){
  if(saving)return;
  const title=document.getElementById('inp-title').value.trim();
  const fwd=document.getElementById('inp-fwd').value;
  const total=document.getElementById('inp-total').value.trim();
  const notes=document.getElementById('inp-notes').value.trim();
  const dueStr=document.getElementById('inp-due').value;
  if(!title){shake(document.getElementById('inp-title'));showToast('Please enter a task title.',true);return;}
  if(!fwd||fwd==='__new__'){shake(document.getElementById('inp-fwd'));showToast('Please select a forwarder.',true);return;}
  saving=true;const btn=document.getElementById('btn-inscribe');btn.disabled=true;btn.querySelector('span:last-child').textContent='Sealing...';
  try{
    const payload={title,fwd,total,notes,status:'pending',completedBy:'',createdAt:firebase.firestore.FieldValue.serverTimestamp()};
    const dueDate=parseDateInput(dueStr);
    if(dueDate)payload.dueAt=firebase.firestore.Timestamp.fromDate(dueDate);
    await col.add(payload);
    document.getElementById('inp-title').value='';document.getElementById('inp-fwd').value='';document.getElementById('inp-total').value='';document.getElementById('inp-notes').value='';document.getElementById('inp-due').value='';
    showToast('Task inscribed into the ledger!');
    if(curView==='forwarder'){openGroups.add(fwd);saveState();}
  }catch(e){showToast('Failed to inscribe.',true);console.error(e);}
  finally{saving=false;btn.disabled=false;btn.querySelector('span:last-child').textContent='Inscribe Task';}
}

/* â”€â”€ COMPLETE MODAL â”€â”€ */
function openCompleteModal(id){
  const task=tasks.find(x=>x.id===id);if(!task)return;
  pendingToggleId=id;
  document.getElementById('modal-task-name').textContent=task.title;
  populateScribeSelect(document.getElementById('modal-scribe-select'),'');
  document.getElementById('new-scribe-wrap').classList.remove('open');
  document.getElementById('modal-new-scribe').value='';
  document.getElementById('complete-modal').classList.add('open');
  setTimeout(()=>document.getElementById('modal-scribe-select').focus(),300);
}
function closeModal(){document.getElementById('complete-modal').classList.remove('open');pendingToggleId=null;}
async function confirmDone(){if(!pendingToggleId)return;const id=pendingToggleId;const sel=document.getElementById('modal-scribe-select');const name=(sel&&sel.value&&sel.value!=='__new__')?sel.value.trim():'';closeModal();await applyDone(id,name);}
async function confirmDoneAnonymous(){if(!pendingToggleId)return;const id=pendingToggleId;closeModal();await applyDone(id,'');}
async function applyDone(id,scribeName){
  try{
    await col.doc(id).update({status:'done',completedBy:scribeName||'',completedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    showToast(scribeName?`Sealed by ${scribeName}!`:'Task marked done.');
  }catch(e){showToast('Could not update task.',true);console.error(e);}
}

/**
 * toggleDone: only works for PENDING tasks â€” opens the scribe modal.
 * Done tasks have their checkbox disabled, so this is a safeguard only.
 */
function toggleDone(id,evt){
  if(evt){evt.preventDefault();evt.stopPropagation();}
  const task=tasks.find(x=>x.id===id);if(!task)return;
  // Guard: done tasks cannot be toggled via checkbox (checkbox is disabled)
  if(task.status==='done')return;
  openCompleteModal(id);
}

async function deleteTask(id){
  if(!confirm('Banish this task from the ledger? This cannot be undone.'))return;
  try{await col.doc(id).delete();showToast('Task dissolved.');}
  catch(e){showToast('Delete failed.',true);console.error(e);}
}

/* â”€â”€ CUSTOM FORWARDERS â”€â”€ */
function onFwdChange(){
  const sel=document.getElementById('inp-fwd');
  const wrap=document.getElementById('new-fwd-wrap');
  if(sel.value==='__new__'){
    wrap.classList.add('open');
    sel.value='';
    setTimeout(()=>document.getElementById('inp-new-fwd').focus(),50);
  }
}
async function saveNewForwarder(){
  const input=document.getElementById('inp-new-fwd');
  const name=input.value.trim();
  if(!name){shake(input);return;}
  const existing=getAllForwarders().some(f=>f.toLowerCase()===name.toLowerCase());
  if(existing){showToast('That forwarder already exists.',true);return;}
  try{
    await fwdCol.add({name,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    // Immediately include & select it (snapshot listener will follow)
    if(!customFwds.includes(name))customFwds.push(name);
    populateForwarderSelect(document.getElementById('inp-fwd'),name);
    input.value='';
    document.getElementById('new-fwd-wrap').classList.remove('open');
    showToast(`"${name}" added to the roster.`);
  }catch(e){showToast('Could not save forwarder.',true);console.error(e);}
}
function cancelNewForwarder(){
  document.getElementById('inp-new-fwd').value='';
  document.getElementById('new-fwd-wrap').classList.remove('open');
}

/* â”€â”€ EDIT MODAL â”€â”€ */
function openEditModal(id){
  const t=tasks.find(x=>x.id===id);if(!t)return;
  pendingEditId=id;
  document.getElementById('edit-modal-task-name').textContent=t.title;
  document.getElementById('edit-title').value=t.title||'';
  document.getElementById('edit-total').value=t.total||'';
  document.getElementById('edit-notes').value=t.notes||'';
  document.getElementById('edit-due').value=dateInputValue(t.dueAt);
  populateForwarderSelect(document.getElementById('edit-fwd'),t.fwd||'');
  // Remove the "Add new forwarder..." sentinel â€” we keep edit modal simpler
  const sel=document.getElementById('edit-fwd');
  const addOpt=Array.from(sel.options).find(o=>o.value==='__new__');
  if(addOpt)sel.removeChild(addOpt);
  document.getElementById('edit-modal').classList.add('open');
  setTimeout(()=>document.getElementById('edit-title').focus(),250);
}
function closeEditModal(){document.getElementById('edit-modal').classList.remove('open');pendingEditId=null;}
async function confirmEdit(){
  if(!pendingEditId)return;
  const id=pendingEditId;
  const title=document.getElementById('edit-title').value.trim();
  const fwd=document.getElementById('edit-fwd').value;
  const total=document.getElementById('edit-total').value.trim();
  const notes=document.getElementById('edit-notes').value.trim();
  const dueStr=document.getElementById('edit-due').value;
  if(!title){shake(document.getElementById('edit-title'));return;}
  if(!fwd){shake(document.getElementById('edit-fwd'));return;}
  const update={title,fwd,total,notes,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
  const dueDate=parseDateInput(dueStr);
  if(dueDate)update.dueAt=firebase.firestore.Timestamp.fromDate(dueDate);
  else update.dueAt=firebase.firestore.FieldValue.delete();
  closeEditModal();
  try{await col.doc(id).update(update);showToast('Inscription amended.');}
  catch(e){showToast('Could not save changes.',true);console.error(e);}
}

/* â”€â”€ UNSEAL (reopen a done task) â”€â”€ */
async function unsealTask(id){
  const t=tasks.find(x=>x.id===id);if(!t)return;
  if(t.status!=='done')return;
  if(!confirm(`Unseal "${t.title}"? It will return to Pending.`))return;
  try{
    await col.doc(id).update({
      status:'pending',
      unsealedAt:firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Task unsealed \u00b7 back to pending.');
  }catch(e){showToast('Could not unseal.',true);console.error(e);}
}

/* â”€â”€ DELETE BY MONTH â”€â”€ */
function openDelMonthModal(){
  const monthSet=new Set();
  tasks.forEach(t=>{const k=tsToMonthKey(t.createdAt);if(k)monthSet.add(k);});
  const months=Array.from(monthSet).sort().reverse();
  const sel=document.getElementById('del-month-select');
  sel.innerHTML='<option value="">\u2014 choose a month \u2014</option>';
  months.forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent=monthKeyToLabel(k);sel.appendChild(o);});
  document.getElementById('del-month-preview').textContent='Select a month to preview affected tasks...';
  document.getElementById('btn-del-month-confirm').disabled=true;
  document.getElementById('del-month-modal').classList.add('open');
}
function closeDelMonthModal(){document.getElementById('del-month-modal').classList.remove('open');}
function updateDelPreview(){
  const k=document.getElementById('del-month-select').value;
  const btn=document.getElementById('btn-del-month-confirm');
  const pre=document.getElementById('del-month-preview');
  if(!k){pre.textContent='Select a month to preview affected tasks...';btn.disabled=true;return;}
  const affected=tasks.filter(t=>tsToMonthKey(t.createdAt)===k);
  const pending=affected.filter(t=>t.status==='pending').length;
  const done=affected.filter(t=>t.status==='done').length;
  if(affected.length===0){pre.textContent='No tasks found for this month.';btn.disabled=true;}
  else{pre.innerHTML=`<strong style="color:rgba(248,113,113,.98)">${affected.length} task${affected.length!==1?'s':''}</strong> will be dissolved from <strong>${monthKeyToLabel(k)}</strong><br>${pending} pending \u00b7 ${done} done`;btn.disabled=false;}
}
async function execDelByMonth(){
  const k=document.getElementById('del-month-select').value;if(!k)return;
  const affected=tasks.filter(t=>tsToMonthKey(t.createdAt)===k);
  if(affected.length===0)return;
  const label=monthKeyToLabel(k);
  if(!confirm(`Permanently dissolve all ${affected.length} task(s) from ${label}? This cannot be undone.`))return;
  closeDelMonthModal();
  let count=0;
  for(let i=0;i<affected.length;i+=500){
    const batch=db.batch();
    affected.slice(i,i+500).forEach(t=>batch.delete(col.doc(t.id)));
    try{await batch.commit();count+=Math.min(500,affected.length-i);}
    catch(e){showToast(`Batch delete error: ${e.message}`,true);console.error(e);return;}
  }
  showToast(`${count} task${count!==1?'s':''} from ${label} dissolved.`);
}

function toggleGroup(n){if(openGroups.has(n))openGroups.delete(n);else openGroups.add(n);saveState();render();}
function selectScribe(n){selectedScribe=selectedScribe===n?null:n;saveState();render();}

function taskCardHTML(t,i,hideForwarderBadge,showCompletedDate){
  const dateStr=fmtDateShort(t.createdAt)||'\u2014';
  const isDone=t.status==='done';
  const q=searchQuery.trim().toLowerCase();
  const due=dueInfo(t);
  const overdueCls=due&&due.state==='overdue'?' is-overdue':'';
  const doneByStr=t.completedBy
    ?`<div class="task-done-by">\u2295 Sealed by <strong style="color:rgba(52,211,153,.72)">${highlight(t.completedBy,q)}</strong>${(showCompletedDate&&t.completedAt)?` \u00b7 ${fmtDateShort(t.completedAt)}`:''}</div>`
    :(isDone
      ?`<div class="task-done-by" style="color:rgba(212,175,100,.35)">\u2295 Sealed anonymously${(showCompletedDate&&t.completedAt)?` \u00b7 ${fmtDateShort(t.completedAt)}`:''}</div>`
      :'');
  const checkAttrs=isDone
    ? 'checked disabled title="Task is sealed \u2014 use Unseal to reopen"'
    : `onchange="toggleDone('${t.id}',event)"`;
  const dueBadge=due
    ? `<span class="badge badge-due ${due.state}" title="${esc(due.date.toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}))}">&#9201; ${esc(due.label)}</span>`
    : '';
  // Show plain "Due on <date>" for sealed tasks that had a due date
  const dueStaticStr=(isDone&&t.dueAt)
    ? `<div class="task-date" style="opacity:.7">Due was ${esc(fmtDateShort(t.dueAt))}</div>`
    : '';
  const editBtn=`<button class="btn-edit" onclick="openEditModal('${t.id}')" title="Amend inscription">&#9998;</button>`;
  const unsealBtn=isDone?`<button class="btn-unseal" onclick="unsealTask('${t.id}')" title="Unseal \u00b7 reopen task">&#8634;</button>`:'';
  return `<div class="task-card${isDone?' is-done':''}${overdueCls}" style="animation:task-in .3s ${i*.04}s ease both">
    <div class="task-check-wrap"><input type="checkbox" class="task-check" ${checkAttrs} /></div>
    <div class="task-body">
      <div class="task-title">${highlight(t.title,q)}</div>
      <div class="task-meta">
        ${!hideForwarderBadge?`<span class="badge badge-fwd">${highlight(t.fwd,q)}</span>`:''}
        <span class="badge badge-${t.status}">${t.status}</span>
        ${dueBadge}
        ${t.completedBy?`<span class="badge badge-scribe">\u2295 ${highlight(t.completedBy,q)}</span>`:''}
        ${t.total?`<span class="task-data">\u2B21 ${highlight(t.total,q)}</span>`:''}
      </div>
      ${t.notes?`<div class="task-notes">${highlight(t.notes,q)}</div>`:''}
      ${doneByStr}
      <div class="task-date">Inscribed ${dateStr}</div>
      ${dueStaticStr}
    </div>
    <div class="task-actions">${editBtn}${unsealBtn}<button class="btn-del" onclick="deleteTask('${t.id}')" title="Banish task">\u2715</button></div>
  </div>`;
}

function render(){
  const pending=tasks.filter(t=>t.status==='pending').length;
  const done=tasks.filter(t=>t.status==='done').length;
  const overdue=tasks.filter(t=>isOverdue(t)).length;
  const fwds=new Set(tasks.map(t=>t.fwd).filter(Boolean)).size;
  document.getElementById('st-total').textContent=tasks.length;
  document.getElementById('st-pending').textContent=pending;
  document.getElementById('st-overdue').textContent=overdue;
  document.getElementById('st-done').textContent=done;
  document.getElementById('st-fwds').textContent=fwds;
  if(curView==='forwarder')renderForwarderView();
  else if(curView==='scribes')renderScribesView();
  else if(curView==='chronicle')renderChronicleView();
}

function renderForwarderView(){
  const container=document.getElementById('fwd-view');
  const q=searchQuery.trim().toLowerCase();
  const allFwds=getAllForwarders();
  const activeFwds=allFwds.filter(f=>tasks.some(t=>t.fwd===f));

  // Apply search filter
  const matchedTasks=q?tasks.filter(t=>taskMatchesSearch(t,q)):tasks;
  const matchCount=matchedTasks.length;
  const cntEl=document.getElementById('search-count');
  if(q){cntEl.textContent=`${matchCount} result${matchCount!==1?'s':''}`;} else{cntEl.textContent='';}

  const activeFwdsFiltered=activeFwds.filter(f=>q?matchedTasks.some(t=>t.fwd===f):true);
  if(activeFwdsFiltered.length===0){
    container.innerHTML=`<div class="empty-state"><div class="empty-rune">\u16DF</div><div class="empty-text">${tasks.length===0?'The ledger is empty':q?'No tasks match your search':'No tasks found'}</div><div class="empty-sub">${tasks.length===0?'Inscribe your first task above':q?'Try different search terms':'...'}</div></div>`;
    return;
  }
  container.innerHTML=activeFwdsFiltered.map((fwdName,gi)=>{
    const fwdTasks=(q?matchedTasks:tasks).filter(t=>t.fwd===fwdName);
    const allFwdTasks=tasks.filter(t=>t.fwd===fwdName);
    const fwdPending=fwdTasks.filter(t=>t.status==='pending').length;
    const fwdDone=fwdTasks.filter(t=>t.status==='done').length;
    const fwdOverdue=fwdTasks.filter(t=>isOverdue(t)).length;
    const fwdTotal=fwdTasks.length;
    const totalForPct=allFwdTasks.length;
    const pct=totalForPct>0?Math.round((allFwdTasks.filter(t=>t.status==='done').length/totalForPct)*100):0;
    const isOpen=openGroups.has(fwdName)||!!q;
    const tasksHTML=fwdTasks.length>0?fwdTasks.map((t,i)=>taskCardHTML(t,i,true,false)).join(''):`<div class="fwd-group-empty">No tasks for this forwarder</div>`;
    const grad=progressGradient(pct);
    return `<div class="fwd-group" style="animation-delay:${gi*.06}s">
      <div class="fwd-group-header${isOpen?' open':''}" onclick="toggleGroup('${esc(fwdName)}')">
        <span class="fwd-group-icon">\u25B6</span>
        <span class="fwd-group-name">${highlight(fwdName,q)}</span>
        <div class="fwd-group-pills">
          <span class="fwd-pill fwd-pill-total">${fwdTotal} task${fwdTotal!==1?'s':''}</span>
          ${fwdPending>0?`<span class="fwd-pill fwd-pill-pending">${fwdPending} pending</span>`:''}
          ${fwdOverdue>0?`<span class="fwd-pill" style="color:rgba(248,113,113,.98);border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.09)">${fwdOverdue} overdue</span>`:''}
          ${fwdDone>0?`<span class="fwd-pill fwd-pill-done">${fwdDone} done</span>`:''}
        </div>
        <div class="fwd-progress-wrap">
          <div class="fwd-progress-bar"><div class="fwd-progress-fill" style="width:${pct}%;background:${grad}"></div></div>
          <span class="fwd-progress-pct" style="color:${pct<50?'rgba(248,113,113,.85)':pct<75?'rgba(251,191,36,.9)':'rgba(52,211,153,.85)'}">${pct}%</span>
        </div>
      </div>
      <div class="fwd-group-body${isOpen?' open':''}">${tasksHTML}</div>
    </div>`;
  }).join('');
}

function renderScribesView(){
  const container=document.getElementById('scribes-view');
  const q=searchQuery.trim().toLowerCase();
  const doneTasks=tasks.filter(t=>t.status==='done'&&(q?taskMatchesSearch(t,q):true));

  // Update search count display
  const allDone=tasks.filter(t=>t.status==='done');
  const cntEl=document.getElementById('search-count');
  if(q){const m=tasks.filter(t=>taskMatchesSearch(t,q)).length;cntEl.textContent=`${m} result${m!==1?'s':''}`;}
  else{cntEl.textContent='';}

  const scribeMap={};
  doneTasks.forEach(t=>{const n=(t.completedBy||'').trim()||'(Anonymous)';if(!scribeMap[n])scribeMap[n]=[];scribeMap[n].push(t);});
  const scribeNames=Object.keys(scribeMap).sort((a,b)=>scribeMap[b].length-scribeMap[a].length);
  if(scribeNames.length===0){
    container.innerHTML=`<div class="empty-state"><div class="empty-rune">\u2295</div><div class="empty-text">${allDone.length===0?'No tasks sealed yet':q?'No matches found':''}</div><div class="empty-sub">${allDone.length===0?'When tasks are marked done, scribes will appear here':q?'Try different search terms':''}</div></div>`;
    return;
  }
  const maxDone=Math.max(...scribeNames.map(n=>scribeMap[n].length));
  function latestCompletion(ts){let l=null;ts.forEach(t=>{if(!t.completedAt)return;const d=t.completedAt.toDate?t.completedAt.toDate():new Date(t.completedAt);if(!l||d>l)l=d;});return l;}
  const cardsHTML=`<div class="scribes-section">
    <div class="scribes-header"><div class="scribes-title">Hall of Scribes \u2014 completions by person</div><div class="scribes-line"></div></div>
    <div class="scribe-cards">
      ${scribeNames.map((name,i)=>{
        const ts=scribeMap[name];const cnt=ts.length;
        const fwdSet=new Set(ts.map(t=>t.fwd).filter(Boolean));
        const pct=Math.round((cnt/maxDone)*100);const sel=selectedScribe===name;
        const latest=latestCompletion(ts);
        const latestStr=latest?latest.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):null;
        return `<div class="scribe-card${sel?' selected':''}" onclick="selectScribe('${esc(name)}')" style="animation:task-in .35s ${i*.05}s ease both">
          <div class="scribe-avatar">${initials(name)}</div>
          <div class="scribe-name">${highlight(name,q)}</div>
          <div class="scribe-stats">
            <span class="scribe-stat-pill scribe-done-pill">\u2713 ${cnt} task${cnt!==1?'s':''}</span>
            ${fwdSet.size>0?`<span class="scribe-stat-pill scribe-fwd-pill">${fwdSet.size} fwd${fwdSet.size!==1?'s':''}</span>`:''}
          </div>
          <div class="scribe-bar-wrap"><div class="scribe-bar-fill" style="width:${pct}%"></div></div>
          <div class="scribe-bar-label">${pct}% of top scribe</div>
          ${latestStr?`<div class="scribe-latest"><span class="scribe-latest-icon">\u2295</span>Last sealed ${latestStr}</div>`:''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
  let detailHTML='';
  if(selectedScribe&&scribeMap[selectedScribe]){
    const scribeTasks=scribeMap[selectedScribe];
    const byFwd={};scribeTasks.forEach(t=>{const f=t.fwd||'Unknown';if(!byFwd[f])byFwd[f]=[];byFwd[f].push(t);});
    const fwdSections=Object.entries(byFwd).map(([fn,ts])=>`<div style="margin-bottom:.9rem"><div style="font-family:var(--cinzel);font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:rgba(244,114,182,.6);margin-bottom:.5rem;padding-left:.3rem">${esc(fn)}</div>${ts.map((t,i)=>taskCardHTML(t,i,true,true)).join('')}</div>`).join('');
    detailHTML=`<div class="scribe-detail-header">
      <div class="scribe-avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0">${initials(selectedScribe)}</div>
      <div class="scribe-detail-name">${esc(selectedScribe)}</div>
      <div class="scribe-detail-count">${scribeTasks.length} task${scribeTasks.length!==1?'s':''} sealed</div>
      <button class="btn-close-detail" onclick="selectScribe('${esc(selectedScribe)}')">\u2715 Close</button>
    </div>
    <div class="scribe-detail-tasks">${fwdSections}</div>`;
  }
  container.innerHTML=cardsHTML+`<div class="scribe-detail" style="display:${selectedScribe?'block':'none'}">${detailHTML}</div>`;
}

/* â”€â”€ CHRONICLE VIEW â”€â”€ */
function renderChronicleView(){
  const container=document.getElementById('chronicle-view');
  const doneTasks=tasks.filter(t=>t.status==='done'&&t.completedAt);
  if(tasks.length===0){
    container.innerHTML=`<div class="empty-state"><div class="empty-rune">\u2726</div><div class="empty-text">The chronicle is empty</div><div class="empty-sub">Inscribe and seal tasks to reveal patterns</div></div>`;
    return;
  }

  // Header metrics
  const totalSealed=doneTasks.length;
  const avgSealMs=(()=>{
    const samples=doneTasks.map(t=>{
      const c=tsToDate(t.createdAt),d=tsToDate(t.completedAt);
      return(c&&d)?(d-c):null;
    }).filter(x=>x!=null&&x>=0);
    if(!samples.length)return null;
    return samples.reduce((a,b)=>a+b,0)/samples.length;
  })();
  const avgSealStr=avgSealMs==null?'\u2014':(()=>{
    const h=avgSealMs/3600000;
    if(h<24)return `${h.toFixed(1)}h`;
    return `${(h/24).toFixed(1)}d`;
  })();
  const overdueCnt=tasks.filter(t=>isOverdue(t)).length;

  const header=`<div class="chronicle-card">
    <div class="chronicle-title">\u2726 The Chronicle \u2014 Patterns in the Ledger</div>
    <div class="chronicle-sub">Aggregate insights from every inscribed and sealed task</div>
    <div class="chronicle-stats-row">
      <div class="chronicle-metric"><div class="chronicle-metric-num">${totalSealed}</div><div class="chronicle-metric-lbl">Total sealed</div></div>
      <div class="chronicle-metric"><div class="chronicle-metric-num">${avgSealStr}</div><div class="chronicle-metric-lbl">Avg time-to-seal</div></div>
      <div class="chronicle-metric"><div class="chronicle-metric-num" style="color:${overdueCnt>0?'rgba(248,113,113,.98)':'inherit'}">${overdueCnt}</div><div class="chronicle-metric-lbl">Currently overdue</div></div>
    </div>
  </div>`;

  // Chart 1: Weekly completions (line chart, last 12 weeks)
  const weekly=buildWeeklyCompletions(doneTasks,12);
  const chart1=renderWeeklyChart(weekly);

  // Chart 2: Avg time-to-seal per forwarder (bar chart)
  const fwdStats=buildFwdAvgStats(doneTasks);
  const chart2=renderFwdAvgChart(fwdStats);

  // Chart 3: Month-over-month leaderboard
  const leaderboard=buildLeaderboard(doneTasks);
  const chart3=renderLeaderboard(leaderboard);

  container.innerHTML=header+chart1+chart2+chart3;
}

function buildWeeklyCompletions(doneTasks,weeks){
  const now=new Date();
  // Monday-based week
  const dow=(now.getDay()+6)%7; // 0=Mon
  const mondayThisWeek=new Date(now.getFullYear(),now.getMonth(),now.getDate()-dow);
  const buckets=[];
  for(let i=weeks-1;i>=0;i--){
    const start=new Date(mondayThisWeek);start.setDate(start.getDate()-i*7);
    const end=new Date(start);end.setDate(end.getDate()+7);
    buckets.push({start,end,count:0});
  }
  doneTasks.forEach(t=>{
    const d=tsToDate(t.completedAt);if(!d)return;
    buckets.forEach(b=>{if(d>=b.start&&d<b.end)b.count++;});
  });
  return buckets;
}

function renderWeeklyChart(buckets){
  if(!buckets.length){
    return `<div class="chronicle-card"><div class="chronicle-title">Weekly Completions</div><div class="chronicle-empty">No sealed tasks yet</div></div>`;
  }
  const W=680,H=200,padL=36,padR=14,padT=18,padB=30;
  const innerW=W-padL-padR,innerH=H-padT-padB;
  const maxVal=Math.max(1,...buckets.map(b=>b.count));
  const stepX=buckets.length>1?innerW/(buckets.length-1):0;
  const pts=buckets.map((b,i)=>{
    const x=padL+i*stepX;
    const y=padT+innerH-(b.count/maxVal)*innerH;
    return{x,y,b};
  });
  const linePath='M '+pts.map(p=>`${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  const areaPath=linePath+` L ${(padL+innerW).toFixed(1)} ${(padT+innerH).toFixed(1)} L ${padL.toFixed(1)} ${(padT+innerH).toFixed(1)} Z`;
  // y-axis ticks (0, mid, max)
  const yTicks=[0,Math.round(maxVal/2),maxVal];
  const yTickLines=yTicks.map(v=>{
    const y=padT+innerH-(v/maxVal)*innerH;
    return`<line class="chron-grid" x1="${padL}" x2="${padL+innerW}" y1="${y}" y2="${y}"/><text class="chron-axis-label" x="${padL-6}" y="${y+3}" text-anchor="end">${v}</text>`;
  }).join('');
  // x-axis labels â€” show every other week
  const xLabels=pts.map((p,i)=>{
    if(i%2!==buckets.length%2&&buckets.length>6)return'';
    const lbl=p.b.start.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    return`<text class="chron-axis-label" x="${p.x}" y="${padT+innerH+18}" text-anchor="middle">${lbl}</text>`;
  }).join('');
  const dots=pts.map(p=>`<circle class="chron-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2"><title>${p.b.start.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} \u2013 ${p.b.count} sealed</title></circle>`).join('');
  return `<div class="chronicle-card">
    <div class="chronicle-title">\u29EB Weekly Completions</div>
    <div class="chronicle-sub">Tasks sealed per week \u00b7 last ${buckets.length} weeks</div>
    <svg class="chronicle-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="chron-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(244,114,182,.55)"/>
        <stop offset="100%" stop-color="rgba(244,114,182,0)"/>
      </linearGradient></defs>
      ${yTickLines}
      <line class="chron-axis" x1="${padL}" x2="${padL}" y1="${padT}" y2="${padT+innerH}"/>
      <line class="chron-axis" x1="${padL}" x2="${padL+innerW}" y1="${padT+innerH}" y2="${padT+innerH}"/>
      <path class="chron-area" d="${areaPath}"/>
      <path class="chron-line" d="${linePath}"/>
      ${dots}
      ${xLabels}
    </svg>
  </div>`;
}

function buildFwdAvgStats(doneTasks){
  const map={};
  doneTasks.forEach(t=>{
    const c=tsToDate(t.createdAt),d=tsToDate(t.completedAt);
    if(!c||!d)return;
    const ms=d-c;if(ms<0)return;
    const f=t.fwd||'(Unknown)';
    if(!map[f])map[f]={sum:0,n:0};
    map[f].sum+=ms;map[f].n++;
  });
  return Object.entries(map).map(([fwd,v])=>({fwd,avgMs:v.sum/v.n,count:v.n})).sort((a,b)=>a.avgMs-b.avgMs);
}

function renderFwdAvgChart(stats){
  if(!stats.length){
    return `<div class="chronicle-card"><div class="chronicle-title">Average Seal Time by Forwarder</div><div class="chronicle-empty">Not enough sealed tasks to compute averages</div></div>`;
  }
  const W=680,H=Math.max(140,40+stats.length*34),padL=110,padR=80,padT=10,padB=10;
  const innerW=W-padL-padR;
  const maxMs=Math.max(...stats.map(s=>s.avgMs));
  const fmt=ms=>{const h=ms/3600000;return h<24?`${h.toFixed(1)}h`:`${(h/24).toFixed(1)}d`;};
  const rows=stats.map((s,i)=>{
    const y=padT+i*34+6;
    const w=Math.max(2,(s.avgMs/maxMs)*innerW);
    return`<text class="chron-bar-label" x="${padL-8}" y="${y+16}" text-anchor="end">${esc(s.fwd)}</text>
<rect class="chron-bar" x="${padL}" y="${y+4}" width="${w.toFixed(1)}" height="20" rx="4"><title>${s.count} sealed \u00b7 avg ${fmt(s.avgMs)}</title></rect>
<text class="chron-bar-value" x="${padL+w+8}" y="${y+18}">${fmt(s.avgMs)}</text>`;
  }).join('');
  return `<div class="chronicle-card">
    <div class="chronicle-title">\u29B8 Average Seal Time by Forwarder</div>
    <div class="chronicle-sub">Mean time from inscription to seal \u00b7 lower is faster</div>
    <svg class="chronicle-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${rows}</svg>
  </div>`;
}

function buildLeaderboard(doneTasks){
  // Current month vs previous month counts per scribe
  const now=new Date();
  const curKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prevDate=new Date(now.getFullYear(),now.getMonth()-1,1);
  const prevKey=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
  const cur={},prev={};
  doneTasks.forEach(t=>{
    const d=tsToDate(t.completedAt);if(!d)return;
    const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const name=(t.completedBy||'').trim()||'(Anonymous)';
    if(k===curKey)cur[name]=(cur[name]||0)+1;
    else if(k===prevKey)prev[name]=(prev[name]||0)+1;
  });
  const allNames=new Set([...Object.keys(cur),...Object.keys(prev)]);
  const rows=Array.from(allNames).map(name=>({
    name,
    cur:cur[name]||0,
    prev:prev[name]||0,
    delta:(cur[name]||0)-(prev[name]||0)
  }));
  rows.sort((a,b)=>b.cur-a.cur||b.delta-a.delta);
  return{rows,curKey,prevKey};
}

function renderLeaderboard({rows,curKey,prevKey}){
  if(!rows.length){
    return `<div class="chronicle-card"><div class="chronicle-title">Month-over-Month Leaderboard</div><div class="chronicle-empty">No sealed tasks this month or last</div></div>`;
  }
  const curLbl=monthKeyToLabel(curKey);
  const prevLbl=monthKeyToLabel(prevKey);
  const body=rows.map((r,i)=>{
    const dCls=r.delta>0?'delta-up':r.delta<0?'delta-down':'delta-same';
    const dStr=r.delta>0?`\u25B2 +${r.delta}`:r.delta<0?`\u25BC ${r.delta}`:'\u2014';
    return `<div class="chron-leader-row">
      <div class="chron-leader-rank${i<3?' top':''}">${i+1}</div>
      <div class="chron-leader-name">${esc(r.name)}</div>
      <div class="chron-leader-count">${r.prev} prev</div>
      <div class="chron-leader-count" style="color:rgba(244,114,182,.85)">${r.cur} this</div>
      <div class="chron-leader-delta ${dCls}">${dStr}</div>
    </div>`;
  }).join('');
  return `<div class="chronicle-card">
    <div class="chronicle-title">\u265B Month-over-Month Leaderboard</div>
    <div class="chronicle-sub">${esc(prevLbl)} \u2192 ${esc(curLbl)} \u00b7 tasks sealed per scribe</div>
    ${body}
  </div>`;
}

document.getElementById('modal-scribe-select').addEventListener('keydown',e=>{if(e.key==='Enter')confirmDone();if(e.key==='Escape')closeModal();});
document.getElementById('modal-new-scribe').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveNewScribe();}if(e.key==='Escape')cancelNewScribe();});
document.getElementById('search-input').addEventListener('keydown',e=>{if(e.key==='Escape')clearSearch();});
document.getElementById('complete-modal').addEventListener('click',e=>{if(e.target===document.getElementById('complete-modal'))closeModal();});
document.getElementById('edit-modal').addEventListener('click',e=>{if(e.target===document.getElementById('edit-modal'))closeEditModal();});
document.getElementById('edit-title').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey)confirmEdit();if(e.key==='Escape')closeEditModal();});
document.getElementById('inp-new-fwd').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveNewForwarder();}if(e.key==='Escape')cancelNewForwarder();});
document.getElementById('del-month-modal').addEventListener('click',e=>{if(e.target===document.getElementById('del-month-modal'))closeDelMonthModal();});
document.getElementById('inp-title').addEventListener('keydown',e=>{if(e.key==='Enter')addTask();});

// Initialize â€” restore saved view state, then kick off Firestore sync
loadState();
populateForwarderSelect(document.getElementById('inp-fwd'));
setView(curView);
startListener();
loadForwarders();
loadScribes();
