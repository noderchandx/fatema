'use strict';
/* =====================================================================
   মাদ্রাসা ম্যানেজমেন্ট সিস্টেম — ফ্রন্টএন্ড (Supabase)
   ===================================================================== */

const CFG = window.APP_CONFIG || {};
const PASS_PCT = 33; // প্রতি বিষয়ে পাস নম্বর (শতকরা)

/* ---------- helpers ---------- */
const BND = '০১২৩৪৫৬৭৮৯';
const bn = v => String(v ?? '').replace(/\d/g, d => BND[d]);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const V = () => $('#view');
const NOPHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 96"><rect width="80" height="96" fill="#eef2f0"/><circle cx="40" cy="36" r="16" fill="#b8c7c1"/><path d="M8 96c0-22 14-34 32-34s32 12 32 34z" fill="#b8c7c1"/></svg>');

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return bn(`${dd}/${m}/${y}`);
}
const genderLabel = g => (g === 'male' ? 'ছেলে' : g === 'female' ? 'মেয়ে' : '—');

function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), 3600);
}

async function run(fn) {
  try { return await fn(); }
  catch (e) {
    console.error(e);
    let m = e?.message || 'কিছু একটা সমস্যা হয়েছে';
    if (/foreign key|violates/i.test(m)) m = 'এই তথ্যের সাথে অন্য তথ্য যুক্ত আছে, তাই মোছা/পরিবর্তন করা যায়নি।';
    toast(m, 'err');
  }
}

/* modal */
function openModal(title, html, wide) {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="বন্ধ">✕</button></div>
    <div class="modal-body">${html}</div></div></div>`;
  const root = $('#modal-root');
  root.onclick = e => { if (e.target.classList.contains('overlay') || e.target.closest('[data-close]')) closeModal(); };
  return root;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function delegate(handler) {
  V().onclick = e => {
    const el = e.target.closest('[data-act]');
    if (el) handler(el.dataset.act, el.dataset, el, e);
  };
}

async function fetchAll(build) {
  let all = [], from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await build().range(from, from + step - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function printHTML(html) {
  const pa = $('#print-area');
  pa.innerHTML = html;
  const imgs = $$('img', pa);
  await Promise.all(imgs.map(i => (i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))));
  window.print();
}

/* photos */
function resizeImage(file, max = 480) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); b ? res(b) : rej(new Error('ছবি প্রসেস করা যায়নি')); }, 'image/jpeg', 0.85);
    };
    img.onerror = () => rej(new Error('ছবি পড়া যায়নি'));
    img.src = url;
  });
}
async function uploadPhoto(file, folder) {
  const blob = await resizeImage(file);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
function bindPhotoPreview(form) {
  const inp = form.querySelector('input[type=file]');
  const prev = form.querySelector('.ph-prev');
  if (inp && prev) inp.onchange = () => { if (inp.files[0]) prev.src = URL.createObjectURL(inp.files[0]); };
}

/* qr */
function verifyUrl(token) {
  const base = CFG.SITE_URL || (location.origin + location.pathname);
  return `${base}?verify=${token}`;
}
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}

/* ---------- supabase ---------- */
const configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/YOUR-/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY);
const sb = configured ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const S = { classes: [], subjects: [], exams: [], settings: {}, students: [] };

async function loadClasses() {
  const { data, error } = await sb.from('classes').select('*').order('sort_order').order('id');
  if (error) throw error; S.classes = data;
}
async function loadSubjects() {
  const { data, error } = await sb.from('subjects').select('*').order('sort_order').order('id');
  if (error) throw error; S.subjects = data;
}
async function loadExams() {
  const { data, error } = await sb.from('exams').select('*').order('year', { ascending: false }).order('id', { ascending: false });
  if (error) throw error; S.exams = data;
}
async function loadSettings() {
  const { data, error } = await sb.from('settings').select('*');
  if (error) throw error;
  S.settings = Object.fromEntries(data.map(r => [r.key, r.value]));
}
async function loadBase() { await Promise.all([loadClasses(), loadSubjects(), loadExams(), loadSettings()]); }

const cName = id => S.classes.find(c => c.id == id)?.name || '—';
const cOrd = id => { const i = S.classes.findIndex(c => c.id == id); return i < 0 ? 999 : i; };
const classOpts = (sel, withAll) =>
  (withAll ? `<option value="all">সব শ্রেণি</option>` : '') +
  S.classes.map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const examOpts = sel => S.exams.map(e => `<option value="${e.id}" ${e.id == sel ? 'selected' : ''}>${esc(e.name)} (${bn(e.year)})${e.is_final ? ' ★' : ''}</option>`).join('');

/* ---------- grading ---------- */
function gradeOf(pct) {
  if (pct >= 80) return ['A+', 5];
  if (pct >= 70) return ['A', 4];
  if (pct >= 60) return ['A-', 3.5];
  if (pct >= 50) return ['B', 3];
  if (pct >= 40) return ['C', 2];
  if (pct >= PASS_PCT) return ['D', 1];
  return ['F', 0];
}
function letterFromGpa(g) {
  if (g === null) return '—';
  if (g >= 5) return 'A+'; if (g >= 4) return 'A'; if (g >= 3.5) return 'A-';
  if (g >= 3) return 'B'; if (g >= 2) return 'C'; if (g >= 1) return 'D'; return 'F';
}
const STATUS_LABEL = { pass: 'উত্তীর্ণ', fail: 'অনুত্তীর্ণ', incomplete: 'অসম্পূর্ণ' };
const STATUS_CLS = { pass: 'ok', fail: 'fail', incomplete: 'warn' };

async function computeClass(examId, classId) {
  const subs = S.subjects.filter(s => s.class_id == classId);
  if (!subs.length) return { subs, rows: [], fullTotal: 0 };
  const ids = subs.map(s => s.id);
  const data = await fetchAll(() => sb.from('results')
    .select('id,student_id,subject_id,marks,students(id,name,roll,father_name,mother_name,dob,gender,photo_url,birth_reg_no,verify_token)')
    .eq('exam_id', examId).in('subject_id', ids).order('id'));
  const map = new Map();
  for (const r of data) {
    if (!r.students) continue;
    let o = map.get(r.student_id);
    if (!o) { o = { student: r.students, marks: {} }; map.set(r.student_id, o); }
    o.marks[r.subject_id] = Number(r.marks);
  }
  const fullTotal = subs.reduce((a, s) => a + Number(s.full_marks), 0);
  const rows = [...map.values()].map(o => {
    let total = 0, gpSum = 0, fail = false, missing = false;
    const subRes = {};
    for (const s of subs) {
      const m = o.marks[s.id];
      if (m == null) { missing = true; subRes[s.id] = null; continue; }
      const pct = (m / Number(s.full_marks)) * 100;
      const [g, gp] = gradeOf(pct);
      total += m; gpSum += gp;
      if (pct < PASS_PCT) fail = true;
      subRes[s.id] = { m, g, gp };
    }
    const status = fail ? 'fail' : missing ? 'incomplete' : 'pass';
    const gpa = status === 'pass' ? gpSum / subs.length : status === 'fail' ? 0 : null;
    return { student: o.student, subRes, total, fullTotal, pct: fullTotal ? (total / fullTotal) * 100 : 0, gpa, grade: letterFromGpa(gpa), status, pos: null };
  });
  rows.sort((a, b) => (a.student.roll - b.student.roll));
  const passed = rows.filter(r => r.status === 'pass');
  rows.forEach(r => { if (r.status === 'pass') r.pos = 1 + passed.filter(p => p.total > r.total).length; });
  return { subs, rows, fullTotal };
}

const f2 = n => bn(Number(n).toFixed(2));
const fm = n => bn(Number.isInteger(n) ? n : Number(n.toFixed(2)));

/* =====================================================================
   Auth / boot
   ===================================================================== */
const NAV = [
  ['dashboard', '📊', 'ড্যাশবোর্ড'],
  ['students', '🎓', 'শিক্ষার্থী'],
  ['teachers', '👨‍🏫', 'শিক্ষক'],
  ['subjects', '📚', 'বিষয়'],
  ['exams', '📝', 'পরীক্ষা ও নম্বর এন্ট্রি'],
  ['results', '🏅', 'ফলাফল ও মার্কশীট'],
  ['summary', '🏫', 'মাদ্রাসার সব ফলাফল'],
  ['promotion', '⬆️', 'প্রমোশন'],
  ['idcards', '🪪', 'আইডি কার্ড'],
  ['settings', '⚙️', 'সেটিংস'],
];

function show(id) {
  ['setup-warning', 'verify-screen', 'login-screen', 'app'].forEach(x => ($('#' + x).hidden = x !== id));
}

async function isAdmin() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return !!data;
}

async function boot() {
  if (!configured) return show('setup-warning');
  const v = new URLSearchParams(location.search).get('verify');
  if (v) return showVerify(v);
  const { data: { session } } = await sb.auth.getSession();
  if (session && await isAdmin()) startApp(); else showLogin();
}

function showLogin() {
  show('login-screen');
  const f = $('#loginForm');
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    $('#loginErr').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) { $('#loginErr').textContent = 'ইমেইল বা পাসওয়ার্ড ভুল'; btn.disabled = false; return; }
    if (!(await isAdmin())) {
      await sb.auth.signOut();
      $('#loginErr').textContent = 'এই অ্যাকাউন্টের অ্যাডমিন অনুমতি নেই';
      btn.disabled = false; return;
    }
    btn.disabled = false; f.reset();
    startApp();
  };
}

async function startApp() {
  show('app');
  await run(loadBase);
  $('#sidebar').innerHTML = `<div class="brand">🕌 ${esc(S.settings.madrasa_name || 'মাদ্রাসা')}</div>` +
    NAV.map(([k, ic, t]) => `<a href="#/${k}" data-nav="${k}"><span>${ic}</span>${t}</a>`).join('') +
    `<button class="btn logout" id="logoutBtn">লগআউট</button>`;
  $('#logoutBtn').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  document.body.classList.remove('nav-open');
  const page = location.hash.replace(/^#\//, '') || 'dashboard';
  const item = NAV.find(n => n[0] === page) || NAV[0];
  $$('#sidebar a').forEach(a => a.classList.toggle('on', a.dataset.nav === item[0]));
  $('#topTitle').textContent = item[2];
  V().onclick = null;
  V().innerHTML = '<p class="muted">লোড হচ্ছে…</p>';
  await run(() => pages[item[0]]());
}

/* =====================================================================
   Verify (public QR page)
   ===================================================================== */
async function showVerify(token) {
  show('verify-screen');
  const box = $('#verify-screen');
  box.innerHTML = '<div class="auth-card"><p>যাচাই করা হচ্ছে…</p></div>';
  const { data, error } = await sb.rpc('verify_student', { p_token: token });
  if (error || !data) {
    box.innerHTML = `<div class="auth-card verify-bad"><h1 style="color:var(--danger)">❌ যাচাই ব্যর্থ</h1>
      <p>এই কিউআর কোডটি বৈধ নয় অথবা শিক্ষার্থীর তথ্য পাওয়া যায়নি।</p></div>`;
    return;
  }
  box.innerHTML = `<div class="auth-card verify-ok">
    <h1 style="color:var(--ok)">✅ যাচাইকৃত শিক্ষার্থী</h1>
    <p class="muted" style="margin-top:0">${esc(data.madrasa || '')}</p>
    <div style="display:flex;gap:14px;align-items:flex-start">
      <dl class="kv" style="grid-template-columns:78px 1fr;min-width:0;margin:0">
        <dt>নাম</dt><dd>${esc(data.name)}</dd>
        <dt>আইডি</dt><dd>${bn(data.student_id)}</dd>
        <dt>শ্রেণি</dt><dd>${esc(data.class || '—')}</dd>
        <dt>রোল</dt><dd>${bn(data.roll)}</dd>
        <dt>অবস্থা</dt><dd>${data.status === 'active' ? '<span class="badge ok">অধ্যয়নরত</span>' : '<span class="badge gray">সমাপ্ত</span>'}</dd>
      </dl>
    </div></div>`;
}

/* =====================================================================
   Pages
   ===================================================================== */
const pages = {};

/* ---------- Dashboard ---------- */
pages.dashboard = async () => {
  const students = await fetchAll(() => sb.from('students').select('id,class_id,gender,status').order('id'));
  const { count: tc } = await sb.from('teachers').select('*', { count: 'exact', head: true });
  const act = students.filter(s => s.status === 'active');
  const boys = act.filter(s => s.gender === 'male').length;
  const girls = act.filter(s => s.gender === 'female').length;
  V().innerHTML = `<h2>ড্যাশবোর্ড</h2>
  <div class="stats">
    <div class="stat"><b>${bn(act.length)}</b><span>মোট শিক্ষার্থী</span></div>
    <div class="stat"><b>${bn(boys)}</b><span>ছেলে</span></div>
    <div class="stat"><b>${bn(girls)}</b><span>মেয়ে</span></div>
    <div class="stat"><b>${bn(tc || 0)}</b><span>শিক্ষক</span></div>
    <div class="stat"><b>${bn(S.classes.length)}</b><span>শ্রেণি</span></div>
  </div>
  <div class="card"><h3>শ্রেণি অনুযায়ী শিক্ষার্থী</h3><div class="tbl-wrap"><table class="data">
    <thead><tr><th>শ্রেণি</th><th class="c">ছেলে</th><th class="c">মেয়ে</th><th class="c">মোট</th></tr></thead><tbody>
    ${S.classes.map(c => {
      const l = act.filter(s => s.class_id == c.id);
      return `<tr><td>${esc(c.name)}</td><td class="c">${bn(l.filter(s => s.gender === 'male').length)}</td><td class="c">${bn(l.filter(s => s.gender === 'female').length)}</td><td class="c"><b>${bn(l.length)}</b></td></tr>`;
    }).join('')}</tbody></table></div></div>
  <div class="row"><div class="auto"><a class="btn primary" href="#/students">+ শিক্ষার্থী যোগ করুন</a></div>
  <div class="auto"><a class="btn" href="#/exams">নম্বর এন্ট্রি</a></div>
  <div class="auto"><a class="btn" href="#/idcards">আইডি কার্ড</a></div></div>`;
};

/* ---------- Students ---------- */
const SF = { cls: 'all', q: '', status: 'active' };

pages.students = async () => {
  S.students = await fetchAll(() => sb.from('students').select('*').order('id'));
  drawStudents();
};

function studentRows() {
  const q = SF.q.trim().toLowerCase();
  return S.students
    .filter(s => (SF.status === 'all' || s.status === SF.status) && (SF.cls === 'all' || s.class_id == SF.cls) &&
      (!q || [s.name, s.id, s.roll, s.father_name, s.mother_name].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (cOrd(a.class_id) - cOrd(b.class_id)) || (a.roll - b.roll));
}
function studentsTable() {
  const list = studentRows();
  if (!list.length) return '<div class="empty">কোনো শিক্ষার্থী পাওয়া যায়নি</div>';
  return `<div class="tbl-wrap"><table class="data"><thead><tr><th>ছবি</th><th>আইডি</th><th>নাম</th><th class="c">রোল</th><th>শ্রেণি</th><th>পিতার নাম</th><th></th></tr></thead><tbody>
  ${list.map(s => `<tr>
    <td><img class="thumb" src="${esc(s.photo_url || NOPHOTO)}" alt=""></td>
    <td>${bn(s.id)}</td><td><b>${esc(s.name)}</b>${s.status !== 'active' ? ' <span class="badge gray">সমাপ্ত</span>' : ''}</td>
    <td class="c">${bn(s.roll)}</td><td>${esc(cName(s.class_id))}</td><td>${esc(s.father_name)}</td>
    <td style="white-space:nowrap"><button class="btn sm" data-act="view" data-id="${s.id}">দেখুন</button>
      <button class="btn sm" data-act="edit" data-id="${s.id}">সম্পাদনা</button>
      <button class="btn sm danger" data-act="del" data-id="${s.id}">মুছুন</button></td></tr>`).join('')}
  </tbody></table></div><p class="muted"><small>মোট ${bn(list.length)} জন</small></p>`;
}
function drawStudents() {
  const counts = {};
  S.students.filter(s => s.status === 'active').forEach(s => { counts[s.class_id] = (counts[s.class_id] || 0) + 1; });
  const totalActive = Object.values(counts).reduce((a, b) => a + b, 0);
  V().innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    <h2 style="margin:0">শিক্ষার্থী ব্যবস্থাপনা</h2><button class="btn primary" data-act="add">+ নতুন শিক্ষার্থী</button></div>
  <div class="tabs"><button class="tab ${SF.cls === 'all' ? 'on' : ''}" data-act="cls" data-v="all">সব (${bn(totalActive)})</button>
    ${S.classes.map(c => `<button class="tab ${SF.cls == c.id ? 'on' : ''}" data-act="cls" data-v="${c.id}">${esc(c.name)} (${bn(counts[c.id] || 0)})</button>`).join('')}</div>
  <div class="card"><div class="row" style="margin-bottom:12px">
    <div><label>খুঁজুন (নাম / আইডি / রোল / পিতা)</label><input id="stuQ" value="${esc(SF.q)}" placeholder="খুঁজুন…"></div>
    <div class="auto"><label>অবস্থা</label><select id="stuStatus">
      <option value="active" ${SF.status === 'active' ? 'selected' : ''}>অধ্যয়নরত</option>
      <option value="passed_out" ${SF.status === 'passed_out' ? 'selected' : ''}>সমাপ্ত</option>
      <option value="all" ${SF.status === 'all' ? 'selected' : ''}>সব</option></select></div></div>
    <div id="stuTable">${studentsTable()}</div></div>`;
  $('#stuQ').oninput = e => { SF.q = e.target.value; $('#stuTable').innerHTML = studentsTable(); };
  $('#stuStatus').onchange = e => { SF.status = e.target.value; drawStudents(); };
  delegate(async (act, d) => {
    if (act === 'cls') { SF.cls = d.v; drawStudents(); }
    if (act === 'add') studentForm();
    if (act === 'view') viewStudent(d.id);
    if (act === 'edit') studentForm(d.id);
    if (act === 'del') {
      const s = S.students.find(x => x.id == d.id);
      if (!confirm(`"${s.name}" (আইডি ${bn(s.id)}) কে মুছে ফেলবেন? এর সব ফলাফলও মুছে যাবে।`)) return;
      await run(async () => {
        const { error } = await sb.from('students').delete().eq('id', s.id);
        if (error) throw error;
        S.students = S.students.filter(x => x.id != s.id);
        toast('মুছে ফেলা হয়েছে'); drawStudents();
      });
    }
  });
}

function studentFormHTML(s, defCls) {
  return `<form id="stuForm" class="grid2">
  <div class="full photo-field"><img class="ph-prev" src="${esc(s?.photo_url || NOPHOTO)}" alt="">
    <div style="flex:1"><label>ছবি</label><input type="file" name="photo" accept="image/*"><small class="muted">ছবি স্বয়ংক্রিয়ভাবে ছোট করে আপলোড হবে</small></div></div>
  <div><label>শিক্ষার্থী আইডি</label><input value="${s ? bn(s.id) : 'স্বয়ংক্রিয় (১০০০ থেকে)'}" disabled></div>
  <div><label>শ্রেণি *</label><select name="class_id" required>${classOpts(s?.class_id || defCls)}</select></div>
  <div><label>নাম *</label><input name="name" required value="${esc(s?.name)}"></div>
  <div><label>রোল *</label><input name="roll" type="number" min="1" required value="${esc(s?.roll)}"></div>
  <div><label>পিতার নাম *</label><input name="father_name" required value="${esc(s?.father_name)}"></div>
  <div><label>মাতার নাম *</label><input name="mother_name" required value="${esc(s?.mother_name)}"></div>
  <div><label>জন্মনিবন্ধন নম্বর</label><input name="birth_reg_no" value="${esc(s?.birth_reg_no)}"></div>
  <div><label>জন্ম তারিখ</label><input name="dob" type="date" value="${esc(s?.dob)}"></div>
  <div><label>লিঙ্গ *</label><select name="gender" required><option value="">নির্বাচন করুন</option><option value="male">ছেলে</option><option value="female">মেয়ে</option></select></div>
  ${s ? `<div><label>অবস্থা</label><select name="status"><option value="active">অধ্যয়নরত</option><option value="passed_out">সমাপ্ত</option></select></div>` : ''}
  <div class="full actions"><button class="btn" type="button" data-close>বাতিল</button><button class="btn primary" type="submit">সংরক্ষণ করুন</button></div></form>`;
}

function studentForm(id) {
  const s = id ? S.students.find(x => x.id == id) : null;
  const defCls = SF.cls !== 'all' ? SF.cls : S.classes[0]?.id;
  if (!S.classes.length) return toast('আগে সেটিংস থেকে শ্রেণি যোগ করুন', 'err');
  openModal(s ? 'শিক্ষার্থীর তথ্য সম্পাদনা' : 'নতুন শিক্ষার্থী ভর্তি', studentFormHTML(s, defCls));
  const f = $('#stuForm');
  f.gender.value = s?.gender || '';
  if (s) f.status.value = s.status;
  bindPhotoPreview(f);
  const suggestRoll = () => {
    if (s) return;
    const rolls = S.students.filter(x => x.class_id == f.class_id.value && x.status === 'active').map(x => x.roll);
    f.roll.value = (rolls.length ? Math.max(...rolls) : 0) + 1;
  };
  suggestRoll();
  f.class_id.onchange = suggestRoll;
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    await run(async () => {
      let photo = s?.photo_url || null;
      if (f.photo.files[0]) photo = await uploadPhoto(f.photo.files[0], 'students');
      const row = {
        name: f.name.value.trim(), roll: +f.roll.value, father_name: f.father_name.value.trim(),
        mother_name: f.mother_name.value.trim(), birth_reg_no: f.birth_reg_no.value.trim() || null,
        dob: f.dob.value || null, gender: f.gender.value, class_id: +f.class_id.value, photo_url: photo,
      };
      if (s) row.status = f.status.value;
      const dup = S.students.some(x => x.id != s?.id && x.class_id == row.class_id && x.roll == row.roll && x.status === 'active');
      if (dup && !confirm('এই শ্রেণিতে এই রোল আগে থেকেই আছে। তবুও সংরক্ষণ করবেন?')) { btn.disabled = false; return; }
      if (s) {
        const { data, error } = await sb.from('students').update(row).eq('id', s.id).select().single();
        if (error) throw error;
        S.students = S.students.map(x => (x.id == s.id ? data : x));
        toast('তথ্য হালনাগাদ হয়েছে');
      } else {
        const { data, error } = await sb.from('students').insert(row).select().single();
        if (error) throw error;
        S.students.push(data);
        toast(`শিক্ষার্থী যোগ হয়েছে — আইডি: ${bn(data.id)}`);
      }
      closeModal(); drawStudents();
    });
    btn.disabled = false;
  };
}

function viewStudent(id) {
  const s = S.students.find(x => x.id == id);
  const url = verifyUrl(s.verify_token);
  openModal('শিক্ষার্থীর সম্পূর্ণ তথ্য', `
  <div class="detail">
    <div><img class="ph" src="${esc(s.photo_url || NOPHOTO)}" alt=""><div class="qr-box" style="margin-top:10px">${qrSvg(url)}</div></div>
    <dl class="kv">
      <dt>আইডি</dt><dd>${bn(s.id)}</dd>
      <dt>নাম</dt><dd>${esc(s.name)}</dd>
      <dt>শ্রেণি</dt><dd>${esc(cName(s.class_id))}</dd>
      <dt>রোল</dt><dd>${bn(s.roll)}</dd>
      <dt>পিতার নাম</dt><dd>${esc(s.father_name)}</dd>
      <dt>মাতার নাম</dt><dd>${esc(s.mother_name)}</dd>
      <dt>জন্মনিবন্ধন নম্বর</dt><dd>${esc(bn(s.birth_reg_no || '—'))}</dd>
      <dt>জন্ম তারিখ</dt><dd>${fmtDate(s.dob)}</dd>
      <dt>লিঙ্গ</dt><dd>${genderLabel(s.gender)}</dd>
      <dt>অবস্থা</dt><dd>${s.status === 'active' ? 'অধ্যয়নরত' : 'সমাপ্ত'}</dd>
      <dt>ভর্তির তারিখ</dt><dd>${fmtDate(s.created_at)}</dd>
    </dl>
  </div><hr>
  <div class="row">
    <div><label>মার্কশীট দেখুন — পরীক্ষা</label><select id="vsExam">${examOpts()}</select></div>
    <div class="auto"><button class="btn" id="vsMark" ${S.exams.length ? '' : 'disabled'}>মার্কশীট</button></div>
    <div class="auto"><button class="btn" id="vsCard">আইডি কার্ড প্রিন্ট</button></div>
    <div class="auto"><button class="btn primary" id="vsEdit">সম্পাদনা</button></div>
  </div>`, true);
  $('#vsEdit').onclick = () => studentForm(s.id);
  $('#vsCard').onclick = () => printHTML(`<div class="cards">${cardHTML(s, S.settings.session_year)}</div>`);
  $('#vsMark').onclick = () => run(() => openMarksheetFor(s.id, +$('#vsExam').value));
}

/* ---------- Teachers ---------- */
let TEACHERS = [];
pages.teachers = async () => {
  const { data, error } = await sb.from('teachers').select('*').order('id');
  if (error) throw error;
  TEACHERS = data; drawTeachers();
};
function drawTeachers() {
  V().innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    <h2 style="margin:0">শিক্ষক ব্যবস্থাপনা</h2><button class="btn primary" data-act="add">+ নতুন শিক্ষক</button></div>
  <div class="card">${TEACHERS.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>ছবি</th><th>নাম</th><th>পদবি</th><th>মোবাইল</th><th>যোগদান</th><th></th></tr></thead><tbody>
  ${TEACHERS.map(t => `<tr><td><img class="thumb" src="${esc(t.photo_url || NOPHOTO)}" alt=""></td>
    <td><b>${esc(t.name)}</b></td><td>${esc(t.designation || '—')}</td><td>${esc(bn(t.phone || '—'))}</td><td>${fmtDate(t.joining_date)}</td>
    <td style="white-space:nowrap"><button class="btn sm" data-act="view" data-id="${t.id}">দেখুন</button>
    <button class="btn sm" data-act="edit" data-id="${t.id}">সম্পাদনা</button>
    <button class="btn sm danger" data-act="del" data-id="${t.id}">মুছুন</button></td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty">কোনো শিক্ষক যোগ করা হয়নি</div>'}</div>`;
  delegate(async (act, d) => {
    if (act === 'add') teacherForm();
    if (act === 'edit') teacherForm(d.id);
    if (act === 'view') {
      const t = TEACHERS.find(x => x.id == d.id);
      openModal('শিক্ষকের তথ্য', `<div class="detail"><img class="ph" src="${esc(t.photo_url || NOPHOTO)}" alt=""><dl class="kv">
        <dt>নাম</dt><dd>${esc(t.name)}</dd><dt>পদবি</dt><dd>${esc(t.designation || '—')}</dd>
        <dt>শিক্ষাগত যোগ্যতা</dt><dd>${esc(t.qualification || '—')}</dd><dt>পাঠদানের বিষয়</dt><dd>${esc(t.subject_taught || '—')}</dd>
        <dt>মোবাইল</dt><dd>${esc(bn(t.phone || '—'))}</dd><dt>যোগদানের তারিখ</dt><dd>${fmtDate(t.joining_date)}</dd>
        <dt>ঠিকানা</dt><dd>${esc(t.address || '—')}</dd></dl></div>`, true);
    }
    if (act === 'del') {
      const t = TEACHERS.find(x => x.id == d.id);
      if (!confirm(`শিক্ষক "${t.name}" কে মুছে ফেলবেন?`)) return;
      await run(async () => {
        const { error } = await sb.from('teachers').delete().eq('id', t.id);
        if (error) throw error;
        TEACHERS = TEACHERS.filter(x => x.id != t.id); toast('মুছে ফেলা হয়েছে'); drawTeachers();
      });
    }
  });
}
function teacherForm(id) {
  const t = id ? TEACHERS.find(x => x.id == id) : null;
  openModal(t ? 'শিক্ষকের তথ্য সম্পাদনা' : 'নতুন শিক্ষক', `<form id="tchForm" class="grid2">
  <div class="full photo-field"><img class="ph-prev" src="${esc(t?.photo_url || NOPHOTO)}" alt=""><div style="flex:1"><label>ছবি</label><input type="file" name="photo" accept="image/*"></div></div>
  <div><label>নাম *</label><input name="name" required value="${esc(t?.name)}"></div>
  <div><label>পদবি</label><input name="designation" value="${esc(t?.designation)}" placeholder="যেমন: সহকারী শিক্ষক"></div>
  <div><label>শিক্ষাগত যোগ্যতা</label><input name="qualification" value="${esc(t?.qualification)}"></div>
  <div><label>পাঠদানের বিষয়</label><input name="subject_taught" value="${esc(t?.subject_taught)}"></div>
  <div><label>মোবাইল নম্বর</label><input name="phone" value="${esc(t?.phone)}"></div>
  <div><label>যোগদানের তারিখ</label><input name="joining_date" type="date" value="${esc(t?.joining_date)}"></div>
  <div class="full"><label>ঠিকানা</label><input name="address" value="${esc(t?.address)}"></div>
  <div class="full actions"><button class="btn" type="button" data-close>বাতিল</button><button class="btn primary" type="submit">সংরক্ষণ করুন</button></div></form>`);
  const f = $('#tchForm'); bindPhotoPreview(f);
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    await run(async () => {
      let photo = t?.photo_url || null;
      if (f.photo.files[0]) photo = await uploadPhoto(f.photo.files[0], 'teachers');
      const row = {
        name: f.name.value.trim(), designation: f.designation.value.trim() || null, qualification: f.qualification.value.trim() || null,
        subject_taught: f.subject_taught.value.trim() || null, phone: f.phone.value.trim() || null,
        joining_date: f.joining_date.value || null, address: f.address.value.trim() || null, photo_url: photo,
      };
      const q = t ? sb.from('teachers').update(row).eq('id', t.id) : sb.from('teachers').insert(row);
      const { error } = await q;
      if (error) throw error;
      toast('সংরক্ষিত হয়েছে'); closeModal(); await pages.teachers();
    });
    btn.disabled = false;
  };
}

/* ---------- Subjects ---------- */
let SUBC = null;
pages.subjects = async () => {
  if (!S.classes.length) { V().innerHTML = '<div class="empty">আগে সেটিংস থেকে শ্রেণি যোগ করুন</div>'; return; }
  if (!SUBC || !S.classes.some(c => c.id == SUBC)) SUBC = S.classes[0].id;
  drawSubjects();
};
function drawSubjects() {
  const list = S.subjects.filter(s => s.class_id == SUBC);
  V().innerHTML = `<h2>বিষয় ব্যবস্থাপনা</h2>
  <div class="card"><label>শ্রেণি নির্বাচন করুন</label><select id="subCls">${classOpts(SUBC)}</select></div>
  <div class="card"><h3>${esc(cName(SUBC))} শ্রেণির বিষয়সমূহ</h3>
  ${list.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>#</th><th>বিষয়ের নাম</th><th class="c">পূর্ণমান</th><th></th></tr></thead><tbody>
    ${list.map((s, i) => `<tr><td>${bn(i + 1)}</td><td>${esc(s.name)}</td><td class="c">${fm(Number(s.full_marks))}</td>
    <td><button class="btn sm danger" data-act="del" data-id="${s.id}">মুছুন</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">এই শ্রেণিতে এখনো কোনো বিষয় নেই</div>'}
  <hr><form id="subForm" class="row"><div><label>নতুন বিষয়ের নাম</label><input name="name" required placeholder="যেমন: কুরআন মাজিদ"></div>
  <div style="max-width:140px"><label>পূর্ণমান</label><input name="full" type="number" min="1" step="any" value="100" required></div>
  <div class="auto"><button class="btn primary" type="submit">+ বিষয় যোগ করুন</button></div></form>
  <hr><div class="row"><div><label>অন্য শ্রেণি থেকে বিষয় কপি করুন</label><select id="subCopy">${classOpts(null)}</select></div>
  <div class="auto"><button class="btn" id="subCopyBtn">কপি করুন</button></div></div></div>`;
  $('#subCls').onchange = e => { SUBC = e.target.value; drawSubjects(); };
  $('#subForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await run(async () => {
      const { error } = await sb.from('subjects').insert({ class_id: SUBC, name: f.name.value.trim(), full_marks: +f.full.value, sort_order: list.length + 1 });
      if (error) throw error.code === '23505' ? new Error('এই নামে বিষয় আগে থেকেই আছে') : error;
      await loadSubjects(); toast('বিষয় যোগ হয়েছে'); drawSubjects();
    });
  };
  $('#subCopyBtn').onclick = () => run(async () => {
    const src = $('#subCopy').value;
    if (src == SUBC) return toast('একই শ্রেণি নির্বাচন করেছেন', 'err');
    const have = new Set(list.map(s => s.name));
    const rows = S.subjects.filter(s => s.class_id == src && !have.has(s.name))
      .map((s, i) => ({ class_id: SUBC, name: s.name, full_marks: s.full_marks, sort_order: list.length + i + 1 }));
    if (!rows.length) return toast('কপি করার মতো নতুন বিষয় নেই', 'err');
    const { error } = await sb.from('subjects').insert(rows);
    if (error) throw error;
    await loadSubjects(); toast(`${bn(rows.length)}টি বিষয় কপি হয়েছে`); drawSubjects();
  });
  delegate(async (act, d) => {
    if (act !== 'del') return;
    const s = S.subjects.find(x => x.id == d.id);
    if (!confirm(`বিষয় "${s.name}" মুছবেন? এই বিষয়ের সব নম্বরও মুছে যাবে।`)) return;
    await run(async () => {
      const { error } = await sb.from('subjects').delete().eq('id', s.id);
      if (error) throw error;
      await loadSubjects(); toast('বিষয় মুছে ফেলা হয়েছে'); drawSubjects();
    });
  });
}

/* ---------- Exams & marks entry ---------- */
const ME = { exam: '', cls: '', sub: '' };
pages.exams = async () => { drawExams(); };

function drawExams() {
  if (!ME.exam || !S.exams.some(e => e.id == ME.exam)) ME.exam = S.exams[0]?.id || '';
  if (!ME.cls || !S.classes.some(c => c.id == ME.cls)) ME.cls = S.classes[0]?.id || '';
  V().innerHTML = `<h2>পরীক্ষা ও নম্বর এন্ট্রি</h2>
  <div class="card"><h3>পরীক্ষাসমূহ</h3>
  ${S.exams.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>নাম</th><th class="c">সাল</th><th>ধরন</th><th></th></tr></thead><tbody>
    ${S.exams.map(e => `<tr><td>${esc(e.name)}</td><td class="c">${bn(e.year)}</td><td>${e.is_final ? '<span class="badge ok">ফাইনাল</span>' : '<span class="badge gray">সাধারণ</span>'}</td>
    <td><button class="btn sm danger" data-act="delExam" data-id="${e.id}">মুছুন</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">কোনো পরীক্ষা নেই — নিচে যোগ করুন</div>'}
  <hr><form id="examForm" class="row"><div><label>পরীক্ষার নাম</label><input name="name" required placeholder="যেমন: বার্ষিক পরীক্ষা"></div>
  <div style="max-width:120px"><label>সাল</label><input name="year" type="number" required value="${esc(S.settings.session_year || new Date().getFullYear())}"></div>
  <div class="auto"><label class="inline"><input type="checkbox" name="final"> ফাইনাল পরীক্ষা</label></div>
  <div class="auto"><button class="btn primary" type="submit">+ পরীক্ষা যোগ করুন</button></div></form></div>

  <div class="card"><h3>বিষয় অনুযায়ী নম্বর এন্ট্রি</h3>
  <div class="row"><div><label>পরীক্ষা</label><select id="meExam">${examOpts(ME.exam)}</select></div>
  <div><label>শ্রেণি</label><select id="meCls">${classOpts(ME.cls)}</select></div>
  <div><label>বিষয়</label><select id="meSub"></select></div>
  <div class="auto"><button class="btn primary" id="meLoad">লোড করুন</button></div></div>
  <div id="meGrid" style="margin-top:14px"></div></div>`;
  const fillSubs = () => {
    const subs = S.subjects.filter(s => s.class_id == ME.cls);
    if (!subs.some(s => s.id == ME.sub)) ME.sub = subs[0]?.id || '';
    $('#meSub').innerHTML = subs.length ? subs.map(s => `<option value="${s.id}" ${s.id == ME.sub ? 'selected' : ''}>${esc(s.name)} (${fm(Number(s.full_marks))})</option>`).join('') : '<option value="">— বিষয় নেই —</option>';
  };
  fillSubs();
  $('#meExam').onchange = e => { ME.exam = e.target.value; };
  $('#meCls').onchange = e => { ME.cls = e.target.value; fillSubs(); };
  $('#meSub').onchange = e => { ME.sub = e.target.value; };
  $('#meLoad').onclick = () => run(loadMarksGrid);
  $('#examForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await run(async () => {
      const { error } = await sb.from('exams').insert({ name: f.name.value.trim(), year: +f.year.value, is_final: f.final.checked });
      if (error) throw error;
      await loadExams(); toast('পরীক্ষা যোগ হয়েছে'); drawExams();
    });
  };
  delegate(async (act, d) => {
    if (act !== 'delExam') return;
    const e = S.exams.find(x => x.id == d.id);
    if (!confirm(`পরীক্ষা "${e.name}" মুছবেন? এই পরীক্ষার সব নম্বর মুছে যাবে।`)) return;
    await run(async () => {
      const { error } = await sb.from('exams').delete().eq('id', e.id);
      if (error) throw error;
      await loadExams(); toast('মুছে ফেলা হয়েছে'); drawExams();
    });
  });
}

async function loadMarksGrid() {
  if (!ME.exam || !ME.cls || !ME.sub) return toast('পরীক্ষা, শ্রেণি ও বিষয় নির্বাচন করুন', 'err');
  const sub = S.subjects.find(s => s.id == ME.sub);
  const full = Number(sub.full_marks);
  const studs = await fetchAll(() => sb.from('students').select('id,name,roll').eq('class_id', ME.cls).eq('status', 'active').order('roll').order('id'));
  const res = await fetchAll(() => sb.from('results').select('id,student_id,marks').eq('exam_id', ME.exam).eq('subject_id', ME.sub).order('id'));
  const have = new Map(res.map(r => [r.student_id, Number(r.marks)]));
  const grid = $('#meGrid');
  if (!studs.length) { grid.innerHTML = '<div class="empty">এই শ্রেণিতে কোনো শিক্ষার্থী নেই</div>'; return; }
  grid.innerHTML = `<p class="muted">বিষয়: <b>${esc(sub.name)}</b> · পূর্ণমান: ${fm(full)} · পাস নম্বর: ${fm(Math.ceil(full * PASS_PCT / 100))} <small>(ফাঁকা রাখলে নম্বর এন্ট্রি হবে না; Enter চাপলে পরের ঘরে যাবে)</small></p>
  <div class="tbl-wrap"><table class="data"><thead><tr><th class="c">রোল</th><th>নাম</th><th style="width:160px">প্রাপ্ত নম্বর</th></tr></thead><tbody>
  ${studs.map(s => `<tr><td class="c">${bn(s.roll)}</td><td>${esc(s.name)}</td>
    <td><input type="number" inputmode="decimal" min="0" max="${full}" step="any" data-sid="${s.id}" value="${have.has(s.id) ? have.get(s.id) : ''}"></td></tr>`).join('')}
  </tbody></table></div><div class="actions" style="margin-top:12px"><button class="btn primary" id="meSave">নম্বর সংরক্ষণ করুন</button></div>`;
  grid.onkeydown = e => {
    if (e.key === 'Enter' && e.target.matches('input[data-sid]')) {
      e.preventDefault();
      const ins = $$('input[data-sid]', grid); const nx = ins[ins.indexOf(e.target) + 1] || e.target;
      nx.focus(); nx.select();
    }
  };
  $('#meSave').onclick = () => run(async () => {
    const up = [], del = [];
    let bad = null;
    $$('input[data-sid]', grid).forEach(inp => {
      const sid = +inp.dataset.sid, v = inp.value.trim();
      if (v === '') { if (have.has(sid)) del.push(sid); return; }
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > full) { bad = bad || inp; return; }
      up.push({ student_id: sid, exam_id: +ME.exam, subject_id: +ME.sub, marks: n });
    });
    if (bad) { bad.focus(); return toast(`নম্বর ০ থেকে ${bn(full)} এর মধ্যে হতে হবে`, 'err'); }
    if (up.length) { const { error } = await sb.from('results').upsert(up, { onConflict: 'student_id,exam_id,subject_id' }); if (error) throw error; }
    if (del.length) { const { error } = await sb.from('results').delete().eq('exam_id', ME.exam).eq('subject_id', ME.sub).in('student_id', del); if (error) throw error; }
    toast(`${bn(up.length)} জনের নম্বর সংরক্ষিত হয়েছে`);
    await loadMarksGrid();
  });
}

/* ---------- Marksheet ---------- */
function marksheetHTML(row, subs, exam, clsName) {
  const st = row.student, M = S.settings;
  return `<section class="ms">
  <div class="ms-head"><h1>${esc(M.madrasa_name)}</h1><p>${esc(M.madrasa_address || '')}${M.madrasa_phone ? ' · মোবাইল: ' + esc(bn(M.madrasa_phone)) : ''}</p>
    <div class="ms-title">${exam.is_final ? 'ফাইনাল পরীক্ষার মার্কশীট' : 'পরীক্ষার মার্কশীট'}</div>
    <p><b>${esc(exam.name)} — ${bn(exam.year)}</b></p></div>
  <div class="ms-info"><table>
    <tr><td>নাম</td><td>: <b>${esc(st.name)}</b></td></tr>
    <tr><td>আইডি</td><td>: ${bn(st.id)}</td></tr>
    <tr><td>শ্রেণি</td><td>: ${esc(clsName)} &nbsp; রোল: ${bn(st.roll)}</td></tr>
    <tr><td>পিতার নাম</td><td>: ${esc(st.father_name)}</td></tr>
    <tr><td>মাতার নাম</td><td>: ${esc(st.mother_name)}</td></tr>
    <tr><td>জন্ম তারিখ</td><td>: ${fmtDate(st.dob)}</td></tr></table>
    <img class="ms-photo" src="${esc(st.photo_url || NOPHOTO)}" alt=""></div>
  <table class="ms-table"><thead><tr><th>ক্রম</th><th>বিষয়</th><th>পূর্ণমান</th><th>প্রাপ্ত নম্বর</th><th>গ্রেড</th><th>জিপিএ</th></tr></thead><tbody>
  ${subs.map((s, i) => { const r = row.subRes[s.id]; return `<tr><td>${bn(i + 1)}</td><td class="l">${esc(s.name)}</td><td>${fm(Number(s.full_marks))}</td>
    <td>${r ? fm(r.m) : '—'}</td><td>${r ? r.g : '—'}</td><td>${r ? f2(r.gp) : '—'}</td></tr>`; }).join('')}
  <tr><td colspan="2"><b>সর্বমোট</b></td><td><b>${fm(row.fullTotal)}</b></td><td><b>${fm(row.total)}</b></td><td colspan="2"></td></tr></tbody></table>
  <div class="ms-sum"><div>শতকরা: <b>${bn(row.pct.toFixed(2))}%</b></div><div>জিপিএ: <b>${row.gpa === null ? '—' : f2(row.gpa)}</b></div><div>গ্রেড: <b>${row.grade}</b></div>
    <div>ফলাফল: <b>${STATUS_LABEL[row.status]}</b></div><div>মেধাক্রম: <b>${row.pos ? bn(row.pos) : '—'}</b></div><div></div></div>
  <div class="ms-sign"><span>অভিভাবকের স্বাক্ষর</span><span>শ্রেণি শিক্ষক</span><span>অধ্যক্ষ / মুহতামিম</span></div></section>`;
}

async function openMarksheetFor(studentId, examId) {
  const { data, error } = await sb.from('results').select('subject_id').eq('student_id', studentId).eq('exam_id', examId);
  if (error) throw error;
  if (!data.length) return toast('এই পরীক্ষায় শিক্ষার্থীর কোনো নম্বর পাওয়া যায়নি', 'err');
  const subj = S.subjects.find(s => s.id == data[0].subject_id);
  const exam = S.exams.find(e => e.id == examId);
  const { subs, rows } = await computeClass(examId, subj.class_id);
  const row = rows.find(r => r.student.id == studentId);
  const html = marksheetHTML(row, subs, exam, cName(subj.class_id));
  openModal('মার্কশীট', `<div class="actions" style="margin-bottom:10px"><button class="btn primary" id="msPrint">🖨 প্রিন্ট করুন</button></div>${html}`, true);
  $('#msPrint').onclick = () => printHTML(html);
}

/* ---------- Results ---------- */
const RF = { exam: '', cls: '' };
let RS = null;
pages.results = async () => {
  if (!S.exams.length) { V().innerHTML = '<div class="empty">কোনো পরীক্ষা নেই। আগে "পরীক্ষা ও নম্বর এন্ট্রি" পেজ থেকে পরীক্ষা যোগ করুন।</div>'; return; }
  if (!RF.exam || !S.exams.some(e => e.id == RF.exam)) RF.exam = (S.exams.find(e => e.is_final) || S.exams[0]).id;
  if (!RF.cls || !S.classes.some(c => c.id == RF.cls)) RF.cls = S.classes[0]?.id;
  V().innerHTML = `<h2>ফলাফল ও মার্কশীট</h2>
  <div class="card"><div class="row"><div><label>পরীক্ষা (★ = ফাইনাল)</label><select id="rExam">${examOpts(RF.exam)}</select></div>
  <div><label>শ্রেণি</label><select id="rCls">${classOpts(RF.cls)}</select></div>
  <div class="auto"><button class="btn primary" id="rGo">ফলাফল দেখুন</button></div></div></div><div id="rOut"></div>`;
  $('#rExam').onchange = e => (RF.exam = e.target.value);
  $('#rCls').onchange = e => (RF.cls = e.target.value);
  $('#rGo').onclick = () => run(showClassResults);
  await run(showClassResults);
};

async function showClassResults() {
  const exam = S.exams.find(e => e.id == RF.exam);
  const data = await computeClass(RF.exam, RF.cls);
  RS = { ...data, exam, clsName: cName(RF.cls) };
  const out = $('#rOut');
  if (!data.subs.length) { out.innerHTML = '<div class="card empty">এই শ্রেণিতে কোনো বিষয় নেই</div>'; return; }
  if (!data.rows.length) { out.innerHTML = '<div class="card empty">এই পরীক্ষায় এই শ্রেণির কোনো নম্বর এন্ট্রি হয়নি</div>'; return; }
  const pass = data.rows.filter(r => r.status === 'pass').length;
  out.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
    <h3 style="margin:0">${esc(RS.clsName)} শ্রেণি — ${esc(exam.name)} (${bn(exam.year)})</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="rPrintSheet">🖨 ফলাফল শিট</button><button class="btn primary" id="rPrintAll">🖨 সব মার্কশীট</button></div></div>
    <p class="muted">মোট ${bn(data.rows.length)} জন · উত্তীর্ণ ${bn(pass)} · অনুত্তীর্ণ/অসম্পূর্ণ ${bn(data.rows.length - pass)} · পাসের হার ${bn((pass / data.rows.length * 100).toFixed(1))}%</p>
    <div class="tbl-wrap">${resultTableHTML(data.subs, data.rows, true)}</div></div>`;
  $('#rPrintSheet').onclick = () => printHTML(`<div class="rs-print"><h2>${esc(S.settings.madrasa_name)}</h2><p>${esc(RS.clsName)} শ্রেণি — ${esc(exam.name)} (${bn(exam.year)}) ফলাফল</p>${resultTableHTML(data.subs, data.rows, false)}</div>`);
  $('#rPrintAll').onclick = () => printHTML(data.rows.map(r => marksheetHTML(r, data.subs, exam, RS.clsName)).join(''));
  delegate((act, d) => {
    if (act === 'ms') {
      const r = RS.rows.find(x => x.student.id == d.id);
      const html = marksheetHTML(r, RS.subs, RS.exam, RS.clsName);
      openModal('মার্কশীট', `<div class="actions" style="margin-bottom:10px"><button class="btn primary" id="msPrint">🖨 প্রিন্ট করুন</button></div>${html}`, true);
      $('#msPrint').onclick = () => printHTML(html);
    }
  });
}

function resultTableHTML(subs, rows, withAct) {
  return `<table class="data"><thead><tr><th class="c">রোল</th><th>নাম</th>
  ${subs.map(s => `<th class="c">${esc(s.name)}<br><small>(${fm(Number(s.full_marks))})</small></th>`).join('')}
  <th class="c">মোট</th><th class="c">জিপিএ</th><th class="c">গ্রেড</th><th class="c">ফল</th><th class="c">মেধা</th>${withAct ? '<th></th>' : ''}</tr></thead><tbody>
  ${rows.map(r => `<tr><td class="c">${bn(r.student.roll)}</td><td class="l">${esc(r.student.name)}</td>
  ${subs.map(s => { const x = r.subRes[s.id]; return `<td class="c" ${x && x.g === 'F' ? 'style="color:#b42318;font-weight:600"' : ''}>${x ? fm(x.m) : '—'}</td>`; }).join('')}
  <td class="c"><b>${fm(r.total)}</b></td><td class="c">${r.gpa === null ? '—' : f2(r.gpa)}</td><td class="c">${r.grade}</td>
  <td class="c">${withAct ? `<span class="badge ${STATUS_CLS[r.status]}">${STATUS_LABEL[r.status]}</span>` : STATUS_LABEL[r.status]}</td>
  <td class="c">${r.pos ? bn(r.pos) : '—'}</td>
  ${withAct ? `<td><button class="btn sm" data-act="ms" data-id="${r.student.id}">মার্কশীট</button></td>` : ''}</tr>`).join('')}</tbody></table>`;
}

/* ---------- Madrasa-wide summary ---------- */
let SUMEXAM = '';
pages.summary = async () => {
  if (!S.exams.length) { V().innerHTML = '<div class="empty">কোনো পরীক্ষা নেই</div>'; return; }
  if (!SUMEXAM || !S.exams.some(e => e.id == SUMEXAM)) SUMEXAM = (S.exams.find(e => e.is_final) || S.exams[0]).id;
  V().innerHTML = `<h2>মাদ্রাসার সকল শ্রেণির ফলাফল</h2><div class="card"><div class="row">
  <div><label>পরীক্ষা (★ = ফাইনাল)</label><select id="sExam">${examOpts(SUMEXAM)}</select></div>
  <div class="auto"><button class="btn primary" id="sGo">দেখুন</button></div>
  <div class="auto"><button class="btn" id="sPrint">🖨 প্রিন্ট</button></div></div></div><div id="sOut"></div>`;
  $('#sExam').onchange = e => (SUMEXAM = e.target.value);
  $('#sGo').onclick = () => run(drawSummary);
  $('#sPrint').onclick = () => { const o = $('#sOut'); if (o.dataset.ready) printHTML(`<div class="rs-print">${o.dataset.print}</div>`); else toast('আগে ফলাফল দেখুন', 'err'); };
  await run(drawSummary);
};

async function drawSummary() {
  const exam = S.exams.find(e => e.id == SUMEXAM);
  const per = await Promise.all(S.classes.map(async c => ({ c, ...(await computeClass(exam.id, c.id)) })));
  const used = per.filter(p => p.rows.length);
  const out = $('#sOut');
  if (!used.length) { out.innerHTML = '<div class="card empty">এই পরীক্ষায় কোনো নম্বর এন্ট্রি হয়নি</div>'; out.dataset.ready = ''; return; }
  const stat = p => {
    const t = p.rows.length, pass = p.rows.filter(r => r.status === 'pass').length;
    const fail = p.rows.filter(r => r.status === 'fail').length;
    const ap = p.rows.filter(r => r.status === 'pass' && r.gpa >= 5).length;
    const avg = t ? p.rows.reduce((a, r) => a + r.pct, 0) / t : 0;
    return { t, pass, fail, inc: t - pass - fail, ap, avg, rate: t ? pass / t * 100 : 0 };
  };
  const tot = used.reduce((a, p) => { const s = stat(p); a.t += s.t; a.pass += s.pass; a.fail += s.fail; a.inc += s.inc; a.ap += s.ap; return a; }, { t: 0, pass: 0, fail: 0, inc: 0, ap: 0 });
  const summaryTable = `<table class="data"><thead><tr><th>শ্রেণি</th><th class="c">পরীক্ষার্থী</th><th class="c">উত্তীর্ণ</th><th class="c">অনুত্তীর্ণ</th><th class="c">অসম্পূর্ণ</th><th class="c">A+</th><th class="c">গড় নম্বর %</th><th class="c">পাসের হার</th></tr></thead><tbody>
  ${used.map(p => { const s = stat(p); return `<tr><td>${esc(p.c.name)}</td><td class="c">${bn(s.t)}</td><td class="c">${bn(s.pass)}</td><td class="c">${bn(s.fail)}</td><td class="c">${bn(s.inc)}</td><td class="c">${bn(s.ap)}</td><td class="c">${bn(s.avg.toFixed(1))}</td><td class="c"><b>${bn(s.rate.toFixed(1))}%</b></td></tr>`; }).join('')}
  <tr><td><b>সর্বমোট</b></td><td class="c"><b>${bn(tot.t)}</b></td><td class="c"><b>${bn(tot.pass)}</b></td><td class="c"><b>${bn(tot.fail)}</b></td><td class="c"><b>${bn(tot.inc)}</b></td><td class="c"><b>${bn(tot.ap)}</b></td><td class="c">—</td><td class="c"><b>${bn((tot.pass / tot.t * 100).toFixed(1))}%</b></td></tr></tbody></table>`;
  const details = used.map(p => `<h3>${esc(p.c.name)} শ্রেণি</h3>${resultTableHTML(p.subs, p.rows, false)}`).join('');
  const head = `<h2>${esc(S.settings.madrasa_name)}</h2><p>${esc(exam.name)} (${bn(exam.year)}) — সকল শ্রেণির ফলাফল</p>`;
  out.dataset.ready = '1';
  out.dataset.print = head + summaryTable + details;
  out.innerHTML = `<div class="card"><h3>সারসংক্ষেপ — ${esc(exam.name)} (${bn(exam.year)})</h3><div class="tbl-wrap">${summaryTable}</div></div>
  ${used.map(p => `<details class="card"><summary style="cursor:pointer;font-weight:600">${esc(p.c.name)} শ্রেণির বিস্তারিত ফলাফল (${bn(p.rows.length)} জন)</summary>
  <div class="tbl-wrap" style="margin-top:10px">${resultTableHTML(p.subs, p.rows, false)}</div></details>`).join('')}`;
}

/* ---------- Promotion ---------- */
const PR = { from: '', to: '', exam: '' };
pages.promotion = async () => {
  if (S.classes.length < 1) { V().innerHTML = '<div class="empty">আগে শ্রেণি যোগ করুন</div>'; return; }
  if (!PR.from) PR.from = S.classes[0].id;
  PR.to = nextClass(PR.from);
  const { data: log } = await sb.from('promotions').select('id,year,created_at,from_class,to_class,students(name)').order('id', { ascending: false }).limit(15);
  const year = +S.settings.session_year || new Date().getFullYear();
  V().innerHTML = `<h2>বছর শেষে প্রমোশন</h2>
  <div class="card"><div class="row">
    <div><label>বর্তমান শ্রেণি (যেখান থেকে)</label><select id="pFrom">${classOpts(PR.from)}</select></div>
    <div><label>পরবর্তী শ্রেণি (যেখানে)</label><select id="pTo"></select></div>
    <div><label>শিক্ষাবর্ষ (লগের জন্য)</label><input id="pYear" value="${year} → ${year + 1}"></div></div>
  <div class="row" style="margin-top:12px"><div><label>ফলাফল দেখে বাছাই (ঐচ্ছিক)</label><select id="pExam"><option value="">— পরীক্ষা নির্বাচন —</option>${examOpts('')}</select></div>
    <div class="auto"><button class="btn" id="pPassed">শুধু উত্তীর্ণদের নির্বাচন করুন</button></div>
    <div class="auto"><label class="inline"><input type="checkbox" id="pRenum"> নতুন শ্রেণিতে রোল পুনরায় সাজান</label></div></div></div>
  <div class="card"><div id="pList"></div></div>
  <div class="card"><h3>সাম্প্রতিক প্রমোশন লগ</h3>${log?.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>শিক্ষার্থী</th><th>থেকে</th><th>এখন</th><th>বর্ষ</th><th>তারিখ</th></tr></thead><tbody>
    ${log.map(l => `<tr><td>${esc(l.students?.name || '—')}</td><td>${esc(cName(l.from_class))}</td><td>${l.to_class ? esc(cName(l.to_class)) : 'সমাপ্ত'}</td><td>${bn(l.year || '')}</td><td>${fmtDate(l.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">এখনো কোনো প্রমোশন হয়নি</div>'}</div>`;
  const fillTo = () => {
    $('#pTo').innerHTML = S.classes.filter(c => c.id != PR.from).map(c => `<option value="${c.id}" ${c.id == PR.to ? 'selected' : ''}>${esc(c.name)}</option>`).join('') +
      `<option value="graduate" ${PR.to === 'graduate' ? 'selected' : ''}>পাশ আউট / সমাপ্ত</option>`;
  };
  fillTo();
  $('#pFrom').onchange = async e => { PR.from = e.target.value; PR.to = nextClass(PR.from); fillTo(); await run(loadPromoList); };
  $('#pTo').onchange = e => (PR.to = e.target.value);
  $('#pExam').onchange = e => (PR.exam = e.target.value);
  $('#pPassed').onclick = () => run(async () => {
    if (!PR.exam) return toast('আগে একটি পরীক্ষা নির্বাচন করুন', 'err');
    const { rows } = await computeClass(PR.exam, PR.from);
    const ok = new Set(rows.filter(r => r.status === 'pass').map(r => r.student.id));
    $$('#pList input[data-sid]').forEach(i => (i.checked = ok.has(+i.dataset.sid)));
    toast(`${bn($$('#pList input[data-sid]:checked').length)} জন উত্তীর্ণ নির্বাচিত হয়েছে`);
  });
  await run(loadPromoList);
};

function nextClass(fromId) {
  const i = S.classes.findIndex(c => c.id == fromId);
  return S.classes[i + 1]?.id || 'graduate';
}

async function loadPromoList() {
  const studs = await fetchAll(() => sb.from('students').select('id,name,roll,father_name').eq('class_id', PR.from).eq('status', 'active').order('roll').order('id'));
  const box = $('#pList');
  if (!studs.length) { box.innerHTML = '<div class="empty">এই শ্রেণিতে কোনো অধ্যয়নরত শিক্ষার্থী নেই</div>'; return; }
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
    <label class="inline"><input type="checkbox" id="pAll" checked> সবাইকে নির্বাচন (${bn(studs.length)} জন)</label>
    <button class="btn primary" id="pRun">⬆ প্রমোশন দিন</button></div>
  <div class="tbl-wrap"><table class="data"><thead><tr><th></th><th class="c">রোল</th><th>নাম</th><th>পিতা</th></tr></thead><tbody>
  ${studs.map(s => `<tr><td><input type="checkbox" data-sid="${s.id}" checked></td><td class="c">${bn(s.roll)}</td><td>${esc(s.name)}</td><td>${esc(s.father_name)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#pAll').onchange = e => $$('#pList input[data-sid]').forEach(i => (i.checked = e.target.checked));
  $('#pRun').onclick = () => run(doPromote);
}

async function doPromote() {
  const ids = $$('#pList input[data-sid]:checked').map(i => +i.dataset.sid);
  if (!ids.length) return toast('কোনো শিক্ষার্থী নির্বাচন করা হয়নি', 'err');
  const grad = PR.to === 'graduate';
  const label = grad ? 'পাশ আউট / সমাপ্ত' : `"${cName(PR.to)}" শ্রেণিতে`;
  if (!confirm(`${bn(ids.length)} জন শিক্ষার্থীকে "${cName(PR.from)}" থেকে ${label} প্রমোশন দেবেন?`)) return;
  const btn = $('#pRun'); btn.disabled = true;
  try {
    const { error } = await sb.rpc('promote_students', {
      p_ids: ids,
      p_from_class: +PR.from,
      p_to_class: grad ? null : +PR.to,
      p_year: $('#pYear').value.trim(),
      p_renumber: !grad && $('#pRenum').checked,
    });
    if (error) throw error;
    toast(`${bn(ids.length)} জনের প্রমোশন সম্পন্ন হয়েছে`);
    await pages.promotion();
  } catch (e) { throw e; } finally { btn.disabled = false; }
}

/* ---------- ID cards ---------- */
function cardHTML(s, year) {
  const M = S.settings, url = verifyUrl(s.verify_token);
  return `<div class="idcard"><div class="ic-head"><b>${esc(M.madrasa_name)}</b><small>${esc(M.madrasa_address || '')}</small><span>শিক্ষার্থী পরিচয়পত্র</span></div>
  <div class="ic-body"><img class="ic-photo" src="${esc(s.photo_url || NOPHOTO)}" alt="">
    <div class="ic-info"><div class="ic-name">${esc(s.name)}</div><div>আইডি: <b>${bn(s.id)}</b></div>
    <div>শ্রেণি: ${esc(cName(s.class_id))} · রোল: ${bn(s.roll)}</div><div>পিতা: ${esc(s.father_name)}</div><div>জন্ম তারিখ: ${fmtDate(s.dob)}</div></div>
    <div class="ic-qr">${qrSvg(url)}</div></div>
  <div class="ic-foot">কিউআর স্ক্যান করে যাচাই করুন · শিক্ষাবর্ষ ${bn(year || '')}</div></div>`;
}

const IC = { cls: 'all', year: '' };
let ICS = [];
pages.idcards = async () => {
  if (!IC.year) IC.year = S.settings.session_year || String(new Date().getFullYear());
  V().innerHTML = `<h2>আইডি কার্ড জেনারেটর</h2><div class="card"><div class="row">
  <div><label>শ্রেণি</label><select id="icCls">${classOpts(IC.cls, true)}</select></div>
  <div><label>শিক্ষাবর্ষ</label><input id="icYear" value="${esc(IC.year)}"></div>
  <div class="auto"><button class="btn primary" id="icPrint">🖨 প্রিন্ট / PDF</button></div></div>
  <p class="muted"><small>প্রতিটি কার্ডের কিউআর কোড স্ক্যান করলে ইন্টারনেটে শিক্ষার্থীর তথ্য যাচাই হবে। প্রিন্ট ডায়ালগে "Save as PDF" বেছে PDF করতে পারবেন। একটি শিক্ষার্থীর কার্ড আলাদা প্রিন্ট করতে "শিক্ষার্থী" পেজে গিয়ে "দেখুন" চাপুন।</small></p></div>
  <div class="card"><div class="row"><div><label>এই তালিকা থেকে বাছাই করুন (ঐচ্ছিক)</label><input id="icQ" placeholder="নাম / আইডি / রোল দিয়ে খুঁজুন"></div></div><div id="icPick" style="margin-top:10px"></div></div>
  <div id="icPrev"></div>`;
  $('#icCls').onchange = e => { IC.cls = e.target.value; run(loadCards); };
  $('#icYear').oninput = e => { IC.year = e.target.value; drawCards(); };
  $('#icQ').oninput = () => drawPick();
  $('#icPrint').onclick = () => { const sel = pickedCards(); if (!sel.length) return toast('কোনো শিক্ষার্থী নেই', 'err'); printHTML(`<div class="cards">${sel.map(s => cardHTML(s, IC.year)).join('')}</div>`); };
  await run(loadCards);
};
async function loadCards() {
  ICS = await fetchAll(() => {
    let q = sb.from('students').select('*').eq('status', 'active');
    if (IC.cls !== 'all') q = q.eq('class_id', IC.cls);
    return q.order('class_id').order('roll').order('id');
  });
  ICS.sort((a, b) => (cOrd(a.class_id) - cOrd(b.class_id)) || (a.roll - b.roll));
  drawPick(true); drawCards();
}
function drawPick(reset) {
  const q = ($('#icQ')?.value || '').trim().toLowerCase();
  const keep = new Set($$('#icPick input:checked').map(i => +i.dataset.id));
  const list = ICS.filter(s => !q || [s.name, s.id, s.roll].join(' ').toLowerCase().includes(q));
  $('#icPick').innerHTML = list.length ? `<label class="inline"><input type="checkbox" id="icAll" ${reset || !keep.size ? 'checked' : ''}> সবাই (${bn(list.length)} জন)</label>
  <div style="max-height:180px;overflow:auto;margin-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 10px">
  ${list.map(s => `<label class="inline"><input type="checkbox" data-id="${s.id}" ${reset || !keep.size || keep.has(s.id) ? 'checked' : ''}> ${bn(s.roll)}. ${esc(s.name)}</label>`).join('')}</div>` : '<div class="empty">কোনো শিক্ষার্থী নেই</div>';
  const all = $('#icAll');
  if (all) all.onchange = e => { $$('#icPick input[data-id]').forEach(i => (i.checked = e.target.checked)); drawCards(); };
  $$('#icPick input[data-id]').forEach(i => (i.onchange = drawCards));
}
function pickedCards() {
  const ids = new Set($$('#icPick input[data-id]:checked').map(i => +i.dataset.id));
  return ICS.filter(s => ids.has(s.id));
}
function drawCards() {
  const sel = pickedCards();
  $('#icPrev').innerHTML = sel.length ? `<div class="cards">${sel.map(s => cardHTML(s, IC.year)).join('')}</div>` : '';
}

/* ---------- Settings ---------- */
pages.settings = async () => {
  const M = S.settings;
  V().innerHTML = `<h2>সেটিংস</h2>
  <div class="card"><h3>মাদ্রাসার তথ্য</h3><form id="setForm" class="grid2">
  <div class="full"><label>মাদ্রাসার নাম</label><input name="madrasa_name" required value="${esc(M.madrasa_name)}"></div>
  <div class="full"><label>ঠিকানা</label><input name="madrasa_address" value="${esc(M.madrasa_address)}"></div>
  <div><label>মোবাইল</label><input name="madrasa_phone" value="${esc(M.madrasa_phone)}"></div>
  <div><label>চলতি শিক্ষাবর্ষ</label><input name="session_year" value="${esc(M.session_year)}"></div>
  <div class="full actions"><button class="btn primary" type="submit">সংরক্ষণ করুন</button></div></form></div>
  <div class="card"><h3>শ্রেণিসমূহ</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>ক্রম</th><th>নাম</th><th></th></tr></thead><tbody>
  ${S.classes.map(c => `<tr><td style="width:90px"><input type="number" value="${c.sort_order}" data-order="${c.id}" style="width:70px"></td>
    <td><input value="${esc(c.name)}" data-name="${c.id}"></td>
    <td style="white-space:nowrap"><button class="btn sm" data-act="save" data-id="${c.id}">সংরক্ষণ</button> <button class="btn sm danger" data-act="del" data-id="${c.id}">মুছুন</button></td></tr>`).join('')}</tbody></table></div>
  <hr><form id="clsForm" class="row"><div><label>নতুন শ্রেণির নাম</label><input name="name" required placeholder="যেমন: আলিম প্রথম বর্ষ"></div>
  <div class="auto"><button class="btn primary" type="submit">+ শ্রেণি যোগ করুন</button></div></form>
  <p class="muted"><small>"ক্রম" সংখ্যা অনুযায়ী শ্রেণি সাজানো হয় এবং প্রমোশনে পরবর্তী শ্রেণি এই ক্রম থেকেই ঠিক হয়। শিক্ষার্থী আছে এমন শ্রেণি মোছা যাবে না।</small></p></div>`;
  $('#setForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await run(async () => {
      const rows = ['madrasa_name', 'madrasa_address', 'madrasa_phone', 'session_year'].map(k => ({ key: k, value: f[k].value.trim() }));
      const { error } = await sb.from('settings').upsert(rows);
      if (error) throw error;
      await loadSettings();
      $('#sidebar .brand').textContent = '🕌 ' + S.settings.madrasa_name;
      toast('সংরক্ষিত হয়েছে');
    });
  };
  $('#clsForm').onsubmit = async e => {
    e.preventDefault();
    await run(async () => {
      const max = Math.max(0, ...S.classes.map(c => c.sort_order));
      const { error } = await sb.from('classes').insert({ name: e.target.name.value.trim(), sort_order: max + 1 });
      if (error) throw error.code === '23505' ? new Error('এই নামে শ্রেণি আগে থেকেই আছে') : error;
      await loadClasses(); toast('শ্রেণি যোগ হয়েছে'); pages.settings();
    });
  };
  delegate(async (act, d) => {
    if (act === 'save') {
      await run(async () => {
        const name = $(`[data-name="${d.id}"]`).value.trim(), ord = +$(`[data-order="${d.id}"]`).value;
        const { error } = await sb.from('classes').update({ name, sort_order: ord }).eq('id', d.id);
        if (error) throw error;
        await loadClasses(); toast('সংরক্ষিত হয়েছে'); pages.settings();
      });
    }
    if (act === 'del') {
      if (!confirm(`শ্রেণি "${cName(d.id)}" মুছবেন? এর সব বিষয় ও নম্বরও মুছে যাবে।`)) return;
      await run(async () => {
        const { error } = await sb.from('classes').delete().eq('id', d.id);
        if (error) throw error;
        await Promise.all([loadClasses(), loadSubjects()]); toast('মুছে ফেলা হয়েছে'); pages.settings();
      });
    }
  });
};

/* ---------- start ---------- */
boot();
