// 暮らし帳の通知係(Supabase Edge Function「push」)
// ・1分ごとに呼ばれて(Supabase Cron)、たまった通知を送る。朝7時・夜20時には、その日のまとめを送る。
// ・アプリからは「通知用の公開鍵をもらう」「テスト通知を送る」に使う。
// 鍵は初めて動いたときに自分で作り、データベースの push_config に入れる(手で設定するものはない)。
import { createClient } from 'jsr:@supabase/supabase-js@2';
export const VERSION = '2026-11-21';   // 状態チェックで「新しい版か」を見るための印

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

// ---------- 先月のふり返り(毎月1日の朝のまとめに入れる) ----------
// ふたりの支出だけを数える(自分だけの支出・収入は入れない)
const monthOf = (today: string, n: number) => { const [y, m] = today.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
// deno-lint-ignore no-explicit-any
export function monthlyReview(tx: any[], today: string): string | null {
  const last = monthOf(today, -1), before = monthOf(today, -2);
  const exp = tx.filter(t => t.scope === 'shared' && t.kind !== 'income' && !t.deleted_at);
  const sum = (m: string) => exp.filter(t => t.date.startsWith(m)).reduce((a, t) => a + t.amount, 0);
  const a = sum(last), b = sum(before); if (!a) return null;
  const by: Record<string, number> = {};
  for (const t of exp.filter(t => t.date.startsWith(last))) by[t.category] = (by[t.category] || 0) + t.amount;
  const [topC, topV] = Object.entries(by).sort((x, y) => y[1] - x[1])[0];
  const pct = b ? Math.round((a - b) / b * 100) : null, yen = (n: number) => '¥' + n.toLocaleString('ja-JP');
  return `📊 ${Number(last.slice(5))}月のふたりの支出 ${yen(a)}${pct === null ? '' : `(前の月より${pct >= 0 ? '+' : ''}${pct}%)`}・いちばん多いのは${topC} ${yen(topV)}`;
}

// ---------- 朝・夜のまとめ(1人分) ----------
// 「自分だけ」のものは、ロック画面で人に見えても困らないよう、名前を出さない
// deno-lint-ignore no-explicit-any
export function digest(kind: 'morning' | 'evening', today: string, me: string, prefs: any, events: any[], chores: any[], inboxCount: number, review: string | null = null, recorded: boolean | null = null): Msg | null {
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
    if (review && prefs.monthly !== false) { lines.push(review); if (url === '#home') url = '#kakeibo'; }
    return lines.length ? { title: `おはようございます ${md(today)}`, body: lines.join('\n'), url, tag: 'morning-' + today } : null;
  }
  const tomorrow = addDays(today, 1);
  if (prefs.events) {
    const ev = events.filter(seen).filter(e => occurs(e, tomorrow)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (ev.length) { lines.push(`📅 明日 ${md(tomorrow)} の予定 ${ev.length}件:${list(ev.map(evName))}`); url = '#calendar'; }
  }
  if (prefs.card && inboxCount > 0) { lines.push(`💳 カード利用の確認待ちが${inboxCount}件あります`); if (url === '#home') url = '#kakeibo'; }
  // つけ忘れ防止:今日の記録もカード利用の確認待ちもないとき(使っていない日なら気にしなくて大丈夫)
  if (prefs.forgot !== false && recorded === false && inboxCount === 0) { lines.push('📝 今日の支出はまだ記録がありません。使った分があれば、レシートを撮るか入力しておきましょう'); if (url === '#home') url = '#kakeibo'; }
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

  // 3) 毎日4時30分(日本時間)に、使われていないレシートの写真を片付ける
  if (t.hour === 4 && now.getUTCMinutes() === 30) {
    try { (result as Record<string, number>).photos = await cleanupPhotos(db, now); } catch (_) { /* 片付けの失敗で通知を止めない */ }
  }

  // 4) 朝7時台・夜20時台のまとめ(1日1回)
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
      const p = (prefs || []).find((x: { user_id: string }) => x.user_id === u) || { partner: true, urgent: true, todo: true, events: true, card: true, remind: true, budget: true, monthly: true, forgot: true };
      await db.from('push_log').insert({ user_id: u, kind, day: t.ymd });   // 先に記録して、二重に送らない
      const [{ data: ev }, { data: ch }, { data: ib }] = await Promise.all([
        db.from('events').select('*').eq('household_id', h).is('deleted_at', null),
        kind === 'morning' ? db.from('chores').select('*').eq('household_id', h).is('deleted_at', null) : Promise.resolve({ data: [] }),
        kind === 'evening' ? db.from('card_inbox').select('id').eq('owner', u).eq('status', 'new') : Promise.resolve({ data: [] })]);
      let review: string | null = null;
      if (kind === 'morning' && t.ymd.endsWith('-01') && p.monthly !== false) {
        const { data: tx } = await db.from('transactions').select('date,amount,category,scope,kind,deleted_at').eq('household_id', h)
          .is('deleted_at', null).gte('date', monthOf(t.ymd, -2) + '-01').lt('date', t.ymd);
        review = monthlyReview(tx || [], t.ymd);
      }
      let recorded: boolean | null = null;
      if (kind === 'evening' && p.forgot !== false) {
        const { data: tx, error } = await db.from('transactions').select('id').eq('household_id', h).eq('date', t.ymd).is('deleted_at', null)
          .or(`paid_by.eq.${u},owner.eq.${u}`).limit(1);
        recorded = error ? null : (tx || []).length > 0;   // 読めなかったときは知らせない
      }
      const msg = digest(kind, t.ymd, u, p, ev || [], ch || [], (ib || []).length, review, recorded);
      if (msg) { result.digests++; result.pushed += await sendToUser(db, cfg, subsOf(u), msg, f); }
    }
  }
  return result;
}

// ---------- レシートの写真 ----------
// 後片付け:どの記録にも結び付いていない写真(1日以上前のもの)を消す。
// 記録はゴミ箱で7日たつと消えるので、写真もそのあと消える。確認待ちで「記録しない」にした写真も消える。
// deno-lint-ignore no-explicit-any
export async function cleanupPhotos(db: any, now: Date) {
  const bucket = db.storage.from('receipts');
  const { data: folders } = await bucket.list('', { limit: 1000 });
  const files: { path: string; at: string }[] = [];
  for (const f of folders || []) {
    if (!f.name || f.id) continue;   // フォルダ(=人ごと)だけを見る
    const { data } = await bucket.list(f.name, { limit: 1000 });
    for (const x of data || []) if (x.id) files.push({ path: `${f.name}/${x.name}`, at: x.created_at });
  }
  if (!files.length) return 0;
  const [{ data: tx }, { data: ib }] = await Promise.all([
    db.from('transactions').select('receipt_path').not('receipt_path', 'is', null),
    db.from('card_inbox').select('receipt_path').eq('status', 'new').not('receipt_path', 'is', null)]);
  const used = new Set([...(tx || []), ...(ib || [])].map((r: { receipt_path: string }) => r.receipt_path));
  const old = now.getTime() - 864e5;
  const gone = files.filter(f => !used.has(f.path) && Date.parse(f.at) < old).map(f => f.path);
  if (gone.length) await bucket.remove(gone);
  return gone.length;
}
// PCのバックアップ用:バックアップの鍵の持ち主に見える写真の、1時間だけ使える取り出し口を返す
// deno-lint-ignore no-explicit-any
export async function backupPhotos(db: any, token: string) {
  const { data: t } = await db.from('backup_tokens').select('user_id').eq('token', token).maybeSingle();
  if (!t) return { error: '鍵が正しくありません' };
  const u = t.user_id;
  const { data: m } = await db.from('members').select('household_id').eq('user_id', u).maybeSingle();
  if (!m) return { error: '暮らし帳に参加していません' };
  const [{ data: tx }, { data: ib }] = await Promise.all([
    db.from('transactions').select('receipt_path,scope,owner').eq('household_id', m.household_id).not('receipt_path', 'is', null),
    db.from('card_inbox').select('receipt_path').eq('owner', u).not('receipt_path', 'is', null)]);
  const paths = [...new Set([...(tx || []).filter((x: { scope: string; owner: string }) => x.scope === 'shared' || x.owner === u), ...(ib || [])]
    .map((x: { receipt_path: string }) => x.receipt_path))];
  if (!paths.length) return { photos: [] };
  const { data, error } = await db.storage.from('receipts').createSignedUrls(paths, 3600);
  if (error) return { error: error.message };
  return { photos: (data || []).filter((x: { signedUrl?: string }) => x.signedUrl).map((x: { path: string; signedUrl: string }) => ({ path: x.path, url: x.signedUrl })) };
}

// ---------- 入り口 ----------
// サーバー用の鍵:新しい形(SUPABASE_SECRET_KEYS)を先に使い、なければ古い形(SUPABASE_SERVICE_ROLE_KEY。廃止予定)を使う
export function serverKey(env: { get(k: string): string | undefined } = Deno.env) {
  try {
    const keys = JSON.parse(env.get('SUPABASE_SECRET_KEYS') || '{}');
    const k = keys.default || Object.values(keys)[0];
    if (typeof k === 'string' && k) return k;
  } catch (_) { /* 形が違えば古い鍵へ */ }
  const old = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!old) throw new Error('サーバー用の鍵が見つかりません');
  return old;
}
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const cfg = await ensureConfig(db);
    if (body.action === 'tick') {
      if (req.headers.get('x-kurashi-cron') !== cfg.cron_secret) return json({ error: '合言葉が違います' }, 401);
      return json(await tick(db, cfg, new Date()));
    }
    if (body.action === 'backup-photos') {   // PCのバックアップから(バックアップの鍵で確かめる)
      const r = await backupPhotos(db, String(body.token || ''));
      return json(r, r.error ? 401 : 200);
    }
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: 'ログインが必要です' }, 401);
    if (body.action === 'version') return json({ ok: true, version: VERSION, secret: !!serverKey() });   // 状態チェック用
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
