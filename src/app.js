(function(){
'use strict';
const C=CounterCore,$=id=>document.getElementById(id),own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key),reduced=matchMedia('(prefers-reduced-motion: reduce)'),calm=()=>reduced.matches||lite;
let profiles=Object.create(null),current='default',state,history=[],undoStates=[],storageOK=true,sound=false,audio=null,dialogResolve=null,itemSelected=null,lastGoal=false,lite=false,effectsPref='auto',skipAutoFinish=null,paceOn=true,lastPaceAt=Date.now()-25*60000,lastPaceCheck=0,chartHour='',reportDays=7;
const HISTORY=120,fmt1=x=>x===null?'—':x.toFixed(1).replace('.',',');
function read(key,fallback){try{const text=localStorage.getItem(key);return text===null?fallback:JSON.parse(text);}catch{return fallback;}}
function write(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}}
function toast(message,ms=2400){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),ms);}
function icon(name){return '<svg class="icon" aria-hidden="true"><use href="#i-'+name+'"/></svg>';}
function spring(el){if(calm()||!el.animate)return;el.getAnimations().forEach(a=>a.cancel());el.animate([{transform:'scale(.88)',offset:0},{transform:'scale(1.055)',offset:.45},{transform:'scale(.99)',offset:.7},{transform:'scale(1)',offset:1}],{duration:340,easing:'cubic-bezier(.2,0,0,1)'});}
function setText(id,value,animate=false){const el=$(id),text=String(value);if(el.textContent!==text){el.textContent=text;if(animate)spring(el);}}
function showDialog(id){const el=$(id);el.showModal();if(calm())return;el.animate([{opacity:0,transform:'translateY(24px) scale(.92)'},{opacity:1,transform:'none'}],{duration:400,easing:'cubic-bezier(.05,.7,.1,1)'});el.animate([{opacity:0},{opacity:1}],{duration:200,pseudoElement:'::backdrop'});}
function ask(title,message,options={}){
  if(dialogResolve)return Promise.resolve(null);
  $('dialogTitle').textContent=title;$('dialogMessage').textContent=message;
  const input=$('dialogInput');input.hidden=!options.input;input.type=options.type||'text';input.value=options.value==null?'':options.value;input.required=!!options.input;
  input.maxLength=options.type==='number'?10:80;if(options.type==='number'){input.min='0';input.max='1000000000';input.step='1';}else{input.removeAttribute('min');input.removeAttribute('max');input.removeAttribute('step');}
  $('resetOption').hidden=!options.reset;$('resetShift').checked=false;$('dialogConfirm').textContent=options.confirm||(options.input?'Сохранить':'Подтвердить');
  showDialog('actionDialog');if(options.input){input.focus();input.select();}
  return new Promise(resolve=>{dialogResolve={resolve,options};});
}
function settleDialog(confirmed){if(!dialogResolve)return;const {resolve,options}=dialogResolve;dialogResolve=null;const value=!confirmed?null:options.input?$('dialogInput').value.trim():options.reset?{resetShift:$('resetShift').checked}:true;$('actionDialog').close();resolve(value);}
$('actionForm').addEventListener('submit',e=>{e.preventDefault();if($('actionForm').reportValidity())settleDialog(true);});$('dialogCancel').onclick=()=>settleDialog(false);$('actionDialog').addEventListener('cancel',e=>{e.preventDefault();settleDialog(false);});
document.querySelectorAll('dialog').forEach(el=>el.addEventListener('click',e=>{if(e.target!==el)return;const r=el.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){if(el.id==='actionDialog')settleDialog(false);else el.close();}}));
function save(){
  const meta=profiles[current];meta.itemOrder=[...state.itemOrder];meta.items=[];meta.history=C.clone(history);
  storageOK=write('commStatsData_'+current,JSON.stringify({...state,totalCount:C.total(state)}))&&write('commProfiles',JSON.stringify(profiles))&&write('commLastProfile',current);
  $('saveStatus').lastElementChild.textContent=storageOK?'Сохранено на этом компьютере':'Не удалось сохранить данные';
  if(!storageOK&&!save.warned){toast('Не удалось сохранить. Сохрани резервную копию в настройках.',6500);save.warned=true;}return storageOK;
}
// Цель своя у каждого профиля, по умолчанию 140.
function goal(){const g=Number(profiles[current]&&profiles[current].goal);return Number.isSafeInteger(g)&&g>=1&&g<=100000?g:140;}
function shiftHours(){const h=Number(profiles[current]&&profiles[current].shiftHours);return [4,8,12].includes(h)?h:8;}
function plural(n,one,few,many){const a=n%10,b=n%100;return a===1&&b!==11?one:a>=2&&a<=4&&(b<12||b>14)?few:many;}
function active(){return state.status==='Идёт'||state.status==='Пауза';}
// Завершённые смены плюс текущая, если она идёт.
function entries(){const list=history.map(h=>C.shiftEntry(h)).filter(Boolean);if(active()){const e=C.shiftEntry({date:new Date().toISOString(),total:C.total(state),comm:state.commCount,duration:C.duration(state),counts:state.counts,state},true);if(e)list.push(e);}return list;}
function bests(){const r=C.records(history.map(h=>C.shiftEntry(h)).filter(Boolean),goal()),key=C.hourKey(Date.now());let hour=r.bestHour;for(const k of Object.keys(state.hours))if(k!==key)hour=Math.max(hour,state.hours[k]);return {shift:r.bestShift,hour};}
function newRecord(message){toast(message,4500);if(calm())return;for(const el of [$('recordsCard'),document.querySelector('.overview')])el.animate([{boxShadow:'0 0 0 0 #ff2400cc'},{boxShadow:'0 0 0 8px #ff240000,0 0 34px 6px #ff240099',offset:.5},{boxShadow:'0 0 0 0 #ff240000'}],{duration:900,iterations:2,easing:'cubic-bezier(.2,0,0,1)'});}
function snapshot(){return C.clone({state,history});}
function record(){undoStates.push(snapshot());if(undoStates.length>50)undoStates.shift();save();render();}
// Прирост звонков записывается в текущий час; замена состояния целиком (загрузка смены, полный сброс) в график не идёт.
function change(fn){
  const before=state,was=C.total(state),key=C.hourKey(Date.now()),hourWas=state.hours[key]||0,base=active()?bests():null;
  fn();const now=C.total(state),same=state===before;if(same&&now!==was)C.track(state,now-was);record();beep();
  if(!base||!same||!active())return;const hourNow=state.hours[key]||0;
  if(base.shift>0&&was<=base.shift&&now>base.shift)newRecord('Новый рекорд смены: '+now+'!');else if(base.hour>0&&hourWas<=base.hour&&hourNow>base.hour)newRecord('Новый рекорд часа: '+hourNow+'!');
}
function undo(){if(undoStates.length<2){toast('Нечего отменять');return;}undoStates.pop();const previous=C.clone(undoStates[undoStates.length-1]);state=previous.state;history=previous.history;const end=C.scheduledEnd(state);skipAutoFinish=end!==null&&Date.now()>=end?end:null;save();render();beep();toast('Действие отменено');}
// Категории до 2.4 были исходами звонка: «Звонки» = их сумма, «Успешно» сохраняется. Свои категории не трогаем.
function toCalls(s){if(!s.itemOrder.length||!s.itemOrder.every(n=>C.legacyDefaults.includes(n)))return s;const calls=Math.min(1e9,s.itemOrder.reduce((n,k)=>n+C.number(s.counts[k]),0));return C.normalize({...s,counts:{Звонки:calls,Успешно:s.itemOrder.includes('Успешно')?C.number(s.counts['Успешно']):0}},C.defaults);}
function validName(name){return !!name&&name.length<=80;}
function profileKey(name){return name==='Основной'?'default':name;}
function switchProfile(name){
  current=name;const meta=profiles[name];const order=Array.isArray(meta.itemOrder)?[...meta.itemOrder]:[...C.defaults];for(const n of Array.isArray(meta.items)?meta.items:[])if(!order.includes(n))order.push(n);
  state=C.normalize(read('commStatsData_'+name,{}),order);history=Array.isArray(meta.history)?C.clone(meta.history).filter(h=>h&&typeof h==='object'&&h.counts&&typeof h.counts==='object').slice(-HISTORY):[];
  undoStates=[snapshot()];lastGoal=C.total(state)>=goal();renderProfiles();render();save();
}
function renderProfiles(){const select=$('profileSelect');select.replaceChildren();for(const name of Object.keys(profiles)){const option=document.createElement('option');option.value=name;option.textContent=name==='default'?'Основной':name;select.appendChild(option);}select.value=current;}
function applyTheme(theme){document.documentElement.dataset.theme=theme;const dark=theme==='dark';$('themeToggle').innerHTML=icon(dark?'sun':'moon');$('themeToggle').setAttribute('aria-label',dark?'Включить светлую тему':'Включить тёмную тему');write('commStatsTheme',theme);if(window.chrome?.webview)window.chrome.webview.postMessage({type:'theme',dark});}
function renderItems(){
  const container=$('itemsContainer');const rows=[...container.children];const same=rows.length===state.itemOrder.length&&rows.every((r,i)=>r.dataset.name===state.itemOrder[i]);
  if(!same){const before=new Set(rows.map(r=>r.dataset.name));container.replaceChildren();for(const name of state.itemOrder){
    const row=document.createElement('div');row.className=rows.length&&!before.has(name)?'item-row enter':'item-row';row.dataset.name=name;row.draggable=true;
    const handle=document.createElement('span');handle.className='drag-handle';handle.innerHTML=icon('drag');handle.title='Перетащить категорию';row.appendChild(handle);
    const label=document.createElement('span');label.className='item-name';label.textContent=name;row.appendChild(label);
    const controls=document.createElement('div');controls.className='item-controls';
    const minus=document.createElement('button');minus.className='counter-button';minus.textContent='−';minus.dataset.action='minus';minus.setAttribute('aria-label','Уменьшить '+name);
    const value=document.createElement('span');value.className='item-count';value.textContent=state.counts[name];
    const plus=document.createElement('button');plus.className='counter-button plus';plus.textContent='+';plus.dataset.action='plus';plus.setAttribute('aria-label','Добавить '+name);
    const menu=document.createElement('button');menu.className='item-menu';menu.innerHTML=icon('more');menu.dataset.action='menu';menu.setAttribute('aria-label','Настроить '+name);
    controls.append(minus,value,plus,menu);row.appendChild(controls);container.appendChild(row);
  }}else for(const row of rows){const value=row.querySelector('.item-count'),next=String(state.counts[row.dataset.name]);if(value.textContent!==next){value.textContent=next;spring(value);}}
  for(const row of container.children){row.querySelector('[data-action=minus]').disabled=state.counts[row.dataset.name]===0;row.querySelector('[data-action=plus]').disabled=state.counts[row.dataset.name]>=1e9;}
}
function reportText(){const end=state.shiftEnd||(state.endTime?C.fmtTime(new Date(state.endTime)):''),range=state.shiftStart?state.shiftStart+(end?'–'+end:''):'________';return 'Всего коммуникаций: '+C.total(state)+'\nВремя смены: '+range+'\n\n'+state.itemOrder.map(n=>n+': '+state.counts[n]).join('\n')+'\n\nКоммуникации: '+state.commCount;}
function updateTimer(){
  const dur=C.duration(state),active=state.status==='Идёт'||state.status==='Пауза';setText('shiftTimerValue',C.fmtDuration(dur));const length=shiftHours()*3600000;setText('shiftRemainingValue',dur>=length?'Сверхурочно':'Осталось '+C.fmtDuration(length-dur));
  setText('shiftStatusText',state.status);$('shiftStatus').dataset.state=state.status;$('startShiftBtn').disabled=active;$('pauseShiftBtn').disabled=!active;$('endShiftBtn').disabled=!active;
  const paused=state.status==='Пауза'?'1':'0';if($('pauseShiftBtn').dataset.paused!==paused){$('pauseShiftBtn').dataset.paused=paused;$('pauseShiftBtn').innerHTML=icon(paused==='1'?'play':'pause')+'<span>'+(paused==='1'?'Продолжить':'Пауза')+'</span>';}
  const rate=dur>=60000?C.total(state)/(dur/3600000):null;setText('rateValue',rate===null?'—':rate.toFixed(1));setText('miniRate',(rate===null?'—':rate.toFixed(1))+' в час');
  // Прогноз к концу смены и сколько нужно в час, чтобы успеть к цели.
  const g=goal(),f=C.forecast(state,g,Date.now(),shiftHours());let text='',behind=false;
  if(f){if(f.early)text='Прогноз появится после 15 минут работы';else if(f.total>=g)text='Цель выполнена. К концу смены будет около '+f.projected;else if(f.left<60000)text='Время смены по расписанию закончилось';else{text='При таком темпе к концу смены: '+f.projected+' из '+g;if(f.need)text+='. Нужно '+f.need+' в час'+(f.need>f.rate?', это на '+Math.ceil(f.need-f.rate)+' больше текущего':'');behind=f.projected<g;}}
  setText('miniForecast',!f||f.early?'':f.total>=g?'Цель выполнена':'К концу смены: '+f.projected+' из '+g+(f.need?' · нужно '+f.need+' в час':''));$('miniForecast').dataset.behind=behind?'1':'0';$('effForecast').hidden=!text;setText('effForecast',text);$('effForecast').dataset.behind=behind?'1':'0';
  setText('slowHoursEl',!f?'Таймер не учитывает паузы':f.early?'Темп появится после 15 минут работы':f.total>=g?'Цель выполнена':f.behind>0?'Отстаёшь от графика цели на '+f.behind:'Идёшь в графике цели');
  if(C.hourKey(Date.now())!==chartHour)renderHours();
}
function render(){
  const total=C.total(state);setText('totalComm',total,true);setText('commCount',state.commCount,true);setText('effSuccess',total?Math.round(Math.min(state.counts['Успешно']||0,total)/total*1000)/10+'%':'0%');
  const g=goal();setText('effProgressLabel','Цель · '+total+' / '+g);const progress=Math.min(total/g*100,100);setText('effPercent',Math.round(progress)+'%');$('effProgressFill').style.width=progress+'%';$('goalProgress').setAttribute('aria-valuemax',g);$('goalProgress').setAttribute('aria-valuenow',Math.min(total,g));setText('effTarget',total>=g?'Цель выполнена. Отличная работа!':'Осталось '+(g-total)+' '+plural(g-total,'звонок','звонка','звонков'));setText('goalBtn','Цель смены: '+g);setText('miniTotal',total,mini);setText('miniGoal','/ '+g);$('miniFill').style.width=progress+'%';setText('miniSuccessCount',state.itemOrder.includes('Успешно')?state.counts['Успешно']:'—');setText('miniCommCount',state.commCount);setText('miniSuccess','успешно '+$('effSuccess').textContent);for(const b of document.querySelectorAll('[data-hours]'))b.setAttribute('aria-pressed',Number(b.dataset.hours)===shiftHours());
  $('commMinus').disabled=state.commCount===0;$('commPlus').disabled=state.commCount>=1e9;$('undoBtn').disabled=undoStates.length<2;
  for(const [id,value] of [['shiftStart',state.shiftStart],['shiftEnd',state.shiftEnd]])if(document.activeElement!==$(id))$(id).value=value;
  renderItems();renderHours();renderRecords();updateTimer();setText('statsView',reportText());if(total>=g&&!lastGoal)celebrate();lastGoal=total>=g;
}
// График по часам: последние 12 часов, текущий час алый, пунктир — сколько нужно в час для цели.
function renderHours(){
  chartHour=C.hourKey(Date.now());const per=C.hourlyGoal(state,goal(),shiftHours()),keys=new Set(Object.keys(state.hours)),chart=$('hoursChart');
  if(state.startTime){const end=state.endTime?new Date(state.endTime).getTime():Date.now();for(let t=new Date(C.hourKey(state.startTime)).getTime();t<=end&&keys.size<100;t+=3600000)keys.add(C.hourKey(t));}
  setText('hoursLegend','нужно '+fmt1(per).replace(',0','')+' в час');
  const list=[...keys].sort().slice(-12);if(!list.length){if(!chart.querySelector('.chart-empty')){const empty=document.createElement('div');empty.className='chart-empty';empty.textContent='График появится после первых звонков';chart.replaceChildren(empty);}return;}
  const max=Math.max(per,...list.map(k=>state.hours[k]||0))*1.18,plot=document.createElement('div'),labels=document.createElement('div'),line=document.createElement('div');
  plot.className='hours-plot';labels.className='hours-labels';line.className='goal-line';line.style.bottom=per/max*100+'%';plot.appendChild(line);
  plot.setAttribute('role','img');plot.setAttribute('aria-label','Звонки по часам: '+list.map(k=>C.fmtTime(new Date(k))+' — '+(state.hours[k]||0)).join(', '));
  for(const k of list){const n=state.hours[k]||0,bar=document.createElement('div'),value=document.createElement('span'),label=document.createElement('span');bar.className='bar'+(k===chartHour&&state.status==='Идёт'?' now':n>=per?' met':'');bar.style.height=n/max*100+'%';value.textContent=n||'';bar.appendChild(value);plot.appendChild(bar);label.textContent=String(new Date(k).getHours()).padStart(2,'0');labels.appendChild(label);}
  chart.replaceChildren(plot,labels);
}
function renderRecords(){const r=C.records(entries(),goal());setText('recordShift',r.bestShift||'—');setText('recordHour',r.bestHour||'—');setText('recordStreak',r.streak);setText('recordStreakLabel',plural(r.streak,'день','дня','дней')+' с целью подряд');}
// Мягкое напоминание раз в 30 минут, если отстаёшь от графика цели; свёрнутое окно мигает на панели задач.
function checkPace(){const g=goal(),f=C.forecast(state,g,Date.now(),shiftHours());if(!paceOn||state.status!=='Идёт'||!f||f.early||f.total>=g||f.left<600000||C.duration(state)<1800000||f.behind<3||!f.need||Date.now()-lastPaceAt<1800000)return;lastPaceAt=Date.now();toast('Отстаёшь от цели на '+f.behind+'. Нужно '+f.need+' в час',8000);window.chrome?.webview?.postMessage({type:'attention'});}
function beep(){if(!sound)return;try{audio??=new AudioContext();if(audio.state==='suspended')audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=650;gain.gain.setValueAtTime(.04,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.07);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.07);}catch{}}
function celebrate(){if(calm())return;for(let i=0;i<32;i++){const el=document.createElement('span');el.className='celebration';el.style.left='50%';el.style.top='40%';el.style.background=['#ff2400','#e01b12','#ff8a73','#8a0003'][i%4];document.body.appendChild(el);const animation=el.animate([{transform:'translate(0,0) rotate(0)',opacity:1},{transform:'translate('+(Math.random()-.5)*600+'px,'+(Math.random()*260+100)+'px) rotate('+(Math.random()*600)+'deg)',opacity:0}],{duration:1100+Math.random()*400,easing:'cubic-bezier(.2,0,.6,1)'});animation.onfinish=()=>el.remove();}}
function startShift(){change(()=>{const now=new Date();state.startTime=now.toISOString();state.endTime=null;state.pauseStart=null;state.pausedTotal=0;state.shiftStart=C.fmtTime(now);state.status='Идёт';});toast('Смена начата');}
function finishShift(automatic=false,at=null){if(!['Идёт','Пауза'].includes(state.status))return;change(()=>{const now=at===null?new Date():new Date(at);if(state.pauseStart)state.pausedTotal+=Math.max(0,now-new Date(state.pauseStart));state.pauseStart=null;state.endTime=now.toISOString();state.status='Завершена';history.push({date:now.toISOString(),total:C.total(state),comm:state.commCount,duration:C.duration(state),itemOrder:[...state.itemOrder],counts:C.clone(state.counts),state:C.clone(state)});history=history.slice(-HISTORY);});toast(automatic?'Смена завершена по расписанию':'Смена завершена');celebrate();}
function pauseShift(){change(()=>{if(state.status==='Идёт'){state.pauseStart=new Date().toISOString();state.status='Пауза';}else if(state.status==='Пауза'){state.pausedTotal+=Math.max(0,Date.now()-new Date(state.pauseStart).getTime());state.pauseStart=null;state.status='Идёт';}});}
async function editNumber(title,value,callback){const result=await ask(title,'Укажи целое неотрицательное число.',{input:true,type:'number',value});if(result===null)return;const n=Number(result);if(!Number.isSafeInteger(n)||n<0||n>1e9){toast('Введите целое число от 0 до 1 000 000 000');return;}change(()=>callback(n));}
$('itemsContainer').addEventListener('click',e=>{const button=e.target.closest('button'),row=button?.closest('.item-row');if(!row)return;const name=row.dataset.name;if(button.dataset.action==='menu'){itemSelected=name;$('itemDialogTitle').textContent=name;showDialog('itemDialog');}else{const delta=button.dataset.action==='plus'?1:-1;change(()=>state.counts[name]=Math.min(1e9,Math.max(0,state.counts[name]+delta)));}});
$('itemEditBtn').onclick=()=>{const name=itemSelected;$('itemDialog').close();editNumber(name,state.counts[name],n=>state.counts[name]=n);};$('itemDeleteBtn').onclick=async()=>{const name=itemSelected;$('itemDialog').close();if(await ask('Удалить категорию?','«'+name+'» и её количество будут удалены.',{confirm:'Удалить'}))change(()=>{state.itemOrder=state.itemOrder.filter(n=>n!==name);delete state.counts[name];});};$('itemCloseBtn').onclick=()=>$('itemDialog').close();
$('addBtn').onclick=async()=>{if(state.itemOrder.length>=100){toast('Можно добавить до 100 категорий');return;}const name=await ask('Новая категория','Например, «Встреча назначена».',{input:true});if(!validName(name))return;if(state.itemOrder.includes(name)){toast('Такая категория уже есть');return;}change(()=>{state.itemOrder.push(name);Object.defineProperty(state.counts,name,{value:0,writable:true,enumerable:true,configurable:true});});};
$('commPlus').onclick=()=>change(()=>state.commCount=Math.min(1e9,state.commCount+1));$('commMinus').onclick=()=>change(()=>state.commCount=Math.max(0,state.commCount-1));$('commEditBtn').onclick=()=>editNumber('Коммуникации',state.commCount,n=>state.commCount=n);$('commResetBtn').onclick=async()=>{if(state.commCount&&await ask('Обнулить коммуникации?','Остальные категории и таймер сохранятся.',{confirm:'Обнулить'}))change(()=>state.commCount=0);};
$('startShiftBtn').onclick=startShift;$('pauseShiftBtn').onclick=pauseShift;$('endShiftBtn').onclick=async()=>{if(await ask('Завершить смену?','Результат сохранится в истории.',{confirm:'Завершить'}))finishShift();};
for(const id of ['shiftStart','shiftEnd'])$(id).addEventListener('blur',()=>{if(state[id]!==$(id).value)change(()=>state[id]=$(id).value);});
$('undoBtn').onclick=undo;$('resetBtn').onclick=async()=>{const answer=await ask('Сбросить счётчики?','Количество во всех категориях и отдельный счётчик станут равны нулю. Сброс можно отменить.',{confirm:'Сбросить',reset:true});if(!answer)return;change(()=>{for(const n of state.itemOrder)state.counts[n]=0;state.commCount=0;state.hours=Object.create(null);if(answer.resetShift)state=C.normalize({},state.itemOrder);});toast('Счётчики сброшены');};
$('themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';if(calm()||!document.startViewTransition){applyTheme(next);return;}const r=$('themeToggle').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));document.startViewTransition(()=>applyTheme(next)).ready.then(()=>document.documentElement.animate({clipPath:['circle(0 at '+x+'px '+y+'px)','circle('+radius+'px at '+x+'px '+y+'px)']},{duration:550,easing:'cubic-bezier(.2,0,0,1)',pseudoElement:'::view-transition-new(root)'})).catch(()=>{});};$('settingsBtn').onclick=()=>showDialog('settingsDialog');$('settingsCloseBtn').onclick=()=>$('settingsDialog').close();
$('profileSelect').onchange=()=>{save();switchProfile($('profileSelect').value);};
$('profileAddBtn').onclick=async()=>{$('settingsDialog').close();const input=await ask('Создать профиль','Профили имеют отдельные счётчики и историю.',{input:true});if(!validName(input))return;const name=profileKey(input);if(own(profiles,name)){toast('Профиль уже существует');return;}save();try{localStorage.removeItem('commStatsData_'+name);}catch{}profiles[name]={itemOrder:[...C.defaults],items:[],history:[]};switchProfile(name);toast('Профиль создан');};
$('profileRenameBtn').onclick=async()=>{$('settingsDialog').close();const input=await ask('Имя профиля','Укажи новое имя.',{input:true,value:current==='default'?'Основной':current});if(!validName(input))return;const name=profileKey(input);if(name===current)return;if(own(profiles,name)){toast('Профиль уже существует');return;}save();const old=current;profiles[name]=profiles[old];delete profiles[old];current=name;save();try{localStorage.removeItem('commStatsData_'+old);}catch{}renderProfiles();toast('Профиль переименован');};
$('profileDelBtn').onclick=async()=>{$('settingsDialog').close();if(Object.keys(profiles).length<2){toast('Нельзя удалить последний профиль');return;}if(!await ask('Удалить профиль?','«'+(current==='default'?'Основной':current)+'»: счётчики и история будут удалены.',{confirm:'Удалить'}))return;const old=current;delete profiles[old];try{localStorage.removeItem('commStatsData_'+old);}catch{}write('commProfiles',JSON.stringify(profiles));switchProfile(Object.keys(profiles)[0]);toast('Профиль удалён');};
function download(name,content,mime){if(window.chrome?.webview){window.chrome.webview.postMessage({type:'saveFile',name,content});return;}const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
$('copyBtn').onclick=async()=>{const text=reportText();try{if(window.chrome?.webview){window.chrome.webview.postMessage({type:'clipboard',text});return;}await navigator.clipboard.writeText(text);toast('Отчёт скопирован');}catch{const textarea=document.createElement('textarea');textarea.value=text;document.body.appendChild(textarea);textarea.select();const ok=document.execCommand('copy');textarea.remove();toast(ok?'Отчёт скопирован':'Не удалось скопировать отчёт');}};
$('exportCsvBtn').onclick=()=>download('COUNTER_'+new Date().toISOString().slice(0,10)+'.csv',C.csv(state),'text/csv;charset=utf-8');
$('backupBtn').onclick=()=>{save();const data=Object.create(null);for(const [name,meta] of Object.entries(profiles))data[name]={...meta,data:name===current?C.clone(state):C.normalize(read('commStatsData_'+name,{}),meta.itemOrder)};download('COUNTER_backup_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({schema:2,currentProfile:current,theme:document.documentElement.dataset.theme,profiles:data},null,2),'application/json;charset=utf-8');};
$('importBtn').onclick=()=>{$('settingsDialog').close();$('importFile').click();};
$('importFile').onchange=async()=>{const file=$('importFile').files[0];$('importFile').value='';if(!file)return;try{if(file.size>5e6)throw Error('big');const data=JSON.parse(await file.text());if(data.schema!==2||!data.profiles||typeof data.profiles!=='object'||Array.isArray(data.profiles))throw Error('format');const entries=Object.entries(data.profiles);if(!entries.length||entries.length>50||entries.some(([name,p])=>!validName(name)||!p||!Array.isArray(p.itemOrder)||!p.data))throw Error('format');if(!await ask('Загрузить резервную копию?','Текущие профили будут заменены. При необходимости сначала сохрани свою копию.',{confirm:'Загрузить'}))return;const next=Object.create(null);for(const [name,p] of entries){const normalized=toCalls(C.normalize(p.data,p.itemOrder));next[name]={itemOrder:normalized.itemOrder,items:[],history:Array.isArray(p.history)?p.history.slice(-HISTORY):[],goal:p.goal,shiftHours:p.shiftHours};if(!write('commStatsData_'+name,JSON.stringify(normalized)))throw Error('storage');}if(!write('commProfiles',JSON.stringify(next)))throw Error('storage');for(const name of Object.keys(profiles))if(!own(next,name))try{localStorage.removeItem('commStatsData_'+name);}catch{}profiles=next;switchProfile(own(profiles,data.currentProfile)?data.currentProfile:entries[0][0]);if(data.theme==='light'||data.theme==='dark')applyTheme(data.theme);toast('Резервная копия загружена');}catch{toast('Не удалось загрузить копию. Нужен JSON-файл COUNTER.',5000);}};
$('soundBtn').onclick=()=>{sound=!sound;write('counterSound',sound?'on':'off');renderSound();beep();};// «Авто»: полные MD3-анимации на мощном ПК, облегчённые на слабом (до 4 потоков или меньше 4 ГБ памяти).
function weakDevice(){return (navigator.hardwareConcurrency||8)<=4||(navigator.deviceMemory||8)<4;}
$('effectsBtn').onclick=()=>applyEffects({auto:'full',full:'lite',lite:'auto'}[effectsPref]);function applyEffects(pref){effectsPref=['full','lite'].includes(pref)?pref:'auto';const mode=effectsPref==='auto'?(weakDevice()?'lite':'full'):effectsPref;lite=mode==='lite';document.documentElement.dataset.effects=mode;write('counterEffects',effectsPref);$('effectsBtn').textContent='Эффекты: '+(effectsPref==='auto'?'авто, сейчас '+(lite?'лёгкие':'полные'):lite?'лёгкие':'полные');}
function renderSound(){$('soundBtn').textContent='Звук: '+(sound?'включён':'выключен');$('soundBtn').setAttribute('aria-pressed',sound);}
$('historyBtn').onclick=()=>{
  $('historySubtitle').textContent='Профиль: '+(current==='default'?'Основной':current);const list=$('historyList');list.replaceChildren();if(!history.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Пока нет завершённых смен';list.appendChild(empty);}
  [...history].reverse().forEach(h=>{const button=document.createElement('button');button.className='history-item';const date=document.createElement('small');date.textContent=new Date(h.date).toLocaleString('ru-RU',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});const summary=document.createElement('strong');summary.textContent='Всего: '+C.number(h.total)+' · '+C.fmtDuration(Number(h.duration)||0);const note=document.createElement('small');note.textContent='Коммуникации: '+C.number(h.comm);button.append(date,summary,note);button.onclick=async()=>{$('historyDialog').close();if(!await ask('Загрузить эту смену?','Текущие счётчики будут заменены. Действие можно отменить.',{confirm:'Загрузить'}))return;change(()=>{if(h.state)state=C.normalize(h.state,h.state.itemOrder);else{state=C.normalize({counts:h.counts,commCount:h.comm},h.itemOrder||Object.keys(h.counts||{}));const end=new Date(h.date).getTime(),elapsed=Math.min(Math.max(0,Number(h.duration)||0),31536e6);if(Number.isFinite(end)){state.startTime=new Date(end-elapsed).toISOString();state.endTime=new Date(end).toISOString();state.status='Завершена';state.shiftStart=C.fmtTime(new Date(end-elapsed));state.shiftEnd=C.fmtTime(new Date(end));}}state=toCalls(state);});toast('Смена загружена');};list.appendChild(button);});showDialog('historyDialog');
};$('historyCloseBtn').onclick=()=>$('historyDialog').close();
// Отчёт за 7 или 30 дней по дням, выгрузка в Excel (CSV с «;»).
function cell(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function renderReport(){
  const g=goal(),from=new Date();from.setHours(0,0,0,0);from.setDate(from.getDate()-(reportDays-1));const r=C.report(entries(),from.getTime(),Date.now()+60000),met=r.rows.filter(d=>d.calls>=g).length;
  $('reportWeekBtn').setAttribute('aria-pressed',reportDays===7);$('reportMonthBtn').setAttribute('aria-pressed',reportDays===30);
  setText('reportPeriod',(reportDays===7?'Последние 7 дней':'Последние 30 дней')+' · '+(current==='default'?'Основной':current)+' · цель '+g);
  const summary=[[r.sum.calls,'звонков'],[fmt1(C.rate(r.sum)),'в среднем в час'],[C.percent(r.sum)===null?'—':Math.round(C.percent(r.sum))+'%','успешность'],[met+' из '+r.rows.length,plural(r.rows.length,'день','дня','дней')+' с целью']];
  $('reportSummary').replaceChildren(...summary.map(([value,label])=>{const box=cell('div','','record');box.append(cell('strong',value),cell('small',label));return box;}));
  const head=document.createElement('thead'),body=document.createElement('tbody'),foot=document.createElement('tfoot'),line=(label,d,cls)=>{const tr=document.createElement('tr');tr.append(cell('td',label),cell('td',d.shifts),cell('td',d.calls,cls),cell('td',d.success),cell('td',C.percent(d)===null?'—':Math.round(C.percent(d))+'%'),cell('td',d.comm),cell('td',fmt1(d.duration/3600000)),cell('td',fmt1(C.rate(d))));return tr;};
  const top=document.createElement('tr');for(const h of ['Дата','Смен','Звонки','Успешно','%','Комм.','Часов','В час'])top.appendChild(cell('th',h));head.appendChild(top);
  for(const d of r.rows){const [y,m,day]=d.day.split('-').map(Number);body.appendChild(line(new Date(y,m-1,day).toLocaleDateString('ru-RU',{weekday:'short',day:'2-digit',month:'2-digit'}),d,d.calls>=g?'met':''));}
  if(!r.rows.length){const tr=document.createElement('tr'),td=cell('td','За этот период завершённых смен нет','empty');td.colSpan=8;tr.appendChild(td);body.appendChild(tr);}else foot.appendChild(line('Итого',r.sum));
  $('reportTable').replaceChildren(head,body,foot);return r;
}
$('reportBtn').onclick=()=>{renderReport();showDialog('reportDialog');};$('reportCloseBtn').onclick=()=>$('reportDialog').close();
$('reportWeekBtn').onclick=()=>{reportDays=7;renderReport();};$('reportMonthBtn').onclick=()=>{reportDays=30;renderReport();};
$('reportExportBtn').onclick=()=>download('COUNTER_report_'+(reportDays===7?'week':'month')+'_'+C.dayKey(Date.now())+'.csv',C.reportCsv(renderReport(),goal()),'text/csv;charset=utf-8');
$('goalBtn').onclick=async()=>{$('settingsDialog').close();const result=await ask('Цель смены','Сколько звонков нужно сделать за смену. У каждого профиля своя цель.',{input:true,type:'number',value:goal()});if(result===null)return;const n=Number(result);if(!Number.isSafeInteger(n)||n<1||n>100000){toast('Цель: целое число от 1 до 100 000');return;}profiles[current].goal=n;lastGoal=C.total(state)>=n;save();render();toast('Цель смены: '+n);};
// Длина смены у профиля: от неё таймер «Осталось», прогноз и цель в час. Если известно начало — ставим конец по расписанию.
for(const b of document.querySelectorAll('[data-hours]'))b.onclick=()=>{const h=Number(b.dataset.hours),start=C.timeMinutes(state.shiftStart);profiles[current].shiftHours=h;if(start!==null){const m=(start+h*60)%1440,end=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');const at=C.scheduledEnd({...state,shiftEnd:end});if(state.shiftEnd!==end&&!(active()&&at!==null&&at<=Date.now())){change(()=>state.shiftEnd=end);toast('Смена '+h+' ч, конец в '+end);return;}}save();render();toast('Смена '+h+' ч');};
$('paceBtn').onclick=()=>{paceOn=!paceOn;write('counterPace',paceOn?'on':'off');renderPace();};
function renderPace(){$('paceBtn').textContent='Напоминание о темпе: '+(paceOn?'включено':'выключено');$('paceBtn').setAttribute('aria-pressed',paceOn);}
let dragName=null;const items=$('itemsContainer');items.addEventListener('dragstart',e=>{if(e.target.closest('button,input')){e.preventDefault();return;}const row=e.target.closest('.item-row');if(!row)return;dragName=row.dataset.name;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragName);});items.addEventListener('dragover',e=>{const row=e.target.closest('.item-row');if(!row||!dragName||row.dataset.name===dragName)return;e.preventDefault();items.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));row.classList.add('drag-over');});items.addEventListener('dragend',()=>{dragName=null;items.querySelectorAll('.drag-over,.dragging').forEach(r=>r.classList.remove('drag-over','dragging'));});items.addEventListener('drop',e=>{e.preventDefault();const row=e.target.closest('.item-row'),name=dragName;dragName=null;if(!row||!name||row.dataset.name===name||!state.itemOrder.includes(name))return;change(()=>{const down=state.itemOrder.indexOf(name)<state.itemOrder.indexOf(row.dataset.name);state.itemOrder=state.itemOrder.filter(n=>n!==name);state.itemOrder.splice(state.itemOrder.indexOf(row.dataset.name)+(down?1:0),0,name);});});
document.addEventListener('pointerdown',e=>{const button=e.target.closest('button');if(!button||button.disabled||calm())return;const rect=button.getBoundingClientRect(),size=Math.max(rect.width,rect.height)*2,ripple=document.createElement('span');ripple.className='ripple';ripple.style.width=ripple.style.height=size+'px';ripple.style.left=(e.clientX-rect.left-size/2)+'px';ripple.style.top=(e.clientY-rect.top-size/2)+'px';button.appendChild(ripple);setTimeout(()=>ripple.remove(),600);});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'&&!e.target.closest('input,textarea,[contenteditable=true]')&&!document.querySelector('dialog[open]')){e.preventDefault();undo();}});window.addEventListener('beforeunload',save);document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
// Обновление по воздуху: о новой версии сообщает программа, скачивание и замену делает она же.
// Окно загрузки можно скрыть и работать дальше: прогресс виден на алой кнопке в верхней панели.
let updateBusy=false;
function updateView(state,percent){
  const busy=state==='progress',failed=state==='error',bar=$('updateProgress'),known=busy&&percent>=0,label=busy?(known?'Скачиваем… '+percent+'%':'Скачиваем…'):failed?'Повторить':'Обновить';updateBusy=busy;
  if(busy&&document.activeElement===$('updateNowBtn'))$('updateLaterBtn').focus();$('updateNowBtn').disabled=busy;$('updateManualBtn').hidden=!failed;$('updateLaterBtn').textContent=busy?'Скрыть':failed?'Закрыть':'Позже';
  setText('updateNowText',label);setText('updateChipText',label);$('updateBtn').setAttribute('aria-label',label);
  bar.hidden=!busy;bar.classList.toggle('indeterminate',busy&&!known);$('updateProgressFill').style.width=known?percent+'%':'';if(known)bar.setAttribute('aria-valuenow',percent);else bar.removeAttribute('aria-valuenow');
}
function onUpdate(d){
  if(d.state==='available'&&typeof d.version==='string'){
    setText('updateVersion',d.version);setText('updateCurrent',String(d.current||''));setText('updateTitle','Доступно обновление');setText('updateMessage','Счётчик скачает новую версию, проверит её и перезапустится сам. Сохранённые данные не изменятся.');
    updateView('available');$('updateBtn').hidden=false;$('updateBtn').title='Установить версию '+d.version;if(!document.querySelector('dialog[open]'))showDialog('updateDialog');
  }else if(d.state==='progress'&&updateBusy){const p=Number(d.percent);updateView('progress',Number.isFinite(p)&&p>=0?Math.min(100,Math.round(p)):-1);}
  else if(d.state==='latest')toast('Установлена последняя версия '+String(d.current||''));
  else if(d.state==='check-failed')toast('Не удалось проверить обновления: нет связи с GitHub',4000);
  else if(d.state==='error'){setText('updateTitle','Не удалось обновить');setText('updateMessage',String(d.message||'Неизвестная ошибка')+'\n\nМожно повторить или скачать новую версию вручную со страницы релизов.');updateView('error');if(!document.querySelector('dialog[open]'))showDialog('updateDialog');if($('updateDialog').open)$('updateNowBtn').focus();}
}
// Проверка по кнопке: без перезапуска программы.
if(window.chrome?.webview)for(const id of ['updatesSection','updatesActions','hotkeysSection','hotkeysActions','miniBtn'])$(id).hidden=false;
$('checkUpdateBtn').onclick=()=>{$('settingsDialog').close();if(updateBusy){showDialog('updateDialog');return;}toast('Проверяем обновления…');window.chrome?.webview?.postMessage({type:'checkUpdate'});};
$('updateBtn').onclick=()=>{if(!$('updateDialog').open)showDialog('updateDialog');if(!updateBusy)$('updateNowBtn').focus();};
$('updateNowBtn').onclick=()=>{if(updateBusy||!window.chrome?.webview)return;setText('updateTitle','Обновляем счётчик');setText('updateMessage','Окно можно скрыть и работать дальше. После загрузки счётчик перезапустится сам, данные сохранятся.');updateView('progress',-1);window.chrome.webview.postMessage({type:'update'});};
$('updateLaterBtn').onclick=()=>$('updateDialog').close();
$('updateManualBtn').onclick=()=>window.chrome?.webview?.postMessage({type:'openReleases'});
// +1 из горячей клавиши или мини-окна. «Успешно» и «Звонки» независимы, как и кнопки в детализации.
function bump(action){
  if(action==='comm'){if(state.commCount<1e9)change(()=>state.commCount++);return true;}
  const name=action==='calls'?C.calls:'Успешно';if(!state.itemOrder.includes(name)){toast('Нет категории «'+name+'»');return false;}
  if(state.counts[name]<1e9)change(()=>state.counts[name]++);return true;
}
// Глобальные горячие клавиши регистрирует программа; по умолчанию Ctrl+Alt+1, 2, 3.
const hotkeyNames={calls:'Звонок',success:'Успешно',comm:'Коммуникация'},hotkeyDefaults={calls:{mod:3,vk:49},success:{mod:3,vk:50},comm:{mod:3,vk:51}};
let hotkeys=C.clone(hotkeyDefaults),hotkeysFailed=[],hotkeyEdit=null,hotkeyDraft=null,hotkeyReport=false,mini=false;
function validKey(k){return k===null||!!k&&typeof k==='object'&&Number.isInteger(k.mod)&&(k.mod&3)>0&&k.mod<=7&&Number.isInteger(k.vk)&&k.vk>0&&k.vk<255;}
function keyLabel(k){if(!k)return 'выключено';const parts=[],vk=k.vk;if(k.mod&2)parts.push('Ctrl');if(k.mod&1)parts.push('Alt');if(k.mod&4)parts.push('Shift');parts.push(vk>=48&&vk<=57||vk>=65&&vk<=90?String.fromCharCode(vk):vk>=96&&vk<=105?'Num '+(vk-96):vk>=112&&vk<=135?'F'+(vk-111):'#'+vk);return parts.join('+');}
// По коду клавиши, а не символу: сочетание одинаково в русской и английской раскладке.
function keyFromEvent(e){const m=/^Key([A-Z])$/.exec(e.code)||/^Digit(\d)$/.exec(e.code),n=/^Numpad(\d)$/.exec(e.code),f=/^F(\d{1,2})$/.exec(e.code),mod=(e.altKey?1:0)|(e.ctrlKey?2:0)|(e.shiftKey?4:0);let vk=m?m[1].charCodeAt(0):n?96+Number(n[1]):f&&+f[1]>=1&&+f[1]<=24?111+Number(f[1]):0;return vk&&(mod&3)?{mod,vk}:null;}
function renderHotkeys(){for(const b of document.querySelectorAll('[data-hotkey]')){const a=b.dataset.hotkey;b.textContent=hotkeyNames[a]+': '+keyLabel(hotkeys[a])+(hotkeysFailed.includes(a)&&hotkeys[a]?' (занято)':'');}}
function sendHotkeys(report){hotkeyReport=!!report;window.chrome?.webview?.postMessage({type:'hotkeys',keys:hotkeys});}
function onHotkeys(d){hotkeysFailed=Array.isArray(d.failed)?d.failed.filter(a=>own(hotkeyNames,a)):[];renderHotkeys();if(hotkeyReport&&hotkeysFailed.length)toast('Сочетание '+hotkeysFailed.map(a=>keyLabel(hotkeys[a])+' («'+hotkeyNames[a]+'»)').join(', ')+' занято другой программой. Выбери другое в настройках.',7000);hotkeyReport=false;}
for(const b of document.querySelectorAll('[data-hotkey]'))b.onclick=()=>{hotkeyEdit=b.dataset.hotkey;hotkeyDraft=null;$('settingsDialog').close();setText('hotkeyTitle','Горячая клавиша: '+hotkeyNames[hotkeyEdit]);setText('hotkeyPreview',keyLabel(hotkeys[hotkeyEdit]));$('hotkeySaveBtn').disabled=true;
  // Пока выбираем сочетание, программа их не перехватывает, иначе нажатие засчитается как звонок.
  window.chrome?.webview?.postMessage({type:'hotkeys',keys:{}});showDialog('hotkeyDialog');$('hotkeyPreview').focus();};
$('hotkeyPreview').addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Tab')return;e.preventDefault();if(['Control','Alt','Shift','Meta','AltGraph'].includes(e.key))return;const k=keyFromEvent(e);$('hotkeySaveBtn').disabled=true;hotkeyDraft=null;
  if(!k){setText('hotkeyPreview','Нужен Ctrl или Alt + клавиша');return;}const other=Object.keys(hotkeyNames).find(a=>a!==hotkeyEdit&&hotkeys[a]&&hotkeys[a].mod===k.mod&&hotkeys[a].vk===k.vk);
  if(other){setText('hotkeyPreview',keyLabel(k)+' уже у «'+hotkeyNames[other]+'»');return;}hotkeyDraft=k;setText('hotkeyPreview',keyLabel(k));$('hotkeySaveBtn').disabled=false;});
function saveHotkey(k){hotkeys[hotkeyEdit]=k;write('counterHotkeys',JSON.stringify(hotkeys));hotkeyEdit=null;$('hotkeyDialog').close();renderHotkeys();toast(k?'Сочетание сохранено: '+keyLabel(k):'Горячая клавиша отключена');}
$('hotkeySaveBtn').onclick=()=>{if(hotkeyDraft)saveHotkey(hotkeyDraft);};$('hotkeyOffBtn').onclick=()=>saveHotkey(null);$('hotkeyCancelBtn').onclick=()=>$('hotkeyDialog').close();
$('hotkeyDialog').addEventListener('close',()=>sendHotkeys(true));
// Мини-окно: программа делает окно маленьким и поверх всех; здесь — компактный вид с главными цифрами и кнопками.
function setMini(on){mini=!!on;document.documentElement.dataset.mini=mini?'1':'0';$('miniPanel').hidden=!mini;}
$('miniBtn').onclick=()=>{setMini(true);window.chrome?.webview?.postMessage({type:'mini',on:true});};
$('miniExitBtn').onclick=()=>{setMini(false);window.chrome?.webview?.postMessage({type:'mini',on:false});};
$('miniCallsBtn').onclick=()=>bump('calls');$('miniSuccessBtn').onclick=()=>bump('success');$('miniCommBtn').onclick=()=>bump('comm');
if(window.chrome?.webview)window.chrome.webview.addEventListener('message',e=>{const d=e.data,type=d&&d.type;if(type==='toast')toast(d.message);else if(type==='update')onUpdate(d);else if(type==='hotkeys')onHotkeys(d);else if(type==='mini')setMini(d.on===true);else if(type==='hotkey'&&own(hotkeyNames,d.action)&&bump(d.action)&&!mini)toast(hotkeyNames[d.action]+' +1',1200);});
const legacy=read('commStatsData',null);
if(legacy&&legacy.counts&&!read('commStatsData_default',null)&&!read('commLegacyMigrated',false)){
  const oldProfiles=read('commProfiles',{}),migrated=Object.create(null);
  if(oldProfiles&&typeof oldProfiles==='object'&&!Array.isArray(oldProfiles))for(const [name,p] of Object.entries(oldProfiles))migrated[name]=p;
  migrated.default={itemOrder:Array.isArray(legacy.itemOrder)?legacy.itemOrder:Object.keys(legacy.counts),items:[],history:[]};
  write('commProfiles',JSON.stringify(migrated));write('commStatsData_default',JSON.stringify(legacy));write('commLegacyMigrated','true');
}
const loaded=read('commProfiles',{});if(loaded&&typeof loaded==='object'&&!Array.isArray(loaded))for(const [name,p] of Object.entries(loaded))if(validName(name)&&p&&typeof p==='object')profiles[name]=p;
if(!Object.keys(profiles).length){const d=read('commStatsData_default',null);profiles.default={itemOrder:d&&Array.isArray(d.itemOrder)?d.itemOrder:d&&d.counts?[...C.legacyDefaults]:[...C.defaults],items:[],history:[]};}
// 2.4: в детализации остаются «Звонки» и «Успешно» (разово для всех профилей со старыми категориями).
if(!read('commCallsMigrated',false)){
  for(const [name,meta] of Object.entries(profiles)){
    const order=Array.isArray(meta.itemOrder)?[...meta.itemOrder]:[...C.legacyDefaults];for(const n of Array.isArray(meta.items)?meta.items:[])if(!order.includes(n))order.push(n);
    // Профиль без itemOrder создан до 2.4: фиксируем его порядок, иначе он откроется с новыми категориями и потеряет старые.
    if(!Array.isArray(meta.itemOrder)){meta.itemOrder=order;meta.items=[];}
    const data=read('commStatsData_'+name,null),normalized=C.normalize(data||{},order),migrated=toCalls(normalized);
    if(migrated!==normalized){if(data)write('commStatsData_'+name,JSON.stringify(migrated));meta.itemOrder=[...C.defaults];meta.items=[];}
  }
  write('commProfiles',JSON.stringify(profiles));write('commCallsMigrated','true');
}
let last;try{last=localStorage.getItem('commLastProfile');sound=localStorage.getItem('counterSound')==='on';paceOn=localStorage.getItem('counterPace')!=='off';const savedKeys=read('counterHotkeys',null);if(savedKeys&&typeof savedKeys==='object')for(const a of Object.keys(hotkeyNames))if(own(savedKeys,a)&&validKey(savedKeys[a]))hotkeys[a]=savedKeys[a];applyEffects(localStorage.getItem('counterEffects'));applyTheme(localStorage.getItem('commStatsTheme')==='light'?'light':'dark');}catch{applyEffects('auto');applyTheme('dark');}renderSound();renderPace();renderHotkeys();if(window.chrome?.webview)sendHotkeys(true);switchProfile(own(profiles,last)?last:Object.keys(profiles)[0]);
setInterval(()=>{updateTimer();if(Date.now()-lastPaceCheck>=60000){lastPaceCheck=Date.now();checkPace();}if(['Идёт','Пауза'].includes(state.status)){const end=C.scheduledEnd(state);if(end!==null&&Date.now()>=end&&end!==skipAutoFinish)finishShift(true,end);}},1000);
})();
