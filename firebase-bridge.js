// 구름발 닌자 ↔ Firebase 연결
// 게임은 원래 서버 주소(/api/...)로 요청을 보내요. 이 파일이 그 요청을 가로채서
// Firebase(로그인 = Authentication, 저장·랭킹 = Firestore)로 대신 처리해요.
(function () {
  'use strict';
  var CONFIG = {
    apiKey: "AIzaSyDNDvQbHbdzgrY_YGwqNZPb9r_xslIpwHk",
    authDomain: "gureumbal-ninja.firebaseapp.com",
    projectId: "gureumbal-ninja",
    storageBucket: "gureumbal-ninja.firebasestorage.app",
    messagingSenderId: "860322976809",
    appId: "1:860322976809:web:7a4ae5d395d62305667838"
  };
  var V = '10.12.5';
  var CDN = 'https://www.gstatic.com/firebasejs/' + V + '/';
  var EMAIL_DOMAIN = '@gureumbal-ninja.game';
  var STAGE_COUNT = 5;

  // 로그인 화면의 "서버 주소" 줄은 필요 없으니 숨겨요
  var st = document.createElement('style');
  st.textContent = '#srvRow,#srvEdit{display:none!important}';
  (document.head || document.documentElement).appendChild(st);

  var ready = null;
  function fb() {
    if (ready) return ready;
    ready = Promise.all([
      import(CDN + 'firebase-app.js'),
      import(CDN + 'firebase-auth.js'),
      import(CDN + 'firebase-firestore.js')
    ]).then(function (m) {
      var app = m[0].initializeApp(CONFIG);
      var auth = m[1].getAuth(app);
      var db = m[2].getFirestore(app);
      return auth.authStateReady().then(function () { return { A: m[1], F: m[2], auth: auth, db: db }; });
    });
    ready.catch(function () { ready = null; });
    return ready;
  }
  fb();

  function out(status, obj) {
    return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } });
  }
  var emailOf = function (id) { return id + EMAIL_DOMAIN; };
  var pwOf = function (pw) { return pw + '#cloud'; };   // Firebase는 비밀번호가 6자 이상이어야 해서 뒤에 붙여요
  var cleanNick = function (s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10); };

  function rankOf(save) {
    var r = {};
    var tower = Number(save && save.stats && save.stats.tower);
    if (isFinite(tower) && tower > 0 && tower < 100000) r.tower = Math.floor(tower);
    for (var i = 0; i < STAGE_COUNT; i++) {
      var b = save && save.best && save.best['s' + i];
      var t = Number(b && b.time);
      if (isFinite(t) && t >= 3 && t < 36000) r['t' + i] = Math.round(t * 10) / 10;
    }
    return r;
  }

  async function me(x) {
    var u = x.auth.currentUser;
    if (!u) return out(401, { error: '다시 로그인해 주세요' });
    var ban = await x.F.getDoc(x.F.doc(x.db, 'bans', u.uid));
    if (ban.exists()) {
      await x.A.signOut(x.auth);
      var why = (ban.data() && ban.data().reason) || '';
      var msg = '이 계정은 관리자에 의해 정지됐어요' + (why ? ' (' + why + ')' : '');
      setTimeout(function () { try { setToken(null); document.getElementById('lErr').textContent = msg; } catch (_) {} }, 50);
      return out(403, { error: msg });
    }
    var snap = await x.F.getDoc(x.F.doc(x.db, 'users', u.uid));
    var d = snap.exists() ? snap.data() : {};
    var save = null; try { save = d.save ? JSON.parse(d.save) : null; } catch (_) {}
    afterLogin(x);
    return out(200, { token: u.uid, id: d.id || (u.email || '').split('@')[0], nick: d.nick || '닌자', save: save });
  }

  function authError(e) {
    var c = (e && e.code) || '';
    if (c.indexOf('email-already-in-use') >= 0) return out(409, { error: '이미 있는 아이디예요' });
    if (c.indexOf('invalid-credential') >= 0 || c.indexOf('wrong-password') >= 0 || c.indexOf('user-not-found') >= 0 || c.indexOf('invalid-login') >= 0) return out(401, { error: '아이디나 비밀번호가 틀렸어요' });
    if (c.indexOf('too-many-requests') >= 0) return out(429, { error: '시도가 너무 많아요. 잠시 뒤에 다시 해주세요' });
    if (c.indexOf('network') >= 0) return out(503, { error: '인터넷 연결을 확인해 주세요' });
    if (c.indexOf('operation-not-allowed') >= 0 || c.indexOf('configuration-not-found') >= 0) return out(503, { error: '서버 로그인 설정이 아직 안 됐어요' });
    return out(500, { error: '서버 오류가 났어요 (' + c + ')' });
  }

  async function handle(method, url, body) {
    var x;
    try { x = await fb(); } catch (_) { return out(503, { error: '서버에 연결할 수 없어요' }); }
    var A = x.A, F = x.F, auth = x.auth, db = x.db;
    var path = url.pathname, route = method + ' ' + path;

    if (route === 'GET /api/health') return out(200, { ok: true, users: '많은' });

    if (route === 'POST /api/register') {
      var id = String(body.id || '').trim().toLowerCase(), pw = String(body.pw || ''), nick = cleanNick(body.nick);
      if (!/^[a-z0-9_]{4,16}$/.test(id)) return out(400, { error: '아이디는 영어 소문자·숫자·_ 로 4~16자예요' });
      if (pw.length < 4 || pw.length > 64) return out(400, { error: '비밀번호는 4~64자예요' });
      if (!nick) return out(400, { error: '닉네임을 적어주세요' });
      try {
        var cred = await A.createUserWithEmailAndPassword(auth, emailOf(id), pwOf(pw));
        var uid = cred.user.uid;
        await F.setDoc(F.doc(db, 'users', uid), { id: id, nick: nick, save: null, updated: Date.now() });
        await F.setDoc(F.doc(db, 'ranks', uid), { nick: nick });
        afterLogin(x);
        return out(200, { token: uid, id: id, nick: nick, save: null });
      } catch (e) { return authError(e); }
    }

    if (route === 'POST /api/login') {
      var lid = String(body.id || '').trim().toLowerCase(), lpw = String(body.pw || '');
      try { await A.signInWithEmailAndPassword(auth, emailOf(lid), pwOf(lpw)); }
      catch (e) { return authError(e); }
      return me(x);
    }

    if (route === 'GET /api/rank') {
      var board = url.searchParams.get('board') || 'tower';
      if (board !== 'tower' && !/^t[0-9]$/.test(board)) return out(400, { error: '없는 랭킹이에요' });
      var q = F.query(F.collection(db, 'ranks'), F.orderBy(board, board === 'tower' ? 'desc' : 'asc'), F.limit(50));
      var snap = await F.getDocs(q);
      var myUid = auth.currentUser && auth.currentUser.uid;
      var list = snap.docs.map(function (d) { var v = d.data(); return { nick: v.nick || '닌자', v: v[board], me: d.id === myUid }; })
        .filter(function (d) { return typeof d.v === 'number'; });
      return out(200, { board: board, list: list });
    }

    var user = auth.currentUser;
    if (!user) return out(401, { error: '다시 로그인해 주세요' });

    if (route === 'GET /api/me') return me(x);

    if (route === 'PUT /api/save') {
      if (!body.save || typeof body.save !== 'object') return out(400, { error: '저장 데이터가 이상해요' });
      var now = Date.now();
      await F.setDoc(F.doc(db, 'users', user.uid), { save: JSON.stringify(body.save), updated: now }, { merge: true });
      var r = rankOf(body.save);
      var nickNow = cleanNick(body.save.nick) || null;
      var rdoc = Object.assign({ updated: now }, r);
      if (nickNow) rdoc.nick = nickNow;
      await F.setDoc(F.doc(db, 'ranks', user.uid), rdoc, { merge: true });
      return out(200, { ok: true, at: now });
    }

    if (route === 'POST /api/logout') { ADMIN = false; updateAdminBtn(); await A.signOut(auth); return out(200, { ok: true }); }

    if (route === 'POST /api/nick') {
      var n2 = cleanNick(body.nick);
      if (!n2) return out(400, { error: '닉네임을 적어주세요' });
      await F.setDoc(F.doc(db, 'users', user.uid), { nick: n2 }, { merge: true });
      await F.setDoc(F.doc(db, 'ranks', user.uid), { nick: n2 }, { merge: true });
      return out(200, { ok: true, nick: n2 });
    }

    return out(404, { error: '없는 주소예요' });
  }


  // ───────── 관리자 · 선물 · 정지 ─────────
  var ADMIN = false;
  var SHIELD = '<svg class="ic" viewBox="0 0 24 24" width="24" height="24"><path d="M12 2.5 4 5.6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10v-6z" fill="#5b6cff" stroke="#141418" stroke-width="2" stroke-linejoin="round"/><path d="m12 7.2 1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z" fill="#ffd84a" stroke="#141418" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  var css = document.createElement('style');
  css.textContent = [
    '#btnAdmin{display:flex;align-items:center;justify-content:center;padding:0;background:#fff3c4!important;margin-left:auto;margin-right:8px}',
    '#btnAdmin svg{width:26px;height:26px}',
    '.adm-bar{display:flex;gap:6px;margin-bottom:10px}',
    '.adm-in{flex:1;min-width:0;font:inherit;font-size:15px;padding:9px 12px;border:3px solid #141418;border-radius:12px;background:#fff;color:#2b2b3a}',
    '.adm-b{font:inherit;font-size:14px;padding:8px 11px;border:3px solid #141418!important;border-radius:12px;background:#ffd84a;color:#2b2b3a;white-space:nowrap}',
    '.adm-b.blue{background:#8fd3ff}.adm-b.red{background:#ff8a7a}.adm-b.gray{background:#e6dcc6}.adm-b:active{transform:translateY(2px)}',
    '.adm-row{background:#f3ead8;border:3px solid #141418;border-radius:14px;padding:10px 12px;color:#2b2b3a}',
    '.adm-row.banned{background:#ffd9d2}',
    '.adm-top{display:flex;align-items:center;gap:8px}',
    '.adm-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px}',
    '.adm-name small{color:#8a7f68;font-size:12px;margin-left:4px}',
    '.adm-info{font-size:12.5px;color:#6d6452;margin-top:3px}',
    '.adm-tag{font-size:12px;background:#ff5a4a;color:#fff;border-radius:8px;padding:2px 7px;margin-left:6px}',
    '.adm-more{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}',
    '.adm-list{display:flex;flex-direction:column;gap:8px}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function g(name) { try { return (0, eval)(name); } catch (_) { return undefined; } }   // 게임 쪽 값/함수 가져오기
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var pollTimer = null;
  function afterLogin(x) {
    var u = x.auth.currentUser; if (!u) return;
    x.F.getDoc(x.F.doc(x.db, 'admins', u.uid)).then(function (d) { ADMIN = d.exists() || u.email === ADMIN_EMAIL; updateAdminBtn(); }).catch(function () { ADMIN = false; updateAdminBtn(); });
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { poll(x); }, 20000);
    setTimeout(function () { poll(x); }, 2500);
  }

  var polling = false;
  async function poll(x) {
    var u = x.auth.currentUser;
    if (!u) { clearInterval(pollTimer); return; }
    if (g('PROFILE') !== '@server' || polling) return;
    polling = true;
    try {
      var ban = await x.F.getDoc(x.F.doc(x.db, 'bans', u.uid));
      if (ban.exists()) {
        clearInterval(pollTimer);
        var why = (ban.data() && ban.data().reason) || '';
        var msg = '이 계정은 관리자에 의해 정지됐어요' + (why ? ' (' + why + ')' : '');
        try { await g('logout')(); } catch (_) {}
        try { document.getElementById('lErr').textContent = msg; } catch (_) {}
        return;
      }
      var gs = await x.F.getDocs(x.F.collection(x.db, 'users', u.uid, 'gifts'));
      var total = 0, note = '';
      for (var i = 0; i < gs.docs.length; i++) {
        var d = gs.docs[i], v = d.data();
        await x.F.deleteDoc(d.ref);
        var c = Math.floor(Number(v.coins) || 0);
        if (c > 0 && c <= 1000000) total += c;
        if (v.msg) note = v.msg;
      }
      if (total > 0) {
        var sv = g('save');
        sv.coins = (sv.coins || 0) + total;
        try { g('persist')(); } catch (_) {}
        try { g('refreshLobby')(); } catch (_) {}
        try { g('SFX').buy(); } catch (_) {}
        try { g('showLobbyMsg')('관리자 선물 도착! 코인 +' + total + (note ? ' · ' + note : '')); } catch (_) {}
      }
    } catch (_) { }
    polling = false;
  }

  function updateAdminBtn() {
    var bar = document.querySelector('#lobby .topbar');
    if (!bar) return;
    var b = document.getElementById('btnAdmin');
    if (ADMIN && !b) {
      b = document.createElement('button');
      b.className = 'icon'; b.id = 'btnAdmin'; b.title = '관리자'; b.innerHTML = SHIELD;
      b.addEventListener('click', function () { try { g('SFX').click(); } catch (_) {} openAdmin(); });
      bar.insertBefore(b, document.getElementById('btnSet'));
    } else if (!ADMIN && b) b.remove();
  }
  var waitBar = setInterval(function () { if (document.querySelector('#lobby .topbar')) { clearInterval(waitBar); updateAdminBtn(); } }, 300);

  var admRows = [], admBans = {}, admOpen = null, admArm = null;
  async function loadAdmin(x, search) {
    var F = x.F, db = x.db;
    var bans = await F.getDocs(F.collection(db, 'bans'));
    admBans = {}; bans.docs.forEach(function (d) { admBans[d.id] = d.data() || {}; });
    var q = search
      ? F.query(F.collection(db, 'users'), F.where('id', '==', search.toLowerCase()))
      : F.query(F.collection(db, 'users'), F.orderBy('updated', 'desc'), F.limit(100));
    var snap = await F.getDocs(q);
    admRows = snap.docs.map(function (d) {
      var v = d.data(), sv = {}; try { sv = v.save ? JSON.parse(v.save) : {}; } catch (_) {}
      return { uid: d.id, id: v.id || '?', nick: v.nick || '닌자', coins: sv.coins || 0, tower: (sv.stats && sv.stats.tower) || 0, updated: v.updated || 0 };
    });
  }
  function ago(t) {
    if (!t) return '-';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return '방금'; if (m < 60) return m + '분 전';
    var hh = Math.floor(m / 60); if (hh < 24) return hh + '시간 전';
    return Math.floor(hh / 24) + '일 전';
  }
  function renderAdmin(note) {
    var body = document.getElementById('sheetBody'); if (!body) return;
    var sv = document.getElementById('admQ') ? document.getElementById('admQ').value : '';
    var rows = admRows.map(function (r) {
      var b = admBans[r.uid];
      var more = admOpen === r.uid
        ? '<div class="adm-more">' +
            '<button class="adm-b" data-give="100">+100</button><button class="adm-b" data-give="500">+500</button><button class="adm-b" data-give="1000">+1000</button>' +
            '<input class="adm-in" id="admAmt" type="number" inputmode="numeric" placeholder="직접 입력" style="flex:1 1 90px">' +
            '<button class="adm-b blue" data-give="custom">보내기</button>' +
          '</div>'
        : '';
      return '<div class="adm-row' + (b ? ' banned' : '') + '" data-uid="' + r.uid + '">' +
        '<div class="adm-top"><div class="adm-name">' + h(r.nick) + '<small>@' + h(r.id) + '</small>' + (b ? '<span class="adm-tag">정지됨</span>' : '') + '</div>' +
        '<button class="adm-b" data-act="coin">코인 주기</button>' +
        (b ? '<button class="adm-b gray" data-act="unban">정지 풀기</button>'
           : '<button class="adm-b red" data-act="ban">' + (admArm === r.uid ? '정말 정지?' : '정지') + '</button>') +
        '</div>' +
        '<div class="adm-info">코인 ' + r.coins + ' · 탑 ' + r.tower + 'm · 마지막 저장 ' + ago(r.updated) + (b && b.reason ? ' · 사유: ' + h(b.reason) : '') + '</div>' +
        more + '</div>';
    }).join('');
    body.innerHTML =
      '<a class="adm-b blue" href="admin.html" target="_blank" style="display:block;text-align:center;text-decoration:none;margin-bottom:10px">관리자 페이지 열기 (이벤트 · 공지 · 선물 뿌리기)</a>' +
      '<div class="adm-bar"><input class="adm-in" id="admQ" placeholder="아이디로 찾기 (비우면 최근 100명)" value="' + h(sv) + '"><button class="adm-b blue" id="admGo">찾기</button></div>' +
      (note ? '<div class="note" style="margin:0 0 10px;color:#2f7fd6">' + h(note) + '</div>' : '') +
      '<div class="adm-list">' + (rows || '<div class="note">플레이어가 없어요</div>') + '</div>' +
      '<div class="note">코인은 그 플레이어가 게임에 접속해 있으면 20초 안에, 아니면 다음 접속 때 들어가요.<br>정지하면 바로 튕기고 랭킹에서도 빠져요.</div>';
    body.querySelectorAll('input').forEach(function (i) {
      i.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && i.id === 'admQ') document.getElementById('admGo').click(); });
      i.addEventListener('keyup', function (e) { e.stopPropagation(); });
    });
  }
  async function openAdmin() {
    var open = g('openSheet'); if (!open) return;
    open(SHIELD + '관리자', '<div class="note">불러오는 중…</div>');
    admOpen = null; admArm = null;
    try { var x = await fb(); await loadAdmin(x, ''); renderAdmin(); }
    catch (e) { document.getElementById('sheetBody').innerHTML = '<div class="note">관리자 정보를 불러오지 못했어요</div>'; }
  }
  document.addEventListener('click', async function (e) {
    var body = document.getElementById('sheetBody');
    if (!ADMIN || !body || !body.contains(e.target) || !document.querySelector('.adm-list')) return;
    var t = e.target.closest('button'); if (!t) return;
    var x = await fb(); var F = x.F, db = x.db;
    var row = t.closest('.adm-row'), uid = row && row.dataset.uid;
    var r = admRows.find(function (z) { return z.uid === uid; });
    try {
      if (t.id === 'admGo') {
        await loadAdmin(x, document.getElementById('admQ').value.trim()); admOpen = null; admArm = null; renderAdmin();
        return;
      }
      if (!r) return;
      var act = t.dataset.act, give = t.dataset.give;
      if (act === 'coin') { admOpen = admOpen === uid ? null : uid; admArm = null; renderAdmin(); return; }
      if (give) {
        var n = give === 'custom' ? Math.floor(Number(document.getElementById('admAmt').value)) : Number(give);
        if (!(n > 0 && n <= 1000000)) { renderAdmin('1 ~ 1000000 사이로 적어주세요'); return; }
        await F.addDoc(F.collection(db, 'users', uid, 'gifts'), { coins: n, msg: '', at: Date.now(), by: x.auth.currentUser.uid });
        try { g('SFX').buy(); } catch (_) {}
        admOpen = null; renderAdmin(r.nick + '에게 코인 ' + n + '개를 보냈어요');
        return;
      }
      if (act === 'ban') {
        if (uid === x.auth.currentUser.uid) { renderAdmin('자기 자신은 정지할 수 없어요'); return; }
        if (admArm !== uid) { admArm = uid; renderAdmin(); return; }
        admArm = null;
        await F.setDoc(F.doc(db, 'bans', uid), { reason: '', at: Date.now(), by: x.auth.currentUser.uid });
        try { await F.deleteDoc(F.doc(db, 'ranks', uid)); } catch (_) {}
        admBans[uid] = { at: Date.now() };
        try { g('SFX').nope(); } catch (_) {}
        renderAdmin(r.nick + ' 계정을 정지했어요');
        return;
      }
      if (act === 'unban') {
        await F.deleteDoc(F.doc(db, 'bans', uid));
        delete admBans[uid];
        renderAdmin(r.nick + ' 계정의 정지를 풀었어요 (랭킹은 다음 저장 때 돌아와요)');
        return;
      }
    } catch (err) { renderAdmin('실패했어요: ' + ((err && err.code) || '권한이 없어요')); }
  });

  // ───────── 실시간 운영: 공지 · 화면 메시지 · 이벤트 · 모두에게 선물 · 접속 표시 ─────────
  var ADMIN_EMAIL = '123eet7' + EMAIL_DOMAIN;          // 이 아이디로 가입한 계정은 관리자
  var LIVE = { notice: '', bcast: null, event: null, gift: null };
  var css2 = document.createElement('style');
  css2.textContent = [
    '#cnNotice{pointer-events:none!important;max-width:86%;margin:6px auto 0;padding:7px 14px;border:3px solid #141418;border-radius:14px;background:#fffaf0;color:#2b2b3a;font-size:14px;text-align:center;line-height:1.4;box-shadow:0 3px 0 #141418}',
    '#cnNotice b{color:#e0503a;margin-right:6px}',
    '#cnEvent{pointer-events:none!important;margin:6px auto 0;padding:6px 14px;border:3px solid #141418;border-radius:999px;background:linear-gradient(90deg,#ffd84a,#ff9f43);color:#2b2b3a;font-size:14px;text-align:center;box-shadow:0 3px 0 #141418;animation:cnPulse 1.6s ease-in-out infinite}',
    '#cnEvent small{display:block;font-size:11.5px;color:#5a3a00}',
    '@keyframes cnPulse{50%{transform:scale(1.04)}}',
    '#cnBand{position:fixed;left:0;right:0;top:0;z-index:30;height:30px;overflow:hidden;background:rgba(20,20,24,.92);border-bottom:3px solid #ffd84a;pointer-events:none}',
    '#cnBand span{position:absolute;top:4px;white-space:nowrap;color:#fff;font-size:16px;will-change:transform}',
    '#cnBand b{color:#ffd84a;margin-right:8px}',
    '#cnPop{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(5,10,20,.55);animation:fade .2s}',
    '#cnPop .pc{width:min(320px,86vw);background:#fffaf0;border:4px solid #141418;border-radius:22px;padding:18px 16px 14px;text-align:center;color:#2b2b3a;box-shadow:0 6px 0 #141418;animation:pop .3s}',
    '#cnPop .pt{font-size:22px;margin:6px 0 8px}',
    '#cnPop .pl{font-size:15px;line-height:1.6;margin-bottom:12px}',
    '#cnPop .pl b{color:#a06a00}',
    '#cnPop button{font:inherit;font-size:17px;padding:10px 26px;border:3px solid #141418;border-radius:14px;background:#ffd84a;color:#2b2b3a;box-shadow:0 3px 0 #141418}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css2);

  var ICON_GIFT = '<svg viewBox="0 0 64 64" width="64" height="64"><rect x="10" y="26" width="44" height="30" rx="5" fill="#ff6b6b" stroke="#141418" stroke-width="3.5"/><rect x="6" y="18" width="52" height="12" rx="4" fill="#ff8f8f" stroke="#141418" stroke-width="3.5"/><rect x="28" y="18" width="8" height="38" fill="#ffd84a" stroke="#141418" stroke-width="3"/><path d="M32 18c-6-10-17-10-15-3 1 4 9 4 15 3zm0 0c6-10 17-10 15-3-1 4-9 4-15 3z" fill="#ffd84a" stroke="#141418" stroke-width="3" stroke-linejoin="round"/></svg>';
  var ICON_HORN = '<svg viewBox="0 0 64 64" width="64" height="64"><path d="M10 26h10l26-14v40L20 38H10z" fill="#8fd3ff" stroke="#141418" stroke-width="3.5" stroke-linejoin="round"/><path d="M20 38l4 14h8l-3-12" fill="#5b6cff" stroke="#141418" stroke-width="3.5" stroke-linejoin="round"/><path d="M52 24c4 4 4 12 0 16" fill="none" stroke="#141418" stroke-width="3.5" stroke-linecap="round"/></svg>';
  var ICON_STAR = '<svg viewBox="0 0 64 64" width="64" height="64"><path d="m32 6 7.6 16 17.4 2.3-12.8 12 3.3 17.2L32 45l-15.5 8.5 3.3-17.2L7 24.3 24.4 22z" fill="#ffd84a" stroke="#141418" stroke-width="3.5" stroke-linejoin="round"/></svg>';

  function popup(icon, title, lines) {
    var old = document.getElementById('cnPop'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'cnPop';
    d.innerHTML = '<div class="pc">' + icon + '<div class="pt">' + h(title) + '</div><div class="pl">' + lines.join('<br>') + '</div><button>좋아!</button></div>';
    d.querySelector('button').addEventListener('click', function () { try { g('SFX').click(); } catch (_) {} d.remove(); });
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 14000);
  }

  var fmtLeft = function (ms) {
    if (ms <= 0) return '곧 끝나요';
    var m = Math.floor(ms / 60000), hh = Math.floor(m / 60), dd = Math.floor(hh / 24);
    if (dd >= 1) return dd + '일 ' + (hh % 24) + '시간 남음';
    if (hh >= 1) return hh + '시간 ' + (m % 60) + '분 남음';
    return Math.max(1, m) + '분 남음';
  };
  function evActive() { var e = LIVE.event; return e && (!e.until || e.until > Date.now()) ? e : null; }
  function evCoin() { var e = evActive(); return e && e.coin > 1 ? Math.min(10, e.coin) : 1; }
  function evMission() { var e = evActive(); return e && e.mission > 1 ? Math.min(5, e.mission) : 1; }
  function evText(e) {
    var p = [];
    if (e.coin > 1) p.push('엽전 ' + e.coin + '배');
    if (e.mission > 1) p.push('미션 보상 ' + e.mission + '배');
    return p.join(' · ');
  }

  function renderLobbyLive() {
    var lobby = document.getElementById('lobby'); if (!lobby) return;
    var top = lobby.querySelector('.topbar');
    var n = document.getElementById('cnNotice');
    if (LIVE.notice) {
      if (!n) { n = document.createElement('div'); n.id = 'cnNotice'; top.insertAdjacentElement('afterend', n); }
      n.innerHTML = '<b>공지</b>' + h(LIVE.notice);
    } else if (n) n.remove();
    var ev = evActive(), el = document.getElementById('cnEvent');
    if (ev && evText(ev)) {
      if (!el) { el = document.createElement('div'); el.id = 'cnEvent'; (document.getElementById('cnNotice') || top).insertAdjacentElement('afterend', el); }
      el.innerHTML = '이벤트 진행 중! ' + h(ev.msg || '') + ' <b>' + evText(ev) + '</b>' + (ev.until ? '<small>' + fmtLeft(ev.until - Date.now()) + '</small>' : '');
    } else if (el) el.remove();
  }
  setInterval(renderLobbyLive, 30000);

  var bandAnim = null;
  function showBand(text) {
    var old = document.getElementById('cnBand'); if (old) old.remove();
    cancelAnimationFrame(bandAnim);
    var b = document.createElement('div'); b.id = 'cnBand';
    var s = document.createElement('span'); s.innerHTML = '<b>관리자</b>' + h(text);
    b.appendChild(s); document.body.appendChild(b);
    var x = window.innerWidth, loops = 0, last = performance.now();
    (function step(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      x -= 90 * dt;
      if (x < -s.offsetWidth) { x = window.innerWidth; loops++; }
      s.style.transform = 'translateX(' + x + 'px)';
      if (loops >= 3) { b.remove(); return; }
      bandAnim = requestAnimationFrame(step);
    })(last);
  }
  function seen(key, id) { try { var k = 'cn_seen_' + key; if (localStorage.getItem(k) === String(id)) return true; localStorage.setItem(k, String(id)); } catch (_) {} return false; }

  function tryClaimAllGift() {
    var gf = LIVE.gift;
    if (!gf || !gf.id || (gf.until && gf.until < Date.now())) return;
    if (g('PROFILE') !== '@server') return;                      // 로그인한 사람만 받아요
    var sv = g('save'); if (!sv || (sv.adminGift || 0) >= gf.id) return;
    sv.adminGift = gf.id;
    var c = Math.max(0, Math.min(1000000, Math.floor(Number(gf.coins) || 0)));
    sv.coins = (sv.coins || 0) + c;
    try { g('persist')(); g('refreshLobby')(); g('SFX').buy(); } catch (_) {}
    var lines = []; if (c) lines.push('<b>엽전 +' + c + '</b>'); if (gf.msg) lines.push(h(gf.msg));
    popup(ICON_GIFT, '관리자 선물 도착!', lines.length ? lines : ['고마워요!']);
  }

  function onLive(d) {
    var prevEv = LIVE.event;
    LIVE = { notice: d.notice || '', bcast: d.bcast || null, event: d.event || null, gift: d.gift || null };
    renderLobbyLive();
    var bc = LIVE.bcast;
    if (bc && bc.text && (!bc.until || bc.until > Date.now()) && !seen('bc', bc.id)) {
      showBand(bc.text);
      if (g('mode') !== 'play') popup(ICON_HORN, '관리자 메시지', [h(bc.text)]);
    }
    var ev = evActive();
    if (ev && evText(ev) && !seen('ev', ev.id)) popup(ICON_STAR, '이벤트 시작!', [(ev.msg ? h(ev.msg) + '<br>' : '') + '<b>' + evText(ev) + '</b>', ev.until ? fmtLeft(ev.until - Date.now()) : '끝날 때까지 계속돼요']);
    tryClaimAllGift();
  }
  fb().then(function (x) {
    x.F.onSnapshot(x.F.doc(x.db, 'config', 'live'), function (s) { onLive(s.exists() ? s.data() : {}); }, function () {});
  }).catch(function () {});
  setInterval(tryClaimAllGift, 5000);

  // 접속 중 표시 (관리자 페이지에서 봐요)
  setInterval(function () {
    if (document.hidden || g('PROFILE') !== '@server') return;
    fb().then(function (x) {
      var u = x.auth.currentUser; if (!u) return;
      var sv = g('save') || {};
      x.F.setDoc(x.F.doc(x.db, 'presence', u.uid), { nick: sv.nick || '', id: (u.email || '').split('@')[0], at: Date.now(), where: g('mode') || '' }).catch(function () {});
    });
  }, 45000);

  // 이벤트 배수 적용: 스테이지 클리어 · 무한의 탑 · 일일 미션
  var pendingBonus = 0, pendingMul = 1;
  function wrapReward(name) {
    var orig = g(name); if (typeof orig !== 'function') return;
    window[name] = function () {
      var sv = g('save'), before = sv ? sv.coins : 0, mul = evCoin();
      var r = orig.apply(this, arguments);
      if (mul > 1 && sv) {
        var delta = sv.coins - before;
        if (delta > 0) { var extra = delta * (mul - 1); sv.coins += extra; pendingBonus = extra; pendingMul = mul; try { g('persist')(); } catch (_) {} }
      }
      return r;
    };
  }
  function wrapModal() {
    var orig = g('openModal'); if (typeof orig !== 'function') return;
    window.openModal = function (html) {
      if (pendingBonus > 0 && typeof html === 'string' && html.indexOf('엽전 획득') >= 0) {
        html = html.replace('엽전 획득', '엽전 획득 · <span>이벤트 ' + pendingMul + '배! +' + pendingBonus + '</span>');
        pendingBonus = 0;
      }
      return orig.apply(this, arguments.length ? [html].concat([].slice.call(arguments, 1)) : arguments);
    };
  }
  function wrapDaily() {
    var orig = g('bindDaily'); if (typeof orig !== 'function') return;
    window.bindDaily = function () {
      var r = orig.apply(this, arguments);
      var body = document.getElementById('sheetBody');
      if (body) body.querySelectorAll('button[data-daily]').forEach(function (b) {
        var before = null;
        b.addEventListener('pointerdown', function () { var sv = g('save'); before = sv ? sv.coins : null; }, true);
        b.addEventListener('click', function () {
          var mul = evMission(), sv = g('save');
          if (mul > 1 && sv && before != null && sv.coins > before) {
            var extra = (sv.coins - before) * (mul - 1); sv.coins += extra;
            try { g('persist')(); g('refreshLobby')(); g('showLobbyMsg')('이벤트! 미션 보상 ' + mul + '배 (+' + extra + ')'); } catch (_) {}
          }
          before = null;
        });
      });
      return r;
    };
  }
  var hookT = setInterval(function () {
    if (typeof g('clearStage') === 'function' && typeof g('openModal') === 'function') {
      clearInterval(hookT);
      wrapReward('clearStage'); wrapReward('towerOver'); wrapModal(); wrapDaily();
    }
  }, 200);

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var href = typeof input === 'string' ? input : (input && input.url) || '';
    var url;
    try { url = new URL(href, location.href); } catch (_) { return realFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf('/api/') < 0) return realFetch(input, init);
    url = new URL(url.pathname.slice(url.pathname.indexOf('/api/')) + url.search, location.origin);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) {}
    return handle(method, url, body).catch(function (e) {
      var c = (e && e.code) || '';
      if (c.indexOf('permission-denied') >= 0) return out(401, { error: '다시 로그인해 주세요' });
      if (c.indexOf('unavailable') >= 0) return out(503, { error: '서버에 연결할 수 없어요' });
      return out(500, { error: '서버 오류가 났어요' });
    });
  };
})();
