/* Shared by the page and the service worker: local storage (IndexedDB) + sync. */
(function (g) {
  'use strict';

  const DB_NAME = 'class-entry', DB_VER = 1;
  let dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = function () {
          const d = r.result;
          d.createObjectStore('meta', { keyPath: 'k' });
          d.createObjectStore('entries', { keyPath: 'key' });
        };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { dbp = null; rej(r.error); };
      });
    }
    return dbp;
  }

  function run(store, mode, op) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        const t = d.transaction(store, mode);
        const r = op(t.objectStore(store));
        t.oncomplete = function () { res(r && r.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }

  const metaGet = function (k) { return run('meta', 'readonly', function (s) { return s.get(k); }).then(function (x) { return x ? x.v : undefined; }); };
  const metaSet = function (k, v) { return run('meta', 'readwrite', function (s) { return s.put({ k: k, v: v }); }); };
  const metaDel = function (k) { return run('meta', 'readwrite', function (s) { return s.delete(k); }); };
  const entryPut = function (e) { return run('entries', 'readwrite', function (s) { return s.put(e); }); };
  const entryAll = function () { return run('entries', 'readonly', function (s) { return s.getAll(); }); };
  const entryDel = function (k) { return run('entries', 'readwrite', function (s) { return s.delete(k); }); };

  // Housekeeping: drop entries that are safely on the server and older than `days`.
  async function prune(days) {
    const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const all = await entryAll();
    for (const e of all) if (e.synced && e.date < cut) await entryDel(e.key);
  }

  // Update an entry only if it has not changed since we sent it (so a later edit is never marked as synced).
  function patchIfUnchanged(key, recordedAt, patch) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        const t = d.transaction('entries', 'readwrite');
        const s = t.objectStore('entries');
        const q = s.get(key);
        q.onsuccess = function () {
          const e = q.result;
          if (e && e.recordedAt === recordedAt) s.put(Object.assign(e, patch(e)));
        };
        t.oncomplete = function () { res(); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }

  async function api(action, extra) {
    const cfg = g.APP_CONFIG || {};
    if (!cfg.ENDPOINT || String(cfg.ENDPOINT).indexOf('PASTE') === 0) throw new Error('not_configured');
    const pin = (extra && extra.pin) || (await metaGet('pin'));
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const to = ctl ? setTimeout(function () { ctl.abort(); }, 30000) : null;
    try {
      const resp = await fetch(cfg.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request: no CORS preflight
        body: JSON.stringify(Object.assign({ action: action, pin: pin }, extra)),
        redirect: 'follow',
        signal: ctl ? ctl.signal : undefined,
      });
      return await resp.json();
    } finally {
      if (to) clearTimeout(to);
    }
  }

  let syncing = null;
  function syncNow() {
    if (syncing) return syncing;
    syncing = doSync().then(function (r) { syncing = null; return r; }, function (e) { syncing = null; throw e; });
    return syncing;
  }

  async function doSync() {
    const all = await entryAll();
    // rejected entries (err set) are not retried automatically; the monitor can retry or discard them
    const pending = all.filter(function (e) { return !e.synced && !e.err; });
    if (!pending.length) return { ok: true, saved: 0, rejected: 0, pending: 0 };
    // a PIN the server refused is not sent again until the monitor signs in (avoids the global lockout)
    if (await metaGet('authBad')) return { ok: false, error: 'auth' };
    if (!(await metaGet('pin'))) return { ok: false, error: 'no_login' };
    const device = (await metaGet('device')) || '';
    let saved = 0, rejected = 0;

    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100);
      const payload = batch.map(function (e) {
        return { key: e.key, date: e.date, period: e.period, cls: e.cls, subject: e.subject, teacher: e.teacher,
                 cover: e.cover, status: e.status, mins: e.mins, recordedAt: e.recordedAt, recordedBy: e.recordedBy || '' };
      });
      let res;
      try {
        res = await api('sync', { entries: payload, device: device });
      } catch (err) {
        return { ok: false, error: 'network', saved: saved, rejected: rejected };
      }
      if (!res || !res.ok) {
        if (res && res.error === 'auth') await metaSet('authBad', 1);
        return { ok: false, error: (res && res.error) || 'server', saved: saved, rejected: rejected };
      }

      const ok = new Set(res.saved || []);
      const now = new Date().toISOString();
      for (const e of batch) {
        if (ok.has(e.key)) {
          await patchIfUnchanged(e.key, e.recordedAt, function () { return { synced: 1, syncedAt: now, err: null }; });
          saved++;
        }
      }
      for (const rj of res.rejected || []) {
        const e = batch.find(function (x) { return x.key === rj.key; });
        if (e) {
          await patchIfUnchanged(e.key, e.recordedAt, function () { return { err: rj.reason }; });
          rejected++;
        }
      }
    }
    await metaSet('lastSync', new Date().toISOString());
    return { ok: rejected === 0, saved: saved, rejected: rejected };
  }

  async function refreshConfig(pin) {
    if (!pin && (await metaGet('authBad'))) return { ok: false, error: 'auth' };
    const res = await api('config', pin ? { pin: pin } : {});
    if (!res || !res.ok) {
      if (res && res.error === 'auth' && !pin) await metaSet('authBad', 1);
      return res || { ok: false, error: 'server' };
    }
    res.skewMs = res.serverNow ? Date.now() - Date.parse(res.serverNow) : 0;   // phone clock minus server clock
    if (pin) { await metaSet('pin', pin); await metaDel('authBad'); }
    await metaSet('config', res);
    await metaSet('user', res.user);
    await metaSet('configAt', new Date().toISOString());
    return res;
  }

  g.Core = {
    metaGet: metaGet, metaSet: metaSet, metaDel: metaDel,
    entryPut: entryPut, entryAll: entryAll, entryDel: entryDel, prune: prune,
    api: api, syncNow: syncNow, refreshConfig: refreshConfig,
  };
})(typeof self !== 'undefined' ? self : globalThis);
