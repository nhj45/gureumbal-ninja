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
    '#btnAdmin{display:flex;align-items:center;justify-content:center;padding:0;background:#fff3c4!important;margin-left:auto;margin-right:0}',
    '#lobby .topbar #btnSet{margin-left:auto}', '#lobby .topbar #btnAdmin + #btnSet{margin-left:8px}',
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
    x.F.getDoc(x.F.doc(x.db, 'admins', u.uid)).then(function (d) { ADMIN = d.exists() || u.email === ADMIN_EMAIL; window.__cnAdmin = ADMIN; updateAdminBtn();
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
        var stN = Math.floor(Number(v.stage) || 0);
        if (stN > 0) {                                                  // 스테이지 열어 주기
          var sv1 = g('save'), maxS = g('STAGES').length; stN = Math.min(stN, maxS);
          if (stN > (sv1.unlocked || 1)) { sv1.unlocked = stN; save2(); try { g('refreshLobby')(); } catch (_) {} }
          tellPlayer(ICON_GIFT, '관리자 선물 도착!', ['스테이지 <b>' + stN + '</b>까지 열렸어요!'].concat(v.msg ? [h(v.msg)] : []));
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
            '<input class="adm-in" id="admStage" type="number" inputmode="numeric" min="1" max="250" placeholder="스테이지 번호 (1~250)" style="flex:1 1 120px">' +
            '<button class="adm-b" data-give="stage" style="background:#2f9e5a;color:#fff">스테이지 열어 주기</button>' +
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
      '<div class="adm-row" style="margin-bottom:10px"><div class="adm-top"><div class="adm-name">내 스테이지 <b>' + Math.min((g('save').unlocked || 1), g('STAGES').length) + '</b> / ' + g('STAGES').length + '</div></div>' +
        '<div class="adm-more"><input class="adm-in" id="admMyStage" type="number" inputmode="numeric" placeholder="열 스테이지 번호" style="flex:1 1 120px"><button class="adm-b" data-mystage="1" style="background:#2f9e5a;color:#fff">열기</button><button class="adm-b" data-mystage="all" style="background:#2f9e5a;color:#fff">전부 열기</button></div></div>' +
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
      if (t.dataset.mystage) {
        var mx = g('STAGES').length, want = t.dataset.mystage === 'all' ? mx : Math.floor(Number(document.getElementById('admMyStage').value));
        if (!(want >= 1 && want <= mx)) { renderAdmin('스테이지 번호를 1 ~ ' + mx + ' 사이로 적어주세요'); return; }
        var svS = g('save'); svS.unlocked = Math.max(svS.unlocked || 1, want);
        try { g('persist')(); g('refreshLobby')(); g('SFX').buy(); } catch (_) {}
        renderAdmin('내 스테이지를 ' + svS.unlocked + '까지 열었어요');
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
        if (give === 'stage') {
          var sN = Math.floor(Number((document.getElementById('admStage') || {}).value));
          if (!(sN >= 1 && sN <= 250)) { renderAdmin('스테이지 번호를 1 ~ 250 사이로 적어주세요'); return; }
          await F.addDoc(F.collection(db, 'users', uid, 'gifts'), { coins: 0, stage: sN, msg: mtx, at: Date.now(), by: x.auth.currentUser.uid });
          admOpen = null; renderAdmin(r.nick + '에게 스테이지 ' + sN + '까지 열어 줬어요');
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
    { id: 't5', name: '하찮은 전설', price: 1000 },
    { id: 'leg', name: '전설의 닌자', price: 0, secret: true }   // 250스테이지를 다 깨면 받아요
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
    '.shp-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}',
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
  window.__cnNinjas = function () { return NINJAS; }; window.__cnPrev = function (id) { try { var v = charPreview(id); return typeof v === 'string' ? v : ''; } catch (_) { return ''; } }; window.__cnFb = function () { return fb(); }; window.__cnOwned = function (k) { return owned(k); };
  function owned(kind) { var s = S(); s.cnOwn = s.cnOwn || {}; s.cnOwn[kind] = s.cnOwn[kind] || ['basic', '']; if (kind === 'char' && ADMIN && s.cnOwn.char.indexOf('ninjo') < 0) s.cnOwn.char.push('ninjo'); return s.cnOwn[kind]; }
  function save2() { try { g('persist')(); g('refreshLobby')(); } catch (_) {} }
  var swatch = function (c) { return c === 'rainbow' ? 'conic-gradient(#ff4a4a,#ffd84a,#4fd27a,#4aa8ff,#b48cff,#ff4a4a)' : 'rgb(' + c.join(',') + ')'; };

  // 닌자 모습: 캐릭터(몸 · 머리띠 · 허리띠 색 + 이마 문양)와 허리띠 색을 그림에 직접 칠해요
  var NINJAS = [
    { id: 'basic', name: '검은 닌자', price: 0, d: '처음부터 함께한 하찮은 닌자 · 능력 없음' },
    { id: 'snow', name: '눈송이 닌자', price: 300, body: [226, 232, 244], band: [120, 190, 255], belt: [60, 120, 230], em: 'snow', d: '눈처럼 하얀 수련복 · 능력: 벽 점프가 더 높아요' },
    { id: 'fire', name: '불꽃 닌자', price: 300, body: [196, 48, 52], band: [255, 160, 60], belt: [255, 214, 70], em: 'flame', d: '성격이 급해서 늘 먼저 뛰어요 · 능력: 달리기가 15% 빨라요' },
    { id: 'wave', name: '파도 닌자', price: 400, body: [44, 96, 186], band: [110, 220, 240], belt: [240, 248, 255], em: 'drop', d: '물 위도 걸을 수 있다고 우겨요 · 능력: 점프가 더 높아요' },
    { id: 'bamboo', name: '대나무 닌자', price: 400, body: [46, 138, 74], band: [170, 230, 90], belt: [140, 90, 50], em: 'leaf', d: '대나무 숲에서 자란 닌자 · 능력: 공중에서 한 번 더 점프 (3단 점프)' },
    { id: 'bolt', name: '번개 닌자', price: 600, body: [232, 176, 32], band: [60, 60, 70], belt: [140, 80, 220], em: 'bolt', d: '대시가 제일 빠를 것 같은 느낌 · 능력: 대시가 더 빠르고 멀리' },
    { id: 'sakura', name: '벚꽃 닌자', price: 600, body: [232, 122, 168], band: [255, 246, 250], belt: [220, 50, 80], em: 'flower', d: '지나간 자리에 꽃잎이 날려요(기분상) · 능력: 근처 엽전이 끌려와요' },
    { id: 'shadow', name: '그림자 닌자', price: 900, body: [80, 52, 132], band: [190, 150, 255], belt: [255, 205, 50], em: 'moon', d: '밤에만 진지해지는 닌자 · 능력: 판마다 그림자 방패 1번' },
    { id: 'gold', name: '황금 닌자', price: 1500, body: [212, 160, 46], band: [255, 243, 176], belt: [200, 40, 50], em: 'crown', d: '엽전을 너무 많이 모아서 금이 됐어요 · 능력: 판에서 줍는 엽전 1.5배' },
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
    sprCache[key] = Promise.all(sprOrig.run.map(function (im) { return tintImg(im, L); })).then(function (run) {   // 던지기 그림에도 같은 색을 칠해요
      return Promise.all((sprOrig.thr || []).map(function (im) { return tintImg(im, L); })).then(function (thr) { run.thr = thr; return run; });
    });
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
    if (!sprOrig.thr && window.__cnThr && window.__cnThr.length === 6) { sprOrig.thr = window.__cnThr; sprCache = {}; curLookKey = ''; }   // 새 던지기 그림이 준비되면 다시 칠해요
    if (beltBusy) return;
    var s = S(), cid = s.cnChar || 'basic', bid = s.cnScarf || 'basic', rb = bid === 'rainbow';
    var key = cid + '|' + bid + (rb ? '|' + rainbowIdx : '');
    if (key === curLookKey) return;
    if (cid === 'basic' && bid === 'basic') { SP.run = sprOrig.run.slice(); if (sprOrig.thr) SP.thr = sprOrig.thr.slice(); curLookKey = key; return; }
    beltBusy = true;
    getSet(key, lookOf(cid, bid, rainbowIdx)).then(function (set) { SP.run = set; if (set.thr && set.thr.length === 6) SP.thr = set.thr; curLookKey = key; if (rb) rainbowIdx = (rainbowIdx + 1) % 12; beltBusy = false; });
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
    if (kind === 'char') return '<button class="shp-b no" disabled style="font-size:11.5px;line-height:1.15">떠돌이<br>상인에게서</button>';   // 캐릭터는 맵에 가끔 나오는 상인에게서만 사요
    var no = (S().coins || 0) < item.price ? ' no' : '';
    return '<button class="shp-b' + no + '" data-buy="' + kind + ':' + item.id + '"><i class="coin sm"></i>' + item.price + '</button>';
  }
  function openShop2(msg) {
    var s = S(), body = '';
    var tabs = [['char', '캐릭터'], ['scarf', '허리띠'], ['trail', '칼 빛'], ['tool', '부적'], ['title', '칭호'], ['statue', '동상']];
    if (shopTab2 === 'luck') shopTab2 = 'char';                // 뽑기 탭은 없앴어요
    body += '<div class="shp-tabs">' + tabs.map(function (t) { return '<button data-stab="' + t[0] + '" class="' + (shopTab2 === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (msg) body += '<div class="note" style="margin:0 0 10px;color:#2f7fd6">' + msg + '</div>';
    if (shopTab2 === 'char') {
      var oC = owned('char'), curC = s.cnChar || 'basic';
      body += '<div class="shp-list">' + NINJAS.map(function (x) {
        var own = oC.indexOf(x.id) >= 0, pv = x.id === 'basic' ? (sprOrig ? sprOrig.run[0].src : '') : charPreview(x.id);
        return '<div class="shp-it' + (curC === x.id ? ' eq' : '') + '"><img class="shp-pv" data-prev="' + x.id + '" src="' + (typeof pv === 'string' ? pv : '') + '" alt=""><div class="shp-tx"><b>' + x.name + '</b><small>' + x.d + '</small></div>' + priceBtn(x, 'char', curC === x.id, own) + '</div>';
      }).join('') + '</div><div class="shp-note">캐릭터는 스테이지에 가끔 나타나는 <b>떠돌이 상인</b>에게서만 살 수 있어요. 캐릭터마다 특수능력이 있어요. 허리띠 색을 따로 사면 그 색이 먼저 보여요.</div>';
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
      body += '<div class="shp-list">' + TITLES.filter(function (x) { return !x.secret || oTi.indexOf(x.id) >= 0; }).map(function (x) { var own = oTi.indexOf(x.id) >= 0; return '<div class="shp-it' + (curTi === x.id ? ' eq' : '') + '"><span class="shp-sw" style="background:#2b3a6b"></span><div class="shp-tx"><b>' + (x.id ? '[' + x.name + ']' : x.name) + '</b><small>랭킹에서 닉네임 앞에 붙어요</small></div>' + priceBtn(x, 'title', curTi === x.id, own) + '</div>'; }).join('') + '</div>';
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
    if (b.dataset.gacha) return;
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
      k = k || 1;                                          // 로비 닌자가 번호 없이 부르면 소리가 고장 나서 1로 맞춰요
      var r = oSlash.call(this, k);
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
    hint.innerHTML = '<b>←→</b>/<b>AD</b> 이동 · <b>Space</b> 점프 · <b>Q</b> 대시 · <b>E</b> 베기 · <b>P</b> 일시정지';
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
          e.goldPaid = true; E('bonusCoins += 3');
          E('floatText')(x, y - 44, '황금 적! +3', '#ffd84a', 18); E('sparks')(x, y, 26, '#ffd84a', 220);
          E('kick')(6, 0.05, 0.06); try { E('SFX').coin(10); } catch (_) {}
        }
        if (combo >= 3) {
          var b = combo % 5 === 0 ? 1 : 0; if (b) E('bonusCoins += 1');          // 5연속마다 엽전 1개
          E('floatText')(x, y - 62, combo + '연속 처치!' + (b ? ' +1' : ''), '#7df9ff', 14 + Math.min(combo, 8));
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
    { name: '돌', price: 2000, d: '단단한 회색 돌로 만든 동상', base: [150, 146, 138], hi: [210, 206, 198], ped: ['#b9b4aa', '#7d776d'] },
    { name: '금', price: 4000, d: '번쩍번쩍 황금 동상', base: [200, 140, 20], hi: [255, 228, 110], ped: ['#ffe27a', '#b8860b'] },
    { name: '다이아', price: 7000, d: '반짝이는 하늘빛 다이아 동상', base: [110, 190, 235], hi: [235, 250, 255], ped: ['#d8f4ff', '#6fb6d8'] },
    { name: '에메랄드', price: 10000, d: '깊은 초록빛 에메랄드 동상', base: [20, 140, 80], hi: [140, 240, 170], ped: ['#8fe8b0', '#1f7a4a'] },
    { name: '루비', price: 15000, d: '타오르는 붉은 루비 동상 (최고 등급)', base: [160, 20, 45], hi: [255, 120, 140], ped: ['#ff9aaa', '#8a1a2e'] }
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
    ov.innerHTML = '<div class="bzTop"><div class="bzPill">번 엽전 <b id="bzEarn">0</b></div><div class="bzPill">처치 <b id="bzKill">0</b></div><div class="bzPill">지갑 <b id="bzWallet">0</b></div><button class="bzX">' + window.__cnI('x') + '</button></div>' +
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
    row.innerHTML = '<button class="mid" id="btnBz"><span class="lbl">광전사 사냥터 (자동 사냥)</span></button>';
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
    '#bootOv .bootTap{font-size:17px;font-weight:bold;animation:bootP 1s ease-in-out infinite}@keyframes bootP{0%,100%{opacity:.45}50%{opacity:1}}' +
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
  // ── 컷신 전용 소리 (게임 소리 설정을 따라요) ──
  var A = null, MG = null, windN = null, windF = null, windG = null;
  function sfxOn() { try { return E('save').sfx !== false; } catch (_) { return true; } }
  function audio() {
    if (!A) { try { A = new (window.AudioContext || window.webkitAudioContext)(); MG = A.createGain(); MG.gain.value = 0.9; MG.connect(A.destination); } catch (_) { A = null; } }
    if (A && A.state === 'suspended') A.resume().catch(function () {});
    return A;
  }
  function tone(f, d, ty, v, sl, dl) {
    if (!A || !sfxOn()) return; var t = A.currentTime + (dl || 0), o = A.createOscillator(), g = A.createGain();
    o.type = ty || 'triangle'; o.frequency.setValueAtTime(f, t); if (sl) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + sl), t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(MG); o.start(t); o.stop(t + d + 0.05);
  }
  function nbuf(d) { var n = Math.max(1, Math.floor(A.sampleRate * d)), b = A.createBuffer(1, n, A.sampleRate), x = b.getChannelData(0); for (var i = 0; i < n; i++) x[i] = Math.random() * 2 - 1; return b; }
  function hiss(d, v, type, f0, f1, dl) {
    if (!A || !sfxOn()) return; var t = A.currentTime + (dl || 0), s0 = A.createBufferSource(), fl = A.createBiquadFilter(), g = A.createGain();
    s0.buffer = nbuf(d); fl.type = type || 'bandpass'; fl.frequency.setValueAtTime(f0, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + d); fl.Q.value = 0.9;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.05, d * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s0.connect(fl); fl.connect(g); g.connect(MG); s0.start(t); s0.stop(t + d + 0.05);
  }
  function flute(f, d, dl) {                                // 피리 같은 소리 (떨림 포함)
    if (!A || !sfxOn()) return; var t = A.currentTime + (dl || 0), o = A.createOscillator(), lfo = A.createOscillator(), lg = A.createGain(), g = A.createGain();
    o.type = 'sine'; o.frequency.value = f; lfo.frequency.value = 5.5; lg.gain.value = f * 0.012; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.06); g.gain.setValueAtTime(0.07, t + d * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(MG); o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    hiss(d * 0.6, 0.008, 'highpass', 3000, 0, dl);
  }
  function taiko(dl, v) { tone(95, 0.5, 'sine', v || 0.35, -55, dl); hiss(0.12, 0.12, 'lowpass', 900, 200, dl); }
  function gong(dl) { [196, 247.5, 294, 392.5, 523].forEach(function (f, i) { tone(f * (1 + (i % 2) * 0.003), 2.4 - i * 0.25, 'sine', 0.05 - i * 0.006, 0, dl); }); }
  function windStart() {
    if (!A || !sfxOn() || windN) return;
    windN = A.createBufferSource(); windN.buffer = nbuf(2); windN.loop = true; windF = A.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 400; windF.Q.value = 0.6;
    windG = A.createGain(); windG.gain.value = 0.0001; windN.connect(windF); windF.connect(windG); windG.connect(MG); windN.start();
    windG.gain.exponentialRampToValueAtTime(0.035, A.currentTime + 0.8);
  }
  function windSet(v, f) { if (!windG) return; var t = A.currentTime; windG.gain.setTargetAtTime(Math.max(0.0001, v), t, 0.08); windF.frequency.setTargetAtTime(f, t, 0.1); }
  function windStop() { if (!windN) return; try { windG.gain.setTargetAtTime(0.0001, A.currentTime, 0.15); var w0 = windN; setTimeout(function () { try { w0.stop(); } catch (_) {} }, 800); } catch (_) {} windN = null; windG = null; }
  function bgmPause() { try { E('bgm').pause(); } catch (_) {} }
  function bgmResume() { try { if (E('save').bgm && !document.hidden) E('bgm').play().catch(function () {}); } catch (_) {} }
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
    tone(80, 1.4, 'sine', 0.55, -50); tone(46, 1.8, 'sine', 0.45, -14); tone(140, 0.35, 'square', 0.07, -100);
    hiss(0.5, 0.45, 'lowpass', 2200, 120); hiss(1.6, 0.12, 'lowpass', 300, 60, 0.15);
    for (var i = 0; i < 10; i++) hiss(0.04, 0.08, 'highpass', 2500 + Math.random() * 2000, 0, 0.15 + Math.random() * 0.9);
    windStop();
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
    once('intro', function () { windStart(); taiko(0.05, 0.22); [[440, 0.35, 0.2], [523, 0.3, 0.55], [587, 0.3, 0.85], [659, 0.6, 1.15]].forEach(function (n) { flute(n[0], n[1] + 0.25, n[2]); }); });
    if (t > HIT + 0.3) once('after', function () { flute(659, 0.5, 1.0); flute(784, 0.5, 1.35); flute(880, 0.9, 1.7); });
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
    else if (t < FALL0) { var hj = (t - JUMP) / (FALL0 - JUMP); ny = H * 0.46 - Math.sin(hj * Math.PI) * 40; st = 'jump'; once('hop', function () { tone(520, 0.14, 'triangle', 0.08, 380); hiss(0.25, 0.05, 'bandpass', 900, 2500); }); }
    else if (t < HIT) {
      var fp = (t - FALL0) / (HIT - FALL0); st = 'jump';
      ny = H * 0.46 + (GY - H * 0.46) * easeIn(Math.max(0, (fp - 0.55) / 0.45));
      once('whistle', function () { tone(1700, 1.6, 'sine', 0.03, -1450); hiss(1.65, 0.12, 'bandpass', 500, 3500); });
      windSet(0.03 + 0.12 * fp, 400 + 2200 * fp);
      if (now - lastGhost > 45) { lastGhost = now; ghosts.push({ y: ny, life: 0.25 }); }
    } else {
      ny = GY;
      sy = after < 0.1 ? 0.55 : after < 0.5 ? 0.55 + 0.45 * ease((after - 0.1) / 0.4) : 1; sxx = 2 - sy;
      if (after > 1.2 && after < 1.6) { slash = (after - 1.2) / 0.4; once('pose', function () { hiss(0.22, 0.14, 'bandpass', 1500, 6000); tone(2600, 0.6, 'triangle', 0.035, 0, 0.05); tone(3900, 0.5, 'sine', 0.02, 0, 0.06); }); }
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
      once('title', function () { taiko(0, 0.3); taiko(0.16, 0.3); taiko(0.32, 0.45); gong(0.32); [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.35, 'triangle', 0.05, 0, 0.36 + i * 0.07); }); });
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
    started = true; t0 = performance.now(); audio(); bgmPause();
    var w = ov.querySelector('.bootWait'); if (w) w.remove();
    ov.querySelector('.bootSkip').style.display = 'block';
    raf = requestAnimationFrame(frame);
    setTimeout(finish, END * 1000 + 1500);                // 화면이 멈춰 있어도 꼭 끝나게
  }
  function finish() {
    if (done) return; done = true; cancelAnimationFrame(raf);
    if (started) { try { localStorage.setItem('cn_cut_seen', '1'); } catch (_) {} windStop(); bgmResume(); }
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
      if (seen) finish(); else askTap();                 // 컷신은 처음 한 번만 (설정에서 다시 볼 수 있어요)
    }
  }, 100);
  // 소리는 화면을 한 번 눌러야 나올 수 있어서, 처음엔 "눌러서 시작"을 보여 줘요
  function askTap() {
    var w = ov.querySelector('.bootWait'); if (w) { w.innerHTML = '<div style="font-size:30px;font-weight:900;margin-bottom:10px">구름발 <span style="color:#3ddc84">닌자</span></div><div class="bootTap">화면을 눌러 시작 ▶</div>'; }
    var go = function (e) {
      if (started || done) return; if (e && e.type === 'keydown') { e.stopPropagation(); e.preventDefault(); }
      ov.removeEventListener('pointerdown', go); removeEventListener('keydown', go, true);
      audio(); try { E('unlockAudio')(); } catch (_) {} bgmPause();
      play();
    };
    ov.addEventListener('pointerdown', go); addEventListener('keydown', go, true);
  }
  window.__playCutscene = function () {
    if (ov && !done) return;
    if (ov) ov.remove();
    ov = null; done = false; started = false; sfx = {}; dust = []; rocks = []; leaves = []; ghosts = [];
    mount(); audio(); play();
  };
  var hookSet = setInterval(function () {
    var f; try { f = E('openSettings'); } catch (_) {} if (typeof f !== 'function') return; clearInterval(hookSet);
    window.openSettings = function () {
      var r = f.apply(this, arguments);
      try {
        var body = document.getElementById('sheetBody'), note = body && body.querySelector('.note');
        var row = document.createElement('div'); row.className = 'tog'; row.id = 'togCut';
        row.innerHTML = '시작 컷신 다시 보기 <span style="font-size:15px;color:#2b3a6b;font-weight:bold">▶ 보기</span>';
        row.addEventListener('click', function () { try { E('SFX').click(); E('closeSheet')(); } catch (_) {} audio(); setTimeout(window.__playCutscene, 250); });
        if (note) body.insertBefore(row, note); else if (body) body.appendChild(row);
        if (note) note.innerHTML = note.innerHTML.replace('X 대시 · C 베기', 'Q 대시 · E 베기');
      } catch (_) {}
      return r;
    };
  }, 300);
})();

// ── 안전장치: 한 번의 오류로 게임 화면 전체가 멈추지 않게 해요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var NAMES = ['step', 'renderLobby', 'renderGame', 'drawIris', 'drawShopPreviews'], wrapped = {}, errN = 0;
  function guard(name) {
    var f; try { f = E(name); } catch (_) { return; }
    if (typeof f !== 'function' || f.__safe) return;
    var g = function () { try { return f.apply(this, arguments); } catch (e) { if (errN++ < 5 && window.console) console.warn('[안전장치] ' + name + ' 오류를 건너뛰었어요:', e); } };
    g.__safe = true; window[name] = g;
  }
  // 소리 함수에 이상한 숫자가 들어오면 조용히 무시해요
  function guardSound(name) {
    var f; try { f = E(name); } catch (_) { return; }
    if (typeof f !== 'function' || f.__safe) return;
    var g = function () { for (var i = 0; i < arguments.length; i++) if (typeof arguments[i] === 'number' && !isFinite(arguments[i])) return; try { return f.apply(this, arguments); } catch (_) {} };
    g.__safe = true; window[name] = g;
  }
  setInterval(function () {                              // 다른 기능이 나중에 감싸도 계속 바깥쪽에 있게 확인해요
    NAMES.forEach(guard); ['tone', 'noise', 'swoosh', 'ring2'].forEach(guardSound);
    // 화면 전환(iris)이 1.5초 넘게 멈춰 있으면 풀어 줘요
    try {
      var ir = E('iris');
      if (ir && ir.hold) { if (!wrapped.holdAt) wrapped.holdAt = Date.now(); else if (Date.now() - wrapped.holdAt > 1500) { E('iris = null'); wrapped.holdAt = 0; } }
      else wrapped.holdAt = 0;
    } catch (_) {}
  }, 500);
})();

// ── PC 키: Q 대시, E 베기 / 최고 기록 그림자(뛰어다니는 닌자) 끄기 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var hook = setInterval(function () {
    var K, st; try { K = E('KEYS'); st = E('startStage'); } catch (_) { return; }
    if (!K || typeof st !== 'function') return; clearInterval(hook);
    K.KeyQ = 'd'; K.KeyE = 's';                           // 예전 키(Shift·X, C)도 그대로 돼요
    window.startStage = function () {
      var r = st.apply(this, arguments);
      try { E('ghost = null'); } catch (_) {}            // 최고 기록 따라 뛰는 반투명 닌자는 안 보여요
      return r;
    };
  }, 300);
})();

// ── 맵의 유령 몬스터 없애기 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  function clean() {
    try { var en = E('enemies'); if (en) for (var i = en.length - 1; i >= 0; i--) if (en[i] && en[i].k === 'ghost') en.splice(i, 1); } catch (_) {}
  }
  var hook = setInterval(function () {
    var f; try { f = E('loadStage'); } catch (_) { return; } if (typeof f !== 'function') return; clearInterval(hook);
    window.loadStage = function () { var r = f.apply(this, arguments); clean(); return r; };
  }, 300);
  (function tick() { clean(); requestAnimationFrame(tick); })();   // 무한의 탑처럼 나중에 생기는 것도 바로 지워요
})();

// ── 스테이지 250개: 6번부터는 번호마다 다른 맵과 장애물을 만들어요 (같은 번호는 늘 같은 맵) ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var MAX = 250, THEME_KEYS = ['bamboo', 'roof', 'fall', 'castle', 'summit'];
  var PLACE = { bamboo: ['대숲', '죽림', '대나무 길', '푸른 숲'], roof: ['기와 마을', '지붕길', '처마 거리', '저잣거리'], fall: ['폭포', '절벽', '물안개 계곡', '통나무 다리'], castle: ['성벽', '망루', '달빛 성채', '돌계단'], summit: ['봉우리', '구름길', '하늘 정상', '바람 고개'] };
  var ADJ = ['고요한', '바람 부는', '안개 낀', '달빛', '비 내리는', '붉은', '깊은', '험한', '얼어붙은', '타오르는', '잊혀진', '흔들리는', '어두운', '반짝이는', '끝없는'];
  var FEAT = { spring: '스프링', move: '움직이는 발판', wall: '벽 타기', lift: '오르내리는 발판', crumble: '무너지는 발판', spike: '가시', enemy: '몬스터', fly: '까마귀' };
  function rng(seed) { var s = (seed >>> 0) || 7; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function profile(idx) {
    var R = rng(idx * 2654435761 ^ 0x5bd1e995), d = Math.min(1, (idx - 5) / 600) * 0.85;   // 300스테이지까지 3시간쯤 걸리도록 천천히 어려워져요
    var w = { spring: 0.02 + R() * 0.08, move: R() * 0.14, wall: R() * 0.12, lift: R() * 0.1, crumble: (0.04 + R() * 0.25) * (0.35 + d), spike: R() < 0.3 ? 0 : (0.04 + R() * 0.18) * (0.3 + d), enemy: (0.06 + R() * 0.22) * (0.5 + d), fly: R() < 0.35 ? 0 : R() * 0.15 * (0.3 + d) };
    // 판마다 '주인공 장애물'을 하나 정해서 그 장애물이 잔뜩 나오게 해요
    var ARCH = ['stairs', 'spring', 'move', 'wall', 'lift', 'crumble', 'spike', 'enemy', 'fly'], arch = ARCH[Math.floor(R() * ARCH.length)];
    if (arch === 'stairs') { Object.keys(w).forEach(function (k) { w[k] *= 0.3; }); }
    else { Object.keys(w).forEach(function (k) { if (k !== arch) w[k] *= 0.55; }); w[arch] = Math.max(w[arch], 0.28 + R() * 0.14); }
    var MODS = ['night', 'wind', 'lowgrav', 'rain', 'snow', 'fog', 'timer', 'gold', 'none', 'none', 'none'];
    var mod = idx % 25 === 24 ? 'none' : MODS[Math.floor(R() * MODS.length)];
    var keys = Object.keys(w).sort(function (a, b) { return w[b] - w[a]; });
    return { R: R, d: d, w: w, top: keys.slice(0, 3), arch: arch, mod: mod, hue: Math.floor(R() * 360), theme: THEME_KEYS[Math.floor(R() * 5)] , adj: ADJ[Math.floor(R() * ADJ.length)], boss: idx % 25 === 24 };
  }
  function genStage(idx) {
    var pf = profile(idx), R = pf.R, d = pf.d, w = pf.w;
    var N = 45 + Math.floor(idx * 0.18) + Math.floor(R() * 8), rows = [], i, k;   // 6번 ≈ 46줄, 300번 ≈ 100줄
    for (i = 0; i < N; i++) rows.push(('#' + '..........' + '#').split(''));
    rows[0] = '############'.split('');
    var set = function (r, c, ch) { if (r > 0 && r < N && c >= 1 && c <= 10) rows[r][c] = ch; };
    var free = function (r, c) { return r > 0 && r < N && c >= 1 && c <= 10 && rows[r][c] === '.'; };
    set(1, 3, 'P'); set(1, 6, 'o'); set(1, 8, 'o');
    var justSpike = false, y = 0, L = 1, Rr = 10, lastCP = 0, top = pf.boss ? N - 14 : N - 6;
    var scrollAt = [Math.floor(top * 0.3), Math.floor(top * 0.6), Math.floor(top * 0.88)], sIdx = 0;
    while (y < top - 5) {
      var r = R(), acc = 0, wasSpike = justSpike; justSpike = false;
      if (y > 8 && r < (acc += w.spring)) {
        var c0 = Math.max(1, Math.min(10, L + Math.floor(R() * (Rr - L + 1))));
        set(y + 3, c0, 'T'); for (k = 2; k <= 6; k += 2) set(y + 3 + k, c0, 'o');
        var st0 = Math.max(1, Math.min(8, c0 - 1)); for (k = 0; k < 3; k++) set(y + 12, st0 + k, '=');
        L = st0; Rr = st0 + 2; y += 12; continue;
      }
      if (y > 12 && r < (acc += w.move)) { set(y + 3, 1 + Math.floor(R() * 8), 'M'); if (R() < 0.7) set(y + 5, 1 + Math.floor(R() * 10), 'o'); L = 1; Rr = 10; y += 3; continue; }
      if (y > 16 && r < (acc += w.wall) && L <= 5 && !wasSpike) {   // 가시 바닥 바로 뒤에는 벽 타기 구간을 두지 않아요 (빠져나갈 길이 막혀요)
        for (k = 1; k <= 3; k++) set(y + 3, k, '=');
        for (k = 1; k <= 9; k++) set(y + 3 + k, 3, '#');
        set(y + 6, 1, 'o'); set(y + 9, 2, 'o');
        for (k = 1; k <= 4; k++) set(y + 13, k, '=');
        L = 1; Rr = 4; y += 13; continue;
      }
      if (y > 20 && r < (acc += w.lift)) {
        var c1 = Math.max(1, Math.min(9, L + Math.floor(R() * Math.max(1, Rr - L))));
        set(y + 3, c1, 'N'); set(y + 5, c1, 'o');
        var st1 = Math.max(1, Math.min(8, c1 + (R() < 0.5 ? -3 : 2))); for (k = 0; k < 3; k++) set(y + 9, st1 + k, '=');
        L = st1; Rr = st1 + 2; y += 9; continue;
      }
      if (y > 10 && r < (acc += w.spike) && (L - 1 >= 4 || Rr <= 6)) {   // 가시 바닥: 벽 쪽은 가시, 안쪽 끝만 안전해요
        var safe = d > 0.75 ? 2 : 3, ny2 = y + 3, a0, a1, s0;
        if (L - 1 >= 4) { a0 = 1; a1 = Math.min(L - 1, 7); s0 = a1 - safe + 1; }      // 왼쪽 벽에 붙은 가시 바닥 (안전한 칸은 오른쪽 끝)
        else { a0 = Math.max(Rr + 1, 4); a1 = 10; s0 = a0; }                              // 오른쪽 벽에 붙은 가시 바닥 (안전한 칸은 왼쪽 끝)
        for (k = a0; k <= a1; k++) { set(ny2, k, '#'); if (k < s0 || k >= s0 + safe) set(ny2 + 1, k, '^'); }
        if (free(ny2 + 1, s0)) set(ny2 + 1, s0, 'o');
        L = s0; Rr = s0 + safe - 1; y = ny2; justSpike = true; continue;
      }
      var len = 2 + Math.floor(R() * (3 - Math.round(d * 0.8)));
      var gap = R() < 0.12 + 0.28 * d ? 4 : 3, ny = y + gap;
      var minS = Math.max(1, L - 2 - len + 1), maxS = Math.min(10 - len + 1, Rr + 3);
      var st = minS + Math.floor(R() * (maxS - minS + 1));
      var ch = R() < w.crumble ? 'X' : '=';
      for (k = 0; k < len; k++) set(ny, st + k, ch);
      if (ch === '=' && len >= 3 && R() < w.enemy) set(ny + 1, st + 1, 'EKQ'[Math.floor(R() * 3)]);
      if (R() < (pf.mod === 'gold' ? 1 : 0.6)) { for (var cn = 0; cn < (pf.mod === 'gold' ? len : 1); cn++) { var cc = pf.mod === 'gold' ? st + cn : st + Math.floor(R() * len); if (free(ny + 1, cc)) set(ny + 1, cc, 'o'); } }
      if (y > 14 && R() < w.fly) { var cf = 1 + Math.floor(R() * 9); if (free(ny - 1, cf)) set(ny - 1, cf, 'B'); }
      if (R() < 0.04) { var cu = st + Math.floor(R() * len); if (free(ny + 2, cu)) set(ny + 2, cu, 'UHF'[Math.floor(R() * 3)]); }
      if (ch === '=' && ny - lastCP > 26 && len >= 2) { var ccp = st + Math.floor(len / 2); if (free(ny + 1, ccp)) { set(ny + 1, ccp, 'C'); lastCP = ny; } }
      while (sIdx < 3 && ny >= scrollAt[sIdx]) { var cs = st + Math.floor(R() * len); if (free(ny + 1, cs)) set(ny + 1, cs, 'S'); else if (free(ny + 2, cs)) set(ny + 2, cs, 'S'); sIdx++; }
      L = st; Rr = st + len - 1; y = ny;
    }
    while (rows.length < y + 16) rows.push(('#' + '..........' + '#').split(''));
    N = rows.length;
    sIdx = 0; for (var ry = 0; ry < rows.length; ry++) for (var rx = 1; rx <= 10; rx++) if (rows[ry][rx] === 'S') sIdx++;   // 덮어써진 두루마리가 있으면 채워요
    for (var sy = y + 1; sy <= y + 2 && sIdx < 3; sy++) for (var sc = 1; sc <= 10 && sIdx < 3; sc++) if (free(sy, sc) && (sc + sy) % 3 === 0) { set(sy, sc, 'S'); sIdx++; }
    if (pf.boss) {                                          // 25번째마다 보스 방
      var b0 = y + 3; for (k = 1; k <= 10; k++) set(b0, k, '=');
      set(b0 + 1, 6, 'Z'); set(b0 + 6, 1, '='); set(b0 + 6, 2, '='); set(b0 + 6, 9, '='); set(b0 + 6, 10, '=');
      rows = rows.slice(0, b0 + 11); rows.push('############'.split(''));
    } else {
      var g0 = y + 3; for (k = 1; k <= 10; k++) set(g0, k, '='); set(g0 + 1, 6, 'G');
      rows = rows.slice(0, g0 + 4); rows.push('############'.split(''));
    }
    return rows.map(function (rw) { return rw.join(''); });
  }
  window.__genStage = genStage;
  var hook = setInterval(function () {
    var S; try { S = E('STAGES'); } catch (_) { return; } if (!S || !S.length) return; clearInterval(hook);
    for (var i = S.length; i < MAX; i++) (function (idx) {
      var pf = profile(idx), place = PLACE[pf.theme][Math.floor(pf.R() * 4)], cache = null;
      var MODN = { night: '깜깜한 밤', wind: '거센 바람', lowgrav: '달 중력', rain: '비', snow: '눈', fog: '짙은 안개', timer: '시간 제한', gold: '엽전 비' };
      var main = pf.arch === 'stairs' ? '발판 오르기' : FEAT[pf.arch] + ' 투성이';
      var o = { name: pf.adj + ' ' + place, sub: (pf.boss ? '보스 · ' : '') + (MODN[pf.mod] ? '[' + MODN[pf.mod] + '] ' : '') + main, theme: pf.theme, hints: [], mod: pf.mod, hue: pf.hue };
      Object.defineProperty(o, 'map', { get: function () { if (!cache) cache = genStage(idx); return cache; }, enumerable: true });
      S.push(o);
    })(i);
  }, 200);

  // 스테이지 목록: 50개씩 나눠서 보여 줘요
  var page = -1;
  function openStagesPaged(pg) {
    var S = E('STAGES'), save = E('save'), RANKS = E('RANKS'), BG = E('THEME_BG'), ic = E('ic'), fmtTime = E('fmtTime');
    var per = 50, pages = Math.ceil(S.length / per);
    if (pg == null || pg < 0) pg = Math.min(pages - 1, Math.floor(Math.max(0, (save.unlocked || 1) - 1) / per));
    page = pg;
    var nav = '<div class="shp-tabs" style="grid-template-columns:repeat(5,1fr);margin-bottom:10px">';
    for (var p0 = 0; p0 < pages; p0++) nav += '<button data-spg="' + p0 + '" class="' + (p0 === pg ? 'on' : '') + '">' + (p0 * per + 1) + '~</button>';
    nav += '</div>';
    var html = '<div class="note" style="margin:0 0 8px">열린 스테이지 ' + Math.min(save.unlocked || 1, S.length) + ' / ' + S.length + '</div>' + nav;
    for (var i = pg * per; i < Math.min(S.length, (pg + 1) * per); i++) {
      var s = S[i], locked = i + 1 > save.unlocked, b = save.best['s' + i];
      var RK = b && (RANKS[b.rank] || RANKS[RANKS.length - 1] || { c: '#7b8494', n: '-' });   // 기록이 이상해도 목록이 멈추지 않게
      var right = locked ? ic('lock') : b ? '<b style="color:' + (RK.c === '#7b8494' ? '#fff' : '#fff3a0') + '">' + RK.n + '</b>' + fmtTime(b.time || 0) + ' · ' + window.__cnI('scroll') + (b.scrolls || 0) + '/3' : '<b>NEW</b>도전!';
      html += '<div class="st' + (locked ? ' locked' : '') + '" data-i="' + i + '" style="background:' + BG[s.theme] + '"><div class="no">' + (i + 1) + '</div><div><div class="nm">' + s.name + '</div><div class="sb">' + s.sub + '</div></div><div class="rk">' + right + '</div></div>';
    }
    E('openSheet')(ic('scroll') + '스테이지', html);
    var body = document.getElementById('sheetBody');
    body.querySelectorAll('[data-spg]').forEach(function (el) { el.addEventListener('click', function () { try { E('SFX').click(); } catch (_) {} openStagesPaged(+el.dataset.spg); }); });
    body.querySelectorAll('.st').forEach(function (el) {
      el.addEventListener('click', function () {
        var i2 = +el.dataset.i;
        if (i2 + 1 > E('save').unlocked) { try { E('SFX').nope(); } catch (_) {} el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
        try { E('SFX').click(); } catch (_) {} E('closeSheet')(); E('goStage')(i2);
      });
    });
    var cur = body.querySelector('.st[data-i="' + Math.max(0, Math.min(S.length, save.unlocked) - 1) + '"]'); if (cur) setTimeout(function () { cur.scrollIntoView({ block: 'center' }); }, 50);
  }
  var hook2 = setInterval(function () {
    var f; try { f = E('openStages'); } catch (_) { return; } if (typeof f !== 'function') return; clearInterval(hook2);
    window.openStages = function () { openStagesPaged(-1); };
  }, 300);

  // 랭킹: 무한의 탑만 보여 줘요
  var hook3 = setInterval(function () {
    var f; try { f = E('openRank'); } catch (_) { return; } if (typeof f !== 'function') return; clearInterval(hook3);
    window.openRank = async function () {
      var ic = E('ic'), esc = E('esc');
      E('openSheet')(ic('rank') + '랭킹 · 무한의 탑', '<div class="note">불러오는 중…</div>');
      try {
        var r = await E('api')('GET', '/api/rank?board=tower');
        var list = r.list.length ? r.list.map(function (d, i) { return '<div class="rk-row' + (d.me ? ' me' : '') + '"><span class="rk-n">' + (i < 3 ? ic('medal' + (i + 1)) : i + 1) + '</span><span class="rk-nick">' + esc(d.nick) + '</span><span class="rk-v">' + d.v + 'm</span></div>'; }).join('') : '<div class="note">아직 기록이 없어요. 첫 번째 주인공이 되어보세요!</div>';
        document.getElementById('sheetBody').innerHTML = '<div class="rk">' + list + '</div>';
      } catch (e) { document.getElementById('sheetBody').innerHTML = '<div class="note">' + esc((e && e.msg) || '랭킹을 불러오지 못했어요') + '</div>'; }
    };
  }, 300);
})();

// ── 난이도 조금 낮추기: 스프링이 더 높이 튀고, 스프링 가는 길에 디딤판을 놓아요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var hook = setInterval(function () {
    var S, ds; try { S = E('STAGES'); ds = E('doSpring'); } catch (_) { return; }
    if (!S || S.length < 5 || typeof ds !== 'function') return; clearInterval(hook);
    function put(si, r, c, ch) { var m = S[si].map; if (m[r] && m[r][c] === '.') m[r] = m[r].slice(0, c) + ch + m[r].slice(c + 1); }
    put(1, 23, 4, '='); put(1, 23, 5, '=');                 // 2스테이지: 스프링 가기 전 디딤판
    put(2, 41, 3, '='); put(2, 41, 4, '=');                 // 3스테이지: 스프링 가기 전 디딤판
    put(3, 40, 7, '='); put(3, 40, 8, '=');                 // 4스테이지: 높은 구간 사이 디딤판
    put(3, 49, 6, '='); put(3, 49, 7, '=');
    put(4, 27, 6, '=');                                     // 5스테이지: 스프링 옆 디딤판
    window.doSpring = function (p) {
      var r = ds.apply(this, arguments);
      try { if (p && p.vy < 0) p.vy *= 1.15; } catch (_) {}  // 스프링 점프 15% 더 높게
      return r;
    };
  }, 200);
})();

// ── 엽전 덜 벌리게: 스테이지 · 무한의 탑에서 받는 엽전을 40%로 줄여요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var RATE = 0.4, depth = 0, pending = null;
  function wrapModal() {                                      // 결과 창이 나중에 열려도 줄어든 엽전 수로 보여요
    var f; try { f = E('openModal'); } catch (_) { return; } if (typeof f !== 'function' || f.__cut) return;
    var g = function (html) {
      if (pending && Date.now() - pending.at < 8000 && typeof html === 'string' && html.indexOf('earn') >= 0) {
        html = html.replace(/(class="earn"[^>]*>[\s\S]*?\+\s*)\d+/, '$1' + pending.keep); pending = null;
      }
      return f.call(this, html);
    };
    g.__cut = true; window.openModal = g;
  }
  function wrap(name) {
    var f; try { f = E(name); } catch (_) { return; } if (typeof f !== 'function' || f.__cut) return;
    var g = function () {
      var sv = E('save'), before = sv.coins || 0, outer = depth === 0, r;
      depth++;
      try { r = f.apply(this, arguments); } finally { depth--; }
      if (!outer) return r;                                  // 여러 번 감싸져도 한 번만 줄여요
      try {
        var got = (sv.coins || 0) - before;
        if (got > 0) {
          var keep = Math.max(1, Math.round(got * RATE)); sv.coins = before + keep;
          try { E('persist')(); E('refreshLobby')(); } catch (_) {}
          pending = { keep: keep, at: Date.now() };
          setTimeout(function () { var el = document.querySelector('#modal .earn'); if (el && pending) el.innerHTML = el.innerHTML.replace(/\+\s*\d+/, '+' + keep); }, 0);
        }
      } catch (_) {}
      return r;
    };
    g.__cut = true; window[name] = g;
  }
  setInterval(function () { wrap('clearStage'); wrap('towerOver'); wrapModal(); }, 1000);   // 다른 기능이 나중에 감싸도 맨 바깥에서 줄여요
})();

// ── 보스전 목숨 3개: 보스와 싸우는 중에 3번 쓰러지면 처음부터 다시 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var MAX = 3, lives = MAX, over = false, el = null;
  function fight() { try { var b = E('boss'); return !!(b && !b.dead && b.active); } catch (_) { return false; } }
  function hud() {
    if (!document.body) return;
    if (el && !el.isConnected) el = null;
    if (!el) { el = document.createElement('div'); el.id = 'bossLives'; el.style.cssText = 'position:absolute;left:50%;top:calc(130px + env(safe-area-inset-top));transform:translateX(-50%);z-index:4;pointer-events:none;font:bold 14px sans-serif;color:#fff;background:rgba(10,12,24,.55);padding:4px 12px;border-radius:14px;white-space:nowrap;display:none'; (document.getElementById('wrap') || document.body).appendChild(el); }
    var on = fight() && E('mode') === 'play';
    el.style.display = on ? 'block' : 'none';
    if (on) { var h = ''; for (var i = 0; i < MAX; i++) h += window.__cnI(i < lives ? 'heart' : 'heartOff'); el.innerHTML = '목숨 ' + h; }
  }
  function gameOver() {
    try {
      E("mode = 'clear'"); E('show')('ctrl', false); E('show')('pauseBtn', false);
      var ic = E('ic'), S = E('STAGES'), i = E('stageIdx');
      E('openModal')('<div class="msub" style="margin:0">STAGE ' + (i + 1) + ' · ' + S[i].name + '</div>' +
        '<div class="rank" style="color:#ff6b6b">실패</div><div class="msub">보스전에서 목숨 3개를 모두 잃었어요. 처음부터 다시 도전해요!</div>' +
        '<div class="row2"><button class="go alt" data-act="retry">' + ic('retry') + '다시</button><button class="go ghost" data-act="lobby">' + ic('home') + '로비</button></div>');
    } catch (_) {}
  }
  var hook = setInterval(function () {
    var die, rs, rb, st; try { die = E('die'); rs = E('doRespawn'); rb = E('resetBoss'); st = E('startStage'); } catch (_) { return; }
    if ([die, rs, rb, st].some(function (f) { return typeof f !== 'function'; })) return; clearInterval(hook);
    window.startStage = function () { lives = MAX; over = false; return st.apply(this, arguments); };
    window.die = function () {
      var p = E('P'), was = !p || p.dead, inFight = fight();
      var r = die.apply(this, arguments);
      try {
        var p2 = E('P');
        if (!was && p2 && p2.dead && inFight && !over) {
          lives--;
          E('floatText')(p2.x + p2.w / 2, p2.y - 40, lives > 0 ? '목숨 -1 (남은 목숨 ' + lives + ')' : '목숨을 다 썼어요!', '#ff8a8a', 16);
          if (lives <= 0) { over = true; setTimeout(gameOver, 1000); }
        }
      } catch (_) {}
      return r;
    };
    window.doRespawn = function () { if (over) return; return rs.apply(this, arguments); };   // 목숨이 다 떨어지면 다시 살아나지 않아요
    window.resetBoss = function () { if (!over && lives > 0 && lives < MAX) return; return rb.apply(this, arguments); };   // 목숨이 남아 있으면 보스 체력은 그대로
  }, 300);
  (function tick() { try { hud(); } catch (_) {} requestAnimationFrame(tick); })();
})();

// ── 판마다 다른 느낌: 날씨·규칙(밤, 바람, 달 중력, 비, 눈, 안개, 시간 제한)과 색감 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var cur = null, t0 = 0, wind = 0, windT = 0, drops = [], timeLeft = 0, timerOver = false, last = 0;
  function S() { try { var i = E('stageIdx'), st = E('STAGES')[i]; return (!E('ENDLESS') && st && i >= 5) ? st : null; } catch (_) { return null; } }
  function toScreen(x, y) { var W = E('W'), vH = E('viewH'), cam = E('cam'), z = 1 + (E('zoomP') || 0); return [(x - W / 2) * z + W / 2, (y - vH * 0.5 - cam) * z + vH * 0.5]; }
  var LABEL = { night: '깜깜한 밤 · 내 주변만 보여요', wind: '거센 바람 · 바람에 밀려요', lowgrav: '달 중력 · 몸이 가벼워요', rain: '비 오는 날', snow: '눈 오는 날', fog: '짙은 안개', timer: '시간 제한! 늦으면 처음부터', gold: '엽전 비! 엽전이 잔뜩' };
  function startMod() {
    var st = S(); cur = st ? st.mod : null; drops = []; wind = 0; windT = 0; timerOver = false;
    if (cur === 'timer') { try { timeLeft = Math.round(E('ROWS') * 0.6 + 15); } catch (_) { timeLeft = 90; } }
    if (cur && LABEL[cur]) setTimeout(function () { try { E('showToast')(LABEL[cur], '#ffe27a'); } catch (_) {} }, 900);
  }
  function timeUp() {
    try {
      E("mode = 'clear'"); E('show')('ctrl', false); E('show')('pauseBtn', false);
      var ic = E('ic'), i = E('stageIdx');
      E('openModal')('<div class="msub" style="margin:0">STAGE ' + (i + 1) + ' · ' + E('STAGES')[i].name + '</div><div class="rank" style="color:#ff6b6b">시간 초과</div><div class="msub">조금만 더 빨리! 다시 도전해요.</div>' +
        '<div class="row2"><button class="go alt" data-act="retry">' + ic('retry') + '다시</button><button class="go ghost" data-act="lobby">' + ic('home') + '로비</button></div>');
    } catch (_) {}
  }
  // 몸에 직접 주는 효과 (바람, 달 중력, 시간 제한)
  (function phys(now) {
    var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    try {
      if (cur && E('mode') === 'play') {
        var p = E('P');
        if (p && !p.dead) {
          if (cur === 'lowgrav' && !p.onGround) p.vy -= 1800 * 0.35 * dt;
          if (cur === 'wind') {
            windT -= dt; if (windT <= 0) { windT = 3 + Math.random() * 3; wind = (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 35); }
            var nx = p.x + wind * dt, tx = Math.floor((wind > 0 ? nx + p.w + 1 : nx - 1) / E('T')), solid = E('isSolid');
            if (!solid(tx, Math.floor((p.y + 4) / E('T'))) && !solid(tx, Math.floor((p.y + p.h - 4) / E('T')))) p.x = nx;
          }
        }
        if (cur === 'timer' && !timerOver) { timeLeft -= dt; if (timeLeft <= 0) { timerOver = true; timeUp(); } }
      }
    } catch (_) {}
    requestAnimationFrame(phys);
  })(performance.now());
  // 화면에 그리는 효과
  function overlay() {
    var st = S(); if (!st) return;
    var c = E('ctx'), W = E('W'), H = E('viewH'), b = E('dpr') * E('scale'), p = E('P'), tm = E('time');
    c.save(); c.setTransform(b, 0, 0, b, 0, 0);
    if (typeof st.hue === 'number') { c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'hsla(' + st.hue + ',70%,50%,.35)'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; }
    var m = st.mod;
    if (m === 'rain' || m === 'snow') {
      var want = m === 'rain' ? 90 : 70;
      while (drops.length < want) drops.push({ x: Math.random() * W, y: Math.random() * H, v: m === 'rain' ? 500 + Math.random() * 300 : 30 + Math.random() * 40, r: 1 + Math.random() * 2, ph: Math.random() * 6 });
      c.strokeStyle = 'rgba(180,210,255,.55)'; c.fillStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.2;
      drops.forEach(function (d) {
        d.y += d.v / 60; if (m === 'snow') d.x += Math.sin(tm * 1.5 + d.ph) * 0.4; if (d.y > H) { d.y = -10; d.x = Math.random() * W; }
        if (m === 'rain') { c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x - 3, d.y + 12); c.stroke(); } else { c.beginPath(); c.arc(d.x, d.y, d.r, 0, 6.283); c.fill(); }
      });
    }
    if (m === 'wind') {
      c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5;
      for (var i = 0; i < 14; i++) { var yy = (i * 61) % H, xx = ((tm * Math.abs(wind) * 3 + i * 97) % (W + 80)) - 40; if (wind < 0) xx = W - xx; c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx - Math.sign(wind || 1) * 30, yy); c.stroke(); }
      c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(W / 2 - 34, 92, 68, 20); c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.fillText(wind > 0 ? '바람 →→' : '←← 바람', W / 2, 106);
    }
    if (m === 'fog') {
      for (var f = 0; f < 3; f++) { var fy = ((tm * 12 + f * H / 3) % (H + 120)) - 60, g2 = c.createLinearGradient(0, fy - 60, 0, fy + 60); g2.addColorStop(0, 'rgba(230,235,245,0)'); g2.addColorStop(0.5, 'rgba(230,235,245,.45)'); g2.addColorStop(1, 'rgba(230,235,245,0)'); c.fillStyle = g2; c.fillRect(0, fy - 60, W, 120); }
      c.fillStyle = 'rgba(220,225,235,.18)'; c.fillRect(0, 0, W, H);
    }
    if (m === 'night' && p) {
      var sp = toScreen(p.x + p.w / 2, p.y + p.h / 2), g = c.createRadialGradient(sp[0], sp[1], 40, sp[0], sp[1], 150);
      g.addColorStop(0, 'rgba(4,6,18,0)'); g.addColorStop(1, 'rgba(4,6,18,.9)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    if (m === 'timer' && E('mode') === 'play') {
      var tl = Math.max(0, timeLeft), red = tl < 10;
      c.fillStyle = red ? 'rgba(200,30,40,.75)' : 'rgba(0,0,0,.5)'; c.fillRect(W / 2 - 46, 92, 92, 24);
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(W / 2 - 28, 104, 6.5, 0, 6.283); c.stroke(); c.beginPath(); c.moveTo(W / 2 - 28, 104); c.lineTo(W / 2 - 28, 99.5); c.moveTo(W / 2 - 28, 104); c.lineTo(W / 2 - 24.5, 106); c.stroke();
      c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.fillText(Math.ceil(tl) + '초', W / 2 + 8, 109);
    }
    c.restore();
  }
  var hook = setInterval(function () {
    var st, rg; try { st = E('startStage'); rg = E('renderGame'); } catch (_) { return; }
    if (typeof st !== 'function' || typeof rg !== 'function') return; clearInterval(hook);
    window.startStage = function () { var r = st.apply(this, arguments); try { startMod(); } catch (_) {} return r; };
    window.renderGame = function () { var r = rg.apply(this, arguments); try { overlay(); } catch (_) {} return r; };
  }, 300);
})();

// ── 더 재밌게: 보스 4종류 + 클리어 후 보물 상자 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var KINDS = [
    { name: '너구리 장군', col: '#ff6a5a', glow: 'rgba(255,90,70,', seq: null },
    { name: '도토리 대장', col: '#c98a3e', glow: 'rgba(230,160,60,', seq: ['throw', 'walk', 'throw', 'leap', 'throw', 'drum'] },
    { name: '점프 대왕', col: '#4fc36b', glow: 'rgba(80,220,110,', seq: ['leap', 'leap', 'walk', 'leap', 'drum'] },
    { name: '북치기 대마왕', col: '#a66bff', glow: 'rgba(170,110,255,', seq: ['drum', 'leap', 'drum', 'throw', 'walk', 'drum'] }
  ];
  function kind() { try { if (E('ENDLESS')) return null; var i = E('stageIdx'); if (i < 5) return null; return KINDS[Math.floor(i / 25) % KINDS.length]; } catch (_) { return null; } }
  window.__bossKind = kind;
  var hook = setInterval(function () {
    var st, nb, db, dbb, cs; try { st = E('startStage'); nb = E('nextBossState'); db = E('drawBoss'); dbb = E('drawBossBar'); cs = E('clearStage'); } catch (_) { return; }
    if ([st, nb, db, dbb, cs].some(function (f) { return typeof f !== 'function'; })) return; clearInterval(hook);
    // 뒤로 갈수록 보스 체력이 조금씩 늘어나요 (10 → 250번은 14)
    window.startStage = function () {
      var r = st.apply(this, arguments);
      try { var b = E('boss'), k = kind(); if (b && k) { b.max = b.hp = 10 + Math.floor(E('stageIdx') / 50); } } catch (_) {}
      return r;
    };
    // 보스마다 공격 순서가 달라요
    window.nextBossState = function () {
      var k = kind(), b = E('boss'); if (!k || !k.seq || !b) return nb.apply(this, arguments);
      var phase2 = b.hp <= b.max / 2, s = k.seq[b.step++ % k.seq.length];
      b.state = s;
      if (s === 'walk') b.t = phase2 ? 1.0 : 1.4;
      else if (s === 'drum') { b.t = phase2 ? 1.6 : 1.3; b.drum = 0; }
      else if (s === 'throw') { b.t = 1.2; b.thrown = 0; }
      else if (s === 'leap') {
        var P = E('P'), W = E('W'), px = P ? P.x + P.w / 2 : W / 2, bx = b.x + b.w / 2;
        b.vy = k.name === '점프 대왕' ? -820 : -720; b.vx = Math.max(-300, Math.min(300, (px - bx) / 0.85)); b.ground = false; b.t = 0.3;
        try { E('tone')(200, 0.3, 'square', 0.06, 300); } catch (_) {}
      }
    };
    // 보스마다 생김새가 달라요 (너구리 장군은 원래 그림)
    function art(k, g, b, tm) {
      var INK = E('INK'), TAU = 6.283, st = b.state, drumS = st === 'drum' ? Math.sin(b.drum * 22) : 0;
      g.lineJoin = 'round';
      function eyes(y, sp, r, angry) {
        [-1, 1].forEach(function (d) {
          g.beginPath(); g.ellipse(d * sp, y, r, r * 1.1, 0, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
          g.beginPath(); g.arc(d * sp + b.face * r * 0.35, y + 1, r * 0.48, 0, TAU); g.fillStyle = INK; g.fill();
          if (angry) { g.beginPath(); g.moveTo(d * sp - d * r * 1.2, y - r * 1.4); g.lineTo(d * sp + d * r * 0.9, y - r * 0.7); g.lineWidth = 3; g.stroke(); }
        });
      }
      if (k.name === '도토리 대장') {
        // 커다란 도토리 몸통 + 모자 + 작은 팔
        g.beginPath(); g.ellipse(0, -26, 28, 27, 0, 0, TAU); g.fillStyle = '#c47a35'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke();
        g.beginPath(); g.ellipse(-8, -34, 7, 12, -0.4, 0, TAU); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill();
        g.beginPath(); g.ellipse(0, -46, 32, 15, 0, Math.PI, TAU); g.lineTo(32, -44); g.quadraticCurveTo(0, -36, -32, -44); g.closePath(); g.fillStyle = '#6b4a2e'; g.fill(); g.stroke();
        g.strokeStyle = 'rgba(30,20,10,.5)'; g.lineWidth = 1.4; for (var x = -24; x <= 24; x += 8) { g.beginPath(); g.moveTo(x - 4, -56); g.lineTo(x + 4, -42); g.stroke(); }
        g.beginPath(); g.moveTo(0, -60); g.quadraticCurveTo(4, -70, 10, -71); g.strokeStyle = INK; g.lineWidth = 3.5; g.stroke();
        eyes(-28, 10, 6, true);
        g.beginPath(); g.arc(0, -13, 6, Math.PI * 1.15, Math.PI * 1.85); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke();
        var arm = st === 'throw' ? -18 : 0;
        g.fillStyle = '#c47a35'; g.strokeStyle = INK; g.lineWidth = 2;
        g.beginPath(); g.ellipse(-29, -22 + arm, 6, 5, 0, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.ellipse(29, -22 + arm, 6, 5, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = '#6b4a2e'; g.beginPath(); g.ellipse(-11, -1, 8, 4, 0, 0, TAU); g.ellipse(11, -1, 8, 4, 0, 0, TAU); g.fill(); g.stroke();
      } else if (k.name === '점프 대왕') {
        // 왕관 쓴 개구리
        var crouch = b.ground ? 1 : 0.85;
        g.save(); g.scale(1, crouch);
        g.fillStyle = '#3fae5a'; g.strokeStyle = INK; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(-24, -6, 13, 7, 0, 0, TAU); g.ellipse(24, -6, 13, 7, 0, 0, TAU); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(0, -20, 32, 21, 0, 0, TAU); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(0, -14, 20, 12, 0, 0, TAU); g.fillStyle = '#f2f0c8'; g.fill(); g.lineWidth = 1.5; g.stroke();
        g.fillStyle = '#3fae5a'; g.lineWidth = 2.5; g.beginPath(); g.arc(-14, -38, 11, 0, TAU); g.arc(14, -38, 11, 0, TAU); g.fill(); g.stroke();
        g.restore();
        eyes(-38 * crouch, 14, 7, false);
        g.beginPath(); g.moveTo(-16, -24); g.quadraticCurveTo(0, -16, 16, -24); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke();
        g.fillStyle = 'rgba(255,120,120,.5)'; g.beginPath(); g.ellipse(-22, -26, 4, 2.5, 0, 0, TAU); g.ellipse(22, -26, 4, 2.5, 0, 0, TAU); g.fill();
        var cy = -50 * crouch; g.beginPath(); g.moveTo(-14, cy); g.lineTo(-14, cy - 12); g.lineTo(-7, cy - 6); g.lineTo(0, cy - 15); g.lineTo(7, cy - 6); g.lineTo(14, cy - 12); g.lineTo(14, cy); g.closePath();
        g.fillStyle = '#ffd23f'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#e74c3c'; g.beginPath(); g.arc(0, cy - 5, 2.5, 0, TAU); g.fill();
      } else {
        // 북치기 대마왕: 뿔 달린 도깨비 + 배에 큰 북
        g.fillStyle = '#7d4fd1'; g.strokeStyle = INK; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(-12, -4, 8, 6, 0, 0, TAU); g.ellipse(12, -4, 8, 6, 0, 0, TAU); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(-26, -8); g.quadraticCurveTo(-30, -48, 0, -54); g.quadraticCurveTo(30, -48, 26, -8); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#f5e6c8'; [-1, 1].forEach(function (d) { g.beginPath(); g.moveTo(d * 10, -50); g.quadraticCurveTo(d * 22, -66, d * 16, -74); g.quadraticCurveTo(d * 14, -62, d * 4, -53); g.closePath(); g.fill(); g.stroke(); });
        g.fillStyle = '#ffde59'; g.beginPath(); g.ellipse(-12, -40, 6, 6.5, 0, 0, TAU); g.ellipse(12, -40, 6, 6.5, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = INK; g.beginPath(); g.arc(-12 + b.face * 2, -39, 2.8, 0, TAU); g.arc(12 + b.face * 2, -39, 2.8, 0, TAU); g.fill();
        g.lineWidth = 3; g.beginPath(); g.moveTo(-20, -50); g.lineTo(-6, -45); g.moveTo(20, -50); g.lineTo(6, -45); g.stroke();
        g.beginPath(); g.moveTo(-10, -30); g.quadraticCurveTo(0, -25, 10, -30); g.lineWidth = 2.5; g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-7, -29); g.lineTo(-5, -24); g.lineTo(-3, -28); g.moveTo(7, -29); g.lineTo(5, -24); g.lineTo(3, -28); g.fill();
        // 북
        g.beginPath(); g.ellipse(0, -15, 15, 10, 0, 0, TAU); g.fillStyle = '#c0392b'; g.fill(); g.lineWidth = 2; g.stroke();
        g.beginPath(); g.ellipse(0, -17, 12, 6.5, 0, 0, TAU); g.fillStyle = '#f3dcb0'; g.fill(); g.stroke();
        g.strokeStyle = '#ffd23f'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, -15, 15, 10, 0, 0.3, Math.PI - 0.3); g.stroke();
        // 북채 든 팔
        g.strokeStyle = INK; g.lineWidth = 2.5;
        [-1, 1].forEach(function (d, n) {
          var up = st === 'drum' ? (n ? drumS : -drumS) * 8 : 0, hx = d * 22, hy = -26 + up;
          g.fillStyle = '#7d4fd1'; g.beginPath(); g.ellipse(hx, hy, 5.5, 5, 0, 0, TAU); g.fill(); g.stroke();
          g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - d * 14, hy + 6 - up * 0.6); g.lineWidth = 3; g.stroke();
          g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(hx - d * 14, hy + 6 - up * 0.6, 3, 0, TAU); g.fill(); g.lineWidth = 1.5; g.stroke(); g.lineWidth = 2.5;
        });
      }
    }
    window.__cnBossArt = art;   // 도감에서 보스 그림을 그릴 때 써요
    window.drawBoss = function () {
      var k = kind(), b = E('boss');
      if (!k || !b || k.name === '너구리 장군') return db.apply(this, arguments);
      try {
        var c = E('ctx'), tm = E('time'), save = { waves: b.waves, acorns: b.acorns };
        // 충격파·도토리는 원래 그림 그대로 쓰고, 몸통만 바꿔 그려요
        var dead = b.dead; b.dead = 0.9; db.apply(this, arguments); b.dead = dead;
        if (b.dead && b.dead > 0.8) return;
        var bx = b.x + b.w / 2, fy = b.y + b.h, by = b.y + b.h / 2;
        var r = 70 + Math.sin(tm * 4) * 6, gr = c.createRadialGradient(bx, by, 10, bx, by, r);
        gr.addColorStop(0, k.glow + '.5)'); gr.addColorStop(1, k.glow + '0)'); c.save(); c.fillStyle = gr; c.beginPath(); c.arc(bx, by, r, 0, 6.283); c.fill(); c.restore();
        c.save(); c.translate(bx, fy);
        if (b.dead) { c.globalAlpha = Math.max(0, 1 - b.dead / 0.8); c.rotate(b.dead * 2 * b.face); }
        var sq = b.state === 'drum' ? 1 + Math.sin(b.drum * 22) * 0.04 : b.ground ? 1 : 0.92;
        c.scale(1.05 / Math.sqrt(sq), 1.05 * sq);
        art(k, c, b, tm);
        if (b.inv > 0 && Math.floor(tm * 30) % 2) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55; c.fillStyle = '#fff'; c.beginPath(); c.ellipse(0, -28, 32, 30, 0, 0, 6.283); c.fill(); }
        c.restore();
      } catch (_) {}
    };
    // 체력바에 보스 이름과 색
    window.drawBossBar = function () {
      var k = kind(); if (!k) return dbb.apply(this, arguments);
      try {
        var b = E('boss'), c = E('ctx'), W = E('W'), INK = E('INK'), rr = E('rr'), x = 40, y = 92, w = W - 80, h = 16, kk = b.hp / b.max;
        c.fillStyle = INK; rr(c, x - 3, y, w + 6, h + 6, 10); c.fill();
        c.fillStyle = '#2a2a3a'; rr(c, x - 3, y - 3, w + 6, h + 6, 10); c.fill();
        c.fillStyle = k.col; rr(c, x, y, Math.max(0.01, w * kk), h, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,.35)'; rr(c, x + 3, y + 2, Math.max(0.01, w * kk - 6), 4, 2); c.fill();
        c.strokeStyle = INK; c.lineWidth = 2.4; rr(c, x - 3, y - 3, w + 6, h + 6, 10); c.stroke();
        c.font = '14px Jua, sans-serif'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = INK; c.strokeText(k.name, W / 2, y - 8); c.fillStyle = '#ffe14a'; c.fillText(k.name, W / 2, y - 8);
      } catch (_) { return dbb.apply(this, arguments); }
    };
    // 클리어하면 가끔 보물 상자
    window.clearStage = function () {
      var r = cs.apply(this, arguments);
      try {
        var i = E('stageIdx'), boss = E('boss'), chance = boss ? 1 : 0.3;
        if (!E('ENDLESS') && Math.random() < chance) setTimeout(function () {
          var card = document.getElementById('mcard'); if (!card || card.querySelector('.chest')) return;
          var bt = document.createElement('button'); bt.className = 'go chest';
          bt.style.cssText = 'background:linear-gradient(#ffd75a,#e8a317);color:#3a2400;margin-top:8px;animation:chestWob .6s ease-in-out infinite alternate';
          bt.innerHTML = window.__cnI('gift') + ' 보물 상자 발견! 눌러서 열기';
          if (!document.getElementById('chestCss')) { var st2 = document.createElement('style'); st2.id = 'chestCss'; st2.textContent = '@keyframes chestWob{from{transform:rotate(-2deg) scale(1)}to{transform:rotate(2deg) scale(1.04)}}'; document.head.appendChild(st2); }
          bt.onclick = function (ev) {
            ev.stopPropagation(); bt.onclick = null; bt.style.animation = 'none';
            var roll = Math.random(), n = roll < 0.05 ? 60 : roll < 0.3 ? 20 : 5 + Math.floor(Math.random() * 8);
            if (boss) n += 15;
            var sv = E('save'); sv.coins += n; E('persist')();
            try { var w = document.getElementById('wallet'); if (w) w.textContent = sv.coins; } catch (_) {}
            try { E('SFX').coin && E('SFX').coin(); } catch (_) {}
            bt.innerHTML = (n >= 60 ? window.__cnI('party') + ' 대박! ' : window.__cnI('spark') + ' ') + '엽전 +' + n;
          };
          var earn = card.querySelector('.earn'); earn ? earn.after(bt) : card.appendChild(bt);
        }, 1800);
      } catch (_) {}
      return r;
    };
  }, 300);
})();

// ── 완성도 + 재미: 조작 연습, 250스테이지 엔딩, 버그 신고, 오늘의 도전, 동상 마을 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var PC = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  function sfx(n) { try { E('SFX')[n || 'click'](); } catch (_) {} }
  function h(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  var css = document.createElement('style');
  css.textContent = [
    '.cnOv{position:fixed;inset:0;z-index:9000;background:rgba(8,10,22,.8);display:flex;align-items:center;justify-content:center;animation:fade .2s}',
    '.cnCard{background:#fffaf0;border-radius:22px;padding:20px 18px 16px;width:min(88vw,370px);max-height:84vh;overflow:auto;text-align:center;color:#2b2b3a;box-shadow:0 6px 0 #141418;border:3px solid #141418}',
    '.cnCard h3{margin:4px 0 6px;font-size:22px}.cnCard p{margin:6px 0;font-size:15.5px;line-height:1.5;color:#4a4658}',
    '.cnBig{font-size:54px;line-height:1.1;margin:6px 0}',
    '.cnRow{display:flex;gap:8px;margin-top:12px}.cnRow button{flex:1}',
    '.cnB{border:3px solid #141418;border-radius:14px;padding:11px 8px;font:inherit;font-size:17px;background:#3ccf6e;color:#fff;box-shadow:0 4px 0 #141418;cursor:pointer}',
    '.cnB.alt{background:#efe6d2;color:#2b2b3a}.cnB.blue{background:#3d7bff}',
    '.cnDots{display:flex;gap:6px;justify-content:center;margin:10px 0 2px}.cnDots i{width:8px;height:8px;border-radius:50%;background:#d8cfbb}.cnDots i.on{background:#3d7bff}',
    '.cnTa{width:100%;box-sizing:border-box;height:120px;border:2px solid #141418;border-radius:12px;padding:10px;font:inherit;font-size:15px;resize:none}',
    '.cnList{text-align:left;margin:8px 0;font-size:15px}.cnList div{display:flex;justify-content:space-between;padding:6px 4px;border-bottom:1px solid #eadfc8}.cnList .me{background:#fff1b8;border-radius:8px}',
    '.cnGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}.cnTile{background:#2a1a3a;border-radius:14px;padding:4px 4px 8px;color:#fff;border:2px solid #141418}',
    '.cnTile canvas{width:100%;height:auto;display:block}.cnTile b{display:block;font-size:14px;margin:2px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cnHeart{border:2px solid #141418;border-radius:12px;background:#fff;color:#e2425c;font:inherit;font-size:15px;padding:4px 12px;cursor:pointer}.cnHeart.on{background:#ffd6de}',
    '#cnExtra{display:flex;gap:10px;width:100%}#cnExtra button{flex:1;min-height:0;padding-top:9px;padding-bottom:9px;font-size:16px}',
    '#cnEnd{position:fixed;inset:0;z-index:9500;background:#000}#cnEnd canvas{width:100%;height:100%;display:block}'
  ].join('');
  document.head.appendChild(css);
  function overlay(html) {
    var o = document.createElement('div'); o.className = 'cnOv'; o.innerHTML = '<div class="cnCard">' + html + '</div>';
    o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
    document.body.appendChild(o); return o;
  }
  function fbx() { return window.__cnFb ? window.__cnFb() : Promise.reject('no fb'); }
  function persist() { try { E('persist')(); } catch (_) {} try { var w = document.getElementById('wallet'); if (w) w.textContent = E('save').coins; } catch (_) {} }

  // ───── 1. 조작 연습 (처음 수련할 때 한 번, 설정에서 다시 보기) ─────
  var TUT = [
    ['run', '이동', PC ? '← → 방향키로 움직여요.' : '왼쪽 아래 ◀ ▶ 버튼으로 움직여요.'],
    ['jump', '점프 · 2단 점프', (PC ? 'Space' : '초록 점프 버튼') + '으로 점프! 공중에서 한 번 더 누르면 2단 점프예요.'],
    ['wall', '벽 타기', '벽에 붙으면 천천히 미끄러져요. 그때 점프하면 반대쪽으로 벽 점프!'],
    ['dash', '대시', (PC ? 'Q 키' : '파란 대시 버튼') + '로 앞으로 휙! 대시하는 동안은 몬스터에 닿아도 괜찮아요.'],
    ['slash', '베기 · 보스 잡기', (PC ? 'E 키' : '빨간 베기 버튼') + '로 몬스터를 베요. 보스는 머리를 밟거나 대시로 부딪혀서 때려요.'],
    ['flag', '목표', '엽전과 두루마리 3개를 모으면서 맨 위 깃발까지 올라가요. 떨어지면 마지막 등불에서 다시 시작해요!']
  ];
  function showTutorial(done) {
    var i = 0, o = overlay('');
    function draw() {
      var t = TUT[i], last = i === TUT.length - 1;
      o.firstChild.innerHTML = '<div style="font-size:13px;color:#8a8270">조작 연습 ' + (i + 1) + ' / ' + TUT.length + '</div><div class="cnBig">' + window.__cnI(t[0]) + '</div><h3>' + t[1] + '</h3><p>' + t[2] + '</p>' +
        '<div class="cnDots">' + TUT.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
        '<div class="cnRow">' + (i ? '<button class="cnB alt" data-t="prev">이전</button>' : '<button class="cnB alt" data-t="skip">건너뛰기</button>') + '<button class="cnB' + (last ? '' : ' blue') + '" data-t="next">' + (last ? '수련 시작!' : '다음') + '</button></div>';
    }
    o.addEventListener('click', function (e) {
      var b = e.target.closest('[data-t]'); if (!b) return; sfx();
      var a = b.dataset.t;
      if (a === 'prev') i--; else if (a === 'next' && i < TUT.length - 1) i++;
      else { o.remove(); try { localStorage.setItem('cn_tut_seen', '1'); } catch (_) {} if (done) done(); return; }
      draw();
    });
    o.onclick = null; draw();
  }
  window.__showTutorial = showTutorial;

  // ───── 2. 250스테이지 엔딩 ─────
  function grantEnding() {
    var sv = E('save'); if (sv.cnEnding) return false;
    sv.cnEnding = Date.now(); sv.coins += 500;
    try { var ow = window.__cnOwned('title'); if (ow.indexOf('leg') < 0) ow.push('leg'); sv.cnTitle = 'leg'; } catch (_) {}
    persist(); return true;
  }
  function playEnding(first) {
    if (document.getElementById('cnEnd')) return;
    var wrap = document.createElement('div'); wrap.id = 'cnEnd';
    var cv = document.createElement('canvas'); wrap.appendChild(cv); document.body.appendChild(wrap);
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; var c = cv.getContext('2d'); c.scale(dpr, dpr);
    var img = null, sv = E('save');
    try { (window.__charSrc ? window.__charSrc(sv.cnChar || 'basic') : Promise.reject()).then(function (src) { var im = new Image(); im.onload = function () { img = im; }; im.src = src; }).catch(function () {}); } catch (_) {}
    var stars = []; for (var i = 0; i < 90; i++) stars.push([Math.random() * W, Math.random() * H * 0.7, Math.random() * 1.6 + 0.4, Math.random() * 6]);
    var fw = [], t0 = performance.now(), done = false, END = 17;
    var LINES = [[0.6, 3.6, '250개의 수련을 모두 마쳤다'], [3.8, 6.8, '하찮던 닌자는 구름 위 정상에 올라'], [7, 10.5, '마침내 전설이 되었다!']];
    function tone(f, d, ty, v, sl, dl) { setTimeout(function () { try { E('tone')(f, d, ty || 'triangle', v || 0.05, sl || 0); } catch (_) {} }, (dl || 0) * 1000); }
    [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, k) { tone(f, 0.35, 'triangle', 0.05, 0, 7 + k * 0.16); });
    function boom(x, y) {
      var col = ['#ffd23f', '#ff6a8a', '#7cd4ff', '#a6ff7c', '#d8a6ff'][Math.floor(Math.random() * 5)];
      for (var k = 0; k < 46; k++) { var a = k / 46 * 6.283, sp = 90 + Math.random() * 110; fw.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, l: 1.4 + Math.random() * 0.6, c: col }); }
      tone(120 + Math.random() * 80, 0.25, 'sawtooth', 0.03, 40);
    }
    var lastBoom = 0, last = t0;
    function frame(now) {
      if (done) return;
      var t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      var dawn = Math.min(1, Math.max(0, (t - 5) / 6));
      var g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgb(' + Math.round(10 + dawn * 40) + ',' + Math.round(12 + dawn * 40) + ',' + Math.round(40 + dawn * 70) + ')');
      g.addColorStop(1, 'rgb(' + Math.round(40 + dawn * 215) + ',' + Math.round(30 + dawn * 140) + ',' + Math.round(70 + dawn * 60) + ')');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      stars.forEach(function (s2) { c.globalAlpha = (1 - dawn * 0.8) * (0.5 + Math.sin(t * 2 + s2[3]) * 0.5); c.fillStyle = '#fff'; c.beginPath(); c.arc(s2[0], s2[1], s2[2], 0, 6.283); c.fill(); });
      c.globalAlpha = 1;
      // 해
      if (dawn > 0) { var sy = H * 0.62 - dawn * H * 0.22; var sg = c.createRadialGradient(W / 2, sy, 10, W / 2, sy, 140); sg.addColorStop(0, 'rgba(255,230,150,' + dawn + ')'); sg.addColorStop(1, 'rgba(255,180,90,0)'); c.fillStyle = sg; c.fillRect(0, 0, W, H); }
      // 구름 바다와 봉우리
      c.fillStyle = 'rgba(255,255,255,' + (0.55 + dawn * 0.3) + ')';
      for (var k = 0; k < 7; k++) { var cx = ((k * 140 + t * 14) % (W + 200)) - 100; c.beginPath(); c.ellipse(cx, H * 0.78, 110, 34, 0, 0, 6.283); c.fill(); }
      var py = H * 0.62 + Math.max(0, 1 - t / 3) * H * 0.5;
      c.fillStyle = '#2a2238'; c.beginPath(); c.moveTo(W / 2 - 150, H); c.lineTo(W / 2 - 34, py); c.lineTo(W / 2 + 34, py); c.lineTo(W / 2 + 150, H); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(W / 2 - 34, py); c.lineTo(W / 2 + 34, py); c.lineTo(W / 2 + 22, py + 16); c.lineTo(W / 2, py + 8); c.lineTo(W / 2 - 20, py + 18); c.fill();
      // 닌자
      if (img) { var nh = 96, nw = nh * img.width / img.height, jump = t > 10.5 ? Math.abs(Math.sin((t - 10.5) * 4)) * 18 : 0; c.drawImage(img, W / 2 - nw / 2, py - nh - jump + 4, nw, nh); }
      // 왕관
      if (t > 10.5) { var cy2 = py - 112 - (t > 10.5 ? Math.abs(Math.sin((t - 10.5) * 4)) * 18 : 0); c.fillStyle = '#ffd23f'; c.strokeStyle = '#141418'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(W / 2 - 16, cy2); c.lineTo(W / 2 - 16, cy2 - 14); c.lineTo(W / 2 - 8, cy2 - 6); c.lineTo(W / 2, cy2 - 17); c.lineTo(W / 2 + 8, cy2 - 6); c.lineTo(W / 2 + 16, cy2 - 14); c.lineTo(W / 2 + 16, cy2); c.closePath(); c.fill(); c.stroke(); }
      // 불꽃놀이
      if (t > 7 && t - lastBoom > 0.55) { lastBoom = t; boom(W * (0.15 + Math.random() * 0.7), H * (0.12 + Math.random() * 0.3)); }
      fw.forEach(function (p) { p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.l -= dt; c.globalAlpha = Math.max(0, Math.min(1, p.l)); c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, 2.4, 0, 6.283); c.fill(); });
      fw = fw.filter(function (p) { return p.l > 0; }); c.globalAlpha = 1;
      // 글자
      c.textAlign = 'center'; c.font = 'bold ' + Math.min(26, W / 15) + 'px Jua, sans-serif';
      LINES.forEach(function (L) { if (t > L[0] && t < L[1] + 0.6) { var a = Math.min(1, (t - L[0]) * 2, (L[1] + 0.6 - t) * 2); c.globalAlpha = Math.max(0, a); c.lineWidth = 5; c.strokeStyle = '#141418'; c.strokeText(L[2], W / 2, H * 0.2); c.fillStyle = '#fff6d0'; c.fillText(L[2], W / 2, H * 0.2); } });
      c.globalAlpha = 1;
      if (t > 11) {
        var a2 = Math.min(1, (t - 11) * 1.5); c.globalAlpha = a2;
        c.font = 'bold ' + Math.min(30, W / 12) + 'px Jua, sans-serif'; c.lineWidth = 6; c.strokeStyle = '#141418';
        c.strokeText('전설의 닌자', W / 2, H * 0.17); c.fillStyle = '#ffd23f'; c.fillText('전설의 닌자', W / 2, H * 0.17);
        var tw2 = c.measureText('전설의 닌자').width; [-1, 1].forEach(function (sd) { var cx2 = W / 2 + sd * (tw2 / 2 + 22), cy3 = H * 0.17 - 8; c.beginPath(); c.moveTo(cx2 - 12, cy3 + 8); c.lineTo(cx2 - 12, cy3 - 6); c.lineTo(cx2 - 6, cy3); c.lineTo(cx2, cy3 - 10); c.lineTo(cx2 + 6, cy3); c.lineTo(cx2 + 12, cy3 - 6); c.lineTo(cx2 + 12, cy3 + 8); c.closePath(); c.fillStyle = '#ffd23f'; c.lineWidth = 3; c.strokeStyle = '#141418'; c.fill(); c.stroke(); });
        c.font = Math.min(18, W / 20) + 'px Jua, sans-serif'; c.lineWidth = 4;
        var sub = first ? '칭호 [전설의 닌자] · 엽전 +500 획득!' : '플레이해 줘서 고마워요!';
        c.strokeText(sub, W / 2, H * 0.17 + 34); c.fillStyle = '#fff'; c.fillText(sub, W / 2, H * 0.17 + 34);
        c.globalAlpha = 1;
      }
      if (t > 13) { c.font = '15px Jua, sans-serif'; c.fillStyle = 'rgba(255,255,255,' + (0.5 + Math.sin(t * 4) * 0.4) + ')'; c.fillText('화면을 누르면 돌아가요', W / 2, H - 40); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    wrap.addEventListener('click', function () { if ((performance.now() - t0) / 1000 < 2) return; done = true; wrap.remove(); });
  }
  window.__playEnding = playEnding;

  // ───── 3. 버그 신고 ─────
  function openReport() {
    var o = overlay('<div class="cnBig">' + window.__cnI('bug') + '</div><h3>버그 신고 · 의견 보내기</h3><p>어디서 어떤 일이 있었는지 적어 주세요. 관리자에게 바로 전달돼요.</p>' +
      '<textarea class="cnTa" maxlength="500" placeholder="예) 37스테이지 오른쪽 벽에 끼었어요"></textarea><p class="cnMsg" style="min-height:20px;font-size:14px"></p>' +
      '<div class="cnRow"><button class="cnB alt" data-r="x">닫기</button><button class="cnB blue" data-r="send">보내기</button></div>');
    var ta = o.querySelector('textarea'), msg = o.querySelector('.cnMsg');
    o.addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]'); if (!b) return; sfx();
      if (b.dataset.r === 'x') { o.remove(); return; }
      var text = ta.value.trim(); if (text.length < 2) { msg.textContent = '내용을 조금 더 적어 주세요'; return; }
      b.disabled = true; msg.textContent = '보내는 중…';
      fbx().then(function (x) {
        var u = x.auth.currentUser; if (!u) throw 'guest';
        var ts = String(Date.now()), st = 0; try { st = E('stageIdx') + 1; } catch (_) {}
        var rep = {}; rep[ts] = { t: text.slice(0, 500), s: st, ua: navigator.userAgent.slice(0, 140) };
        return x.F.setDoc(x.F.doc(x.db, 'users', u.uid), { reports: rep }, { merge: true });
      }).then(function () { msg.textContent = '보냈어요! 고마워요'; ta.value = ''; setTimeout(function () { o.remove(); }, 1200); })
        .catch(function (er) { b.disabled = false; msg.textContent = er === 'guest' ? '로그인해야 보낼 수 있어요' : '보내지 못했어요. 잠시 뒤 다시 해 주세요'; });
    });
  }
  window.__openReport = openReport;

  // ───── 4. 오늘의 도전 ─────
  var daily = { on: false, idx: -1 };
  function dailyIdx(d) {
    var hsh = 0; for (var i = 0; i < d.length; i++) hsh = (hsh * 31 + d.charCodeAt(i)) >>> 0;
    var idx = 5 + (hsh % 195); if (idx % 25 === 24) idx++; return idx;   // 6~201번 중 보스 판은 빼요
  }
  function fmt(t) { return (Math.round(t * 10) / 10).toFixed(1) + '초'; }
  function openDaily() {
    var d = today(), idx = dailyIdx(d), S = E('STAGES')[idx], sv = E('save'), mine = sv.cnDailyBest && sv.cnDailyBest.d === d ? sv.cnDailyBest.t : null;
    var o = overlay('<div style="font-size:13px;color:#8a8270">' + d + '</div><h3>' + window.__cnI('cal') + ' 오늘의 도전</h3>' +
      '<p><b>STAGE ' + (idx + 1) + ' · ' + h(S.name) + '</b><br><small>' + h(S.sub || '') + '</small></p>' +
      '<p style="font-size:14px">하루에 하나씩 바뀌는 판이에요. 아직 안 열린 판도 할 수 있어요!<br>오늘 처음 깨면 <b>엽전 +30</b> · 빨리 깰수록 순위가 올라가요</p>' +
      '<p>내 오늘 기록: <b>' + (mine == null ? '없음' : fmt(mine)) + '</b></p>' +
      '<div class="cnList" id="cnDailyList"><div><span>순위 불러오는 중…</span></div></div>' +
      '<div class="cnRow"><button class="cnB alt" data-d="x">닫기</button><button class="cnB" data-d="go">도전하기!</button></div>');
    o.addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]'); if (!b) return; sfx();
      o.remove();
      if (b.dataset.d === 'go') { daily.on = true; daily.idx = idx; try { E('goStage')(idx); } catch (_) {} }
    });
    fbx().then(function (x) {
      var me = x.auth.currentUser && x.auth.currentUser.uid;
      return x.F.getDocs(x.F.query(x.F.collection(x.db, 'ranks'), x.F.where('dd', '==', d))).then(function (snap) {
        var rows = snap.docs.map(function (r) { var v = r.data(); return { n: v.nick || '닌자', t: Number(v.dt), me: r.id === me }; }).filter(function (r) { return r.t > 0; }).sort(function (a, b) { return a.t - b.t; }).slice(0, 10);
        var el = document.getElementById('cnDailyList'); if (!el) return;
        el.innerHTML = rows.length ? rows.map(function (r, i) { return '<div class="' + (r.me ? 'me' : '') + '"><span>' + (i < 3 ? window.__cnI('medal' + (i + 1)) : (i + 1) + '.') + ' ' + h(r.n) + '</span><b>' + fmt(r.t) + '</b></div>'; }).join('') : '<div><span>아직 아무도 안 깼어요. 1등 해 보세요!</span></div>';
      });
    }).catch(function () { var el = document.getElementById('cnDailyList'); if (el) el.innerHTML = '<div><span>순위는 로그인하면 볼 수 있어요</span></div>'; });
  }
  function dailyClear() {
    var d = today(), sv = E('save'), t = E('runTime'), first = sv.cnDaily !== d;
    if (first) { sv.cnDaily = d; sv.coins += 30; }
    var prev = sv.cnDailyBest && sv.cnDailyBest.d === d ? sv.cnDailyBest.t : null, best = prev == null ? t : Math.min(prev, t);
    sv.cnDailyBest = { d: d, t: best }; persist();
    fbx().then(function (x) { var u = x.auth.currentUser; if (!u || window.__cnAdmin) return; return x.F.setDoc(x.F.doc(x.db, 'ranks', u.uid), { dd: d, dt: Math.round(best * 100) / 100 }, { merge: true }); }).catch(function () {});
    setTimeout(function () {
      var card = document.getElementById('mcard'); if (!card) return;
      var nx = card.querySelector('[data-act="next"]'); if (nx) nx.remove();
      var div = document.createElement('div'); div.style.cssText = 'background:#e8f0ff;border-radius:12px;padding:8px 10px;margin:8px 0 2px;font-size:15px;text-align:center;color:#2b3a6b';
      div.innerHTML = window.__cnI('cal') + ' 오늘의 도전 ' + fmt(t) + (prev == null || t < prev ? ' · <span>오늘 최고!</span>' : '') + (first ? ' · 엽전 +30' : '');
      var earn = card.querySelector('.earn'); earn ? earn.after(div) : card.appendChild(div);
    }, 1650);
  }

  // ───── 5. 동상 마을 (다른 사람 동상에 하트) ─────
  function openVillage() {
    var sv = E('save'), others = (window.__otherStatues ? window.__otherStatues() : []).slice(0, 20), list = [];
    if (sv.cnStatue) list.push({ mine: true, nick: '내 동상' });
    others.forEach(function (o) { list.push(o); });
    var o = overlay('<h3>' + window.__cnI('statue') + ' 동상 마을</h3><p style="font-size:14px">동상을 세운 닌자들이에요. 마음에 드는 동상에 하트를 눌러 주세요!</p>' +
      (list.length ? '<div class="cnGrid">' + list.map(function (it, i) { return '<div class="cnTile"><canvas width="280" height="230" data-i="' + i + '"></canvas><b>' + h(it.nick) + '</b>' + (it.mine ? '<span class="cnHeart" data-mine="1">' + window.__cnI('heart') + ' <span>…</span></span>' : '<button class="cnHeart" data-u="' + h(it.uid) + '">' + window.__cnI('heart') + ' <span>…</span></button>') + '</div>'; }).join('') + '</div>'
        : '<p>아직 동상을 세운 사람이 없어요. 상점의 동상 탭에서 처음으로 세워 보세요!</p>') +
      '<div class="cnRow"><button class="cnB alt" data-v="x">닫기</button></div>');
    o.querySelectorAll('canvas').forEach(function (cv) {
      var it = list[+cv.dataset.i], c = cv.getContext('2d');
      var g = c.createLinearGradient(0, 0, 0, 230); g.addColorStop(0, '#2a1a3a'); g.addColorStop(1, '#d0705a'); c.fillStyle = g; c.fillRect(0, 0, 280, 230);
      c.fillStyle = '#4a3a2a'; c.fillRect(0, 200, 280, 30);
      try { window.__drawStatue(c, 140, 200, 1.05, it.mine ? undefined : it); } catch (_) {}
    });
    o.addEventListener('click', function (e) {
      if (e.target.closest('[data-v]')) { sfx(); o.remove(); return; }
      var b = e.target.closest('button[data-u]'); if (!b || b.disabled) return; sfx(); b.disabled = true;
      var uid = b.dataset.u, on = !b.classList.contains('on');
      fbx().then(function (x) {
        var u = x.auth.currentUser; if (!u) throw 'guest';
        var ref = x.F.doc(x.db, 'ranks', u.uid), up = {};
        if (on) { up.liked = {}; up.liked[uid] = true; return x.F.setDoc(ref, up, { merge: true }); }
        up['liked.' + uid] = x.F.deleteField(); return x.F.updateDoc(ref, up);
      }).then(function () {
        b.classList.toggle('on', on); var sp = b.querySelector('span'); sp.textContent = Math.max(0, (parseInt(sp.textContent, 10) || 0) + (on ? 1 : -1));
        if (on) { try { E('SFX').coin(); } catch (_) {} }
      }).catch(function (er) { if (er === 'guest') { b.querySelector('span').textContent = '로그인 필요'; } })
        .then(function () { b.disabled = false; });
    });
    // 하트 수 불러오기
    fbx().then(function (x) {
      var me = x.auth.currentUser && x.auth.currentUser.uid;
      list.forEach(function (it, i) {
        var uid = it.mine ? me : it.uid; if (!uid) return;
        x.F.getDocs(x.F.query(x.F.collection(x.db, 'ranks'), x.F.where('liked.' + uid, '==', true))).then(function (snap) {
          var el = o.querySelectorAll('.cnHeart')[i]; if (!el) return;
          el.querySelector('span').textContent = snap.docs.length;
          if (!it.mine && me && snap.docs.some(function (d) { return d.id === me; })) el.classList.add('on');
        }).catch(function () { var el = o.querySelectorAll('.cnHeart')[i]; if (el) el.querySelector('span').textContent = '0'; });
      });
    }).catch(function () { o.querySelectorAll('.cnHeart span').forEach(function (s2) { s2.textContent = '0'; }); });
  }
  window.__openVillage = openVillage;

  // ───── 로비 버튼과 설정 메뉴 ─────
  var waitLobby = setInterval(function () {
    var box = document.querySelector('#lobby .lobbyBtns'); if (!box) return; clearInterval(waitLobby);
    var row = document.createElement('div'); row.className = 'row'; row.id = 'cnExtra';
    row.innerHTML = '<button class="mid" id="btnDaily"><span class="lbl">오늘의 도전</span><b class="dot hide" id="dailyDot"></b></button><button class="mid" id="btnVillage"><span class="lbl">동상 마을</span></button>';
    box.appendChild(row);
    document.getElementById('btnDaily').addEventListener('click', function () { sfx(); openDaily(); });
    document.getElementById('btnVillage').addEventListener('click', function () { sfx(); openVillage(); });
    setInterval(function () { try { var dot = document.getElementById('dailyDot'); if (dot) dot.classList.toggle('hide', E('save').cnDaily === today()); } catch (_) {} }, 1500);
    var play = document.getElementById('btnPlay'); if (play) play.addEventListener('click', function () { daily.on = false; }, true);
  }, 300);

  var hook = setInterval(function () {
    var gs, cs, os, st, set; try { gs = E('goStage'); cs = E('clearStage'); os = E('openStages'); st = E('startStage'); set = E('openSettings'); } catch (_) { return; }
    if ([gs, cs, os, st, set].some(function (f) { return typeof f !== 'function'; })) return; clearInterval(hook);
    window.goStage = function (i) {
      var self = this, args = arguments, seen = false; try { seen = !!localStorage.getItem('cn_tut_seen'); } catch (_) {}
      if (i === 0 && !seen && !E('save').best.s0) { showTutorial(function () { gs.apply(self, args); }); return; }
      return gs.apply(this, arguments);
    };
    window.openStages = function () { daily.on = false; return os.apply(this, arguments); };
    window.startStage = function (i) { if (i !== daily.idx) daily.on = false; return st.apply(this, arguments); };
    window.clearStage = function () {
      var i = E('stageIdx'), sv = E('save'), isDaily = daily.on && i === daily.idx, unl = sv.unlocked;
      var r = cs.apply(this, arguments);
      try {
        if (isDaily) { if (i >= unl) { sv.unlocked = unl; persist(); } setTimeout(dailyClear, 0); }   // 보상은 엽전 줄이기(40%)가 끝난 뒤에 줘요   // 아직 안 열린 판을 깨도 스테이지가 열리지는 않아요
        if (!E('ENDLESS') && i === E('STAGES').length - 1 && E('STAGES').length >= 250) { setTimeout(function () { var first = grantEnding(); setTimeout(function () { playEnding(first); }, 2400); }, 0); }
      } catch (_) {}
      return r;
    };
    window.openSettings = function () {
      var r = set.apply(this, arguments);
      try {
        var body = document.getElementById('sheetBody'), note = body && body.querySelector('.note');
        function add(label, btn, fn) {
          var row = document.createElement('div'); row.className = 'tog';
          row.innerHTML = label + ' <span style="font-size:15px;color:#2b3a6b;font-weight:bold">' + btn + '</span>';
          row.addEventListener('click', function () { sfx(); try { E('closeSheet')(); } catch (_) {} setTimeout(fn, 200); });
          if (note) body.insertBefore(row, note); else body.appendChild(row);
        }
        add('조작 방법 보기', '▶ 보기', function () { showTutorial(); });
        if (E('save').cnEnding) add('엔딩 다시 보기', window.__cnI('crown') + ' 보기', function () { playEnding(false); });
        add('버그 신고 · 의견 보내기', window.__cnI('bug') + ' 쓰기', openReport);
      } catch (_) {}
      return r;
    };
  }, 300);
})();

// ── UI 다듬기 + 재미: 로비 아이콘 메뉴, 수련 진행도와 25판마다 보상 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  function sfx(n) { try { E('SFX')[n || 'click'](); } catch (_) {} }
  function today() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function persist() { try { E('persist')(); } catch (_) {} try { E('refreshLobby')(); } catch (_) {} try { var w = document.getElementById('wallet'); if (w) w.textContent = E('save').coins; } catch (_) {} }
  function toast(t) { try { E('showToast')(t, '#ffe27a'); } catch (_) {} }
  var css = document.createElement('style');
  css.textContent = [
    '#cnMenu{display:flex;flex-direction:column;gap:8px;width:100%}.cnMrow{display:flex;gap:8px}.cnMrow .mid{flex:1}',
    '#cnMenu .mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:9px 2px 8px !important;min-height:66px;font-size:13.5px !important;border-radius:16px !important;line-height:1.15;letter-spacing:-.3px}',
    '#cnMenu .mid .lbl{display:flex;flex-direction:column;align-items:center;gap:3px}',
    '#cnMenu .mid .ic{width:26px !important;height:26px !important;margin:0 !important}',
    '#cnMenu .mid .em{font-size:24px;line-height:26px;height:26px}',
    '#cnMenu .mid small{font-size:10.5px !important;margin:0 !important}',
    '#cnMenu .mid .dot{position:absolute;top:5px;right:7px}',
        '#cnMenu .mid.bz{background:linear-gradient(#ffe0d6,#ffb39c) !important;color:#6b1d0e !important}',
    '#cnProg{width:100%;box-sizing:border-box;display:flex;align-items:center;gap:8px;background:rgba(20,20,24,.55);border-radius:14px;padding:7px 10px;color:#fff;font-size:13.5px}',
    '#cnProg .bar{flex:1;height:10px;border-radius:6px;background:rgba(255,255,255,.2);overflow:hidden}#cnProg .bar i{display:block;height:100%;background:linear-gradient(90deg,#7dffa0,#3ccf6e);border-radius:6px;transition:width .4s}',
    '#cnProg button{border:2px solid #141418;border-radius:10px;background:#ffd23f;font:inherit;font-size:13px;padding:3px 8px;color:#3a2400;animation:chestWob .6s ease-in-out infinite alternate;cursor:pointer}',
    '#cnProg .nx{opacity:.8;font-size:12px;white-space:nowrap}',
    '@keyframes chestWob{from{transform:rotate(-2deg) scale(1)}to{transform:rotate(2deg) scale(1.04)}}'
  ].join('');
  document.head.appendChild(css);

  // ───── 수련 진행도 + 25판마다 보상 ─────
  var MILE = 25, MREW = 100;
  function cleared() { var b = E('save').best || {}, n = 0; for (var i = 0; i < 250; i++) if (b['s' + i]) n++; return n; }
  function renderProg() {
    var el = document.getElementById('cnProg'); if (!el) return;
    var sv = E('save'), n = cleared(), got = sv.cnMile || 0, can = Math.floor(n / MILE) > got, nextAt = (got + 1) * MILE;
    var html = '<span>' + window.__cnI('tower') + ' ' + n + '/250</span><div class="bar"><i style="width:' + (n / 2.5) + '%"></i></div>' +
      (can ? '<button id="cnMileBtn">' + window.__cnI('gift') + ' ' + (got + 1) * MILE + '판 보상</button>' : (nextAt <= 250 ? '<span class="nx">' + window.__cnI('gift') + ' ' + nextAt + '판까지 ' + (nextAt - n) + '판</span>' : '<span class="nx">' + window.__cnI('crown') + ' 완주!</span>'));
    if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#cnMileBtn')) return;
    var sv = E('save'); if (Math.floor(cleared() / MILE) <= (sv.cnMile || 0)) return;
    sv.cnMile = (sv.cnMile || 0) + 1; sv.coins += MREW; persist(); sfx('coin'); toast(sv.cnMile * MILE + '판 달성! 엽전 +' + MREW); renderProg();
  });

  // ───── 로비 아이콘 메뉴 ─────
  var build = setInterval(function () {
    var box = document.querySelector('#lobby .lobbyBtns'), ids = ['btnTower', 'btnAch', 'btnStages', 'btnRank', 'btnBz', 'btnDaily', 'btnVillage'];
    if (!box || ids.some(function (id) { return !document.getElementById(id); })) return; clearInterval(build);
    var menu = document.createElement('div'); menu.id = 'cnMenu';
    var r1 = document.createElement('div'), r2 = document.createElement('div'); r1.className = r2.className = 'cnMrow'; menu.appendChild(r1); menu.appendChild(r2);
    var label = { btnAch: '미션', btnBz: ['swords', '광전사'], btnDaily: ['cal', '도전'], btnVillage: ['statue', '동상 마을'] };
    ids.forEach(function (id) {
      var b = document.getElementById(id), row = b.parentNode, l = b.querySelector('.lbl'), L = label[id];
      if (l && Array.isArray(L)) l.innerHTML = window.__cnI(L[0]) + L[1];
      else if (l && L) { var ic = l.querySelector('i,svg'); l.textContent = ''; if (ic) l.appendChild(ic); l.appendChild(document.createTextNode(L)); }
      if (id === 'btnBz') b.classList.add('bz');
      (ids.indexOf(id) < 4 ? r1 : r2).appendChild(b);
      if (row && row !== box && !row.children.length) row.remove();
    });
    // 위 줄: 탑 미션 스테이지 랭킹 / 아래 줄: 광전사 오늘의 도전 동상 마을
    var play = document.getElementById('btnPlay'), prog = document.createElement('div'); prog.id = 'cnProg';
    if (play && play.nextSibling) box.insertBefore(prog, play.nextSibling); else box.appendChild(prog);
    box.insertBefore(menu, prog.nextSibling);
    box.querySelectorAll('.row').forEach(function (rw) { if (!rw.children.length) rw.remove(); });
    renderProg();
    setInterval(function () { try { renderProg(); } catch (_) {} }, 1200);
  }, 300);
})();

// ── 떨어져도 다시 안 올라가게: 체크포인트보다 4칸 넘게 아래에 착지하면 체크포인트로 바로 돌아가요 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var cool = 0;
  (function tick() {
    try {
      if (E('mode') === 'play' && !E('ENDLESS')) {
        var p = E('P'), rp = E('respawn'), T = E('T');
        if (cool > 0) cool--;
        else if (p && rp && !p.dead && p.onGround && p.y + p.h > rp.y + 4 * T) {
          var np = E('newPlayer')(rp);
          E('puff')(p.x + p.w / 2, p.y + p.h / 2, 10, '#ffffff', 80, 6);
          p.x = np.x; p.y = np.y; p.vx = 0; p.vy = 0; p.invT = Math.max(p.invT || 0, 0.8);
          try { p.airJumps = E('maxAir')(p); } catch (_) {}
          E('puff')(rp.x, rp.y - 13, 12, '#ffffff', 90, 7); E('ring')(rp.x, rp.y - 12, 'rgba(255,220,140,.9)', 24);
          try { E('showToast')('체크포인트로 휙!', '#ffd59a'); E('SFX').cp(); } catch (_) {}
          cool = 30;
        }
      }
    } catch (_) {}
    requestAnimationFrame(tick);
  })();
})();

// ── 직접 그린 아이콘 (이모티콘 대신): 게임 아이콘처럼 굵은 검은 외곽선 그림체 ──
(function () {
  var K = '#141418';
  function svg(b) { return '<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">' + b + '</svg>'; }
  var M = {
    x: svg('<path d="M6 6 L18 18 M18 6 L6 18" stroke="' + K + '" stroke-width="5.4" fill="none"/><path d="M6 6 L18 18 M18 6 L6 18" stroke="#fff" stroke-width="2.4" fill="none"/>'),
    swords: svg('<path d="M4 4 L15 15 M20 4 L9 15" stroke="' + K + '" stroke-width="5"/><path d="M4 4 L15 15 M20 4 L9 15" stroke="#e8edf5" stroke-width="2.4"/><path d="M12.5 17.5 L17.5 12.5 M6.5 12.5 L11.5 17.5" stroke="' + K + '" stroke-width="2.4"/><path d="M15 15 L19.5 19.5 M9 15 L4.5 19.5" stroke="' + K + '" stroke-width="4.6"/><path d="M15 15 L19.5 19.5 M9 15 L4.5 19.5" stroke="#8a5a32" stroke-width="2.2"/>'),
    cal: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.6" fill="#fff4dc" stroke="' + K + '" stroke-width="2"/><path d="M3.5 7.6 A2.6 2.6 0 0 1 6.1 5 H17.9 A2.6 2.6 0 0 1 20.5 7.6 V10 H3.5 Z" fill="#e8333a" stroke="' + K + '" stroke-width="2"/><path d="M8 3 V7 M16 3 V7" stroke="' + K + '" stroke-width="2.4"/><rect x="7" y="12.5" width="3.4" height="3" rx=".8" fill="#ffd23f" stroke="' + K + '" stroke-width="1.3"/><path d="M13 14 H17 M7.5 18 H16" stroke="#c9b48a" stroke-width="1.6"/>'),
    statue: svg('<rect x="4.5" y="17" width="15" height="4" rx="1" fill="#b9b4aa" stroke="' + K + '" stroke-width="1.8"/><rect x="6.5" y="14.8" width="11" height="2.4" fill="#d8d3c8" stroke="' + K + '" stroke-width="1.6"/><path d="M8.4 14.8 Q8 10 12 9.6 Q16 10 15.6 14.8 Z" fill="#9a958b" stroke="' + K + '" stroke-width="1.7"/><circle cx="12" cy="6.6" r="3.9" fill="#9a958b" stroke="' + K + '" stroke-width="1.7"/><path d="M8.2 5.9 H15.8" stroke="#d8d3c8" stroke-width="1.8"/>'),
    gift: svg('<rect x="4" y="10" width="16" height="10.5" rx="1.4" fill="#e8333a" stroke="' + K + '" stroke-width="2"/><rect x="3" y="7" width="18" height="4" rx="1.2" fill="#ff5a5f" stroke="' + K + '" stroke-width="2"/><path d="M12 7 V20.5" stroke="' + K + '" stroke-width="4.4"/><path d="M12 7 V20.5" stroke="#ffd23f" stroke-width="2.2"/><path d="M12 7 Q8 2.5 6.6 4.6 Q6 6.6 12 7 Q18 6.6 17.4 4.6 Q16 2.5 12 7" fill="#ffd23f" stroke="' + K + '" stroke-width="1.7"/>'),
    crown: svg('<path d="M3.5 18 L3.5 8 L8.2 12.2 L12 5 L15.8 12.2 L20.5 8 L20.5 18 Z" fill="#ffd23f" stroke="' + K + '" stroke-width="2"/><rect x="3.5" y="17" width="17" height="3.2" rx="1" fill="#e0a800" stroke="' + K + '" stroke-width="1.8"/><circle cx="12" cy="13.6" r="1.6" fill="#e8333a" stroke="' + K + '" stroke-width="1"/>'),
    heart: svg('<path d="M12 20 C5 15.2 2.8 11.6 3.6 8.4 C4.5 5 8.8 4 12 7.6 C15.2 4 19.5 5 20.4 8.4 C21.2 11.6 19 15.2 12 20 Z" fill="#ff4d6a" stroke="' + K + '" stroke-width="2.1"/><path d="M7 8.4 Q8 7 9.6 7.6" stroke="#ffd0d8" stroke-width="1.6" fill="none"/>'),
    heartOff: svg('<path d="M12 20 C5 15.2 2.8 11.6 3.6 8.4 C4.5 5 8.8 4 12 7.6 C15.2 4 19.5 5 20.4 8.4 C21.2 11.6 19 15.2 12 20 Z" fill="#3a3a46" stroke="' + K + '" stroke-width="2.1"/>'),
    bug: svg('<path d="M6 9 L3.5 7 M18 9 L20.5 7 M5.5 13 H2.8 M18.5 13 H21.2 M6 17 L3.5 19 M18 17 L20.5 19 M10 5 L8.6 2.8 M14 5 L15.4 2.8" stroke="' + K + '" stroke-width="2"/><ellipse cx="12" cy="13.5" rx="6.4" ry="7" fill="#3fd07a" stroke="' + K + '" stroke-width="2"/><path d="M12 7 V20.4" stroke="' + K + '" stroke-width="1.7"/><circle cx="12" cy="6.6" r="3" fill="#2c2c33" stroke="' + K + '" stroke-width="1.6"/><circle cx="9.4" cy="12" r="1.2" fill="' + K + '"/><circle cx="14.8" cy="15.6" r="1.2" fill="' + K + '"/>'),
    run: svg('<circle cx="14.6" cy="5" r="2.7" fill="#2c2c33" stroke="' + K + '" stroke-width="1.6"/><path d="M12.4 4.4 H17" stroke="#e8edf5" stroke-width="1.4"/><path d="M13.6 8.4 L10.6 13.6 L14 16.4 L12.6 21 M10.6 13.6 L6.4 16.8 M13 9.6 L17.4 12 M12.6 9.8 L8.4 10.4" stroke="' + K + '" stroke-width="2.8" fill="none"/><path d="M2.8 9 H6 M1.8 12.6 H4.6" stroke="#4fa3ff" stroke-width="1.8"/>'),
    jump: svg('<path d="M12 3 L18.6 10.2 H14.6 V14 H9.4 V10.2 H5.4 Z" fill="#3fd07a" stroke="' + K + '" stroke-width="2"/><path d="M12 11 L17.2 16.6 H14 V19 H10 V16.6 H6.8 Z" fill="#a6f0c0" stroke="' + K + '" stroke-width="1.8"/><path d="M5 21.4 H19" stroke="' + K + '" stroke-width="2"/>'),
    wall: svg('<rect x="13" y="2.5" width="8" height="19" fill="#c58a5a" stroke="' + K + '" stroke-width="2"/><path d="M13 7.2 H21 M13 12 H21 M13 16.8 H21 M17 2.5 V7.2 M17 12 V16.8 M15 7.2 V12 M19 7.2 V12 M15 16.8 V21.5 M19 16.8 V21.5" stroke="' + K + '" stroke-width="1.3"/><circle cx="8.6" cy="9" r="2.6" fill="#2c2c33" stroke="' + K + '" stroke-width="1.5"/><path d="M8.8 12 L10.6 15.6 L12.6 14 M9.6 13.6 L6.4 17 M10.4 12.6 L12.6 9.8" stroke="' + K + '" stroke-width="2.4" fill="none"/><path d="M5.2 4.6 L3.6 3 M4.4 7.4 L2.4 7" stroke="#ffd23f" stroke-width="1.6"/>'),
    dash: svg('<path d="M9 5.5 L17.5 12 L9 18.5 Z" fill="#4fa3ff" stroke="' + K + '" stroke-width="2.1"/><path d="M14.4 5.5 L22 12 L14.4 18.5" fill="none" stroke="' + K + '" stroke-width="2.1"/><path d="M2 8.6 H6.6 M1.4 12 H7 M2 15.4 H6.6" stroke="' + K + '" stroke-width="2"/>'),
    slash: svg('<path d="M5 19 L17.5 6.5" stroke="' + K + '" stroke-width="5"/><path d="M5 19 L17.5 6.5" stroke="#e8edf5" stroke-width="2.6"/><path d="M17.5 6.5 L20.2 3.8 L20.6 4.2" stroke="' + K + '" stroke-width="2"/><path d="M3.2 13.6 L7.8 18.2 M4.6 20.6 L2.2 18.2" stroke="' + K + '" stroke-width="2.4"/><path d="M8 3.4 Q16 1.8 21 9" fill="none" stroke="#e8333a" stroke-width="2"/>'),
    flag: svg('<path d="M5.5 21.5 V3" stroke="' + K + '" stroke-width="2.6"/><path d="M6 3.6 H18.4 L15.6 7.6 L18.4 11.6 H6 Z" fill="#e8333a" stroke="' + K + '" stroke-width="2"/><circle cx="11" cy="7.6" r="1.8" fill="#fff" stroke="' + K + '" stroke-width="1.1"/><path d="M2.6 21.5 H9" stroke="' + K + '" stroke-width="2.2"/>'),
    spark: svg('<path d="M12 2.6 L14 9.6 L21 12 L14 14.4 L12 21.4 L10 14.4 L3 12 L10 9.6 Z" fill="#ffd23f" stroke="' + K + '" stroke-width="1.8"/><path d="M19 3.4 L19.7 5.3 L21.6 6 L19.7 6.7 L19 8.6 L18.3 6.7 L16.4 6 L18.3 5.3 Z" fill="#fff" stroke="' + K + '" stroke-width="1"/>'),
    star: svg('<path d="M12 2.8 L14.7 8.4 L20.8 9.2 L16.3 13.4 L17.5 19.4 L12 16.4 L6.5 19.4 L7.7 13.4 L3.2 9.2 L9.3 8.4 Z" fill="#ffd23f" stroke="' + K + '" stroke-width="2"/>'),
    fire: svg('<path d="M12 21.2 C7 21.2 4.8 17.6 5.4 13.8 C6 10.2 9 8.6 9.2 4.4 C12.4 6.4 13.4 9 13.2 11 C14.4 10.2 15 8.8 14.8 7.4 C18 9.8 19.6 13.6 18.6 16.6 C17.8 19.4 15.4 21.2 12 21.2 Z" fill="#ff7a2a" stroke="' + K + '" stroke-width="2"/><path d="M12 20.6 C9.6 20.6 8.6 18.8 9 17 C9.4 15.4 11 14.6 11.2 12.6 C13.2 14 14.6 15.8 14.4 17.6 C14.2 19.4 13.4 20.6 12 20.6 Z" fill="#ffd23f"/>'),
    share: svg('<circle cx="18" cy="5.6" r="3" fill="#4fa3ff" stroke="' + K + '" stroke-width="1.8"/><circle cx="6" cy="12" r="3" fill="#4fa3ff" stroke="' + K + '" stroke-width="1.8"/><circle cx="18" cy="18.4" r="3" fill="#4fa3ff" stroke="' + K + '" stroke-width="1.8"/><path d="M8.6 10.6 L15.4 7 M8.6 13.4 L15.4 17" stroke="' + K + '" stroke-width="2"/>'),
    vs: svg('<path d="M3 5 L7 17 L11 5" fill="none" stroke="' + K + '" stroke-width="4.2"/><path d="M3 5 L7 17 L11 5" fill="none" stroke="#e8333a" stroke-width="2"/><path d="M20.4 6.4 Q19 4.6 16.6 5 Q14 5.6 14.4 8 Q14.8 10 17.4 10.8 Q20.4 11.8 20 14.6 Q19.4 17.4 16.2 17 Q14 16.6 13.4 14.8" fill="none" stroke="' + K + '" stroke-width="4.2"/><path d="M20.4 6.4 Q19 4.6 16.6 5 Q14 5.6 14.4 8 Q14.8 10 17.4 10.8 Q20.4 11.8 20 14.6 Q19.4 17.4 16.2 17 Q14 16.6 13.4 14.8" fill="none" stroke="#4fa3ff" stroke-width="2"/>'),
    target: svg('<circle cx="12" cy="12" r="9" fill="#fff" stroke="' + K + '" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="#e8333a" stroke="' + K + '" stroke-width="1.6"/><circle cx="12" cy="12" r="2.8" fill="#fff" stroke="' + K + '" stroke-width="1.4"/>')
  };
  window.__cnIcons = M;
  window.__cnI = function (n) { var G = {}; try { G = (0, eval)('ICONS'); } catch (_) {} var s = M[n] || G[n] || ''; return '<i class="ic cnI">' + s + '</i>'; };
  var st = document.createElement('style');
  st.textContent = '.ic.cnI{display:inline-block;width:1.2em;height:1.2em;vertical-align:-.25em;line-height:0}.ic.cnI svg{width:100%;height:100%;display:block}' +
    '.cnBig .ic.cnI{width:64px;height:64px;vertical-align:middle}.cnCard h3 .ic.cnI{width:1.25em;height:1.25em}' +
    '#cnMenu .mid .ic.cnI{width:26px !important;height:26px !important}#bossLives .ic.cnI{width:18px;height:18px;margin-left:2px}.bzX .ic.cnI{width:18px;height:18px}';
  (document.head || document.documentElement).appendChild(st);
})();

// ── 재미 업그레이드: 도전장(친구 대결) + 자랑 카드, 주간 시즌 랭킹, 손맛 (매일 미션은 게임에 원래 있는 것을 써요) ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var I = function (n) { return window.__cnI ? window.__cnI(n) : ''; };
  function sfx(n) { try { E('SFX')[n || 'click'](); } catch (_) {} }
  function h(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function kst() { return new Date(Date.now() + 9 * 3600e3); }
  function today() { return kst().toISOString().slice(0, 10); }
  function weekId(off) { var d = kst(); d.setUTCHours(0, 0, 0, 0); var wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd - 7 * (off || 0)); return d.toISOString().slice(0, 10); }
  function persist() { try { E('persist')(); } catch (_) {} try { E('refreshLobby')(); } catch (_) {} try { var w = document.getElementById('wallet'); if (w) w.textContent = E('save').coins; } catch (_) {} }
  function toast(t) { try { E('showToast')(t, '#ffe27a'); } catch (_) {} }
  function fbx() { return window.__cnFb ? window.__cnFb() : Promise.reject('no fb'); }
  function fmt(t) { return (Math.round(t * 10) / 10).toFixed(1) + '초'; }
  function nick() { try { var sv = E('save'); if (sv && sv.nick) return sv.nick; var r = E('SRV'); if (r && r.nick) return r.nick; } catch (_) {} return '닌자'; }
  function overlay(html) {
    var o = document.createElement('div'); o.className = 'cnOv'; o.innerHTML = '<div class="cnCard">' + html + '</div>';
    o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
    document.body.appendChild(o); return o;
  }
  var css = document.createElement('style');
  css.textContent = [
    '.cnShareRow{display:flex;gap:8px;margin-top:8px}.cnShareRow button{flex:1;border:3px solid #141418;border-radius:14px;padding:10px 6px;font:inherit;font-size:16px;color:#fff;background:#3d7bff;box-shadow:0 4px 0 #141418;cursor:pointer}',
    '.cnShareRow button.y{background:#ffb02e;color:#3a2400}',
    '.cnVsLine{border-radius:12px;padding:9px 10px;margin:8px 0 2px;font-size:15.5px;text-align:center;border:2px solid #141418}',
    '.cnWk{background:#2b3a6b;color:#fff;border:3px solid #141418;border-radius:14px;padding:10px;font:inherit;font-size:16px;width:100%;margin-bottom:10px;cursor:pointer;box-shadow:0 4px 0 #141418}',
    '.cnChamp{display:flex;gap:6px;justify-content:center;margin:6px 0 10px;flex-wrap:wrap}.cnChamp span{background:#fff4dc;border:2px solid #141418;border-radius:12px;padding:4px 8px;font-size:13.5px}',
    '.cnPop{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);z-index:70;pointer-events:none;font:900 34px Jua,sans-serif;color:#fff;-webkit-text-stroke:2px #141418;text-shadow:0 4px 0 #141418;animation:cnPop .7s ease-out forwards}',
    '@keyframes cnPop{0%{transform:translate(-50%,-50%) scale(.4);opacity:0}25%{transform:translate(-50%,-50%) scale(1.25);opacity:1}100%{transform:translate(-50%,-90%) scale(1);opacity:0}}'
  ].join('');
  document.head.appendChild(css);

  // ───── 1. 주간 시즌 점수 ─────
  function addWeek(pts) {
    var sv = E('save'), w = weekId(0); if (!sv.cnWk || sv.cnWk.w !== w) sv.cnWk = { w: w, p: 0 };
    sv.cnWk.p += pts; persist();
    var p = sv.cnWk.p;
    fbx().then(function (x) { var u = x.auth.currentUser; if (!u || window.__cnAdmin) return; return x.F.setDoc(x.F.doc(x.db, 'ranks', u.uid), { wk: w, wp: p }, { merge: true }); }).catch(function () {});
  }
  function weekRows(w) {
    return fbx().then(function (x) {
      var me = x.auth.currentUser && x.auth.currentUser.uid;
      return x.F.getDocs(x.F.query(x.F.collection(x.db, 'ranks'), x.F.where('wk', '==', w))).then(function (snap) {
        return snap.docs.map(function (d) { var v = d.data(); return { uid: d.id, n: v.nick || '닌자', p: Number(v.wp) || 0, me: d.id === me }; }).filter(function (r) { return r.p > 0; }).sort(function (a, b) { return b.p - a.p; });
      });
    });
  }
  function openWeek() {
    var sv = E('save'), w = weekId(0), mine = sv.cnWk && sv.cnWk.w === w ? sv.cnWk.p : 0;
    var end = new Date(w + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 7); var left = Math.max(0, Math.ceil((end - kst()) / 86400000));
    var o = overlay('<h3>' + I('trophy') + ' 이번 주 시즌</h3><p style="font-size:13.5px">월요일마다 새로 시작해요 · ' + left + '일 남음<br>처음 깨는 판 10점 · 다시 깨기 3점 · 보스 30점 · 오늘의 도전 20점</p>' +
      '<p>내 점수: <b>' + mine + '점</b></p><div style="font-size:13px;color:#8a8270">지난주 챔피언</div><div class="cnChamp" id="cnChamp"><span>불러오는 중…</span></div>' +
      '<div class="cnList" id="cnWkList"><div><span>순위 불러오는 중…</span></div></div><div class="cnRow"><button class="cnB alt" data-w="x">닫기</button></div>');
    o.addEventListener('click', function (e) { if (e.target.closest('[data-w]')) { sfx(); o.remove(); } });
    weekRows(w).then(function (rows) {
      var el = document.getElementById('cnWkList'); if (!el) return;
      el.innerHTML = rows.length ? rows.slice(0, 20).map(function (r, i) { return '<div class="' + (r.me ? 'me' : '') + '"><span>' + (i < 3 ? I('medal' + (i + 1)) : (i + 1) + '.') + ' ' + h(r.n) + '</span><b>' + r.p + '점</b></div>'; }).join('') : '<div><span>이번 주 첫 점수를 올려 보세요!</span></div>';
    }).catch(function () { var el = document.getElementById('cnWkList'); if (el) el.innerHTML = '<div><span>순위는 로그인하면 볼 수 있어요</span></div>'; });
    weekRows(weekId(1)).then(function (rows) {
      var el = document.getElementById('cnChamp'); if (!el) return;
      el.innerHTML = rows.length ? rows.slice(0, 3).map(function (r, i) { return '<span>' + I('medal' + (i + 1)) + ' ' + h(r.n) + ' · ' + r.p + '점</span>'; }).join('') : '<span>지난주 기록이 없어요</span>';
    }).catch(function () { var el = document.getElementById('cnChamp'); if (el) el.innerHTML = '<span>-</span>'; });
  }
  window.__openWeek = openWeek;

  // ───── 3. 손맛: 처치할 때 터지는 효과, 콤보 글자, 아슬아슬 피하기 ─────
  function pop(t) { var d = document.createElement('div'); d.className = 'cnPop'; d.textContent = t; (document.getElementById('wrap') || document.body).appendChild(d); setTimeout(function () { d.remove(); }, 750); }
  var combo = 0, lastK = 0, near = new WeakMap(), nearCD = 0;
  var hookK = setInterval(function () {
    var ok; try { ok = typeof E('onKill') === 'function'; } catch (_) { ok = false; } if (!ok) return; clearInterval(hookK);
    var oKill = E('onKill');
    window.onKill = function (p, x, y, e, how) {
      var r = oKill.apply(this, arguments);
      try {
        var now = performance.now(); combo = now - lastK < 2500 ? combo + 1 : 1; lastK = now;
        E('kick')(4 + Math.min(combo, 6), 0.05, 0.05);
        E('sparks')(x, y, 14 + combo * 2, combo >= 5 ? '#ffd84a' : '#ffffff', 180);
        E('ring')(x, y, 'rgba(255,255,255,.85)', 30 + combo * 4);
        if (combo === 3) pop('3 COMBO!'); else if (combo === 5) { pop('5 COMBO!'); } else if (combo === 10) pop('10 COMBO!!');
      } catch (_) {}
      return r;
    };
  }, 300);
  (function nearLoop() {
    try {
      if (E('mode') === 'play') {
        var P = E('P'), en = E('enemies');
        if (nearCD > 0) nearCD--;
        if (P && !P.dead && en && !(P.invT > 0)) for (var i = 0; i < en.length; i++) {
          var e = en[i]; if (e.dead) continue;
          var dx = Math.abs((e.x + e.w / 2) - (P.x + P.w / 2)) - (e.w + P.w) / 2, dy = Math.abs((e.y + e.h / 2) - (P.y + P.h / 2)) - (e.h + P.h) / 2;
          if (dx < 7 && dy < 7 && dx > -2 && dy > -2 && !near.has(e)) near.set(e, performance.now());
        }
        if (en) for (var j = 0; j < en.length; j++) {
          var q = en[j], t0 = near.get(q);
          if (t0 && t0 > 0 && performance.now() - t0 > 350) {
            near.set(q, -1);
            if (!q.dead && !P.dead && nearCD <= 0) { nearCD = 40; E('floatText')(P.x + P.w / 2, P.y - 30, '아슬! +1', '#9dffb0', 16); E('bonusCoins += 1'); try { E('tone')(1200, 0.08, 'triangle', 0.05, 1600); } catch (_) {} }
          }
        }
      }
    } catch (_) {}
    requestAnimationFrame(nearLoop);
  })();

  // ───── 4. 도전장(친구 대결) + 자랑 카드 ─────
  var vs = null, deaths0 = 0;
  function enc(s) { try { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch (_) { return ''; } }
  function dec(s) { try { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); } catch (_) { return '닌자'; } }
  function link(i, t) { return location.origin + location.pathname.replace(/[^/]*$/, '') + '?vs=' + i + '.' + Math.round(t * 10) + '.' + enc(nick().slice(0, 10)); }
  function card(i, t, rankN) {
    var cv = document.createElement('canvas'); cv.width = 720; cv.height = 960; var c = cv.getContext('2d'), S = E('STAGES')[i] || {};
    var g = c.createLinearGradient(0, 0, 0, 960); g.addColorStop(0, '#2e3b6b'); g.addColorStop(1, '#3f9a5a'); c.fillStyle = g; c.fillRect(0, 0, 720, 960);
    c.fillStyle = 'rgba(255,255,255,.08)'; for (var k = 0; k < 9; k++) { c.beginPath(); c.ellipse(80 + k * 80, 880 - (k % 3) * 30, 90, 30, 0, 0, 6.283); c.fill(); }
    c.textAlign = 'center'; c.lineJoin = 'round';
    function txt(s, y, size, col, sw) { c.font = size + 'px Jua, sans-serif'; c.lineWidth = sw || 10; c.strokeStyle = '#141418'; c.strokeText(s, 360, y); c.fillStyle = col; c.fillText(s, 360, y); }
    txt('구름발 닌자', 110, 64, '#fff');
    txt('STAGE ' + (i + 1) + ' · ' + (S.name || ''), 190, 34, '#fff3c4', 7);
    c.fillStyle = '#fffaf0'; c.strokeStyle = '#141418'; c.lineWidth = 8; c.beginPath(); c.roundRect ? c.roundRect(110, 560, 500, 230, 30) : c.rect(110, 560, 500, 230); c.fill(); c.stroke();
    c.font = '34px Jua, sans-serif'; c.fillStyle = '#6a6070'; c.fillText(nick() + '의 기록', 360, 615);
    c.font = '96px Jua, sans-serif'; c.fillStyle = '#2b2b3a'; c.fillText(fmt(t), 360, 715);
    if (rankN) { c.font = '34px Jua, sans-serif'; c.fillStyle = '#e8333a'; c.fillText(rankN, 360, 765); }
    txt('나를 이겨 봐!', 880, 54, '#ffd23f');
    return new Promise(function (res) {
      var done = function () { cv.toBlob(function (b) { res(b); }, 'image/png'); };
      try {
        var sv = E('save');
        (window.__charSrc ? window.__charSrc(sv.cnChar || 'basic') : Promise.reject()).then(function (src) {
          var im = new Image(); im.onload = function () { var hh = 300, ww = hh * im.width / im.height; c.drawImage(im, 360 - ww / 2, 230, ww, hh); done(); }; im.onerror = done; im.src = src;
        }).catch(done);
      } catch (_) { done(); }
    });
  }
  window.__cnCard = card;
  function shareRun(i, t, rankN, btn) {
    var url = link(i, t), text = '구름발 닌자 STAGE ' + (i + 1) + '을 ' + fmt(t) + '에 깼어! 나를 이겨 봐';
    btn.disabled = true;
    card(i, t, rankN).then(function (blob) {
      var file = blob ? new File([blob], 'gureumbal-ninja.png', { type: 'image/png' }) : null;
      var data = { title: '구름발 닌자 도전장', text: text, url: url };
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
      if (navigator.share) return navigator.share(data).catch(function () {});
      if (blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gureumbal-ninja.png'; a.click(); }
      return (navigator.clipboard ? navigator.clipboard.writeText(text + ' ' + url) : Promise.reject()).then(function () { toast('자랑 카드를 저장하고 도전장 링크를 복사했어요'); }, function () { prompt('도전장 링크를 복사해서 보내 주세요', url); });
    }).then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
  }
  // 받은 도전장
  var q = /[?&]vs=(\d+)\.(\d+)\.([A-Za-z0-9_-]+)/.exec(location.search);
  if (q) {
    var inv = { idx: +q[1], t: +q[2] / 10, nick: dec(q[3]) };
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    var waitVs = setInterval(function () {
      var ok = false; try { ok = E('mode') === 'lobby' && E('STAGES').length > inv.idx && !(document.getElementById('login') && !document.getElementById('login').classList.contains('hide')) && document.getElementById('cnMenu'); } catch (_) {}
      if (!ok) return; clearInterval(waitVs);
      var S = E('STAGES')[inv.idx];
      var o = overlay('<div class="cnBig">' + I('vs') + '</div><h3>도전장이 왔어요!</h3><p><b>' + h(inv.nick) + '</b> 님이<br><b>STAGE ' + (inv.idx + 1) + ' · ' + h(S.name) + '</b>을<br><b style="font-size:22px;color:#e8333a">' + fmt(inv.t) + '</b>에 깼어요</p><p style="font-size:14px">이 기록을 이겨 보세요! (아직 안 열린 판도 할 수 있어요)</p>' +
        '<div class="cnRow"><button class="cnB alt" data-v="x">나중에</button><button class="cnB" data-v="go">도전!</button></div>');
      o.addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (!b) return; sfx(); o.remove(); if (b.dataset.v === 'go') { vs = inv; try { E('goStage')(inv.idx); } catch (_) {} } });
    }, 500);
  }

  // ───── 판 깨기 연결: 미션, 시즌 점수, 도전장 결과, 자랑 버튼 ─────
  var hook = setInterval(function () {
    var cs, st; try { cs = E('clearStage'); st = E('startStage'); } catch (_) { return; }
    if (typeof cs !== 'function' || typeof st !== 'function' || !window.__openVillage) return; clearInterval(hook);
    window.startStage = function (i) { if (vs && i !== vs.idx) vs = null; try { deaths0 = E('deaths') || 0; } catch (_) { deaths0 = 0; } return st.apply(this, arguments); };
    window.clearStage = function () {
      var i = E('stageIdx'), sv = E('save'), endless = E('ENDLESS'), first = !(sv.best && sv.best['s' + i]), unl = sv.unlocked;
      var gc = 0, gs = 0, dd = 0, dailyWas = sv.cnDaily; try { gc = E('gotCoins') || 0; gs = E('gotScrolls') || 0; dd = (E('deaths') || 0) - deaths0; } catch (_) {}
      var mine = vs && vs.idx === i ? vs : null;
      var r = cs.apply(this, arguments);
      if (endless) return r;
      try {
        if (mine && i >= unl && sv.unlocked > unl) { sv.unlocked = unl; persist(); }
        var t = E('runTime'), S = E('STAGES')[i] || {};
        addWeek(first ? 10 : 3); if (i % 25 === 24) addWeek(30);
        setTimeout(function () { if (E('save').cnDaily === today() && dailyWas !== today()) addWeek(20); }, 50);
        setTimeout(function () {
          var cardEl = document.getElementById('mcard'); if (!cardEl) return;
          if (mine) {
            var nx = cardEl.querySelector('[data-act="next"]'); if (nx) nx.remove();
            var win = t < mine.t, d = Math.abs(t - mine.t);
            var line = document.createElement('div'); line.className = 'cnVsLine'; line.style.background = win ? '#e4fbe4' : '#ffe8e8';
            line.innerHTML = I('vs') + ' ' + (win ? '<b>승리!</b> ' + h(mine.nick) + ' 님보다 ' + fmt(d) + ' 빨라요' : '<b>아쉽다!</b> ' + h(mine.nick) + ' 님보다 ' + fmt(d) + ' 느려요. 다시!');
            var earn0 = cardEl.querySelector('.earn'); earn0 ? earn0.after(line) : cardEl.appendChild(line);
            if (win) { try { E('SFX').mission(); } catch (_) {} pop('승리!'); }
          }
          if (cardEl.querySelector('.cnShareRow')) return;
          var row = document.createElement('div'); row.className = 'cnShareRow';
          row.innerHTML = '<button class="y">' + I('share') + ' 자랑 · 도전장 보내기</button>';
          var b = E('save').best['s' + i], RK = null; try { RK = b && E('RANKS')[b.rank]; } catch (_) {}
          row.firstChild.addEventListener('click', function (ev) { ev.stopPropagation(); sfx(); shareRun(i, t, RK ? RK.n : '', row.firstChild); });
          var btns = cardEl.querySelector('.row2'); btns ? btns.parentNode.insertBefore(row, btns) : cardEl.appendChild(row);
        }, 1750);
      } catch (_) {}
      return r;
    };
  }, 300);

  // ───── 랭킹 창에 시즌 버튼 ─────
  var hook2 = setInterval(function () {
    var rk = document.getElementById('btnRank'); if (!rk) return; clearInterval(hook2);
    function addWk() {
      var body = document.getElementById('sheetBody'); if (!body || body.querySelector('.cnWk')) return;
      var b = document.createElement('button'); b.className = 'cnWk'; b.innerHTML = I('trophy') + ' 이번 주 시즌 랭킹 보기';
      b.addEventListener('click', function () { sfx(); try { E('closeSheet')(); } catch (_) {} setTimeout(openWeek, 200); });
      body.insertBefore(b, body.firstChild);
    }
    rk.addEventListener('click', function () { [80, 600, 1500, 3000].forEach(function (ms) { setTimeout(addWk, ms); }); });
  }, 400);
})();

// ── 캐릭터 특수능력 + 떠돌이 상인 (캐릭터는 상인에게서만 사요, 관리자 캐릭터 제외) ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var I = function (n) { return window.__cnI ? window.__cnI(n) : ''; };
  function sfx(n) { try { E('SFX')[n || 'click'](); } catch (_) {} }
  function persist() { try { E('persist')(); } catch (_) {} try { E('refreshLobby')(); } catch (_) {} try { var w = document.getElementById('wallet'); if (w) w.textContent = E('save').coins; } catch (_) {} }
  function toast(t) { try { E('showToast')(t, '#ffe27a'); } catch (_) {} }
  function charId() { try { return E('save').cnChar || 'basic'; } catch (_) { return 'basic'; } }

  // ───── 1. 특수능력: 판을 시작할 때마다 능력치(CST)에 더해요 ─────
  var ABIL = {
    snow: function (c) { c.wallJ = (c.wallJ || 1) * 1.18; },
    fire: function (c) { c.run *= 1.15; },
    wave: function (c) { c.jump *= 1.07; },
    bamboo: function (c) { c.air = (c.air || 1) + 1; },
    bolt: function (c) { c.dashV *= 1.22; c.dashT *= 1.15; },
    sakura: function (c) { c.smart = true; },
    shadow: function () { try { var p = E('P'); if (p) p.shield = true; } catch (_) {} },
    gold: function () {}
  };
  (function abil() {
    try {
      var c = E('CST');
      if (c && c.run && !c.__cnAb) {
        c.__cnAb = 1;
        var f = ABIL[charId()];
        if (f) f(c);
        if (charId() === 'shadow') setTimeout(function () { try { var p = E('P'); if (p && !p.dead) { p.shield = true; E('floatText')(p.x + p.w / 2, p.y - 30, '그림자 방패!', '#c9a8ff', 14); } } catch (_) {} }, 600);
      }
    } catch (_) {}
    requestAnimationFrame(abil);
  })();

  // ───── 2. 떠돌이 상인 ─────
  var CHANCE = 0.2, merchant = null;
  function stockOf() {
    var all = (window.__cnNinjas ? window.__cnNinjas() : []) || [], own = window.__cnOwned ? window.__cnOwned('char') : [];
    var left = all.filter(function (x) { return x.id !== 'basic' && !x.admin && own.indexOf(x.id) < 0; });
    for (var i = left.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = left[i]; left[i] = left[j]; left[j] = t; }
    return left.slice(0, 3);
  }
  function spawn() {
    merchant = null;
    try {
      if (E('ENDLESS')) return;
      var i = E('stageIdx'); if (i < 2 || i % 25 === 24) return;      // 연습 판과 보스 판에는 안 나와요
      if (Math.random() >= CHANCE) return;
      if (!stockOf().length) return;                                    // 캐릭터를 다 가졌으면 안 나와요
      var cps = E('cps'), T = E('T'), W = E('W'), tile = E('tileAt'), solid = function (tx, ty) { var c = tile(tx, ty); return c === '#' || c === '=' || c === 'X'; }, open = function (tx, ty) { var c = tile(tx, ty); return !c || c === '.' || c === ' '; };
      if (!cps || !cps.length) return;
      var cp = cps[Math.floor(cps.length / 2)];
      var fy = cp.y, ty = Math.floor((fy + 2) / T), x = null;
      [34, -34, 58, -58].some(function (dx) { var mx = cp.x + dx; if (mx < T * 1.5 || mx > W - T * 1.5) return false; if (solid(Math.floor(mx / T), ty) && open(Math.floor(mx / T), ty - 1)) { x = mx; return true; } return false; });
      if (x == null) return;
      merchant = { x: x, y: fy, met: false, gone: 0, stock: stockOf() };
      setTimeout(function () { toast('떠돌이 상인이 이 판 어딘가에 왔어요!'); }, 1400);
    } catch (_) { merchant = null; }
  }
  window.__cnMerchant = function () { return merchant; };
  window.__cnSpawnMerchant = function (force) { var c = CHANCE; if (force) CHANCE = 1; spawn(); CHANCE = c; return merchant; };

  function toScreen(x, y) { var W = E('W'), vH = E('viewH'), cam = E('cam'), z = 1 + (E('zoomP') || 0); return [(x - W / 2) * z + W / 2, (y - vH * 0.5 - cam) * z + vH * 0.5, z]; }
  function drawMerchant() {
    if (!merchant || merchant.gone > 1) return;
    var c = E('ctx'), b = E('dpr') * E('scale'), tm = E('time'), sp = toScreen(merchant.x, merchant.y), z = sp[2];
    if (sp[1] < -60 || sp[1] > E('viewH') + 60) return;
    c.save(); c.setTransform(b, 0, 0, b, 0, 0); c.translate(sp[0], sp[1]); c.scale(z, z);
    if (merchant.gone) c.globalAlpha = Math.max(0, 1 - merchant.gone);
    var bob = Math.sin(tm * 3) * 1.5, K = '#141418';
    c.lineJoin = 'round'; c.lineWidth = 2.2; c.strokeStyle = K;
    // 그림자
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(0, 0, 16, 4, 0, 0, 6.283); c.fill();
    // 등짐
    c.fillStyle = '#9a6a3a'; c.beginPath(); c.roundRect ? c.roundRect(-20, -34 + bob, 15, 22, 4) : c.rect(-20, -34 + bob, 15, 22); c.fill(); c.stroke();
    c.strokeStyle = '#6b4424'; c.beginPath(); c.moveTo(-20, -26 + bob); c.lineTo(-5, -26 + bob); c.stroke(); c.strokeStyle = K;
    // 몸(망토)
    c.fillStyle = '#5a4a8a'; c.beginPath(); c.moveTo(-11, -2); c.quadraticCurveTo(-12, -26 + bob, 0, -28 + bob); c.quadraticCurveTo(12, -26 + bob, 11, -2); c.closePath(); c.fill(); c.stroke();
    // 얼굴
    c.fillStyle = '#f2d2a8'; c.beginPath(); c.arc(0, -33 + bob, 8, 0, 6.283); c.fill(); c.stroke();
    c.fillStyle = K; c.beginPath(); c.arc(-2.8, -33 + bob, 1.3, 0, 6.283); c.arc(2.8, -33 + bob, 1.3, 0, 6.283); c.fill();
    c.beginPath(); c.moveTo(-3, -29.5 + bob); c.quadraticCurveTo(0, -27.5 + bob, 3, -29.5 + bob); c.stroke();
    // 삿갓
    c.fillStyle = '#e0b860'; c.beginPath(); c.moveTo(-17, -37 + bob); c.lineTo(0, -50 + bob); c.lineTo(17, -37 + bob); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = '#a07a30'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-9, -40.5 + bob); c.lineTo(0, -46 + bob); c.lineTo(9, -40.5 + bob); c.stroke(); c.strokeStyle = K; c.lineWidth = 2.2;
    // 엽전 주머니
    c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(8, -12, 4.5, 0, 6.283); c.fill(); c.stroke();
    // 말풍선
    if (!merchant.met) {
      var by = -66 + Math.sin(tm * 4) * 2;
      c.fillStyle = '#fffaf0'; c.beginPath(); c.roundRect ? c.roundRect(-22, by - 13, 44, 20, 8) : c.rect(-22, by - 13, 44, 20); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-4, by + 7); c.lineTo(0, by + 12); c.lineTo(4, by + 7); c.fill(); c.stroke();
      c.fillStyle = '#2b2b3a'; c.font = '12px Jua, sans-serif'; c.textAlign = 'center'; c.fillText('상인', 0, by + 2);
    }
    c.restore();
  }
  function touch() {
    if (!merchant || merchant.met || merchant.gone) return;
    var p = E('P'); if (!p || p.dead || E('mode') !== 'play') return;
    var dx = (p.x + p.w / 2) - merchant.x, dy = (p.y + p.h) - merchant.y;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 30) { merchant.met = true; openShop(); }
  }
  function openShop() {
    try { E("mode = 'paused'"); } catch (_) {}
    sfx();
    var stock = merchant.stock.filter(function (x) { return window.__cnOwned('char').indexOf(x.id) < 0; });
    var o = document.createElement('div'); o.className = 'cnOv';
    function render(msg) {
      var coins = E('save').coins || 0;
      o.innerHTML = '<div class="cnCard"><h3>떠돌이 상인</h3><p style="font-size:14px">"흐흐, 귀한 닌자 옷을 가져왔지. 이번 판에서만 파는 거야!"</p>' +
        (msg ? '<p style="color:#2f7fd6;font-size:14px">' + msg + '</p>' : '') +
        '<div style="text-align:left">' + (stock.length ? stock.map(function (x) {
          var own = window.__cnOwned('char').indexOf(x.id) >= 0, no = coins < x.price;
          var pv = ''; try { pv = window.__cnPrev ? window.__cnPrev(x.id) : ''; } catch (_) {}
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px dashed #e0d4bb">' +
            '<div style="width:48px;height:48px;border-radius:12px;background:' + rgb(x.body) + ';border:2px solid #141418;flex:none;display:flex;align-items:center;justify-content:center">' + (pv ? '<img src="' + pv + '" style="max-width:44px;max-height:44px">' : '') + '</div>' +
            '<div style="flex:1;font-size:14px"><b style="font-size:15.5px">' + x.name + '</b><br><span style="color:#6a6070">' + String(x.d).split(' · ').pop() + '</span></div>' +
            (own ? '<button class="cnB alt" data-m="eq:' + x.id + '" style="padding:8px 10px;font-size:14px">입기</button>' : '<button class="cnB' + (no ? ' alt' : '') + '" data-m="buy:' + x.id + '" style="padding:8px 10px;font-size:14px"' + (no ? ' disabled' : '') + '><i class="coin sm"></i>' + x.price + '</button>') + '</div>';
        }).join('') : '<p>오늘은 팔 물건이 없네. 다음에 또 보세!</p>') + '</div>' +
        '<p style="font-size:13px;color:#8a8270">가진 엽전 <i class="coin sm"></i>' + coins + ' · 상인은 판을 다시 하면 사라져요</p>' +
        '<div class="cnRow"><button class="cnB" data-m="x">계속 수련하기</button></div></div>';
    }
    function rgb(a) { return a ? 'rgb(' + a.join(',') + ')' : '#2c2c33'; }
    render();
    document.body.appendChild(o);
    setTimeout(function () { if (o.isConnected) render(); }, 400);   // 캐릭터 그림이 늦게 그려져도 보이게
    o.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
      var a = b.dataset.m;
      if (a === 'x') { sfx(); o.remove(); merchant.gone = 0.01; try { if (E('mode') === 'paused') E("mode = 'play'"); } catch (_) {} return; }
      var id = a.split(':')[1], it = stock.filter(function (x) { return x.id === id; })[0], sv = E('save');
      if (a.indexOf('buy:') === 0) {
        if (!it || (sv.coins || 0) < it.price) return;
        sv.coins -= it.price; var own = window.__cnOwned('char'); if (own.indexOf(id) < 0) own.push(id);
        persist(); try { E('SFX').coin(); } catch (_) {}
        render(it.name + '을(를) 샀어요! "입기"를 누르면 다음 판부터 능력이 적용돼요.');
      } else if (a.indexOf('eq:') === 0) {
        sv.cnChar = id; persist(); sfx();
        try { if (window.__cnApplyLook) window.__cnApplyLook(); } catch (_) {}
        render(it.name + ' 옷으로 갈아입었어요! (능력은 다음 판부터)');
      }
    });
  }
  (function loop() {
    try {
      if (merchant && merchant.gone > 0) merchant.gone += 0.04;
      touch();
    } catch (_) {}
    requestAnimationFrame(loop);
  })();
  var hook = setInterval(function () {
    var st, rg; try { st = E('startStage'); rg = E('renderGame'); } catch (_) { return; }
    if (typeof st !== 'function' || typeof rg !== 'function' || !window.__cnFb) return; clearInterval(hook);
    window.startStage = function () { var r = st.apply(this, arguments); try { spawn(); } catch (_) {} return r; };
    window.renderGame = function () { var r = rg.apply(this, arguments); try { drawMerchant(); } catch (_) {} return r; };
    var cs = E('clearStage');
    window.clearStage = function () {   // 황금 닌자: 판에서 주운 엽전 1.5배
      try { if (charId() === 'gold' && !E('ENDLESS')) { var g = E('gotCoins') || 0, add = Math.ceil(g * 0.5); if (add > 0) E('bonusCoins += ' + add); } } catch (_) {}
      return cs.apply(this, arguments);
    };
  }, 300);
})();

// ── 표창 던지기(애니메이션 없이) + 도감 + 친구 ──
(function () {
  var E = function (s) { return (0, eval)(s); };
  var I = function (n) { return window.__cnI ? window.__cnI(n) : ''; };
  function sfx(n) { try { E('SFX')[n || 'click'](); } catch (_) {} }
  function h(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function persist() { try { E('persist')(); } catch (_) {} try { E('refreshLobby')(); } catch (_) {} try { var w = document.getElementById('wallet'); if (w) w.textContent = E('save').coins; } catch (_) {} }
  function toast(t) { try { E('showToast')(t, '#ffe27a'); } catch (_) {} }
  function fbx() { return window.__cnFb ? window.__cnFb() : Promise.reject('no fb'); }
  function overlay(html) {
    var o = document.createElement('div'); o.className = 'cnOv'; o.innerHTML = '<div class="cnCard">' + html + '</div>';
    o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
    document.body.appendChild(o); return o;
  }
  var css = document.createElement('style');
  css.textContent = [
    '#cnStar{position:fixed;z-index:6;width:62px;height:62px;border-radius:50%;border:3px solid #141418;background:radial-gradient(circle at 40% 35%,#d9dde6,#8d94a3);box-shadow:0 4px 0 #141418;display:none;align-items:center;justify-content:center;touch-action:none;-webkit-user-select:none;user-select:none;padding:0}',
    '#cnStar img{width:40px;height:40px;pointer-events:none}#cnStar.empty{filter:grayscale(1) brightness(.7)}',
    '#cnStar .am{position:absolute;bottom:-9px;left:50%;transform:translateX(-50%);display:flex;gap:3px}#cnStar .am i{width:8px;height:8px;border-radius:50%;background:#555;border:1.5px solid #141418}#cnStar .am i.on{background:#ffd23f}',
    '#cnStar .lb{position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:11px;color:#fff;-webkit-text-stroke:.5px #141418;white-space:nowrap;text-shadow:0 1px 0 #141418}',
    '.cnDexTabs{display:flex;gap:6px;margin:6px 0 10px}.cnDexTabs button{flex:1;border:2px solid #141418;border-radius:12px;padding:7px 4px;font:inherit;font-size:14px;background:#efe6d2;cursor:pointer}.cnDexTabs button.on{background:#2b3a6b;color:#fff}',
    '.cnDexG{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.cnDexI{background:#2a1a3a;border:2px solid #141418;border-radius:12px;padding:6px 4px;color:#fff;font-size:12.5px;text-align:center}',
    '.cnDexI canvas,.cnDexI img{width:100%;height:auto;display:block;border-radius:8px}.cnDexI.no canvas,.cnDexI.no img{filter:brightness(0) invert(1) opacity(.28)}.cnDexI b{display:block;font-size:13px;margin-top:3px}.cnDexI small{color:#cfc4e8}',
    '.cnDexBar{height:10px;border-radius:6px;background:#efe6d2;overflow:hidden;margin:4px 0 10px;border:2px solid #141418}.cnDexBar i{display:block;height:100%;background:#3ccf6e}',
    '.cnFr{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid #eadfc8;font-size:14.5px;text-align:left}.cnFr .n{flex:1}.cnFr small{color:#8a8270}.cnFr button{border:2px solid #141418;border-radius:10px;background:#fff;font:inherit;font-size:13px;padding:3px 8px;cursor:pointer}',
    '.cnIn{width:100%;box-sizing:border-box;border:2px solid #141418;border-radius:12px;padding:10px;font:inherit;font-size:15px}'
  ].join('');
  document.head.appendChild(css);

  // ───── 1. 표창 ─────
  var btn = null;
  function starSrc() { try { var S = E('SPR'); if (S && S.star && S.star.src) return S.star.src; } catch (_) {} return 'sprites/star.png'; }
  function throwStar() {
    try {
      if (E('mode') !== 'play') return;
      var p = E('P'); if (!p || p.dead || p.ammo < 1 || p.starCD > 0) return;
      p.ammo -= 1; p.starCD = 0.16;
      E('shuris').push({ x: p.x + p.w / 2 + p.face * 8, y: p.y + 9, vx: p.face * 560 + p.vx * 0.3, rot: 0, life: 0.9, stuck: 0 });
      try { E('SFX').throw(); } catch (_) {}
      p.throwT = 0.36; p.slashT = 0; p.ss = 0.94;   // 새 던지기 애니메이션 (6장)
    } catch (_) {}
  }
  window.__cnThrow = throwStar;
  function makeBtn() {
    if (btn) return btn;
    btn = document.createElement('button'); btn.id = 'cnStar'; btn.type = 'button';
    btn.innerHTML = '<span class="lb">표창</span><img alt="" src="' + starSrc() + '"><span class="am"><i></i><i></i><i></i></span>';
    btn.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); throwStar(); });
    document.body.appendChild(btn); return btn;
  }
  document.addEventListener('keydown', function (e) { if ((e.code === 'KeyR' || e.code === 'KeyF') && !e.repeat) { var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; throwStar(); } });
  (function loop() {
    try {
      var m = E('mode'), b = makeBtn(), ctrl = document.getElementById('ctrl'), slash = document.getElementById('bSlash') || document.querySelector('#ctrl [data-k="s"]');
      var showing = m === 'play' && ctrl && !ctrl.classList.contains('hide') && getComputedStyle(ctrl).display !== 'none';
      if (showing && slash) {
        var r = slash.getBoundingClientRect();
        if (r.width > 0) { b.style.display = 'flex'; b.style.left = (r.left + r.width / 2 - 31) + 'px'; b.style.top = (r.top - 84) + 'px'; } else b.style.display = 'none';
      } else b.style.display = 'none';
      var p = E('P');
      if (p && showing) { var n = Math.floor(p.ammo || 0); if (b.__n !== n) { b.__n = n; b.classList.toggle('empty', n < 1); b.querySelectorAll('.am i').forEach(function (d, k) { d.classList.toggle('on', k < n); }); } }
      // 표창이 보스에 맞으면 1 데미지
      var bo = E('boss'), sh = E('shuris');
      if (bo && !bo.dead && bo.active && sh && sh.length) {
        for (var i = 0; i < sh.length; i++) {
          var s = sh[i]; if (s.stuck || s.life <= 0) continue;
          if (s.x > bo.x - 4 && s.x < bo.x + bo.w + 4 && s.y > bo.y - 4 && s.y < bo.y + bo.h + 4) { s.life = 0; if (!(bo.inv > 0)) E('bossHit')(1, E('P')); }
        }
      }
    } catch (_) {}
    requestAnimationFrame(loop);
  })();

  // ───── 2. 도감 ─────
  var MON = [
    { k: 'tanuki', n: '떠돌이 너구리', d: '좌우로 어슬렁거려요' },
    { k: 'frog', n: '뜀뛰기 개구리', d: '갑자기 폴짝 뛰어올라요' },
    { k: 'hedgehog', n: '가시 고슴도치', d: '위에서 밟으면 아파요' },
    { k: 'crow', n: '까마귀', d: '하늘을 가로질러 날아요' }
  ];
  var BOSS = [
    { n: '너구리 장군', c: '#ff6a5a' }, { n: '도토리 대장', c: '#c98a3e' }, { n: '점프 대왕', c: '#4fc36b' }, { n: '북치기 대마왕', c: '#a66bff' }
  ];
  var DEX_REWARD = 300;
  function dex() { var sv = E('save'); sv.cnDex = sv.cnDex || { m: {}, b: {} }; return sv.cnDex; }
  var pics = {};
  // 게임 그림 함수로 몬스터를 한 번 그려서 작은 그림으로 저장해요 (화면에는 안 보여요)
  function capture() {
    try {
      var cv = E('cv'), ctx = E('ctx'), b = E('dpr') * E('scale'), de = E('drawEnemy');
      MON.forEach(function (m, i) {
        if (pics[m.k]) return;
        var e = { k: m.k, x: 20, y: 20, y0: 20, w: m.k === 'crow' ? 24 : 22, h: m.k === 'frog' || m.k === 'hedgehog' || m.k === 'crow' ? 16 : 20, vx: -1, vy: 0, dir: -1, dead: 0, ph: 1, ground: true, hopT: 1 };
        ctx.save(); ctx.setTransform(b, 0, 0, b, 0, 0); ctx.clearRect(0, 0, 64, 64); de(e); ctx.restore();
        var out = document.createElement('canvas'); out.width = 120; out.height = 100;
        var c2 = out.getContext('2d'); c2.imageSmoothingEnabled = true; c2.drawImage(cv, 4 * b, 2 * b, 56 * b, 46 * b, 0, 0, 120, 100);
        var px = c2.getImageData(0, 0, 120, 100), dd = px.data; for (var q = 0; q < dd.length; q += 4) if (dd[q] < 3 && dd[q + 1] < 3 && dd[q + 2] < 3) dd[q + 3] = 0; c2.putImageData(px, 0, 0);   // 빈 바탕은 투명하게
        pics[m.k] = out.toDataURL();
      });
    } catch (_) {}
  }
  function bossPic(i) {
    var out = document.createElement('canvas'); out.width = 120; out.height = 100; var c = out.getContext('2d');
    try {
      if (i > 0 && window.__cnBossArt) {
        var K = [{ name: '도토리 대장' }, { name: '점프 대왕' }, { name: '북치기 대마왕' }][i - 1];
        c.translate(60, 92); c.scale(1.2, 1.2); window.__cnBossArt(K, c, { state: 'walk', drum: 0, face: 1, ground: true }, 0);
      } else if (pics.tanuki) {
        var im = new Image(); im.src = pics.tanuki; c.drawImage(im, 0, 0, 120, 100);
        c.fillStyle = '#ffd23f'; c.strokeStyle = '#141418'; c.lineWidth = 3; c.beginPath(); c.moveTo(42, 22); c.lineTo(42, 6); c.lineTo(52, 15); c.lineTo(60, 2); c.lineTo(68, 15); c.lineTo(78, 6); c.lineTo(78, 22); c.closePath(); c.fill(); c.stroke();
      }
    } catch (_) {}
    return out.toDataURL();
  }
  function openDex(tab) {
    capture();
    tab = tab || 'm';
    var D = dex(), own = window.__cnOwned ? window.__cnOwned('char') : [], NJ = (window.__cnNinjas ? window.__cnNinjas() : []).filter(function (x) { return !x.admin; });
    var total = MON.length + BOSS.length + NJ.length, got = MON.filter(function (m) { return D.m[m.k]; }).length + BOSS.filter(function (b) { return D.b[b.n]; }).length + NJ.filter(function (x) { return own.indexOf(x.id) >= 0; }).length;
    var body = '';
    if (tab === 'm') body = MON.map(function (m) { var n = D.m[m.k] || 0; return '<div class="cnDexI' + (n ? '' : ' no') + '"><img src="' + (pics[m.k] || '') + '"><b>' + (n ? m.n : '???') + '</b><small>' + (n ? m.d + '<br>처치 ' + n : '아직 못 만났어요') + '</small></div>'; }).join('');
    else if (tab === 'b') body = BOSS.map(function (bb, i) { var n = D.b[bb.n] || 0; return '<div class="cnDexI' + (n ? '' : ' no') + '"><img src="' + bossPic(i) + '"><b style="color:' + (n ? bb.c : '#fff') + '">' + (n ? bb.n : '???') + '</b><small>' + (n ? '물리친 횟수 ' + n : (i * 25 + 25) + '번 스테이지 근처') + '</small></div>'; }).join('');
    else body = NJ.map(function (x) { var o = own.indexOf(x.id) >= 0, pv = window.__cnPrev ? window.__cnPrev(x.id) : ''; return '<div class="cnDexI' + (o ? '' : ' no') + '"><img src="' + pv + '"><b>' + (o ? x.name : '???') + '</b><small>' + (o ? String(x.d).split(' · ').pop() : '떠돌이 상인에게서') + '</small></div>'; }).join('');
    var done = got >= total, claimed = !!D.done;
    var o = overlay('<h3>' + I('scroll') + ' 닌자 도감</h3><p style="font-size:14px;margin:2px 0">' + got + ' / ' + total + ' 발견</p><div class="cnDexBar"><i style="width:' + Math.round(got / total * 100) + '%"></i></div>' +
      (done && !claimed ? '<button class="cnB" data-dx="claim" style="width:100%;margin-bottom:10px"><i class="coin sm"></i>' + DEX_REWARD + ' 도감 완성 보상 받기</button>' : '') +
      '<div class="cnDexTabs"><button data-dt="m" class="' + (tab === 'm' ? 'on' : '') + '">몬스터</button><button data-dt="b" class="' + (tab === 'b' ? 'on' : '') + '">보스</button><button data-dt="c" class="' + (tab === 'c' ? 'on' : '') + '">닌자</button></div>' +
      '<div class="cnDexG">' + body + '</div><p style="font-size:12.5px;color:#8a8270">전부 채우면 엽전 ' + DEX_REWARD + '개를 받아요</p><div class="cnRow"><button class="cnB alt" data-dx="x">닫기</button></div>');
    o.addEventListener('click', function (e) {
      var t = e.target.closest('[data-dt]'); if (t) { sfx(); o.remove(); openDex(t.dataset.dt); return; }
      var b = e.target.closest('[data-dx]'); if (!b) return; sfx();
      if (b.dataset.dx === 'x') { o.remove(); return; }
      if (b.dataset.dx === 'claim' && !dex().done) { dex().done = 1; E('save').coins += DEX_REWARD; persist(); toast('도감 완성! 엽전 +' + DEX_REWARD); o.remove(); openDex(tab); }
    });
  }
  window.__openDex = openDex;
  var hookD = setInterval(function () {
    var ok, bd; try { ok = typeof E('onKill') === 'function'; bd = E('bossDie'); } catch (_) { ok = false; } if (!ok || typeof bd !== 'function') return; clearInterval(hookD);
    // 쓰러진 몬스터를 매 프레임 살펴서 도감에 올려요 (베기 · 밟기 · 대시 · 표창 모두)
    (function scan() {
      try {
        var en = E('enemies');
        if (en && E('mode') === 'play') for (var i = 0; i < en.length; i++) {
          var e = en[i]; if (!e.dead || e.__cnDex || !e.k) continue; e.__cnDex = 1;
          var D = dex(), first = !D.m[e.k]; D.m[e.k] = (D.m[e.k] || 0) + 1;
          if (first) setTimeout(function () { toast('도감에 새 몬스터가 등록됐어요!'); }, 300);
        }
      } catch (_) {}
      requestAnimationFrame(scan);
    })();
    window.bossDie = function () {
      try { var k = window.__bossKind ? window.__bossKind() : null, n = k ? k.name : '너구리 장군', D = dex(), first = !D.b[n]; D.b[n] = (D.b[n] || 0) + 1; if (first) setTimeout(function () { toast('도감에 ' + n + '이(가) 등록됐어요!'); }, 1200); } catch (_) {}
      return bd.apply(this, arguments);
    };
  }, 300);

  // ───── 3. 친구 ─────
  function friends() { var sv = E('save'); sv.cnFriends = sv.cnFriends || []; return sv.cnFriends; }
  function myNick() { try { var sv = E('save'); if (sv && sv.nick) return sv.nick; var r = E('SRV'); if (r && r.nick) return r.nick; } catch (_) {} return ''; }
  function openFriends(msg) {
    var o = overlay('<h3>' + I('star') + ' 친구</h3><p style="font-size:13.5px">친구의 <b>닉네임</b>으로 찾아서 추가해요. 내 닉네임: <b>' + h(myNick() || '로그인 필요') + '</b></p>' +
      '<div style="display:flex;gap:6px"><input class="cnIn" id="cnFrQ" maxlength="12" placeholder="친구 닉네임"><button class="cnB blue" id="cnFrGo" style="flex:none;padding:8px 14px">찾기</button></div>' +
      '<div id="cnFrRes" style="min-height:4px;margin:6px 0">' + (msg ? '<p style="font-size:14px;color:#2f7fd6">' + h(msg) + '</p>' : '') + '</div>' +
      '<div style="font-size:13px;color:#8a8270;text-align:left;margin-top:6px">친구 랭킹 (무한의 탑 · 이번 주 시즌)</div><div id="cnFrList"><div class="cnFr"><span class="n">불러오는 중…</span></div></div>' +
      '<div class="cnRow"><button class="cnB alt" data-fr="x">닫기</button></div>');
    var q = o.querySelector('#cnFrQ'), res = o.querySelector('#cnFrRes');
    function search() {
      var nk = q.value.trim(); if (!nk) return;
      res.innerHTML = '<p style="font-size:14px">찾는 중…</p>';
      fbx().then(function (x) {
        var me = x.auth.currentUser; if (!me) throw 'guest';
        return x.F.getDocs(x.F.query(x.F.collection(x.db, 'ranks'), x.F.where('nick', '==', nk))).then(function (snap) {
          var rows = snap.docs.filter(function (d) { return d.id !== me.uid; });
          if (!rows.length) { res.innerHTML = '<p style="font-size:14px">그 닉네임을 가진 닌자를 못 찾았어요</p>'; return; }
          res.innerHTML = rows.slice(0, 5).map(function (d) { var v = d.data(), on = friends().indexOf(d.id) >= 0; return '<div class="cnFr"><span class="n"><b>' + h(v.nick) + '</b> <small>탑 ' + (Number(v.tower) || 0) + 'm</small></span>' + (on ? '<small>이미 친구</small>' : '<button data-add="' + h(d.id) + '">추가</button>') + '</div>'; }).join('');
        });
      }).catch(function (er) { res.innerHTML = '<p style="font-size:14px">' + (er === 'guest' ? '로그인해야 친구를 찾을 수 있어요' : '찾지 못했어요. 잠시 뒤 다시 해 주세요') + '</p>'; });
    }
    o.querySelector('#cnFrGo').addEventListener('click', function () { sfx(); search(); });
    q.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') search(); });
    o.addEventListener('click', function (e) {
      var a = e.target.closest('[data-add]'); if (a) { sfx(); var F = friends(); if (F.indexOf(a.dataset.add) < 0 && F.length < 50) F.push(a.dataset.add); persist(); o.remove(); openFriends('친구로 추가했어요!'); return; }
      var r = e.target.closest('[data-del]'); if (r) { sfx(); var G = friends(), k = G.indexOf(r.dataset.del); if (k >= 0) G.splice(k, 1); persist(); o.remove(); openFriends('친구에서 뺐어요'); return; }
      if (e.target.closest('[data-fr]')) { sfx(); o.remove(); }
    });
    // 친구 랭킹
    fbx().then(function (x) {
      var me = x.auth.currentUser; var ids = friends().slice(); if (me) ids.push(me.uid);
      if (!ids.length) throw 'none';
      return Promise.all(ids.map(function (id) { return x.F.getDoc(x.F.doc(x.db, 'ranks', id)).then(function (d) { return d.exists() ? { id: id, v: d.data() } : null; }, function () { return null; }); })).then(function (list) {
        var wk = (function () { var d = new Date(Date.now() + 9 * 3600e3); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); })();
        var rows = list.filter(Boolean).map(function (r) { return { id: r.id, n: r.v.nick || '닌자', t: Number(r.v.tower) || 0, w: r.v.wk === wk ? Number(r.v.wp) || 0 : 0, me: me && r.id === me.uid }; }).sort(function (a, b) { return b.t - a.t || b.w - a.w; });
        var el = document.getElementById('cnFrList'); if (!el) return;
        el.innerHTML = rows.length > (me ? 1 : 0) ? rows.map(function (r, i) { return '<div class="cnFr"' + (r.me ? ' style="background:#fff1b8;border-radius:8px"' : '') + '><span class="n">' + (i < 3 ? I('medal' + (i + 1)) : (i + 1) + '.') + ' <b>' + h(r.n) + '</b>' + (r.me ? ' <small>(나)</small>' : '') + '<br><small>탑 ' + r.t + 'm · 이번 주 ' + r.w + '점</small></span>' + (r.me ? '' : '<button data-del="' + h(r.id) + '">빼기</button>') + '</div>'; }).join('') : '<div class="cnFr"><span class="n">아직 친구가 없어요. 닉네임으로 찾아서 추가해 보세요!</span></div>';
      });
    }).catch(function (er) { var el = document.getElementById('cnFrList'); if (el) el.innerHTML = '<div class="cnFr"><span class="n">' + (er === 'none' ? '아직 친구가 없어요. 닉네임으로 찾아서 추가해 보세요!' : '로그인하면 친구 랭킹을 볼 수 있어요') + '</span></div>'; });
    setTimeout(function () { try { q.focus(); } catch (_) {} }, 50);
  }
  window.__openFriends = openFriends;

  // ───── 로비 메뉴에 도감 · 친구 버튼 ─────
  var hookL = setInterval(function () {
    var rows = document.querySelectorAll('#cnMenu .cnMrow'); if (rows.length < 2) return; clearInterval(hookL);
    var row3 = document.createElement('div'); row3.className = 'cnMrow';
    [['btnDex', 'scroll', '도감', function () { openDex(); }], ['btnFriends', 'star', '친구', function () { openFriends(); }]].forEach(function (d) {
      var b = document.createElement('button'); b.className = 'mid'; b.id = d[0]; b.innerHTML = '<span class="lbl">' + I(d[1]) + d[2] + '</span>';
      b.addEventListener('click', function () { sfx(); d[3](); });
      rows[1].appendChild(b);
    });
  }, 400);
})();

// ── 표창 던지기 애니메이션: 새로 받은 그림 6장 (반 크기로 줄여 넣고, 원래 크기로 키워 써요) ──
(function () {
  var F = ["data:image/png;base64,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", "data:image/png;base64,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", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALEAAACgCAMAAAB0fX3JAAAAkFBMVEUmCQl9fIJeXmAgHyKmHCTf3+BAP0Kgn6YAAAABAQEzMzgsLDC0s7z7+vtERUoWFhg7PEHlIy8BAAAAAAABAAAAAAAAAADaHircIS27usSrqrIBAAAeHiDlHivDw8osBQjo6OlVVVeWlppQCw+HhotnZ2l2dnmxGSM+QEXX19dyEReQFBzAvshrDhObm6IfICJaVZhqAAAAMHRSTlMH/////////wD9//////////8vz1COrv////9w//////////////////////////87vD+YAAAPXUlEQVR42tWdCVfjOBKA3T2zu0QKlrEdJ7FD7oQA3fT//3erW6XL8QXD6L0Z6Jyfy3WpVBLJw79tJNN/ZF6W5UKPssy/M3G+WBSzwKDggz+zdN47HXHeVLO2UVTlAFr+mc0nEOeLdlw5qqaXCPT9aqYmLh1VIBusBiHEUZCOal1aIpiWeGGzouyWspHpgRCG2F20w5VBNSGx4SWY0ma3DKKyQX9J0xukvsdseP+gFPNf8qmIG03BaCWfzax+taDbdCNXQiCI3yz+pmIaYi0LQnmRz+vQs/9wyJiCQpC8dNivH0GcV0a8SI0YqlISw1y1CsHwpo5eDCcu5TdvAG+Q2DwsXyGZizJqFYz3ZpCFIo0lbtRnQ96wVljETOJI6nMZvmtQvnwgKOShxFIjsMXr2Z1mtMRtxGwj5/IzU28QIORkDDDJHGCbGTxoXwt7wEeWdw35wGkGwsgg4jwsYBsbxfRFPkAcZAG8SYODGHeRTA2cWT+shx3RW8hJFdMII+RiMLFwQKjPyLQ+g4sBoUECozQ2iL66ZKAOE9R3SL8MpU+0XxZe7RYFFu6iGkZcxWzuDq/lP+RQXovrMEnbBlEOLhnmh4E+ZjEfHCBGzjNY6EUHYBH4mgHEAlh8MzZjo8df8hHDCWOeeymco+oALAJf0Z9Yugk3TY8Nms//xelZvhlUJP1B6A7wAUu16EVcVrOhg01LEPLUJcPmFe3MaCPVIunt1cKi1OMet60ZWQaexVFanVhXvYgNMBUXvU2Xy4/z+fjxUYsxp4P9/N/xeDyfr5fLgX4TJhFsS8bqOoMBD8GPKPsQC5vDh/Oxnq/p+LXd/lqLMV/PxVirQZ/kT8/rj+OZsrvkfD6YSf9GdA6Mo8I19YPuxPxNPziUlGY97zDY67eM/HyxxcUnLhw0Y4aVevZnv7pq+mabPCr9+NUV1Az5Bib4dX28HiAIgX6NPxLELWBZKOkj4mzdk9YX+Ha7rs8HDKWXwUCMD9QPQl0otHB7EnMRH8cSK+x1fU2J5yL4dVjSdWn7EPMP204BLKi32/k51S7iBvQCqEI+orZZChHPpxy/tvUVWVLedCkcJd0TNjQtsLDGIwYuQql3UY6uH/N04rqu55OP9Rwbd4F0yagpRxLz6FGvpwee1+uzEXJmFUHLMcRMKf77GcAMOTVCJq7tDSbmSrH9FOL5+qic8o0TEysyN8OIy09TCja2mLuLm5QxiyFW6TYfQMzCB/4MuxPEF64WN+mQpavLDLTtOpKueeZPEz5qPSZWi0wQi6o5hC7KAcTnrUrYeDb56xfPNcE1CP+63co80zx53/iI9BZIuA02xbo5CVHRq37MvfGHpKhZxvuD5espm1nijZ598AldylP9K0312bXJJPmet0BSGTje7WaVLTI3rCSdDY8lXW6K2z5Fwjg7UPjjRz2n6Iw8qEj1+iCIkZVkiHEDzMIGO8sY2Sliv2kpTil5XYdVpV5fhUcmwTn1DYTvzvWK1uk96T4vRemVTbmkuA3xkRPjtrKFZO46+2+srzXOEgcLVhgh3Crvn+cPS9zrD/65VnrvVzdJr5mpWp441K/7x8fH1/kVz+L1QuNJqVQPhwPaBMT981xzaCrqbX2/ACCl3CuvmM0ur4967M8khiwFjC/1di9f/Ho8BBQGp9ePOTPJukPNIlULC51j3gxvH63xeuCmnYXrUqje2y/f1yhUAMPpj3r7AaWfpVm0HFv28W6pQ0DHNVSpF6I/PgbGUSo/W1+H1OquLNoqcBtVHU86hrw0hHD1a/VcZbPXx+DgOY+0V69cVOQPeRFH1olc0k0nyD6IcHBVmSMdHmNjj/gbsG+jciUpuhqC9UuSbiI+hgleiePjZrHbEX4DK2T9IbCFQjhSEizRLzoSs4iHqRKmhzqsF8QWceR2UAGz/51DDoaApo8yqMzILJomnZTiLFT27Gumrcmz+O2YI4LpU3vsL1NlkFgt9WJPxFXXTIgpxXYvbpYnPhsAi9sRNLqZvJprxL8U3oKsu5xX9iHeiy+cbYO2ZzmK62PURukr948197k+8cLLCkgWsLuOxGS/J2EZP16gJbEXzcPESN2kbUCRvXYL6eaw59q6EOfii84RFf0JidlrXttkTN3IPELcBPsWjIiLh14yphjzyyUkvhQQMwsiry1ujWlV7RNju3XJ7wSw7kE3PZ5HQ8IG6DG3+deYJ76kl61Uoz++qyhiPTJYanHenbiKm5Nzj/lX14+tgzsX7CvFIqCPhTRA+/lu/hjHAFLr+xnNpZ346KUi2SakFG7vX69+t1lccvXMIyb/uSvijS/i4k57Wr+eQi7kYOjlPo84jvXaRnzxRUxCPU5uP1K/mlAeTW8y9/u5jczjwOdZWIuLO8l52bOK1YSR98j7fi6wmIOT+TQJZEGtfZyN3TKZdJ7mISdEz016DhbIOdM2yPufQ6BbB8fbC8fU6KWfuQLhzQ9mMg07KsQE6BzyEiQGPMun76NXLZqH4/Z1v3+dn5HqgIS1CVaokP90J6b7o3xHID7PytGd/+XCNwVYBgKIVjWFIIPMJv+vgnq/1XP/UELRTydCxGy3QZG3NXKrFlM2KwZage16Bb8ilsbAKwxYXTVydwXrtg8up3nFqJbGq3ARC4crGw+jiLm+Ni1VFt7Kz0rFd5rFvE4Qgr02w1l/q/OImU+o2uII6d7lBsooJHRD8EBgi5gBSwHT3ShlKI70byWMjM1QYEjMgEvVeh/Q5WpCZKLKQKOIC3nJTUSXRRwBFZ3BA8+GuDWPuDLA5trLpgRNGcUkUlZWuXgYR1xK4EJ/lNlaJdeHdZv7FLxFOXa3WyFAlS6bfSRqywloKBysF1hX6wcKGBCXwpU3CnhxZw1mjHgHmpxDLLyZDxxbP8JDze1OAt+duKiAaqiGR9muqGXDYt1mGDMesVEvTJwL1Shg3VkkOTw/I3pBANxb3F99YbtHPsE+00LoxMJkuxyRYwP1xd3yoRbcO5uxukdpoRMlTL11JomhwRFr9bk1uXBWqvm+yFEGmFiZplFiZBELyQKJOiQb7HBjdz3JLlPoty9GyjjXIsY+sVrBbbnZrYvT2PTdA+YqH79femH5W3t+wdUDi5+BJLhtAGBpIWRY+pYEa5nYur/2Krm4CvEr7gyN3bnV4BQ5CTdT2BoA2d2vjbSIEKbb5qm/kKUTY5CDxMQilqBBYvobMX5ANd/IVxDTFY0CxOy3AVO9JFSyIradyShivhLKiQSjCXuZfIJwNwF2u+Bx0+kWrbA/F5o69pZpibUDB2tggrFrdoFCYS+9CBNjy+hwwDm50c8BRrpjRHTrIn2trqvsXXgL+wqwqLhRtx3QSCXEEeel8yWsiMTFq1Ck7pEwDdKzkJVEmoIItsMWcdUYmz60hf28NigjQ3mZSrT6krX6jCIObgYijuWYiNcoRXJVWBkjuAPIi53q8hbjKoVFG7EdNyo1N4TXpNI6rL0BMa5Rhh7ATvopcnJnjadaiHMvsDbGP36jbQnlqGxOXp7oCNwEQhKekJgVZPmpLzlQ7A2DJeGzMwAjUGEEckuChYs0oNF19Akq3iHFLhrPWkFyhIPppnKCjrTHW15sUaFlxrNoncXCOTgMIzi+Kj16HaSCtP7OnfatkbvT793MdeoYd1wdG7xLKGea3eR527kQHiplfX9ZPtHxftIeR6WrGBQ5my8+AakReGqcTqe3t/eXl9XqSQz+ixYxMlN0Hee/mphFkNPz8pmN5fOTHis6lkuGu3paaTVGWMZn4wp7IU9FPFtS2NWKIi9XelDUJf/3cvl0MnHbzZf6TasnOQGJWd47E7LkBEKmwELq77BqI3mJVPf2Vb28WZSTn9nEvvfpicmTSnRpcy+XL+9vpx0ob0hdlqnJbrk8RafV5aIopj4BSXdBvAnA52cj4BfIak0BN9p175j+vwW1uQSHbVUTEpsDlqiX+C0GdRe7Xac59hvVfHpDXnbuOoO7/72cijivum+jDxU4mME+P62el79B5d46eG13erOmr8l4DTYz5th+BrACDHfpCuSnpXCK72rvbgWSgt3bC7WIFyj/ZLST0Lmxk1awSsAGVpNUwirmYTQ1yaUec2RKfnIu9fT+wuRPleatV9/m3aMhZhhUjvz9AO7sRSakuf4AhrxkUUZps9CF9yUzY+l4dib5SEYDE7t4QqzyhVMRABMY8BEvMlIyZuZaqObybGQl4w+zTCPkEcTFLFiKIPJgNgvZlOuQtZonkZ9WOgGhmFQVnplzp5exlA/ykFmMJJbnmyBPihvrwCy79QLE5RIg/81DzdMzw3zmP/gwwRMIORknYr8UZLIF0RdtV3MRcCwl8DZvLDZKNRCB0iZePp/67K6IixgHgE3CsAkQE966gD3kE/UVICNxkKnoX/rsYImKmASBjWbMsFUMgnUKqBiFVOanldECS8RcqU/DzrpxC+M4hoyNI0HIKxAqzbHc+pvM/ZWAATHNrrQmjySOClmbGA6spiBVmVMuVljx7m8pZoG70hkV+//Lb+lhxhJHkO0GLL+IpeJIZfv201J6YabTUsbUx63eVQa4GK3HKGJ6/pTfC4MIHoynM6q31ROLc89KtvRf7ydrppKMSinCxAq4UR0PdlXfrs83TuP87n31pBV69fK2cxezk1FZG0EhZiC9Mo7sWJ/Jq3a/2TR8taSzgVFn3YSFHPAW9h6avDD9ku5SiVefB5MDa0Iw7KybSCLkI7uFqYX1OrV2JXT7j1PBSpoi0CQw2YnNpZ26wVm9Nc2xkG3zE3cjj5/KW/mnxySjj+UlunBsW17+8BCTsnFxgUJpIudMVeRok2SCk4SdQOIvHy1UmdBdayID+nCSKaZ5RsyRNugKOBZQPR7UOpRMM5X2FqoXgdSUBHuH5LpJ9WVVrMYmxoiERJZbTWcYNJvivuumySQlrBl2FtbzhzZkkNz90YrffBkxaG+IA5ujW+26BQiS1ZcRN7BhlsRvcG5qhcRdG/5a4goQkzaN9ApeJvh8PfEG4bvAbjMoAY04/4SMu/XQlIvwQvfXEpdqE0On1QFacC9mzqQW9Vr+n6DiHflrAt3z1H6LkMlEi2O9lozcNLVXmJ5iVWHR889ScCFjuyW0+1r6NCs3VDdDxza2nohhqkX9Osg+4e/c9CKOZE7fl1glRMXD9yZWDtFU6MpvTpyb6TXp3Yb8jxBLj4wH7b75Z4gbe3fMw/cntlqPmod/A7HJPKv84V9BLDbg0gXS/Dv8pbTugs6/yd92++TxfxQHhVTflb/FAAAAAElFTkSuQmCC", "data:image/png;base64,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", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALEAAACgCAMAAAB0fX3JAAAAkFBMVEUfICFxDhR9fIOjGSIbGxteXmKfn6R/AAC/wMDf3+AAAAABAQEzMzgrLDC0s7z7+vtCQ0kWFhflIzA7PEK6ucIBAAAAAADbIS0AAAABAAAAAAAAAADYHiqpqbDEw8odHiA+QEUtBghVVleHhorlHitNCw9nZ2qXlprp6el2dnl1EhfY2NixGiSQFRzAvsicnKIZVmpSAAAAMHRSTlP/////Cf//Av//AP3///////////8v0P+uT5Bv//////////////////////////90LOfUAAAO5ElEQVR42tWdCXfiOBKA3d0zs7uxBAhjY2PA3EdCkv//71a3S5fxlXRPvTfTJBDnc7lUVSqVlOjl3ybRV1y0oLLiwl792cRFuYo9sirTvldM0/LLiItVFjdI3oM6LXP2o+VXEBd5/FyyVScTKbUG0rGJHVwCxIZuqenUuOa4xAU0BoIxQihJEsSFv8C4gtxtmG0drEYkBsZLOCzyC46I7/c/0S/BM2zZRTSWfiluEqKV6kZY20bZqAR9yWRGhd9pPg5xmgFc1EawUnSePhtvBM2EIP5lMQbxClpDS0kQaTSNwualwh9NNpw41ddOUDeRzFlYCZCXSgydcm/iort+bT1njneWI87knZmDry9xKa6NE4T6IFexaZzwqUUzRwgwo57EeU+DQNL/JdhFLv0KrgffEGIF3JOXi40sgMnMK6S25Kg/MEbDhEDr/EuMOTyb7WYhJWe9iccBlsgZdBJoFhKiH0jUFxiNIPWzFiaR+BWslZz3IxYX7zXmHFF2UTaYMPTJvYg9wIklgXzIk3bIaFY8BxY+uexBnBpuGAfFvJdmuxDpXzPwbKeMPuoVmp1E3S8soY8YfRhcfxY/IRZKTjsSp6u4rxAiyL12oXKJXZOOlVlE3SPzACEV5/YquUHNCa5UktqJuIRzI+o5D39f7j+Px+v1+rmp5fPzejwe75fLgbok7DMepm1tIjh+hmxcpJOOC3nRy/G6mSy2QhaufCw+tvrdyeZK6Q8Oup6xxGLQSfIaebdzaNm0ttPI4z9znzCoSXthH6fojPwywza1AOWRLgFBz4u7KjtmQnzQ3bcT9uQnPYQqf7vYXO8GNnc50hEnMfBxJi2tc/SYmXINbCfDhOt7czwYyjbmc9jBtWtJUZdhd11MRhCq7MnnxeOJ+X3MIK6vHtOWmEUO9DFYxeqWF1TVd2QjtyovRh0cxXE7FrCA3m4uposA2s2LgdVYNu5wNy/hJ+bXUNdZbCd3AkwZP8VtTczzn8t2shhFydBBfmyAu0DafMtiIDEfd5vh426h1KwvtVn8BEo2zLgYQpyP4doUtPn1ZoFqJZMW5eaotae4jEPsyMexjhycGJZuPSXFqLUZj+OMfUrH2l0Im6ZFUOCUbZcctTVj3C84t5DtRXBKO674qwQEPrPaFbU149miJt6YyYXK2voq+crn0TuZWuCZmLCwtFhBZ2lHYm7Gmngh8rHtB6AEyaZIND/4W+2eC3dwSHk39oIjswRO126zojPxcTGReSNN2X/eecLOZqaVWJ9R81Ga6F8u9yNN8iciWX6u/M0ESUMmcgzumKj8yNZz1DZEb1jS5cnNwzMkegMU/yfN/z9Edh8iXhwksTYKTbzTMzxd14/auorETBE7ze4o+f34D8sk2KzENpXN4i6IZcBmwMnOU0AWZazWVhGa3VvSCE65PzcLauMTg3tx5M4CqzrLzp1TK9toS1yYD1srG+8CdYiqmfvKjVxTf3zy79fpvY3MPIcu0kWdptGz6/Y2nd62/xxIU4lea5pZ8qEePOC2ZxeOLXS8qd9guNJPwGIFRe5UYZHF3cN2quVNpImVB1k+AnK4qs/f3q4H4tH238fNB7PtDfjmjAPv/PXYvK1VcGA8mRrydvDX6YVF4OvN+vgR15NRaCPHzfbT+M7OUbHORNMu3g39b2rLnWvZ1K+0gOPUldtdFp7NZWr2HZlBqJlqoowBEFeqOh61nePdPAx3t1YvChDbqVcmuP4BbDt2GtXkerSvNJTo4njUbtiRNy8CMwyS2MCz2zQgb+KGsFqnhtRgiGPbYYhx13odhKn46ie4EWt9gYQeh5St/VRqaGPFKZklO4C8m9ULelG7VHM6/e/l4nnWR1PJOPw46O0pQyLe5XWjpE6NmXk0WdPaadfWipjZ1n3KM0JX02/mIg4JDDqm3RmebTxPRduS1VzB8guREyW7RLu2VsTMKCZTrgbiPm8EnzL2f4bfGpG3fPEsrBGzsUaub+6YZQh/gcBiZTvitzfxrFy7uNjEF7+KL0Jxt+nGYxbEaPkAxrwDri1+6UBMboLYo787jNXsN3/6icXEntr4pAWxWm5BjmtrTfwmXO9x+pw44IoPAmEqiBN3+ab0rssKR4G7dYQI4un1cNgESDDU1VuDW4vpFa4uMbZb2oBlsOWcndEo1M6Ot0EHiwFxQvggbfQVvpFHvA0thS58mnfUzrsdGyOCXhTF4VjjvUVgFHl47RCZXUXtIggK/f4DHEec+NAMvHFX4b1GYbROde13kwboTW2soBuHDRmouHJVnD2Z/OSd6hW5cKS+uIstV0V4fGyQi6viym0YcnudutWE+I0egk4Wru7zBzwJAx9jvxVnTyZsRccqFjcnN5bdZu7vJ02pkAAmnghdNC6Gr7rX3UQ3gQWyxZ7fL1J2P/LtEAdsIh/elZ7SlofU9jPkCIx5e6nbseqWCiyQic/FbXAc8BNxOpi4tCugyjXS6fHtdnubHGX9v7L6DfSXM8uYbxvkbTiLn9lEK2KGl4e6YI3JMEYusfoaHbfykdzoKlgVh4FXLwOJC+9dr3zVHW4PyOq0qW+BiPpKZN6hDZy/DCQulEXQfQJOfxCQSk33PeIvYlXejpvsZSBxqq6xsh6XqLLQiaSoFhs1CowtcFy5datA6SgdSpwJYNq4nKVuSZYkSds+N1BGse5wGLBNXArgsjavdCUCZZ51aS7FnleeYmKeDt4llMUmcJq7w20EkUWK/OVlKHHBJy+pvlbu8xDDW0xx3B/YIl7lQtG53z+Mo2Xl/VZ/jbV3rJTAZb0Cw7wtGQdZXScrxtvtJgdwWXslER4wKJ/2xa3abrvpQrwSES/V+qxDWjB4dTOHAQr2EmdZ3d6GUR2EVWLWd1MFCCrZy8uIxKmwiVwCg/5cjOESTEdmazFwlY6o49omiNtf3Bx42/I+34zVvU9IZRGuEGcz3hMHjUPrwj2NOQrP+CtkNW2rf4jTn9uSVqy31wlHnyAdIC5cFUsCa9OaznTs5I03BQTTN/3z5VjEpceKOS/W2O6zfrI4rYaxyZyPRJzrRwh9hTYUn6KfCa5/1AhIWToacYU8fgISNwyqsIaxDkmKOfsyYji1g6kvCbf6w0krNlQs0fsYRhR0btCOkZxeYlPHCOxbI5Xsv6lqNPFG/Wyc/SKYdEdu8BX141MmWyGXWOoYO35N/gz/x7Ew9SFEOqdFDf6Y97nz6EzMR4tdYPmWdCf8USj7tcK9sCZtzqjzbC9qagEh5m5y7FEx0QmodoHQIlQlznSSuN5jJN7P/zP8NIjM316FrJk+MX2B5br4QHXM2HBz8hLpCOdX5GaXag7jlg6BseMMBE2lgS0d2/u3VKGlGOPEjfosBl6/LZ1Yq8w7LUxTrQejfurYdW71DZBuY6+pfpzSEz/qnRigEGBE4lSYUD0slZPA9dAiCBvWayCTbg4u6nUCBujQt52hMmEY3C0ztzzOFxK7zCot5xuzEUj6YSVcuHKMnUmN8HFjWoX/sBVfp3spZ9g6bIjXJFDAhZFe3FHxpWfdpCWX1HbfBFfKe4cSpApZGlbOJP3m03mebI3cn50MTvm556tjX0KchlHPr++P9em0fj+bKkZmRb/8ZmJzN+d+z0Ap6WO5nHNZrk/ztZkk68iH499BzJzbea1EcTJRXy+XS6f+AYA7IY9lFfsac6mEEp8YMH+999pxjzLRKCOPRcP3+XoJWCU6U7L44oeR/mHsFF6KsG9ajX9mE1Py8rQ0RGqcmvDj/fW895QA5Lce631w9kQXvLLu3QotN36/nuZQGPQvyGoUZeq8e/84neav3iKRPMcrHvE8IXOjOncRr+/0vx/n83m/bzXHPi/p8FzOfzlVZXv/ezEWceuN9QRjX8GQAp+ovz6tz1DNJczOzz+MppBoJFdMmrf849Bq6p7CMuT5/F06jTwH6db+9bGUb61GIVaq4GmCU2cjgBXM8ojaVFxo5PWcucKzfTevDzEi5ucRzhOC0RkEXRxa2wF+ONG5D78AdTLcAS5Pp3dg++d3+l2qfBZ/RMRcDSZOnQyyzuf1+QnuVAmBY64kMouOlHvN8o89G8LcFmh0X0qvI+wiHUqcxZ7I61RczBm0nrXKsV9KZBnhpRHoyKlf8ZCZDSQuYZ0CO5GMmMi6TYCY7kq4msdJpCQSt2ZVyPPHkNN5oIqRsRiFjUqcbJk1ZhzI8bAC+f10Ws+DQqM9H3zZIOJSpQl6Ruos1GBHx8xmqAORllGAvsEzdxdh5lrJ0RAVm+uTsEGBqCQCNy3uQeT9eu5lVpahlTyIGJtuCy47YbvTBvuQDbf+yjyGzqwNfuY1Hn3OuvEQewuA9H9q4yLBppszkTMDef+Yn5Z6LgBp6f8fP3qcddOkY4TM0n31dA3bKHbLaP+61HMXaBnCTcsoMpC4rgMDg7BSddJ4XpPVUPdLzrW0p5vLWa1e5okGpRQIZg2OryjTppPrsNVQKJPAPWM+SYNeP1738HyT4ScrEm2kBnT9wMuwZaiI7pxkShOgNbfc17PvOJZoWN6m1qVBAUJW0jJzm5IvNZL1eU9Zj04O9kb5uhzjFNYUtG4CR2EXpoLISOUYZXN1KbNODImGZvPYiGrSOqCBNiHzLMNYNbXmNHmRjjn7X1nZplQxNveCgf6dUGuAqUVZPs0DR5tEI1QIYSDRS6GrlxbIkWcvwtdWWOqjWB1Xkb48RU5wHHdHHjgzVY4fxjvPMqgfWR4mVHWrvEXj1I6x/xTNRuRKLjfYfvnL625qbczIM1O//RCnt5Bov1x8G3Fa+y7dX5aGD/M11wLFklSn5aZolHo38Z4F60VmVTdd2YDT6+8jzkHiTppW8tPMbQwG8+vvJcYtgO21bgLcOPl2YtKyM75eDSTGtPV7iVVvHGnVyk8L7lns9PT8Bl/RKXRl9pJIp0XIaNT1x7L9PcI5IvneCFIjt27RzYzyi5M5fcNaExtQWYeW4pV2iHVz0+/9OzdtiHU/Q9cGst9KXFdns5c/m7hQqQg2i4Z/LnFa50Sk816L30KsKwe4x+aQ30Nchv6IzR9LbLQsrl7+DcR189xIPd7fYRjZ0xNi/zBi9hfF0j/mb7t9qfwfFOdXND3G41MAAAAASUVORK5CYII=", "data:image/png;base64,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"];
  var W = 355, H = 320, out = [], left = F.length;
  F.forEach(function (src, k) {
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, W, H);
      var big = new Image(); big.onload = function () { out[k] = big; if (--left === 0) window.__cnThr = out; }; big.src = c.toDataURL();
    };
    im.src = src;
  });
})();
