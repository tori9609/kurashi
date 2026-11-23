// ふたりの暮らし帳 第2段階(予定・家事)と第3段階(家計簿)。2026-11-20
// app.js から道具(st・sb・run など)を受け取って動く。画面は文字列で作り、app.js の render() が表示する。
import { evFormHtml, evSheetHtml } from './calendar.js';
import { C, CATS, W, WS_KEY, activity, applyTheme, chk, closeBtn, dt, edge, err, field, h, ic, ls, md, memberOpts, pad, route, sb, sheetWrap, thisMonth, toNum, toast, today, val, who, yen, ymd } from './core.js';
import { DL_KINDS, addYears, bulkHtml, confirmHtml, csv, deadlineHtml, fixSheetHtml, goalAddHtml, guessCat, inboxDate, monthLabel, quickHtml, readSplit, settle, shiftMonth, txFormHtml, txSheetHtml } from './kakeibo.js';
import { infoHtml, paperHtml, rcptHtml, readPaper, readReceipts, splitByCategory } from './receipt.js';
import { doSearch, has, loadWidget, pushOff, pushOn, runStatus, widgetScript } from './settings.js';
export * from './core.js';
export * from './settings.js';
export * from './calendar.js';
export * from './kakeibo.js';
export * from './receipt.js';
export function setup(ctx) {
  Object.assign(C, ctx);   // 道具は core.js の C に入れて、ほかのファイルからも使う
  document.addEventListener('change', e => { if (e.target.id === 'rcptFile') readReceipts([...e.target.files]); if (e.target.id === 'paperFile') readPaper(e.target.files[0]);
    if (e.target.dataset?.split) { const id = e.target.dataset.split, v = e.target.value, box = document.getElementById(id + 'Box'), u = document.getElementById(id + 'U'), n = document.getElementById(id + 'N');
      if (box) box.hidden = !/^[pa]:/.test(v); if (u) u.textContent = v.startsWith('a:') ? '円' : '%'; if (n) n.placeholder = v.startsWith('a:') ? '例:820' : '例:70'; }
    if (e.target.dataset?.cyc) { const m = document.getElementById(e.target.dataset.cyc + 'Mon'); if (m) m.disabled = e.target.value !== 'yearly'; } });
  // カレンダーを左右にスワイプ:左へ=前の月(年)、右へ=次の月(年)
  let sx = 0, sy = 0, on = null;
  document.addEventListener('touchstart', e => {
    const t = e.target.closest?.('.cal, .ygrid'); on = t ? (t.classList.contains('cal') ? 'm' : 'y') : null;
    if (on) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!on) return; const kind = on; on = null;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const n = dx < 0 ? -1 : 1;
    if (kind === 'm') calShift(n); else C.st.cal.yy += n;
    C.render();
  }, { passive: true });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
}
function calShift(n) {
  const st = C.st;
  if (!n) { const d = new Date(); st.cal = { y: d.getFullYear(), m: d.getMonth(), sel: today() }; return; }
  const d = new Date(st.cal.y, st.cal.m + n, 1); st.cal.y = d.getFullYear(); st.cal.m = d.getMonth(); st.cal.sel = ymd(d);
}
// ---------- 読み込み ----------
export async function loadFeatures() {
  const { st, run } = C;
  const [ev, ch, fx, bu, go, se] = await Promise.all([
    run(sb().from('events').select('*').eq('household_id', h()).is('deleted_at', null).order('date')),
    run(sb().from('chores').select('*').eq('household_id', h()).is('deleted_at', null).order('created_at')),
    run(sb().from('fixed_costs').select('*').eq('household_id', h()).is('deleted_at', null).order('name')),
    run(sb().from('budgets').select('*').eq('household_id', h())),
    run(sb().from('goals').select('*').eq('household_id', h()).is('deleted_at', null).order('name')),
    run(sb().from('settlements').select('*').eq('household_id', h())),
  ]);
  Object.assign(st, { events: ev, chores: ch, fixed: fx, budgets: bu, goals: go, settles: se });
  const sc = await sb().from('shop_categories').select('*');   // 覚えたお店の分類(本人の分だけ。まだ表がなくても動く)
  st.shopCats = sc.error ? [] : sc.data || [];
  initState();
  await loadTx(true); await reloadInbox();
}
// 画面の状態(圏外で端末の控えから始めるときにも使う)
export function initState() {
  const st = C.st, n = new Date();
  st.cal ||= { y: n.getFullYear(), m: n.getMonth(), sel: today() };
  st.kb ||= { month: thisMonth(), tab: 'list' };
  st.choreUndo ||= {};
  for (const k of ['events', 'chores', 'fixed', 'budgets', 'goals', 'settles', 'tx', 'inbox']) st[k] ||= [];
}
// カード利用の受け箱(本人の分だけ)。まだ表がない(SQL未実行)ときは空のまま動かす
export async function reloadInbox() {
  const { data, error } = await sb().from('card_inbox').select('*').eq('status', 'new').order('used_at', { ascending: false });
  C.st.inbox = error ? [] : data;
  if (!error) await matchFixed();
  // 金額を読み取れなかったウォレットの支払い(SQL 追加分17 の前は空のまま)
  const m = await sb().from('card_misses').select('*').order('used_at', { ascending: false }).limit(20);
  // カードの引き落とし予定(セゾンのお知らせメールから。本人だけ。SQL 追加分19の前は空)
  const since = ymd(new Date(Date.now() - 7 * 864e5));
  const bl = await sb().from('card_bills').select('*').gte('pay_date', since).order('pay_date');
  C.st.bills = bl.error ? [] : bl.data || [];
  C.st.misses = m.error ? [] : m.data || [];
}
// 固定費とカード利用の突き合わせ:
// 「記録する」固定費(自分が払う)と同じ金額のカード利用が、その固定費を記録済みの月に来たら、
// 二重にならないよう「固定費で記録済み」に回す。違っていたら、固定費の画面から取り消せる。
const monthOf = i => ymd(new Date(i.used_at)).slice(0, 7);
const norm = x => String(x || '').toLowerCase().replace(/[\s・()()]/g, '');
const nameHit = (f, i) => { const a = norm(f.name), b = norm(i.merchant); return !!a && !!b && (b.includes(a) || a.includes(b)); };
async function matchFixed() {
  const { st } = C, me = st.me?.user_id;
  const rec = (st.fixed || []).filter(f => f.active && f.paid_by === me);
  const cand = st.inbox.filter(i => !i.items?.length && !i.nofix && i.source !== 'receipt' && rec.some(f => f.amount === i.amount));
  if (cand.length) {
    const months = [...new Set(cand.map(monthOf))];
    const [done, used] = await Promise.all([
      sb().from('transactions').select('fixed_cost_id,month').in('fixed_cost_id', rec.map(f => f.id)).in('month', months),
      sb().from('card_inbox').select('fixed_cost_id,used_at').eq('status', 'fixed')]);
    if (!done.error && !used.error) {
      const has = new Set(done.data.map(r => r.fixed_cost_id + r.month)), taken = new Set(used.data.map(r => r.fixed_cost_id + monthOf(r)));
      const hits = [];
      for (const i of cand) {
        const mo = monthOf(i), ok = rec.filter(f => f.amount === i.amount && payThisMonth(f, mo) && (has.has(f.id + mo) || mo === thisMonth()) && !taken.has(f.id + mo));
        const f = ok.find(x => nameHit(x, i)) || ok[0]; if (!f) continue;
        taken.add(f.id + mo); hits.push([i, f]);
      }
      const moved = [];   // SQL(追加分8)が未実行などで失敗した分は、確認待ちに残す
      for (const [i, f] of hits) { const r = await sb().from('card_inbox').update({ status: 'fixed', fixed_cost_id: f.id }).eq('id', i.id); if (!r.error) moved.push([i, f]); }
      hits.length = 0; hits.push(...moved);
      if (hits.length) {
        st.inbox = st.inbox.filter(i => !hits.some(([x]) => x === i));
        C.toast(`カード利用${hits.length}件は固定費で記録済みのため、確認待ちから外しました(固定費の画面で取り消せます)`);
      }
    }
  }
  const since = new Date(Date.now() - 62 * 864e5).toISOString();
  const { data } = await sb().from('card_inbox').select('*').eq('status', 'fixed').gte('used_at', since).order('used_at', { ascending: false });
  st.fixMatched = data || [];
}
// 「記録しない」固定費と同じ金額のカード利用は、その固定費の分類と名前を下書きに使う
export const infoFix = i => (C.st.fixed || []).find(f => !f.active && f.paid_by === C.st.me.user_id && f.amount === i.amount);
// お店の名前を比べやすい形に(全角→半角、大文字→小文字、空白・記号を取る)
export const shopKey = x => String(x || '').normalize('NFKC').toLowerCase().replace(/[\s・,.\-_/()()「」【】*#]/g, '');
// 覚えた分類:同じ名前 → 名前を含むもの(3文字以上・長いほど優先)
export function learnedCat(merchant) {
  const k = shopKey(merchant), list = C.st.shopCats || []; if (!k) return null;
  const hit = list.find(x => x.shop_key === k)
    || list.filter(x => x.shop_key.length >= 3 && (k.includes(x.shop_key) || x.shop_key.includes(k) && k.length >= 3)).sort((a, b) => b.shop_key.length - a.shop_key.length)[0];
  return hit?.category || null;
}
async function learnShop(shop, category) {
  const k = shopKey(shop); if (!k || k.length < 2 || !CATS.includes(category)) return;
  const st = C.st, cur = (st.shopCats || []).find(x => x.shop_key === k);
  if (cur?.category === category) return;
  const { error } = await sb().from('shop_categories').upsert({ owner: st.me.user_id, shop_key: k, category, updated_at: new Date().toISOString() }, { onConflict: 'owner,shop_key' });
  if (error) return;
  if (cur) cur.category = category; else (st.shopCats ||= []).push({ owner: st.me.user_id, shop_key: k, category });
}
export const catFor = i => learnedCat(i.merchant) || infoFix(i)?.category || guessCat(i.merchant);
export async function reloadEvents() { C.st.events = await C.run(sb().from('events').select('*').eq('household_id', h()).is('deleted_at', null).order('date')); }
export async function reloadChores() { C.st.chores = await C.run(sb().from('chores').select('*').eq('household_id', h()).is('deleted_at', null).order('created_at')); }
export async function loadTx(withFixed) {
  const { st, run } = C, mo = st.kb.month;
  if (withFixed && mo === thisMonth()) await ensureFixed(mo);
  const [y, m] = mo.split('-').map(Number);
  st.tx = await run(sb().from('transactions').select('*').eq('household_id', h()).is('deleted_at', null).gte('date', mo + '-01').lt('date', ymd(new Date(y, m, 1)))
    .order('date', { ascending: false }).order('created_at', { ascending: false }));
}
// 支払日:1〜31(31は末日)。その月にない日(2月30日など)は末日にする
export const payDate = (mo, d) => { const [y, m] = mo.split('-').map(Number); return `${mo}-${pad(Math.min(d || 1, new Date(y, m, 0).getDate()))}`; };
const dayText = d => (d || 1) >= 31 ? '末日' : `${d || 1}日`;
// 支払いの間隔:毎月(monthly)・毎年(yearly。pay_month の月だけ記録)
export const isYearly = f => f.cycle === 'yearly';
export const payThisMonth = (f, mo) => !isYearly(f) || Number(mo.slice(5)) === (f.pay_month || 1);
export const perYear = f => isYearly(f) ? f.amount : f.amount * 12;   // 1年あたり
export const perMonth = f => isYearly(f) ? Math.round(f.amount / 12) : f.amount;   // 月あたり(年払いは12で割る)
export const cycText = f => isYearly(f) ? `毎年${f.pay_month || 1}月${dayText(f.pay_day)}` : `毎月${dayText(f.pay_day)}`;
// 固定費:支払日が来たら、その日付で記録する(同じ月に2回は入らない)
async function ensureFixed(mo) {
  const t = today(), act = (C.st.fixed || []).filter(f => f.active && payThisMonth(f, mo) && payDate(mo, f.pay_day) <= t); if (!act.length) return;
  await sb().from('transactions').upsert(act.map(f => ({ household_id: h(), date: payDate(mo, f.pay_day), amount: f.amount, shop: f.name, category: f.category,
    paid_by: f.paid_by, fixed_cost_id: f.id, month: mo, ...(f.scope === 'private' ? { scope: 'private', owner: f.owner } : { scope: 'shared' }) })), { onConflict: 'fixed_cost_id,month', ignoreDuplicates: true });
}

// 予定タブの中の切り替え(カレンダー・やること)
export const planSeg = cur => `<div class="seg plan" role="tablist" aria-label="予定の中の切り替え"><a role="tab" href="#calendar" aria-selected="${cur === 'calendar'}">${ic('cal')}カレンダー</a><a role="tab" href="#chores" aria-selected="${cur === 'chores'}">${ic('todo')}やること</a></div>`;
export const addBtn = (act, label) => `<button class="iconbtn solid" data-act="${act}" aria-label="${label}">${ic('plus')}</button>`;
// ---------- やること(旧・家事) ----------
// くり返し:once(1回だけ・期限は任意)/ daily / weekly(曜日)/ monthly(前回から30日)
// 完了:チェックで今回分を完了。くり返しは次の回に自動で戻る。1回だけは「完了したもの」へ移り、「復活」で戻せる。
// お休み:くり返しを終えたもの(archived)。「復活」でまた始まる。
export function choreDue(c, ds = today()) {
  if (c.archived || c.last_done === ds) return false;
  const days = c.last_done ? Math.round((dt(ds) - dt(c.last_done)) / 864e5) : Infinity;
  if (c.freq === 'once') return !c.last_done && (!c.due || c.due <= ds);
  if (c.freq === 'daily') return true;
  if (c.freq === 'monthly') return days >= 30;
  if (c.weekdays) return c.weekdays.split(',').map(Number).includes(dt(ds).getDay());
  return days >= 7;
}
export const INCOME_CATS = ['給与', '投資', '臨時収入', 'その他の収入'];
export const isIncome = t => t?.kind === 'income';
export const TODO_CATS = ['家事', '用事・手続き', '買い物', '仕事', 'お金', '健康', 'その他'];
export const freqText = c => ({ daily: '毎日', monthly: '月1回', once: '1回だけ' }[c.freq] || (c.weekdays ? '毎週' + c.weekdays.split(',').map(n => W[n]).join('・') : '週1回'));
const isFinished = c => c.archived || (c.freq === 'once' && c.last_done && c.last_done !== today());
const canPrivChore = c => !c || !c.created_by || c.created_by === C.st.me.user_id;
export function choreRow(c) {
  const t = today(), doneToday = c.last_done === t, fin = isFinished(c);
  const late = c.freq === 'once' && !c.last_done && c.due && c.due < t;
  const sub = [`<span class="ctag">${C.esc(c.category || '家事')}</span>`, who(c.assignee, '担当なし'), c.archived ? 'お休み中(' + freqText(c) + ')' : freqText(c),
    c.freq === 'once' && c.due && !c.last_done ? `<span${late ? ' style="color:var(--red);font-weight:700"' : ''}>期限 ${md(c.due)}${late ? ' 過ぎ' : ''}</span>` : '',
    c.last_done ? (c.freq === 'once' ? '完了 ' : '前回 ') + md(c.last_done) : '', c.is_private ? '自分だけ' : ''].filter(Boolean).join('・');
  const box = c.archived ? `<button class="pill" data-act="choreRevive" data-id="${c.id}">復活</button>`
    : `<button class="box" data-act="choreDone" data-id="${c.id}" aria-label="${C.esc(c.name)}を${doneToday || fin ? '未完了に戻す' : '完了にする'}" aria-pressed="${doneToday || fin}">${doneToday || fin ? ic('tick') : ''}</button>`;
  return `<div class="row${doneToday || fin ? ' done' : ''}" ${edge(c.assignee)}>${box}
    <button class="main plain" data-act="choreOpen" data-id="${c.id}"><span class="name">${C.esc(c.name)}</span><span class="sub">${sub}</span></button>
    ${c.assignee ? `<span class="dot" style="background:${C.colorOf(c.assignee)}"></span>` : ''}</div>`;
}
export const choresToday = () => (C.st.chores || []).filter(c => !c.archived && (choreDue(c) || c.last_done === today()));
export function viewChores() {
  const all = C.st.chores || [], t = today(), open = C.st.choreDoneOpen, cat = C.st.choreCat || '';
  const cs = cat ? all.filter(c => (c.category || '家事') === cat) : all;
  const used = TODO_CATS.filter(k => all.some(c => (c.category || '家事') === k));
  const chips = used.length > 1 || cat ? `<div class="catbar" role="group" aria-label="分類で絞り込む">${[['', 'すべて', all.length], ...used.map(k => [k, k, all.filter(c => (c.category || '家事') === k && !isFinished(c)).length])]
    .map(([v, l, n]) => `<button class="pill${cat === v ? ' on' : ''}" data-act="choreCat" data-v="${C.esc(v)}" aria-pressed="${cat === v}">${C.esc(l)}${v ? ` ${n}` : ''}</button>`).join('')}</div>` : '';
  const due = choresToday().filter(c => cs.includes(c)).sort((a, b) => (a.last_done === t) - (b.last_done === t) || (a.due || '9').localeCompare(b.due || '9'));
  const fin = cs.filter(c => !due.includes(c) && isFinished(c)).sort((a, b) => (b.last_done || '').localeCompare(a.last_done || ''));
  const rest = cs.filter(c => !due.includes(c) && !fin.includes(c)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  return `<main class="screen">
  ${planSeg('chores')}
  <div class="head"><div><small>ふたりで分担</small><h1>やること</h1></div><div class="nav">${addBtn('choreNew', 'やることを追加')}</div></div>
  ${chips}
  <section class="card list"><h2 class="group-title">今日やること(残り${due.filter(c => c.last_done !== t).length})</h2>
    ${due.length ? due.map(choreRow).join('') : '<p class="muted" style="margin:0 0 10px">今日やることはありません</p>'}</section>
  <section class="card list"><h2 class="group-title">これから・くり返し</h2>
    ${rest.length ? rest.map(choreRow).join('') : `<p class="muted" style="margin:0 0 10px">${all.length ? 'ありません' : '右上の「＋」から、ゴミ出し・掃除・手続きなどを登録してください'}</p>`}</section>
  ${fin.length ? `<section class="card list"><button class="group-title plain fold" data-act="choreDoneFold" aria-expanded="${!!open}">完了したもの・お休み中(${fin.length}) ${ic(open ? 'up' : 'down')}</button>
    ${open ? fin.slice(0, 30).map(choreRow).join('') + '<p class="muted hint" style="margin:4px 0 8px;font-size:0.8125rem">チェックを外すと未完了に戻ります(復活)。「お休み中」はくり返しを終えたものです。</p>' : ''}</section>` : ''}
</main>`;
}
// 追加と修正で共通の入力欄
function choreFields(c) {
  const o = (v, l) => `<option value="${v}" ${(c?.freq || 'once') === v ? 'selected' : ''}>${l}</option>`;
  const wd = (c?.weekdays || '').split(',');
  const scope = canPrivChore(c) ? field('chScope', '見せる範囲', `<select id="chScope"><option value="shared">ふたりに見せる</option><option value="private" ${c?.is_private ? 'selected' : ''}>自分だけ(相手には見えません)</option></select>`)
    : '<p class="muted hint" style="margin:0;font-size:0.8125rem">相手が登録したものなので、見せる範囲は相手だけが変えられます。</p>';
  return `${field('chName', '名前', `<input id="chName" type="text" maxlength="40" placeholder="例：燃えるゴミ出し・車検の予約" value="${C.esc(c?.name || '')}">`)}
    ${scope}
    <fieldset class="chips"><legend>分類</legend>${TODO_CATS.map(k => `<label><input type="radio" name="chCat" value="${k}" ${(c?.category || C.st.choreCat || '家事') === k ? 'checked' : ''}><span>${k}</span></label>`).join('')}</fieldset>
    <div class="two">${field('chWho', '担当', `<select id="chWho">${memberOpts(c?.assignee || null, '決めない')}</select>`)}${field('chFreq', 'くり返し', `<select id="chFreq">${o('once', '1回だけ')}${o('daily', '毎日')}${o('weekly', '毎週')}${o('monthly', '月1回')}</select>`)}</div>
    <fieldset class="chips wds"><legend>曜日(毎週のとき。選ばなければ週1回)</legend>${[...W].map((w, i) => `<label><input type="checkbox" name="wd" value="${i}" ${wd.includes(String(i)) ? 'checked' : ''}><span>${w}</span></label>`).join('')}</fieldset>
    ${field('chDue', '期限(1回だけのとき。なくてもよい)', `<input id="chDue" type="date" value="${c?.due || ''}">`)}`;
}
function choreFormHtml() {
  return sheetWrap('やることを追加', `<form class="stack" data-form="chore" novalidate>${choreFields(null)}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">追加する</button>${closeBtn('やめる')}</form>`);
}
function choreSheetHtml() {
  const s = C.st.sheet, c = C.st.chores.find(x => x.id === s.id); if (!c) return '';
  const once = c.freq === 'once';
  const state = c.archived ? `<button class="btn" data-act="choreRevive" data-id="${c.id}">復活させる(くり返しを再開)</button>`
    : once && c.last_done ? `<button class="btn" data-act="choreRevive" data-id="${c.id}">復活させる(未完了に戻す)</button>`
    : once ? '' : `<button class="btn" data-act="choreArchive" data-id="${c.id}">くり返しを終える(お休みにする)</button>`;
  return sheetWrap(`「${C.esc(c.name)}」を直す`, `<p class="muted" style="margin:0">${c.archived ? 'お休み中' : freqText(c)}${c.last_done ? '・' + (once ? '完了 ' : '前回 ') + md(c.last_done) : '・まだやっていません'}</p>
    <form class="stack" data-form="choreEdit" novalidate>${choreFields(c)}
    <p class="muted hint" style="margin:0;font-size:0.8125rem">「1回だけ」を「毎週」などに変えると、くり返しのやることになります(固定化)。</p>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">保存する</button></form>
    ${state}
    ${s.confirm ? '<button class="btn danger" data-act="choreDelYes">本当に削除する(7日間はゴミ箱から戻せます)</button>' : '<button class="btn danger" data-act="choreDel">削除する</button>'}${closeBtn()}`);
}

// ---------- シート(下から出る画面) ----------
export function sheetHtml() {
  const t = C.st.sheet?.type;
  return ({ evNew: evFormHtml, ev: evSheetHtml, choreNew: choreFormHtml, chore: choreSheetHtml, txNew: txFormHtml, tx: txSheetHtml, goalAdd: goalAddHtml, confirm: confirmHtml, bulk: bulkHtml, rcpt: rcptHtml, info: infoHtml, quick: quickHtml, fix: fixSheetHtml, deadline: deadlineHtml, paper: paperHtml }[t] || (() => ''))();
}
function openSheet(s) { C.st.sheet = { form: true, ...s }; C.render(); }

// ---------- 入力の送信 ----------
export async function onSubmit(f) {
  const { st, run } = C, me = st.me;
  if (f === 'ev') {
    const title = val('evTitle'), date = val('evDate');
    if (!title || !date) return err('タイトルと日付を入れてください');
    const d = dt(date), rep = val('evRep'), editId = st.sheet.edit, old = editId && st.events.find(x => x.id === editId);
    const base = st.sheet.base && st.events.find(x => x.id === st.sheet.base), day = st.sheet.day;
    const rule = rep === 'weekly' ? 'weekly:' + d.getDay() : rep === 'monthly' ? 'monthly:' + d.getDate() : null;
    const rm = val('evRemind');
    const row = { date, time: val('evTime') || null, end_time: val('evEnd') || null, title, for_user: val('evFor') || null, repeat_rule: rule, remind_min: rm === '' ? null : Number(rm) };
    const canPriv = !old || old.created_by === me.user_id, priv = canPriv ? chk('evPriv') : old.is_private;
    if (canPriv) row.is_private = priv;
    if (base) {   // この日だけ変更:1回分の予定を作り、元のくり返しのその日を休みにする
      await run(sb().from('events').insert({ household_id: h(), ...row, repeat_rule: null, series_id: base.id }));
      await run(sb().from('events').update({ exdates: [...new Set([...(base.exdates || []), day])] }).eq('id', base.id), `${md(day)}の回だけ変えました`);
      if (!priv) activity(`${me.display_name}さんが予定「${base.title}」の${md(day)}の回を変更しました`);
      st.sheet = null; st.cal = { y: d.getFullYear(), m: d.getMonth(), sel: date }; await reloadEvents(); C.render(); return true;
    }
    if (old) await run(sb().from('events').update(row).eq('id', editId), '予定を直しました');
    else await run(sb().from('events').insert({ household_id: h(), ...row }), '予定を追加しました');
    if (!priv && (!old || old.is_private)) activity(`${me.display_name}さんが予定「${title}」(${md(date)})を${old ? '共有' : '追加'}しました`);
    else if (!priv && old) activity(`${me.display_name}さんが予定「${title}」(${md(date)})を変更しました`);
    st.sheet = null; st.cal = { y: d.getFullYear(), m: d.getMonth(), sel: date }; await reloadEvents(); C.render(); return true;
  }
  if (f === 'cmt') {
    const body = val('cmtBody'); if (!body) return true;
    const s = st.sheet, e = st.events.find(x => x.id === s.id);
    await run(sb().from('event_comments').insert({ household_id: h(), event_id: s.id, body }));
    if (e && !e.is_private) activity(`${me.display_name}さんが予定「${e.title}」にコメントしました`);
    s.comments = await run(sb().from('event_comments').select('*').eq('event_id', s.id).order('created_at')); C.render(); return true;
  }
  if (f === 'search') { await doSearch(val('q')); C.render(); return true; }
  if (f === 'deadline') {
    const name = val('dlName'), date = val('dlDate'), before = Number(val('dlBefore')) || 0, k = DL_KINDS.find(x => x[0] === val('dlKind')) || DL_KINDS[2];
    if (!name || !date) return err('名前と期限日を入れてください');
    const due = new Date(dt(date).getTime() - before * 864e5), priv = val('dlScope') === 'private';
    await run(sb().from('chores').insert({ household_id: h(), name: `【${k[2]}】${name}(${date.replaceAll('-', '/')}まで)`.slice(0, 40), category: k[0] === 'renew' ? 'お金' : '用事・手続き',
      freq: 'once', due: ymd(due), is_private: priv, created_by: me.user_id }), `${md(ymd(due))}に「やること」に出します`);
    st.sheet = null; await reloadChores(); C.render(); return true;
  }
  if (f === 'paper') {
    const rows = [...document.querySelectorAll('.prow')].filter(r => r.querySelector('.pon').checked).map(r => ({
      type: r.querySelector('.ptype').value, title: r.querySelector('.ptitle').value.trim(), date: r.querySelector('.pdate').value, time: r.querySelector('.ptime').value || null,
      end_time: r.dataset.end || null, note: r.dataset.note || null })).filter(x => x.title && x.date);
    if (!rows.length) return err('登録するものに印を付けてください');
    const priv = val('ppScope') === 'private';
    for (const x of rows) {
      if (x.type === 'event') {
        const id = crypto.randomUUID();   // 先に番号を決めて、メモを同じ予定に付ける
        const { error } = await sb().from('events').insert({ id, household_id: h(), date: x.date, time: x.time, end_time: x.end_time, title: x.title.slice(0, 80), for_user: st.me.user_id, is_private: priv });
        if (error) { C.toast('登録できませんでした:' + error.message); continue; }
        if (x.note) await sb().from('event_comments').insert({ household_id: h(), event_id: id, body: ('メモ:' + x.note).slice(0, 300) });
      } else await run(sb().from('chores').insert({ household_id: h(), name: x.title.slice(0, 40), category: '用事・手続き', freq: 'once', due: x.date, is_private: priv, created_by: me.user_id }));
    }
    const ne = rows.filter(x => x.type === 'event').length, nt = rows.length - ne;
    if (!priv && ne) activity(`${me.display_name}さんが紙のお知らせから予定を${ne}件追加しました`);
    C.toast(`予定${ne}件・やること${nt}件を登録しました`);
    st.sheet = null; await Promise.all([reloadEvents(), reloadChores()]); C.render(); return true;
  }
  if (f === 'chore' || f === 'choreEdit') {
    const name = val('chName'); if (!name) return err('名前を入れてください');
    const freq = val('chFreq'), wds = [...document.querySelectorAll('input[name=wd]:checked')].map(x => x.value).join(',');
    const row = { name, category: document.querySelector('input[name=chCat]:checked')?.value || '家事', assignee: val('chWho') || null, freq, weekdays: freq === 'weekly' && wds ? wds : null, due: freq === 'once' ? val('chDue') || null : null };
    const old = f === 'choreEdit' && st.chores.find(x => x.id === st.sheet.id);
    if (document.getElementById('chScope')) row.is_private = val('chScope') === 'private';
    if (old) {
      if (old.freq === 'once' && freq !== 'once' && old.last_done && old.last_done !== today()) row.last_done = null;   // 固定化:完了済みの1回だけを、くり返しとして始め直す
      await run(sb().from('chores').update(row).eq('id', old.id), '直しました');
      if (!(row.is_private ?? old.is_private)) activity(`${me.display_name}さんがやること「${name}」を変更しました`);
    } else {
      await run(sb().from('chores').insert({ household_id: h(), ...row, created_by: me.user_id }), 'やることを追加しました');
      if (!row.is_private) activity(`${me.display_name}さんがやること「${name}」を追加しました`);
    }
    st.sheet = null; await reloadChores(); C.render(); return true;
  }
  if (f === 'tx') {
    const amount = toNum(val('txAmt')), date = val('txDate'), category = document.querySelector('input[name=cat]:checked')?.value;
    if (!amount) return err('金額を入れてください');
    if (!date || !category) return err('日付と分類を選んでください');
    const editId = st.sheet?.edit, old = editId && st.tx.find(x => x.id === editId);
    const scope = document.getElementById('txScope') ? val('txScope') : old.scope, shop = val('txShop') || null;
    const kind = INCOME_CATS.includes(category) ? 'income' : 'expense', ib0 = st.sheet?.inbox && st.inbox.find(x => x.id === st.sheet.inbox);
    const sr = document.getElementById('txSplit') ? readSplit('txSplit', amount) : { split: old?.split ?? null }; if (sr.err) return err(sr.err);
    const split = scope === 'shared' && kind !== 'income' ? sr.split : null, repaid_amount = kind !== 'income' && scope === 'shared' ? toNum(val('txRepaid')) || null : null;
    if (repaid_amount && repaid_amount > amount) return err('返してもらった額が支払いの金額より大きくなっています');
    if (split === 'deal' && !repaid_amount) return err('「返してもらった額で済ませる」のときは、返してもらった額を入れてください(0円なら払った人のおごりを選んでください)');
    const inboxId = st.sheet?.inbox, row = { date, amount, shop, category, paid_by: val('txWho') || me.user_id, scope, kind, split, repaid_amount, ...(ib0?.receipt_path ? { receipt_path: ib0.receipt_path } : {}) };
    if (old) { await run(sb().from('transactions').update(row).eq('id', editId), '記録を直しました');
      if (kind === 'expense' && shop && category !== old.category) await learnShop(shop, category);
      if (scope === 'shared' && kind !== 'income') activity(`${me.display_name}さんが家計簿の記録(${category} ${yen(amount)})を直しました`);
      st.sheet = null; st.kb.month = date.slice(0, 7); await loadTx(false); C.render(); return true; }
    await run(sb().from('transactions').insert({ household_id: h(), ...row }), kind === 'income' ? '収入を記録しました' : '記録しました');
    if (st.sheet?.miss) { await sb().from('card_misses').delete().eq('id', st.sheet.miss); st.misses = (st.misses || []).filter(m => m.id !== st.sheet.miss); }
    if (kind === 'expense' && shop) await learnShop(shop, category);   // 次から、このお店はこの分類に
    if (inboxId) { await run(sb().from('card_inbox').update({ status: 'recorded' }).eq('id', inboxId)); await reloadInbox(); }
    if (scope === 'shared' && kind !== 'income') activity(`${me.display_name}さんが家計簿に${category} ${yen(amount)}を記録しました`);
    st.sheet = null; st.kb.month = date.slice(0, 7); st.kb.tab = 'list'; await loadTx(true); C.render(); return true;
  }
  if (f === 'rcpt') {
    const i = st.inbox.find(x => x.id === st.sheet.id); if (!i) return true;
    const items = [...document.querySelectorAll('.irow')].map(r => ({ name: r.querySelector('.iname').value.trim() || '(品名なし)',
      price: toNum(r.querySelector('.iprice').value) * (/^\s*[-ー−－]/.test(r.querySelector('.iprice').value) ? -1 : 1), category: r.querySelector('.icat').value }));
    const scope = val('rcScope'), parts = splitByCategory(items, i.amount);
    if (!parts.length) return err('品目の金額を確かめてください');
    await run(sb().from('transactions').insert(parts.map(p => ({ household_id: h(), date: inboxDate(i), amount: p.amount, shop: i.merchant, category: p.category,
      paid_by: val('rcWho') || me.user_id, scope, items: p.items, receipt_path: i.receipt_path || null }))));
    await run(sb().from('card_inbox').update({ status: 'recorded' }).eq('id', i.id), `${parts.length}つの分類に分けて記録しました`);
    if (scope === 'shared') activity(`${me.display_name}さんが家計簿に${i.merchant} ${yen(i.amount)}を記録しました`);
    st.sheet = null; await Promise.all([loadTx(true), reloadInbox()]); C.render(); return true;
  }
  if (f === 'bulk') {
    const ib = st.inbox || [], scope = val('bkScope') || 'private';
    if (!ib.length) { st.sheet = null; C.render(); return true; }
    await run(sb().from('transactions').insert(ib.flatMap(i => i.items?.length
      ? splitByCategory(i.items, i.amount).map(p => ({ household_id: h(), date: inboxDate(i), amount: p.amount, shop: i.merchant, category: p.category, paid_by: me.user_id, scope, items: p.items, receipt_path: i.receipt_path || null }))
      : [{ household_id: h(), date: inboxDate(i), amount: i.amount, shop: i.merchant || null, category: catFor(i), paid_by: me.user_id, scope }])));
    await run(sb().from('card_inbox').update({ status: 'recorded' }).in('id', ib.map(i => i.id)), `${ib.length}件を記録しました`);
    if (scope === 'shared') activity(`${me.display_name}さんがカード利用${ib.length}件を家計簿に記録しました`);
    st.sheet = null; await Promise.all([loadTx(true), reloadInbox()]); C.render(); return true;
  }
  if (f === 'fix' || f === 'fixEdit') {
    const p = f === 'fix' ? 'fx' : 'fe', name = val(p + 'Name'), amount = toNum(val(p + 'Amt')); if (!name || !amount) return err('名前と金額を入れてください');
    const cycle = val(p + 'Cyc') === 'yearly' ? 'yearly' : 'monthly';
    const row = { name, amount, category: val(p + 'Cat'), paid_by: val(p + 'Who') || me.user_id, active: val(p + 'Rec') !== 'off', pay_day: Number(val(p + 'Day')) || 1,
      cycle, pay_month: cycle === 'yearly' ? Number(val(p + 'Mon')) || 1 : null };
    const hasScope = !!document.getElementById(p + 'Scope'); if (hasScope) row.scope = val(p + 'Scope');
    if (f === 'fix') await run(sb().from('fixed_costs').insert({ household_id: h(), ...row, owner: me.user_id }), '固定費を追加しました');
    else {
      const id = st.sheet.id, old = st.fixed.find(x => x.id === id);
      await run(sb().from('fixed_costs').update(row).eq('id', id), '固定費を直しました');
      if (hasScope && row.scope !== old.scope)   // これまでの記録も同じ範囲にそろえる(うっかり見えたままを防ぐ)
        await run(sb().from('transactions').update(row.scope === 'private' ? { scope: 'private', owner: me.user_id } : { scope: 'shared' }).eq('fixed_cost_id', id));
      st.sheet = null;
    }
    await loadFeatures(); C.render(); return true;
  }
  if (f === 'budget') {
    const rows = [];
    for (const [i, c] of CATS.entries()) { const r = readSplit('bs' + i); if (r.err) return err(`${c}:${r.err}`); rows.push({ household_id: h(), category: c, amount: toNum(val('bg' + i)) || 0, split: r.split || 'equal' }); }
    const keep = rows.filter(r => r.amount > 0 || r.split !== 'equal'), drop = rows.filter(r => !r.amount && r.split === 'equal').map(r => r.category);
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
    case 'calDay': { const [y, m] = el.dataset.d.split('-').map(Number); st.cal = { y, m: m - 1, sel: el.dataset.d }; C.render(); return true; }
    case 'calWeek': try { localStorage.setItem(WS_KEY, el.dataset.v); } catch {} C.toast(el.dataset.v === '1' ? 'カレンダーを月曜始まりにしました' : 'カレンダーを日曜始まりにしました'); C.render(); return true;
    case 'calYear': if (st.cal.view === 'year') st.cal.view = null; else { st.cal.view = 'year'; st.cal.yy = st.cal.y; } C.render(); window.scrollTo(0, 0); return true;
    case 'calYearMove': { const n = Number(el.dataset.n); st.cal.yy = n ? st.cal.yy + n : new Date().getFullYear(); C.render(); return true; }
    case 'calPick': { const [y, m] = el.dataset.d.split('-').map(Number); st.cal = { y, m: m - 1, sel: el.dataset.d }; C.render(); window.scrollTo(0, 0); return true; }
    case 'calMove': {
      calShift(Number(el.dataset.n)); C.render(); return true;
    }
    case 'evNew': openSheet({ type: 'evNew' }); return true;
    case 'quickAdd': openSheet({ type: 'quick' }); return true;
    case 'quickGo': {   // 真ん中の「＋」から:その画面へ移ってから入力を開く
      const go = { ev: ['calendar', { type: 'evNew' }], todo: ['chores', { type: 'choreNew' }], tx: ['kakeibo', { type: 'txNew' }], inc: ['kakeibo', { type: 'txNew', kind: 'income' }], shop: ['shopping', null] }[el.dataset.to];
      if (!go) return true;
      const [r, sh] = go, next = sh ? { form: true, ...sh } : null;
      if (r === 'shopping') st.keepFocus = true;
      if (route() === r) { st.sheet = next; C.render(); } else { st.nextSheet = next; location.hash = '#' + r; }
      return true;
    }
    case 'evOpen': {
      st.sheet = { type: 'ev', id, comments: null, form: true, day: route() === 'calendar' ? st.cal.sel : today() }; C.render();
      const cm = await run(sb().from('event_comments').select('*').eq('event_id', id).order('created_at'));
      if (st.sheet?.id === id) { st.sheet.comments = cm; C.render(); } return true;
    }
    case 'evEdit': openSheet({ type: 'evNew', edit: st.sheet.id }); return true;
    case 'evOnly': openSheet({ type: 'evNew', base: st.sheet.id, day: st.sheet.day }); return true;
    case 'evSkip': case 'evUnskip': {
      const e = st.events.find(x => x.id === st.sheet.id), d0 = act === 'evSkip' ? st.sheet.day : el.dataset.d; if (!e) return true;
      const ex = act === 'evSkip' ? [...new Set([...(e.exdates || []), d0])] : (e.exdates || []).filter(x => x !== d0);
      await run(sb().from('events').update({ exdates: ex }).eq('id', e.id), act === 'evSkip' ? `${md(d0)}の回を休みにしました` : `${md(d0)}の回を元に戻しました`);
      if (act === 'evUnskip') {   // この日だけ変えた回があれば、二重にならないようゴミ箱へ
        const ov = st.events.filter(x => x.series_id === e.id && x.date === d0);
        for (const o of ov) await run(sb().from('events').update({ deleted_at: new Date().toISOString() }).eq('id', o.id));
      }
      if (!e.is_private) activity(`${me.display_name}さんが予定「${e.title}」の${md(d0)}の回を${act === 'evSkip' ? '休みに' : '元に戻'}しました`);
      if (act === 'evSkip') st.sheet = null; await reloadEvents(); C.render(); return true;
    }
    case 'evDel': st.sheet.confirm = true; C.render(); return true;
    case 'evShare': { const e = st.events.find(x => x.id === st.sheet.id); if (!e) return true;
      await run(sb().from('events').update({ is_private: !e.is_private }).eq('id', e.id), e.is_private ? 'ふたりに見せるようにしました' : '自分だけにしました');
      if (e.is_private) activity(`${me.display_name}さんが予定「${e.title}」(${md(e.date)})を共有しました`);
      await reloadEvents(); C.render(); return true; }
    case 'evDelYes': await run(sb().from('events').update({ deleted_at: new Date().toISOString() }).eq('id', st.sheet.id), 'ゴミ箱に移しました(7日間は「設定 → ゴミ箱」から戻せます)'); st.sheet = null; await reloadEvents(); C.render(); return true;
    case 'choreNew': openSheet({ type: 'choreNew' }); return true;
    case 'choreCat': st.choreCat = el.dataset.v; C.render(); return true;
    case 'choreDoneFold': st.choreDoneOpen = !st.choreDoneOpen; C.render(); return true;
    case 'choreArchive': await run(sb().from('chores').update({ archived: true }).eq('id', id), 'お休みにしました(「完了したもの・お休み中」から復活できます)');
      st.sheet = null; await reloadChores(); C.render(); return true;
    case 'choreRevive': { const c = st.chores.find(x => x.id === id);
      await run(sb().from('chores').update(c.archived ? { archived: false } : { last_done: null }).eq('id', id), '復活させました');
      if (st.sheet?.type === 'chore') st.sheet = null; await reloadChores(); C.render(); return true; }
    case 'choreOpen': openSheet({ type: 'chore', id }); return true;
    case 'choreDel': st.sheet.confirm = true; C.render(); return true;
    case 'choreDelYes': await run(sb().from('chores').update({ deleted_at: new Date().toISOString() }).eq('id', st.sheet.id), 'ゴミ箱に移しました(7日間は「設定 → ゴミ箱」から戻せます)'); st.sheet = null; await reloadChores(); C.render(); return true;
    case 'choreDone': {
      const c = st.chores.find(x => x.id === id); if (!c) return true;
      const t = today(), undo = c.last_done === t || (c.freq === 'once' && !!c.last_done);
      const next = undo ? (c.last_done === t ? st.choreUndo[id] ?? null : null) : t;
      if (!undo) st.choreUndo[id] = c.last_done;
      c.last_done = next; C.render();   // 先に画面を変えて、あとで保存
      if (!await C.send('chores', 'update', { last_done: next }, { id })) return true;   // 圏外なら、つながったら送る
      if (!undo && !c.is_private) activity(`${me.display_name}さんが「${c.name}」をやりました`);
      return true;
    }
    case 'kbTab': st.kb.tab = el.dataset.t; C.render(); return true;
    case 'kbMove': { const n = Number(el.dataset.n); st.kb.month = n ? shiftMonth(st.kb.month, n) : thisMonth(); await loadTx(true); C.render(); return true; }
    case 'txNew': openSheet({ type: 'txNew' }); return true;
    case 'txNewIncome': openSheet({ type: 'txNew', kind: 'income' }); return true;
    case 'missRec': { const m = (st.misses || []).find(x => x.id === id); if (!m) return true;
      openSheet({ type: 'txNew', miss: m.id, shop: m.merchant || '', date: ymd(new Date(m.used_at)) }); return true; }
    case 'welcomeDone': ls('kurashi.welcome', '1'); C.render(); return true;
    case 'welcomeAgain': ls('kurashi.welcome', null); location.hash = '#home'; return true;
    case 'textSet': try { localStorage.setItem('kurashi.text', el.dataset.v); } catch {} applyTheme(); C.render(); return true;
    case 'statusRun': st.status = { loading: true }; C.render(); await runStatus(); C.render(); return true;
    case 'missDel': await sb().from('card_misses').delete().eq('id', id); st.misses = (st.misses || []).filter(m => m.id !== id); C.render(); return true;
    case 'deadlineNew': {
      const src = el.dataset.from === 'tx' ? (st.tx || []).find(x => x.id === st.sheet.id) : (st.fixed || []).find(x => x.id === st.sheet.id); if (!src) return true;
      const tx = el.dataset.from === 'tx';
      st.sheet = { type: 'deadline', form: true, kind: tx ? 'warranty' : 'renew', name: tx ? (src.shop || src.category) : src.name,
        date: tx ? addYears(src.date, 1) : addYears(today(), 1), scope: src.scope === 'private' ? 'private' : 'shared' };
      C.render(); return true;
    }
    case 'txKind': {   // 支出と収入の切り替え(入力中の金額・内容・日付は残す)
      const s = st.sheet; Object.assign(s, { amt: val('txAmt'), shop: val('txShop'), date: val('txDate'), who: val('txWho'), kind: el.dataset.v, scope: undefined, cat: undefined });
      C.render(); return true;
    }
    case 'photoShow': {
      const { data, error } = await sb().storage.from('receipts').createSignedUrl(el.dataset.path, 600);
      if (error || !data?.signedUrl) { C.toast('写真を開けませんでした'); return true; }
      st.sheet.photo = data.signedUrl; C.render(); return true;
    }
    case 'txFromShop': st.nextSheet = { type: 'txNew', form: true, cat: '食費' }; st.kb.tab = 'list'; location.hash = '#kakeibo'; return true;
    case 'txOpen': openSheet({ type: 'tx', id }); return true;
    case 'txEdit': { const t = st.tx.find(x => x.id === st.sheet.id); if (!t) return true;
      openSheet({ type: 'txNew', edit: t.id, amt: t.amount, shop: t.shop || '', date: t.date, cat: t.category, who: t.paid_by, scope: t.scope }); return true; }
    case 'txDel': st.sheet.confirm = true; C.render(); return true;
    case 'txDelYes': await run(sb().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', st.sheet.id), 'ゴミ箱に移しました(7日間は「設定 → ゴミ箱」から戻せます)'); st.sheet = null; await loadTx(false); C.render(); return true;
    case 'settle': await run(sb().from('settlements').insert({ household_id: h(), month: st.kb.month }), '精算済みにしました');
      activity(`${me.display_name}さんが${monthLabel(st.kb.month)}の家計簿を精算済みにしました`); await loadFeatures(); C.render(); return true;
    case 'unsettle': await run(sb().from('settlements').delete().eq('household_id', h()).eq('month', st.kb.month), '取り消しました'); await loadFeatures(); C.render(); return true;
    case 'csv': csv(); return true;
    case 'inboxOpen': { const i = st.inbox.find(x => x.id === id); if (!i) return true;
      if (i.items?.length) { st.sheet = { type: 'rcpt', id, form: true, inbox: id }; C.render(); return true; }
      openSheet({ type: 'txNew', inbox: id, amt: i.amount, shop: i.merchant || '', date: inboxDate(i), cat: catFor(i), card: i.card }); return true; }
    case 'inboxBulk': openSheet({ type: 'bulk' }); return true;
    case 'inboxIgnore': await run(sb().from('card_inbox').update({ status: 'ignored' }).eq('id', st.sheet.inbox), '記録しないことにしました');
      st.sheet = null; await reloadInbox(); C.render(); return true;
    case 'themeSet': ls('kurashi.theme', el.dataset.v === 'auto' ? null : el.dataset.v); applyTheme(); C.render(); return true;
    case 'accentSet': ls('kurashi.accent', el.dataset.v || null); applyTheme(); C.render(); return true;
    case 'myColor': { const c = el.dataset.v, m = C.st.members.find(x => x.user_id === me.user_id);
      await run(sb().from('members').update({ color: c }).eq('user_id', me.user_id).eq('household_id', h()), 'あなたの色を変えました');
      if (m) m.color = c; applyTheme(); C.render(); return true; }
    case 'pushOn': await pushOn(); return true;
    case 'pushOff': await pushOff(); return true;
    case 'pushTest': { const { data, error } = await sb().functions.invoke('push', { body: { action: 'test' } });
      C.toast(error ? '送れませんでした' : data?.sent ? 'テスト通知を送りました(数秒で届きます)' : '送れませんでした。「通知を止める」→「受け取る」をやり直してください'); return true; }
    case 'notifyPref': { const k = el.dataset.k, v = el.checked; C.st.push.prefs[k] = v;
      await run(sb().from('notify_prefs').upsert({ user_id: me.user_id, [k]: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }), v ? '通知をオンにしました' : '通知をオフにしました'); return true; }
    case 'goEv': { const d0 = el.dataset.d, [y, m] = d0.split('-').map(Number); st.cal = { y, m: m - 1, sel: d0 }; location.hash = '#calendar'; return true; }
    case 'goTx': { st.kb.month = el.dataset.d.slice(0, 7); st.kb.tab = 'list'; await loadTx(false); st.nextSheet = { type: 'tx', id, form: true }; location.hash = '#kakeibo'; return true; }
    case 'goCh': st.choreCat = ''; st.nextSheet = { type: 'chore', id, form: true }; location.hash = '#chores'; return true;
    case 'goSh': location.hash = '#shopping'; return true;
    case 'goFx': st.kb.tab = 'fixed'; st.nextSheet = { type: 'fix', id, form: true }; location.hash = '#kakeibo'; return true;
    case 'trashBack': {
      await run(sb().from(el.dataset.t).update({ deleted_at: null }).eq('id', id), '元に戻しました');
      st.trash = null; await loadFeatures(); C.render(); return true;
    }
    case 'backupKey': case 'backupKeyRenew':
      st.backupKey = await run(sb().rpc('backup_token', { p_renew: act === 'backupKeyRenew' }), act === 'backupKeyRenew' ? '鍵を作り直しました。PCの「鍵.txt」も貼り直してください' : null); C.render(); return true;
    case 'widgetKey': case 'widgetKeyRenew': await loadWidget(act === 'widgetKeyRenew'); return true;
    case 'widgetCopy': try { await navigator.clipboard.writeText(widgetScript()); C.toast('コピーしました。Scriptableに貼り付けてください'); } catch { C.toast('コピーできませんでした。もう一度押してください'); } return true;
    case 'cardKey': case 'cardKeyRenew':
      st.cardKey = await run(sb().rpc('card_token', { p_renew: act === 'cardKeyRenew' }), act === 'cardKeyRenew' ? '鍵を作り直しました。ショートカットの鍵も入れ替えてください' : null); C.render(); return true;
    case 'copy': try { await navigator.clipboard.writeText(el.dataset.v); toast('コピーしました'); } catch { toast('コピーできませんでした。長押しで選んでください'); } return true;
    case 'fixOpen': openSheet({ type: 'fix', id }); return true;
    case 'fixUnmatch': await run(sb().from('card_inbox').update({ status: 'new', fixed_cost_id: null, nofix: true }).eq('id', id), '確認待ちに戻しました');
      await reloadInbox(); C.render(); return true;
    case 'fixToggle': { const f = st.fixed.find(x => x.id === id); await run(sb().from('fixed_costs').update({ active: !f.active }).eq('id', id)); await loadFeatures(); C.render(); return true; }
    case 'fixDel': { const f = st.fixed.find(x => x.id === id);
      openSheet({ type: 'confirm', id, yes: 'fixDelYes', title: `固定費「${C.esc(f.name)}」を削除しますか?`, note: 'これまでに記録した分は家計簿に残ります。消したものは7日間、「設定 → ゴミ箱」から戻せます。' }); return true; }
    case 'fixDelYes': await run(sb().from('fixed_costs').update({ deleted_at: new Date().toISOString() }).eq('id', id), 'ゴミ箱に移しました(7日間は「設定 → ゴミ箱」から戻せます)'); st.sheet = null; await loadFeatures(); C.render(); return true;
    case 'goalAdd': openSheet({ type: 'goalAdd', id }); return true;
    case 'goalDel': { const g = st.goals.find(x => x.id === id);
      openSheet({ type: 'confirm', id, yes: 'goalDelYes', title: `目標「${C.esc(g.name)}」を削除しますか?` }); return true; }
    case 'goalDelYes': await run(sb().from('goals').update({ deleted_at: new Date().toISOString() }).eq('id', id), 'ゴミ箱に移しました(7日間は「設定 → ゴミ箱」から戻せます)'); st.sheet = null; await loadFeatures(); C.render(); return true;
  }
  return false;
}
