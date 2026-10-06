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
  assert.ok(csv.includes('"A,""B""\nC","3"'));
  assert.ok(csv.includes('"\'=1+1","1"'));
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
