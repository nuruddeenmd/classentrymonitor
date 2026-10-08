/* Admin screens: manage school name, classes, subjects, teachers, bell times, timetable and users from the app. */
(function (g) {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const A = { data: null, dirty: false, busy: false };
  const B = function () { return g.AppBridge; };
  const esc = function (s) { return B().esc(s); };
  const box = function () { return $('#adminView'); };
  const note = function (t) { return '<div class="empty">' + esc(t) + '</div>'; };
  const sel = function (v, cur) { return v === cur ? ' selected' : ''; };

  function randPin() {
    const a = new Uint32Array(1);
    g.crypto.getRandomValues(a);
    return String(100000 + (a[0] % 900000));
  }

  /* ───────── common ───────── */

  function head(title, hint) {
    return '<div class="ahead"><button class="link" id="aBack">‹ Back</button><h2>' + esc(title) + '</h2></div>' +
      (hint ? '<p class="ahint">' + esc(hint) + '</p>' : '') + '<p id="aErr" class="err"></p>';
  }

  function wireBack() {
    const b = $('#aBack');
    if (b) b.onclick = function () {
      if (A.dirty && !confirm('Discard your unsaved changes?')) return;
      A.dirty = false; menu();
    };
  }

  function showErr(msg) {
    const e = $('#aErr');
    if (!e) { if (msg) B().toast(msg); return; }
    e.textContent = msg || '';
    if (msg && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' });
  }

  function fail(res) {
    const code = res && res.error;
    if (code === 'auth') { B().authFailed(); showErr('Your PIN is no longer accepted. Tap the red badge at the top to sign in again.'); }
    else if (code === 'forbidden') showErr('Only an Admin can change these settings.');
    else if (code === 'locked') showErr('Too many wrong PINs. Try again in 10 minutes.');
    else if (code === 'invalid') showErr(res.detail || 'Some values are not valid.');
    else showErr('Server problem (' + (code || 'unknown') + '). Nothing was changed.');
  }

  async function save(payload, action, doneMsg) {
    showErr('');
    if (A.busy) return false;
    if (!navigator.onLine) { showErr('No internet connection. Nothing was saved.'); return false; }
    A.busy = true;
    const btn = $('#aSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const res = await g.Core.api(action || 'admin_save', payload);
      if (res && res.ok) {
        A.data = res; A.dirty = false;
        await B().applyConfig(res);
        B().toast(doneMsg || 'Saved ✓');
        return true;
      }
      fail(res);
      return false;
    } catch (e) {
      showErr('Could not reach the server. Nothing was saved.');
      return false;
    } finally {
      A.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  async function enter() {
    A.dirty = false;
    const el = box();
    el.oninput = null;
    if (B().S.authBad) { el.innerHTML = note('Sign in again first: tap the red badge at the top.'); return; }
    if (!navigator.onLine) { el.innerHTML = note('You need an internet connection to change settings.'); return; }
    el.innerHTML = note('Loading…');
    try {
      const res = await g.Core.api('admin_get', {});
      if (res && res.ok) { A.data = res; menu(); }
      else { el.innerHTML = '<p id="aErr" class="err"></p>'; fail(res); }
    } catch (e) {
      el.innerHTML = note('Could not reach the server. Check your internet and open this tab again.');
    }
  }

  /* ───────── menu ───────── */

  function menu() {
    const d = A.data;
    box().oninput = null;
    const items = [
      ['school', 'School name', d.school || '—'],
      ['classes', 'Classes', d.classes.length + ' classes'],
      ['subjects', 'Subjects', d.subjects.length + ' subjects'],
      ['teachers', 'Teachers', d.teachers.length + ' teachers'],
      ['periods', 'Bell times', d.periods.length + ' rows'],
      ['timetable', 'Timetable', d.timetable.length + ' lessons'],
      ['users', 'Users & PINs', d.users.length + ' users'],
      ['danger', 'Reset data', 'Clear test data'],
    ];
    box().innerHTML = '<p class="ahint">Changes reach the monitor\'s phone the next time it opens the app with internet.</p><div class="amenu">' +
      items.map(function (m) {
        return '<button class="amrow" data-v="' + m[0] + '"><b>' + esc(m[1]) + '</b><span class="muted">' + esc(m[2]) + '</span></button>';
      }).join('') + '</div>';
    box().querySelectorAll('.amrow').forEach(function (b) { b.onclick = function () { open(b.dataset.v); }; });
  }

  function open(view) {
    A.dirty = false;
    if (view === 'school') school();
    else if (view === 'classes' || view === 'subjects') listEditor(view);
    else if (view === 'teachers') teachers();
    else if (view === 'periods') periods();
    else if (view === 'timetable') timetable();
    else if (view === 'users') users();
    else if (view === 'danger') danger();
  }

  /* ───────── school name ───────── */

  function school() {
    box().innerHTML = head('School name') +
      '<input type="text" id="aSchool" maxlength="60" value="' + esc(A.data.school) + '">' +
      '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
    wireBack();
    box().oninput = function () { A.dirty = true; };
    $('#aSave').onclick = async function () {
      const v = $('#aSchool').value.trim();
      if (!v) { showErr('Enter the school name.'); return; }
      if (await save({ table: 'Config', rows: [['SchoolName', v]] })) school();
    };
  }

  /* ───────── classes / subjects ───────── */

  function listEditor(kind) {
    const isCls = kind === 'classes';
    const cfg = isCls
      ? { title: 'Classes', table: 'Classes', items: A.data.classes, max: 20,
          hint: 'This order is the order on the monitor\'s screen. Renaming a class updates the timetable; past records keep the old name. A class that still has lessons cannot be deleted. Let the monitor sync before you rename.' }
      : { title: 'Subjects', table: 'Subjects', items: A.data.subjects, max: 40,
          hint: 'Renaming a subject updates the timetable. A subject that is still used in the timetable cannot be deleted.' };
    const rows = cfg.items.map(function (v) { return { orig: v, v: v }; });

    function draw() {
      box().innerHTML = head(cfg.title, cfg.hint) + '<div class="alist">' + rows.map(function (r, i) {
        return '<div class="erow"><input type="text" data-i="' + i + '" maxlength="' + cfg.max + '" value="' + esc(r.v) + '">' +
          '<button class="x" data-up="' + i + '" aria-label="Move up">▲</button>' +
          '<button class="x" data-dn="' + i + '" aria-label="Move down">▼</button>' +
          '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
      }).join('') + '</div><button id="aAdd" class="addbtn">+ Add</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('input[data-i]').forEach(function (inp) {
        inp.oninput = function () { rows[+inp.dataset.i].v = inp.value; A.dirty = true; };
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      el.querySelectorAll('[data-up]').forEach(function (b) {
        b.onclick = function () { const i = +b.dataset.up; if (i > 0) { const t = rows[i]; rows[i] = rows[i - 1]; rows[i - 1] = t; A.dirty = true; draw(); } };
      });
      el.querySelectorAll('[data-dn]').forEach(function (b) {
        b.onclick = function () { const i = +b.dataset.dn; if (i < rows.length - 1) { const t = rows[i]; rows[i] = rows[i + 1]; rows[i + 1] = t; A.dirty = true; draw(); } };
      });
      $('#aAdd').onclick = function () {
        rows.push({ orig: '', v: '' }); A.dirty = true; draw();
        const ins = box().querySelectorAll('input[data-i]');
        if (ins.length) ins[ins.length - 1].focus();
      };
      $('#aSave').onclick = async function () {
        const names = [], renames = {}, seen = {};
        for (let i = 0; i < rows.length; i++) {
          const n = rows[i].v.trim();
          if (!n) continue;
          if (seen[n.toLowerCase()]) { showErr('"' + n + '" appears twice.'); return; }
          seen[n.toLowerCase()] = 1;
          names.push(n);
          if (rows[i].orig && n !== rows[i].orig) renames[rows[i].orig] = n;
        }
        if (!names.length) { showErr('Keep at least one.'); return; }
        if (await save({ table: cfg.table, rows: names.map(function (n) { return [n]; }), renames: renames })) listEditor(kind);
      };
    }
    draw();
  }

  /* ───────── teachers ───────── */

  function teachers() {
    const rows = A.data.teachers.map(function (t) { return { orig: t[0], code: t[0], name: t[1] }; });
    const nextCode = function () {
      let max = 0;
      rows.forEach(function (r) { const m = /^T(\d+)$/i.exec(r.code); if (m) max = Math.max(max, +m[1]); });
      return 'T' + String(max + 1).padStart(2, '0');
    };

    function draw() {
      box().innerHTML = head('Teachers', 'The code is permanent once saved (the timetable uses it); names can be changed any time. A teacher who is still in the timetable cannot be deleted.') +
        '<div class="alist">' + rows.map(function (r, i) {
          return '<div class="erow"><input type="text" class="code" data-i="' + i + '" data-f="code" maxlength="12" placeholder="Code" value="' + esc(r.code) + '"' + (r.orig ? ' readonly' : '') + '>' +
            '<input type="text" data-i="' + i + '" data-f="name" maxlength="60" placeholder="Name" value="' + esc(r.name) + '">' +
            '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
        }).join('') + '</div><button id="aAdd" class="addbtn">+ Add teacher</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('input[data-f]').forEach(function (inp) {
        inp.oninput = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.value; A.dirty = true; };
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      $('#aAdd').onclick = function () {
        rows.push({ orig: '', code: nextCode(), name: '' }); A.dirty = true; draw();
        const ins = box().querySelectorAll('input[data-f="name"]');
        if (ins.length) ins[ins.length - 1].focus();
      };
      $('#aSave').onclick = async function () {
        const out = [], seen = {};
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], code = r.code.trim(), name = r.name.trim();
          if (!r.orig && !name) continue;   // untouched new row
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/.test(code)) { showErr('Code "' + code + '" must be 1 to 12 letters or numbers, no spaces.'); return; }
          if (!name) { showErr('Teacher ' + code + ' needs a name.'); return; }
          if (seen[code.toLowerCase()]) { showErr('Code ' + code + ' is used twice.'); return; }
          seen[code.toLowerCase()] = 1;
          out.push([code, name]);
        }
        if (await save({ table: 'Teachers', rows: out })) teachers();
      };
    }
    draw();
  }

  /* ───────── bell times ───────── */

  function periods() {
    const rows = A.data.periods.map(function (p) { return { n: p.n, start: p.start || '', end: p.end || '', day: p.day || '' }; });

    function draw() {
      box().innerHTML = head('Bell times', 'Times are 24-hour. Leave Day as "Every day" for the normal times. Add a row for a specific day (for example Fri) only if that day is different; its rows then replace the normal times on that day. A break is just the gap between one period\'s end and the next one\'s start.') +
        '<div class="alist">' + rows.map(function (r, i) {
          let h = '<div class="erow wrap"><select data-i="' + i + '" data-f="n">';
          for (let n = 1; n <= 8; n++) h += '<option value="' + n + '"' + (n === r.n ? ' selected' : '') + '>P' + n + '</option>';
          h += '</select><input type="time" data-i="' + i + '" data-f="start" value="' + esc(r.start) + '"><span class="muted">to</span>' +
            '<input type="time" data-i="' + i + '" data-f="end" value="' + esc(r.end) + '">' +
            '<select data-i="' + i + '" data-f="day"><option value="">Every day</option>' +
            DAYS.map(function (d) { return '<option' + sel(d, r.day) + '>' + d + '</option>'; }).join('') + '</select>' +
            '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
          return h;
        }).join('') + '</div><button id="aAdd" class="addbtn">+ Add period</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('[data-f]').forEach(function (inp) {
        const upd = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'n' ? Number(inp.value) : inp.value; A.dirty = true; };
        inp.addEventListener('input', upd); inp.addEventListener('change', upd);
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      $('#aAdd').onclick = function () {
        let n = 0;
        rows.forEach(function (r) { if (!r.day && r.n > n) n = r.n; });
        rows.push({ n: Math.min(8, n + 1), start: '', end: '', day: '' }); A.dirty = true; draw();
      };
      $('#aSave').onclick = async function () {
        for (let i = 0; i < rows.length; i++) {
          if (!rows[i].start || !rows[i].end) { showErr('Fill in the start and end time for every row, or delete the row.'); return; }
        }
        const out = rows.map(function (r) { return [r.n, r.start, r.end, r.day]; });
        if (await save({ table: 'Periods', rows: out })) periods();
      };
    }
    draw();
  }

  /* ───────── timetable ───────── */

  function timetable() {
    const d = A.data;
    if (!d.classes.length || !d.subjects.length) {
      box().innerHTML = head('Timetable') + note('Add at least one class and one subject first.');
      wireBack();
      return;
    }
    const tt = {};   // 'Mon|1|JSS1A' -> {s: subject, t: teacher code}
    d.timetable.forEach(function (r) { tt[r[0] + '|' + r[1] + '|' + r[2]] = { s: r[3], t: r[4] }; });
    const st = { cls: d.classes[0], day: 'Mon' };
    const bell = {};
    d.periods.filter(function (p) { return !p.day; }).forEach(function (p) { bell[p.n] = p.start + '–' + p.end; });
    const tname = {};
    d.teachers.forEach(function (t) { tname[t[0]] = t[1]; });

    function draw() {
      let h = head('Timetable', 'Choose a class and a day, then the subject and teacher for each period. Leave the subject empty when there is no lesson. Press Save when you have finished (changes for all classes are saved together).');
      h += '<select id="tClass" class="full">' + d.classes.map(function (c) { return '<option' + sel(c, st.cls) + '>' + esc(c) + '</option>'; }).join('') + '</select>';
      h += '<div class="periods" id="tDays">' + DAYS.map(function (x) { return '<button data-d="' + x + '" class="' + (x === st.day ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div><div class="tt">';
      for (let p = 1; p <= 8; p++) {
        const e = tt[st.day + '|' + p + '|' + st.cls] || { s: '', t: '' };
        const subs = d.subjects.indexOf(e.s) < 0 && e.s ? d.subjects.concat([e.s]) : d.subjects;
        let clash = '';
        if (e.s && e.t) {
          for (let k = 0; k < d.classes.length; k++) {
            const c = d.classes[k];
            const o = c !== st.cls && tt[st.day + '|' + p + '|' + c];
            if (o && o.s && o.t === e.t) { clash = '<div class="warnnote">⚠ ' + esc(tname[e.t] || e.t) + ' is also teaching ' + esc(c) + ' in this period</div>'; break; }
          }
        }
        h += '<div class="ttp"><b>P' + p + (bell[p] ? ' <span class="muted">' + esc(bell[p]) + '</span>' : '') + '</b>' +
          '<select data-p="' + p + '" data-f="s"><option value="">— no lesson —</option>' +
          subs.map(function (s) { return '<option' + sel(s, e.s) + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
          (e.s ? '<select data-p="' + p + '" data-f="t"><option value="">— teacher —</option>' +
            d.teachers.map(function (t) { return '<option value="' + esc(t[0]) + '"' + sel(t[0], e.t) + '>' + esc(t[1]) + ' (' + esc(t[0]) + ')</option>'; }).join('') + '</select>' : '') +
          clash + '</div>';
      }
      h += '</div><button id="tCopy" class="addbtn">Copy ' + st.day + ' to the other days</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      box().innerHTML = h;
      wireBack();
      $('#tClass').onchange = function (e) { st.cls = e.target.value; draw(); };
      box().querySelectorAll('#tDays button').forEach(function (b) { b.onclick = function () { st.day = b.dataset.d; draw(); }; });
      box().querySelectorAll('select[data-p]').forEach(function (s) {
        s.onchange = function () {
          const k = st.day + '|' + s.dataset.p + '|' + st.cls;
          const e = tt[k] || (tt[k] = { s: '', t: '' });
          e[s.dataset.f] = s.value;
          if (s.dataset.f === 's' && !s.value) e.t = '';
          A.dirty = true; draw();
        };
      });
      $('#tCopy').onclick = function () {
        if (!confirm('Copy ' + st.cls + ' ' + st.day + ' to all other days? This replaces that class\'s lessons on the other days.')) return;
        DAYS.forEach(function (x) {
          if (x === st.day) return;
          for (let p = 1; p <= 8; p++) {
            const src = tt[st.day + '|' + p + '|' + st.cls], k = x + '|' + p + '|' + st.cls;
            if (src && src.s) tt[k] = { s: src.s, t: src.t }; else delete tt[k];
          }
        });
        A.dirty = true; B().toast('Copied. Press Save to keep it.'); draw();
      };
      $('#aSave').onclick = async function () {
        const rows = [];
        DAYS.forEach(function (day) {
          for (let p = 1; p <= 8; p++) {
            d.classes.forEach(function (c) {
              const e = tt[day + '|' + p + '|' + c];
              if (e && e.s) rows.push([day, p, c, e.s, e.t || '']);
            });
          }
        });
        if (await save({ table: 'Timetable', rows: rows })) { A.dirty = false; timetable(); }
      };
    }
    draw();
  }

  /* ───────── users ───────── */

  async function users() {
    const myPin = await g.Core.metaGet('pin');
    const rows = A.data.users.map(function (u) { return { name: u[0], pin: u[1], role: u[2], active: u[3], me: u[1] === myPin, origPin: u[1] }; });

    function draw() {
      box().innerHTML = head('Users & PINs', 'Give each person their own PIN (6 to 12 digits). A Monitor can record entries; an Admin can also change these settings. Switch Active off to block someone without deleting. You cannot change your own role or switch yourself off. Keep the Admin PIN private.') +
        '<div class="alist">' + rows.map(function (r, i) {
          return '<div class="erow wrap urow"><input type="text" data-i="' + i + '" data-f="name" maxlength="40" placeholder="Name" value="' + esc(r.name) + '">' +
            '<input type="text" inputmode="numeric" class="pin" data-i="' + i + '" data-f="pin" maxlength="12" placeholder="PIN" value="' + esc(r.pin) + '">' +
            '<button class="x" data-gen="' + i + '" aria-label="New random PIN">🎲</button>' +
            '<select data-i="' + i + '" data-f="role"' + (r.me ? ' disabled' : '') + '><option' + sel('Monitor', r.role) + '>Monitor</option><option' + sel('Admin', r.role) + '>Admin</option></select>' +
            '<label class="chkl"><input type="checkbox" data-i="' + i + '" data-f="active"' + (r.active ? ' checked' : '') + (r.me ? ' disabled' : '') + '> Active</label>' +
            (r.me ? '<span class="muted">(you)</span>' : '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button>') + '</div>';
        }).join('') + '</div><button id="aAdd" class="addbtn">+ Add user</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('[data-f]').forEach(function (inp) {
        const upd = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value; A.dirty = true; };
        inp.addEventListener('input', upd); inp.addEventListener('change', upd);
      });
      el.querySelectorAll('[data-gen]').forEach(function (b) { b.onclick = function () { rows[+b.dataset.gen].pin = randPin(); A.dirty = true; draw(); }; });
      el.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          const r = rows[+b.dataset.del];
          if (confirm('Delete ' + (r.name || 'this user') + '?')) { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }
        };
      });
      $('#aAdd').onclick = function () { rows.push({ name: '', pin: randPin(), role: 'Monitor', active: true, me: false, origPin: '' }); A.dirty = true; draw(); };
      $('#aSave').onclick = async function () {
        const pins = {};
        let admins = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], name = r.name.trim(), pin = r.pin.trim();
          if (!name) { showErr('Every user needs a name.'); return; }
          if (!/^\d{6,12}$/.test(pin)) { showErr(name + ': the PIN must be 6 to 12 digits.'); return; }
          if (pins[pin]) { showErr('Two users have the same PIN (' + name + ').'); return; }
          pins[pin] = 1;
          if (r.role === 'Admin' && r.active) admins++;
        }
        if (!admins) { showErr('Keep at least one active Admin.'); return; }
        const me = rows.filter(function (r) { return r.me; })[0];
        const out = rows.map(function (r) { return [r.name.trim(), r.pin.trim(), r.role, !!r.active]; });
        if (await save({ table: 'Users', rows: out })) {
          if (me && me.pin.trim() !== me.origPin) await g.Core.metaSet('pin', me.pin.trim());   // keep this phone signed in
          users();
        }
      };
    }
    draw();
  }

  /* ───────── reset data ───────── */

  function danger() {
    box().innerHTML = head('Reset data', 'Use these to remove test data before you go live. This cannot be undone.') +
      '<div class="dz"><b>Clear teachers, subjects and timetable</b><p class="muted">Deletes every teacher, subject and lesson. Classes, bell times and users stay.</p><button id="dzT" class="dzbtn">Clear teachers, subjects &amp; timetable</button></div>' +
      '<div class="dz"><b>Clear all recorded entries</b><p class="muted">Deletes every row in the Log and the correction history. Do this once, just before the first real school day. Phones keep their own copy of unsynced entries.</p><button id="dzL" class="dzbtn">Clear all recorded entries</button></div>';
    wireBack();
    const wipe = async function (what) {
      const t = prompt('This cannot be undone. Type DELETE (in capitals) to confirm.');
      if (t === null) return;
      if (t.trim() !== 'DELETE') { showErr('Not confirmed: you must type DELETE in capitals.'); return; }
      if (await save({ what: what, confirm: 'DELETE' }, 'admin_clear', 'Cleared ✓')) danger();
    };
    $('#dzT').onclick = function () { wipe('timetable'); };
    $('#dzL').onclick = function () { wipe('log'); };
  }

  g.Admin = { enter: enter };
})(self);
