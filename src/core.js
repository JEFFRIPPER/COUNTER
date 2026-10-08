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
  function timeMinutes(v){const m=/^(\d{1,2}):(\d{2})$/.exec(String(v));return m&&+m[1]<24&&+m[2]<60?+m[1]*60+(+m[2]):null;}
  function normalize(raw={},order=defaults,now=Date.now()){
    if(!raw||typeof raw!=='object')raw={};
    const names=[...new Set((Array.isArray(order)?order:defaults).filter(x=>typeof x==='string'&&x.trim()&&x.length<=80))].slice(0,100);
    const counts=Object.create(null);for(const n of names)counts[n]=number(raw.counts&&raw.counts[n]);
    const startTime=stamp(raw.startTime),endTime=stamp(raw.endTime);
    let status=['Идёт','Пауза','Завершена'].includes(raw.status)&&startTime?raw.status:'Не начата';
    if(status==='Завершена'&&!endTime)status='Не начата';
    // Время начала и конца имеют смысл только у начатой или завершённой смены.
    return {itemOrder:names,counts,commCount:number(raw.commCount),shiftStart:timeMinutes(raw.shiftStart)!==null?raw.shiftStart:'',shiftEnd:timeMinutes(raw.shiftEnd)!==null?raw.shiftEnd:'',startTime:status==='Не начата'?null:startTime,endTime:status==='Завершена'?endTime:null,status,notes:typeof raw.notes==='string'?raw.notes.slice(0,2000):'',pausedTotal:ms(raw.pausedTotal),pauseStart:status==='Пауза'?(stamp(raw.pauseStart)||new Date(now).toISOString()):null};
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
  function fmtDuration(ms){const s=Math.max(0,Math.floor(ms/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,'0')).join(':');}
  const fmtTime=d=>[d.getHours(),d.getMinutes()].map(x=>String(x).padStart(2,'0')).join(':');
  function csvCell(x){let v=String(x);if(/^[\s]*[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
  // «;» — разделитель списков в русской Windows: Excel сразу раскладывает CSV по столбцам.
  function csv(s){return '\uFEFF'+[['Тип','Количество'],...s.itemOrder.map(n=>[n,s.counts[n]]),['Всего',total(s)],['Коммуникации',s.commCount]].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';}
  root.CounterCore={defaults,legacyDefaults,calls,clone,number,normalize,total,duration,scheduledEnd,timeMinutes,fmtDuration,fmtTime,csv};
})(typeof window==='undefined'?globalThis:window);
