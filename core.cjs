'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ORIGIN = 'https://uzembassyryouji.rsvsys.jp';
const CATEGORY = 'VISA Application for short stay (Applicant)';
const FIELDS = {
  family: 'user-guest-users-addition-values-4-0',
  given: 'user-guest-users-addition-values-4-1',
  phone: 'user-guest-users-addition-values-16',
  email: 'user-guest-users-mail',
  passport: 'user-guest-users-addition-values-20',
  emailConfirm: 'user-guest-users-mail-confirm'
};
const LOCKED = new Set(['submitting', 'uncertain', 'booked', 'waitlisted']);
function validateCandidate(raw) {
  const c = {};
  for (const k of ['family','given','phone','email','passport']) {
    c[k] = String(raw[k] || '').trim();
    if (!c[k] || c[k].length > 150 || /[\r\n\x00-\x1f]/.test(c[k])) throw new Error(`${k}: maydonni tekshiring`);
  }
  for (const k of ['family','given']) if (!/^[A-Za-zÀ-ž '\u2018\u2019-]+$/.test(c[k])) throw new Error('Ism/familiya lotin alifbosida bo‘lsin');
  if (!/^\+?[0-9 ()-]{7,25}$/.test(c.phone)) throw new Error('Telefon raqamini tekshiring');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new Error('Emailni tekshiring');
  if (!/^[A-Za-z]{2}[0-9]{7}$/.test(c.passport)) throw new Error('To‘liq pasport raqami kerak: 2 harf va 7 raqam');
  // Values are not silently reformatted before transmission.
  return c;
}
function passportKey(c) { return crypto.createHash('sha256').update(c.passport.toUpperCase()).digest('hex'); }
function tashkentParts(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
function months(date = new Date()) {
  const {date:d} = tashkentParts(date);
  const [y,m] = d.split('-').map(Number);
  return [`${y}-${String(m).padStart(2,'0')}-01`,`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];
}
function releaseTime(date = new Date(),time='18:00') {
  let target = new Date(`${tashkentParts(date).date}T${time}:00+05:00`);
  if (target <= date) target = new Date(target.getTime()+86400000);
  return target.toISOString();
}
function slotFromHref(href, today = tashkentParts().date) {
  let u;
  try { u = new URL(href, ORIGIN); } catch { return null; }
  if (u.origin !== ORIGIN || u.pathname !== '/reservations/option' || u.searchParams.get('event_id') !== '20' || u.searchParams.get('event_plan_id') !== '19') return null;
  const date = (u.searchParams.get('date')||'').replaceAll('/','-');
  const time = u.searchParams.get('time_from')||'';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !/^\d{2}:\d{2}$/.test(time)) return null;
  return {url:u.href,date,time};
}
function classifyResult({url='',heading='',text='',hasReserve=false}) {
  if (hasReserve || /\/reservations\/(?:user|form|option|calendar|conf|confirm)(?:\/|\?|$)/.test(url)) return 'uncertain';
  if (/error|失敗|xato|ошибк|できません|not completed|unsuccessful/i.test(heading)) return 'uncertain';
  // Require explicit completed-state language, not an email field or an invitation to reserve.
  if (/キャンセル待ち.*(?:完了|受け付け)|waitlist.*(?:confirmed|registered)|kutish ro.yxatiga.*(?:olindi|qo.yildi)/i.test(heading)) return 'waitlisted';
  if (/予約(?:手続き)?(?:が|は)?完了|予約を受け付けました|reservation (?:is |has been )?(?:complete|completed|confirmed)|successfully (?:reserved|booked)|band(?:lov| qilish).*muvaffaqiyatli|ro.yxatdan (?:o.tildi|o.tdingiz)|бронирование.*(?:завершено|подтверждено)/i.test(heading)) return 'booked';
  return 'uncertain';
}
function verifyReview(text, candidate, slot) {
  const normalized = text.replace(/\s+/g,' ').normalize('NFKC');
  if (!normalized.includes(CATEGORY)) throw new Error('Tasdiqlashda Short stay (Applicant) topilmadi');
  for (const k of ['family','given','phone','email','passport']) if (!normalized.includes(candidate[k].normalize('NFKC'))) throw new Error(`Tasdiqlashda ${k} mos kelmadi`);
  if (!normalized.includes(slot.date.replaceAll('-','/')) && !normalized.includes(slot.date)) throw new Error('Tasdiqlash sanasi mos emas');
  if (!normalized.includes(slot.time)) throw new Error('Tasdiqlash vaqti mos emas');
}

class Store {
  constructor(dir) {
    fs.mkdirSync(dir,{recursive:true});
    this.dir = dir;
    this.db = new DatabaseSync(path.join(dir,'agent.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, passport_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', slot TEXT, note TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at TEXT NOT NULL, candidate_id TEXT, message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, dedupe TEXT UNIQUE, message TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS evidence(id INTEGER PRIMARY KEY, candidate_id TEXT, stage TEXT NOT NULL, file TEXT NOT NULL, captured_at TEXT NOT NULL, url TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    if(!this.db.prepare('PRAGMA table_info(outbox)').all().some(c=>c.name==='media'))this.db.exec('ALTER TABLE outbox ADD COLUMN media TEXT');
  }
  recover() {
    this.db.prepare("UPDATE candidates SET state='uncertain',note='Yuborish paytida dastur yopilgan. Emailni tekshiring.' WHERE state='submitting'").run();
    this.db.prepare("UPDATE candidates SET state='queued',note='Dastur qayta ishga tushdi' WHERE state='working'").run();
  }
  add(raw) {
    const c = validateCandidate(raw), id = crypto.randomUUID();
    try { this.db.prepare('INSERT INTO candidates(id,passport_key,payload,updated) VALUES(?,?,?,?)').run(id,passportKey(c),JSON.stringify(c),new Date().toISOString()); }
    catch(e) { if(String(e.message).includes('UNIQUE')) throw new Error('Bu pasport ro‘yxatda allaqachon mavjud'); throw e; }
    return id;
  }
  get(id) {
    const r = this.db.prepare('SELECT * FROM candidates WHERE id=?').get(id);
    if(!r) throw new Error('Nomzod topilmadi');
    return {...r, ...JSON.parse(r.payload),slot:r.slot?JSON.parse(r.slot):null};
  }
  findCode(code){const matches=this.list().filter(c=>c.id.startsWith(code));if(matches.length!==1)throw new Error('Nomzod kodi topilmadi yoki bir xil boshlandi');return matches[0];}
  update(id,raw){
    if(!['queued','paused','review','archived'].includes(this.get(id).state))throw new Error('Bu holatda nomzodni tahrirlab bo‘lmaydi');
    const c=validateCandidate(raw);
    try{this.db.prepare("UPDATE candidates SET payload=?,passport_key=?,state='queued',note='',updated=? WHERE id=?").run(JSON.stringify(c),passportKey(c),new Date().toISOString(),id);}
    catch(e){if(String(e.message).includes('UNIQUE'))throw new Error('Bu pasport allaqachon ro‘yxatda');throw e;}
  }
  archive(id){const c=this.get(id);if(!['queued','paused','review'].includes(c.state))throw new Error('Bu nomzodni navbatdan olib bo‘lmaydi');this.transition(id,'archived','Navbatdan olindi');}
  claim(id,slot){const r=this.db.prepare("UPDATE candidates SET state='working',slot=?,note='Forma ochilmoqda',updated=? WHERE id=? AND state='queued'").run(JSON.stringify(slot),new Date().toISOString(),id);return r.changes===1;}
  list() { return this.db.prepare('SELECT id FROM candidates ORDER BY rowid').all().map(r=>this.get(r.id)); }
  publicList() { return this.list().map(({payload,passport_key,passport,...c})=>({...c,passportMasked:`${passport.slice(0,2)}••••${passport.slice(-3)}`})); }
  transition(id,state,note='',slot) {
    const prev=this.get(id);
    if (LOCKED.has(prev.state) && state!==prev.state && !(prev.state==='submitting' && ['booked','waitlisted','uncertain'].includes(state))) throw new Error('Qayta bron bloklangan; natijani avval tekshiring');
    this.db.prepare('UPDATE candidates SET state=?,note=?,slot=?,updated=? WHERE id=?').run(state,note,JSON.stringify(slot||prev.slot),new Date().toISOString(),id);
    this.event(note||state,id);
  }
  resolve(id,outcome) {
    const c=this.get(id);
    if(!['uncertain','review','paused','failed'].includes(c.state)) throw new Error('Bu holatni qo‘lda o‘zgartirib bo‘lmaydi');
    if(!['booked','waitlisted','queued'].includes(outcome)) throw new Error('Noto‘g‘ri holat');
    this.db.prepare('UPDATE candidates SET state=?,note=?,updated=? WHERE id=?').run(outcome,'Foydalanuvchi natijani tekshirdi',new Date().toISOString(),id);
    this.event(`Qo‘lda tekshirildi: ${outcome}`,id);
  }
  event(message,id=null) { this.db.prepare('INSERT INTO events(at,candidate_id,message) VALUES(?,?,?)').run(new Date().toISOString(),id,message); }
  events() { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 80').all(); }
  saveEvidence(candidateId,stage,shot){if(!shot)return;this.db.prepare('INSERT INTO evidence(candidate_id,stage,file,captured_at,url) VALUES(?,?,?,?,?)').run(candidateId,stage,shot.file,shot.capturedAt,shot.url);}
  evidence(candidateId){return this.db.prepare('SELECT id,stage,captured_at FROM evidence WHERE candidate_id=? ORDER BY id DESC LIMIT 30').all(candidateId);}
  evidenceFile(id){return this.db.prepare('SELECT * FROM evidence WHERE id=?').get(id);}
  notify(dedupe,message,media=null) { this.db.prepare('INSERT OR IGNORE INTO outbox(dedupe,message,media) VALUES(?,?,?)').run(dedupe,message,media?JSON.stringify(media):null); }
  finish(id,state,note,slot,notification){
    this.db.exec('BEGIN IMMEDIATE');
    try{this.transition(id,state,note,slot);this.notify(notification.key,notification.message,notification.media);this.db.exec('COMMIT');}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  pending() { return this.db.prepare('SELECT * FROM outbox WHERE sent=0 ORDER BY id LIMIT 10').all(); }
  sent(id) { this.db.prepare('UPDATE outbox SET sent=1 WHERE id=?').run(id); }
  setting(key,fallback) { const r=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r?JSON.parse(r.value):fallback; }
  saveSetting(key,value) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  close(){this.db.close();}
}
module.exports={ORIGIN,CATEGORY,FIELDS,Store,validateCandidate,passportKey,tashkentParts,months,releaseTime,slotFromHref,classifyResult,verifyReview};
