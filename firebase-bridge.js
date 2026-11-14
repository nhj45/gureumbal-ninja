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
      catch (e) {
        // 관리자 아이디는 회원가입 없이 처음 로그인할 때 바로 계정이 만들어져요
        var code = (e && e.code) || '';
        if (lid + EMAIL_DOMAIN === ADMIN_EMAIL && lpw.length >= 4 && /invalid-credential|user-not-found|invalid-login/.test(code)) {
          try {
            var ac = await A.createUserWithEmailAndPassword(auth, emailOf(lid), pwOf(lpw));
            await F.setDoc(F.doc(db, 'users', ac.user.uid), { id: lid, nick: '관리자', save: null, updated: Date.now() });
          } catch (e2) {
            if (((e2 && e2.code) || '').indexOf('email-already-in-use') >= 0) return out(401, { error: '아이디나 비밀번호가 틀렸어요' });
            return authError(e2);
          }
        } else return authError(e);
      }
      return me(x);
    }

    if (route === 'GET /api/rank') {
      var board = url.searchParams.get('board') || 'tower';
      if (board !== 'tower' && !/^t[0-9]$/.test(board)) return out(400, { error: '없는 랭킹이에요' });
      var q = F.query(F.collection(db, 'ranks'), F.orderBy(board, board === 'tower' ? 'desc' : 'asc'), F.limit(50));
      var snap = await F.getDocs(q);
      var myUid = auth.currentUser && auth.currentUser.uid;
      var list = snap.docs.map(function (d) { var v = d.data(); return { nick: (v.title ? '[' + v.title + '] ' : '') + (v.nick || '닌자'), v: v[board], me: d.id === myUid }; })
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
      var rdoc = Object.assign({ updated: now, title: titleOf(body.save) }, r);
      if (nickNow) rdoc.nick = nickNow;
      if (user.email !== ADMIN_EMAIL) await F.setDoc(F.doc(db, 'ranks', user.uid), rdoc, { merge: true });   // 관리자는 랭킹에 안 올라가요
      return out(200, { ok: true, at: now });
    }

    if (route === 'POST /api/logout') { stopWatch(); clearInterval(pollTimer); ADMIN = false; updateAdminBtn(); await A.signOut(auth); return out(200, { ok: true }); }

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
    x.F.getDoc(x.F.doc(x.db, 'admins', u.uid)).then(function (d) { ADMIN = d.exists() || u.email === ADMIN_EMAIL; updateAdminBtn();
      if (ADMIN) { x.F.deleteDoc(x.F.doc(x.db, 'ranks', u.uid)).catch(function () {}); x.F.deleteDoc(x.F.doc(x.db, 'presence', u.uid)).catch(function () {}); } }).catch(function () { ADMIN = false; updateAdminBtn(); });
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { poll(x); }, 20000);
    setTimeout(function () { poll(x); }, 2500);
    // 관리자가 선물을 주거나 정지하면 바로 알 수 있게 실시간으로 지켜봐요
    stopWatch();
    watchers = [
      x.F.onSnapshot(x.F.collection(x.db, 'users', u.uid, 'gifts'), function (s) { if (s.docs.length) setTimeout(function () { poll(x); }, 400); }, function () {}),
      x.F.onSnapshot(x.F.doc(x.db, 'bans', u.uid), function (s) { if (s.exists()) setTimeout(function () { poll(x); }, 100); }, function () {})
    ];
  }
  var watchers = [];
  function stopWatch() { watchers.forEach(function (f) { try { f(); } catch (_) {} }); watchers = []; }

  var polling = false, pollAgain = false, pollWait = 0;
  async function poll(x) {
    var u = x.auth.currentUser;
    if (!u) { clearInterval(pollTimer); return; }
    if (polling) { pollAgain = true; return; }
    if (g('PROFILE') !== '@server') { if (pollWait++ < 20) setTimeout(function () { poll(x); }, 1000); return; }
    pollWait = 0; polling = true;
    try {
      var ban = await x.F.getDoc(x.F.doc(x.db, 'bans', u.uid));
      if (ban.exists()) {
        clearInterval(pollTimer); stopWatch(); polling = false;
        var why = (ban.data() && ban.data().reason) || '';
        var msg = '이 계정은 관리자에 의해 정지됐어요' + (why ? ' (' + why + ')' : '');
        try { await g('logout')(); } catch (_) {}
        try { document.getElementById('lErr').textContent = msg; } catch (_) {}
        popQ = []; laterQ = []; var op = document.getElementById('cnPop'); if (op) op.remove();
        var bp = popup(ICON_HORN, '계정 정지', [h(msg)]); if (bp) bp.dataset.keep = '1';
        return;
      }
      var gs = await x.F.getDocs(x.F.collection(x.db, 'users', u.uid, 'gifts'));
      var total = 0, note = '', msgs = [];
      for (var i = 0; i < gs.docs.length; i++) {
        var d = gs.docs[i], v = d.data();
        await x.F.deleteDoc(d.ref);
        var c = Math.floor(Number(v.coins) || 0);
        if (c > 0 && c <= 1000000) { total += c; if (v.msg) note = v.msg; }
        else if (v.msg) msgs.push(String(v.msg).slice(0, 120));      // 엽전 없이 메시지만 온 것
      }
      msgs.forEach(function (m) { tellPlayer(ICON_HORN, '관리자 메시지', [h(m)]); });
      if (msgs.length) { try { g('SFX').buy(); } catch (_) {} }
      if (total > 0) {
        var sv = g('save');
        sv.coins = (sv.coins || 0) + total;
        try { g('persist')(); } catch (_) {}
        try { g('refreshLobby')(); } catch (_) {}
        try { g('SFX').buy(); } catch (_) {}
        tellPlayer(ICON_GIFT, '관리자 선물 도착!', ['<b>엽전 +' + total + '</b>'].concat(note ? [h(note)] : []));
      }
    } catch (_) { }
    polling = false;
    if (pollAgain) { pollAgain = false; setTimeout(function () { poll(x); }, 300); }
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
    var me = x.auth.currentUser && x.auth.currentUser.uid, adminId = ADMIN_EMAIL.split('@')[0];
    admRows = snap.docs.filter(function (d) { var v = d.data(); return d.id !== me && v.id !== adminId; }).map(function (d) {   // 관리자 자신은 목록에서 빼요
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
            '<input class="adm-in" id="admMsg" maxlength="80" placeholder="메시지 (엽전과 같이 가거나, 메시지만 보낼 수 있어요)" style="flex:1 1 100%">' +
            '<button class="adm-b gray" data-give="msg" style="flex:1 1 100%">메시지만 보내기</button>' +
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
        var mtx = (document.getElementById('admMsg') || {}).value || ''; mtx = mtx.trim().slice(0, 80);
        if (give === 'msg') {
          if (!mtx) { renderAdmin('보낼 메시지를 적어주세요'); return; }
          await F.addDoc(F.collection(db, 'users', uid, 'gifts'), { coins: 0, msg: mtx, at: Date.now(), by: x.auth.currentUser.uid });
          admOpen = null; renderAdmin(r.nick + '에게 메시지를 보냈어요');
          return;
        }
        var n = give === 'custom' ? Math.floor(Number(document.getElementById('admAmt').value)) : Number(give);
        if (!(n > 0 && n <= 1000000)) { renderAdmin('1 ~ 1000000 사이로 적어주세요'); return; }
        await F.addDoc(F.collection(db, 'users', uid, 'gifts'), { coins: n, msg: mtx, at: Date.now(), by: x.auth.currentUser.uid });
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
    '#cnNotice{position:relative;padding-right:34px!important}',
    '#cnNotice .cnX{pointer-events:auto;position:absolute;right:4px;top:50%;transform:translateY(-50%);width:26px;height:26px;border:2px solid #141418;border-radius:50%;background:#f3ead8;color:#2b2b3a;font:inherit;font-size:16px;line-height:1;padding:0;cursor:pointer}',
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

  var popQ = [], laterQ = [];
  // 플레이 중이면 띠만 보이고, 큰 창은 판이 끝나면(로비·결과 화면) 바로 띄워요
  function tellPlayer(icon, title, lines) {
    if (g('mode') === 'play') { laterQ.push([icon, title, lines]); miniBand(title.replace(/^관리자\s*/, '') + ' ' + lines.join(' ').replace(/<[^>]+>/g, '')); }
    else popup(icon, title, lines);
  }
  setInterval(function () {
    if (laterQ.length && g('mode') !== 'play') { var q = laterQ; laterQ = []; q.forEach(function (n) { popup(n[0], n[1], n[2]); }); }
  }, 700);
  function miniBand(text) {                                  // 띠가 이미 흐르고 있으면 뒤에 이어 붙여요
    var sp = document.querySelector('#cnBand span');
    if (sp) { if (sp.textContent.indexOf(text) < 0) sp.insertAdjacentText('beforeend', '   ·   ' + text); return; }
    try { showBand(text); } catch (_) {}
  }
  function popup(icon, title, lines) {                      // 여러 개가 한꺼번에 오면 차례대로 보여줘요
    if (document.getElementById('cnPop')) { popQ.push([icon, title, lines]); return; }
    var d = document.createElement('div'); d.id = 'cnPop';
    d.innerHTML = '<div class="pc">' + icon + '<div class="pt">' + h(title) + '</div><div class="pl">' + lines.join('<br>') + '</div><button>좋아!</button></div>';
    var close = function () { if (!d.parentNode) return; d.remove(); var n = popQ.shift(); if (n) setTimeout(function () { popup(n[0], n[1], n[2]); }, 150); };
    d.querySelector('button').addEventListener('click', function () { try { g('SFX').click(); } catch (_) {} close(); });
    document.body.appendChild(d);
    try { g('vib')(30); } catch (_) {}
    setTimeout(close, 14000);
    return d;
  }

  var fmtLeft = function (ms) {
    if (ms <= 0) return '곧 끝나요';
    var m = Math.floor(ms / 60000), hh = Math.floor(m / 60), dd = Math.floor(hh / 24);
    if (dd >= 1) return dd + '일 ' + (hh % 24) + '시간 남음';
    if (hh >= 1) return hh + '시간 ' + (m % 60) + '분 남음';
    return Math.max(1, m) + '분 남음';
  };
  function evActive() { var e = LIVE.event; return e && (!e.until || e.until > Date.now()) ? e : null; }
  function loggedIn() { return g('PROFILE') === '@server'; }   // 관리자 공지·메시지·이벤트·선물은 로그인한 사람에게만
  function evCoin() { if (!loggedIn()) return 1; var e = evActive(); return e && e.coin > 1 ? Math.min(10, e.coin) : 1; }
  function evMission() { if (!loggedIn()) return 1; var e = evActive(); return e && e.mission > 1 ? Math.min(5, e.mission) : 1; }
  function evText(e) {
    var p = [];
    if (e.coin > 1) p.push('엽전 ' + e.coin + '배');
    if (e.mission > 1) p.push('미션 보상 ' + e.mission + '배');
    return p.join(' · ');
  }

  function renderLobbyLive() {
    var lobby = document.getElementById('lobby'); if (!lobby) return;
    var top = lobby.querySelector('.topbar'), on = loggedIn();
    var n = document.getElementById('cnNotice');
    var hidden = ''; try { hidden = localStorage.getItem('cn_hide_notice') || ''; } catch (_) {}
    if (on && LIVE.notice && hidden !== LIVE.notice) {
      if (!n) { n = document.createElement('div'); n.id = 'cnNotice'; top.insertAdjacentElement('afterend', n); }
      n.innerHTML = '<b>공지</b>' + h(LIVE.notice) + '<button class="cnX" aria-label="공지 닫기">×</button>';
      n.querySelector('.cnX').addEventListener('click', function () { try { localStorage.setItem('cn_hide_notice', LIVE.notice); g('SFX').click(); } catch (_) {} renderLobbyLive(); });
    } else if (n) n.remove();
    var ev = evActive(), el = document.getElementById('cnEvent');
    if (on && ev && evText(ev)) {
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

  var LASTLIVE = {};
  function onLive(d) {
    LASTLIVE = d || {};
    LIVE = { notice: d.notice || '', bcast: d.bcast || null, event: d.event || null, gift: d.gift || null };
    renderLobbyLive();
    if (!loggedIn()) return;                                   // 게스트·로그인 화면에서는 안 띄워요
    if (LIVE.notice && !seen('notice', LIVE.notice)) popup(ICON_HORN, '새 공지', [h(LIVE.notice)]);
    var bc = LIVE.bcast;
    if (bc && bc.text && (!bc.until || bc.until > Date.now()) && !seen('bc', bc.id)) {
      if (g('mode') !== 'play') showBand(bc.text);            // 플레이 중이면 tellPlayer가 띠를 한 번만 띄워요
      tellPlayer(ICON_HORN, '관리자 메시지', [h(bc.text)]);
    }
    var ev = evActive();
    if (ev && evText(ev) && !seen('ev', ev.id)) popup(ICON_STAR, '이벤트 시작!', [(ev.msg ? h(ev.msg) + '<br>' : '') + '<b>' + evText(ev) + '</b>', ev.until ? fmtLeft(ev.until - Date.now()) : '끝날 때까지 계속돼요']);
    tryClaimAllGift();
  }
  fb().then(function (x) {
    x.F.onSnapshot(x.F.doc(x.db, 'config', 'live'), function (s) { onLive(s.exists() ? s.data() : {}); }, function () {});
  }).catch(function () {});
  setInterval(tryClaimAllGift, 5000);
  // 로그인하면 그동안 못 본 공지·메시지·이벤트·선물을 바로 보여주고, 로그아웃하면 로비에서 치워요
  var wasIn = false;
  setInterval(function () {
    var now = loggedIn(); if (now === wasIn) return;
    wasIn = now;
    if (!now) { laterQ = []; popQ = []; var bd = document.getElementById('cnBand'); if (bd) bd.remove(); var pp = document.getElementById('cnPop'); if (pp && pp.dataset.keep !== '1') pp.remove(); }
    onLive(LASTLIVE);
  }, 800);

  // 접속 중 표시 (관리자 페이지에서 봐요)
  setInterval(function () {
    if (document.hidden || g('PROFILE') !== '@server') return;
    fb().then(function (x) {
      var u = x.auth.currentUser; if (!u || ADMIN) return;           // 관리자는 접속 목록에 안 보여요
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
      var ei = typeof html === 'string' ? html.indexOf('class="earn"') : -1;
      if (pendingBonus > 0 && ei >= 0) {
        var ce = html.indexOf('</div>', ei);
        html = html.slice(0, ei) + 'class="earn" style="flex-wrap:wrap;row-gap:2px"' + html.slice(ei + 12, ce) +
          '<span style="flex-basis:100%;text-align:center;font-size:15px">이벤트 ' + pendingMul + '배 보너스 +' + pendingBonus + '</span>' + html.slice(ce);
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


  // ───────── 비밀번호 보이기 버튼 (눈 모양) ─────────
  var EYE_ON = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="#fff" stroke="#141418" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.6" fill="#141418"/><circle cx="13.2" cy="10.8" r="1.1" fill="#fff"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="#e9e1cf" stroke="#141418" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.6" fill="#8a7f68"/><path d="M4 4l16 16" stroke="#141418" stroke-width="2.6" stroke-linecap="round"/></svg>';
  var css3 = document.createElement('style');
  css3.textContent = '.pwWrap{position:relative;width:100%}.pwWrap .lin{padding-right:50px}' +
    '.pwEye{position:absolute;right:8px;top:calc(50% - 4px);transform:translateY(-50%);width:38px;height:38px;border:none;background:none;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer}' +
    '.pwEye:active{transform:translateY(-50%) scale(.9)}';
  (document.head || document.documentElement).appendChild(css3);
  function addEye(id) {
    var inp = document.getElementById(id);
    if (!inp || inp.parentNode.classList.contains('pwWrap')) return;
    var wrap = document.createElement('div'); wrap.className = 'pwWrap';
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pwEye'; b.setAttribute('aria-label', '비밀번호 보이기'); b.innerHTML = EYE_OFF;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });          // 키보드가 닫히지 않게
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.innerHTML = show ? EYE_ON : EYE_OFF;
      b.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보이기');
      try { g('SFX').click(); } catch (_) {}
    });
    wrap.appendChild(b);
    var sync = function () { wrap.style.display = inp.classList.contains('hide') ? 'none' : ''; };
    sync(); new MutationObserver(sync).observe(inp, { attributes: true, attributeFilter: ['class'] });
  }
  var waitPw = setInterval(function () { if (document.getElementById('lPw')) { clearInterval(waitPw); addEye('lPw'); addEye('lPw2'); } }, 200);

  // ───────── 아이디 칸: 한글 자판으로 쳐도 영어로 바꿔 줘요 (ㄷㄷㅅ → eet) ─────────
  var KO2EN = (function () {
    var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
    var K = { 'ㄱ': 'r', 'ㄲ': 'R', 'ㄴ': 's', 'ㄷ': 'e', 'ㄸ': 'E', 'ㄹ': 'f', 'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅅ': 't', 'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
      'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅘ': 'hk', 'ㅙ': 'ho', 'ㅚ': 'hl', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj', 'ㅞ': 'np', 'ㅟ': 'nl', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅢ': 'ml', 'ㅣ': 'l',
      'ㄳ': 'rt', 'ㄵ': 'sw', 'ㄶ': 'sg', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq', 'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg', 'ㅄ': 'qt' };
    return function (str) {
      var out = '';
      for (var i = 0; i < str.length; i++) {
        var ch = str[i], c = ch.charCodeAt(0);
        if (c >= 0xAC00 && c <= 0xD7A3) {
          var n = c - 0xAC00, jo = JONG[n % 28];
          out += K[CHO[Math.floor(n / 588)]] + K[JUNG[Math.floor((n % 588) / 28)]] + (jo === ' ' ? '' : K[jo]);
        } else out += K[ch] || ch;
      }
      return out.toLowerCase();
    };
  })();
  function fixIdField(id) {
    var inp = document.getElementById(id); if (!inp || inp.dataset.ko) return;
    inp.dataset.ko = '1';
    inp.setAttribute('inputmode', 'email');                       // 폰에서 영어 자판이 먼저 뜨게
    inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('lang', 'en');
    var fix = function () { var v = inp.value, nv = KO2EN(v); if (nv !== v) inp.value = nv; };
    inp.addEventListener('compositionend', function () { setTimeout(fix, 0); });
    inp.addEventListener('input', function (e) { if (!e.isComposing) fix(); });
    inp.addEventListener('blur', fix);
    var go = document.getElementById('lGo');
    if (go) go.addEventListener('pointerdown', fix, true);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') fix(); }, true);
  }
  var waitId = setInterval(function () { if (document.getElementById('lId')) { clearInterval(waitId); fixIdField('lId'); } }, 200);

  // ───────── 엽전 상점: 허리띠 색 · 칼 빛 · 부적 · 칭호 · 뽑기 · 오늘의 운세 ─────────
  var SCARVES = [
    { id: 'basic', name: '기본 빨강', price: 0, a: [230, 40, 40] },
    { id: 'blue', name: '시원한 파랑', price: 150, a: [60, 150, 255] },
    { id: 'green', name: '대나무 초록', price: 150, a: [60, 200, 100] },
    { id: 'purple', name: '밤하늘 보라', price: 200, a: [160, 100, 255] },
    { id: 'pink', name: '벚꽃 분홍', price: 300, a: [255, 140, 200] },
    { id: 'gold', name: '번쩍 금색', price: 400, a: [255, 205, 50] },
    { id: 'rainbow', name: '무지개', price: 800, a: 'rainbow' }
  ];
  var TRAILS = [
    { id: 'basic', name: '기본 하늘빛', price: 0, c: ['#bfe6ff', '#ffffff'] },
    { id: 'fire', name: '불꽃 베기', price: 250, c: ['#ff9a3c', '#fff1a8'] },
    { id: 'bolt', name: '번개 베기', price: 250, c: ['#b48cff', '#ffffff'] },
    { id: 'sakura', name: '벚꽃 베기', price: 300, c: ['#ff9ec9', '#fff0f7'] },
    { id: 'ink', name: '먹물 베기', price: 300, c: ['#3a3a44', '#9a9aa8'] },
    { id: 'gold', name: '황금 베기', price: 500, c: ['#ffc928', '#fffbe0'] }
  ];
  var TITLES = [
    { id: '', name: '칭호 없음', price: 0 },
    { id: 't1', name: '수련생', price: 100 },
    { id: 't2', name: '엽전 부자', price: 300 },
    { id: 't3', name: '통나무 장인', price: 300 },
    { id: 't4', name: '탑의 지배자', price: 600 },
    { id: 't5', name: '하찮은 전설', price: 1000 }
  ];
  var TOOLS = [
    { id: 'shield', name: '방패 부적', price: 60, d: '다음 판을 시작할 때 방패를 두르고 시작해요 (한 번 막아줘요)' },
    { id: 'revive', name: '부활 부적', price: 120, d: '무한의 탑에서 쓰러지면 한 번 그 자리 근처에서 다시 일어나요' }
  ];
  var FORTUNES = ['오늘은 벽점프가 잘 되는 날!', '엽전이 굴러들어 오는 날이에요', '통나무가 되어도 웃어요. 내일의 닌자니까', '보스가 오늘따라 하찮아 보여요', '대시 한 번에 행운이 와요', '두루마리 냄새가 나요… 찾아보세요', '탑 꼭대기 바람이 순해요', '오늘 넘어지면 내일 날아요'];
  var ICON_BAG = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 8h14l-1.2 12.2a1.6 1.6 0 0 1-1.6 1.4H7.8a1.6 1.6 0 0 1-1.6-1.4z" fill="#ffd84a" stroke="#141418" stroke-width="2" stroke-linejoin="round"/><path d="M9 10V7a3 3 0 0 1 6 0v3" fill="none" stroke="#141418" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="15" r="2.2" fill="#e8333a" stroke="#141418" stroke-width="1.4"/></svg>';
  var css4 = document.createElement('style');
  css4.textContent = [
    '#btnShop{display:flex;align-items:center;justify-content:center;padding:0;background:#ffd84a!important;margin-left:8px}',
    '#btnShop svg{width:26px;height:26px}',
    '.shp-tabs{display:flex;gap:6px;margin-bottom:10px}',
    '.shp-tabs button{flex:1;font:inherit;font-size:14px;padding:8px 4px;border:3px solid #141418;border-radius:12px;background:#f3ead8;color:#2b2b3a}',
    '.shp-tabs button.on{background:#2b3a6b;color:#fff}',
    '.shp-list{display:flex;flex-direction:column;gap:8px}',
    '.shp-it{display:flex;align-items:center;gap:10px;background:#f3ead8;border:3px solid #141418;border-radius:14px;padding:9px 10px;color:#2b2b3a}',
    '.shp-it.eq{background:#fff3c4}',
    '.shp-sw{width:38px;height:38px;border-radius:50%;border:3px solid #141418;flex:none}',
    '.shp-tx{flex:1;min-width:0}.shp-tx b{display:block;font-size:16px;font-weight:normal}.shp-tx small{color:#7a705c;font-size:12px;line-height:1.35;display:block}',
    '.shp-b{font:inherit;font-size:14px;padding:8px 12px;border:3px solid #141418;border-radius:12px;background:#ffd84a;color:#2b2b3a;white-space:nowrap;display:flex;align-items:center;gap:4px}',
    '.shp-b.own{background:#8fd3ff}.shp-b.on{background:#5ad19a}.shp-b.no{opacity:.55}',
    '.shp-b i.coin{width:16px;height:16px}',
    '.shp-big{text-align:center;padding:10px 6px}',
    '.shp-big .shp-b{margin:10px auto 0;font-size:18px;padding:12px 22px}',
    '.shp-note{font-size:12.5px;color:#8a7f68;text-align:center;margin-top:10px;line-height:1.5}',
    '@keyframes shpSpin{0%{transform:rotate(0)}100%{transform:rotate(1turn)}}',
    '.shp-spin{animation:shpSpin .5s linear infinite;display:inline-block}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css4);

  var evalg = function (code) { try { return (0, eval)(code); } catch (_) { return undefined; } };
  function S() { return g('save') || {}; }
  function inv() { var s = S(); s.cnItems = s.cnItems || {}; return s.cnItems; }
  function owned(kind) { var s = S(); s.cnOwn = s.cnOwn || {}; s.cnOwn[kind] = s.cnOwn[kind] || ['basic', '']; return s.cnOwn[kind]; }
  function save2() { try { g('persist')(); g('refreshLobby')(); } catch (_) {} }
  var swatch = function (c) { return c === 'rainbow' ? 'conic-gradient(#ff4a4a,#ffd84a,#4fd27a,#4aa8ff,#b48cff,#ff4a4a)' : 'rgb(' + c.join(',') + ')'; };

  // 허리띠 색: 닌자 그림의 빨간 허리띠 부분만 골라서 다른 색으로 칠해요
  var sprOrig = null, sprCache = {};
  function hslRgb(hh) { var f = function (n) { var k = (n + hh / 30) % 12; return 255 * (0.6 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0), f(8), f(4)].map(Math.round); }
  function tintImg(img, rgb) {
    return new Promise(function (res) {
      try {
        var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height), p = d.data;
        for (var i = 0; i < p.length; i += 4) {
          var r = p[i], gg = p[i + 1], b = p[i + 2];
          if (p[i + 3] > 0 && r > 60 && r - gg > 45 && r - b > 45) {        // 빨간 허리띠 (테두리와 섞인 부분 포함)
            var k = Math.min(1.15, r / 230), m = Math.min(1, (r - Math.max(gg, b)) / 150);
            p[i] = Math.round(r * (1 - m) + rgb[0] * k * m); p[i + 1] = Math.round(gg * (1 - m) + rgb[1] * k * m); p[i + 2] = Math.round(b * (1 - m) + rgb[2] * k * m);
          }
        }
        x.putImageData(d, 0, 0);
        var out = new Image(); out.onload = function () { res(out); }; out.onerror = function () { res(img); }; out.src = c.toDataURL();
      } catch (_) { res(img); }
    });
  }
  function getSet(key, rgb) {
    if (sprCache[key]) return sprCache[key];
    sprCache[key] = Promise.all(sprOrig.run.map(function (im) { return tintImg(im, rgb); }));
    return sprCache[key];
  }
  var curBelt = 'basic', rainbowIdx = 0, beltBusy = false;
  setInterval(function () {
    var SP = g('SPR'); if (!SP || !SP.run || !SP.run.every(function (im) { return im.complete && im.naturalWidth > 0; })) return;
    if (!sprOrig) sprOrig = { run: SP.run.slice() };
    var id = S().cnScarf || 'basic';
    if (beltBusy) return;
    if (id === 'rainbow') {
      var key = 'rb' + rainbowIdx; beltBusy = true;
      getSet(key, hslRgb(rainbowIdx * 30)).then(function (set) { SP.run = set; curBelt = 'rainbow'; rainbowIdx = (rainbowIdx + 1) % 12; beltBusy = false; });
      return;
    }
    if (id === curBelt) return;
    if (id === 'basic') { SP.run = sprOrig.run.slice(); curBelt = 'basic'; return; }
    var sc = SCARVES.find(function (x) { return x.id === id; }); if (!sc) return;
    beltBusy = true;
    getSet(id, sc.a).then(function (set) { SP.run = set; curBelt = id; beltBusy = false; });
  }, 120);

  // 칼 빛 바꾸기 (칼끝 궤적 색)
  var hookTrail = setInterval(function () {
    if (typeof g('drawSlashTrail') !== 'function') return;
    clearInterval(hookTrail);
    var orig = g('drawSlashTrail');
    window.drawSlashTrail = function (p) {
      var id = S().cnTrail || 'basic'; if (id === 'basic') return orig(p);
      var tc = (TRAILS.find(function (x) { return x.id === id; }) || TRAILS[0]).c;
      var ctx = g('ctx'), tr = p.trail; if (!ctx || !tr || tr.length < 2) return;
      var n = tr.length, now = g('time') || 0;
      ctx.save(); ctx.lineJoin = 'round';
      [['#141418', 1, 0.5], [tc[0], 0.82, 0.9], [tc[1], 0.5, 1]].forEach(function (L) {
        ctx.beginPath();
        for (var i = 0; i < n; i++) { var q = tr[i]; i ? ctx.lineTo(q.ox, q.oy) : ctx.moveTo(q.ox, q.oy); }
        for (var j = n - 1; j >= 0; j--) { var q2 = tr[j], f = (j + 1) / n; ctx.lineTo(q2.ox + (q2.ix - q2.ox) * L[1] * f, q2.oy + (q2.iy - q2.oy) * L[1] * f); }
        ctx.closePath();
        ctx.globalAlpha = L[2] * Math.max(0, 1 - (now - tr[n - 1].t) * 8);
        ctx.fillStyle = L[0]; ctx.fill();
      });
      ctx.restore();
    };
  }, 300);

  // 방패 부적: 판을 시작할 때 자동으로 / 부활 부적: 무한의 탑에서 한 번
  var reviveUsed = false;
  var hookRun = setInterval(function () {
    if (typeof g('startStage') !== 'function' || typeof g('towerOver') !== 'function' || !(window.towerOver && String(window.towerOver).indexOf('evCoin') >= 0)) return;
    clearInterval(hookRun);
    var origStart = g('startStage');
    window.startStage = function () {
      var r = origStart.apply(this, arguments);
      reviveUsed = false;
      var it = inv();
      if (it.shield > 0) {
        it.shield--; evalg('P.shield = true'); save2();
        try { g('showToast')('방패 부적 발동! (남은 ' + it.shield + '개)', '#9fe0ff'); } catch (_) {}
      }
      return r;
    };
    var origOver = window.towerOver;
    window.towerOver = function () {
      var it = inv();
      if (g('ENDLESS') && !reviveUsed && it.revive > 0) {
        reviveUsed = true; it.revive--; save2();
        window.__cnPos = g('lastSafe') || g('respawn');
        evalg('if (water) water.y = Math.max(water.y, __cnPos.y + 220); P = newPlayer(__cnPos); P.airJumps = maxAir(P); P.invT = 2.2; P.ss = 0.7; deadLog = null; rigReset(scarf);' +
          'puff(__cnPos.x, __cnPos.y - 13, 16, "#fff3c4", 110, 8); ring(__cnPos.x, __cnPos.y - 12, "rgba(255,216,74,.9)", 34);');
        try { g('showToast')('부활 부적! 다시 일어났다 (남은 ' + it.revive + '개)', '#ffd84a'); g('SFX').buy(); } catch (_) {}
        return;
      }
      return origOver.apply(this, arguments);
    };
  }, 300);

  // 상점 화면
  var shopTab2 = 'scarf';
  function priceBtn(item, kind, eq, own) {
    if (eq) return '<button class="shp-b on" disabled>쓰는 중</button>';
    if (own) return '<button class="shp-b own" data-eq="' + kind + ':' + item.id + '">쓰기</button>';
    var no = (S().coins || 0) < item.price ? ' no' : '';
    return '<button class="shp-b' + no + '" data-buy="' + kind + ':' + item.id + '"><i class="coin sm"></i>' + item.price + '</button>';
  }
  function openShop2(msg) {
    var s = S(), body = '';
    var tabs = [['scarf', '허리띠'], ['trail', '칼 빛'], ['tool', '부적'], ['title', '칭호'], ['luck', '뽑기']];
    body += '<div class="shp-tabs">' + tabs.map(function (t) { return '<button data-stab="' + t[0] + '" class="' + (shopTab2 === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (msg) body += '<div class="note" style="margin:0 0 10px;color:#2f7fd6">' + msg + '</div>';
    if (shopTab2 === 'scarf') {
      var oS = owned('scarf'), cur = s.cnScarf || 'basic';
      body += '<div class="shp-list">' + SCARVES.map(function (x) { var own = oS.indexOf(x.id) >= 0; return '<div class="shp-it' + (cur === x.id ? ' eq' : '') + '"><span class="shp-sw" style="background:' + swatch(x.a) + '"></span><div class="shp-tx"><b>' + x.name + '</b><small>닌자 허리띠와 휘날리는 끈 색</small></div>' + priceBtn(x, 'scarf', cur === x.id, own) + '</div>'; }).join('') + '</div>';
    } else if (shopTab2 === 'trail') {
      var oT = owned('trail'), curT = s.cnTrail || 'basic';
      body += '<div class="shp-list">' + TRAILS.map(function (x) { var own = oT.indexOf(x.id) >= 0; return '<div class="shp-it' + (curT === x.id ? ' eq' : '') + '"><span class="shp-sw" style="background:linear-gradient(135deg,' + x.c[0] + ' 45%,' + x.c[1] + ')"></span><div class="shp-tx"><b>' + x.name + '</b><small>칼을 휘두를 때 남는 빛깔</small></div>' + priceBtn(x, 'trail', curT === x.id, own) + '</div>'; }).join('') + '</div>';
    } else if (shopTab2 === 'tool') {
      var it = inv();
      body += '<div class="shp-list">' + TOOLS.map(function (x) { var n = it[x.id] || 0, no = (s.coins || 0) < x.price || n >= 9 ? ' no' : ''; return '<div class="shp-it"><span class="shp-sw" style="background:' + (x.id === 'shield' ? '#8fd3ff' : '#ffd84a') + '"></span><div class="shp-tx"><b>' + x.name + ' <span style="color:#a06a00">×' + n + '</span></b><small>' + x.d + '</small></div><button class="shp-b' + no + '" data-tool="' + x.id + '"><i class="coin sm"></i>' + x.price + '</button></div>'; }).join('') + '</div><div class="shp-note">부적은 9개까지 가질 수 있어요. 방패 부적은 판을 시작할 때 1개씩 자동으로 써요.</div>';
    } else if (shopTab2 === 'title') {
      var oTi = owned('title'), curTi = s.cnTitle || '';
      body += '<div class="shp-list">' + TITLES.map(function (x) { var own = oTi.indexOf(x.id) >= 0; return '<div class="shp-it' + (curTi === x.id ? ' eq' : '') + '"><span class="shp-sw" style="background:#2b3a6b"></span><div class="shp-tx"><b>' + (x.id ? '[' + x.name + ']' : x.name) + '</b><small>랭킹에서 닉네임 앞에 붙어요</small></div>' + priceBtn(x, 'title', curTi === x.id, own) + '</div>'; }).join('') + '</div>';
    } else {
      var today = new Date().toDateString(), done = s.cnFortune === today;
      body += '<div class="shp-it shp-big" style="display:block"><b style="font-size:18px">행운 뽑기</b><small style="display:block;color:#7a705c">엽전 100개로 한 번! 엽전 대박 · 부적 · 아직 없는 허리띠 색이나 칼 빛이 나와요</small><button class="shp-b' + ((s.coins || 0) < 100 ? ' no' : '') + '" data-gacha="1"><i class="coin sm"></i>100 뽑기</button></div>';
      body += '<div class="shp-it shp-big" style="display:block;margin-top:8px"><b style="font-size:18px">오늘의 운세</b><small style="display:block;color:#7a705c">하루에 한 번 무료! 운세와 작은 엽전 선물</small><button class="shp-b' + (done ? ' no' : ' own') + '" data-fortune="1">' + (done ? '내일 또 와요' : '무료로 보기') + '</button></div>';
    }
    body += '<div class="shp-note">엽전은 스테이지 · 무한의 탑 · 미션 · 업적으로 모아요.</div>';
    var open = g('openSheet'); if (!open) return;
    var st = document.getElementById('sheetBody') ? document.getElementById('sheetBody').scrollTop : 0;
    var same = document.getElementById('sheetTitle') && /상점/.test(document.getElementById('sheetTitle').textContent) && !document.getElementById('sheet').classList.contains('hide');
    open(ICON_BAG + '상점 · 엽전 ' + (s.coins || 0), body);
    if (same) document.getElementById('sheetBody').scrollTop = st;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function gacha() {
    var s = S(); if ((s.coins || 0) < 100) return openShop2('엽전이 모자라요');
    s.coins -= 100;
    var r = Math.random(), prize;
    var noScarf = SCARVES.filter(function (x) { return owned('scarf').indexOf(x.id) < 0 && x.id !== 'rainbow'; });
    var noTrail = TRAILS.filter(function (x) { return owned('trail').indexOf(x.id) < 0; });
    if (r < 0.06) { s.coins += 500; prize = ['엽전 대박!', '<b>엽전 +500</b>']; }
    else if (r < 0.16 && (noScarf.length || noTrail.length)) {
      var useS = noScarf.length && (!noTrail.length || Math.random() < 0.5), x = useS ? pick(noScarf) : pick(noTrail);
      owned(useS ? 'scarf' : 'trail').push(x.id);
      prize = [useS ? '새 허리띠!' : '새 칼 빛!', '<b>' + x.name + '</b>을(를) 얻었어요. 상점에서 바로 쓸 수 있어요'];
    }
    else if (r < 0.36) { var t = Math.random() < 0.5 ? 'shield' : 'revive'; inv()[t] = Math.min(9, (inv()[t] || 0) + 1); prize = ['부적 획득!', '<b>' + (t === 'shield' ? '방패 부적' : '부활 부적') + ' +1</b>']; }
    else if (r < 0.66) { s.coins += 120; prize = ['조금 이득!', '<b>엽전 +120</b>']; }
    else { var c = pick([40, 60, 80]); s.coins += c; prize = ['아쉬워요…', '<b>엽전 +' + c + '</b>']; }
    save2();
    try { g('SFX').buy(); g('vib')(30); } catch (_) {}
    popup(ICON_STAR, prize[0], [prize[1]]);
    openShop2();
  }
  function fortune() {
    var s = S(), today = new Date().toDateString(); if (s.cnFortune === today) return;
    s.cnFortune = today; var c = 10 + Math.floor(Math.random() * 5) * 10; s.coins = (s.coins || 0) + c; save2();
    try { g('SFX').buy(); } catch (_) {}
    popup(ICON_STAR, '오늘의 운세', [h(pick(FORTUNES)), '<b>엽전 +' + c + '</b>']);
    openShop2();
  }
  document.addEventListener('click', function (e) {
    var body = document.getElementById('sheetBody'); if (!body || !body.contains(e.target) || !body.querySelector('.shp-tabs')) return;
    var b = e.target.closest('button'); if (!b) return;
    var s = S();
    try { g('SFX').click(); } catch (_) {}
    if (b.dataset.stab) { shopTab2 = b.dataset.stab; openShop2(); body.scrollTop = 0; return; }
    if (b.dataset.gacha) return gacha();
    if (b.dataset.fortune) return fortune();
    if (b.dataset.tool) {
      var tl = TOOLS.find(function (x) { return x.id === b.dataset.tool; }), it = inv();
      if ((it[tl.id] || 0) >= 9) return openShop2('9개까지만 가질 수 있어요');
      if ((s.coins || 0) < tl.price) return openShop2('엽전이 모자라요');
      s.coins -= tl.price; it[tl.id] = (it[tl.id] || 0) + 1; save2(); try { g('SFX').buy(); } catch (_) {}
      return openShop2(tl.name + '을(를) 샀어요!');
    }
    var kv = (b.dataset.buy || b.dataset.eq || '').split(':'), kind = kv[0], id = kv[1] == null ? '' : kv[1];
    if (!kind) return;
    var list = kind === 'scarf' ? SCARVES : kind === 'trail' ? TRAILS : TITLES;
    var item = list.find(function (x) { return x.id === id; }); if (!item) return;
    var key = kind === 'scarf' ? 'cnScarf' : kind === 'trail' ? 'cnTrail' : 'cnTitle';
    if (b.dataset.buy) {
      if ((s.coins || 0) < item.price) return openShop2('엽전이 모자라요');
      s.coins -= item.price; owned(kind).push(id); s[key] = id; save2();
      try { g('SFX').buy(); g('vib')(25); } catch (_) {}
      return openShop2(item.name + '을(를) 샀어요!');
    }
    s[key] = id; save2(); openShop2();
  });
  // 로비에 상점 버튼 (지갑을 눌러도 열려요)
  var waitShop = setInterval(function () {
    var bar = document.querySelector('#lobby .topbar'), wallet = bar && bar.querySelector('.wallet');
    if (!wallet) return; clearInterval(waitShop);
    var b = document.createElement('button'); b.className = 'icon'; b.id = 'btnShop'; b.title = '상점'; b.innerHTML = ICON_BAG;
    b.addEventListener('click', function () { try { g('SFX').click(); } catch (_) {} openShop2(); });
    wallet.insertAdjacentElement('afterend', b);
    wallet.style.cursor = 'pointer';
    wallet.addEventListener('click', function () { try { g('SFX').click(); } catch (_) {} openShop2(); });
  }, 300);
  function titleOf(save) { var t = TITLES.find(function (x) { return x.id === (save && save.cnTitle); }); return t && t.id ? t.name : ''; }
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
