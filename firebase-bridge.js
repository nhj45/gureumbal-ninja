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
      rdoc.statue = Math.max(0, Math.min(5, Number(body.save.cnStatue) || 0)); rdoc.look = String(body.save.cnChar || 'basic').slice(0, 20);   // 돌동상 (다른 사람에게도 보여요)
      if (user.email !== ADMIN_EMAIL) await F.setDoc(F.doc(db, 'ranks', user.uid), rdoc, { merge: true });
      else {                                            // 관리자는 랭킹에는 안 올라가고, 동상만 다른 사람에게 보여요
        var an = nickNow; if (!an) { try { var ud = await F.getDoc(F.doc(db, 'users', user.uid)); an = (ud.exists() && ud.data().nick) || '관리자'; } catch (_) { an = '관리자'; } }
        await F.setDoc(F.doc(db, 'ranks', user.uid), { updated: now, nick: an, statue: rdoc.statue, look: rdoc.look });
      }
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
      if (ADMIN) { var rmF = { tower: x.F.deleteField(), title: x.F.deleteField() }; for (var si = 0; si < STAGE_COUNT; si++) rmF['t' + si] = x.F.deleteField(); x.F.updateDoc(x.F.doc(x.db, 'ranks', u.uid), rmF).catch(function () {}); x.F.deleteDoc(x.F.doc(x.db, 'presence', u.uid)).catch(function () {}); } }).catch(function () { ADMIN = false; updateAdminBtn(); });
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
        if (v.char && NINJAS.some(function (n) { return n.id === v.char; })) {          // 캐릭터 선물
          var oc = owned('char'); if (oc.indexOf(v.char) < 0) oc.push(v.char);
          var sv0 = g('save'); sv0.cnChar = v.char; save2();
          var nn = NINJAS.find(function (n) { return n.id === v.char; });
          var pvSrc = await new Promise(function (res) { var t0 = Date.now(); (function w() { var pv = charPreview(v.char); if (typeof pv === 'string') return res(pv); if (Date.now() - t0 > 3000) return res(''); setTimeout(w, 150); })(); });
          tellPlayer(ICON_GIFT, '관리자 선물 도착!', [(pvSrc ? '<img src="' + pvSrc + '" style="width:96px;height:96px;object-fit:contain;display:block;margin:0 auto 4px">' : '') + '<b>' + h(nn.name) + '</b>을(를) 받았어요! 지금 바로 함께해요'].concat(v.msg ? [h(v.msg)] : []));
          try { g('SFX').buy(); } catch (_) {}
          continue;
        }
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
            '<button class="adm-b" data-give="ninjo" style="flex:1 1 100%;background:#2b3a6b;color:#fff">닌죠 캐릭터 선물하기</button>' +
          '</div>'
        : '';
      return '<div class="adm-row' + (b ? ' banned' : '') + '" data-uid="' + r.uid + '">' +
        '<div class="adm-top"><div class="adm-name">' + h(r.nick) + '<small>@' + h(r.id) + '</small>' + (b ? '<span class="adm-tag">정지됨</span>' : '') + '</div>' +
        '<button class="adm-b" data-act="coin">코인 주기</button>' +
        '<button class="adm-b" data-give="ninjo" style="background:#2b3a6b;color:#fff">닌죠 주기</button>' +
        (b ? '<button class="adm-b gray" data-act="unban">정지 풀기</button>'
           : '<button class="adm-b red" data-act="ban">' + (admArm === r.uid ? '정말 정지?' : '정지') + '</button>') +
        '</div>' +
        '<div class="adm-info">코인 ' + r.coins + ' · 탑 ' + r.tower + 'm · 마지막 저장 ' + ago(r.updated) + (b && b.reason ? ' · 사유: ' + h(b.reason) : '') + '</div>' +
        more + '</div>';
    }).join('');
    var myC = 0; try { myC = g('save').coins; } catch (_) {}
    body.innerHTML =
      '<div class="adm-row" style="margin-bottom:10px"><div class="adm-top"><div class="adm-name">내 코인 <b id="admMyC">' + myC + '</b></div></div>' +
        '<div class="adm-more"><button class="adm-b" data-self="1000">+1000</button><button class="adm-b" data-self="10000">+10000</button><button class="adm-b" data-self="100000">+100000</button>' +
        '<input class="adm-in" id="admSelf" type="number" inputmode="numeric" placeholder="직접 입력" style="flex:1 1 90px"><button class="adm-b blue" data-self="custom">넣기</button></div></div>' +
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
      if (t.dataset.self) {
        var sn = t.dataset.self === 'custom' ? Math.floor(Number(document.getElementById('admSelf').value)) : Number(t.dataset.self);
        if (!(sn > 0 && sn <= 10000000)) { renderAdmin('1 ~ 10000000 사이로 적어주세요'); return; }
        var sv0 = g('save'); sv0.coins += sn;
        try { g('persist')(); } catch (_) {} try { g('refreshLobby')(); } catch (_) {} try { g('SFX').buy(); } catch (_) {}
        renderAdmin('내 코인에 ' + sn + '개를 넣었어요');
        return;
      }
      if (!r) return;
      var act = t.dataset.act, give = t.dataset.give;
      if (act === 'coin') { admOpen = admOpen === uid ? null : uid; admArm = null; renderAdmin(); return; }
      if (give) {
        var mtx = (document.getElementById('admMsg') || {}).value || ''; mtx = mtx.trim().slice(0, 80);
        if (give === 'ninjo') {
          await F.addDoc(F.collection(db, 'users', uid, 'gifts'), { coins: 0, char: 'ninjo', msg: mtx, at: Date.now(), by: x.auth.currentUser.uid });
          admOpen = null; renderAdmin(r.nick + '에게 닌죠를 선물했어요');
          return;
        }
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

  // ───────── 엽전 상점: 캐릭터 · 허리띠 색 · 칼 빛 · 부적 · 칭호 · 뽑기 · 오늘의 운세 ─────────
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
    '.shp-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}',
    '.shp-tabs button{min-width:0;white-space:nowrap;font:inherit;font-size:14px;padding:8px 4px;border:3px solid #141418;border-radius:12px;background:#f3ead8;color:#2b2b3a}',
    '.shp-pv{width:54px;height:54px;object-fit:contain;flex:none;background:#fffaf0;border:3px solid #141418;border-radius:12px}',
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
  function owned(kind) { var s = S(); s.cnOwn = s.cnOwn || {}; s.cnOwn[kind] = s.cnOwn[kind] || ['basic', '']; if (kind === 'char' && ADMIN && s.cnOwn.char.indexOf('ninjo') < 0) s.cnOwn.char.push('ninjo'); return s.cnOwn[kind]; }
  function save2() { try { g('persist')(); g('refreshLobby')(); } catch (_) {} }
  var swatch = function (c) { return c === 'rainbow' ? 'conic-gradient(#ff4a4a,#ffd84a,#4fd27a,#4aa8ff,#b48cff,#ff4a4a)' : 'rgb(' + c.join(',') + ')'; };

  // 닌자 모습: 캐릭터(몸 · 머리띠 · 허리띠 색 + 이마 문양)와 허리띠 색을 그림에 직접 칠해요
  var NINJAS = [
    { id: 'basic', name: '검은 닌자', price: 0, d: '처음부터 함께한 하찮은 닌자' },
    { id: 'snow', name: '눈송이 닌자', price: 300, body: [226, 232, 244], band: [120, 190, 255], belt: [60, 120, 230], em: 'snow', d: '눈처럼 하얀 수련복' },
    { id: 'fire', name: '불꽃 닌자', price: 300, body: [196, 48, 52], band: [255, 160, 60], belt: [255, 214, 70], em: 'flame', d: '성격이 급해서 늘 먼저 뛰어요' },
    { id: 'wave', name: '파도 닌자', price: 400, body: [44, 96, 186], band: [110, 220, 240], belt: [240, 248, 255], em: 'drop', d: '물 위도 걸을 수 있다고 우겨요' },
    { id: 'bamboo', name: '대나무 닌자', price: 400, body: [46, 138, 74], band: [170, 230, 90], belt: [140, 90, 50], em: 'leaf', d: '대나무 숲에서 자란 닌자' },
    { id: 'bolt', name: '번개 닌자', price: 600, body: [232, 176, 32], band: [60, 60, 70], belt: [140, 80, 220], em: 'bolt', d: '대시가 제일 빠를 것 같은 느낌' },
    { id: 'sakura', name: '벚꽃 닌자', price: 600, body: [232, 122, 168], band: [255, 246, 250], belt: [220, 50, 80], em: 'flower', d: '지나간 자리에 꽃잎이 날려요(기분상)' },
    { id: 'shadow', name: '그림자 닌자', price: 900, body: [80, 52, 132], band: [190, 150, 255], belt: [255, 205, 50], em: 'moon', d: '밤에만 진지해지는 닌자' },
    { id: 'gold', name: '황금 닌자', price: 1500, body: [212, 160, 46], band: [255, 243, 176], belt: [200, 40, 50], em: 'crown', d: '엽전을 너무 많이 모아서 금이 됐어요' },
    { id: 'ninjo', name: '닌죠', price: 0, admin: true, body: [38, 50, 92], band: [246, 246, 250], belt: [176, 28, 40], em: 'swords', d: '칼 세 자루를 쓰는 검술 닌자 · 세 칼 베기 · 베기 대시 · 기합 소리' }
  ];
  var sprOrig = null, sprCache = {};
  function hslRgb(hh) { var f = function (n) { var k = (n + hh / 30) % 12; return 255 * (0.6 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0), f(8), f(4)].map(Math.round); }
  function drawEmblem(x, kind, cx, cy, r) {
    x.save(); x.translate(cx, cy); x.lineJoin = 'round'; x.lineCap = 'round'; x.lineWidth = Math.max(2, r * 0.22); x.strokeStyle = '#141418';
    var P2 = function (pts, fill) { x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(p[0] * r, p[1] * r) : x.moveTo(p[0] * r, p[1] * r); }); x.closePath(); x.fillStyle = fill; x.fill(); x.stroke(); };
    if (kind === 'snow') { x.strokeStyle = '#ffffff'; x.lineWidth = r * 0.28; for (var a = 0; a < 3; a++) { x.rotate(Math.PI / 3); x.beginPath(); x.moveTo(-r, 0); x.lineTo(r, 0); x.stroke(); } x.strokeStyle = '#141418'; x.lineWidth = r * 0.1; for (var a2 = 0; a2 < 3; a2++) { x.rotate(Math.PI / 3); x.beginPath(); x.moveTo(-r, 0); x.lineTo(r, 0); x.stroke(); } }
    else if (kind === 'flame') P2([[0, -1.25], [0.55, -0.35], [0.75, 0.35], [0, 1], [-0.75, 0.35], [-0.5, -0.4], [-0.15, -0.05]], '#ffcf3a');
    else if (kind === 'drop') P2([[0, -1.2], [0.7, 0.2], [0.55, 0.75], [0, 1], [-0.55, 0.75], [-0.7, 0.2]], '#5fd3ff');
    else if (kind === 'leaf') { P2([[0, -1.1], [0.75, -0.2], [0.45, 0.7], [0, 1], [-0.45, 0.7], [-0.75, -0.2]], '#5cc451'); x.beginPath(); x.moveTo(0, -0.8 * r); x.lineTo(0, 0.9 * r); x.lineWidth = r * 0.12; x.stroke(); }
    else if (kind === 'bolt') P2([[0.25, -1.2], [-0.6, 0.15], [-0.05, 0.15], [-0.3, 1.2], [0.65, -0.2], [0.1, -0.2]], '#ffe14a');
    else if (kind === 'flower') { for (var k2 = 0; k2 < 5; k2++) { var an = k2 * 2 * Math.PI / 5; x.beginPath(); x.arc(Math.cos(an) * r * 0.55, Math.sin(an) * r * 0.55, r * 0.5, 0, 7); x.fillStyle = '#ffb6d5'; x.fill(); x.stroke(); } x.beginPath(); x.arc(0, 0, r * 0.35, 0, 7); x.fillStyle = '#ffd84a'; x.fill(); x.stroke(); }
    else if (kind === 'moon') { x.beginPath(); x.arc(0, 0, r, 0, 7); x.fillStyle = '#ffe680'; x.fill(); x.stroke(); x.beginPath(); x.arc(r * 0.45, -r * 0.25, r * 0.85, 0, 7); x.fillStyle = 'rgb(190,150,255)'; x.fill(); }
    else if (kind === 'swords') {
      [-0.6, 0, 0.6].forEach(function (an) { x.save(); x.rotate(an); x.beginPath(); x.moveTo(0, -1.35 * r); x.lineTo(0.16 * r, -1.1 * r); x.lineTo(0.16 * r, 0.55 * r); x.lineTo(-0.16 * r, 0.55 * r); x.lineTo(-0.16 * r, -1.1 * r); x.closePath(); x.fillStyle = '#eef3f8'; x.fill(); x.lineWidth = r * 0.1; x.stroke(); x.fillStyle = '#ffd84a'; x.fillRect(-0.42 * r, 0.5 * r, 0.84 * r, 0.2 * r); x.strokeRect(-0.42 * r, 0.5 * r, 0.84 * r, 0.2 * r); x.fillStyle = '#7a2a2a'; x.fillRect(-0.13 * r, 0.7 * r, 0.26 * r, 0.55 * r); x.restore(); });
    }
    else if (kind === 'crown') { x.translate(0, -r * 2.2); P2([[-1.3, 0.7], [-1.3, -0.5], [-0.65, 0.05], [0, -0.85], [0.65, 0.05], [1.3, -0.5], [1.3, 0.7]], '#ffd84a'); x.beginPath(); x.arc(0, 0.25 * r, r * 0.22, 0, 7); x.fillStyle = '#e8333a'; x.fill(); }
    x.restore();
  }
  function tintImg(img, L) {
    return new Promise(function (res) {
      try {
        var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width;
        var bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, rowN = {};
        for (var i = 0; i < p.length; i += 4) {
          if (p[i + 3] === 0) continue;
          var r = p[i], gg = p[i + 1], b = p[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), lum = (r + gg + b) / 3;
          if (r > 60 && r - gg > 45 && r - b > 45) {                       // 빨간 허리띠
            if (L.belt) { var k = Math.min(1.15, r / 230), m = Math.min(1, (r - Math.max(gg, b)) / 150);
              p[i] = Math.round(r * (1 - m) + L.belt[0] * k * m); p[i + 1] = Math.round(gg * (1 - m) + L.belt[1] * k * m); p[i + 2] = Math.round(b * (1 - m) + L.belt[2] * k * m); }
          } else if (p[i + 3] > 200 && mx - mn < 24 && lum >= 120 && lum <= 200) {   // 회색 머리띠 (반투명 테두리는 빼고)
            var py = (i / 4) / W | 0, px = (i / 4) % W;
            if (py < c.height * 0.55) { rowN[py] = (rowN[py] || 0) + 1; if (rowN[py] === 25 && py < by0) by0 = py; if (px < bx0 && py > 30) bx0 = px; if (px > bx1) bx1 = px; if (py > by1) by1 = py; }
            if (L.band) { var kb = lum / 160; p[i] = Math.min(255, L.band[0] * kb); p[i + 1] = Math.min(255, L.band[1] * kb); p[i + 2] = Math.min(255, L.band[2] * kb); }
          } else if (L.body && p[i + 3] > 150 && mx - mn < 24 && lum > 24 && lum < 100) {   // 짙은 회색 몸 (검은 테두리는 그대로)
            var t = Math.min(1, (lum - 24) / 14), kk = lum / 46;
            p[i] = Math.round(r * (1 - t) + Math.min(255, L.body[0] * kk) * t); p[i + 1] = Math.round(gg * (1 - t) + Math.min(255, L.body[1] * kk) * t); p[i + 2] = Math.round(b * (1 - t) + Math.min(255, L.body[2] * kk) * t);
          }
        }
        x.putImageData(d, 0, 0);
        if (L.em && bx1 > 0 && by0 < 1e9) {                                              // 이마 문양 (머리띠 앞쪽 = 그림의 왼쪽)
          var ex = bx0 + (bx1 - bx0) * 0.3, ey = by0 + 17;
          drawEmblem(x, L.em, ex, ey, 19);
        }
        var out = new Image(); out.onload = function () { res(out); }; out.onerror = function () { res(img); }; out.src = c.toDataURL();
      } catch (_) { res(img); }
    });
  }
  function getSet(key, L) {
    if (sprCache[key]) return sprCache[key];
    sprCache[key] = Promise.all(sprOrig.run.map(function (im) { return tintImg(im, L); }));
    return sprCache[key];
  }
  function lookOf(charId, beltId, rbIdx) {
    var ch = NINJAS.find(function (x) { return x.id === charId; }) || NINJAS[0];
    var bl = SCARVES.find(function (x) { return x.id === beltId; }) || SCARVES[0];
    var belt = bl.id === 'rainbow' ? hslRgb(rbIdx * 30) : bl.id !== 'basic' ? bl.a : (ch.belt || null);
    return { body: ch.body || null, band: ch.band || null, belt: belt, em: ch.em || null };
  }
  var curLookKey = 'basic|basic', rainbowIdx = 0, beltBusy = false;
  setInterval(function () {
    var SP = g('SPR'); if (!SP || !SP.run || !SP.run.every(function (im) { return im.complete && im.naturalWidth > 0; })) return;
    if (!sprOrig) sprOrig = { run: SP.run.slice() };
    if (beltBusy) return;
    var s = S(), cid = s.cnChar || 'basic', bid = s.cnScarf || 'basic', rb = bid === 'rainbow';
    var key = cid + '|' + bid + (rb ? '|' + rainbowIdx : '');
    if (key === curLookKey) return;
    if (cid === 'basic' && bid === 'basic') { SP.run = sprOrig.run.slice(); curLookKey = key; return; }
    beltBusy = true;
    getSet(key, lookOf(cid, bid, rainbowIdx)).then(function (set) { SP.run = set; curLookKey = key; if (rb) rainbowIdx = (rainbowIdx + 1) % 12; beltBusy = false; });
  }, 120);
  var prevCache = {};
  function charPreview(id) {                     // 상점에서 보여줄 작은 그림
    if (prevCache[id]) return prevCache[id];
    if (!sprOrig) return null;
    prevCache[id] = tintImg(sprOrig.run[0], lookOf(id, 'basic', 0)).then(function (im) { prevCache[id] = im.src; document.querySelectorAll('img[data-prev="' + id + '"]').forEach(function (el) { el.src = im.src; }); return im.src; });
    return null;
  }

  window.__charSrc = function (id) {           // 다른 사람 돌동상에 쓸 캐릭터 그림
    if (!sprOrig) return Promise.resolve(null);
    if (!id || id === 'basic' || !NINJAS.some(function (x) { return x.id === id; })) return Promise.resolve(sprOrig.run[0].src);
    var v = charPreview(id); if (typeof v === 'string') return Promise.resolve(v);
    return Promise.resolve(prevCache[id]).then(function (x) { return typeof x === 'string' ? x : sprOrig.run[0].src; });
  };
  window.__fetchStatues = function () {
    return fb().then(function (x) {
      var F = x.F, me = x.auth.currentUser && x.auth.currentUser.uid;
      return F.getDocs(F.query(F.collection(x.db, 'ranks'), F.where('statue', '>', 0), F.limit(30))).then(function (snap) {
        return snap.docs.map(function (d) { var v = d.data(); return { uid: d.id, nick: v.nick || '닌자', look: v.look || 'basic', statue: Number(v.statue) || 0, me: d.id === me }; })
          .filter(function (o) { return o.statue > 0 && !o.me; });
      });
    });
  };

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
  var shopTab2 = 'char';
  function priceBtn(item, kind, eq, own) {
    if (eq) return '<button class="shp-b on" disabled>쓰는 중</button>';
    if (own) return '<button class="shp-b own" data-eq="' + kind + ':' + item.id + '">쓰기</button>';
    if (item.admin) return '<button class="shp-b no" disabled style="font-size:12px">관리자 선물</button>';
    var no = (S().coins || 0) < item.price ? ' no' : '';
    return '<button class="shp-b' + no + '" data-buy="' + kind + ':' + item.id + '"><i class="coin sm"></i>' + item.price + '</button>';
  }
  function openShop2(msg) {
    var s = S(), body = '';
    var tabs = [['char', '캐릭터'], ['scarf', '허리띠'], ['trail', '칼 빛'], ['tool', '부적'], ['title', '칭호'], ['statue', '동상'], ['luck', '뽑기']];
    body += '<div class="shp-tabs">' + tabs.map(function (t) { return '<button data-stab="' + t[0] + '" class="' + (shopTab2 === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (msg) body += '<div class="note" style="margin:0 0 10px;color:#2f7fd6">' + msg + '</div>';
    if (shopTab2 === 'char') {
      var oC = owned('char'), curC = s.cnChar || 'basic';
      body += '<div class="shp-list">' + NINJAS.map(function (x) {
        var own = oC.indexOf(x.id) >= 0, pv = x.id === 'basic' ? (sprOrig ? sprOrig.run[0].src : '') : charPreview(x.id);
        return '<div class="shp-it' + (curC === x.id ? ' eq' : '') + '"><img class="shp-pv" data-prev="' + x.id + '" src="' + (typeof pv === 'string' ? pv : '') + '" alt=""><div class="shp-tx"><b>' + x.name + '</b><small>' + x.d + '</small></div>' + priceBtn(x, 'char', curC === x.id, own) + '</div>';
      }).join('') + '</div><div class="shp-note">캐릭터는 모습만 바뀌어요. 허리띠 색을 따로 사면 그 색이 먼저 보여요.</div>';
    } else if (shopTab2 === 'scarf') {
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
    } else if (shopTab2 === 'statue') {
      var lv = Number(s.cnStatue) || 0, TIERS = window.__STATUE_TIERS || [];
      body += '<div class="shp-note" style="margin-bottom:8px">로비와 광전사 사냥터에 내 캐릭터 동상이 세워지고, 위에 내 닉네임이 새겨져요. 다른 사람들 화면에도 보여요. 돌부터 차례대로 올릴 수 있어요.</div><div class="shp-list">' +
        TIERS.map(function (t, i) {
          var n = i + 1, pv = ''; try { pv = window.__statueImg ? window.__statueImg(true, n).toDataURL() : ''; } catch (_) {}
          var btn = lv >= n ? (lv === n ? '<button class="shp-b own" disabled>지금 동상</button>' : '<button class="shp-b own" disabled>지나감</button>')
            : lv === n - 1 ? '<button class="shp-b' + ((s.coins || 0) < t.price ? ' no' : '') + '" data-statue="' + n + '"><i class="coin sm"></i>' + t.price + '</button>'
            : '<button class="shp-b no" disabled>' + TIERS[n - 2].name + ' 먼저</button>';
          return '<div class="shp-it' + (lv === n ? ' eq' : '') + '">' + (pv ? '<img class="shp-pv" src="' + pv + '" alt="" style="object-fit:contain">' : '') + '<div class="shp-tx"><b>' + t.name + ' 동상</b><small>' + t.d + '</small></div>' + btn + '</div>';
        }).join('') + '</div>';
    } else {
      var today = new Date().toDateString(), done = s.cnFortune === today;
      body += '<div class="shp-it shp-big" style="display:block"><b style="font-size:18px">행운 뽑기</b><small style="display:block;color:#7a705c">엽전 100개로 한 번! 엽전 대박 · 부적 · 아직 없는 허리띠 색이나 칼 빛이 나와요</small><button class="shp-b' + ((s.coins || 0) < 100 ? ' no' : '') + '" data-gacha="1"><i class="coin sm"></i>100 뽑기</button></div>';
      body += '<div class="shp-it shp-big" style="display:block;margin-top:8px"><b style="font-size:18px">오늘의 운세</b><small style="display:block;color:#7a705c">하루에 한 번 무료! 운세와 작은 엽전 선물</small><button class="shp-b' + (done ? ' no' : ' own') + '" data-fortune="1">' + (done ? '내일 또 와요' : '무료로 보기') + '</button></div>';
    }
    body += '<div class="shp-note">엽전은 스테이지 · 무한의 탑 · 미션 · 업적 · 광전사 사냥터로 모아요.</div>';
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
    if (b.dataset.statue) {
      var want = Number(b.dataset.statue), T = (window.__STATUE_TIERS || [])[want - 1], have = Number(s.cnStatue) || 0;
      if (!T || want !== have + 1) return;
      if ((s.coins || 0) < T.price) return openShop2('엽전이 모자라요 (' + T.price + '개 필요)');
      s.coins -= T.price; s.cnStatue = want; save2();
      try { g('SFX').clear(); } catch (_) {}
      popup(ICON_STAR, T.name + ' 동상이 세워졌어요!', ['로비에 가서 내 동상을 확인해 보세요']);
      return openShop2();
    }
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
    var list = kind === 'char' ? NINJAS : kind === 'scarf' ? SCARVES : kind === 'trail' ? TRAILS : TITLES;
    var item = list.find(function (x) { return x.id === id; }); if (!item) return;
    var key = kind === 'char' ? 'cnChar' : kind === 'scarf' ? 'cnScarf' : kind === 'trail' ? 'cnTrail' : 'cnTitle';
    if (b.dataset.buy) {
      if (item.admin) return openShop2('관리자 선물로만 받을 수 있어요');
      if ((s.coins || 0) < item.price) return openShop2('엽전이 모자라요');
      s.coins -= item.price; owned(kind).push(id); s[key] = id; save2();
      try { g('SFX').buy(); g('vib')(25); } catch (_) {}
      return openShop2(item.name + (kind === 'char' ? '와 함께해요!' : '을(를) 샀어요!'));
    }
    if (b.dataset.eq && owned(kind).indexOf(id) < 0) return;
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
  // ───────── 관리자 전용 캐릭터: 닌죠 (칼 세 자루 검술 닌자) ─────────
  // 상점에서는 못 사고, 관리자 선물로만 받아요. 세 칼 베기 · 베기 대시 · 기합 소리
  function isNinjo() { return (S().cnChar || '') === 'ninjo' && owned('char').indexOf('ninjo') >= 0; }
  var lastVoice = 0;
  // 굵고 거친 남자 기합 목소리: 기기 읽어주기를 최대한 낮게 + 낮은 으르렁 소리를 겹쳐요
  function shout(text, force) {
    var s = S(); if (s.sfx === false) return;
    var now = Date.now(); if (!force && now - lastVoice < 650) return;
    lastVoice = now;
    try { g('tone')(88, 0.32, 'sawtooth', 0.05, -28); g('noise')(0.22, 0.07, 520); } catch (_) {}
    return; // voice removed
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 0.88 + Math.random() * 0.12; u.pitch = 0.35 + Math.random() * 0.25; u.volume = 1;
      var vs = speechSynthesis.getVoices().filter(function (v) { return /ko/i.test(v.lang); });
      if (vs.length) u.voice = vs.find(function (v) { return /injoon|hyunsu|minsu|male|남/i.test(v.name) && !/female|여/i.test(v.name); }) || vs[0];
      speechSynthesis.speak(u);
    } catch (_) {}
  }
  var LINES = { s1: ['흡!', '하앗!', '어? 맞았네?', '훗, 역시 나야'], s2: ['어림없다! ...아마도!', '느려! 나도 좀 느리지만!', '멋있었지? 그치?'], s3: ['세 칼 베기! ...세 개 맞지?', '칼 세 자루! 근데 입이 아프다!', '완벽했다! 눈 감고 있었지만!'], dash: ['베어주마! ...누구였더라?', '비켜라! 아니 내가 비킬게!', '간다! 어디로 가는 거지?'] };
  var pickL = function (k) { var a = LINES[k]; return a[Math.floor(Math.random() * a.length)]; };
  if (window.speechSynthesis) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (_) {} }
  var hookNinjo = setInterval(function () {
    var SF = g('SFX'); if (!SF || !SF.slash || !SF.dash || SF.__ninjo) return;
    clearInterval(hookNinjo); SF.__ninjo = true;
    var oSlash = SF.slash, oDash = SF.dash;
    SF.slash = function (k) {
      var r = oSlash.apply(this, arguments);
      if (!isNinjo()) return r;
      if (k === 3) {
        shout(pickL('s3'), true);
        evalg('(function () { var p = P; if (!p) return; var cx = p.x + p.w / 2, cy = p.y + p.h / 2 - 4;' +
          'ring(cx, cy, "rgba(255,255,255,.95)", 78, 0.32); ring(cx, cy, "rgba(255,216,74,.85)", 58, 0.26);' +
          'for (var a = 0; a < 3; a++) { var an = a * 2.094 + time * 3; particles.push({ k: "cut", x: cx + Math.cos(an) * 30, y: cy + Math.sin(an) * 18, vx: 0, vy: 0, life: 0.2, max: 0.2, ang: an + 1.57, size: 34 }); }' +
          'for (var i = 0; i < 16; i++) { var b = i / 16 * TAU; particles.push({ k: "streak", x: cx, y: cy, vx: Math.cos(b) * 320, vy: Math.sin(b) * 220, life: 0.24, max: 0.24, size: 1.8, col: i % 2 ? "#ffffff" : "#ffe27a" }); }' +
          'for (var e of enemies) if (!e.dead && Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy) < 86) { e.dead = 0.001; tut.kills++; onKill(p, e.x + e.w / 2, e.y, e, "slash"); slashImpact(e, p, true); floatText(e.x + e.w / 2, e.y - 8, "세 칼 베기!", "#ffe14a", 16); }' +
          'if (boss && boss.active && !boss.dead && boss.lastSlash !== p.slashId && Math.hypot(boss.x + boss.w / 2 - cx, boss.y + boss.h / 2 - cy) < 110) { boss.lastSlash = p.slashId; bossHit(2, p); }' +
          'kick(8, 0.06, 0.08); })()');
      } else shout(pickL(k === 2 ? 's2' : 's1'));
      return r;
    };
    SF.dash = function () {
      var r = oDash.apply(this, arguments);
      if (isNinjo()) shout(pickL('dash'), true);
      return r;
    };
  }, 300);
  // 칼 세 자루: 평소엔 등에 칼 두 자루를 메고, 벨 때는 세 자루가 함께 휘둘러져요
  var hookDraw = setInterval(function () {
    var orig = g('drawSpriteNinja'); if (typeof orig !== 'function') return;
    clearInterval(hookDraw);
    window.drawSpriteNinja = function (gc, sk, o) {
      var SK = g('SKINS'), SP = g('SPR');
      var mine = isNinjo() && SK && sk === SK[0] && SP && SP.katana && SP.katana.complete && SP.katana.naturalWidth > 0 && SP.run[0].naturalWidth > 0;
      if (!mine) return orig.apply(this, arguments);
      var s = o.s || 1, k = (g('SPR_H') * s) / 320, h = SP.run[0].naturalHeight * k, ww = SP.run[0].naturalWidth * k;
      var kw = 34 * s, kh = kw * SP.katana.naturalHeight / SP.katana.naturalWidth;
      var base = function () { gc.save(); gc.translate(o.x, o.y); if (o.alpha != null) gc.globalAlpha = o.alpha; if (o.rot) { gc.translate(0, -h * 0.4); gc.rotate(o.rot); gc.translate(0, h * 0.4); } gc.rotate((o.lean || 0) * (o.face || 1)); gc.scale((o.sx || 1) * -(o.face || 1), o.sy || 1); gc.scale(-1, 1); };
      var slashing = o.slash != null && !((o.throwT || 0) > 0);
      if (!slashing) {                                      // 등에 멘 두 자루 (몸 뒤에 먼저 그려요)
        base();
        [[-1.95, 0.5, -0.2], [-2.3, 0.46, -0.27]].forEach(function (q) { gc.save(); gc.translate(ww * q[2], -h * q[1]); gc.rotate(q[0]); gc.drawImage(SP.katana, -kw * 0.45, -kh / 2, kw * 1.2, kh * 1.2); gc.restore(); });
        gc.restore();
      }
      var r = orig.apply(this, arguments);
      if (slashing) {                                       // 벨 때: 원래 칼 + 두 자루 더
        var sa = g('slashAngle'), kind = o.slashKind || 1, a0 = sa(o.slash, kind), kw2 = (kind === 3 ? 44 : 36) * s, kh2 = kw2 * SP.katana.naturalHeight / SP.katana.naturalWidth;
        base();
        [-0.5, 0.45].forEach(function (off) { gc.save(); gc.translate(ww * 0.3, -h * 0.4 + off * 8 * s); gc.rotate(a0 + off); gc.scale(-1, 1); gc.drawImage(SP.katana, -kw2 * 0.74, -kh2 / 2, kw2, kh2); gc.restore(); });
        gc.restore();
      }
      return r;
    };
  }, 300);
  // 베기 대시: 대시하는 동안 앞쪽으로 넓게 칼바람이 나가요
  (function dashLoop() {
    requestAnimationFrame(dashLoop);
    if (g('mode') !== 'play' || !isNinjo()) return;
    evalg('(function () { var p = P; if (!p || p.dead || !(p.dashT > 0)) return;' +
      'var hb = { x: p.dashDir > 0 ? p.x : p.x - 44, y: p.y - 16, w: p.w + 44, h: p.h + 28 };' +
      'if (Math.random() < 0.7) particles.push({ k: "streak", x: p.x + p.w / 2 - p.dashDir * 10, y: p.y + 6 + Math.random() * (p.h - 8), vx: -p.dashDir * (180 + Math.random() * 120), vy: (Math.random() - 0.5) * 40, life: 0.2, max: 0.2, size: 1.6, col: "#dff6ff" });' +
      'for (var e of enemies) if (!e.dead && overlap(hb, e)) { e.dead = 0.001; tut.kills++; onKill(p, e.x + e.w / 2, e.y, e, "dash"); p.slashKind = 1; slashImpact(e, p, false); floatText(e.x + e.w / 2, e.y - 8, "칼바람!", "#c7f0ff", 15); SFX.hit(); kick(4, 0.03, 0.06); }' +
      '})()');
  })();

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

// ── PC: 모바일 버튼 숨기고 키보드 안내 ──
(function () {
  function init() {
    var st = document.createElement('style');
    st.textContent = 'body.pcMode #ctrl{display:none!important}' +
      '#pcKeys{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:3;pointer-events:none;white-space:nowrap;' +
      'font:12px/1.4 sans-serif;color:#fff;background:rgba(5,8,18,.55);padding:5px 12px;border-radius:12px;opacity:.85}' +
      '#pcKeys b{color:#ffe27a;font-weight:bold}';
    document.head.appendChild(st);
    var pc = false;
    try { pc = matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (_) {}
    if (!pc) return;
    document.body.classList.add('pcMode');
    var wrap = document.getElementById('wrap') || document.body;
    var hint = document.createElement('div'); hint.id = 'pcKeys';
    hint.innerHTML = '<b>←→</b>/<b>AD</b> 이동 · <b>Space</b> 점프 · <b>Shift</b>/<b>X</b> 대시 · <b>C</b> 베기 · <b>P</b> 일시정지';
    hint.style.display = 'none'; wrap.appendChild(hint);
    var ctrl = document.getElementById('ctrl');
    setInterval(function () {
      var playing = ctrl && !ctrl.classList.contains('hide') && document.body.classList.contains('pcMode');
      hint.style.display = playing ? '' : 'none';
    }, 300);
    // 터치하면 다시 모바일 버튼 보이기 (터치 노트북 등)
    addEventListener('touchstart', function () { document.body.classList.remove('pcMode'); hint.style.display = 'none'; }, { passive: true, once: true });
  }
  var waitPc = setInterval(function () { if (document.body && document.getElementById('ctrl')) { clearInterval(waitPc); init(); } }, 200);
})();

// ── 배경음악 끊김 없이 반복 (앞뒤 무음 잘라내고 Web Audio로 반복) ──
(function () {
  var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  var ctx = null, buf = null, src = null, gain = null, el = null, loading = false, a0 = 0, a1 = 0;
  function findEdges(b) {
    var th = 0.004, n = b.length, ch = [], c;
    for (c = 0; c < b.numberOfChannels; c++) ch.push(b.getChannelData(c));
    var loud = function (i) { for (var k = 0; k < ch.length; k++) if (Math.abs(ch[k][i]) > th) return true; return false; };
    var s = 0; while (s < n && !loud(s)) s++;
    var e = n - 1; while (e > s && !loud(e)) e--;
    a0 = s / b.sampleRate; a1 = (e + 1) / b.sampleRate;
  }
  function load() {
    if (loading || !el) return; loading = true;
    fetch(el.currentSrc || el.src).then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return new Promise(function (ok, no) { ctx.decodeAudioData(ab, ok, no); }); })
      .then(function (b) { buf = b; findEdges(b); })
      .catch(function () { loading = 'fail'; });
  }
  function start() {
    if (src || !buf) return;
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = a0; src.loopEnd = a1;
    src.connect(gain);
    var off = Math.min(Math.max(a0, (el.currentTime || 0)), a1 - 0.05);
    src.start(0, off);
    el.muted = true;
  }
  function stop() { if (src) { try { src.stop(); } catch (_) {} src.disconnect(); src = null; } }
  function unlock() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {}); }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { addEventListener(ev, unlock, { capture: true, passive: true }); });
  setInterval(function () {
    if (!el) { try { el = (0, eval)('bgm'); } catch (_) {} if (!el) return; }
    if (!ctx) { try { ctx = new AC(); gain = ctx.createGain(); gain.connect(ctx.destination); } catch (_) { return; } }
    if (loading === 'fail') { el.muted = false; return; }
    if (!buf) { load(); return; }
    gain.gain.value = el.volume;
    var on = !el.paused && !document.hidden;
    if (on) { unlock(); if (ctx.state === 'running') start(); else el.muted = false; }
    else stop();
  }, 250);
})();

// ── 재미 추가: 연속 처치 콤보 · 닌자 폭주 · 황금 적 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var combo = 0, lastK = 0, fever = 0, feverCST = null, feverBase = 0;
  function startFever() {
    var C = E('CST'); if (!C || fever > 0) return;
    feverCST = C; feverBase = C.run; C.run = feverBase * 1.35; fever = 6;
    try { E('showToast')('닌자 폭주! 6초 동안 더 빨라져요', '#ffd84a'); E('kick')(8, 0.08, 0.1); E('SFX').mission(); } catch (_) {}
  }
  function endFever() { if (feverCST) feverCST.run = feverBase; feverCST = null; fever = 0; }
  var hook = setInterval(function () {
    var ok; try { ok = typeof E('onKill') === 'function' && typeof E('drawEnemy') === 'function'; } catch (_) { ok = false; }
    if (!ok) return; clearInterval(hook);
    var oKill = E('onKill'), oDraw = E('drawEnemy');
    var oModal = E('openModal');
    window.openModal = function (html) { if (typeof html === 'string') html = html.replace('공중 콤보 보너스', '콤보 · 황금 적 보너스'); return oModal.call(this, html); };
    window.onKill = function (p, x, y, e, how) {
      var r = oKill.apply(this, arguments);
      try {
        var now = performance.now(); combo = now - lastK < 2500 ? combo + 1 : 1; lastK = now;
        if (e && e.gold && !e.goldPaid) {
          e.goldPaid = true; E('bonusCoins += 10');
          E('floatText')(x, y - 44, '황금 적! +10', '#ffd84a', 18); E('sparks')(x, y, 26, '#ffd84a', 220);
          E('kick')(6, 0.05, 0.06); try { E('SFX').coin(10); } catch (_) {}
        }
        if (combo >= 3) {
          var b = Math.min(combo - 2, 10); E('bonusCoins += ' + b);
          E('floatText')(x, y - 62, combo + '연속 처치! +' + b, '#7df9ff', 14 + Math.min(combo, 8));
          E('tone')(440 + combo * 90, 0.14, 'triangle', 0.06, 260);
        }
        if (combo === 5) startFever();
      } catch (_) {}
      return r;
    };
    window.drawEnemy = function (e) {
      if (e && e.gold && !e.dead) {
        try {
          var c = E('ctx'), t = E('time'), cx = e.x + e.w / 2, cy = e.y + e.h / 2, rr = Math.max(e.w, e.h) * 0.95;
          c.save();
          var gr = c.createRadialGradient(cx, cy, 2, cx, cy, rr);
          gr.addColorStop(0, 'rgba(255,224,90,' + (0.55 + Math.sin(t * 6) * 0.15) + ')'); gr.addColorStop(1, 'rgba(255,200,40,0)');
          c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, rr, 0, 6.283); c.fill(); c.restore();
        } catch (_) {}
      }
      var r = oDraw.apply(this, arguments);
      if (e && e.gold && !e.dead) {
        try {
          var c2 = E('ctx'), t2 = E('time');
          c2.save(); c2.fillStyle = '#fff6b0';
          for (var i = 0; i < 3; i++) { var a = t2 * 3 + i * 2.094; c2.globalAlpha = 0.6 + 0.4 * Math.sin(t2 * 8 + i); c2.fillRect(e.x + e.w / 2 + Math.cos(a) * e.w * 0.7 - 1.5, e.y + e.h / 2 + Math.sin(a) * e.h * 0.6 - 1.5, 3, 3); }
          c2.restore();
        } catch (_) {}
      }
      return r;
    };
    var prev = performance.now();
    (function loop(now) {
      var dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      try {
        var en = E('enemies'); if (en) for (var k = 0; k < en.length; k++) { var q = en[k]; if (!q.goldChk) { q.goldChk = 1; if (!q.dead && Math.random() < 0.15) q.gold = true; } }
        var m = E('mode'), C = E('CST');
        if (fever > 0) {
          if (C !== feverCST || (m !== 'play' && m !== 'paused')) endFever();
          else if (m === 'play') {
            fever -= dt; var P = E('P');
            if (P && Math.random() < dt * 30) E('particles').push({ k: 'spark', x: P.x + Math.random() * P.w, y: P.y + Math.random() * P.h, vx: 0, vy: -30, life: 0.4, max: 0.4, size: 3, col: '#ffd84a' });
            if (fever <= 0) { endFever(); try { E('floatText')(P.x + P.w / 2, P.y - 10, '폭주 끝', '#ffffff', 12); } catch (_) {} }
          }
        }
        if (m !== 'play' && m !== 'paused') combo = 0;
      } catch (_) {}
      requestAnimationFrame(loop);
    })(prev);
  }, 300);
})();

// ── 돌동상 (상점에서 50000엽전) ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var TIERS = window.__STATUE_TIERS = [
    { name: '돌', price: 1000, d: '단단한 회색 돌로 만든 동상', base: [150, 146, 138], hi: [210, 206, 198], ped: ['#b9b4aa', '#7d776d'] },
    { name: '금', price: 2000, d: '번쩍번쩍 황금 동상', base: [200, 140, 20], hi: [255, 228, 110], ped: ['#ffe27a', '#b8860b'] },
    { name: '다이아', price: 3000, d: '반짝이는 하늘빛 다이아 동상', base: [110, 190, 235], hi: [235, 250, 255], ped: ['#d8f4ff', '#6fb6d8'] },
    { name: '에메랄드', price: 4000, d: '깊은 초록빛 에메랄드 동상', base: [20, 140, 80], hi: [140, 240, 170], ped: ['#8fe8b0', '#1f7a4a'] },
    { name: '루비', price: 5000, d: '타오르는 붉은 루비 동상 (최고 등급)', base: [160, 20, 45], hi: [255, 120, 140], ped: ['#ff9aaa', '#8a1a2e'] }
  ];
  function tierOf(n) { return TIERS[Math.max(1, Math.min(TIERS.length, n || 1)) - 1]; }
  var cache = {}, cacheAt = {};
  function nick() { try { var r = E('SRV'); if (r && r.nick) return r.nick; } catch (_) {} return '나'; }
  function build(tier) {
    var oc = document.createElement('canvas'); oc.width = 140; oc.height = 170;
    var g = oc.getContext('2d');
    try { E('drawNinja')(g, E('curLook')(), { x: 70, y: 150, s: 1.9, face: -1, st: 'idle', t: 0, idleT: 0, sx: 1, sy: 1 }); } catch (_) {}
    return stone(oc, tier);
  }
  function stone(oc, tier) {
    var T = tierOf(tier);
    var g = oc.getContext('2d');
    try {
      var d = g.getImageData(0, 0, oc.width, oc.height), a = d.data;
      for (var i = 0; i < a.length; i += 4) {
        if (!a[i + 3]) continue;
        var l = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11, n = ((i * 2654435761) >>> 24) / 255 * 18 - 9;
        var v = Math.max(0, Math.min(1, (l * 0.55 + n + 20) / 160)), dk = l < 30 ? 0.55 : 1;
        a[i] = (T.base[0] + (T.hi[0] - T.base[0]) * v) * dk; a[i + 1] = (T.base[1] + (T.hi[1] - T.base[1]) * v) * dk; a[i + 2] = (T.base[2] + (T.hi[2] - T.base[2]) * v) * dk; a[i + 3] = a[i + 3] > 40 ? 255 : 0;
      }
      g.putImageData(d, 0, 0);
      var x0 = oc.width, y0 = oc.height, x1 = 0, y1 = 0;
      for (var yy = 0; yy < oc.height; yy++) for (var xx = 0; xx < oc.width; xx++) if (a[(yy * oc.width + xx) * 4 + 3]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      if (x1 > x0 && y1 > y0) { var cc = document.createElement('canvas'); cc.width = x1 - x0 + 1; cc.height = y1 - y0 + 1; cc.getContext('2d').drawImage(oc, -x0, -y0); return cc; }
    } catch (_) {}
    return oc;
  }
  function img(force, tier) { tier = tier || Number((E('save') || {}).cnStatue) || 1; var now = Date.now(); if (force || !cache[tier] || now - (cacheAt[tier] || 0) > 3000) { cache[tier] = build(tier); cacheAt[tier] = now; } return cache[tier]; }
  window.__statueImg = img;
  // c: 그릴 캔버스, x: 가운데, y: 바닥, k: 크기
  // 다른 사람 동상 목록 (서버 랭킹 기록에서 3분마다 불러와요)
  var others = [], otherImg = {};
  function loadOthers() {
    if (!window.__fetchStatues) return;
    window.__fetchStatues().then(function (list) {
      others = list;
      list.forEach(function (o) {
        var key = o.look + '|' + o.statue; o.key = key;
        if (otherImg[key]) return; otherImg[key] = 'loading';
        window.__charSrc(o.look).then(function (src) {
          if (!src) { delete otherImg[key]; return; }
          var im = new Image(); im.onload = function () {
            var oc = document.createElement('canvas'); oc.width = im.width; oc.height = im.height;
            var g = oc.getContext('2d'); g.translate(im.width, 0); g.scale(-1, 1); g.drawImage(im, 0, 0);
            otherImg[key] = stone(oc, o.statue);
          }; im.src = src;
        });
      });
    }).catch(function () {});
  }
  setTimeout(loadOthers, 4000); setInterval(loadOthers, 180000);
  window.__otherStatues = function () { return others.filter(function (o) { return otherImg[o.key] && otherImg[o.key] !== 'loading'; }); };
  window.__drawStatue = function (c, x, y, k, who) {
    var s = (E('save') || {}); if (!who && !s.cnStatue) return;
    k = k || 1; var tier = who ? who.statue : Number(s.cnStatue) || 1, T = tierOf(tier);
    var im = who ? otherImg[who.key] : img(); if (!im || im === 'loading') return;
    c.save(); c.translate(x, y); c.scale(k, k);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(0, 2, 40, 7, 0, 0, 6.283); c.fill();
    var pg = c.createLinearGradient(0, -34, 0, 0); pg.addColorStop(0, T.ped[0]); pg.addColorStop(1, T.ped[1]);
    c.fillStyle = pg; c.strokeStyle = '#141418'; c.lineWidth = 2.5;
    c.beginPath(); c.rect(-30, -22, 60, 22); c.fill(); c.stroke();
    c.beginPath(); c.rect(-36, -30, 72, 9); c.fill(); c.stroke();
    c.fillStyle = '#5d584f'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.fillText('닌자의 전당', 0, -8);
    var ih = 110, iw = im.width * ih / im.height;
    c.drawImage(im, -iw / 2, -30 - ih, iw, ih);
    var nk = who ? who.nick : nick(); c.font = 'bold 17px sans-serif'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#141418'; c.fillStyle = '#ffe27a';
    c.strokeText(nk, 0, -30 - ih - 8); c.fillText(nk, 0, -30 - ih - 8);
    if (tier >= 2) { var tt = Date.now() / 1000; c.fillStyle = '#ffffff'; for (var q = 0; q < tier; q++) { var ph = tt * 1.7 + q * 1.9, al = Math.max(0, Math.sin(ph)); if (al < 0.2) continue; c.globalAlpha = al; var qx = Math.sin(q * 7.3 + Math.floor(ph / 6.283)) * iw * 0.4, qy = -30 - ih * (0.2 + ((q * 0.37) % 0.7)); c.beginPath(); c.moveTo(qx, qy - 6); c.lineTo(qx + 2, qy); c.lineTo(qx, qy + 6); c.lineTo(qx - 2, qy); c.closePath(); c.fill(); c.beginPath(); c.moveTo(qx - 6, qy); c.lineTo(qx, qy - 2); c.lineTo(qx + 6, qy); c.lineTo(qx, qy + 2); c.closePath(); c.fill(); } c.globalAlpha = 1; }
    c.restore();
  };
  var hook = setInterval(function () {
    var f; try { f = E('renderLobby'); } catch (_) {} if (typeof f !== 'function') return; clearInterval(hook);
    window.renderLobby = function (dt) {
      var r = f.apply(this, arguments);
      try {
        var s = E('save'); if (s && s.cnStatue) {
          var c = E('ctx'), b = E('dpr') * E('scale'); c.setTransform(b, 0, 0, b, 0, 0);
          window.__drawStatue(c, E('W') * 0.86, E('viewH') * 0.56, 0.72);
        }
        var ot = window.__otherStatues();
        if (ot.length) {
          var c2 = E('ctx'), b2 = E('dpr') * E('scale'); c2.setTransform(b2, 0, 0, b2, 0, 0);
          window.__drawStatue(c2, E('W') * 0.14, E('viewH') * 0.56, 0.72, ot[Math.floor(Date.now() / 6000) % ot.length]);
        }
      } catch (_) {}
      return r;
    };
  }, 300);
})();

// ── 광전사 사냥터: 내 캐릭터가 알아서 몬스터를 베고 엽전을 모아요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var css = '#bzOv{position:absolute;inset:0;z-index:60;background:#140c12;display:flex;flex-direction:column;color:#fff;touch-action:none;user-select:none}' +
    '#bzOv .bzTop{display:flex;gap:6px;align-items:center;padding:12px 12px 6px}' +
    '#bzOv .bzPill{background:rgba(255,255,255,.12);border-radius:14px;padding:6px 10px;font-size:13px;white-space:nowrap}' +
    '#bzOv .bzPill b{color:#ffd84a}' +
    '#bzOv .bzX{margin-left:auto;width:38px;height:38px;border-radius:50%;border:3px solid #141418;background:#ff6b6b;color:#fff;font-size:18px;font-weight:bold;cursor:pointer;box-shadow:0 3px 0 #141418}' +
    '#bzOv .bzRage{margin:0 12px 6px;height:14px;border:2px solid #141418;border-radius:8px;background:#3a1f2a;overflow:hidden;position:relative}' +
    '#bzOv .bzRage i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff8a3d,#ff2d55)}' +
    '#bzOv .bzRage span{position:absolute;inset:0;font-size:10px;line-height:10px;text-align:center;font-weight:bold;text-shadow:0 1px 0 #000}' +
    '#bzCv{flex:1;width:100%;display:block}' +
    '#bzOv .bzNote{font-size:11px;opacity:.7;text-align:center;padding:4px 0 10px}';
  var MON = {
    tanuki: { hp: 2, coin: 1, col: '#b07a4a', bel: '#f1d3a8', spd: 40, r: 15 },
    frog: { hp: 1, coin: 2, col: '#5fc96a', bel: '#c9f2b0', spd: 75, r: 13 },
    hedge: { hp: 4, coin: 3, col: '#8a6a52', bel: '#e8cfa8', spd: 30, r: 16 },
    gold: { hp: 3, coin: 10, col: '#ffd84a', bel: '#fff3b0', spd: 90, r: 14 },
    boss: { hp: 30, coin: 40, col: '#a8323e', bel: '#f2a0a0', spd: 22, r: 34 }
  };
  var ov, cv, c, raf, W, H, dpr, GY, st;
  function S() { try { return E('save'); } catch (_) { return null; } }
  function snd(f, d, t, v, sl) { try { E('tone')(f, d, t || 'square', v || 0.04, sl || 0); } catch (_) {} }
  function layout() { var r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; GY = H * 0.8; }
  function spawn(k) {
    if (!k) { var r = Math.random(); k = r < 0.05 ? 'gold' : r < 0.25 ? 'frog' : r < 0.42 ? 'hedge' : 'tanuki'; }
    var m = MON[k], side = Math.random() < 0.5 ? -1 : 1, lvl = 1 + Math.floor(st.kills / 60) * 0.25;
    st.mobs.push({ k: k, x: side < 0 ? -40 : W + 40, y: GY, vx: 0, hp: Math.ceil(m.hp * lvl), max: Math.ceil(m.hp * lvl), r: m.r, ph: Math.random() * 6, hit: 0, dead: 0 });
  }
  function fx(t, x, y, col, size) { st.fx.push({ k: 'txt', t: t, x: x, y: y, vy: -50, life: 0.9, max: 0.9, col: col, size: size || 15 }); }
  function boom(x, y, col, n) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, sp = 60 + Math.random() * 200; st.fx.push({ k: 'dot', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100, life: 0.5, max: 0.5, col: col }); } }
  function earn(x, y) {                              // 몬스터 10마리마다 엽전 1개
    if (st.kills % 10 !== 0) return;
    var s = S(); if (s) s.coins += 1; st.earned += 1; st.dirty = true;
    fx('엽전 +1', x, y - 40, '#ffd84a', 17); try { E('SFX').coin(4); } catch (_) {}
  }
  function hitMob(m, dmg) {
    if (m.dead) return;
    m.hp -= dmg; m.hit = 0.15; m.vx = (m.x < st.px ? -1 : 1) * 160;
    boom(m.x, m.y - m.r, '#ffffff', 4);
    if (m.hp <= 0) {
      m.dead = 0.001; st.kills++;
      earn(m.x, m.y - m.r);
      boom(m.x, m.y - m.r, m.k === 'gold' ? '#ffd84a' : m.k === 'boss' ? '#ff5a5a' : '#f1d3a8', m.k === 'boss' ? 40 : 12);
      if (st.bz <= 0) { st.rage = Math.min(100, st.rage + (m.k === 'boss' ? 60 : 9)); if (st.rage >= 100) berserk(); }
      if (m.k === 'gold') { try { E('SFX').coin(10); } catch (_) {} }
      if (m.k === 'boss') { st.shake = 1; fx('보스 처치!', W / 2, H * 0.25, '#ff5a5a', 24); try { E('SFX').clear(); } catch (_) {} }
      if (st.kills % 50 === 0) { st.bossDue = true; }
    }
  }
  function berserk() {
    st.bz = 8; st.rage = 100; st.shake = 0.8;
    fx('광폭화!!', W / 2, H * 0.3, '#ff3d5a', 30);
    try { E('SFX').roar(); } catch (_) { snd(90, 0.6, 'sawtooth', 0.1, -40); }
    try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (_) {}
  }
  function attack() {
    var bz = st.bz > 0, reach = bz ? 95 : 52, dmg = bz ? 2 : 1;
    st.slashT = 0.22; st.slashK = st.slashK === 1 ? 2 : 1;
    st.fx.push({ k: 'arc', x: st.px + st.face * 18, y: GY - 26, r: bz ? 62 : 38, face: st.face, life: 0.18, max: 0.18, col: bz ? '#ff5a5a' : '#ffffff' });
    var any = false;
    st.mobs.forEach(function (m) {
      if (m.dead) return; var dx = m.x - st.px;
      if (bz ? Math.abs(dx) < reach + m.r : (dx * st.face > -10 && Math.abs(dx) < reach + m.r)) { hitMob(m, dmg); any = true; }
    });
    try { E('SFX').slash(st.slashK); } catch (_) { snd(900, 0.05, 'triangle', 0.03, -500); }
    if (any) st.shake = Math.max(st.shake, bz ? 0.35 : 0.15);
  }
  function step(dt) {
    st.t += dt; st.spawnT -= dt; st.atkCD -= dt; st.slashT = Math.max(0, st.slashT - dt);
    var alive = st.mobs.filter(function (m) { return !m.dead; });
    if (st.bossDue && !alive.some(function (m) { return m.k === 'boss'; })) { st.bossDue = false; spawn('boss'); fx('보스 등장!', W / 2, H * 0.25, '#ff9a3d', 22); }
    if (st.spawnT <= 0 && alive.length < (st.bz > 0 ? 9 : 6)) { spawn(); st.spawnT = st.bz > 0 ? 0.35 : 0.8 + Math.random() * 0.6; }
    if (st.bz > 0) { st.bz -= dt; st.rage = Math.max(0, (st.bz / 8) * 100); if (st.bz <= 0) { st.bz = 0; st.rage = 0; fx('광폭화 끝', st.px, GY - 80, '#ffffff', 14); } }
    // 가장 가까운 몬스터 찾기
    var tgt = null, best = 1e9;
    alive.forEach(function (m) { var d = Math.abs(m.x - st.px); if (m.x > -10 && m.x < W + 10 && d < best) { best = d; tgt = m; } });
    var spd = st.bz > 0 ? 260 : 150, reach = st.bz > 0 ? 70 : 40;
    if (tgt) {
      var dir = tgt.x > st.px ? 1 : -1; st.face = dir;
      if (best > reach) { st.px += dir * spd * dt; st.state = 'run'; st.run += dt * 14; }
      else st.state = 'idle';
      if (best <= reach + tgt.r && st.atkCD <= 0) { attack(); st.atkCD = st.bz > 0 ? 0.16 : 0.38; }
    } else { st.state = 'idle'; var home = W * 0.5; if (Math.abs(st.px - home) > 4) { st.face = home > st.px ? 1 : -1; st.px += st.face * 80 * dt; st.state = 'run'; st.run += dt * 10; } }
    st.px = Math.max(20, Math.min(W - 20, st.px));
    st.mobs.forEach(function (m) {
      if (m.dead) { m.dead += dt; return; }
      m.ph += dt * 8; m.hit = Math.max(0, m.hit - dt);
      var want = (m.x < st.px ? 1 : -1) * MON[m.k].spd * (st.bz > 0 ? 0.7 : 1);
      m.vx += (want - m.vx) * Math.min(1, dt * 4);
      if (Math.abs(m.x - st.px) > m.r + 14 || m.vx * (st.px - m.x) < 0) m.x += m.vx * dt;
    });
    st.mobs = st.mobs.filter(function (m) { return !m.dead || m.dead < 0.4; });
    st.fx = st.fx.filter(function (p) { p.life -= dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; if (p.k === 'dot') p.vy += 500 * dt; return p.life > 0; });
    st.shake = Math.max(0, st.shake - dt * 2.5);
    st.saveT -= dt; if (st.saveT <= 0 && st.dirty) { st.saveT = 5; st.dirty = false; try { E('persist')(); } catch (_) {} }
  }
  function drawMob(m) {
    var info = MON[m.k], R = m.r, bob = Math.abs(Math.sin(m.ph)) * 3;
    c.save(); c.translate(m.x, m.y - bob);
    if (m.dead) { var q = Math.min(1, m.dead / 0.4); c.globalAlpha = 1 - q; c.scale(1 + q * 0.5, 1 - q * 0.7); }
    if (m.k === 'gold') { var gg = c.createRadialGradient(0, -R, 2, 0, -R, R * 2); gg.addColorStop(0, 'rgba(255,220,80,.6)'); gg.addColorStop(1, 'rgba(255,220,80,0)'); c.fillStyle = gg; c.beginPath(); c.arc(0, -R, R * 2, 0, 6.283); c.fill(); }
    c.scale(m.x < st.px ? 1 : -1, 1);
    c.lineWidth = 2.5; c.strokeStyle = '#141418'; c.fillStyle = m.hit > 0 ? '#ffffff' : info.col;
    if (m.k === 'hedge') { for (var s = 0; s < 7; s++) { var a = -2.6 + s * 0.38; c.beginPath(); c.moveTo(Math.cos(a) * R * 0.7, -R + Math.sin(a) * R * 0.7); c.lineTo(Math.cos(a) * R * 1.35, -R + Math.sin(a) * R * 1.35); c.lineTo(Math.cos(a + 0.2) * R * 0.7, -R + Math.sin(a + 0.2) * R * 0.7); c.fill(); c.stroke(); } }
    if (m.k === 'tanuki' || m.k === 'gold') [-1, 1].forEach(function (d) { c.beginPath(); c.arc(d * R * 0.55, -R * 1.75, R * 0.28, 0, 6.283); c.fill(); c.stroke(); });
    if (m.k === 'boss') { c.fillStyle = '#f3e6c8'; [-1, 1].forEach(function (d) { c.beginPath(); c.moveTo(d * R * 0.4, -R * 1.75); c.lineTo(d * R * 0.75, -R * 2.5); c.lineTo(d * R * 0.75, -R * 1.6); c.closePath(); c.fill(); c.stroke(); }); c.fillStyle = m.hit > 0 ? '#ffffff' : info.col; }
    c.beginPath(); c.ellipse(0, -R, R, R * 0.92, 0, 0, 6.283); c.fill(); c.stroke();
    c.fillStyle = info.bel; c.beginPath(); c.ellipse(R * 0.15, -R * 0.75, R * 0.55, R * 0.45, 0, 0, 6.283); c.fill();
    var ey = m.k === 'frog' ? -R * 1.85 : -R * 1.2;
    if (m.k === 'frog') { c.fillStyle = info.col; c.beginPath(); c.arc(R * 0.45, ey, R * 0.36, 0, 6.283); c.fill(); c.stroke(); }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(R * 0.45, ey, R * 0.22, 0, 6.283); c.fill(); c.stroke();
    c.fillStyle = '#141418'; c.beginPath(); c.arc(R * 0.52, ey, R * 0.1, 0, 6.283); c.fill();
    if (m.k === 'boss') { c.lineWidth = 3; c.beginPath(); c.moveTo(R * 0.15, ey - R * 0.35); c.lineTo(R * 0.7, ey - R * 0.2); c.stroke(); }
    c.restore();
    if (!m.dead && m.max > 1) { var bw = Math.max(24, R * 1.6); c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(m.x - bw / 2, m.y - R * 2.2 - 12, bw, 4); c.fillStyle = m.k === 'boss' ? '#ff5a5a' : '#7df97d'; c.fillRect(m.x - bw / 2, m.y - R * 2.2 - 12, bw * Math.max(0, m.hp / m.max), 4); }
  }
  function draw() {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sx = st.shake > 0 ? (Math.random() - 0.5) * 12 * st.shake : 0, sy = st.shake > 0 ? (Math.random() - 0.5) * 12 * st.shake : 0;
    c.translate(sx, sy);
    var bz = st.bz > 0;
    var sky = c.createLinearGradient(0, 0, 0, GY); sky.addColorStop(0, bz ? '#3a0710' : '#2a1a3a'); sky.addColorStop(1, bz ? '#b8323e' : '#d0705a');
    c.fillStyle = sky; c.fillRect(-20, -20, W + 40, GY + 20);
    c.fillStyle = bz ? 'rgba(255,90,90,.25)' : 'rgba(255,220,180,.35)'; c.beginPath(); c.arc(W * 0.78, GY * 0.35, 34, 0, 6.283); c.fill();
    c.fillStyle = bz ? '#2a0a10' : '#3a2440';
    c.beginPath(); c.moveTo(-20, GY); for (var i = 0; i <= 8; i++) c.lineTo(i / 8 * (W + 40) - 20, GY - 40 - Math.abs(Math.sin(i * 1.7)) * 60); c.lineTo(W + 20, GY); c.fill();
    if (window.__drawStatue) {
      var ot = window.__otherStatues ? window.__otherStatues().slice(0, 4) : [], pos = 0.12;
      ot.forEach(function (o, i) { window.__drawStatue(c, W * (0.32 + i * 0.19), GY, 0.55, o); });
      window.__drawStatue(c, W * pos, GY, 0.7);
    }
    c.fillStyle = bz ? '#4a1a1a' : '#4a3a2a'; c.fillRect(-20, GY, W + 40, H - GY + 20);
    c.fillStyle = bz ? '#7a2a2a' : '#6a8a3a'; c.fillRect(-20, GY, W + 40, 6);
    st.mobs.forEach(drawMob);
    // 플레이어
    if (bz) { var au = c.createRadialGradient(st.px, GY - 30, 4, st.px, GY - 30, 70); au.addColorStop(0, 'rgba(255,60,60,' + (0.45 + Math.sin(st.t * 20) * 0.15) + ')'); au.addColorStop(1, 'rgba(255,0,0,0)'); c.fillStyle = au; c.beginPath(); c.arc(st.px, GY - 30, 70, 0, 6.283); c.fill(); }
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(st.px, GY + 1, 18, 4, 0, 0, 6.283); c.fill();
    try {
      E('drawNinja')(c, E('curLook')(), { x: st.px, y: GY, s: bz ? 1.75 : 1.5, face: st.face, st: st.state, run: st.run, t: st.t, idleT: st.t, sx: 1, sy: 1,
        slash: st.slashT > 0 ? 1 - st.slashT / 0.22 : null, slashKind: st.slashK, lean: st.state === 'run' ? 0.12 * st.face : 0 });
    } catch (_) {}
    st.fx.forEach(function (p) {
      c.save(); c.globalAlpha = Math.max(0, p.life / p.max);
      if (p.k === 'txt') { c.font = 'bold ' + p.size + 'px sans-serif'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#141418'; c.strokeText(p.t, p.x, p.y); c.fillStyle = p.col; c.fillText(p.t, p.x, p.y); }
      else if (p.k === 'arc') { c.strokeStyle = p.col; c.lineWidth = 6 * (p.life / p.max) + 1; c.lineCap = 'round'; c.beginPath(); if (p.r > 50) c.arc(p.x - p.face * 18, p.y, p.r, 0, 6.283); else c.arc(p.x, p.y, p.r, p.face > 0 ? -1.3 : 1.84, p.face > 0 ? 1.3 : 4.44); c.stroke(); }
      else { c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
      c.restore();
    });
  }
  function hud() {
    ov.querySelector('#bzEarn').textContent = st.earned;
    ov.querySelector('#bzKill').textContent = st.kills + ' (다음 엽전까지 ' + (10 - st.kills % 10) + ')';
    var s = S(); ov.querySelector('#bzWallet').textContent = s ? s.coins : 0;
    ov.querySelector('.bzRage i').style.width = st.rage + '%';
    ov.querySelector('.bzRage span').textContent = st.bz > 0 ? '광폭화! ' + Math.ceil(st.bz) + '초' : '분노 ' + Math.floor(st.rage) + '%';
  }
  function tick(now) {
    if (!ov) return;
    var dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;
    if (!document.hidden) { step(dt); draw(); hud(); }
    raf = requestAnimationFrame(tick);
  }
  function open() {
    if (ov) return;
    var wrap = document.getElementById('wrap') || document.body;
    ov = document.createElement('div'); ov.id = 'bzOv';
    ov.innerHTML = '<div class="bzTop"><div class="bzPill">번 엽전 <b id="bzEarn">0</b></div><div class="bzPill">처치 <b id="bzKill">0</b></div><div class="bzPill">지갑 <b id="bzWallet">0</b></div><button class="bzX">✕</button></div>' +
      '<div class="bzRage"><i></i><span></span></div><canvas id="bzCv"></canvas><div class="bzNote">켜 두기만 하면 알아서 싸워요 · 몬스터 10마리마다 엽전 1개 · 분노가 차면 광폭화 · 50마리마다 보스</div>';
    wrap.appendChild(ov);
    cv = ov.querySelector('#bzCv'); c = cv.getContext('2d');
    ov.querySelector('.bzX').onclick = close;
    layout();
    st = { px: W / 2, face: 1, state: 'idle', run: 0, t: 0, mobs: [], fx: [], spawnT: 0.3, atkCD: 0, slashT: 0, slashK: 0, kills: 0, earned: 0, rage: 0, bz: 0, shake: 0, bossDue: false, saveT: 5, dirty: false, last: performance.now() };
    addEventListener('resize', layout); addEventListener('keydown', esc, true);
    raf = requestAnimationFrame(tick);
  }
  function esc(e) { if (!ov) return; e.stopPropagation(); if (e.key === 'Escape') close(); }
  function close() {
    if (!ov) return; cancelAnimationFrame(raf);
    removeEventListener('resize', layout); removeEventListener('keydown', esc, true);
    var got = st.earned; ov.remove(); ov = null;
    try { E('persist')(); E('refreshLobby')(); E('SFX').click(); } catch (_) {}
    if (got > 0) { try { E('showLobbyMsg')('광전사 사냥으로 엽전 ' + got + '개를 모았어요!'); } catch (_) {} }
    st = null;
  }
  window.__openBerserk = open;
  var wait = setInterval(function () {
    var box = document.querySelector('.lobbyBtns'); if (!box) return; clearInterval(wait);
    var stl = document.createElement('style'); stl.textContent = css + '#btnBz{width:100%;background:linear-gradient(180deg,#ff6b5a,#c8323e)!important;color:#fff}'; document.head.appendChild(stl);
    var row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<button class="mid" id="btnBz"><span class="lbl">⚔️ 광전사 사냥터 (자동 사냥)</span></button>';
    box.appendChild(row);
    row.querySelector('#btnBz').addEventListener('click', function () { try { E('SFX').click(); } catch (_) {} open(); });
  }, 300);
})();

// ── 스프링 애니메이션: 밟으면 꾹 눌렸다가 튕겨 오르고 출렁이며 멈춰요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var DUR = 0.75;
  var hook = setInterval(function () {
    var ok; try { ok = typeof E('drawSpring') === 'function' && typeof E('doSpring') === 'function'; } catch (_) { ok = false; }
    if (!ok) return; clearInterval(hook);
    var oDo = E('doSpring');
    window.doSpring = function (p, tx, ty) {
      var r = oDo.apply(this, arguments);
      try { E('springAnim')[tx + ',' + ty] = DUR; } catch (_) {}
      return r;
    };
    window.drawSpring = function (g, tx, ty, k) {
      var T = E('T'), TAU = Math.PI * 2, rr = E('rr'), time = E('time');
      var x = tx * T, y = ty * T, off, sx = 1;
      if (k > 0) {
        var p = Math.min(1, 1 - k / DUR);
        off = p < 0.1 ? 12 * (p / 0.1) : 12 * Math.cos((p - 0.1) / 0.9 * Math.PI * 5) * Math.exp(-4.2 * (p - 0.1) / 0.9);
      } else off = Math.sin(time * 3 + tx * 1.3) * 1.2;
      sx = 1 + Math.max(-0.12, Math.min(0.2, off * 0.018));
      var top = y + 8 + off;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x + T / 2, y + T, 14 * sx, 3, 0, 0, TAU); g.fill();
      var bg = g.createLinearGradient(0, y + T - 8, 0, y + T); bg.addColorStop(0, '#8a6038'); bg.addColorStop(1, '#4e331a');
      g.fillStyle = bg; rr(g, x + 2, y + T - 7, T - 4, 7, 2); g.fill();
      var hh = (y + T - 7) - (top + 5), n = 5, w = (T - 16) * (1 + Math.max(0, off) * 0.03);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(x + T / 2 - w / 2, y + T - 7);
      for (var i = 1; i <= n; i++) g.lineTo(i % 2 ? x + T / 2 + w / 2 : x + T / 2 - w / 2, y + T - 7 - hh * i / n);
      g.strokeStyle = '#2f7a2c'; g.lineWidth = 4; g.stroke();
      g.strokeStyle = '#8fe070'; g.lineWidth = 1.5; g.stroke(); g.lineCap = 'butt'; g.lineJoin = 'miter';
      var pw = T * sx, px = x + (T - pw) / 2, ph = 7 / Math.max(0.85, sx);
      var pg = g.createLinearGradient(0, top, 0, top + ph); pg.addColorStop(0, '#ff7a5e'); pg.addColorStop(1, '#c23a26');
      g.fillStyle = pg; rr(g, px, top, pw, ph, 3.5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(px + 4, top + 1.2, pw - 8, 1.6);
      if (k > 0 && k > DUR - 0.25) {                       // 튕길 때 위로 뻗는 바람 줄기
        var a = (k - (DUR - 0.25)) / 0.25; g.globalAlpha = a * 0.8; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
        for (var j = -1; j <= 1; j++) { g.beginPath(); g.moveTo(x + T / 2 + j * 9, top - 4); g.lineTo(x + T / 2 + j * 11, top - 4 - 22 * (1 - a) - 6); g.stroke(); }
        g.globalAlpha = 1;
      }
      if (k <= 0) {
        g.globalAlpha = 0.5 + 0.5 * Math.sin(time * 5);
        var ay = top - 6 - Math.abs(Math.sin(time * 4)) * 3;
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + T / 2, ay - 5); g.lineTo(x + T / 2 - 4, ay); g.lineTo(x + T / 2 + 4, ay); g.fill();
        g.globalAlpha = 1;
      }
    };
  }, 300);
})();

// ── 시작 화면: 게임이 다 준비될 때까지 가려 두고, 준비되면 짧은 컷신을 보여 줘요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var ov, cv, c, W, H, dpr, t0 = 0, raf, done = false, ready = false, started = false;
  var css = '#bootOv{position:fixed;inset:0;z-index:99999;background:#141a33;touch-action:none;user-select:none;transition:opacity .5s}' +
    '#bootOv canvas{position:absolute;inset:0;width:100%;height:100%}' +
    '#bootOv .bootWait{position:absolute;left:0;right:0;top:50%;text-align:center;color:#fff;font:16px sans-serif;opacity:.8}' +
    '#bootOv .bootSkip{position:absolute;right:14px;top:calc(14px + env(safe-area-inset-top));padding:8px 14px;border-radius:16px;border:2px solid #fff6;background:#0006;color:#fff;font:bold 13px sans-serif;cursor:pointer;display:none}';
  var styled = false;
  function mount() {
    if (!styled) { styled = true; var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
    ov = document.createElement('div'); ov.id = 'bootOv';
    ov.innerHTML = '<canvas></canvas><div class="bootWait">닌자가 몸을 푸는 중…</div><button class="bootSkip">건너뛰기 ▶▶</button>';
    document.body.appendChild(ov);
    cv = ov.querySelector('canvas'); c = cv.getContext('2d');
    ov.querySelector('.bootSkip').addEventListener('click', function (e) { e.stopPropagation(); finish(); });
    ov.addEventListener('pointerdown', function () { if (started && performance.now() - t0 > 600) finish(); });
    addEventListener('keydown', function kd(e) { if (done) { removeEventListener('keydown', kd, true); return; } e.stopPropagation(); e.preventDefault(); if (started && performance.now() - t0 > 600) finish(); }, true);
    size(); addEventListener('resize', size);
  }
  function size() { if (!cv) return; dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; }
  function tone(f, d, ty, v, s) { try { E('tone')(f, d, ty || 'triangle', v || 0.05, s || 0); } catch (_) {} }
  var CAP = [[0.4, 1.5, '저 높고 높은 구름 위에서…', 0], [3.05, 4.3, '쿠우우우웅——!!', 1], [4.4, 5.7, '하찮지만 진지한 닌자, 등장!', 0]];
  var END = 7.2, JUMP = 1.15, FALL0 = 1.35, HIT = 3.0, stars = [], clouds = [], dust = [], rocks = [], leaves = [], cracks = [], ghosts = [], lastGhost = 0;
  for (var i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random() * 0.7, r: Math.random() < 0.15 ? 1.6 : 0.9, p: Math.random() * 6 });
  for (var i2 = 0; i2 < 14; i2++) clouds.push({ x: Math.random() * 1.3 - 0.15, y: Math.random() * 1.6, s: 0.6 + Math.random() * 1.2, a: 0.18 + Math.random() * 0.3, d: 0.4 + Math.random() * 0.8 });
  for (var q = 0; q < 11; q++) { var ang = Math.PI + (q + 0.5) / 11 * Math.PI, pts = [[0, 0]], r0 = 0, aa = ang; for (var k = 0; k < 6; k++) { r0 += 12 + Math.random() * 22; aa += (Math.random() - 0.5) * 0.6; pts.push([Math.cos(aa) * r0, -Math.sin(aa) * r0 * 0.22]); } cracks.push(pts); }
  function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3); }
  function easeIn(x) { return x < 0 ? 0 : x > 1 ? 1 : x * x * x; }
  function cloud(x, y, s, a, col) { c.save(); c.globalAlpha = a; c.fillStyle = col || '#ffffff'; c.beginPath(); c.arc(x, y, 18 * s, 0, 6.283); c.arc(x + 20 * s, y - 9 * s, 23 * s, 0, 6.283); c.arc(x + 44 * s, y, 18 * s, 0, 6.283); c.arc(x + 22 * s, y + 6 * s, 20 * s, 0, 6.283); c.fill(); c.restore(); }
  var sfx = {};
  function once(k, fn) { if (!sfx[k]) { sfx[k] = 1; fn(); } }
  function boom() {
    tone(60, 0.9, 'sawtooth', 0.13, -35); tone(130, 0.45, 'square', 0.08, -90); tone(45, 1.1, 'sine', 0.14, -15);
    try { E('noise')(0.8, 0.2, 260); } catch (_) {}
    try { navigator.vibrate && navigator.vibrate([110, 40, 70, 30, 40]); } catch (_) {}
  }
  function bamboo(x, base, h, wdt, col, node, sway, leafy) {
    c.save(); c.translate(x, base); c.rotate(sway);
    c.fillStyle = col; c.fillRect(-wdt / 2, -h, wdt, h + 4);
    c.fillStyle = node; for (var n = 1; n < 7; n++) c.fillRect(-wdt / 2 - 1, -h * n / 7, wdt + 2, 3);
    if (leafy) { c.fillStyle = node; for (var l = 0; l < 4; l++) { var ly = -h * (0.55 + l * 0.12), dir = l % 2 ? 1 : -1; c.beginPath(); c.moveTo(0, ly); c.quadraticCurveTo(dir * wdt * 2.2, ly - 10, dir * wdt * 3.4, ly + 4); c.quadraticCurveTo(dir * wdt * 2, ly + 2, 0, ly); c.fill(); } }
    c.restore();
  }
  function frame(now) {
    if (done) return;
    var t = (now - t0) / 1000, cx = W * 0.5, GY = H * 0.74;
    var shake = t > HIT ? Math.pow(Math.max(0, 1 - (t - HIT) / 1.0), 1.5) : 0;
    // 카메라: 하늘에서 시작해 닌자를 따라 땅으로 내려와요 (pan 0 = 하늘, 1 = 땅)
    var pan = t < FALL0 ? 0 : t < HIT ? easeIn((t - FALL0) / (HIT - FALL0)) : 1;
    var drop = (1 - pan) * H * 1.9;                       // 땅이 화면 아래로 얼마나 내려가 있는지
    var gy = GY + drop;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.translate((Math.random() - 0.5) * 26 * shake, (Math.random() - 0.5) * 20 * shake);
    // 하늘
    var sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#070b1e'); sky.addColorStop(0.55, '#1b2550'); sky.addColorStop(1, '#4a5a8e');
    c.fillStyle = sky; c.fillRect(-40, -40, W + 80, H + 80);
    stars.forEach(function (st0) { c.globalAlpha = (0.35 + 0.4 * Math.sin(t * 2.5 + st0.p)) * (1 - pan * 0.4); c.fillStyle = '#fff'; c.beginPath(); c.arc(st0.x * W, st0.y * H - drop * 0.05, st0.r, 0, 6.283); c.fill(); }); c.globalAlpha = 1;
    // 달 (테두리 빛 + 무늬)
    var mx = W * 0.76, my = H * 0.2 - drop * 0.08, mr = Math.min(W, H) * 0.1;
    var halo = c.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3); halo.addColorStop(0, 'rgba(255,240,190,.35)'); halo.addColorStop(1, 'rgba(255,240,190,0)');
    c.fillStyle = halo; c.beginPath(); c.arc(mx, my, mr * 3, 0, 6.283); c.fill();
    c.fillStyle = '#fff3c8'; c.beginPath(); c.arc(mx, my, mr, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(210,190,140,.35)'; [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.35, 0.12]].forEach(function (m) { c.beginPath(); c.arc(mx + m[0] * mr, my + m[1] * mr, m[2] * mr, 0, 6.283); c.fill(); });
    // 멀리 있는 산 (천천히 올라와요)
    var mtY = H * 0.78 + drop * 0.35;
    c.fillStyle = '#1a2142'; c.beginPath(); c.moveTo(-40, mtY + 200); for (var m2 = 0; m2 <= 10; m2++) c.lineTo(m2 / 10 * (W + 80) - 40, mtY - 70 - Math.abs(Math.sin(m2 * 1.3)) * 90); c.lineTo(W + 40, mtY + 200); c.fill();
    // 구름: 떨어지는 동안 위로 휙휙 지나가요
    var fallV = t < FALL0 ? 0 : (t < HIT ? pan : 1);
    clouds.forEach(function (k) {
      var yy = (k.y * H) - (t > FALL0 ? (Math.min(t, HIT) - FALL0) * H * 1.6 * k.d : 0) + Math.sin(t + k.x * 5) * 3;
      if (yy < -80 || yy > H + 80) return; cloud(k.x * W, yy, k.s, k.a * (1 - Math.max(0, (t - HIT) * 0.6)));
    });
    // 바람 줄기 (떨어지는 중)
    if (t > FALL0 && t < HIT) { c.strokeStyle = 'rgba(255,255,255,' + (0.15 + 0.35 * pan) + ')'; c.lineWidth = 1.5; for (var wl = 0; wl < 18; wl++) { var wx = ((wl * 137) % 100) / 100 * W, wy = ((wl * 71 + t * 1400) % (H + 200)) - 100; c.beginPath(); c.moveTo(wx, H - wy); c.lineTo(wx, H - wy - 40 - 90 * pan); c.stroke(); } }
    // 대나무 숲 (뒤쪽, 앞쪽 두 겹)
    for (var b = 0; b < 12; b++) { var bx = (b + 0.3) / 12 * W, bh = H * (0.5 + 0.3 * Math.abs(Math.sin(b * 2.3))); bamboo(bx, gy - H * 0.02, bh, 9, '#1a2838', '#101a26', shake * Math.sin(t * 38 + b) * 0.08 * (bx < cx ? -1 : 1), true); }
    // 땅
    var gg = c.createLinearGradient(0, gy, 0, gy + 120); gg.addColorStop(0, '#24314a'); gg.addColorStop(1, '#0e1422');
    c.fillStyle = gg; c.fillRect(-40, gy, W + 80, H + 200); c.fillStyle = '#3a5a3a'; c.fillRect(-40, gy, W + 80, 5);
    // 착지 뒤 효과 (갈라짐, 충격파, 먼지, 돌)
    var after = t - HIT;
    if (after >= 0) {
      once('boom', function () {
        boom();
        for (var d = 0; d < 60; d++) { var a = Math.PI + Math.random() * Math.PI, sp = 140 + Math.random() * 420; dust.push({ x: cx + (Math.random() - 0.5) * 30, y: GY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 60, life: 0.9 + Math.random() * 0.8, r: 4 + Math.random() * 9 }); }
        for (var rk = 0; rk < 16; rk++) { var a2 = Math.PI * 1.15 + Math.random() * Math.PI * 0.7, sp2 = 260 + Math.random() * 360; rocks.push({ x: cx, y: GY - 4, vx: Math.cos(a2) * sp2, vy: Math.sin(a2) * sp2, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20, s: 3 + Math.random() * 5, life: 1.6 }); }
        for (var lf = 0; lf < 22; lf++) leaves.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.4, vx: (Math.random() - 0.5) * 40, vy: 40 + Math.random() * 60, rot: Math.random() * 6, ph: Math.random() * 6 });
      });
      var cr = Math.min(1, after / 0.22);
      c.save(); c.translate(cx, GY + 3); c.lineJoin = 'round';
      cracks.forEach(function (pts) { var m = Math.max(1, Math.round(pts.length * cr)); c.beginPath(); c.moveTo(0, 0); for (var z = 1; z < m; z++) c.lineTo(pts[z][0] * 1.7, pts[z][1] * 1.7 + 6); c.strokeStyle = '#05080f'; c.lineWidth = 4; c.stroke(); c.strokeStyle = 'rgba(255,170,80,' + Math.max(0, 0.8 - after) + ')'; c.lineWidth = 1.5; c.stroke(); });
      c.restore();
      var glow = c.createRadialGradient(cx, GY, 4, cx, GY, 160); glow.addColorStop(0, 'rgba(255,200,120,' + Math.max(0, 0.6 - after * 0.6) + ')'); glow.addColorStop(1, 'rgba(255,200,120,0)');
      c.fillStyle = glow; c.beginPath(); c.ellipse(cx, GY, 160, 50, 0, 0, 6.283); c.fill();
      for (var w = 0; w < 4; w++) { var rt = after - w * 0.1; if (rt < 0 || rt > 1) continue; var rr2 = ease(rt) * Math.max(W, H) * 0.75; c.globalAlpha = (1 - rt) * 0.85; c.strokeStyle = w % 2 ? '#ffd84a' : '#ffffff'; c.lineWidth = 9 - w * 2; c.beginPath(); c.ellipse(cx, GY, rr2, rr2 * 0.26, 0, 0, 6.283); c.stroke(); }
      c.globalAlpha = 1;
      if (after < 0.35) { c.save(); c.globalAlpha = (1 - after / 0.35) * 0.7; c.strokeStyle = '#ffffff'; c.lineWidth = 2; for (var sl = 0; sl < 28; sl++) { var sa = sl / 28 * 6.283, r1 = 60 + after * 500, r2 = r1 + 80 + (sl % 3) * 40; c.beginPath(); c.moveTo(cx + Math.cos(sa) * r1, GY - 30 + Math.sin(sa) * r1); c.lineTo(cx + Math.cos(sa) * r2, GY - 30 + Math.sin(sa) * r2); c.stroke(); } c.restore(); }
    }
    var dt = 1 / 60;
    dust = dust.filter(function (d) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.97; d.vy += 300 * dt; if (d.y > GY) { d.y = GY; d.vy *= -0.2; } d.r += dt * 6; return d.life > 0; });
    dust.forEach(function (d) { c.globalAlpha = Math.min(0.75, d.life * 0.6); c.fillStyle = '#b9b3c9'; c.beginPath(); c.arc(d.x, d.y, d.r, 0, 6.283); c.fill(); }); c.globalAlpha = 1;
    rocks = rocks.filter(function (r) { r.life -= dt; r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 900 * dt; r.rot += r.vr * dt; if (r.y > GY) { r.y = GY; r.vy *= -0.35; r.vx *= 0.6; r.vr *= 0.5; } return r.life > 0; });
    rocks.forEach(function (r) { c.save(); c.translate(r.x, r.y); c.rotate(r.rot); c.fillStyle = '#4a4458'; c.strokeStyle = '#141418'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-r.s, -r.s * 0.6); c.lineTo(r.s * 0.8, -r.s); c.lineTo(r.s, r.s * 0.5); c.lineTo(-r.s * 0.4, r.s); c.closePath(); c.fill(); c.stroke(); c.restore(); });
    // 닌자
    var ny, sc = 1.7, sy = 1, sxx = 1, st = 'idle', slash = null, cloudY = H * 0.46 - (t > FALL0 ? (Math.min(t, HIT) - FALL0) * H * 1.6 : 0);
    if (cloudY > -100) cloud(cx - 46, cloudY + 14, 2.1, 0.95);           // 처음 서 있던 구름
    if (t < JUMP) { ny = H * 0.46; }
    else if (t < FALL0) { var hj = (t - JUMP) / (FALL0 - JUMP); ny = H * 0.46 - Math.sin(hj * Math.PI) * 40; st = 'jump'; once('hop', function () { tone(420, 0.15, 'square', 0.04, 300); }); }
    else if (t < HIT) {
      var fp = (t - FALL0) / (HIT - FALL0); st = 'jump';
      ny = H * 0.46 + (GY - H * 0.46) * easeIn(Math.max(0, (fp - 0.55) / 0.45));
      once('whistle', function () { tone(1600, 1.5, 'sine', 0.035, -1400); });
      if (now - lastGhost > 45) { lastGhost = now; ghosts.push({ y: ny, life: 0.25 }); }
    } else {
      ny = GY;
      sy = after < 0.1 ? 0.55 : after < 0.5 ? 0.55 + 0.45 * ease((after - 0.1) / 0.4) : 1; sxx = 2 - sy;
      if (after > 1.2 && after < 1.6) { slash = (after - 1.2) / 0.4; once('pose', function () { try { E('SFX').slash(2); } catch (_) {} }); }
    }
    ghosts = ghosts.filter(function (g0) { g0.life -= dt; return g0.life > 0; });
    ghosts.forEach(function (g0) { c.save(); c.globalAlpha = g0.life * 1.6 * 0.5; try { E('drawNinja')(c, E('curLook')(), { x: cx, y: g0.y, s: sc, face: 1, st: 'jump', run: 0, t: t, idleT: t, sx: 1, sy: 1, vy: 1, lean: 0 }); } catch (_) {} c.restore(); });
    c.fillStyle = 'rgba(0,0,0,.35)'; var shadowW = t < HIT ? 24 * Math.max(0.2, 1 - (GY - ny) / H) : 26 * sxx; c.beginPath(); c.ellipse(cx, t < FALL0 ? H * 0.46 + 3 : GY + 2, shadowW, 5, 0, 0, 6.283); if (t >= FALL0) c.fill();
    try { E('drawNinja')(c, E('curLook')(), { x: cx, y: ny, s: sc, face: 1, st: st, run: 0, t: t, idleT: t, sx: sxx, sy: sy, vy: st === 'jump' ? 1 : 0, lean: 0, slash: slash, slashKind: 3 }); } catch (_) {}
    if (slash !== null && slash < 1) { c.save(); c.globalAlpha = 1 - slash; c.fillStyle = '#ffffff'; var gx = cx + 40, gyy = GY - 70; c.beginPath(); c.moveTo(gx, gyy - 16); c.lineTo(gx + 3, gyy); c.lineTo(gx, gyy + 16); c.lineTo(gx - 3, gyy); c.closePath(); c.fill(); c.beginPath(); c.moveTo(gx - 16, gyy); c.lineTo(gx, gyy - 3); c.lineTo(gx + 16, gyy); c.lineTo(gx, gyy + 3); c.closePath(); c.fill(); c.restore(); }
    // 떨어지는 대나무 잎
    leaves = leaves.filter(function (l) { l.y += l.vy * dt; l.x += (l.vx + Math.sin(t * 3 + l.ph) * 30) * dt; l.rot += dt * 3; return l.y < H + 20; });
    leaves.forEach(function (l) { c.save(); c.translate(l.x, l.y); c.rotate(l.rot); c.fillStyle = '#3f7a45'; c.beginPath(); c.ellipse(0, 0, 7, 2.5, 0, 0, 6.283); c.fill(); c.restore(); });
    // 앞쪽 큰 대나무 (화면 양 끝, 살짝 흐리게)
    bamboo(W * 0.04, gy + 40, H * 1.2, 22, '#0b111b', '#05080e', shake * Math.sin(t * 30) * 0.05, true);
    bamboo(W * 0.97, gy + 40, H * 1.1, 26, '#0b111b', '#05080e', -shake * Math.sin(t * 30 + 1) * 0.05, true);
    // 번쩍
    if (after >= 0 && after < 0.2) { c.fillStyle = 'rgba(255,255,255,' + (1 - after / 0.2) * 0.9 + ')'; c.fillRect(-40, -40, W + 80, H + 80); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 비네팅
    var vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
    // 영화처럼 위아래 검은 띠
    var lb = Math.min(ease(t / 0.6), 1 - ease((t - (END - 0.7)) / 0.6)) * H * 0.09;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, lb); c.fillRect(0, H - lb, W, lb);
    // 자막
    CAP.forEach(function (k) {
      if (t < k[0] || t > k[1]) return;
      var a = Math.min(1, (t - k[0]) / 0.25, (k[1] - t) / 0.3), big = k[3];
      c.save(); c.globalAlpha = a; c.textAlign = 'center';
      var fz = big ? Math.round(Math.min(46, W / 8.5)) : Math.round(Math.min(20, W / 18));
      c.font = (big ? '900 ' : 'bold ') + fz + 'px sans-serif';
      var yy = big ? H * 0.34 : H - lb - Math.max(18, H * 0.04) + (1 - a) * 6;
      if (big) { var pop = 1 + Math.max(0, 0.3 - (t - k[0])) * 1.8; c.translate(W / 2 + (Math.random() - 0.5) * 6 * shake, yy); c.rotate(-0.07); c.scale(pop, pop); c.translate(-W / 2, -yy); }
      c.lineWidth = big ? 10 : 4; c.strokeStyle = '#05070f'; c.strokeText(k[2], W / 2, yy);
      if (big) { var tg = c.createLinearGradient(0, yy - fz, 0, yy); tg.addColorStop(0, '#fff6b0'); tg.addColorStop(1, '#ff9a3d'); c.fillStyle = tg; } else c.fillStyle = '#f2f2f8';
      c.fillText(k[2], W / 2, yy); c.restore();
    });
    // 제목 (금빛이 스치고 지나가요)
    if (t > 5.6) {
      var tt = ease((t - 5.6) / 0.55), sc2 = 0.5 + 0.5 * tt + Math.sin(Math.min(1, (t - 5.6) / 0.55) * Math.PI) * 0.18;
      once('title', function () { tone(523, 0.15, 'square', 0.05); setTimeout(function () { tone(659, 0.15, 'square', 0.05); }, 110); setTimeout(function () { tone(1047, 0.4, 'square', 0.05); }, 220); });
      var ty0 = H * 0.24, fs = Math.round(Math.min(60, W / 6.5));
      c.save(); c.translate(W / 2, ty0); c.scale(sc2, sc2); c.globalAlpha = tt; c.textAlign = 'center';
      c.font = '900 ' + fs + 'px sans-serif'; c.lineWidth = 10; c.strokeStyle = '#05070f';
      c.strokeText('구름발', 0, 0); c.strokeText('닌자', 0, fs * 1.05);
      c.fillStyle = '#ffffff'; c.fillText('구름발', 0, 0);
      var ng = c.createLinearGradient(0, fs * 0.2, 0, fs * 1.1); ng.addColorStop(0, '#7dffb0'); ng.addColorStop(1, '#22b866'); c.fillStyle = ng; c.fillText('닌자', 0, fs * 1.05);
      var sweep = ((t - 5.8) / 0.7) * fs * 6 - fs * 3;
      if (t > 5.8 && t < 6.5) { var sh = c.createLinearGradient(sweep - 34, 0, sweep + 34, 0); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,220,.95)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = sh; c.fillText('구름발', 0, 0); c.fillText('닌자', 0, fs * 1.05); }
      c.restore();
    }
    if (t > END - 0.35) { c.fillStyle = 'rgba(0,0,0,' + Math.min(1, (t - (END - 0.35)) / 0.35) * 0.6 + ')'; c.fillRect(0, 0, W, H); }
    if (t >= END) return finish();
    raf = requestAnimationFrame(frame);
  }
  function play() {
    started = true; t0 = performance.now();
    var w = ov.querySelector('.bootWait'); if (w) w.remove();
    ov.querySelector('.bootSkip').style.display = 'block';
    raf = requestAnimationFrame(frame);
    setTimeout(finish, END * 1000 + 1500);                // 화면이 멈춰 있어도 꼭 끝나게
  }
  function finish() {
    if (done) return; done = true; cancelAnimationFrame(raf);
    if (started) { try { localStorage.setItem('cn_cut_seen', '1'); } catch (_) {} }
    ov.style.opacity = '0'; ov.style.pointerEvents = 'none';
    setTimeout(function () { if (ov) ov.remove(); removeEventListener('resize', size); }, 550);
  }
  var tStart = Date.now();
  var w8 = setInterval(function () {
    if (!ov) { if (document.body) mount(); else return; }
    var ok = false;
    try { ok = document.readyState === 'complete' && typeof E('mode') === 'string' && typeof E('drawNinja') === 'function' && !!document.getElementById('btnPlay'); } catch (_) {}
    if (ok || Date.now() - tStart > 15000) {
      clearInterval(w8); ready = true;
      var seen = false; try { seen = localStorage.getItem('cn_cut_seen') === '1'; } catch (_) {}
      if (seen) finish(); else setTimeout(play, 150);   // 컷신은 처음 한 번만 (설정에서 다시 볼 수 있어요)
    }
  }, 100);
  window.__playCutscene = function () {
    if (ov && !done) return;
    if (ov) ov.remove();
    ov = null; done = false; started = false; sfx = {}; dust = []; rocks = []; leaves = []; ghosts = [];
    mount(); play();
  };
  var hookSet = setInterval(function () {
    var f; try { f = E('openSettings'); } catch (_) {} if (typeof f !== 'function') return; clearInterval(hookSet);
    window.openSettings = function () {
      var r = f.apply(this, arguments);
      try {
        var body = document.getElementById('sheetBody'), note = body && body.querySelector('.note');
        var row = document.createElement('div'); row.className = 'tog'; row.id = 'togCut';
        row.innerHTML = '시작 컷신 다시 보기 <span style="font-size:15px;color:#2b3a6b;font-weight:bold">▶ 보기</span>';
        row.addEventListener('click', function () { try { E('SFX').click(); E('closeSheet')(); } catch (_) {} setTimeout(window.__playCutscene, 250); });
        if (note) body.insertBefore(row, note); else if (body) body.appendChild(row);
      } catch (_) {}
      return r;
    };
  }, 300);
})();
