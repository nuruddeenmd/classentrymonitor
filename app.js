(function () {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const toMin = function (t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const nowMin = function () { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  const S = {
    cfg: null, user: null, all: [], entries: new Map(), tt: new Map(), teachers: new Map(),
    date: '', day: '', period: 1, manual: false, unmarkedOnly: false, tab: 'entry',
    online: navigator.onLine !== false, syncTimer: null, installEvt: null, authBad: false, skew: 0, dateOff: false,
  };

  /* ───────────── helpers ───────────── */

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function setToday() {
    const n = new Date();
    S.date = ymd(n);
    S.day = DAYS[n.getDay()];
    S.dateLabel = DAYS[n.getDay()] + ' ' + n.getDate() + ' ' + MONTHS[n.getMonth()] + ' ' + n.getFullYear();
  }

  function loadCfg(cfg) {
    S.cfg = cfg;
    S.tt = new Map();
    (cfg.timetable || []).forEach(function (r) {
      const k = r[0] + '|' + r[1] + '|' + r[2];
      if (!S.tt.has(k)) S.tt.set(k, { subject: r[3], teacher: r[4] });
    });
    S.teachers = new Map((cfg.teachers || []).map(function (t) { return [t[0], t[1]]; }));
  }

  const tName = function (code) { return S.teachers.get(code) || code || ''; };
  const lesson = function (period, cls) { return S.tt.get(S.day + '|' + period + '|' + cls); };
  const pending = function () { return S.all.filter(function (e) { return !e.synced && !e.err; }); };
  const rejected = function () { return S.all.filter(function (e) { return !e.synced && e.err; }); };

  async function reloadEntries() {
    S.all = await Core.entryAll();
    S.entries = new Map(S.all.filter(function (e) { return e.date === S.date; }).map(function (e) { return [e.key, e]; }));
  }

  // Bell times for today: rows tagged with today's day (e.g. a shorter Friday) win over the all-days rows.
  function pds() {
    const all = (S.cfg && S.cfg.periods) || [];
    const mine = all.filter(function (p) { return p.day === S.day; });
    return mine.length ? mine : all.filter(function (p) { return !p.day; });
  }
  // True on days with no timetable at all (weekends, or any day missing from the Timetable sheet).
  function noSchool() {
    const days = new Set(((S.cfg && S.cfg.timetable) || []).map(function (r) { return r[0]; }));
    return days.size > 0 && !days.has(S.day);
  }
  function periodLen(n) {
    const p = pds().find(function (x) { return x.n === n; });
    const a = p ? toMin(p.start) : null, b = p ? toMin(p.end) : null;
    return a !== null && b !== null && b > a ? b - a : 40;
  }

  function currentPeriod() {
    const ps = pds().filter(function (p) { return toMin(p.start) !== null && toMin(p.end) !== null; })
      .sort(function (a, b) { return a.n - b.n; });
    if (!ps.length) return 1;
    const m = nowMin();
    for (let i = 0; i < ps.length; i++) if (m >= toMin(ps[i].start) && m < toMin(ps[i].end)) return ps[i].n;
    const next = ps.find(function (p) { return toMin(p.start) > m; });
    return next ? next.n : ps[ps.length - 1].n;
  }

  function periodEnded(n) {
    const p = pds().find(function (x) { return x.n === n; });
    return !!p && toMin(p.end) !== null && nowMin() >= toMin(p.end);
  }

  /* ───────────── rendering ───────────── */

  function render() {
    const d = ymd(new Date());
    if (d !== S.date) { setToday(); S.manual = false; reloadEntries().then(function () { S.period = currentPeriod(); render(); }); return; }
    if (S.tab === 'admin' && !(S.user && S.user.role === 'Admin')) S.tab = 'entry';
    $('#adminTab').hidden = !(S.user && S.user.role === 'Admin');
    $('#hdrDate').textContent = S.dateLabel;
    $('#hdrUser').textContent = (S.cfg.school || 'School') + ' · ' + (S.user ? S.user.name : '');
    renderBadge();
    renderClock();
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
    $('#entryView').hidden = S.tab !== 'entry';
    $('#todayView').hidden = S.tab !== 'today';
    $('#adminView').hidden = S.tab !== 'admin';
    if (S.tab === 'entry') renderEntry(); else if (S.tab === 'today') renderToday();
  }

  function renderBadge() {
    const b = $('#syncBadge');
    const n = pending().length;
    b.className = 'badge';
    if (S.authBad) { b.classList.add('bad'); b.textContent = '! Sign in again'; }
    else if (!S.online) { b.classList.add('off'); b.textContent = 'Offline' + (n ? ' · ' + n : ''); }
    else if (n) { b.classList.add('pend'); b.textContent = '⟳ ' + n + ' to sync'; }
    else if (rejected().length) { b.classList.add('bad'); b.textContent = '⚠ ' + rejected().length + ' rejected'; }
    else b.textContent = '✓ Synced';
  }

  function renderEntry() {
    if (noSchool()) {
      $('#periodBar').innerHTML = '';
      $('#periodInfo').textContent = 'No school today';
      $('#list').innerHTML = '<div class="empty">No lessons are timetabled for ' + esc(S.day) + '.</div>';
      return;
    }
    const periods = (pds().length ? pds() : [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return { n: n }; }));
    $('#periodBar').innerHTML = periods.map(function (p) {
      const unmarked = unmarkedCount(p.n);
      const warn = periodEnded(p.n) && unmarked > 0 ? ' warn' : '';
      return '<button data-p="' + p.n + '" class="' + (p.n === S.period ? 'on' : '') + warn + '">P' + p.n + '</button>';
    }).join('');
    const cp = periods.find(function (p) { return p.n === S.period; });
    $('#periodInfo').textContent = 'Period ' + S.period + (cp && cp.start ? ' · ' + cp.start + '–' + cp.end : '');
    $('#unmarkedOnly').checked = S.unmarkedOnly;

    const past = periodEnded(S.period);
    const classes = S.cfg.classes || [];
    let html = '';
    classes.forEach(function (cls) {
      const key = S.date + '|' + S.period + '|' + cls;
      const e = S.entries.get(key);
      if (S.unmarkedOnly && e) return;
      const l = lesson(S.period, cls);
      const teacher = e && e.teacher !== undefined && e.teacher !== '' ? e.teacher : (l ? l.teacher : '');
      const subject = e && e.subject ? e.subject : (l ? l.subject : '');
      const st = e ? e.status : '';
      const lateLabel = st === 'LATE' ? 'Late ' + e.mins : 'Late';
      html += '<div class="card ' + (st ? 's-' + st : 'unmarked' + (past ? ' past' : '')) + '" data-cls="' + esc(cls) + '">' +
        '<div class="row1"><b class="cls">' + esc(cls) + '</b><span class="subj">' + esc(subject || (l ? '' : '— not in timetable —')) + '</span></div>' +
        '<div class="teach"><span>' + esc(tName(teacher) || 'No teacher set') + '</span>' +
        (e && e.cover ? '<span class="cov">Cover: ' + esc(tName(e.cover)) + '</span>' : '') +
        '<a data-act="cover">' + (e && e.cover ? 'change cover' : (teacher ? 'cover' : 'set teacher')) + '</a></div>' +
        '<div class="btns">' +
        '<button class="b ok' + (st === 'OT' ? ' on' : '') + '" data-act="OT" aria-label="On time">✓</button>' +
        '<button class="b late' + (st === 'LATE' ? ' on' : '') + '" data-act="LATE">' + esc(lateLabel) + '</button>' +
        '<button class="b abs' + (st === 'ABS' ? ' on' : '') + '" data-act="ABS" aria-label="Absent">A</button>' +
        '<button class="b none' + (st === 'NONE' ? ' on' : '') + '" data-act="NONE" aria-label="No lesson">X</button>' +
        '</div></div>';
    });
    $('#list').innerHTML = html || '<div class="empty">' + (classes.length ? 'All classes marked for this period ✓' : 'No classes loaded. Open Sync and refresh the timetable.') + '</div>';
  }

  function scheduledFor(period) {
    return (S.cfg.classes || []).filter(function (c) { return !!lesson(period, c); }).length;
  }
  function markedFor(period) {
    let n = 0;
    S.entries.forEach(function (e) { if (e.period === period) n++; });
    return n;
  }
  function unmarkedCount(period) {
    const expected = scheduledFor(period) || (S.cfg.classes || []).length;
    return Math.max(0, expected - markedFor(period));
  }

  function renderToday() {
    const ents = Array.from(S.entries.values());
    const c = { OT: 0, LATE: 0, ABS: 0, NONE: 0, mins: 0 };
    ents.forEach(function (e) { c[e.status]++; if (e.status === 'LATE') c.mins += Number(e.mins) || 0; });
    const observed = c.OT + c.LATE + c.ABS;
    let lost = c.mins;   // an absence loses the whole period (length taken from the bell times)
    ents.forEach(function (e) { if (e.status === 'ABS') lost += periodLen(e.period); });
    let h = '<div class="tot">' +
      '<div><b>' + observed + '</b><span>Lessons observed</span></div>' +
      '<div><b>' + c.OT + '</b><span>On time</span></div>' +
      '<div><b>' + c.LATE + '</b><span>Late</span></div>' +
      '<div><b>' + c.ABS + '</b><span>Absent</span></div>' +
      '<div><b>' + c.mins + '</b><span>Minutes late</span></div>' +
      '<div><b>' + lost + '</b><span>Time lost (min)</span></div></div>';
    h += '<table class="tbl"><tr><th>Period</th><th>Marked</th><th>Late</th><th>Absent</th></tr>';
    pds().forEach(function (p) {
      const pe = ents.filter(function (e) { return e.period === p.n; });
      const exp = scheduledFor(p.n) || (S.cfg.classes || []).length;
      const un = Math.max(0, exp - pe.length);
      const bad = periodEnded(p.n) && un > 0;
      h += '<tr class="go' + (bad ? ' bad' : '') + '" data-p="' + p.n + '"><td><b>P' + p.n + '</b> <span class="muted">' + esc(p.start || '') + '</span></td>' +
        '<td>' + pe.length + '/' + exp + (bad ? ' ⚠' : '') + '</td>' +
        '<td>' + pe.filter(function (e) { return e.status === 'LATE'; }).length + '</td>' +
        '<td>' + pe.filter(function (e) { return e.status === 'ABS'; }).length + '</td></tr>';
    });
    h += '</table><p class="muted" style="font-size:.8rem">Tap a period to open it. ⚠ = period ended with classes still unmarked.</p>';
    $('#todayView').innerHTML = h;
  }

  /* ───────────── marking ───────────── */

  async function mark(cls, status, mins, extra) {
    const key = S.date + '|' + S.period + '|' + cls;
    const prev = S.entries.get(key) || {};
    const l = lesson(S.period, cls) || {};
    const e = {
      key: key, date: S.date, period: S.period, cls: cls,
      subject: prev.subject || l.subject || '',
      teacher: prev.teacher !== undefined && prev.teacher !== '' ? prev.teacher : (l.teacher || ''),
      cover: prev.cover || '',
      status: status, mins: status === 'LATE' ? mins : '',
      recordedAt: new Date().toISOString(), recordedBy: S.user ? S.user.name : '', synced: 0,
    };
    if (extra) Object.assign(e, extra);
    const px = S.pendingExtra && S.pendingExtra[key];
    if (px) { Object.assign(e, px); delete S.pendingExtra[key]; }
    await Core.entryPut(e);
    S.entries.set(key, e);
    S.all = S.all.filter(function (x) { return x.key !== key; }).concat([e]);
    render();
    scheduleSync();
    regBackgroundSync();
  }

  function openModal(html) { $('#sheet').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }

  function lateModal(cls) {
    const prev = S.entries.get(S.date + '|' + S.period + '|' + cls);
    const cur = prev && prev.status === 'LATE' ? Number(prev.mins) : '';
    openModal('<h2>' + esc(cls) + ' — minutes late</h2><div class="muted">Minutes since the bell when the teacher was first in class.</div>' +
      '<div class="chips">' + [5, 10, 15, 20, 25, 30].map(function (n) { return '<button data-m="' + n + '" class="' + (cur === n ? 'on' : '') + '">' + n + '</button>'; }).join('') + '</div>' +
      '<input id="minsIn" type="number" inputmode="numeric" min="1" max="240" placeholder="Other number of minutes" value="' + (cur && [5, 10, 15, 20, 25, 30].indexOf(cur) < 0 ? cur : '') + '">' +
      '<div class="row-btns"><button id="mCancel">Cancel</button><button id="mSave" class="primary">Save</button></div>');
    const save = function (m) {
      m = Math.round(Number(m));
      if (!(m >= 1 && m <= 240)) { toast('Enter minutes between 1 and 240'); return; }
      closeModal();
      mark(cls, 'LATE', m);
    };
    $('#sheet').querySelectorAll('.chips button').forEach(function (b) { b.onclick = function () { save(b.dataset.m); }; });
    $('#mSave').onclick = function () { save($('#minsIn').value); };
    $('#mCancel').onclick = closeModal;
  }

  function coverModal(cls) {
    const key = S.date + '|' + S.period + '|' + cls;
    const prev = S.entries.get(key);
    const l = lesson(S.period, cls);
    const scheduled = (prev && prev.teacher) || (l && l.teacher) || '';
    const setting = scheduled ? 'cover teacher' : 'teacher';
    const list = Array.from(S.teachers.entries());
    const draw = function (q) {
      q = (q || '').toLowerCase();
      $('#tl').innerHTML = list.filter(function (t) { return !q || t[1].toLowerCase().indexOf(q) >= 0 || t[0].toLowerCase().indexOf(q) >= 0; })
        .map(function (t) { return '<button data-c="' + esc(t[0]) + '"><span>' + esc(t[1]) + '</span><span class="muted">' + esc(t[0]) + '</span></button>'; }).join('') || '<div class="empty">No match</div>';
      $('#tl').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          const code = b.dataset.c;
          closeModal();
          applyTeacher(cls, scheduled, code);
        };
      });
    };
    openModal('<h2>' + esc(cls) + ' — pick ' + setting + '</h2>' +
      '<input id="tq" type="search" placeholder="Search name or code"><div class="tlist" id="tl"></div>' +
      '<div class="row-btns">' + (prev && prev.cover ? '<button id="rmCover">Remove cover</button>' : '') + '<button id="mCancel">Cancel</button></div>');
    draw('');
    $('#tq').oninput = function () { draw($('#tq').value); };
    $('#mCancel').onclick = closeModal;
    if ($('#rmCover')) $('#rmCover').onclick = function () { closeModal(); applyTeacher(cls, scheduled, ''); };
  }

  async function applyTeacher(cls, scheduled, code) {
    const key = S.date + '|' + S.period + '|' + cls;
    const prev = S.entries.get(key);
    const extra = scheduled ? { cover: code } : { teacher: code, cover: '' };
    if (prev) await mark(cls, prev.status, prev.mins, extra);
    else {
      // no status yet: remember the choice, but mark as on time only when the monitor taps a status.
      toast('Now tap a status for ' + cls + ' to save the ' + (scheduled ? 'cover' : 'teacher'));
      S.pendingExtra = S.pendingExtra || {};
      S.pendingExtra[key] = extra;
    }
  }

  /* ───────────── sync ───────────── */

  /* ───────────── clock check & re-sign-in ───────────── */

  // Called only with a fresh server response (the stored copy has an out-of-date clock reading).
  function checkClock(res) {
    S.skew = res.skewMs || 0;
    S.dateOff = !!res.serverDate && res.serverDate !== ymd(new Date());
  }

  function renderClock() {
    const el = $('#clockWarn');
    const m = Math.round(Math.abs(S.skew) / 60000);
    const bad = S.dateOff || m >= 10;
    el.hidden = !bad;
    if (!bad) return;
    const amt = m >= 120 ? ' by about ' + Math.round(m / 60) + ' hours' : (m >= 10 ? ' by about ' + m + ' minutes' : '');
    el.textContent = '⚠ This phone\'s date or time looks wrong' + amt + '. Fix it in the phone Settings (set date & time to automatic), or entries may get the wrong date and period.';
  }

  function reauthModal() {
    openModal('<h2>Sign in again</h2><div class="muted">The PIN saved on this phone is no longer accepted. Your entries are safe and will sync after you sign in.</div>' +
      '<input id="rePin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" maxlength="12">' +
      '<p id="reErr" class="err"></p>' +
      '<div class="row-btns"><button id="mCancel">Cancel</button><button id="reGo" class="primary">Sign in</button></div>');
    $('#mCancel').onclick = closeModal;
    $('#reGo').onclick = async function () {
      const pin = $('#rePin').value.trim();
      const err = $('#reErr');
      if (!pin) { err.textContent = 'Enter your PIN.'; return; }
      if (!navigator.onLine) { err.textContent = 'No connection.'; return; }
      err.textContent = '';
      try {
        const res = await Core.refreshConfig(pin);
        if (res.ok) {
          loadCfg(res); S.user = res.user; S.authBad = false; checkClock(res);
          closeModal(); render(); trySync(true);
        } else if (res.error === 'auth') err.textContent = 'Wrong PIN.';
        else if (res.error === 'locked') err.textContent = 'Too many wrong PINs. Try again in 10 minutes.';
        else err.textContent = 'Server problem (' + (res.error || 'unknown') + ').';
      } catch (e) { err.textContent = 'Could not reach the server.'; }
    };
  }

  function scheduleSync() {
    clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(function () { trySync(false); }, 2500);
  }

  async function trySync(manual) {
    if (!pending().length) { if (manual) toast('Nothing to sync'); return; }
    if (S.authBad) { renderBadge(); if (manual) toast('Sign in again to sync'); return; }
    if (!navigator.onLine) { S.online = false; renderBadge(); if (manual) toast('No connection — entries are saved on this phone'); return; }
    S.online = true;
    renderBadge();
    let r;
    try { r = await Core.syncNow(); } catch (e) { r = { ok: false, error: 'network' }; }
    await reloadEntries();
    if (r.error === 'auth' || r.error === 'no_login') S.authBad = true;
    else if (r.ok) S.authBad = false;
    render();
    if (manual) {
      if (r.ok) toast('Synced ' + r.saved + ' entries ✓');
      else if (r.error === 'auth') toast('PIN not accepted — sign in again');
      else if (r.error === 'locked') toast('Too many wrong PINs. Try again in 10 minutes.');
      else if (r.rejected) toast(r.rejected + ' entries were rejected — see Sync panel');
      else toast('Could not sync — will retry. Entries are safe on this phone.');
    }
  }

  function regBackgroundSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.sync) return reg.sync.register('ce-sync'); }).catch(function () {});
  }

  async function backgroundRefresh() {
    if (!navigator.onLine || S.authBad) return;
    try {
      const before = S.cfg && S.cfg.version;
      const res = await Core.refreshConfig();
      if (res && res.ok) {
        S.authBad = false;
        S.user = res.user;
        checkClock(res); renderClock();
        if (res.version !== before) { loadCfg(res); toast('Timetable updated'); render(); }
      } else if (res && res.error === 'auth') { S.authBad = true; renderBadge(); }
    } catch (e) { /* offline or not configured: keep working with the stored copy */ }
  }

  function syncPanel() {
    Promise.all([Core.metaGet('lastSync'), Core.metaGet('configAt')]).then(function (v) {
      const n = pending().length;
      const errs = rejected();
      const fmt = function (iso) { return iso ? new Date(iso).toLocaleString() : 'never'; };
      openModal('<h2>Sync &amp; settings</h2><div class="kv">' +
        '<span>Not synced</span><span><b>' + n + '</b> entries</span>' +
        '<span>Last sync</span><span>' + esc(fmt(v[0])) + '</span>' +
        '<span>Timetable</span><span>v' + esc(S.cfg.version || '?') + ' · ' + esc(fmt(v[1])) + '</span>' +
        '<span>Connection</span><span>' + (navigator.onLine ? 'Online' : 'Offline') + '</span></div>' +
        (errs.length ? '<div class="errlist">Rejected: ' + errs.slice(0, 5).map(function (e) { return esc(e.cls + ' P' + e.period + ' (' + e.err + ')'); }).join(', ') + '</div>' : '') +
        '<div class="row-btns"><button id="pSync" class="primary">Sync now</button></div>' +
        (errs.length ? '<div class="row-btns"><button id="pRetry">Retry rejected</button><button id="pDisc">Discard rejected</button></div>' : '') +
        '<div class="row-btns"><button id="pCfg">Refresh timetable</button><button id="pExp">Share backup</button></div>' +
        '<div class="row-btns">' + (S.installEvt ? '<button id="pInst">Install app</button>' : '') + '<button id="pOut">Sign out</button><button id="pClose">Close</button></div>');
      $('#pSync').onclick = function () { closeModal(); trySync(true); };
      if ($('#pRetry')) $('#pRetry').onclick = async function () {
        for (const e of errs) { e.err = null; await Core.entryPut(e); }
        closeModal(); await reloadEntries(); render(); trySync(true);
      };
      if ($('#pDisc')) $('#pDisc').onclick = async function () {
        if (!confirm('Discard ' + errs.length + ' rejected entries? This cannot be undone.')) return;
        for (const e of errs) await Core.entryDel(e.key);
        closeModal(); await reloadEntries(); render();
      };
      $('#pCfg').onclick = async function () {
        if (!navigator.onLine) { toast('You need a connection to refresh'); return; }
        closeModal();
        await backgroundRefresh();
        toast('Timetable checked');
      };
      $('#pExp').onclick = exportBackup;
      $('#pClose').onclick = closeModal;
      $('#pOut').onclick = signOut;
      if ($('#pInst')) $('#pInst').onclick = install;
    });
  }

  async function exportBackup() {
    const rows = S.all.filter(function (e) { return !e.synced || e.date === S.date; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.period - b.period || a.cls.localeCompare(b.cls); });
    if (!rows.length) { toast('Nothing to export'); return; }
    const head = 'date,period,class,subject,teacher,cover,status,minutes_late,recorded_at,synced';
    const csv = [head].concat(rows.map(function (e) {
      return [e.date, e.period, e.cls, e.subject, e.teacher, e.cover, e.status, e.mins, e.recordedAt, e.synced ? 'yes' : 'NO']
        .map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    })).join('\n');
    const name = 'class-entry-' + S.date + '.csv';
    try {
      const file = new File([csv], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      if (navigator.share) { await navigator.share({ title: name, text: csv }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function signOut() {
    const n = pending().length;
    if (n && !confirm(n + ' entries are not synced yet. They stay on this phone and will sync after the next sign-in. Sign out anyway?')) return;
    await Core.metaDel('pin'); await Core.metaDel('config'); await Core.metaDel('user'); await Core.metaDel('authBad');
    S.authBad = false;
    S.cfg = null; S.user = null; S.tab = 'entry';
    closeModal();
    showLogin();
  }

  function install() {
    if (!S.installEvt) { toast('Use the Chrome menu ⋮ → Install app'); return; }
    S.installEvt.prompt();
    S.installEvt.userChoice.then(function () { S.installEvt = null; $('#installBtn1').hidden = true; });
  }

  /* ───────────── screens ───────────── */

  function showLogin() {
    $('#main').hidden = true;
    $('#login').hidden = false;
    $('#pin').value = '';
    $('#loginErr').textContent = '';
    $('#installBtn1').hidden = !S.installEvt;
  }

  async function doLogin() {
    const pin = $('#pin').value.trim();
    const err = $('#loginErr');
    if (!pin) { err.textContent = 'Enter your PIN.'; return; }
    if (!navigator.onLine) { err.textContent = 'No internet. You need a connection to sign in the first time.'; return; }
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
    try {
      const res = await Core.refreshConfig(pin);
      if (res.ok) {
        loadCfg(res); S.user = res.user; S.authBad = false; checkClock(res);
        await startMain();
      } else if (res.error === 'auth') err.textContent = 'Wrong PIN.';
      else if (res.error === 'locked') err.textContent = 'Too many wrong PINs. Try again in 10 minutes.';
      else err.textContent = 'Server problem (' + (res.error || 'unknown') + ').';
    } catch (e) {
      err.textContent = e && e.message === 'not_configured' ? 'App is not configured yet (config.js).' : 'Could not reach the server. Check your internet.';
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  }

  async function startMain() {
    setToday();
    await Core.prune(30).catch(function () {});
    await reloadEntries();
    S.period = currentPeriod();
    S.manual = false;
    $('#login').hidden = true;
    $('#main').hidden = false;
    render();
    if (pending().length) trySync(false);
  }

  /* ───────────── events ───────────── */

  function wire() {
    $('#loginBtn').onclick = doLogin;
    $('#pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('#installBtn1').onclick = install;
    $('#syncBadge').onclick = function () { if (S.authBad) reauthModal(); else syncPanel(); };
    $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) closeModal(); });
    document.querySelector('.tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      S.tab = b.dataset.tab; render();
      if (S.tab === 'admin' && window.Admin) window.Admin.enter();
    });
    $('#periodBar').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      S.period = Number(b.dataset.p); S.manual = true; render();
    });
    $('#unmarkedOnly').addEventListener('change', function (e) { S.unmarkedOnly = e.target.checked; renderEntry(); });
    $('#todayView').addEventListener('click', function (e) {
      const tr = e.target.closest('tr.go'); if (!tr) return;
      S.period = Number(tr.dataset.p); S.manual = true; S.tab = 'entry'; render();
    });
    $('#list').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const card = btn.closest('.card'); const cls = card.dataset.cls;
      const act = btn.dataset.act;
      if (act === 'cover') { coverModal(cls); return; }
      if (act === 'LATE') { lateModal(cls); return; }
      mark(cls, act, '');
    });

    window.addEventListener('online', function () { S.online = true; renderBadge(); trySync(false); backgroundRefresh(); });
    window.addEventListener('offline', function () { S.online = false; renderBadge(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !S.cfg) return;
      S.online = navigator.onLine;
      reloadEntries().then(function () {
        if (!S.manual) S.period = currentPeriod();
        render();
        if (pending().length) trySync(false);
        backgroundRefresh();
      });
    });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); S.installEvt = e;
      if (!$('#login').hidden) $('#installBtn1').hidden = false;
    });
    setInterval(function () {
      if (!S.cfg || document.visibilityState !== 'visible') return;
      if (!S.manual) { const p = currentPeriod(); if (p !== S.period) S.period = p; }
      if (!$('#modal').hidden) return;      // do not redraw while a dialog is open
      const sig = [S.period, ymd(new Date()), pds().map(function (p) { return periodEnded(p.n) ? 1 : 0; }).join(''), pending().length, S.online].join('|');
      if (sig !== S.lastSig) { S.lastSig = sig; render(); }
      if (pending().length && navigator.onLine) trySync(false);
    }, 60000);
  }

  /* ───────────── bridge for admin.js ───────────── */

  // Store a fresh config pushed back by the admin screens (without the users list or PINs).
  async function applyConfig(res) {
    const c = Object.assign({}, res);
    delete c.users; delete c.subjects;
    c.user = S.user;
    await Core.metaSet('config', c);
    await Core.metaSet('configAt', new Date().toISOString());
    loadCfg(c);
    render();
  }

  function authFailed() {
    S.authBad = true;
    Core.metaSet('authBad', 1);
    renderBadge();
  }

  window.AppBridge = { S: S, esc: esc, toast: toast, applyConfig: applyConfig, authFailed: authFailed };

  async function init() {
    wire();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    if (!(await Core.metaGet('device'))) await Core.metaSet('device', 'dev-' + Math.random().toString(36).slice(2, 6));
    const pin = await Core.metaGet('pin');
    const cfg = await Core.metaGet('config');
    if (pin && cfg) {
      loadCfg(cfg);
      S.authBad = !!(await Core.metaGet('authBad'));
      S.user = await Core.metaGet('user');
      await startMain();
      backgroundRefresh();
    } else {
      showLogin();
    }
  }

  init();
})();
