'use strict';
// 구름발 닌자 서버 — 추가 설치(npm install) 없이 Node.js 18 이상이면 바로 실행돼요.
//   node server.js
// 게임 파일(public 폴더)과 로그인/저장/랭킹 API(/api)를 같은 주소에서 함께 제공해요.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_DAYS = 30;
const STAGE_COUNT = 5;

// ───────── 데이터 저장 (JSON 파일) ─────────
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: {}, sessions: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) { /* 처음 실행 */ }
db.users = db.users || {};
db.sessions = db.sessions || {};

let writeTimer = null;
function writeNow() {
  clearTimeout(writeTimer); writeTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);          // 중간에 꺼져도 파일이 깨지지 않게
}
function saveDb() { if (!writeTimer) writeTimer = setTimeout(writeNow, 400); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { if (writeTimer) writeNow(); } finally { process.exit(0); } });

// 만료된 로그인 정리
function cleanSessions() {
  const now = Date.now(); let n = 0;
  for (const [t, s] of Object.entries(db.sessions)) if (s.exp < now || !db.users[s.uid]) { delete db.sessions[t]; n++; }
  if (n) saveDb();
}
cleanSessions(); setInterval(cleanSessions, 3600 * 1000).unref();

// ───────── 도우미 ─────────
const ID_RE = /^[a-z0-9_]{4,16}$/;
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPw(user, pw) {
  const a = Buffer.from(hashPw(pw, user.salt), 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { uid, exp: Date.now() + SESSION_DAYS * 864e5 };
  saveDb();
  return token;
}
function authUid(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = token && db.sessions[token];
  if (!s || s.exp < Date.now() || !db.users[s.uid]) return null;
  return s.uid;
}
const cleanNick = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);

// 로그인 시도 제한 (IP당 10분에 20번)
const tries = new Map();
function tooMany(ip) {
  const now = Date.now(), t = tries.get(ip) || { n: 0, at: now };
  if (now - t.at > 600000) { t.n = 0; t.at = now; }
  t.n++; tries.set(ip, t);
  return t.n > 20;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of tries) if (now - v.at > 600000) tries.delete(k); }, 600000).unref();

// 저장 데이터에서 랭킹용 값 뽑기 (말도 안 되는 값은 걸러요)
function rankOf(save) {
  const r = {};
  const tower = Number(save && save.stats && save.stats.tower);
  if (Number.isFinite(tower) && tower > 0 && tower < 100000) r.tower = Math.floor(tower);
  for (let i = 0; i < STAGE_COUNT; i++) {
    const t = Number(save && save.best && save.best['s' + i] && save.best['s' + i].time);
    if (Number.isFinite(t) && t >= 3 && t < 36000) r['t' + i] = Math.round(t * 10) / 10;
  }
  return r;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readJson(req, limit = 400 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too big'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const userOut = (uid, token) => { const u = db.users[uid]; return { token, id: uid, nick: u.nick, save: u.save || null }; };

// ───────── API ─────────
async function handleApi(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const route = req.method + ' ' + url.pathname;

  if (route === 'GET /api/health') return sendJson(res, 200, { ok: true, users: Object.keys(db.users).length });

  if (route === 'POST /api/register') {
    if (tooMany(ip)) return sendJson(res, 429, { error: '잠시 뒤에 다시 시도해 주세요' });
    const b = await readJson(req);
    const id = String(b.id || '').trim().toLowerCase(), pw = String(b.pw || ''), nick = cleanNick(b.nick);
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: '아이디는 영어 소문자·숫자·_ 로 4~16자예요' });
    if (pw.length < 4 || pw.length > 64) return sendJson(res, 400, { error: '비밀번호는 4~64자예요' });
    if (!nick) return sendJson(res, 400, { error: '닉네임을 적어주세요' });
    if (db.users[id]) return sendJson(res, 409, { error: '이미 있는 아이디예요' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[id] = { nick, salt, hash: hashPw(pw, salt), save: null, rank: {}, created: Date.now(), updated: Date.now() };
    saveDb();
    return sendJson(res, 200, userOut(id, newSession(id)));
  }

  if (route === 'POST /api/login') {
    if (tooMany(ip)) return sendJson(res, 429, { error: '로그인 시도가 너무 많아요. 10분 뒤에 다시 해주세요' });
    const b = await readJson(req);
    const id = String(b.id || '').trim().toLowerCase(), pw = String(b.pw || '');
    const u = db.users[id];
    if (!u || !checkPw(u, pw)) return sendJson(res, 401, { error: '아이디나 비밀번호가 틀렸어요' });
    return sendJson(res, 200, userOut(id, newSession(id)));
  }

  if (route === 'GET /api/rank') {
    const board = url.searchParams.get('board') || 'tower';
    if (board !== 'tower' && !/^t[0-9]$/.test(board)) return sendJson(res, 400, { error: '없는 랭킹이에요' });
    const me = authUid(req);
    const list = Object.entries(db.users)
      .filter(([, u]) => u.rank && typeof u.rank[board] === 'number')
      .map(([id, u]) => ({ id, nick: u.nick, v: u.rank[board] }))
      .sort((a, b) => board === 'tower' ? b.v - a.v : a.v - b.v)
      .slice(0, 50)
      .map(d => ({ nick: d.nick, v: d.v, me: d.id === me }));
    return sendJson(res, 200, { board, list });
  }

  // 여기부터는 로그인 필요
  const uid = authUid(req);
  if (!uid) return sendJson(res, 401, { error: '다시 로그인해 주세요' });
  const user = db.users[uid];

  if (route === 'GET /api/me') return sendJson(res, 200, userOut(uid));

  if (route === 'PUT /api/save') {
    const b = await readJson(req);
    if (!b.save || typeof b.save !== 'object' || Array.isArray(b.save)) return sendJson(res, 400, { error: '저장 데이터가 이상해요' });
    user.save = b.save; user.rank = rankOf(b.save); user.updated = Date.now();
    saveDb();
    return sendJson(res, 200, { ok: true, at: user.updated });
  }

  if (route === 'POST /api/logout') {
    const token = (req.headers.authorization || '').slice(7);
    delete db.sessions[token]; saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'POST /api/nick') {
    const b = await readJson(req); const nick = cleanNick(b.nick);
    if (!nick) return sendJson(res, 400, { error: '닉네임을 적어주세요' });
    user.nick = nick; saveDb();
    return sendJson(res, 200, { ok: true, nick });
  }

  return sendJson(res, 404, { error: '없는 주소예요' });
}

// ───────── 게임 파일 ─────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  let file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  // public 폴더가 없으면 저장소 맨 위의 한 파일짜리 게임(HTML)을 첫 화면으로 보여줘요
  if (p === '/index.html' && !fs.existsSync(file)) {
    const single = fs.readdirSync(__dirname).find(n => /\.html?$/i.test(n));
    if (single) file = path.join(__dirname, single);
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 파일이에요'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=86400' };
    // 음악 파일은 구간 요청(Range)도 지원 (모바일 사파리용)
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      let [a, b] = range.slice(6).split('-'); a = a ? +a : 0; b = b ? +b : st.size - 1;
      if (a >= st.size || b >= st.size || a > b) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': 'bytes ' + a + '-' + b + '/' + st.size, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 }));
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size, 'Accept-Ranges': 'bytes' }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// 다른 주소(예: 내려받은 HTML 파일)에서 열린 게임도 API를 쓸 수 있게 허용 (쿠키 없이 토큰만 쓰므로 안전)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    const code = e && (e.code === 413 || e.code === 400) ? e.code : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) sendJson(res, code, { error: code === 413 ? '데이터가 너무 커요' : code === 400 ? '요청 형식이 이상해요' : '서버 오류가 났어요' });
  }
}).listen(PORT, () => console.log('구름발 닌자 서버 실행 중 → http://localhost:' + PORT));
