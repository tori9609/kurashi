// ふたりの暮らし帳:設定の画面(見た目・状態チェック・通知・ウィジェット・バックアップ・カード)と、検索・ゴミ箱
import { repText, timeText } from './calendar.js';
import { BRAND, C, PALETTE, edge, err, field, h, ic, ls, md, sb, weekStart, who, yen, ymd } from './core.js';
import { freqText, isIncome } from './features.js';
export function appearanceSettingsHtml() {
  const { st } = C, theme = ls('kurashi.theme') || 'auto', acc = ls('kurashi.accent') || '', mine = C.colorOf(st.me.user_id);
  const th = (v, l) => `<button class="pill${theme === v ? ' on' : ''}" data-act="themeSet" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`;
  const txt = ls('kurashi.text') || 'auto', tx = (v, l) => `<button class="pill${txt === v ? ' on' : ''}" data-act="textSet" data-v="${v}" aria-pressed="${txt === v}">${l}</button>`;
  const sw = (act, v, name, cur, cls = '') => `<button class="swatch${cls}" style="--c:${v === 'me' ? mine : v || BRAND}" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}" aria-label="${name}"></button>`;
  return `<section class="card stack"><h2>見た目</h2>
    <div class="field"><span class="muted" style="font-size:0.8125rem">明るさ</span><div class="nav" style="flex-wrap:wrap">${th('auto', 'iPhoneに合わせる')}${th('light', 'ライト')}${th('dark', 'ダーク')}</div></div>
    <div class="field"><span class="muted" style="font-size:0.8125rem">文字の大きさ(この端末だけの設定です)</span><div class="nav" style="flex-wrap:wrap">${tx('auto', 'iPhoneに合わせる')}${tx('std', '標準')}${tx('l', '大きい')}${tx('xl', 'とても大きい')}</div>
      <p class="muted hint" style="margin:0;font-size:0.8125rem">「iPhoneに合わせる」は、iPhoneの「設定」→「画面表示と明るさ」→「テキストサイズを変更」の大きさに合わせます。</p></div>
    <div class="field"><span class="muted" style="font-size:0.8125rem">アクセントカラー(ボタンなどの色。この端末だけの設定です)</span>
      <div class="swatches">${sw('accentSet', '', '暮らし帳の色(標準)', acc, ' std')}${sw('accentSet', 'me', '自分の色に合わせる', acc, ' auto')}${PALETTE.map(([n, c]) => sw('accentSet', c, n, acc)).join('')}</div>
      <p class="muted hint" style="margin:0;font-size:0.8125rem">左端が標準の色、その隣が「自分の色に合わせる」です。</p></div>
    <div class="field"><span class="muted" style="font-size:0.8125rem">あなたの色(だれの情報かを示す印。相手の画面でも、あなたの予定・記録にこの色が付きます)</span>
      <div class="swatches">${PALETTE.filter(([n]) => n !== '緑').map(([n, c]) => sw('myColor', c, n, mine)).join('')}</div>
      <p class="muted hint" style="margin:0;font-size:0.8125rem">緑は「ふたり」の印なので、人の色には使いません。</p></div>
    <button class="btn" data-act="welcomeAgain">${ic('help')}使い方をもう一度見る</button></section>`;
}

// ---------- 設定:カード利用の取り込み(iPhoneのショートカット) ----------
export function calSettingsHtml() {
  const ws = weekStart(), b = (v, l) => `<button class="pill${ws === v ? ' on' : ''}" data-act="calWeek" data-v="${v}" aria-pressed="${ws === v}">${l}</button>`;
  return `<section class="card stack"><h2>カレンダーの週の始まり</h2><div class="nav">${b(0, '日曜始まり')}${b(1, '月曜始まり')}</div>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">この端末だけの設定です。相手の画面は変わりません。</p></section>`;
}
// ---------- 設定:通知 ----------
export const NOTIFY = [['partner', '相手が予定・買い物・やること・家計簿を追加・変更したとき'], ['urgent', '買い物に「急ぎ」が付いたとき'],
  ['todo', 'やることの期限(朝7時に今日やることをまとめて)'], ['events', '予定(前日20時に明日の分、朝7時に今日の分)'],
  ['remind', '予定ごとのお知らせ(予定で選んだ「30分前」などの時刻)'], ['budget', '予算の8割を使ったとき・超えたとき'], ['card', 'カード利用の確認待ちがあるとき(20時)'], ['monthly', '毎月1日の朝に、先月のふり返り(支出の合計・前の月との比べ)'], ['forgot', '夜8時に、その日の支出をまだ記録していないとき(つけ忘れ防止)']];
export const b64uBytes = s => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0)); };
export async function loadPush() {
  const p = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) };
  p.perm = p.supported ? Notification.permission : 'unsupported';
  try { const reg = p.supported && await navigator.serviceWorker.getRegistration(); p.subscribed = !!(reg && await reg.pushManager.getSubscription()); } catch { p.subscribed = false; }
  const { data } = await sb().from('notify_prefs').select('*').eq('user_id', C.st.me.user_id).maybeSingle();
  p.prefs = Object.fromEntries(NOTIFY.map(([k]) => [k, data ? data[k] !== false : true]));
  C.st.push = p;
}
export async function pushOn() {
  const { st, run } = C;
  if (!st.push?.supported) return C.toast('この端末では通知を使えません');
  const perm = await Notification.requestPermission();   // 押した直後に聞く(iPhoneの決まり)
  if (perm !== 'granted') { st.push.perm = perm; C.render(); return C.toast('通知が許可されませんでした'); }
  const { data, error } = await sb().functions.invoke('push', { body: { action: 'key' } });
  if (error || !data?.key) return C.toast('通知の準備ができませんでした。Supabaseに「push」が置かれているか確かめてください');
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(data.key) });
  const j = sub.toJSON();
  await run(sb().from('push_subs').upsert({ user_id: st.me.user_id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' }),
    'この端末で通知を受け取ります');
  await loadPush(); C.render();
}
export async function pushOff() {
  try {
    const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await C.run(sb().from('push_subs').delete().eq('endpoint', sub.endpoint)); await sub.unsubscribe(); }
  } catch { /* 止められなくても画面は進める */ }
  C.toast('この端末の通知を止めました'); await loadPush(); C.render();
}
export function notifySettingsHtml() {
  const { st } = C, p = st.push;
  if (!p) { C.st.push = { loading: true }; loadPush().then(() => C.render()).catch(() => {}); }
  if (!p || p.loading) return '<section class="card stack"><h2>通知</h2><p class="muted" style="margin:0">確かめています…</p></section>';
  const head = !p.supported || !p.standalone
    ? '<p class="muted hint" style="margin:0;font-size:0.8125rem">通知は、ホーム画面に追加した暮らし帳から開いたときに使えます(iPhoneは iOS 16.4 以降)。Safariで開いている場合は、共有ボタン →「ホーム画面に追加」から開き直してください。</p>'
    : p.perm === 'denied' ? '<p class="muted hint" style="margin:0;font-size:0.8125rem">通知が「許可しない」になっています。iPhoneの「設定」→「通知」→「暮らし帳」で許可してから、もう一度押してください。</p>' : '';
  const sw = (k, l) => `<label class="switch"><input type="checkbox" data-act="notifyPref" data-k="${k}" ${p.prefs[k] ? 'checked' : ''}><span>${l}</span></label>`;
  return `<section class="card stack"><h2>通知</h2>${head}
    ${p.supported && p.standalone ? (p.subscribed
      ? `<p style="margin:0;display:flex;gap:6px;align-items:center">${ic('bell')}この端末で通知を受け取っています</p><div class="two"><button class="btn" data-act="pushTest">テスト通知を送る</button><button class="btn" data-act="pushOff">この端末の通知を止める</button></div>`
      : '<button class="btn primary" data-act="pushOn">この端末で通知を受け取る</button>') : ''}
    <fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="muted" style="font-size:0.8125rem;margin-bottom:4px">受け取る通知(人ごとの設定です。相手には影響しません)</legend>${NOTIFY.map(([k, l]) => sw(k, l)).join('')}</fieldset>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">「自分だけ」の予定・やることは、通知では名前を伏せて「自分だけの予定」と出します。</p></section>`;
}

// ---------- 検索(予定・家計簿・やること・買い物・固定費をまとめて) ----------
export const like = q => '%' + q.replace(/[%_,()\\]/g, ' ').trim() + '%';
export const has = (v, q) => String(v || '').toLowerCase().includes(q.toLowerCase());
export async function doSearch(q) {
  const { st } = C;
  if (!q) { st.search = { q: '', res: null }; return; }
  st.search = { q, res: 'loading' };
  let res;
  const local = () => ({ ev: (st.events || []).filter(e => has(e.title, q)), tx: (st.tx || []).filter(t => has(t.shop, q) || has(t.category, q)),
    ch: (st.chores || []).filter(c => has(c.name, q)), sh: (st.items || []).filter(i => has(i.name, q)), fx: (st.fixed || []).filter(f => has(f.name, q)), local: true });
  if (st.offline || navigator.onLine === false) res = local();   // 圏外:端末に残っている分から探す
  else {
    const L = like(q);
    const [ev, tx, ch, sh, fx] = await Promise.all([
      sb().from('events').select('*').eq('household_id', h()).is('deleted_at', null).ilike('title', L).order('date', { ascending: false }).limit(30),
      sb().from('transactions').select('*').eq('household_id', h()).is('deleted_at', null).or(`shop.ilike.${L},category.ilike.${L}`).order('date', { ascending: false }).limit(50),
      sb().from('chores').select('*').eq('household_id', h()).is('deleted_at', null).ilike('name', L).limit(30),
      sb().from('shopping_items').select('*').eq('household_id', h()).ilike('name', L).limit(30),
      sb().from('fixed_costs').select('*').eq('household_id', h()).is('deleted_at', null).ilike('name', L).limit(30)]);
    res = [ev, tx, ch, sh, fx].some(x => x.error) ? local() : { ev: ev.data || [], tx: tx.data || [], ch: ch.data || [], sh: sh.data || [], fx: fx.data || [] };
  }
  if (st.search?.q === q) st.search.res = res;
}
export function viewSearch() {
  const { st, esc } = C, sr = st.search || { q: '', res: null }, r = sr.res;
  const row = (act, attrs, name, sub, right = '') => `<button class="row" data-act="${act}" ${attrs}><span class="main"><span class="name">${name}</span><span class="sub">${sub}</span></span>${right}</button>`;
  const sec = (title, items) => items.length ? `<section class="card list"><h2 class="group-title">${title}(${items.length})</h2>${items.join('')}</section>` : '';
  let body = '';
  if (r === 'loading') body = '<p class="muted">探しています…</p>';
  else if (r) {
    const txSum = r.tx.filter(t => !isIncome(t)).reduce((a, t) => a + t.amount, 0), inSum = r.tx.filter(isIncome).reduce((a, t) => a + t.amount, 0);
    body = sec('予定', r.ev.map(e => row('goEv', `data-id="${e.id}" data-d="${e.date}" ${edge(e.for_user)}`, esc(e.title), `${e.date.slice(0, 4)}/${md(e.date)}・${timeText(e)}${e.repeat_rule ? '・' + repText(e.repeat_rule) : ''}・${who(e.for_user)}`)))
      + (r.tx.length ? `<p class="muted hint" style="margin:0;font-size:0.8125rem">家計簿の合計 ${yen(txSum)}${inSum ? `・収入の合計 +${yen(inSum)}` : ''}(${r.tx.length}件)</p>` : '')
      + sec('家計簿', r.tx.map(t => row('goTx', `data-id="${t.id}" data-d="${t.date}" ${edge(t.paid_by)}`, esc(t.shop || t.category), `${t.date.slice(0, 4)}/${md(t.date)}・${t.category}・${who(t.paid_by)}が払った${t.scope === 'private' ? '・自分だけ' : ''}`, `<b>${yen(t.amount)}</b>`)))
      + sec('やること', r.ch.map(c => row('goCh', `data-id="${c.id}" ${edge(c.assignee)}`, esc(c.name), `${c.category || '家事'}・${c.archived ? 'お休み中' : freqText(c)}${c.last_done ? '・前回 ' + md(c.last_done) : ''}`)))
      + sec('買い物', r.sh.map(i => row('goSh', `data-id="${i.id}"`, esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : ''), i.done ? 'カゴに入れた' : 'リストにある')))
      + sec('固定費', r.fx.map(f => row('goFx', `data-id="${f.id}"`, esc(f.name), `${f.category}・${f.active ? '毎月記録' : '記録しない'}`, `<b>${yen(f.amount)}</b>`)));
    if (!body.trim()) body = `<p class="muted">「${esc(sr.q)}」は見つかりませんでした</p>`;
    if (r.local) body = '<p class="muted hint" style="margin:0;font-size:0.8125rem">圏外のため、端末に残っている分(家計簿は表示中の月だけ)から探しました。</p>' + body;
  }
  return `<main class="screen">
  <div class="head"><div><small><a href="#home" class="back">${ic('left')}ホーム</a></small><h1>検索</h1></div></div>
  <form class="addrow" data-form="search" role="search"><label class="sr" for="q">探す言葉</label>
    <input id="q" type="search" maxlength="40" placeholder="例:車検、美容院、ドミー" value="${esc(sr.q)}" autocomplete="off" enterkeyhint="search"><button class="plus" type="submit" aria-label="探す">${ic('search')}</button></form>
  <p class="muted hint" style="margin:0;font-size:0.8125rem">予定・家計簿(お店・分類)・やること・買い物・固定費から、全部の期間を探します。ゴミ箱の中は探しません。</p>
  ${body}</main>`;
}

// ---------- ゴミ箱(消したものを7日間は戻せる) ----------
export const TRASH = [['events', '予定', x => x.title], ['chores', 'やること', x => x.name], ['transactions', '家計簿', x => `${x.shop || x.category} ${yen(x.amount)}`],
  ['fixed_costs', '固定費', x => `${x.name} ${yen(x.amount)}`], ['goals', '目標貯金', x => x.name]];
export async function loadTrash() {
  const rs = await Promise.all(TRASH.map(([t]) => sb().from(t).select('*').eq('household_id', h()).not('deleted_at', 'is', null)));
  C.st.trash = rs.flatMap((r, i) => (r.data || []).map(x => ({ t: TRASH[i][0], label: TRASH[i][1], name: TRASH[i][2](x), id: x.id, at: x.deleted_at })))
    .sort((a, b) => b.at.localeCompare(a.at));
}
export function viewTrash() {
  const { st, esc } = C;
  if (!st.trash) { st.trash = 'loading'; loadTrash().then(() => C.render()).catch(() => { st.trash = []; C.render(); }); }
  const list = Array.isArray(st.trash) ? st.trash : [];
  const left = at => Math.max(0, 7 - Math.floor((Date.now() - Date.parse(at)) / 864e5));
  return `<main class="screen">
  <div class="head"><div><small><a href="#settings" class="back">${ic('left')}設定</a></small><h1>ゴミ箱</h1></div></div>
  <p class="muted" style="margin:0">消した予定・やること・家計簿・固定費・目標貯金は、7日間ここに残ります。7日を過ぎると自動で消えます。</p>
  <section class="card list">${st.trash === 'loading' ? '<p class="muted" style="margin:0 0 10px">読み込んでいます…</p>'
    : list.length ? list.map(x => `<div class="row"><span class="main"><span class="name">${esc(x.name)}</span>
      <span class="sub"><span class="ctag">${x.label}</span>・${md(ymd(new Date(x.at)))}に削除・あと${left(x.at)}日で消えます</span></span>
      <button class="pill go" data-act="trashBack" data-t="${x.t}" data-id="${x.id}">戻す</button></div>`).join('')
    : '<p class="muted" style="margin:0 0 10px">ゴミ箱は空です</p>'}</section></main>`;
}

// ---------- 設定:PCへのバックアップ ----------
export function backupSettingsHtml() {
  const { st, esc } = C, k = st.backupKey;
  return `<section class="card stack"><h2>PCへのバックアップ</h2>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">自宅PCの「C:\\_Work\\01_ツール\\暮らし帳_バックアップ」が、毎日このアプリのデータを保存します。下の鍵を、そのフォルダの「鍵.txt」に貼ってください。鍵は読むだけで書き換えはできませんが、中身が読めるので人に見せないでください。</p>
    ${k ? `<div class="codebox">${esc(k)}</div><button class="btn primary" data-act="copy" data-v="${esc(k)}">鍵をコピー</button>
      <button class="btn" data-act="backupKeyRenew">鍵を作り直す(古い鍵は使えなくなります)</button>`
      : '<button class="btn" data-act="backupKey">鍵を表示</button>'}</section>`;
}

// ---------- 設定:状態チェック(準備ができているかをまとめて見る) ----------
export const APP_VERSION = '2026-11-21';   // アプリの版(GitHubに上げた版が届いているかの目安)
export const NEED = { schema: 19, fn: '2026-11-21' };
export async function runStatus() {
  const st = C.st, inv = async (name, body) => { try { const r = await sb().functions.invoke(name, { body }); return r.error ? { err: r.error.message || 'error' } : r.data || {}; } catch (e) { return { err: e.message }; } };
  const [db, push, rr] = await Promise.all([sb().rpc('app_status').then(r => r.error ? { err: r.error.message } : r.data || {}), inv('push', { action: 'version' }), inv('receipt-read', { mode: 'version' })]);
  let perm = 'unknown'; try { perm = typeof Notification === 'undefined' ? 'unknown' : Notification.permission; } catch {}
  st.status = { at: new Date(), db, push, rr, perm };
}
export function statusRows(s) {
  const rows = [], add = (lv, name, msg) => rows.push({ lv, name, msg }), db = s.db || {};
  const day = d => d ? new Date(d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  if (db.err) add('ng', 'データベース(SQL)', 'SQL の追加分18以降がまだのようです。手順書の「追加の手順 A」でSQLを実行してください');
  else if ((db.schema_version || 0) < NEED.schema) add('ng', 'データベース(SQL)', `SQL が足りません(今 ${db.schema_version || '?'} / 必要 ${NEED.schema})。手順書の「追加の手順 A」を行ってください`);
  else add('ok', 'データベース(SQL)', `最新です(版 ${db.schema_version})`);
  const fn = (r, name, extra) => r.err ? add('ng', name, `${name.split('(')[0]}の係に届きません。Supabaseに置かれているか、「Verify JWT」がオフか確かめてください`)
    : r.version !== NEED.fn ? add('ng', name, `古い版です(${r.version || '不明'})。手順書のとおり貼り直してください`) : extra();
  fn(s.push || {}, '通知の係(push)', () => add('ok', '通知の係(push)', `最新です(${s.push.version})`));
  fn(s.rr || {}, 'レシート・紙の読み取り(receipt-read)', () => s.rr.gemini ? add('ok', 'レシート・紙の読み取り(receipt-read)', `最新です(${s.rr.version})`)
    : add('ng', 'レシート・紙の読み取り(receipt-read)', '「GEMINI_API_KEY」が預けられていません。Supabaseの「Edge Functions」→「Secrets」で登録してください'));
  if (!db.err) {
    if (Array.isArray(db.cron)) { const need = ['kurashi-push', 'kurashi-trash'].filter(j => !db.cron.includes(j)); need.length ? add('ng', '定期の処理(通知・ゴミ箱)', `「${need.join('・')}」が登録されていません。SQL(追加分12・13)をもう一度実行してください`) : add('ok', '定期の処理(通知・ゴミ箱)', '動いています'); }
    add(db.members >= 2 ? 'ok' : 'warn', 'メンバー', db.members >= 2 ? `${db.members}人で使っています` : 'まだ1人です。「設定」→「メンバーを招待」から招待してください');
    const sub = db.push_subs > 0, granted = s.perm === 'granted';
    add(sub && granted ? 'ok' : 'warn', 'この端末の通知', sub && granted ? '受け取っています' : sub ? 'iPhoneの「設定」→「通知」→「暮らし帳」がオフです' : '受け取っていません。この画面の「通知」で「受け取る」を押してください');
    add(db.backup_last && Date.now() - Date.parse(db.backup_last) < 3 * 864e5 ? 'ok' : 'warn', 'PCへのバックアップ', db.backup_last ? `最後は ${day(db.backup_last)}${Date.now() - Date.parse(db.backup_last) >= 3 * 864e5 ? '。3日以上あいています。PCがついているか確かめてください' : ''}` : db.backup_token ? 'まだ一度も届いていません。PCで「2_今すぐバックアップを試す.bat」を実行してください' : 'まだ準備していません(手順書の手順10)');
    add(db.widget_token ? 'ok' : 'info', 'ウィジェット', db.widget_token ? '鍵を作ってあります' : '使っていません(使うなら「ウィジェット」から)');
    add(db.card_misses ? 'warn' : db.card_token ? 'ok' : 'info', 'カード利用の取り込み', db.card_misses ? `金額が届かなかった支払いが${db.card_misses}件あります。家計簿で記録してください` : db.card_token ? (db.card_last ? `最後に届いたのは ${day(db.card_last)}` : '鍵を作ってあります。まだ1件も届いていません') : '使っていません');
  }
  add('info', 'アプリの版', `${APP_VERSION}(古い場合は、アプリを完全に閉じてから開き直してください)`);
  return rows;
}
export function statusSettingsHtml() {
  const { st, esc } = C, s = st.status;
  const icon = lv => ic(lv === 'ok' ? 'tick' : lv === 'info' ? 'info' : 'alert', 'st-' + lv);
  const rows = s && !s.loading ? statusRows(s) : [];
  const ng = rows.filter(r => r.lv === 'ng').length, warn = rows.filter(r => r.lv === 'warn').length;
  return `<section class="card list status"><h2 class="group-title">${ic('todo')}状態チェック</h2>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">SQL・Edge Functions・通知・バックアップの準備ができているかを、まとめて確かめます。困ったときは、まずここを見てください。</p>
    ${s?.loading ? '<p class="muted" style="margin:6px 0">確かめています…</p>' : s ? `<p class="stsum ${ng ? 'ng' : warn ? 'warn' : 'ok'}">${ng ? `直すところが${ng}件あります` : warn ? `気になるところが${warn}件あります` : 'すべて準備できています'}</p>
      ${rows.map(r => `<div class="strow">${icon(r.lv)}<span class="main"><span class="name">${esc(r.name)}</span><span class="sub">${esc(r.msg)}</span></span></div>`).join('')}` : ''}
    <button class="btn" data-act="statusRun">${s && !s.loading ? 'もう一度確かめる' : '状態を確かめる'}</button></section>`;
}
// ---------- 設定:ホーム画面のウィジェット(Scriptable) ----------
export function widgetSettingsHtml() {
  const { st } = C, ready = st.widgetKey && st.widgetSrc;
  return `<section class="card stack"><h2>ホーム画面のウィジェット</h2>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">予定と買い物リストを、iPhoneのホーム画面やロック画面に出します。無料アプリ「Scriptable」を使います。ウィジェット用の鍵は「読むだけ」で、これでは何も書き換えられません。</p>
    ${ready ? `<button class="btn primary" data-act="widgetCopy">スクリプトをコピー(鍵入り)</button>
      <ol class="steps"><li>App Storeで「Scriptable」を入れて開く</li><li>右上の「＋」→ 中身を全部消して貼り付け</li><li>上の題名を「暮らし帳」にして「Done」</li>
      <li>ホーム画面を長押し →「編集」→「ウィジェットを追加」→ Scriptable → 大きさを選ぶ</li><li>置いたウィジェットを長押し →「ウィジェットを編集」→ Script で「暮らし帳」を選ぶ</li></ol>
      <p class="muted hint" style="margin:0;font-size:0.8125rem">Parameter に「予定」または「買い物」と書くと、片方だけを大きく出します。表示はおよそ15分ごとに新しくなります(間隔はiPhoneが決めます)。</p>
      <button class="btn" data-act="widgetKeyRenew">鍵を作り直す(古いウィジェットは表示されなくなります)</button>`
      : '<button class="btn primary" data-act="widgetKey">ウィジェットの準備をする</button>'}</section>`;
}
export async function loadWidget(renew) {
  const { st, run } = C;
  const [k, src] = await Promise.all([
    run(sb().rpc('widget_token', { p_renew: !!renew }), renew ? '鍵を作り直しました。スクリプトをコピーし直して、Scriptableに貼り直してください' : null),
    st.widgetSrc ? st.widgetSrc : fetch('widget.js', { cache: 'no-cache' }).then(r => r.ok ? r.text() : null).catch(() => null)]);
  if (!src) C.toast('スクリプトを読み込めませんでした。通信を確かめて、もう一度押してください');
  st.widgetKey = k; st.widgetSrc = src; C.render();
}
export const widgetScript = () => C.st.widgetSrc.replace('__KEY__', C.st.widgetKey).replace('__URL__', C.url).replace('__APIKEY__', C.key).replace('__WS__', String(weekStart()));

export function cardSettingsHtml() {
  const { st, esc } = C, k = st.cardKey, url = C.url + '/rest/v1/rpc/card_inbox_add';
  const box = (label, v) => `<div class="field"><span class="muted" style="font-size:0.8125rem">${label}</span><div class="codebox">${esc(v)}</div>
    <button class="btn text" style="padding:0;min-height:40px" data-act="copy" data-v="${esc(v)}">コピー</button></div>`;
  return `<section class="card stack"><h2>カード利用の取り込み</h2>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">iPhoneのショートカットで、ウォレットで払ったときにお店と金額をこのアプリへ送ります。下の3つをショートカットに貼り付けます。鍵は人に見せないでください。</p>
    ${k ? box('① 送り先のURL', url) + box('② apikey(公開用の鍵)', C.key) + box('③ あなたの取り込み用の鍵(p_token)', k)
        + '<button class="btn" data-act="cardKeyRenew">鍵を作り直す(古い鍵は使えなくなります)</button>'
        : '<button class="btn primary" data-act="cardKey">設定に使う情報を表示する</button>'}</section>`;
}
