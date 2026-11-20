// 暮らし帳の通知係(Supabase Edge Function「push」)
// ・1分ごとに呼ばれて(Supabase Cron)、たまった通知を送る。朝7時・夜20時には、その日のまとめを送る。
// ・アプリからは「通知用の公開鍵をもらう」「テスト通知を送る」に使う。
// 鍵は初めて動いたときに自分で作り、データベースの push_config に入れる(手で設定するものはない)。
import { createClient } from 'jsr:@supabase/supabase-js@2';

const APP = 'https://tori9609.github.io/kurashi/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- 文字とバイト ----------
const te = (s: string) => new TextEncoder().encode(s);
export const b64u = (b: Uint8Array) => { let s = ''; b.forEach(x => s += String.fromCharCode(x)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const fromB64u = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0)); };
const concat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// ---------- 鍵(VAPID) ----------
export async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey) as JsonWebKey;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey) as ArrayBuffer);
  return { public_key: b64u(raw), private_jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}
export async function vapidAuth(endpoint: string, pub: string, jwk: JsonWebKey, now = Date.now()) {
  const enc = (o: unknown) => b64u(te(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: APP });
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te(unsigned)));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${pub}`;
}

// ---------- 中身の暗号化(RFC 8291 / aes128gcm) ----------
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const ua = fromB64u(p256dh), secret = fromB64u(auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
  };
  const ikm = await hkdf(secret, shared, concat(te('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const head = new Uint8Array(21 + asPub.length);
  head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPub.length; head.set(asPub, 21);
  return concat(head, ct);
}

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Msg = { title: string; body: string; url: string; tag?: string; urgent?: boolean };
type Cfg = { public_key: string; private_jwk: JsonWebKey; cron_secret: string };

// 1台に送る。もう使われていない登録(404・410)は false を返す
export async function sendPush(sub: Sub, msg: Msg, cfg: Cfg, f: typeof fetch = fetch) {
  const body = await encrypt(te(JSON.stringify({ ...msg, url: APP + msg.url })), sub.p256dh, sub.auth);
  const r = await f(sub.endpoint, { method: 'POST', body, headers: {
    Authorization: await vapidAuth(sub.endpoint, cfg.public_key, cfg.private_jwk), TTL: '86400',
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: msg.urgent ? 'high' : 'normal' } });
  return { status: r.status, gone: r.status === 404 || r.status === 410 };
}

// ---------- 日付と、アプリと同じ決まり ----------
export const jst = (d: Date) => { const j = new Date(d.getTime() + 9 * 3600e3); return { ymd: j.toISOString().slice(0, 10), hour: j.getUTCHours(), dow: j.getUTCDay() }; };
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf = (s: string) => new Date(s + 'T00:00:00Z').getUTCDay();
const dayOf = (s: string) => new Date(s + 'T00:00:00Z').getUTCDate();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
// deno-lint-ignore no-explicit-any
export function occurs(e: any, ds: string) {
  if (e.deleted_at || ds < e.date || (e.exdates || []).includes(ds)) return false;
  if (!e.repeat_rule) return ds === e.date;
  const [k, a] = e.repeat_rule.split(':');
  if (k === 'weekly') return a.split(',').map(Number).includes(dowOf(ds));
  if (k === 'monthly') return dayOf(ds) === Number(a);
  return false;
}
// deno-lint-ignore no-explicit-any
export function choreDue(c: any, ds: string) {
  if (c.deleted_at || c.archived || c.last_done === ds) return false;
  const days = c.last_done ? daysBetween(c.last_done, ds) : Infinity;
  if (c.freq === 'once') return !c.last_done && (!c.due || c.due <= ds);
  if (c.freq === 'daily') return true;
  if (c.freq === 'monthly') return days >= 30;
  if (c.weekdays) return c.weekdays.split(',').map(Number).includes(dowOf(ds));
  return days >= 7;
}
const W = '日月火水木金土';
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}(${W[dowOf(s)]})`;
const list = (a: string[], n = 4) => a.slice(0, n).join('、') + (a.length > n ? ` ほか${a.length - n}件` : '');

// ---------- 朝・夜のまとめ(1人分) ----------
// 「自分だけ」のものは、ロック画面で人に見えても困らないよう、名前を出さない
// deno-lint-ignore no-explicit-any
export function digest(kind: 'morning' | 'evening', today: string, me: string, prefs: any, events: any[], chores: any[], inboxCount: number): Msg | null {
  const seen = (x: { is_private: boolean; created_by: string }) => !x.is_private || x.created_by === me;
  const evName = (e: any) => e.is_private ? '自分だけの予定' : (e.time ? e.time.slice(0, 5) + ' ' : '') + e.title;
  const lines: string[] = [];
  let url = '#home';
  if (kind === 'morning') {
    if (prefs.events) {
      const ev = events.filter(seen).filter(e => occurs(e, today)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      if (ev.length) { lines.push(`📅 今日の予定 ${ev.length}件:${list(ev.map(evName))}`); url = '#calendar'; }
    }
    if (prefs.todo) {
      const due = chores.filter(seen).filter(c => choreDue(c, today));
      const late = due.filter(c => c.freq === 'once' && c.due && c.due < today);
      if (due.length) {
        lines.push(`✅ 今日やること ${due.length}件${late.length ? `(期限切れ${late.length})` : ''}:${list(due.map(c => c.is_private ? '自分だけのやること' : c.name))}`);
        if (url === '#home') url = '#chores';
      }
    }
    return lines.length ? { title: `おはようございます ${md(today)}`, body: lines.join('\n'), url, tag: 'morning-' + today } : null;
  }
  const tomorrow = addDays(today, 1);
  if (prefs.events) {
    const ev = events.filter(seen).filter(e => occurs(e, tomorrow)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (ev.length) { lines.push(`📅 明日 ${md(tomorrow)} の予定 ${ev.length}件:${list(ev.map(evName))}`); url = '#calendar'; }
  }
  if (prefs.card && inboxCount > 0) { lines.push(`💳 カード利用の確認待ちが${inboxCount}件あります`); if (url === '#home') url = '#kakeibo'; }
  return lines.length ? { title: '暮らし帳 夜のお知らせ', body: lines.join('\n'), url, tag: 'evening-' + today } : null;
}

// ---------- 予定ごとのお知らせ ----------
// 今日・明日の回について「開始 − 何分前」が、いまから10分前までの間に来たものを選ぶ(取りこぼし対策)。送ったかどうかは push_log で見る
// deno-lint-ignore no-explicit-any
export function dueReminders(events: any[], now: Date) {
  const t = jst(now), out: { e: any; day: string; at: number }[] = [];
  for (const e of events) {
    if (e.remind_min == null || !e.time) continue;
    for (const day of [t.ymd, addDays(t.ymd, 1), addDays(t.ymd, 2)]) {
      if (!occurs(e, day)) continue;
      const start = Date.parse(`${day}T${e.time.slice(0, 5)}:00+09:00`), at = start - e.remind_min * 60e3;
      if (at <= now.getTime() && at > now.getTime() - 10 * 60e3) out.push({ e, day, at: start });
    }
  }
  return out;
}
// deno-lint-ignore no-explicit-any
export function reminderMsg(e: any, day: string, min: number): Msg {
  const when = `${md(day)} ${e.time.slice(0, 5)}`, name = e.is_private ? '自分だけの予定' : e.title;
  const title = min === 0 ? '⏰ 予定の時刻です' : min >= 1440 ? '⏰ 明日の予定' : min >= 60 ? `⏰ ${min / 60}時間後の予定` : `⏰ ${min}分後の予定`;
  return { title, body: `${when} ${name}`, url: '#calendar', tag: `remind-${e.id}-${day}`, urgent: true };
}

// ---------- たまった通知を、人ごとに1つにまとめる ----------
// deno-lint-ignore no-explicit-any
export function groupQueue(rows: any[]): Map<string, Msg> {
  const by = new Map<string, any[]>();
  rows.forEach(r => by.set(r.user_id, [...(by.get(r.user_id) || []), r]));
  const out = new Map<string, Msg>();
  for (const [u, rs] of by) {
    const urgent = rs.some(r => r.kind === 'urgent');
    const first = rs.find(r => r.kind === 'urgent') || rs[0];
    out.set(u, rs.length === 1 ? { title: first.title, body: first.body, url: first.url, urgent }
      : { title: urgent ? '🛒 急ぎの買い物と、ほか' + (rs.length - 1) + '件' : `暮らし帳のお知らせ ${rs.length}件`,
          body: rs.slice(0, 5).map(r => (r.kind === 'urgent' ? '急ぎ:' : '') + r.body).join('\n') + (rs.length > 5 ? `\nほか${rs.length - 5}件` : ''), url: first.url, urgent });
  }
  return out;
}

// ---------- データベースを使う部分 ----------
// deno-lint-ignore no-explicit-any
type DB = any;
export async function ensureConfig(db: DB): Promise<Cfg> {
  const { data } = await db.from('push_config').select('*').eq('id', 1).maybeSingle();
  if (data?.public_key) return data;
  const k = await makeVapid();
  if (data) await db.from('push_config').update(k).eq('id', 1);
  else await db.from('push_config').insert({ id: 1, ...k });
  const again = await db.from('push_config').select('*').eq('id', 1).maybeSingle();
  return again.data;
}
async function sendToUser(db: DB, cfg: Cfg, subs: Sub[], msg: Msg, f: typeof fetch) {
  let ok = 0;
  for (const s of subs) {
    try { const r = await sendPush(s, msg, cfg, f); if (r.gone) await db.from('push_subs').delete().eq('id', s.id); else if (r.status < 300) ok++; }
    catch (_) { /* 1台の失敗で止めない */ }
  }
  return ok;
}
export async function tick(db: DB, cfg: Cfg, now: Date, f: typeof fetch = fetch) {
  const t = jst(now), result = { queued: 0, digests: 0, pushed: 0 };
  const { data: subs } = await db.from('push_subs').select('*');
  const subsOf = (u: string) => (subs || []).filter((s: Sub) => s.user_id === u);

  // 1) たまった通知(1時間より古いものは送らない)
  const since = new Date(now.getTime() - 3600e3).toISOString();
  const { data: q } = await db.from('notify_queue').select('*').gte('created_at', since).order('created_at');
  const unsent = (q || []).filter((r: { sent_at: string | null }) => !r.sent_at);
  if (unsent.length) {
    await db.from('notify_queue').update({ sent_at: now.toISOString() }).in('id', unsent.map((r: { id: number }) => r.id));
    result.queued = unsent.length;
    for (const [u, msg] of groupQueue(unsent)) result.pushed += await sendToUser(db, cfg, subsOf(u), msg, f);
  }
  // 古い記録の片付け
  await db.from('notify_queue').delete().lt('created_at', new Date(now.getTime() - 7 * 864e5).toISOString());

  // 2) 予定ごとのお知らせ(だれの予定かで送り先を決める:決まった人の予定はその人、ふたりの予定は全員、自分だけは本人)
  if (subs?.length) {
    const { data: rev } = await db.from('events').select('*').not('remind_min', 'is', null).is('deleted_at', null);
    const due = dueReminders(rev || [], now);
    if (due.length) {
      const hs = [...new Set(due.map(x => x.e.household_id))];
      const [{ data: mem2 }, { data: pf2 }, { data: lg2 }] = await Promise.all([
        db.from('members').select('user_id,household_id').in('household_id', hs),
        db.from('notify_prefs').select('*'),
        db.from('push_log').select('*').gte('day', t.ymd)]);
      for (const { e, day } of due) {
        const to = (mem2 || []).filter((m: { user_id: string; household_id: string }) => m.household_id === e.household_id)
          .map((m: { user_id: string }) => m.user_id)
          .filter((u: string) => e.is_private ? u === e.created_by : e.for_user ? u === e.for_user : true)
          .filter((u: string) => ((pf2 || []).find((p: { user_id: string }) => p.user_id === u) || { remind: true }).remind !== false);
        for (const u of to) {
          const kind = 'remind:' + e.id;
          if ((lg2 || []).some((l: { user_id: string; kind: string; day: string }) => l.user_id === u && l.kind === kind && l.day === day)) continue;
          await db.from('push_log').insert({ user_id: u, kind, day });
          (lg2 || []).push({ user_id: u, kind, day });
          result.pushed += await sendToUser(db, cfg, subsOf(u), reminderMsg(e, day, e.remind_min), f);
        }
      }
    }
  }

  // 3) 朝7時台・夜20時台のまとめ(1日1回)
  const kind = t.hour === 7 ? 'morning' : t.hour === 20 ? 'evening' : null;
  if (kind && subs?.length) {
    const users = [...new Set((subs as Sub[]).map(s => s.user_id))];
    const [{ data: logs }, { data: mem }, { data: prefs }] = await Promise.all([
      db.from('push_log').select('*').eq('day', t.ymd).eq('kind', kind),
      db.from('members').select('user_id,household_id').in('user_id', users),
      db.from('notify_prefs').select('*').in('user_id', users)]);
    for (const u of users) {
      if ((logs || []).some((l: { user_id: string }) => l.user_id === u)) continue;
      const h = (mem || []).find((m: { user_id: string }) => m.user_id === u)?.household_id; if (!h) continue;
      const p = (prefs || []).find((x: { user_id: string }) => x.user_id === u) || { partner: true, urgent: true, todo: true, events: true, card: true, remind: true, budget: true };
      await db.from('push_log').insert({ user_id: u, kind, day: t.ymd });   // 先に記録して、二重に送らない
      const [{ data: ev }, { data: ch }, { data: ib }] = await Promise.all([
        db.from('events').select('*').eq('household_id', h).is('deleted_at', null),
        kind === 'morning' ? db.from('chores').select('*').eq('household_id', h).is('deleted_at', null) : Promise.resolve({ data: [] }),
        kind === 'evening' ? db.from('card_inbox').select('id').eq('owner', u).eq('status', 'new') : Promise.resolve({ data: [] })]);
      const msg = digest(kind, t.ymd, u, p, ev || [], ch || [], (ib || []).length);
      if (msg) { result.digests++; result.pushed += await sendToUser(db, cfg, subsOf(u), msg, f); }
    }
  }
  return result;
}

// ---------- 入り口 ----------
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const cfg = await ensureConfig(db);
    if (body.action === 'tick') {
      if (req.headers.get('x-kurashi-cron') !== cfg.cron_secret) return json({ error: '合言葉が違います' }, 401);
      return json(await tick(db, cfg, new Date()));
    }
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: 'ログインが必要です' }, 401);
    if (body.action === 'key') return json({ key: cfg.public_key });
    if (body.action === 'test') {
      const { data: subs } = await db.from('push_subs').select('*').eq('user_id', user.id);
      const n = await sendToUser(db, cfg, subs || [], { title: '暮らし帳', body: 'テスト通知です。この端末に届いています。', url: '#settings' }, fetch);
      return json({ sent: n, devices: (subs || []).length });
    }
    return json({ error: '使い方が違います' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
