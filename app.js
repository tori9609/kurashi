// ふたりの暮らし帳：ログイン・招待・買い物リスト(第1段階)。予定・家事・家計簿は features.js(第2・第3段階)
// 仕組み：Supabase（データ保存とログイン）に、この画面からつなぐ。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as F from './features.js';

const $app = document.getElementById('app');
const COLORS = { shared: '#1F8A5B' };
const AISLES = [
  ['野菜・果物', ['キャベツ','玉ねぎ','にんじん','じゃがいも','トマト','レタス','きのこ','ねぎ','もやし','バナナ','りんご','みかん']],
  ['肉・魚', ['鶏','豚','牛','ひき肉','ベーコン','ハム','ウインナー','鮭','魚','ツナ']],
  ['卵・乳製品・豆腐', ['牛乳','卵','豆腐','納豆','ヨーグルト','チーズ','バター']],
  ['パン・主食', ['パン','米','パスタ','うどん','そば']],
  ['調味料・飲み物', ['醤油','味噌','砂糖','塩','油','水','お茶','コーヒー']],
  ['日用品', ['トイレットペーパー','ティッシュ','洗剤','シャンプー','ゴミ袋','ラップ','歯ブラシ']],
];
const DEFAULT_NAMES = ['牛乳','卵','食パン','豆腐','納豆','キャベツ','玉ねぎ','鶏むね肉','トイレットペーパー','洗剤'];
// 下のメニュー:ホーム・予定(カレンダーとやること)・真ん中の「＋」・買い物・家計簿
const TABS = [['home','ホーム','home'],['calendar','予定','cal'],['+'],['shopping','買い物','cart'],['kakeibo','家計簿','wallet']];

const st = { session: null, me: null, members: [], items: [], names: [], acts: [], going: {}, urgent: false, sheet: null, channel: null };
let sb = null;

// ---------- 小さな道具 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const icon = (k, cls) => F.ic(k, cls);
const nameOf = uid => (st.members.find(m => m.user_id === uid) || {}).display_name || '（退出したメンバー）';
const colorOf = uid => (st.members.find(m => m.user_id === uid) || {}).color || '#9AA1AC';
const route = () => (location.hash.replace('#', '') || 'home');
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}
// ---------- 圏外 ----------
// 最後に読んだ内容を端末に残し、圏外でも見られるようにする。買い物・やることのチェックや追加は、つながったら送る。
const SNAP = 'kurashi.snap', OUTBOX = 'kurashi.outbox';
const isNet = e => (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(String(e?.message || e || ''));
const SNAP_KEYS = ['me', 'members', 'items', 'names', 'acts', 'events', 'chores', 'fixed', 'budgets', 'goals', 'settles', 'tx', 'inbox', 'kb'];
function saveSnap() {
  if (!st.me || st.offline) return;
  clearTimeout(saveSnap.t);
  saveSnap.t = setTimeout(() => { try { localStorage.setItem(SNAP, JSON.stringify({ at: Date.now(), ...Object.fromEntries(SNAP_KEYS.map(k => [k, st[k]])) })); } catch { /* 容量いっぱいなどは無視 */ } }, 400);
}
function loadSnap(uid) {
  try { const s = JSON.parse(localStorage.getItem(SNAP) || 'null'); if (!s?.me || (uid && s.me.user_id !== uid)) return false; Object.assign(st, s, { snapAt: s.at }); return true; }
  catch { return false; }
}
const outbox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } };
const setOutbox = b => { try { if (b.length) localStorage.setItem(OUTBOX, JSON.stringify(b)); else localStorage.removeItem(OUTBOX); } catch { /* 無視 */ } };
function query(x) {
  let b = sb.from(x.table);
  b = x.op === 'insert' ? b.insert(x.values) : x.op === 'update' ? b.update(x.values) : b.delete();
  if (x.op !== 'insert') for (const [k, v] of Object.entries(x.match || {})) b = b.eq(k, v);
  return b;
}
// 書き込み:つながっていればすぐ送る。圏外なら端末にためて、つながったら送る
async function send(table, op, values, match) {
  const x = { table, op, values, match };
  if (!st.offline) {
    const { error } = await query(x);
    if (!error) return true;
    if (!isNet(error)) { toast(error.message || 'うまくいきませんでした'); throw error; }
    st.offline = true; st.snapAt ||= Date.now();
  }
  setOutbox([...outbox(), x]);
  toast('圏外のため、つながったら送ります');
  try { localStorage.setItem(SNAP, JSON.stringify({ at: st.snapAt || Date.now(), ...Object.fromEntries(SNAP_KEYS.map(k => [k, st[k]])) })); } catch { /* 無視 */ }
  render();
  return false;
}
// ためておいた分を順に送る。圏外に戻ったら、そこで止めて残す
async function flushOutbox() {
  const box = outbox(); if (!box.length) return 0;
  let sent = 0;
  for (let i = 0; i < box.length; i++) {
    const { error } = await query(box[i]);
    if (error && isNet(error)) { setOutbox(box.slice(i)); return sent; }
    sent++;   // ほかの失敗(消された品物のチェックなど)は、送れないので捨てる
  }
  setOutbox([]);
  if (sent) toast(`圏外のあいだの${sent}件を送りました`);
  return sent;
}
function goOffline() {
  st.offline = true; F.initState(); render();
}
window.addEventListener('online', async () => {
  if (!st.me || !st.offline) return;
  try { await flushOutbox(); await loadAll(); st.offline = false; st.snapAt = null; subscribe(); render(); } catch { /* まだ不安定ならそのまま */ }
});

async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error && isNet(error)) { toast('圏外のため、いまは保存・読み込みができません。つながってから、もう一度お試しください'); throw error; }
  if (error) { toast(error.message || 'うまくいきませんでした'); throw error; }
  if (okMsg) toast(okMsg);
  return data;
}
// 売り場:名前に含まれる言葉のうち、いちばん長く当てはまるもので決める(「牛乳」は「牛」より「牛乳」を優先)
const aisleOf = n => { let best = AISLES.length, len = 0; AISLES.forEach((a, i) => a[1].forEach(k => { if (n.includes(k) && k.length > len) { best = i; len = k.length; } })); return best; };
function parseItem(raw) {
  const t = raw.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.+?)[\s×xX]+(\d{1,2})$/);
  return m ? { name: m[1].trim(), qty: Math.max(1, parseInt(m[2], 10)) } : { name: t, qty: 1 };
}

// ---------- はじまり ----------
async function init() {
  const pending = new URLSearchParams(location.search).get('join');
  if (pending) localStorage.setItem('kurashi.join', pending.toUpperCase());
  if (!SUPABASE_URL || SUPABASE_URL.includes('ここに')) return renderSetup();
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { st.recovery = true; location.hash = '#settings'; }
    const was = st.session?.user?.id; st.session = session; if (was !== session?.user?.id) boot();
  });
  const { data } = await sb.auth.getSession(); st.session = data.session; boot();
  window.addEventListener('hashchange', () => { st.sheet = st.nextSheet || null; st.nextSheet = null; if (route() === 'trash') st.trash = null; render(); window.scrollTo(0, 0); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  if (!st.session) { if (navigator.onLine === false && loadSnap()) return goOffline(); return renderLogin(); }
  const uid = st.session.user.id;
  try {
    const { data: mine, error } = await sb.from('members').select('*').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (!mine) return renderOnboard();
    st.me = mine;
    await flushOutbox();
    await loadAll();
    st.offline = false; st.snapAt = null;
    subscribe();
    render();
  } catch (e) {
    if (isNet(e) && loadSnap(uid)) return goOffline();
    toast('読み込めませんでした。通信を確かめて、開き直してください');
  }
}

async function loadAll() {
  const h = st.me.household_id;
  const [m, i, n, a] = await Promise.all([
    run(sb.from('members').select('*').eq('household_id', h).order('joined_at')),
    run(sb.from('shopping_items').select('*').eq('household_id', h).order('created_at')),
    run(sb.from('item_names').select('*').eq('household_id', h).order('last_used', { ascending: false }).limit(300)),
    run(sb.from('activities').select('*').eq('household_id', h).order('created_at', { ascending: false }).limit(20)),
  ]);
  st.members = m; st.items = i; st.names = n; st.acts = a;
  await F.loadFeatures();
}

async function reloadItems() {
  st.items = await run(sb.from('shopping_items').select('*').eq('household_id', st.me.household_id).order('created_at'));
  softRender();
}

// 入力中(シートや設定・家計簿の入力欄)は、相手の変更で画面を描き直さない(入力が消えないように)
function softRender() {
  const typing = document.activeElement?.matches?.('form[data-form] input:not(#add), form[data-form] select');
  if (st.sheet?.form || typing) { st.dirty = true; return; }
  render();
}

function subscribe() {
  if (st.channel) sb.removeChannel(st.channel);
  const h = st.me.household_id;
  st.channel = sb.channel('hh-' + h)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: 'household_id=eq.' + h }, reloadItems)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities', filter: 'household_id=eq.' + h }, ({ new: a }) => {
      st.acts = [a, ...st.acts].slice(0, 20); if (a.user_id !== st.me.user_id) toast(a.message); softRender(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: 'household_id=eq.' + h }, () => F.reloadEvents().then(softRender))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chores', filter: 'household_id=eq.' + h }, () => F.reloadChores().then(softRender))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: 'household_id=eq.' + h }, () => F.loadTx(false).then(softRender))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'card_inbox', filter: 'household_id=eq.' + h }, () => F.reloadInbox().then(softRender))
    .on('broadcast', { event: 'going' }, ({ payload }) => { st.going[payload.user_id] = payload.going; softRender(); })
    .subscribe();
}

// ---------- 画面：設定前・ログイン・参加 ----------
function renderSetup() {
  $app.innerHTML = `<main class="screen plain"><h1>あと少しで使えます</h1>
  <div class="card"><p class="muted">config.js に Supabase の「Project URL」と「Publishable key」を貼ってください。手順は README.md にあります。</p></div></main>`;
}

// ホーム画面に追加したアプリは、Safariとログイン情報が別になる。
// メールのリンクはSafariで開くため、アプリ側では「メールアドレス+パスワード」でログインする。
function renderLogin(sent) {
  $app.innerHTML = `<main class="screen plain" style="padding-top:14vh">
  <h1 style="font-size:30px;color:var(--accent-text)">ふたりの暮らし帳</h1>
  <p class="muted">予定・家計簿・買い物・やることをふたりで共有</p>
  ${sent ? `<div class="card"><h2>メールを送りました</h2><p class="muted">${esc(sent)}</p>
     <button class="btn text" data-act="relogin">ログイン画面に戻る</button></div>` : `
  <form class="card stack" data-form="login" novalidate>
    <div class="field"><label for="mail">メールアドレス</label><input id="mail" type="email" autocomplete="username" required placeholder="name@example.com"></div>
    <div class="field"><label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password" placeholder="8文字以上"></div>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">ログイン</button>
    <button class="btn" type="button" data-act="signup">はじめての方:このパスワードで登録</button>
  </form>
  <div class="card stack"><p class="muted hint" style="margin:0;font-size:13px">パスワードをまだ決めていない方・忘れた方</p>
    <button class="btn text" data-act="magic">メールのリンクでログイン(Safariで開きます)</button>
    <button class="btn text" data-act="forgot">パスワードを設定し直すメールを送る</button></div>`}</main>`;
}
const AUTH_MSG = {
  'Invalid login credentials': 'メールアドレスかパスワードが違います。パスワードをまだ決めていない場合は、下の「パスワードを設定し直すメールを送る」を使ってください。',
  'Email not confirmed': '確認メールのリンクをまだ押していません。メールを確かめてください。',
  'User already registered': 'このメールアドレスは登録済みです。「ログイン」を押すか、パスワードを設定し直してください。',
};
function loginInput(needPw) {
  const mail = document.getElementById('mail').value.trim(), pw = document.getElementById('pw').value, err = document.getElementById('err');
  const bad = m => { err.textContent = m; err.hidden = false; return null; };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return bad('メールアドレスを正しく入れてください');
  if (needPw && pw.length < 8) return bad('パスワードは8文字以上にしてください');
  return { mail, pw };
}
async function authCall(promise) {
  const { data, error } = await promise;
  if (error) { const e = document.getElementById('err'); if (e) { e.textContent = AUTH_MSG[error.message] || error.message; e.hidden = false; } return null; }
  return data || {};
}

function renderOnboard() {
  const code = localStorage.getItem('kurashi.join') || '';
  $app.innerHTML = `<main class="screen plain" style="padding-top:12vh">
  <h1>はじめに</h1>
  <form class="card" data-form="onboard" novalidate>
    <div class="field"><label for="dname">あなたの呼び名（相手に表示されます）</label><input id="dname" type="text" maxlength="20" required placeholder="例：とり"></div>
    <div class="field"><label for="code">招待コード（招待された人だけ）</label><input id="code" type="text" maxlength="8" value="${esc(code)}" placeholder="例：7KQ2M9XA" autocapitalize="characters"></div>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">${code ? '暮らし帳に参加する' : 'はじめる'}</button>
    <p class="muted hint" style="font-size:13px">招待コードが空なら、新しい暮らし帳を作ります。あとから相手を招待できます。</p>
  </form>
  <button class="btn text" data-act="logout">別のメールでログインし直す</button></main>`;
}

// ---------- 画面：本体 ----------
function render() {
  if (!st.me) return;
  const r = route();
  const body = { home: viewHome, shopping: viewShopping, settings: viewSettings, trash: F.viewTrash, search: F.viewSearch, calendar: F.viewCalendar, chores: F.viewChores, kakeibo: F.viewKakeibo }[r] || viewHome;
  st.dirty = false;
  F.applyTheme();
  const off = st.offline ? `<div class="offline" role="status">${icon('cloudOff')}圏外です。${st.snapAt ? new Date(st.snapAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '時点の' : '端末に残っている'}内容を表示しています。${outbox().length ? `送っていない変更 ${outbox().length}件は、つながったら送ります。` : '買い物とやることのチェックは、圏外でもできます。'}</div>` : '';
  $app.innerHTML = off + body() + tabbar(r) + sheet();
  helpButton(r);
  saveSnap();
  const inp = document.getElementById('add'); if (inp && st.keepFocus) { inp.focus(); st.keepFocus = false; }
}

// 説明文は「？」を押したときだけ出す(設定の画面と、入力の画面はいつも出す)
function helpButton(r) {
  const root = document.documentElement; root.dataset.route = r; root.classList.toggle('help', !!st.help);
  const head = $app.querySelector('.screen > .head'); if (r === 'settings' || !head || !$app.querySelector('.screen .hint')) return;
  let nav = head.querySelector('.nav'); if (!nav) { nav = document.createElement('div'); nav.className = 'nav'; head.appendChild(nav); }
  nav.insertAdjacentHTML('afterbegin', `<button class="iconbtn help${st.help ? ' on' : ''}" data-act="helpToggle" aria-pressed="${!!st.help}" aria-label="${st.help ? '説明をしまう' : '説明を出す'}">${icon('help')}</button>`);
}
function tabbar(r) {
  const cur = r === 'chores' ? 'calendar' : r;
  return `<nav class="tabbar" aria-label="メニュー">${TABS.map(([k, l, ic]) => k === '+'
    ? `<button class="tab-add" data-act="quickAdd" aria-label="追加する">${icon('plus')}</button>`
    : `<a href="#${k}" ${cur === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('')}</nav>`;
}

function viewHome() {
  const todo = st.items.filter(i => !i.done), urgent = todo.filter(i => i.urgent);
  const d = new Date(), w = '日月火水木金土'[d.getDay()], evs = F.eventsOn(F.ymd(d)), chs = F.choresToday();
  const me = st.me, initial = esc((me.display_name || '?').slice(0, 1));
  const shop = urgent.map(i => `<a class="row" href="#shopping" style="--c:${colorOf(i.added_by)}">${icon('cart', 'lead')}<span class="main"><span class="name">${esc(i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}</span><span class="sub">${F.who(i.added_by)}が追加</span></span><span class="tag">急ぎ</span></a>`).join('');
  const none = !evs.length && !chs.length && !urgent.length;
  return `<main class="screen">
  <div class="head"><div><small>${d.getMonth() + 1}月${d.getDate()}日(${w})</small><h1>今日</h1></div>
    <div class="nav"><a class="iconbtn" href="#search" aria-label="検索">${icon('search')}</a><a class="avatar" href="#settings" style="--c:${colorOf(me.user_id)}" aria-label="設定(${esc(me.display_name)})">${initial}</a></div></div>
  ${goingBanner()}
  ${F.inboxCount() ? `<a class="banner" href="#kakeibo">${icon('card')}カード利用の確認待ちが${F.inboxCount()}件あります</a>` : ''}
  ${F.moneyCardHtml()}
  <section class="card list today">
    ${evs.length ? `<h2 class="group-title">${icon('cal')}予定</h2>${evs.slice(0, 6).map(F.evRow).join('')}` : ''}
    ${chs.length ? `<h2 class="group-title">${icon('todo')}やること</h2>${chs.map(F.choreRow).join('')}` : ''}
    ${urgent.length ? `<h2 class="group-title">${icon('cart')}急ぎの買い物</h2>${shop}` : ''}
    ${none ? '<p class="empty">今日の予定・やること・急ぎの買い物はありません</p>' : ''}
    <a class="more" href="#shopping">買い物リスト 残り${todo.length}件${icon('right')}</a></section>
  ${st.acts.length ? `<section class="card list"><h2 class="group-title">${icon('bell')}お知らせ</h2>
    ${st.acts.slice(0, 3).map(a => `<div class="act"><span class="dot" style="background:${colorOf(a.user_id)}"></span><span class="main"><span>${esc(a.message)}</span>
      <span class="sub">${new Date(a.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span></div>`).join('')}</section>` : ''}
  </main>`;
}

function goingBanner() {
  const others = Object.entries(st.going).filter(([u, g]) => g && u !== st.me.user_id).map(([u]) => nameOf(u));
  if (st.going[st.me.user_id]) return `<div class="banner" role="status">あなたが買い物中です。相手に知らせました</div>`;
  if (others.length) return `<div class="banner" role="status">${esc(others.join('・'))}さんが買い物中です。追加するなら今のうちに</div>`;
  return '';
}

function viewShopping() {
  const todo = st.items.filter(i => !i.done), done = st.items.filter(i => i.done);
  const groups = [...AISLES.map(a => a[0]), 'その他'].map((g, gi) => ({ g, items: todo.filter(i => aisleOf(i.name) === gi) })).filter(x => x.items.length);
  const going = !!st.going[st.me.user_id];
  return `<main class="screen">
  <div class="head"><div><small>みんなで共有</small><h1>買い物リスト</h1></div>
    <button class="pill go ${going ? 'on' : ''}" data-act="going" aria-pressed="${going}">${going ? '買い物おわり' : '買い物に行く'}</button></div>
  ${goingBanner()}
  ${F.soonHtml(st.names, st.items)}
  ${groups.map(({ g, items }) => `<section class="card list"><h2 class="group-title">${g}</h2>
    ${items.map(i => `<button class="row" data-act="toggle" data-id="${i.id}" aria-pressed="false" style="--c:${colorOf(i.added_by)}">
      <span class="box"></span><span class="main"><span class="name">${esc(i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}</span><span class="sub">${F.who(i.added_by)}が追加</span></span>
      ${i.urgent ? '<span class="tag">急ぎ</span>' : ''}</button>`).join('')}</section>`).join('')}
  ${!todo.length ? '<p class="muted" style="text-align:center">買うものはありません</p>' : ''}
  ${done.length ? `<section class="card list"><h2 class="group-title">カゴに入れた（${done.length}）</h2>
    ${done.map(i => `<button class="row done" data-act="toggle" data-id="${i.id}" aria-pressed="true"><span class="box">${icon('tick')}</span>
      <span class="main"><span class="name">${esc(i.name)}</span></span><span class="sub">${esc(nameOf(i.done_by))}</span></button>`).join('')}
    <div style="display:flex;gap:8px;padding:8px 0 10px"><button class="btn" style="flex:1;font-size:15px;white-space:nowrap" data-act="askClear">リストから消す</button>
      <button class="btn green" style="flex:1.4" data-act="txFromShop">家計簿に記録する</button></div></section>` : ''}
  </main>
  <div class="addbar"><div class="inner">
    <div class="sugg" id="sugg">${suggHtml()}</div>
    <form class="addrow" data-form="add"><label class="sr" for="add">追加する品物</label>
      <input id="add" type="text" maxlength="60" placeholder="品物を追加（例：牛乳 2）" value="${esc(st.draft || '')}" enterkeyhint="done" autocomplete="off">
      <button type="button" class="pill ${st.urgent ? 'on' : ''}" data-act="urgent" aria-pressed="${st.urgent}" style="border-radius:12px;min-height:48px">急ぎ</button>
      <button type="submit" class="plus" aria-label="追加">${icon('plus')}</button></form></div></div>`;
}

// 入力候補（日本語入力を邪魔しないよう、候補の部分だけを書きかえる）
// 並び:★固定 → よく買う順(回数・最近) → 最初から入っている品物。入力中は、名前に入力した文字を含むものだけ(ひらがな・カタカナは同じとみなす)
const kana = s => String(s).toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s/g, '');
function candidates() {
  const rows = st.names, known = new Set(rows.map(r => r.name));
  const live = rows.filter(r => !r.hidden);
  const pin = live.filter(r => r.pinned).sort((a, b) => b.uses - a.uses);
  const rest = live.filter(r => !r.pinned).sort((a, b) => b.uses - a.uses || String(b.last_used).localeCompare(String(a.last_used)));
  return [...pin.map(r => ({ name: r.name, pinned: true, uses: r.uses })), ...rest.map(r => ({ name: r.name, pinned: false, uses: r.uses })),
    ...DEFAULT_NAMES.filter(n => !known.has(n)).map(n => ({ name: n, pinned: false, uses: 0, preset: true }))];
}
function suggHtml() {
  const inList = new Set(st.items.filter(i => !i.done).map(i => i.name));
  const q = kana(parseItem(st.draft || '').name);
  let list = candidates().filter(c => !inList.has(c.name));
  if (q) list = list.filter(c => kana(c.name).includes(q)).sort((a, b) => kana(b.name).startsWith(q) - kana(a.name).startsWith(q));
  return list.slice(0, q ? 10 : 12).map(c => `<button type="button" data-act="quick" data-name="${esc(c.name)}"${c.pinned ? ' class="pin"' : ''}>${icon(c.pinned ? 'star' : 'plus', c.pinned ? 'fill' : '')}${esc(c.name)}</button>`).join('')
    + (q ? '' : `<button type="button" class="edit" data-act="suggEdit">${icon('edit')}ボタンを編集</button>`);
}
function suggSheet() {
  const all = candidates(), hidden = st.names.filter(r => r.hidden);
  const row = c => `<div class="row"><span class="main"><span class="name">${esc(c.name)}</span><span class="sub">${c.preset ? '最初から入っている品物' : `これまで${c.uses}回`}</span></span>
    <button class="pill${c.pinned ? ' on' : ''}" data-act="pin" data-name="${esc(c.name)}" aria-pressed="${c.pinned}" aria-label="${esc(c.name)}をいつもボタンに出す">${icon('star', c.pinned ? 'fill' : '')}${c.pinned ? '固定中' : '固定'}</button>
    <button class="pill" data-act="hideName" data-name="${esc(c.name)}" aria-label="${esc(c.name)}を候補から外す">外す</button></div>`;
  return `<div class="sheet-bg" data-act="close"><div class="sheet" role="dialog" aria-label="ボタンを編集" data-stop>
    <h2>買い物のボタンを編集</h2>
    <p class="muted" style="margin:0">星を付けた品物は、いつも先頭にボタンで出ます。ほかは、よく買う順に並びます。入力中は、入れた文字を含む品物だけが出ます。</p>
    <form class="addrow" data-form="pinAdd"><label class="sr" for="pinName">ボタンにする品物</label><input id="pinName" type="text" maxlength="60" placeholder="ボタンにしたい品物(例：ヨーグルト)" autocomplete="off"><button type="submit" class="plus" aria-label="ボタンに追加">${icon('plus')}</button></form>
    <div class="list">${all.map(row).join('')}</div>
    ${hidden.length ? `<h3 class="sub-title">候補から外したもの</h3><div class="list">${hidden.map(r => `<div class="row"><span class="main"><span class="name">${esc(r.name)}</span></span><button class="pill" data-act="unhideName" data-name="${esc(r.name)}">戻す</button></div>`).join('')}</div>` : ''}
    <button class="btn" data-act="close">閉じる</button></div></div>`;
}
// 候補の行を保存(なければ作る)
async function saveName(name, patch) {
  const h = st.me.household_id, r = st.names.find(x => x.name === name);
  if (r) { Object.assign(r, patch); await run(sb.from('item_names').update(patch).eq('household_id', h).eq('name', name)); }
  else { const row = { household_id: h, name, uses: 0, last_used: new Date().toISOString(), pinned: false, hidden: false, ...patch }; st.names.unshift(row); await run(sb.from('item_names').insert(row)); }
}

function viewSettings() {
  return `<main class="screen">
  <div class="head"><div><small><a href="#home" class="back">${icon('left')}ホーム</a></small><h1>設定</h1></div></div>
  <section class="card list"><h2 class="group-title">メンバー（最大5人）</h2>
    ${st.members.map(m => `<div class="row"><span class="dot" style="background:${m.color}"></span><span class="main"><span class="name">${esc(m.display_name)}${m.user_id === st.me.user_id ? '（自分）' : ''}</span></span><span class="sub">${m.is_admin ? '管理者' : ''}</span></div>`).join('')}
    ${st.me.is_admin && st.members.length < 5 ? '<button class="btn primary" style="margin:8px 0 10px" data-act="invite">メンバーを招待する</button>' : ''}</section>
  <form class="card stack" data-form="pw" novalidate><h2>${st.recovery ? '新しいパスワードを決めてください' : 'パスワード'}</h2>
    <p class="muted hint" style="margin:0;font-size:13px">ホーム画面のアプリでは、メールアドレスとこのパスワードでログインします。</p>
    <input type="text" autocomplete="username" value="${esc(st.session?.user?.email || '')}" hidden>
    <div class="field"><label for="newpw">新しいパスワード(8文字以上)</label><input id="newpw" type="password" autocomplete="new-password"></div>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">パスワードを設定する</button></form>
  ${F.appearanceSettingsHtml()}${F.notifySettingsHtml()}${F.calSettingsHtml()}${F.widgetSettingsHtml()}${F.backupSettingsHtml()}${F.cardSettingsHtml()}
  <section class="card"><h2>アプリとして使う</h2><p class="muted">Safariの共有ボタン →「ホーム画面に追加」で、アイコンから開けます。ログインは一度すれば残ります。</p></section>
  <a class="btn" href="#trash" style="display:flex;align-items:center;justify-content:center;text-decoration:none;color:var(--ink)">ゴミ箱(消したものを7日間は戻せます)</a>
  <button class="btn danger" data-act="logout">ログアウト</button>
  </main>`;
}

function sheet() {
  if (!st.sheet) return '';
  if (st.sheet.type === 'invite') {
    const link = location.origin + location.pathname + '?join=' + st.sheet.code;
    return `<div class="sheet-bg" data-act="close"><div class="sheet" role="dialog" aria-label="メンバーを招待" data-stop>
      <span class="grip"></span><h2 style="font-size:17px">メンバーを招待</h2>
      <p class="muted">このリンクを相手に送ってください。開いてログインすると参加できます。7日間有効です。</p>
      <div class="codebox">${esc(link)}</div><p class="muted">招待コード：<b>${esc(st.sheet.code)}</b></p>
      <button class="btn primary" data-act="share" data-link="${esc(link)}">リンクを送る</button>
      <button class="btn" data-act="close">閉じる</button></div></div>`;
  }
  if (st.sheet.type === 'clear') {
    return `<div class="sheet-bg" data-act="close"><div class="sheet" role="dialog" aria-label="確認" data-stop>
      <span class="grip"></span><h2 style="font-size:17px">カゴに入れた品物をリストから消しますか？</h2>
      <p class="muted">消した品物は、入力候補には残ります。</p>
      <button class="btn primary" data-act="clear">消す</button><button class="btn" data-act="close">やめる</button></div></div>`;
  }
  if (st.sheet.type === 'sugg') return suggSheet();
  return F.sheetHtml();
}

// ---------- 操作 ----------
async function addItem(raw) {
  const { name, qty } = parseItem(raw);
  if (!name) return;
  const h = st.me.household_id;
  st.draft = ''; st.keepFocus = true;
  const row = { id: crypto.randomUUID(), household_id: h, name, qty, urgent: st.urgent, added_by: st.me.user_id };
  st.items.push({ ...row, done: false, done_by: null, created_at: new Date().toISOString() }); st.urgent = false; render();   // 先に画面に出す
  if (!await send('shopping_items', 'insert', row)) return;   // 圏外ならここまで(候補の回数やお知らせは送らない)
  await reloadItems();
  const nr = st.names.find(x => x.name === name), uses = (nr?.uses || 0) + 1, last_used = new Date().toISOString();
  const added_dates = F.pushDate(nr?.added_dates, F.today());   // 買い時の見当に使う(最近8回の日付)
  sb.from('item_names').upsert({ household_id: h, name, uses, last_used, hidden: false, added_dates })
    .then(r => { if (r.error) sb.from('item_names').upsert({ household_id: h, name, uses, last_used, hidden: false }).then(() => {}); });   // SQL(追加分16)の前でも回数は残す
  if (nr) Object.assign(nr, { uses, last_used, hidden: false, added_dates }); else st.names.unshift({ name, uses, last_used, pinned: false, hidden: false, added_dates });
  sb.from('activities').insert({ household_id: h, message: `${st.me.display_name}さんが「${name}」を買い物リストに追加しました` }).then(() => {});
}

document.addEventListener('submit', async e => {
  const f = e.target.dataset.form; if (!f) return; e.preventDefault();
  if (f === 'login') {
    const v = loginInput(true); if (!v) return;
    await authCall(sb.auth.signInWithPassword({ email: v.mail, password: v.pw }));   // うまくいけば onAuthStateChange が画面を切りかえる
  }
  if (f === 'pw') {
    const pw = document.getElementById('newpw').value, err = document.getElementById('err');
    if (pw.length < 8) { err.textContent = 'パスワードは8文字以上にしてください'; err.hidden = false; return; }
    await run(sb.auth.updateUser({ password: pw }), 'パスワードを設定しました');
    st.recovery = false; render();
  }
  if (f === 'onboard') {
    const dn = document.getElementById('dname').value.trim(), code = document.getElementById('code').value.trim();
    const err = document.getElementById('err');
    if (!dn) { err.textContent = '呼び名を入れてください'; err.hidden = false; return; }
    try {
      if (code) await run(sb.rpc('join_household', { p_code: code, p_display_name: dn }), '参加しました');
      else await run(sb.rpc('create_household', { p_name: 'ふたりの暮らし帳', p_display_name: dn }), '暮らし帳を作りました');
      localStorage.removeItem('kurashi.join'); history.replaceState(null, '', location.pathname); boot();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  }
  if (f === 'add') await addItem(document.getElementById('add').value);
  if (f === 'pinAdd') { const name = parseItem(document.getElementById('pinName').value).name; if (!name) return;
    await saveName(name, { pinned: true, hidden: false }); toast(`「${name}」をボタンに固定しました`); render(); }
  if (st.me) await F.onSubmit(f);
});

document.addEventListener('input', e => {
  if (e.target.id !== 'add') return;
  st.draft = e.target.value;
  const box = document.getElementById('sugg'); if (box) box.innerHTML = suggHtml();
});

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'close' && e.target.closest('[data-stop]') && !e.target.closest('button[data-act="close"]')) return;
  const h = st.me?.household_id, act = el.dataset.act;
  if (act === 'helpToggle') { st.help = !st.help; render(); return; }
  if (st.me && await F.onClick(act, el)) return;
  if (act === 'logout') { try { localStorage.removeItem(SNAP); localStorage.removeItem(OUTBOX); } catch { /* 無視 */ } await sb.auth.signOut(); st.me = null; return; }
  if (act === 'relogin') return renderLogin();
  const back = location.origin + location.pathname;
  if (act === 'signup') {
    const v = loginInput(true); if (!v) return;
    const d = await authCall(sb.auth.signUp({ email: v.mail, password: v.pw, options: { emailRedirectTo: back } })); if (!d) return;
    if (!d.session) renderLogin(`${v.mail} に確認メールを送りました。メールの「Confirm email address」を押したあと、このアプリに戻って「ログイン」してください。`);
    return;
  }
  if (act === 'magic') {
    const v = loginInput(false); if (!v) return;
    if (await authCall(sb.auth.signInWithOtp({ email: v.mail, options: { emailRedirectTo: back } })))
      renderLogin(`${v.mail} に届いたリンクを押すと、Safariでログインできます。ホーム画面のアプリでも使うには、Safariで「設定」→「パスワード」を決めてから、アプリで「ログイン」してください。`);
    return;
  }
  if (act === 'forgot') {
    const v = loginInput(false); if (!v) return;
    if (await authCall(sb.auth.resetPasswordForEmail(v.mail, { redirectTo: back })))
      renderLogin(`${v.mail} にメールを送りました。リンクを押すとSafariで開くので、表示された画面で新しいパスワードを決めてください。そのあと、このアプリに戻って「ログイン」してください。`);
    return;
  }
  if (act === 'toggle') {
    const it = st.items.find(i => i.id === el.dataset.id); if (!it) return;
    it.done = !it.done; it.done_by = it.done ? st.me.user_id : null; render();   // 先に画面を変えて、あとで保存
    await send('shopping_items', 'update', { done: it.done, done_by: it.done_by }, { id: it.id });
  }
  if (act === 'quick') await addItem(el.dataset.name);
  if (act === 'suggEdit') { st.sheet = { type: 'sugg' }; render(); }
  if (act === 'pin') { const c = candidates().find(x => x.name === el.dataset.name); await saveName(el.dataset.name, { pinned: !c?.pinned, hidden: false }); render(); }
  if (act === 'hideName') { await saveName(el.dataset.name, { hidden: true, pinned: false }); toast('候補から外しました(下の「候補から外したもの」で戻せます)'); render(); }
  if (act === 'unhideName') { await saveName(el.dataset.name, { hidden: false }); render(); }
  if (act === 'urgent') { st.urgent = !st.urgent; render(); }
  if (act === 'going') {
    const g = !st.going[st.me.user_id]; st.going[st.me.user_id] = g; render();
    st.channel?.send({ type: 'broadcast', event: 'going', payload: { user_id: st.me.user_id, going: g } });
    sb.from('activities').insert({ household_id: h, message: `${st.me.display_name}さんが${g ? '買い物に行きます' : '買い物を終えました'}` }).then(() => {});
  }
  if (act === 'askClear') { st.sheet = { type: 'clear' }; render(); }
  if (act === 'clear') { st.sheet = null; st.items = st.items.filter(i => !i.done); render();
    if (await send('shopping_items', 'delete', null, { household_id: h, done: true })) { toast('リストから消しました'); await reloadItems(); } }
  if (act === 'invite') { const code = await run(sb.rpc('renew_invite', { h })); st.sheet = { type: 'invite', code }; render(); }
  if (act === 'share') {
    const link = el.dataset.link;
    if (navigator.share) { try { await navigator.share({ title: 'ふたりの暮らし帳に招待', text: '暮らし帳に参加してね', url: link }); } catch { } }
    else { await navigator.clipboard.writeText(link); toast('リンクをコピーしました'); }
  }
  if (act === 'close') { st.sheet = null; render(); }
});

F.setup({ st, sb: () => sb, run, send, esc, render, toast, nameOf, colorOf, url: SUPABASE_URL, key: SUPABASE_ANON_KEY });
init();
