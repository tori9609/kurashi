// ふたりの暮らし帳 第2段階(予定・家事)と第3段階(家計簿)。2026-11-20
// app.js から道具(st・sb・run など)を受け取って動く。画面は文字列で作り、app.js の render() が表示する。
let C;
export function setup(ctx) { C = ctx; }
const sb = () => C.sb();
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0, 7);
const W = '日月火水木金土';
export const CATS = ['住居', '食費', '外食', '日用品', '家具・家電', '光熱費', '通信', '交通', '趣味', 'その他'];
const SHARED_COLOR = '#1F8A5B';
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const dt = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const md = s => { const d = dt(s); return `${d.getMonth() + 1}/${d.getDate()}(${W[d.getDay()]})`; };
const h = () => C.st.me.household_id;
const route = () => (location.hash.replace('#', '') || 'home');
const toast = m => C.toast(m);
const val = id => (document.getElementById(id)?.value ?? '').trim();
const chk = id => !!document.getElementById(id)?.checked;
function err(msg) { const e = document.getElementById('err'); if (e) { e.textContent = msg; e.hidden = false; } return true; }
// 全角数字やカンマが入っていても数字として読む
const toNum = s => parseInt(String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^\d]/g, ''), 10) || 0;
function activity(message) { sb().from('activities').insert({ household_id: h(), message }).then(() => {}); }
const field = (id, label, inner) => `<div class="field"><label for="${id}">${label}</label>${inner}</div>`;
const memberOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : '') +
  C.st.members.map(m => `<option value="${m.user_id}" ${m.user_id === sel ? 'selected' : ''}>${C.esc(m.display_name)}</option>`).join('');
const sheetWrap = (title, body) => `<div class="sheet-bg" data-act="close"><div class="sheet" role="dialog" aria-label="${title}" data-stop>
  <span class="grip"></span><h2 style="font-size:17px">${title}</h2>${body}</div></div>`;
const closeBtn = (label = '閉じる') => `<button class="btn" type="button" data-act="close">${label}</button>`;

// ---------- 読み込み ----------
export async function loadFeatures() {
  const { st, run } = C;
  const [ev, ch, fx, bu, go, se] = await Promise.all([
    run(sb().from('events').select('*').eq('household_id', h()).order('date')),
    run(sb().from('chores').select('*').eq('household_id', h()).order('created_at')),
    run(sb().from('fixed_costs').select('*').eq('household_id', h()).order('name')),
    run(sb().from('budgets').select('*').eq('household_id', h())),
    run(sb().from('goals').select('*').eq('household_id', h()).order('name')),
    run(sb().from('settlements').select('*').eq('household_id', h())),
  ]);
  Object.assign(st, { events: ev, chores: ch, fixed: fx, budgets: bu, goals: go, settles: se });
  const n = new Date();
  st.cal ||= { y: n.getFullYear(), m: n.getMonth(), sel: today() };
  st.kb ||= { month: thisMonth(), tab: 'list' };
  st.choreUndo ||= {};
  await Promise.all([loadTx(true), reloadInbox()]);
}
// カード利用の受け箱(本人の分だけ)。まだ表がない(SQL未実行)ときは空のまま動かす
export async function reloadInbox() {
  const { data, error } = await sb().from('card_inbox').select('*').eq('status', 'new').order('used_at', { ascending: false });
  C.st.inbox = error ? [] : data;
}
export async function reloadEvents() { C.st.events = await C.run(sb().from('events').select('*').eq('household_id', h()).order('date')); }
export async function reloadChores() { C.st.chores = await C.run(sb().from('chores').select('*').eq('household_id', h()).order('created_at')); }
export async function loadTx(withFixed) {
  const { st, run } = C, mo = st.kb.month;
  if (withFixed && mo === thisMonth()) await ensureFixed(mo);
  const [y, m] = mo.split('-').map(Number);
  st.tx = await run(sb().from('transactions').select('*').eq('household_id', h()).gte('date', mo + '-01').lt('date', ymd(new Date(y, m, 1)))
    .order('date', { ascending: false }).order('created_at', { ascending: false }));
}
// 固定費:その月を初めて開いたときに、1日付で記録する(同じ月に2回は入らない)
async function ensureFixed(mo) {
  const act = (C.st.fixed || []).filter(f => f.active); if (!act.length) return;
  await sb().from('transactions').upsert(act.map(f => ({ household_id: h(), date: mo + '-01', amount: f.amount, shop: f.name, category: f.category,
    paid_by: f.paid_by, scope: 'shared', fixed_cost_id: f.id, month: mo })), { onConflict: 'fixed_cost_id,month', ignoreDuplicates: true });
}

// ---------- 予定 ----------
function occurs(e, ds) {
  if (ds < e.date) return false;
  if (!e.repeat_rule) return ds === e.date;
  const [kind, arg] = e.repeat_rule.split(':');
  if (kind === 'weekly') return arg.split(',').map(Number).includes(dt(ds).getDay());
  if (kind === 'monthly') return dt(ds).getDate() === Number(arg);
  return false;
}
export const eventsOn = ds => (C.st.events || []).filter(e => occurs(e, ds)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const evColor = e => e.for_user ? C.colorOf(e.for_user) : SHARED_COLOR;
const timeText = e => e.time ? e.time.slice(0, 5) + (e.end_time ? '〜' + e.end_time.slice(0, 5) : '') : '終日';
const repText = r => !r ? '' : r.startsWith('weekly') ? `毎週${r.split(':')[1].split(',').map(n => W[n]).join('・')}曜日` : `毎月${r.split(':')[1]}日`;
export const evRow = e => `<button class="row" data-act="evOpen" data-id="${e.id}"><span class="dot" style="background:${evColor(e)}"></span>
  <span class="main"><span class="name">${C.esc(e.title)}</span><span class="sub">${timeText(e)}・${e.for_user ? C.esc(C.nameOf(e.for_user)) : 'ふたり'}${e.repeat_rule ? '・くり返し' : ''}${e.source === 'google' ? '・Google' : ''}${e.is_private ? '・自分だけ' : ''}</span></span></button>`;

export function viewCalendar() {
  const { st } = C, { y, m, sel } = st.cal;
  const start = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  let cells = '<span></span>'.repeat(start);
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`, evs = eventsOn(ds);
    cells += `<button class="day${ds === sel ? ' sel' : ''}${ds === today() ? ' today' : ''}" data-act="calDay" data-d="${ds}" aria-label="${m + 1}月${d}日、予定${evs.length}件">
      <span>${d}</span><i>${evs.slice(0, 3).map(e => `<b style="background:${evColor(e)}"></b>`).join('')}</i></button>`;
  }
  const list = eventsOn(sel);
  return `<main class="screen">
  <div class="head"><div><small>ふたりの予定</small><h1>${y}年${m + 1}月</h1></div>
    <div class="nav"><button class="pill" data-act="calMove" data-n="-1" aria-label="前の月">‹</button><button class="pill" data-act="calMove" data-n="0">今日</button><button class="pill" data-act="calMove" data-n="1" aria-label="次の月">›</button></div></div>
  <section class="card"><div class="cal">${[...W].map(w => `<span class="wd">${w}</span>`).join('')}${cells}</div></section>
  <section class="card list"><h2 class="group-title">${md(sel)}の予定</h2>
    ${list.length ? list.map(evRow).join('') : '<p class="muted" style="margin:0 0 10px">予定はありません</p>'}</section>
  <button class="fab" data-act="evNew" aria-label="予定を追加">＋</button></main>`;
}

function evFormHtml() {
  const { st } = C;
  return sheetWrap('予定を追加', `<form class="stack" data-form="ev" novalidate>
    ${field('evTitle', 'タイトル', '<input id="evTitle" type="text" maxlength="80" placeholder="例：歯医者">')}
    <div class="two">${field('evDate', '日付', `<input id="evDate" type="date" value="${st.cal.sel}">`)}${field('evTime', '時刻(空なら終日)', '<input id="evTime" type="time">')}</div>
    ${field('evFor', 'だれの予定', `<select id="evFor">${memberOpts(null, 'ふたり')}</select>`)}
    ${field('evRep', 'くり返し', '<select id="evRep"><option value="">なし</option><option value="weekly">毎週(同じ曜日)</option><option value="monthly">毎月(同じ日)</option></select>')}
    <label class="check"><input id="evPriv" type="checkbox"> 自分だけに表示する(相手には見えません)</label>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">追加する</button>${closeBtn('やめる')}</form>`);
}

function evSheetHtml() {
  const { st, esc } = C, s = st.sheet, e = st.events.find(x => x.id === s.id);
  if (!e) return '';
  const cm = s.comments;
  return sheetWrap(esc(e.title), `
    <p class="muted" style="margin:0">${md(s.day || e.date)} ${timeText(e)}・${e.for_user ? esc(C.nameOf(e.for_user)) : 'ふたり'}の予定${e.repeat_rule ? '・' + repText(e.repeat_rule) : ''}<br>${e.source === 'google' ? `Googleカレンダー「${esc(e.calendar_name || '')}」から取り込み。内容はGoogleカレンダーで直してください` : esc(C.nameOf(e.created_by)) + 'さんが登録'}</p>
    ${e.created_by === st.me.user_id ? `<div class="row" style="border:0;min-height:44px"><span class="main"><span class="name">${e.is_private ? '自分だけに見えています' : 'ふたりに見えています'}</span></span>
      <button class="pill ${e.is_private ? '' : 'go on'}" data-act="evShare">${e.is_private ? 'ふたりに見せる' : '自分だけにする'}</button></div>` : ''}
    <div class="comments">${cm === null ? '<p class="muted" style="margin:0">コメントを読み込み中…</p>' : cm.length ? cm.map(c => `<div class="cmt"><span class="dot" style="background:${C.colorOf(c.user_id)}"></span><div><b>${esc(C.nameOf(c.user_id))}</b> ${esc(c.body)}</div></div>`).join('') : '<p class="muted" style="margin:0">コメントはまだありません</p>'}</div>
    <form class="addrow" data-form="cmt"><label class="sr" for="cmtBody">コメント</label><input id="cmtBody" type="text" maxlength="300" placeholder="コメントを書く" autocomplete="off"><button class="plus" type="submit" aria-label="送る">↑</button></form>
    ${e.source === 'google' ? '' : s.confirm ? `<button class="btn danger" data-act="evDelYes">本当に削除する${e.repeat_rule ? '(くり返しの予定はすべて消えます)' : ''}</button>` : '<button class="btn danger" data-act="evDel">この予定を削除</button>'}
    ${closeBtn()}`);
}

// ---------- 家事 ----------
export function choreDue(c, ds = today()) {
  if (c.last_done === ds) return false;
  const days = c.last_done ? Math.round((dt(ds) - dt(c.last_done)) / 864e5) : Infinity;
  if (c.freq === 'daily') return true;
  if (c.freq === 'once') return !c.last_done;
  if (c.freq === 'monthly') return days >= 30;
  if (c.weekdays) return c.weekdays.split(',').map(Number).includes(dt(ds).getDay());
  return days >= 7;
}
const freqText = c => ({ daily: '毎日', monthly: '月1回', once: '1回だけ' }[c.freq] || (c.weekdays ? '毎週' + c.weekdays.split(',').map(n => W[n]).join('・') : '週1回'));
export function choreRow(c) {
  const doneToday = c.last_done === today();
  return `<div class="row${doneToday ? ' done' : ''}"><button class="box" data-act="choreDone" data-id="${c.id}" aria-label="${C.esc(c.name)}を${doneToday ? '未完了に戻す' : '完了にする'}" aria-pressed="${doneToday}">${doneToday ? '✓' : ''}</button>
    <button class="main plain" data-act="choreOpen" data-id="${c.id}"><span class="name">${C.esc(c.name)}</span>
    <span class="sub">${c.assignee ? C.esc(C.nameOf(c.assignee)) : '担当なし'}・${freqText(c)}${c.last_done ? '・前回 ' + md(c.last_done) : ''}</span></button>
    ${c.assignee ? `<span class="dot" style="background:${C.colorOf(c.assignee)}"></span>` : ''}</div>`;
}
export const choresToday = () => (C.st.chores || []).filter(c => choreDue(c) || c.last_done === today());
export function viewChores() {
  const cs = C.st.chores || [], t = today();
  const due = choresToday(), rest = cs.filter(c => !due.includes(c));
  return `<main class="screen">
  <div class="head"><div><small>ふたりで分担</small><h1>家事</h1></div></div>
  <section class="card list"><h2 class="group-title">今日やること(残り${due.filter(c => c.last_done !== t).length})</h2>
    ${due.length ? due.map(choreRow).join('') : '<p class="muted" style="margin:0 0 10px">今日の家事はありません</p>'}</section>
  <section class="card list"><h2 class="group-title">ほかの家事</h2>
    ${rest.length ? rest.map(choreRow).join('') : `<p class="muted" style="margin:0 0 10px">${cs.length ? 'ありません' : '「＋」から、ゴミ出しや掃除などを登録してください'}</p>`}</section>
  <button class="fab" data-act="choreNew" aria-label="家事を追加">＋</button></main>`;
}
function choreFormHtml() {
  return sheetWrap('家事を追加', `<form class="stack" data-form="chore" novalidate>
    ${field('chName', '家事の名前', '<input id="chName" type="text" maxlength="40" placeholder="例：燃えるゴミ出し">')}
    ${field('chWho', '担当', `<select id="chWho">${memberOpts(null, '決めない')}</select>`)}
    ${field('chFreq', '頻度', '<select id="chFreq"><option value="weekly">毎週</option><option value="daily">毎日</option><option value="monthly">月1回</option><option value="once">1回だけ</option></select>')}
    <fieldset class="chips wds"><legend>曜日(毎週のとき。選ばなければ週1回)</legend>${[...W].map((w, i) => `<label><input type="checkbox" name="wd" value="${i}"><span>${w}</span></label>`).join('')}</fieldset>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">追加する</button>${closeBtn('やめる')}</form>`);
}
function choreSheetHtml() {
  const s = C.st.sheet, c = C.st.chores.find(x => x.id === s.id); if (!c) return '';
  return sheetWrap(C.esc(c.name), `<form class="stack" data-form="choreEdit" novalidate>
    ${field('chWho', '担当', `<select id="chWho">${memberOpts(c.assignee, '決めない')}</select>`)}
    <p class="muted" style="margin:0">${freqText(c)}${c.last_done ? '・前回 ' + md(c.last_done) : '・まだやっていません'}</p>
    <button class="btn primary" type="submit">担当を変える</button></form>
    ${s.confirm ? '<button class="btn danger" data-act="choreDelYes">本当に削除する</button>' : '<button class="btn danger" data-act="choreDel">この家事を削除</button>'}${closeBtn()}`);
}

// ---------- 家計簿 ----------
// お店の名前から分類を推測する。前に同じお店で記録した分類があれば、それを優先する
const GUESS = [
  ['家具・家電', ['ニトリ', 'ヨドバシ', 'ビック', 'ケーズ', 'エディオン', 'ヤマダ', 'IKEA', 'イケア', 'ジョーシン']],
  ['日用品', ['ドラッグ', '薬局', 'マツモトキヨシ', 'スギ', 'ウエルシア', 'ツルハ', 'コスモス', 'ダイソー', 'セリア', 'カインズ', 'コメリ', '無印']],
  ['外食', ['マクドナルド', 'スターバックス', 'スタバ', 'すき家', '吉野家', '松屋', 'ガスト', 'サイゼリヤ', 'コメダ', 'ドトール', 'くら寿司', 'スシロー', 'はま寿司', 'レストラン', 'カフェ', '食堂', 'ラーメン']],
  ['交通', ['ENEOS', 'エネオス', '出光', 'apollostation', 'コスモ石油', 'JR', '名鉄', 'タクシー', 'パーキング', '駐車', 'ETC', 'モビリティ']],
  ['光熱費', ['電力', 'ガス', '水道']],
  ['通信', ['docomo', 'ドコモ', 'au ', 'KDDI', 'ソフトバンク', 'SoftBank', '楽天モバイル', 'ahamo', 'povo']],
  ['食費', ['イオン', 'AEON', 'スーパー', 'ドミー', 'アピタ', 'ピアゴ', 'バロー', 'フィール', 'ヤマナカ', '業務スーパー', 'セブン', 'ローソン', 'ファミリーマート', 'ミニストップ', 'コストコ', 'マックスバリュ', 'フレッシュ']],
];
export function guessCat(shop) {
  const s = String(shop || ''), past = (C.st.tx || []).find(t => t.shop && t.shop === s);
  if (past) return past.category;
  const hit = GUESS.find(([, ks]) => ks.some(k => s.toLowerCase().includes(k.toLowerCase())));
  return hit ? hit[0] : 'その他';
}
const inboxDate = i => ymd(new Date(i.used_at));
export const inboxCount = () => (C.st.inbox || []).length;
function inboxHtml() {
  const { st, esc } = C, ib = st.inbox || [];
  if (!ib.length) return '';
  return `<section class="card list"><h2 class="group-title">カード利用の確認待ち(${ib.length})</h2>
    <p class="muted" style="margin:0 0 4px;font-size:13px">押して分類を選ぶと家計簿に入ります。家計簿に入れないもの(仕事・アパートの分など)は「記録しない」を選んでください。自分にだけ見えています。</p>
    <button class="btn" style="margin:4px 0" data-act="inboxBulk">推測の分類のまま、まとめて記録(${ib.length}件)</button>
    ${ib.map(i => `<button class="row" data-act="inboxOpen" data-id="${i.id}"><span class="main"><span class="name">${esc(i.merchant || '(お店の名前なし)')}</span>
      <span class="sub">${md(inboxDate(i))}・${esc(i.card || 'カード')}・推測:${guessCat(i.merchant)}</span></span><b>${yen(i.amount)}</b></button>`).join('')}</section>`;
}
const monthLabel = mo => `${Number(mo.slice(0, 4))}年${Number(mo.slice(5))}月`;
const shiftMonth = (mo, n) => { const [y, m] = mo.split('-').map(Number); return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); };
// 精算:ふたりの支出を人数で割り、払った額との差を出す
function settle() {
  const { st } = C, shared = (st.tx || []).filter(t => t.scope === 'shared');
  const total = shared.reduce((a, t) => a + t.amount, 0), n = st.members.length || 1, share = total / n;
  const bal = st.members.map(m => { const paid = shared.filter(t => t.paid_by === m.user_id).reduce((a, t) => a + t.amount, 0); return { m, paid, diff: paid - share }; });
  return { total, share, bal };
}
export const sharedTotal = () => settle().total;
export const isThisMonth = () => C.st.kb?.month === thisMonth();

export function viewKakeibo() {
  const { st } = C, kb = st.kb;
  const tabs = [['list', '記録'], ['fixed', '固定費'], ['budget', '予算'], ['goals', '目標貯金']];
  const body = { list: kbList, fixed: kbFixed, budget: kbBudget, goals: kbGoals }[kb.tab]();
  return `<main class="screen">
  <div class="head"><div><small>ふたりの家計簿</small><h1>${monthLabel(kb.month)}</h1></div>
    <div class="nav"><button class="pill" data-act="kbMove" data-n="-1" aria-label="前の月">‹</button><button class="pill" data-act="kbMove" data-n="0">今月</button><button class="pill" data-act="kbMove" data-n="1" aria-label="次の月">›</button></div></div>
  <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${kb.tab === k}" data-act="kbTab" data-t="${k}">${l}</button>`).join('')}</div>
  ${body}</main>`;
}
function kbList() {
  const { st, esc } = C, tx = st.tx || [];
  const { total, bal } = settle();
  const priv = tx.filter(t => t.scope === 'private').reduce((a, t) => a + t.amount, 0);
  const byCat = CATS.map(c => ({ c, spent: tx.filter(t => t.scope === 'shared' && t.category === c).reduce((a, t) => a + t.amount, 0), budget: (st.budgets.find(b => b.category === c) || {}).amount || 0 }))
    .filter(x => x.spent || x.budget);
  const settled = st.settles.find(s => s.month === st.kb.month);
  let settleHtml = '';
  if (st.members.length >= 2 && total) {
    const sorted = [...bal].sort((a, b) => a.diff - b.diff);
    const msg = st.members.length === 2
      ? (Math.round(sorted[1].diff) > 0 ? `<b>${esc(sorted[0].m.display_name)}さん → ${esc(sorted[1].m.display_name)}さんに ${yen(sorted[1].diff)}</b> 払うと半分ずつになります` : 'ちょうど半分ずつです')
      : bal.map(b => `${esc(b.m.display_name)}:${b.diff >= 0 ? '+' : '−'}${yen(Math.abs(b.diff))}`).join(' / ');
    settleHtml = `<section class="card"><h2>精算(ふたりの支出を人数で割る)</h2>
      <p style="margin:0">${bal.map(b => `${esc(b.m.display_name)}さん ${yen(b.paid)}`).join('・')}</p><p style="margin:0">${msg}</p>
      ${settled ? `<p class="muted" style="margin:0">${new Date(settled.settled_at).toLocaleDateString('ja-JP')}に${esc(C.nameOf(settled.settled_by))}さんが精算済みにしました</p><button class="btn" data-act="unsettle">精算済みを取り消す</button>`
        : '<button class="btn green" data-act="settle">精算済みにする</button>'}</section>`;
  }
  const days = [...new Set(tx.map(t => t.date))];
  return `${inboxHtml()}<section class="card"><div class="sum"><div><small>ふたりの支出</small><b>${yen(total)}</b></div><div><small>自分だけの支出</small><b>${yen(priv)}</b></div></div>
    ${byCat.map(x => `<div class="bar"><span>${x.c}</span><span>${yen(x.spent)}${x.budget ? ' / ' + yen(x.budget) : ''}</span>
      ${x.budget ? `<i><b style="width:${Math.min(100, x.spent / x.budget * 100)}%;background:${x.spent > x.budget ? 'var(--red)' : 'var(--blue)'}"></b></i>` : ''}</div>`).join('')}
  </section>
  ${settleHtml}
  <section class="card list"><h2 class="group-title">記録(${tx.length}件)</h2>
    ${days.length ? days.map(d => `<h3 class="day-title">${md(d)}</h3>` + tx.filter(t => t.date === d).map(t => `<button class="row" data-act="txOpen" data-id="${t.id}">
      <span class="dot" style="background:${C.colorOf(t.paid_by)}"></span><span class="main"><span class="name">${esc(t.shop || t.category)}</span>
      <span class="sub">${t.category}・${esc(C.nameOf(t.paid_by))}が払った${t.scope === 'private' ? '・自分だけ' : ''}${t.fixed_cost_id ? '・固定費' : ''}</span></span><b>${yen(t.amount)}</b></button>`).join('')).join('')
      : '<p class="muted" style="margin:0 0 10px">この月の記録はまだありません</p>'}
    ${tx.length ? '<button class="btn text" data-act="csv">この月をCSVで書き出す</button>' : ''}</section>
  <button class="fab" data-act="txNew" aria-label="支出を記録">＋</button>`;
}
function txFormHtml() {
  const { st, esc } = C, s = st.sheet, def = s.cat || '食費';
  const date = s.date || (st.kb.month === thisMonth() ? today() : st.kb.month + '-01');
  return sheetWrap(s.inbox ? 'カード利用を家計簿に記録' : '支出を記録', `<form class="stack" data-form="tx" novalidate>
    ${s.inbox ? `<p class="muted" style="margin:0">${esc(s.card || 'カード')}で払った分です。</p>` : ''}
    ${field('txAmt', '金額(円)', `<input id="txAmt" type="text" inputmode="numeric" maxlength="9" placeholder="例：1280" value="${s.amt || ''}">`)}
    <fieldset class="chips"><legend>分類</legend>${CATS.map(c => `<label><input type="radio" name="cat" value="${c}" ${c === def ? 'checked' : ''}><span>${c}</span></label>`).join('')}</fieldset>
    ${field('txShop', 'お店・内容(なくてもよい)', `<input id="txShop" type="text" maxlength="40" placeholder="例：スーパー" value="${esc(s.shop || '')}">`)}
    <div class="two">${field('txDate', '日付', `<input id="txDate" type="date" value="${date}">`)}${field('txWho', '払った人', `<select id="txWho">${memberOpts(st.me.user_id)}</select>`)}</div>
    ${field('txScope', '共有', '<select id="txScope"><option value="shared">ふたりの支出(精算の対象)</option><option value="private">自分だけ(相手には見えません)</option></select>')}
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">記録する</button>
    ${s.inbox ? '<button class="btn" type="button" data-act="inboxIgnore">家計簿に記録しない(仕事・アパートの分など)</button>' : ''}${closeBtn('やめる')}</form>`);
}
function txSheetHtml() {
  const { st, esc } = C, s = st.sheet, t = (st.tx || []).find(x => x.id === s.id); if (!t) return '';
  return sheetWrap(`${esc(t.shop || t.category)} ${yen(t.amount)}`, `<p class="muted" style="margin:0">${md(t.date)}・${t.category}・${esc(C.nameOf(t.paid_by))}が払った・${t.scope === 'private' ? '自分だけ' : 'ふたりの支出'}</p>
    ${t.fixed_cost_id ? '<p class="muted" style="margin:0">固定費から自動で記録したものです。金額の変更や記録の停止は「固定費」で行ってください。</p>'
      : s.confirm ? '<button class="btn danger" data-act="txDelYes">本当に削除する</button>' : '<button class="btn danger" data-act="txDel">この記録を削除</button>'}${closeBtn()}`);
}
function kbFixed() {
  const { st, esc } = C;
  return `<section class="card list"><h2 class="group-title">固定費(毎月1日付で自動で記録)</h2>
    ${st.fixed.length ? st.fixed.map(f => `<div class="row"><span class="main"><span class="name">${esc(f.name)} ${yen(f.amount)}</span><span class="sub">${f.category}・${esc(C.nameOf(f.paid_by))}が払う</span></span>
      <button class="pill ${f.active ? 'go on' : ''}" data-act="fixToggle" data-id="${f.id}" aria-pressed="${f.active}">${f.active ? '記録する' : '止めている'}</button>
      <button class="pill" data-act="fixDel" data-id="${f.id}" aria-label="${esc(f.name)}を削除">削除</button></div>`).join('') : '<p class="muted" style="margin:0 0 10px">家賃・駐車場代などを登録すると、毎月自動で記録します</p>'}</section>
  <form class="card stack" data-form="fix" novalidate><h2>固定費を追加</h2>
    <div class="two">${field('fxName', '名前', '<input id="fxName" type="text" maxlength="30" placeholder="例：家賃">')}${field('fxAmt', '金額(円)', '<input id="fxAmt" type="text" inputmode="numeric" maxlength="9" placeholder="例：73000">')}</div>
    <div class="two">${field('fxCat', '分類', `<select id="fxCat">${CATS.map(c => `<option>${c}</option>`).join('')}</select>`)}${field('fxWho', '払う人', `<select id="fxWho">${memberOpts(st.me.user_id)}</select>`)}</div>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">追加する</button>
    <p class="muted" style="margin:0;font-size:13px">追加した固定費は、今月の分から記録されます。</p></form>`;
}
function kbBudget() {
  const { st } = C;
  return `<form class="card stack" data-form="budget" novalidate><h2>1か月の予算(ふたりの支出)</h2>
    ${CATS.map((c, i) => `<div class="brow"><label for="bg${i}">${c}</label><input id="bg${i}" type="text" inputmode="numeric" maxlength="9" placeholder="なし" value="${(st.budgets.find(b => b.category === c) || {}).amount || ''}"></div>`).join('')}
    <button class="btn primary" type="submit">保存する</button><p class="muted" style="margin:0;font-size:13px">空にすると、その分類の予算はなしになります。</p></form>`;
}
function kbGoals() {
  const { st, esc } = C;
  return `<section class="card list"><h2 class="group-title">目標貯金</h2>
    ${st.goals.length ? st.goals.map(g => `<div class="goal"><div class="row" style="border:0"><span class="main"><span class="name">${esc(g.name)}</span><span class="sub">${yen(g.saved)} / ${yen(g.target)}(${Math.floor(g.saved / g.target * 100)}%)</span></span>
      <button class="pill go" data-act="goalAdd" data-id="${g.id}">入金</button><button class="pill" data-act="goalDel" data-id="${g.id}" aria-label="${esc(g.name)}を削除">削除</button></div>
      <i class="gbar"><b style="width:${Math.min(100, g.saved / g.target * 100)}%"></b></i></div>`).join('') : '<p class="muted" style="margin:0 0 10px">旅行や家電など、ふたりで貯める目標を登録できます</p>'}</section>
  <form class="card stack" data-form="goal" novalidate><h2>目標を追加</h2>
    <div class="two">${field('glName', '名前', '<input id="glName" type="text" maxlength="30" placeholder="例：旅行">')}${field('glTarget', '目標額(円)', '<input id="glTarget" type="text" inputmode="numeric" maxlength="9" placeholder="例：100000">')}</div>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">追加する</button></form>`;
}
function goalAddHtml() {
  const g = C.st.goals.find(x => x.id === C.st.sheet.id); if (!g) return '';
  return sheetWrap(`${C.esc(g.name)}に入金`, `<form class="stack" data-form="goalAdd" novalidate>
    ${field('gaAmt', '金額(円)。引き出すときは先頭に「-」', '<input id="gaAmt" type="text" inputmode="numeric" maxlength="10" placeholder="例：5000">')}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">記録する</button>${closeBtn('やめる')}</form>`);
}
function bulkHtml() {
  const ib = C.st.inbox || [], total = ib.reduce((a, i) => a + i.amount, 0);
  return sheetWrap(`${ib.length}件をまとめて記録`, `<form class="stack" data-form="bulk" novalidate>
    <p class="muted" style="margin:0">それぞれ、一覧の「推測」の分類で家計簿に入ります(合計 ${yen(total)})。違う分類のものや、仕事・アパートの分が混ざっていたら、先にそれだけ1件ずつ直してから使ってください。</p>
    ${field('bkScope', '共有', '<select id="bkScope"><option value="private">自分だけ(相手には見えません)</option><option value="shared">ふたりの支出(精算の対象)</option></select>')}
    <button class="btn primary" type="submit">まとめて記録する</button>${closeBtn('やめる')}</form>`);
}
function confirmHtml() {
  const s = C.st.sheet;
  return sheetWrap(s.title, `<p class="muted" style="margin:0">${s.note || '削除すると元に戻せません。'}</p>
    <button class="btn danger" data-act="${s.yes}" data-id="${s.id}">削除する</button>${closeBtn('やめる')}`);
}
function csv() {
  const { st } = C, rows = [['日付', '金額', 'お店・内容', '分類', '払った人', '共有', '固定費']];
  [...st.tx].reverse().forEach(t => rows.push([t.date, t.amount, t.shop || '', t.category, C.nameOf(t.paid_by), t.scope === 'shared' ? 'ふたり' : '自分だけ', t.fixed_cost_id ? '○' : '']));
  const text = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const file = new File([text], `家計簿_${st.kb.month}.csv`, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}

// ---------- シート(下から出る画面) ----------
export function sheetHtml() {
  const t = C.st.sheet?.type;
  return ({ evNew: evFormHtml, ev: evSheetHtml, choreNew: choreFormHtml, chore: choreSheetHtml, txNew: txFormHtml, tx: txSheetHtml, goalAdd: goalAddHtml, confirm: confirmHtml, bulk: bulkHtml }[t] || (() => ''))();
}
function openSheet(s) { C.st.sheet = { form: true, ...s }; C.render(); }

// ---------- 入力の送信 ----------
export async function onSubmit(f) {
  const { st, run } = C, me = st.me;
  if (f === 'ev') {
    const title = val('evTitle'), date = val('evDate');
    if (!title || !date) return err('タイトルと日付を入れてください');
    const d = dt(date), rep = val('evRep'), priv = chk('evPriv');
    const rule = rep === 'weekly' ? 'weekly:' + d.getDay() : rep === 'monthly' ? 'monthly:' + d.getDate() : null;
    await run(sb().from('events').insert({ household_id: h(), date, time: val('evTime') || null, title, for_user: val('evFor') || null, is_private: priv, repeat_rule: rule }), '予定を追加しました');
    if (!priv) activity(`${me.display_name}さんが予定「${title}」(${md(date)})を追加しました`);
    st.sheet = null; st.cal = { y: d.getFullYear(), m: d.getMonth(), sel: date }; await reloadEvents(); C.render(); return true;
  }
  if (f === 'cmt') {
    const body = val('cmtBody'); if (!body) return true;
    const s = st.sheet, e = st.events.find(x => x.id === s.id);
    await run(sb().from('event_comments').insert({ household_id: h(), event_id: s.id, body }));
    if (e && !e.is_private) activity(`${me.display_name}さんが予定「${e.title}」にコメントしました`);
    s.comments = await run(sb().from('event_comments').select('*').eq('event_id', s.id).order('created_at')); C.render(); return true;
  }
  if (f === 'chore') {
    const name = val('chName'); if (!name) return err('家事の名前を入れてください');
    const freq = val('chFreq'), wds = [...document.querySelectorAll('input[name=wd]:checked')].map(x => x.value).join(',');
    await run(sb().from('chores').insert({ household_id: h(), name, assignee: val('chWho') || null, freq, weekdays: freq === 'weekly' && wds ? wds : null }), '家事を追加しました');
    st.sheet = null; await reloadChores(); C.render(); return true;
  }
  if (f === 'choreEdit') {
    await run(sb().from('chores').update({ assignee: val('chWho') || null }).eq('id', st.sheet.id), '担当を変えました');
    st.sheet = null; await reloadChores(); C.render(); return true;
  }
  if (f === 'tx') {
    const amount = toNum(val('txAmt')), date = val('txDate'), category = document.querySelector('input[name=cat]:checked')?.value;
    if (!amount) return err('金額を入れてください');
    if (!date || !category) return err('日付と分類を選んでください');
    const scope = val('txScope'), shop = val('txShop') || null;
    const inboxId = st.sheet?.inbox;
    await run(sb().from('transactions').insert({ household_id: h(), date, amount, shop, category, paid_by: val('txWho') || me.user_id, scope }), '記録しました');
    if (inboxId) { await run(sb().from('card_inbox').update({ status: 'recorded' }).eq('id', inboxId)); await reloadInbox(); }
    if (scope === 'shared') activity(`${me.display_name}さんが家計簿に${category} ${yen(amount)}を記録しました`);
    st.sheet = null; st.kb.month = date.slice(0, 7); st.kb.tab = 'list'; await loadTx(true); C.render(); return true;
  }
  if (f === 'bulk') {
    const ib = st.inbox || [], scope = val('bkScope') || 'private';
    if (!ib.length) { st.sheet = null; C.render(); return true; }
    await run(sb().from('transactions').insert(ib.map(i => ({ household_id: h(), date: inboxDate(i), amount: i.amount, shop: i.merchant || null,
      category: guessCat(i.merchant), paid_by: me.user_id, scope }))));
    await run(sb().from('card_inbox').update({ status: 'recorded' }).in('id', ib.map(i => i.id)), `${ib.length}件を記録しました`);
    if (scope === 'shared') activity(`${me.display_name}さんがカード利用${ib.length}件を家計簿に記録しました`);
    st.sheet = null; await Promise.all([loadTx(true), reloadInbox()]); C.render(); return true;
  }
  if (f === 'fix') {
    const name = val('fxName'), amount = toNum(val('fxAmt')); if (!name || !amount) return err('名前と金額を入れてください');
    await run(sb().from('fixed_costs').insert({ household_id: h(), name, amount, category: val('fxCat'), paid_by: val('fxWho') || me.user_id }), '固定費を追加しました');
    await loadFeatures(); C.render(); return true;
  }
  if (f === 'budget') {
    const rows = CATS.map((c, i) => ({ household_id: h(), category: c, amount: toNum(val('bg' + i)) }));
    const keep = rows.filter(r => r.amount > 0), drop = rows.filter(r => !r.amount).map(r => r.category);
    if (keep.length) await run(sb().from('budgets').upsert(keep));
    if (drop.length) await run(sb().from('budgets').delete().eq('household_id', h()).in('category', drop));
    toast('予算を保存しました'); await loadFeatures(); C.render(); return true;
  }
  if (f === 'goal') {
    const name = val('glName'), target = toNum(val('glTarget')); if (!name || !target) return err('名前と目標額を入れてください');
    await run(sb().from('goals').insert({ household_id: h(), name, target }), '目標を追加しました');
    await loadFeatures(); C.render(); return true;
  }
  if (f === 'goalAdd') {
    const raw = val('gaAmt'), n = toNum(raw) * (/^[-ー−－]/.test(raw) ? -1 : 1), g = st.goals.find(x => x.id === st.sheet.id);
    if (!n || !g) return err('金額を入れてください');
    await run(sb().from('goals').update({ saved: Math.max(0, g.saved + n) }).eq('id', g.id), '記録しました');
    if (n > 0) activity(`${me.display_name}さんが「${g.name}」に${yen(n)}入金しました`);
    st.sheet = null; await loadFeatures(); C.render(); return true;
  }
  return false;
}

// ---------- ボタン ----------
export async function onClick(act, el) {
  const { st, run } = C, me = st.me, id = el.dataset.id;
  switch (act) {
    case 'calDay': st.cal.sel = el.dataset.d; C.render(); return true;
    case 'calMove': {
      const n = Number(el.dataset.n);
      if (!n) { const d = new Date(); st.cal = { y: d.getFullYear(), m: d.getMonth(), sel: today() }; }
      else { const d = new Date(st.cal.y, st.cal.m + n, 1); st.cal.y = d.getFullYear(); st.cal.m = d.getMonth(); st.cal.sel = ymd(d); }
      C.render(); return true;
    }
    case 'evNew': openSheet({ type: 'evNew' }); return true;
    case 'evOpen': {
      st.sheet = { type: 'ev', id, comments: null, form: true, day: route() === 'calendar' ? st.cal.sel : today() }; C.render();
      const cm = await run(sb().from('event_comments').select('*').eq('event_id', id).order('created_at'));
      if (st.sheet?.id === id) { st.sheet.comments = cm; C.render(); } return true;
    }
    case 'evDel': st.sheet.confirm = true; C.render(); return true;
    case 'evShare': { const e = st.events.find(x => x.id === st.sheet.id); if (!e) return true;
      await run(sb().from('events').update({ is_private: !e.is_private }).eq('id', e.id), e.is_private ? 'ふたりに見せるようにしました' : '自分だけにしました');
      if (e.is_private) activity(`${me.display_name}さんが予定「${e.title}」(${md(e.date)})を共有しました`);
      await reloadEvents(); C.render(); return true; }
    case 'evDelYes': await run(sb().from('events').delete().eq('id', st.sheet.id), '予定を削除しました'); st.sheet = null; await reloadEvents(); C.render(); return true;
    case 'choreNew': openSheet({ type: 'choreNew' }); return true;
    case 'choreOpen': openSheet({ type: 'chore', id }); return true;
    case 'choreDel': st.sheet.confirm = true; C.render(); return true;
    case 'choreDelYes': await run(sb().from('chores').delete().eq('id', st.sheet.id), '家事を削除しました'); st.sheet = null; await reloadChores(); C.render(); return true;
    case 'choreDone': {
      const c = st.chores.find(x => x.id === id); if (!c) return true;
      const t = today(), undo = c.last_done === t;
      const next = undo ? (st.choreUndo[id] ?? null) : t;
      if (!undo) st.choreUndo[id] = c.last_done;
      c.last_done = next; C.render();   // 先に画面を変えて、あとで保存
      await run(sb().from('chores').update({ last_done: next }).eq('id', id));
      if (!undo) activity(`${me.display_name}さんが「${c.name}」をやりました`);
      return true;
    }
    case 'kbTab': st.kb.tab = el.dataset.t; C.render(); return true;
    case 'kbMove': { const n = Number(el.dataset.n); st.kb.month = n ? shiftMonth(st.kb.month, n) : thisMonth(); await loadTx(true); C.render(); return true; }
    case 'txNew': openSheet({ type: 'txNew' }); return true;
    case 'txFromShop': st.nextSheet = { type: 'txNew', form: true, cat: '食費' }; st.kb.tab = 'list'; location.hash = '#kakeibo'; return true;
    case 'txOpen': openSheet({ type: 'tx', id }); return true;
    case 'txDel': st.sheet.confirm = true; C.render(); return true;
    case 'txDelYes': await run(sb().from('transactions').delete().eq('id', st.sheet.id), '記録を削除しました'); st.sheet = null; await loadTx(false); C.render(); return true;
    case 'settle': await run(sb().from('settlements').insert({ household_id: h(), month: st.kb.month }), '精算済みにしました');
      activity(`${me.display_name}さんが${monthLabel(st.kb.month)}の家計簿を精算済みにしました`); await loadFeatures(); C.render(); return true;
    case 'unsettle': await run(sb().from('settlements').delete().eq('household_id', h()).eq('month', st.kb.month), '取り消しました'); await loadFeatures(); C.render(); return true;
    case 'csv': csv(); return true;
    case 'inboxOpen': { const i = st.inbox.find(x => x.id === id); if (!i) return true;
      openSheet({ type: 'txNew', inbox: id, amt: i.amount, shop: i.merchant || '', date: inboxDate(i), cat: guessCat(i.merchant), card: i.card }); return true; }
    case 'inboxBulk': openSheet({ type: 'bulk' }); return true;
    case 'inboxIgnore': await run(sb().from('card_inbox').update({ status: 'ignored' }).eq('id', st.sheet.inbox), '記録しないことにしました');
      st.sheet = null; await reloadInbox(); C.render(); return true;
    case 'cardKey': case 'cardKeyRenew':
      st.cardKey = await run(sb().rpc('card_token', { p_renew: act === 'cardKeyRenew' }), act === 'cardKeyRenew' ? '鍵を作り直しました。ショートカットの鍵も入れ替えてください' : null); C.render(); return true;
    case 'copy': try { await navigator.clipboard.writeText(el.dataset.v); toast('コピーしました'); } catch { toast('コピーできませんでした。長押しで選んでください'); } return true;
    case 'fixToggle': { const f = st.fixed.find(x => x.id === id); await run(sb().from('fixed_costs').update({ active: !f.active }).eq('id', id)); await loadFeatures(); C.render(); return true; }
    case 'fixDel': { const f = st.fixed.find(x => x.id === id);
      openSheet({ type: 'confirm', id, yes: 'fixDelYes', title: `固定費「${C.esc(f.name)}」を削除しますか?`, note: 'これまでに記録した分は家計簿に残ります。削除すると元に戻せません。' }); return true; }
    case 'fixDelYes': await run(sb().from('fixed_costs').delete().eq('id', id), '削除しました'); st.sheet = null; await loadFeatures(); C.render(); return true;
    case 'goalAdd': openSheet({ type: 'goalAdd', id }); return true;
    case 'goalDel': { const g = st.goals.find(x => x.id === id);
      openSheet({ type: 'confirm', id, yes: 'goalDelYes', title: `目標「${C.esc(g.name)}」を削除しますか?` }); return true; }
    case 'goalDelYes': await run(sb().from('goals').delete().eq('id', id), '削除しました'); st.sheet = null; await loadFeatures(); C.render(); return true;
  }
  return false;
}

// ---------- 設定:カード利用の取り込み(iPhoneのショートカット) ----------
export function cardSettingsHtml() {
  const { st, esc } = C, k = st.cardKey, url = C.url + '/rest/v1/rpc/card_inbox_add';
  const box = (label, v) => `<div class="field"><span class="muted" style="font-size:13px">${label}</span><div class="codebox">${esc(v)}</div>
    <button class="btn text" style="padding:0;min-height:40px" data-act="copy" data-v="${esc(v)}">コピー</button></div>`;
  return `<section class="card stack"><h2>カード利用の取り込み</h2>
    <p class="muted" style="margin:0;font-size:13px">iPhoneのショートカットで、ウォレットで払ったときにお店と金額をこのアプリへ送ります。下の3つをショートカットに貼り付けます。鍵は人に見せないでください。</p>
    ${k ? box('① 送り先のURL', url) + box('② apikey(公開用の鍵)', C.key) + box('③ あなたの取り込み用の鍵(p_token)', k)
        + '<button class="btn" data-act="cardKeyRenew">鍵を作り直す(古い鍵は使えなくなります)</button>'
        : '<button class="btn primary" data-act="cardKey">設定に使う情報を表示する</button>'}</section>`;
}
