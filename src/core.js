(function(root) {
  'use strict';
  // «Звонки» — все звонки за смену, «Успешно» — сколько из них успешных.
  const defaults=['Звонки','Успешно'],calls='Звонки';
  // Категории до версии 2.4: исходы звонка, каждый звонок попадал ровно в одну из них.
  const legacyDefaults=['НДЗ','Перезвон','Успешно','Отказ','VIP','Блокировка','Сам','Трансфер'];
  const clone=x=>JSON.parse(JSON.stringify(x));
  const number=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0&&Number(x)<=1e9?Number(x):0;
  const ms=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):0;
  const stamp=x=>x!=null&&Number.isFinite(new Date(x).getTime())?new Date(x).toISOString():null;
  const HOUR=3600000,pad=x=>String(x).padStart(2,'0');
  // Звонки по часам: ключ — начало местного часа (ISO), хранятся последние 48 часов.
  function hourKey(t){const d=new Date(t);d.setMinutes(0,0,0);return d.toISOString();}
  function dayKey(t){const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function hoursMap(raw){
    const out=Object.create(null);if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
    for(const k of Object.keys(raw)){const key=stamp(k),n=number(raw[k]);if(key&&n)out[key]=Math.min(1e9,(out[key]||0)+n);}
    for(const k of Object.keys(out).sort().slice(0,-48))delete out[k];return out;
  }
  function track(s,delta,now=Date.now()){
    const key=hourKey(now),n=Math.max(0,Math.min(1e9,(s.hours[key]||0)+delta));
    if(n)s.hours[key]=n;else delete s.hours[key];for(const k of Object.keys(s.hours).sort().slice(0,-48))delete s.hours[k];
  }
  function timeMinutes(v){const m=/^(\d{1,2}):(\d{2})$/.exec(String(v));return m&&+m[1]<24&&+m[2]<60?+m[1]*60+(+m[2]):null;}
  function normalize(raw={},order=defaults,now=Date.now()){
    if(!raw||typeof raw!=='object')raw={};
    const names=[...new Set((Array.isArray(order)?order:defaults).filter(x=>typeof x==='string'&&x.trim()&&x.length<=80))].slice(0,100);
    const counts=Object.create(null);for(const n of names)counts[n]=number(raw.counts&&raw.counts[n]);
    const startTime=stamp(raw.startTime),endTime=stamp(raw.endTime);
    let status=['Идёт','Пауза','Завершена'].includes(raw.status)&&startTime?raw.status:'Не начата';
    if(status==='Завершена'&&!endTime)status='Не начата';
    // Время начала и конца имеют смысл только у начатой или завершённой смены.
    return {itemOrder:names,counts,commCount:number(raw.commCount),shiftStart:timeMinutes(raw.shiftStart)!==null?raw.shiftStart:'',shiftEnd:timeMinutes(raw.shiftEnd)!==null?raw.shiftEnd:'',startTime:status==='Не начата'?null:startTime,endTime:status==='Завершена'?endTime:null,status,notes:typeof raw.notes==='string'?raw.notes.slice(0,2000):'',pausedTotal:ms(raw.pausedTotal),hours:hoursMap(raw.hours),pauseStart:status==='Пауза'?(stamp(raw.pauseStart)||new Date(now).toISOString()):null};
  }
  // Есть «Звонки» — итог равен им (остальные категории — их часть), иначе сумма категорий.
  function total(s){return s.itemOrder.includes(calls)?number(s.counts[calls]):s.itemOrder.reduce((n,k)=>n+number(s.counts[k]),0);}
  function duration(s,now=Date.now()){
    if(!s.startTime)return 0;
    const finish=s.status==='Пауза'&&s.pauseStart?new Date(s.pauseStart).getTime():s.endTime?new Date(s.endTime).getTime():now;
    return Math.max(0,finish-new Date(s.startTime).getTime()-s.pausedTotal);
  }
  function scheduledEnd(s){
    const minutes=timeMinutes(s.shiftEnd);if(minutes===null||!s.startTime)return null;
    // Первое наступление времени конца после фактического начала смены (ночная смена — на следующий день).
    const start=new Date(s.startTime),end=new Date(start);end.setHours(Math.floor(minutes/60),minutes%60,0,0);
    if(end<=start)end.setDate(end.getDate()+1);return end.getTime();
  }
  // Прогноз до конца смены: по расписанию, без расписания — по длине смены (4, 8 или 12 часов).
  function forecast(s,goal,now=Date.now(),hours=8){
    if(s.status!=='Идёт'&&s.status!=='Пауза')return null;
    const worked=duration(s,now),end=scheduledEnd(s),left=end!==null?Math.max(0,end-now):Math.max(0,hours*HOUR-worked),t=total(s);
    if(worked<15*60000)return {early:true,total:t,left};
    const rate=t/(worked/HOUR);
    return {early:false,total:t,left,rate,projected:Math.round(t+rate*left/HOUR),need:t<goal&&left>=10*60000?Math.ceil((goal-t)/(left/HOUR)):0,behind:Math.max(0,Math.ceil(goal*worked/(worked+left)-t))};
  }
  // Сколько звонков в час нужно, чтобы выполнить цель за смену по расписанию (без расписания — за длину смены).
  function hourlyGoal(s,goal,hours=8){const a=timeMinutes(s.shiftStart),b=timeMinutes(s.shiftEnd),m=a!==null&&b!==null?(b-a+1440)%1440:0;return goal/(m>=60?m/60:hours);}
  // Запись истории в единый вид для отчёта и рекордов.
  function shiftEntry(h,active=false){
    const date=stamp(h&&h.date);if(!date)return null;const calls=number(h.total);
    return {date,calls,success:Math.min(calls,number(h.counts&&h.counts['Успешно'])),comm:number(h.comm),duration:ms(h.duration),hours:hoursMap(h.state&&h.state.hours),active};
  }
  function report(entries,from,to){
    const days=new Map(),zero=()=>({shifts:0,calls:0,success:0,comm:0,duration:0});
    for(const e of entries){const t=Date.parse(e.date);if(t<from||t>to)continue;const k=dayKey(t),d=days.get(k)||Object.assign({day:k},zero());d.shifts++;d.calls+=e.calls;d.success+=e.success;d.comm+=e.comm;d.duration+=e.duration;days.set(k,d);}
    const rows=[...days.values()].sort((a,b)=>a.day<b.day?-1:1),sum=zero();
    for(const d of rows)for(const k of Object.keys(sum))sum[k]+=d[k];return {rows,sum};
  }
  const rate=d=>d.duration>=60000?d.calls/(d.duration/HOUR):null,percent=d=>d.calls?d.success/d.calls*100:null;
  // Рекорды: лучшая смена, лучший час и серия рабочих дней подряд с выполненной целью (выходные серию не прерывают).
  function records(entries,goal){
    let bestShift=0,bestHour=0;const days=new Map();
    for(const e of entries){bestShift=Math.max(bestShift,e.calls);for(const k of Object.keys(e.hours))bestHour=Math.max(bestHour,e.hours[k]);const k=dayKey(Date.parse(e.date)),d=days.get(k)||{calls:0,active:false};d.calls+=e.calls;d.active=d.active||e.active;days.set(k,d);}
    let streak=0,first=true;
    for(const [,d] of [...days.entries()].sort((a,b)=>a[0]<b[0]?1:-1)){if(d.calls>=goal)streak++;else if(!(first&&d.active))break;first=false;}
    return {bestShift,bestHour,streak};
  }
  function fmtDuration(ms){const s=Math.max(0,Math.floor(ms/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,'0')).join(':');}
  const fmtTime=d=>[d.getHours(),d.getMinutes()].map(x=>String(x).padStart(2,'0')).join(':');
  function csvCell(x){let v=String(x);if(/^[\s]*[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
  // «;» — разделитель списков в русской Windows: Excel сразу раскладывает CSV по столбцам.
  function csv(s){return '\uFEFF'+[['Тип','Количество'],...s.itemOrder.map(n=>[n,s.counts[n]]),['Всего',total(s)],['Коммуникации',s.commCount]].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';}
  const decimal=x=>x===null?'':x.toFixed(1).replace('.',',');
  function reportCsv(r,goal){
    const row=(label,d,met)=>[label,d.shifts,d.calls,d.success,decimal(percent(d)),d.comm,decimal(d.duration/HOUR),decimal(rate(d)),met];
    return '\uFEFF'+[['Дата','Смен','Звонки','Успешно','Успешность, %','Коммуникации','Часов','Звонков в час','Цель '+goal],...r.rows.map(d=>row(d.day,d,d.calls>=goal?'да':'нет')),row('Итого',r.sum,r.rows.filter(d=>d.calls>=goal).length+' из '+r.rows.length)].map(x=>x.map(csvCell).join(';')).join('\r\n')+'\r\n';
  }
  root.CounterCore={defaults,legacyDefaults,calls,clone,number,normalize,total,duration,scheduledEnd,timeMinutes,fmtDuration,fmtTime,csv,hourKey,dayKey,track,forecast,hourlyGoal,shiftEntry,report,records,rate,percent,reportCsv};
})(typeof window==='undefined'?globalThis:window);
