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
const ICON = {
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  yen: '<path d="M6 4l6 8 6-8M12 12v8M7 13h10M7 17h10"/>',
  cart: '<path d="M3 4h3l2 11h11l2-8H7"/><circle cx="10" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
};
const TABS = [['home','ホーム','home'],['calendar','予定','cal'],['kakeibo','家計簿','yen'],['shopping','買い物','cart'],['chores','家事','check']];

const st = { session: null, me: null, members: [], items: [], names: [], acts: [], going: {}, urgent: false, sheet: null, channel: null };
let sb = null;

// ---------- 小さな道具 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const nameOf = uid => (st.members.find(m => m.user_id === uid) || {}).display_name || '（退出したメンバー）';
const colorOf = uid => (st.members.find(m => m.user_id === uid) || {}).color || '#9AA1AC';
const route = () => (location.hash.replace('#', '') || 'home');
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}
async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { toast(error.message || 'うまくいきませんでした'); throw error; }
  if (okMsg) toast(okMsg);
  return data;
}
const aisleOf = n => { const i = AISLES.findIndex(a => a[1].some(k => n.includes(k))); return i < 0 ? AISLES.length : i; };
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
  window.addEventListener('hashchange', () => { st.sheet = st.nextSheet || null; st.nextSheet = null; render(); window.scrollTo(0, 0); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  if (!st.session) return renderLogin();
  const uid = st.session.user.id;
  const mine = await run(sb.from('members').select('*').eq('user_id', uid).maybeSingle());
  if (!mine) return renderOnboard();
  st.me = mine;
  await loadAll();
  subscribe();
  render();
}

async function loadAll() {
  const h = st.me.household_id;
  const [m, i, n, a] = await Promise.all([
    run(sb.from('members').select('*').eq('household_id', h).order('joined_at')),
    run(sb.from('shopping_items').select('*').eq('household_id', h).order('created_at')),
    run(sb.from('item_names').select('name,last_used').eq('household_id', h).order('last_used', { ascending: false }).limit(40)),
    run(sb.from('activities').select('*').eq('household_id', h).order('created_at', { ascending: false }).limit(20)),
  ]);
  st.members = m; st.items = i; st.names = n.map(x => x.name); st.acts = a;
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
  <h1 style="font-size:30px;color:var(--blue)">ふたりの暮らし帳</h1>
  <p class="muted">予定・家計簿・買い物・家事をふたりで共有</p>
  ${sent ? `<div class="card"><h2>メールを送りました</h2><p class="muted">${esc(sent)}</p>
     <button class="btn text" data-act="relogin">ログイン画面に戻る</button></div>` : `
  <form class="card stack" data-form="login" novalidate>
    <div class="field"><label for="mail">メールアドレス</label><input id="mail" type="email" autocomplete="username" required placeholder="name@example.com"></div>
    <div class="field"><label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password" placeholder="8文字以上"></div>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">ログイン</button>
    <button class="btn" type="button" data-act="signup">はじめての方:このパスワードで登録</button>
  </form>
  <div class="card stack"><p class="muted" style="margin:0;font-size:13px">パスワードをまだ決めていない方・忘れた方</p>
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
    <p class="muted" style="font-size:13px">招待コードが空なら、新しい暮らし帳を作ります。あとから相手を招待できます。</p>
  </form>
  <button class="btn text" data-act="logout">別のメールでログインし直す</button></main>`;
}

// ---------- 画面：本体 ----------
function render() {
  if (!st.me) return;
  const r = route();
  const body = { home: viewHome, shopping: viewShopping, settings: viewSettings, calendar: F.viewCalendar, chores: F.viewChores, kakeibo: F.viewKakeibo }[r] || viewHome;
  st.dirty = false;
  $app.innerHTML = body() + tabbar(r) + sheet();
  const inp = document.getElementById('add'); if (inp && st.keepFocus) { inp.focus(); st.keepFocus = false; }
}

function tabbar(r) {
  return `<nav class="tabbar" aria-label="メニュー">${TABS.map(([k, l, ic]) =>
    `<a href="#${k}" ${r === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('')}</nav>`;
}

function viewHome() {
  const todo = st.items.filter(i => !i.done), urgent = todo.filter(i => i.urgent);
  const d = new Date(), w = '日月火水木金土'[d.getDay()], evs = F.eventsOn(F.ymd(d)), chs = F.choresToday();
  return `<main class="screen">
  <div class="head"><div><small>${d.getMonth() + 1}月${d.getDate()}日(${w})</small><h1>ふたりの暮らし帳</h1></div>
    <a class="pill" href="#settings" style="display:flex;align-items:center;text-decoration:none;color:var(--ink)">設定</a></div>
  ${goingBanner()}
  <section class="card"><h2>買い物リスト</h2>
    ${urgent.length ? urgent.map(i => `<div style="display:flex;gap:10px;align-items:center"><span class="tag">急ぎ</span><span>${esc(i.name)}</span></div>`).join('') : '<p class="muted">急ぎの品物はありません</p>'}
    <a href="#shopping" class="btn text" style="display:flex;align-items:center;text-decoration:none;padding:0">リストを開く（残り${todo.length}件）</a></section>
  <section class="card"><h2>お知らせ</h2>
    ${st.acts.length ? st.acts.slice(0, 6).map(a => `<div style="display:flex;gap:10px;align-items:flex-start"><span class="dot" style="background:${colorOf(a.user_id)};margin-top:6px"></span>
      <div style="display:flex;flex-direction:column"><span>${esc(a.message)}</span><span class="muted" style="font-size:12px">${new Date(a.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div></div>`).join('') : '<p class="muted">まだお知らせはありません</p>'}</section>
  <section class="card list"><h2 class="group-title">今日の予定</h2>
    ${evs.length ? evs.slice(0, 5).map(F.evRow).join('') : '<p class="muted" style="margin:0">今日の予定はありません</p>'}
    <a href="#calendar" class="btn text" style="display:flex;align-items:center;text-decoration:none;padding:0">カレンダーを開く</a></section>
  <section class="card list"><h2 class="group-title">今日の家事</h2>
    ${chs.length ? chs.map(F.choreRow).join('') : '<p class="muted" style="margin:0">今日の家事はありません</p>'}
    <a href="#chores" class="btn text" style="display:flex;align-items:center;text-decoration:none;padding:0">家事を開く</a></section>
  <section class="card"><h2>今月のふたりの支出</h2>
    ${F.isThisMonth() ? `<p style="margin:0;font-size:26px;font-weight:700">¥${F.sharedTotal().toLocaleString('ja-JP')}</p>` : ''}
    <a href="#kakeibo" class="btn text" style="display:flex;align-items:center;text-decoration:none;padding:0">家計簿を開く</a></section>
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
  ${groups.map(({ g, items }) => `<section class="card list"><h2 class="group-title">${g}</h2>
    ${items.map(i => `<button class="row" data-act="toggle" data-id="${i.id}" aria-pressed="false">
      <span class="box"></span><span class="main"><span class="name">${esc(i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}</span><span class="sub">${esc(nameOf(i.added_by))}が追加</span></span>
      ${i.urgent ? '<span class="tag">急ぎ</span>' : ''}</button>`).join('')}</section>`).join('')}
  ${!todo.length ? '<p class="muted" style="text-align:center">買うものはありません</p>' : ''}
  ${done.length ? `<section class="card list"><h2 class="group-title">カゴに入れた（${done.length}）</h2>
    ${done.map(i => `<button class="row done" data-act="toggle" data-id="${i.id}" aria-pressed="true"><span class="box">✓</span>
      <span class="main"><span class="name">${esc(i.name)}</span></span><span class="sub">${esc(nameOf(i.done_by))}</span></button>`).join('')}
    <div style="display:flex;gap:8px;padding:8px 0 10px"><button class="btn" style="flex:1;font-size:15px;white-space:nowrap" data-act="askClear">リストから消す</button>
      <button class="btn green" style="flex:1.4" data-act="txFromShop">家計簿に記録する</button></div></section>` : ''}
  </main>
  <div class="addbar"><div class="inner">
    <div class="sugg" id="sugg">${suggHtml()}</div>
    <form class="addrow" data-form="add"><label class="sr" for="add">追加する品物</label>
      <input id="add" type="text" maxlength="60" placeholder="品物を追加（例：牛乳 2）" value="${esc(st.draft || '')}" enterkeyhint="done" autocomplete="off">
      <button type="button" class="pill ${st.urgent ? 'on' : ''}" data-act="urgent" aria-pressed="${st.urgent}" style="border-radius:12px;min-height:48px">急ぎ</button>
      <button type="submit" class="plus" aria-label="追加">＋</button></form></div></div>`;
}

// 入力候補（日本語入力を邪魔しないよう、候補の部分だけを書きかえる）
function suggHtml() {
  const inList = new Set(st.items.filter(i => !i.done).map(i => i.name));
  const q = parseItem(st.draft || '').name;
  return [...new Set([...st.names, ...DEFAULT_NAMES])].filter(n => !inList.has(n) && (!q || n.includes(q))).slice(0, 10)
    .map(n => `<button type="button" data-act="quick" data-name="${esc(n)}">＋ ${esc(n)}</button>`).join('');
}

function viewSettings() {
  return `<main class="screen">
  <div class="head"><div><small><a href="#home">‹ ホーム</a></small><h1>設定</h1></div></div>
  <section class="card list"><h2 class="group-title">メンバー（最大5人）</h2>
    ${st.members.map(m => `<div class="row"><span class="dot" style="background:${m.color}"></span><span class="main"><span class="name">${esc(m.display_name)}${m.user_id === st.me.user_id ? '（自分）' : ''}</span></span><span class="sub">${m.is_admin ? '管理者' : ''}</span></div>`).join('')}
    ${st.me.is_admin && st.members.length < 5 ? '<button class="btn primary" style="margin:8px 0 10px" data-act="invite">メンバーを招待する</button>' : ''}</section>
  <form class="card stack" data-form="pw" novalidate><h2>${st.recovery ? '新しいパスワードを決めてください' : 'パスワード'}</h2>
    <p class="muted" style="margin:0;font-size:13px">ホーム画面のアプリでは、メールアドレスとこのパスワードでログインします。</p>
    <input type="text" autocomplete="username" value="${esc(st.session?.user?.email || '')}" hidden>
    <div class="field"><label for="newpw">新しいパスワード(8文字以上)</label><input id="newpw" type="password" autocomplete="new-password"></div>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">パスワードを設定する</button></form>
  <section class="card"><h2>アプリとして使う</h2><p class="muted">Safariの共有ボタン →「ホーム画面に追加」で、アイコンから開けます。ログインは一度すれば残ります。</p></section>
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
  return F.sheetHtml();
}

// ---------- 操作 ----------
async function addItem(raw) {
  const { name, qty } = parseItem(raw);
  if (!name) return;
  const h = st.me.household_id;
  st.draft = ''; st.keepFocus = true;
  await run(sb.from('shopping_items').insert({ household_id: h, name, qty, urgent: st.urgent }));
  st.urgent = false; await reloadItems();
  sb.from('item_names').upsert({ household_id: h, name, last_used: new Date().toISOString() }).then(() => {});
  if (!st.names.includes(name)) st.names.unshift(name);
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
  if (st.me && await F.onClick(act, el)) return;
  if (act === 'logout') { await sb.auth.signOut(); st.me = null; return; }
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
    await run(sb.from('shopping_items').update({ done: it.done, done_by: it.done_by }).eq('id', it.id));
  }
  if (act === 'quick') await addItem(el.dataset.name);
  if (act === 'urgent') { st.urgent = !st.urgent; render(); }
  if (act === 'going') {
    const g = !st.going[st.me.user_id]; st.going[st.me.user_id] = g; render();
    st.channel?.send({ type: 'broadcast', event: 'going', payload: { user_id: st.me.user_id, going: g } });
    sb.from('activities').insert({ household_id: h, message: `${st.me.display_name}さんが${g ? '買い物に行きます' : '買い物を終えました'}` }).then(() => {});
  }
  if (act === 'askClear') { st.sheet = { type: 'clear' }; render(); }
  if (act === 'clear') { st.sheet = null; await run(sb.from('shopping_items').delete().eq('household_id', h).eq('done', true), 'リストから消しました'); await reloadItems(); }
  if (act === 'invite') { const code = await run(sb.rpc('renew_invite', { h })); st.sheet = { type: 'invite', code }; render(); }
  if (act === 'share') {
    const link = el.dataset.link;
    if (navigator.share) { try { await navigator.share({ title: 'ふたりの暮らし帳に招待', text: '暮らし帳に参加してね', url: link }); } catch { } }
    else { await navigator.clipboard.writeText(link); toast('リンクをコピーしました'); }
  }
  if (act === 'close') { st.sheet = null; render(); }
});

F.setup({ st, sb: () => sb, run, esc, render, toast, nameOf, colorOf });
init();
