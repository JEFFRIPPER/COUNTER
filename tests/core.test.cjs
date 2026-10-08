'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(core,context);
const C = context.CounterCore;

test('Old profiles keep categories, counts, independent communications and notes',()=>{
  const s=C.normalize({counts:{НДЗ:10,Успешно:4},totalCount:900,commCount:6,notes:'Проверить'},['НДЗ','Успешно']);
  assert.equal(C.total(s),14);
  assert.equal(s.commCount,6);
  assert.equal(s.notes,'Проверить');
});
test('Corrupt counters cannot produce negative, fractional or infinite totals',()=>{
  const s=C.normalize({counts:{A:-1,B:2.5,C:'Infinity',D:'7'}},['A','B','C','D']);
  assert.equal(C.total(s),7);
});
test('Paused timer survives reload and does not count time while paused',()=>{
  const raw={status:'Пауза',startTime:'2026-10-06T08:00:00Z',pauseStart:'2026-10-06T09:30:00Z',pausedTotal:600000};
  const s=C.normalize(JSON.parse(JSON.stringify(raw)),[],Date.parse('2026-10-06T11:00:00Z'));
  assert.equal(C.duration(s,Date.parse('2026-10-06T13:00:00Z')),80*60000);
  assert.equal(C.duration(s,Date.parse('2026-10-07T13:00:00Z')),80*60000);
});
test('Completed shift has a frozen duration with pauses excluded',()=>{
  const s=C.normalize({status:'Завершена',startTime:'2026-10-06T08:00:00Z',endTime:'2026-10-06T17:00:00Z',pausedTotal:3600000},[]);
  assert.equal(C.duration(s),8*3600000);
});
test('Overnight end time is tomorrow, not an immediate stop at start',()=>{
  const start=new Date(2026,9,6,22,0,0);
  const s=C.normalize({startTime:start.toISOString(),status:'Идёт',shiftStart:'22:00',shiftEnd:'06:00'},[]);
  const end=new Date(C.scheduledEnd(s));
  assert.equal(end.getDate(),7);
  assert.equal(end.getHours(),6);
});
test('CSV quotes commas, newlines and quotes; formula-like labels are neutralized',()=>{
  const s=C.normalize({counts:{'A,"B"\nC':3,'=1+1':1}},['A,"B"\nC','=1+1']);
  const csv=C.csv(s);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"A,""B""\nC";"3"'));
  assert.ok(csv.includes('"\'=1+1";"1"'));
});
test('Reserved object keys are safe category names',()=>{
  const s=C.normalize({counts:JSON.parse('{"__proto__":2,"constructor":3}')},['__proto__','constructor']);
  assert.equal(C.total(s),5);
});
test('Malformed timestamps do not start a broken timer',()=>{
  const s=C.normalize({status:'Идёт',startTime:'broken'},[]);
  assert.equal(s.status,'Не начата');
  assert.equal(C.duration(s),0);
});
test('A zero-category profile stays empty instead of recreating deleted categories',()=>{
  const s=C.normalize({counts:{}},[]);
  assert.equal(s.itemOrder.length,0);
});
test('Clock input boundaries are validated',()=>{
  assert.equal(C.timeMinutes('23:59'),1439);
  assert.equal(C.timeMinutes('24:00'),null);
  assert.equal(C.timeMinutes('12:60'),null);
});
test('Schedule end is the first occurrence after the actual start, edited start clock does not shift it',()=>{
  const s=C.normalize({status:'Идёт',startTime:new Date(2026,9,6,0,5).toISOString(),shiftStart:'22:00',shiftEnd:'06:00'},[]);
  assert.equal(C.scheduledEnd(s),new Date(2026,9,6,6,0).getTime());
  const night=C.normalize({status:'Идёт',startTime:new Date(2026,9,6,21,58).toISOString(),shiftEnd:'06:00'},[]);
  assert.equal(C.scheduledEnd(night),new Date(2026,9,7,6,0).getTime());
});
test('Not started shift drops stale timestamps and long pauses are kept',()=>{
  const s=C.normalize({status:'Не начата',startTime:'2026-10-06T08:00:00Z',endTime:'2026-10-06T09:00:00Z'},[]);
  assert.equal(s.startTime,null);assert.equal(s.endTime,null);assert.equal(C.duration(s),0);
  assert.equal(C.normalize({status:'Идёт',startTime:'2026-10-06T08:00:00Z',pausedTotal:2e9},[]).pausedTotal,2e9);
});
test('Default detail is Звонки and Успешно; the total follows Звонки, not the sum',()=>{
  const s=C.normalize({counts:{Звонки:10,Успешно:3}});
  assert.deepEqual([...s.itemOrder],['Звонки','Успешно']);
  assert.equal(C.total(s),10);
  assert.ok(C.csv(s).includes('"Всего";"10"'));
  const custom=C.normalize({counts:{Звонки:4,Перезвон:2}},['Звонки','Перезвон']);
  assert.equal(C.total(custom),4,'Other categories are part of Звонки');
});
test('Calls are tracked per hour and the map keeps the last 48 hours',()=>{
  const s=C.normalize({hours:{'2026-10-08T09:00:00Z':3,broken:5,'2026-10-08T10:00:00Z':-2}});
  C.track(s,2,Date.parse('2026-10-08T09:40:00Z'));C.track(s,-9,Date.parse('2026-10-08T11:10:00Z'));
  assert.deepEqual({...s.hours},{'2026-10-08T09:00:00.000Z':5});
  for(let i=0;i<60;i++)C.track(s,1,Date.parse('2026-10-01T00:00:00Z')+i*3600000);
  assert.equal(Object.keys(s.hours).length,48);
});
test('Forecast uses the schedule, or 8 working hours without it',()=>{
  const start=new Date(2026,9,8,9,0),now=new Date(2026,9,8,10,0).getTime();
  const s=C.normalize({status:'Идёт',startTime:start.toISOString(),shiftEnd:'17:00',counts:{Звонки:10}});
  const f=C.forecast(s,120,now);
  assert.equal(f.projected,80);assert.equal(f.need,16);assert.equal(f.behind,5);
  const free=C.forecast(C.normalize({status:'Идёт',startTime:start.toISOString(),counts:{Звонки:20}}),120,now);
  assert.equal(free.projected,160);assert.equal(free.behind,0);
  assert.equal(C.forecast(C.normalize({}),120,now),null);
  assert.ok(C.forecast(s,120,start.getTime()+60000).early);
});
test('Records and the streak skip days off; an unfinished running day does not break it',()=>{
  const e=(d,n,active=false)=>C.shiftEntry({date:d,total:n,counts:{Успешно:1},state:{hours:{[d]:n/10}}},active);
  const list=[e('2026-10-02T15:00:00Z',150),e('2026-10-05T15:00:00Z',140),e('2026-10-06T15:00:00Z',141),e('2026-10-08T09:00:00Z',20,true)];
  assert.deepEqual({...C.records(list,140)},{bestShift:150,bestHour:15,streak:3});
  assert.equal(C.records([...list.slice(0,3),e('2026-10-07T15:00:00Z',90)],140).streak,0);
});
test('Period report groups by day and exports with Russian decimals',()=>{
  const list=[{date:'2026-10-06T15:00:00Z',total:100,counts:{Успешно:25},comm:3,duration:28800000},{date:'2026-10-06T20:00:00Z',total:20,counts:{Успешно:5},comm:1,duration:3600000},{date:'2026-09-01T15:00:00Z',total:99,counts:{}}].map(h=>C.shiftEntry(h));
  const r=C.report(list,Date.parse('2026-10-01T00:00:00Z'),Date.parse('2026-10-08T00:00:00Z'));
  assert.equal(r.rows.length,1);assert.equal(r.sum.calls,120);assert.equal(r.sum.shifts,2);
  const csv=C.reportCsv(r,120);
  assert.ok(csv.includes('"2026-10-06";"2";"120";"30";"25,0";"4";"9,0";"13,3";"да"'));
  assert.ok(csv.includes('"Итого";"2";"120";"30";"25,0";"4";"9,0";"13,3";"1 из 1"'));
});
