// ふたりの暮らし帳 第2段階(予定・家事)と第3段階(家計簿)。2026-11-20
// app.js から道具(st・sb・run など)を受け取って動く。画面は文字列で作り、app.js の render() が表示する。
let C;
export function setup(ctx) {
  C = ctx;
  document.addEventListener('change', e => { if (e.target.id === 'rcptFile') readReceipts([...e.target.files]); });
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
// ---------- 見た目(テーマ・アクセントカラー・人の色) ----------
export const PALETTE = [['青', '#0A5BD3'], ['藍', '#3F51B5'], ['紫', '#7B3FC4'], ['桃', '#C2185B'], ['赤', '#C62828'], ['橙', '#C2570C'],
  ['茶', '#8D5524'], ['緑', '#1F7A4F'], ['青緑', '#00796B'], ['水色', '#0277A8'], ['灰', '#4A5568']];
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };
export function applyTheme() {
  const root = document.documentElement, theme = ls('kurashi.theme') || 'auto';
  if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
  root.style.setProperty('--accent', ls('kurashi.accent') || (C?.st?.me ? C.colorOf(C.st.me.user_id) : '') || '#0A5BD3');
  const dark = theme === 'dark' || (theme === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#F2F4F7');
}
// だれの情報か:人の色の丸と名前(担当なし・ふたりは緑)
export const who = (uid, none = 'ふたり') => uid ? `<span class="who" style="--c:${C.colorOf(uid)}"><i></i>${C.esc(C.nameOf(uid))}</span>` : `<span class="who pair"><i></i>${none}</span>`;
const edge = uid => `style="--c:${uid ? C.colorOf(uid) : SHARED_COLOR}"`;
export function appearanceSettingsHtml() {
  const { st } = C, theme = ls('kurashi.theme') || 'auto', acc = ls('kurashi.accent') || '', mine = C.colorOf(st.me.user_id);
  const th = (v, l) => `<button class="pill${theme === v ? ' on' : ''}" data-act="themeSet" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`;
  const sw = (act, v, name, cur, cls = '') => `<button class="swatch${cls}" style="--c:${v || mine}" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}" aria-label="${name}"></button>`;
  return `<section class="card stack"><h2>見た目</h2>
    <div class="field"><span class="muted" style="font-size:13px">明るさ</span><div class="nav" style="flex-wrap:wrap">${th('auto', 'iPhoneに合わせる')}${th('light', 'ライト')}${th('dark', 'ダーク')}</div></div>
    <div class="field"><span class="muted" style="font-size:13px">アクセントカラー(ボタンなどの色。この端末だけの設定です)</span>
      <div class="swatches">${sw('accentSet', '', '自分の色に合わせる', acc, ' auto')}${PALETTE.map(([n, c]) => sw('accentSet', c, n, acc)).join('')}</div></div>
    <div class="field"><span class="muted" style="font-size:13px">あなたの色(だれの情報かを示す印。相手の画面でも、あなたの予定・記録にこの色が付きます)</span>
      <div class="swatches">${PALETTE.filter(([n]) => n !== '緑').map(([n, c]) => sw('myColor', c, n, mine)).join('')}</div>
      <p class="muted" style="margin:0;font-size:13px">緑は「ふたり」の印なので、人の色には使いません。</p></div></section>`;
}

const sb = () => C.sb();
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0, 7);
const W = '日月火水木金土';
const WS_KEY = 'kurashi.weekStart';
const weekStart = () => { try { return localStorage.getItem(WS_KEY) === '1' ? 1 : 0; } catch { return 0; } };
const wdClass = d => d === 0 ? ' sun' : d === 6 ? ' sat' : '';
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
    run(sb().from('events').select('*').eq('household_id', h()).is('deleted_at', null).order('date')),
    run(sb().from('chores').select('*').eq('household_id', h()).is('deleted_at', null).order('created_at')),
    run(sb().from('fixed_costs').select('*').eq('household_id', h()).is('deleted_at', null).order('name')),
    run(sb().from('budgets').select('*').eq('household_id', h())),
    run(sb().from('goals').select('*').eq('household_id', h()).is('deleted_at', null).order('name')),
    run(sb().from('settlements').select('*').eq('household_id', h())),
  ]);
  Object.assign(st, { events: ev, chores: ch, fixed: fx, budgets: bu, goals: go, settles: se });
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
        const mo = monthOf(i), ok = rec.filter(f => f.amount === i.amount && has.has(f.id + mo) && !taken.has(f.id + mo));
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
const infoFix = i => (C.st.fixed || []).find(f => !f.active && f.paid_by === C.st.me.user_id && f.amount === i.amount);
const catFor = i => infoFix(i)?.category || guessCat(i.merchant);
export async function reloadEvents() { C.st.events = await C.run(sb().from('events').select('*').eq('household_id', h()).is('deleted_at', null).order('date')); }
export async function reloadChores() { C.st.chores = await C.run(sb().from('chores').select('*').eq('household_id', h()).is('deleted_at', null).order('created_at')); }
export async function loadTx(withFixed) {
  const { st, run } = C, mo = st.kb.month;
  if (withFixed && mo === thisMonth()) await ensureFixed(mo);
  const [y, m] = mo.split('-').map(Number);
  st.tx = await run(sb().from('transactions').select('*').eq('household_id', h()).is('deleted_at', null).gte('date', mo + '-01').lt('date', ymd(new Date(y, m, 1)))
    .order('date', { ascending: false }).order('created_at', { ascending: false }));
}
// 固定費:その月を初めて開いたときに、1日付で記録する(同じ月に2回は入らない)
async function ensureFixed(mo) {
  const act = (C.st.fixed || []).filter(f => f.active); if (!act.length) return;
  await sb().from('transactions').upsert(act.map(f => ({ household_id: h(), date: mo + '-01', amount: f.amount, shop: f.name, category: f.category,
    paid_by: f.paid_by, fixed_cost_id: f.id, month: mo, ...(f.scope === 'private' ? { scope: 'private', owner: f.owner } : { scope: 'shared' }) })), { onConflict: 'fixed_cost_id,month', ignoreDuplicates: true });
}

// ---------- 予定 ----------
function occurs(e, ds) {
  if (ds < e.date || e.exdates?.includes(ds)) return false;
  if (!e.repeat_rule) return ds === e.date;
  const [kind, arg] = e.repeat_rule.split(':');
  if (kind === 'weekly') return arg.split(',').map(Number).includes(dt(ds).getDay());
  if (kind === 'monthly') return dt(ds).getDate() === Number(arg);
  return false;
}
export const eventsOn = ds => (C.st.events || []).filter(e => occurs(e, ds)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const evColor = e => e.for_user ? C.colorOf(e.for_user) : SHARED_COLOR;
const SRC = { google: 'Google', iphone: 'iPhone' };
const imported = e => e.source && e.source !== 'app';
const timeText = e => e.time ? e.time.slice(0, 5) + (e.end_time ? '〜' + e.end_time.slice(0, 5) : '') : '終日';
const repText = r => !r ? '' : r.startsWith('weekly') ? `毎週${r.split(':')[1].split(',').map(n => W[n]).join('・')}曜日` : `毎月${r.split(':')[1]}日`;
export const evRow = e => `<button class="row" data-act="evOpen" data-id="${e.id}" ${edge(e.for_user)}><span class="dot" style="background:${evColor(e)}"></span>
  <span class="main"><span class="name">${C.esc(e.title)}</span><span class="sub">${timeText(e)}・${who(e.for_user)}${e.repeat_rule ? '・くり返し' : ''}${imported(e) ? '・' + SRC[e.source] : ''}${e.is_private ? '・自分だけ' : ''}</span></span></button>`;

export function viewCalendar() {
  const { st } = C, { y, m, sel } = st.cal;
  const ws = weekStart(), lead = (new Date(y, m, 1).getDay() - ws + 7) % 7, days = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  let cells = '';
  for (let k = 0; k < total; k++) {
    const d = new Date(y, m, 1 - lead + k), ds = ymd(d), out = d.getMonth() !== m, evs = eventsOn(ds);
    cells += `<button class="day${out ? ' out' : ''}${wdClass(d.getDay())}${ds === sel ? ' sel' : ''}${ds === today() ? ' today' : ''}" data-act="calDay" data-d="${ds}" aria-label="${d.getMonth() + 1}月${d.getDate()}日、予定${evs.length}件">
      <span>${d.getDate()}</span><i>${evs.slice(0, 3).map(e => `<b style="background:${evColor(e)}"></b>`).join('')}</i></button>`;
  }
  if (st.cal.view === 'year') return viewYear();
  const list = eventsOn(sel);
  return `<main class="screen">
  <div class="head"><div><small>ふたりの予定</small><h1><button class="ttl" data-act="calYear" aria-label="${y}年${m + 1}月。押すと1年分の一覧">${y}年${m + 1}月<span class="caret">▾</span></button></h1></div>
    <div class="nav"><button class="pill" data-act="calMove" data-n="-1" aria-label="前の月">‹</button><button class="pill" data-act="calMove" data-n="0">今日</button><button class="pill" data-act="calMove" data-n="1" aria-label="次の月">›</button></div></div>
  <section class="card"><div class="cal">${[0, 1, 2, 3, 4, 5, 6].map(i => (i + ws) % 7).map(d => `<span class="wd${wdClass(d)}">${W[d]}</span>`).join('')}${cells}</div></section>
  <section class="card list"><h2 class="group-title">${md(sel)}の予定</h2>
    ${list.length ? list.map(evRow).join('') : '<p class="muted" style="margin:0 0 10px">予定はありません</p>'}</section>
  <button class="fab" data-act="evNew" aria-label="予定を追加">＋</button></main>`;
}

// 1年分の一覧:12か月の小さなカレンダー。予定のある日に印、押すとその日へ
function viewYear() {
  const { st } = C, yy = st.cal.yy, td = today();
  let months = '';
  for (let m = 0; m < 12; m++) {
    const start = (new Date(yy, m, 1).getDay() - weekStart() + 7) % 7, days = new Date(yy, m + 1, 0).getDate();
    let cells = '<span></span>'.repeat(start), cnt = 0;
    for (let d = 1; d <= days; d++) {
      const ds = `${yy}-${pad(m + 1)}-${pad(d)}`, has = eventsOn(ds).length > 0; if (has) cnt++;
      cells += `<button class="yd${has ? ' has' : ''}${ds === td ? ' today' : ''}" data-act="calPick" data-d="${ds}" aria-label="${m + 1}月${d}日${has ? '、予定あり' : ''}">${d}</button>`;
    }
    const cur = yy === st.cal.y && m === st.cal.m;
    months += `<div class="ym${cur ? ' cur' : ''}"><button class="ymt" data-act="calPick" data-d="${yy}-${pad(m + 1)}-01">${m + 1}月${cnt ? `<small>${cnt}日</small>` : ''}</button>
      <div class="ycal">${cells}</div></div>`;
  }
  return `<main class="screen">
  <div class="head"><div><small>ふたりの予定・1年分</small><h1><button class="ttl" data-act="calYear" aria-label="月の表示に戻る">${yy}年<span class="caret">▴</span></button></h1></div>
    <div class="nav"><button class="pill" data-act="calYearMove" data-n="-1" aria-label="前の年">‹</button><button class="pill" data-act="calYearMove" data-n="0">今年</button><button class="pill" data-act="calYearMove" data-n="1" aria-label="次の年">›</button></div></div>
  <p class="muted" style="margin:0;font-size:13px">月の名前を押すとその月へ、日を押すとその日の予定へ移ります。青い日は予定のある日です。</p>
  <section class="card"><div class="ygrid">${months}</div></section></main>`;
}

// 予定の追加・修正(s.edit があれば修正)。見せる範囲は件名のすぐ下に置き、うっかり共有を防ぐ
export const REMIND = [['', 'なし'], ['0', '予定の時刻'], ['10', '10分前'], ['30', '30分前'], ['60', '1時間前'], ['120', '2時間前'], ['1440', '前日の同じ時刻']];
function evFormHtml() {
  const { st, esc } = C, s = st.sheet, base = s.base ? st.events.find(x => x.id === s.base) : null;
  const e = s.edit ? st.events.find(x => x.id === s.edit) : base;   // 「この日だけ変更」は、元のくり返しの内容を下書きにする
  const mine = !e || e.created_by === st.me.user_id, rep = base ? '' : e?.repeat_rule ? e.repeat_rule.split(':')[0] : '';
  const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  const rmd = e?.remind_min == null ? '' : String(e.remind_min);
  return sheetWrap(base ? `${md(s.day)}だけ変更` : e ? (e.repeat_rule ? 'すべての回を直す' : '予定を直す') : '予定を追加', `<form class="stack" data-form="ev" novalidate>
    ${base ? `<p class="muted" style="margin:0;font-size:13px">くり返しの予定「${esc(base.title)}」の${md(s.day)}の回だけを変えます。ほかの回はそのままです。</p>` : ''}
    ${field('evTitle', 'タイトル', `<input id="evTitle" type="text" maxlength="80" placeholder="例：歯医者" value="${esc(e?.title || '')}">`)}
    ${mine ? `<label class="check"><input id="evPriv" type="checkbox" ${e?.is_private ? 'checked' : ''}> 自分だけに表示する(相手には見えません)</label>`
      : '<p class="muted" style="margin:0;font-size:13px">相手が登録した予定なので、見せる範囲は相手だけが変えられます。</p>'}
    <div class="two">${field('evDate', '日付', `<input id="evDate" type="date" value="${base ? s.day : e?.date || st.cal.sel}">`)}${field('evTime', '時刻(空なら終日)', `<input id="evTime" type="time" value="${e?.time ? e.time.slice(0, 5) : ''}">`)}</div>
    ${field('evEnd', '終わりの時刻(なくてもよい)', `<input id="evEnd" type="time" value="${e?.end_time ? e.end_time.slice(0, 5) : ''}">`)}
    ${field('evFor', 'だれの予定', `<select id="evFor">${memberOpts(e ? e.for_user : null, 'ふたり')}</select>`)}
    ${base ? '' : field('evRep', 'くり返し', `<select id="evRep">${opt('', 'なし', rep)}${opt('weekly', '毎週(同じ曜日)', rep)}${opt('monthly', '毎月(同じ日)', rep)}</select>`)}
    ${field('evRemind', 'お知らせ(時刻のある予定)', `<select id="evRemind">${REMIND.map(([v, l]) => opt(v, l, rmd)).join('')}</select>`)}
    <p class="muted" style="margin:-4px 0 0;font-size:13px">終日の予定は、朝7時と前日20時のまとめでお知らせします。</p>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">${e ? '保存する' : '追加する'}</button>${closeBtn('やめる')}</form>`);
}

function evSheetHtml() {
  const { st, esc } = C, s = st.sheet, e = st.events.find(x => x.id === s.id);
  if (!e) return '';
  const cm = s.comments;
  return sheetWrap(esc(e.title), `
    <p class="muted" style="margin:0">${md(s.day || e.date)} ${timeText(e)}・${e.for_user ? esc(C.nameOf(e.for_user)) : 'ふたり'}の予定${e.repeat_rule ? '・' + repText(e.repeat_rule) : ''}<br>${imported(e) ? `${SRC[e.source]}のカレンダー「${esc(e.calendar_name || '')}」から取り込み。内容は${SRC[e.source]}のカレンダーで直してください` : esc(C.nameOf(e.created_by)) + 'さんが登録'}</p>
    ${e.created_by === st.me.user_id ? `<div class="row" style="border:0;min-height:44px"><span class="main"><span class="name">${e.is_private ? '自分だけに見えています' : 'ふたりに見えています'}</span></span>
      <button class="pill ${e.is_private ? '' : 'go on'}" data-act="evShare">${e.is_private ? 'ふたりに見せる' : '自分だけにする'}</button></div>` : ''}
    <div class="comments">${cm === null ? '<p class="muted" style="margin:0">コメントを読み込み中…</p>' : cm.length ? cm.map(c => `<div class="cmt"><span class="dot" style="background:${C.colorOf(c.user_id)}"></span><div><b>${esc(C.nameOf(c.user_id))}</b> ${esc(c.body)}</div></div>`).join('') : '<p class="muted" style="margin:0">コメントはまだありません</p>'}</div>
    <form class="addrow" data-form="cmt"><label class="sr" for="cmtBody">コメント</label><input id="cmtBody" type="text" maxlength="300" placeholder="コメントを書く" autocomplete="off"><button class="plus" type="submit" aria-label="送る">↑</button></form>
    ${e.series_id && !imported(e) ? `<p class="muted" style="margin:0;font-size:13px">くり返しの予定「${esc(st.events.find(x => x.id === e.series_id)?.title || '')}」の、この日だけ変えた回です。</p>` : ''}
    ${imported(e) ? '' : e.repeat_rule ? `<div class="two"><button class="btn" data-act="evOnly">${md(s.day)}だけ変更</button><button class="btn" data-act="evSkip">${md(s.day)}だけ休み</button></div>
      <button class="btn" data-act="evEdit">すべての回を直す</button>
      ${(e.exdates || []).length ? `<div class="list"><p class="muted" style="margin:4px 0 0;font-size:13px">休み・変更にした日</p>${[...e.exdates].sort().map(x => `<div class="row"><span class="main"><span class="name">${md(x)}</span></span><button class="pill" data-act="evUnskip" data-d="${x}">元に戻す</button></div>`).join('')}</div>` : ''}`
      : '<button class="btn" data-act="evEdit">内容を直す</button>'}
    ${imported(e) ? '' : s.confirm ? `<button class="btn danger" data-act="evDelYes">本当に削除する${e.repeat_rule ? '(くり返しのすべての回)' : ''}(7日間はゴミ箱から戻せます)</button>` : `<button class="btn danger" data-act="evDel">${e.repeat_rule ? 'くり返しをすべて削除' : 'この予定を削除'}</button>`}
    ${closeBtn()}`);
}

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
export const TODO_CATS = ['家事', '用事・手続き', '買い物', '仕事', 'お金', '健康', 'その他'];
const freqText = c => ({ daily: '毎日', monthly: '月1回', once: '1回だけ' }[c.freq] || (c.weekdays ? '毎週' + c.weekdays.split(',').map(n => W[n]).join('・') : '週1回'));
const isFinished = c => c.archived || (c.freq === 'once' && c.last_done && c.last_done !== today());
const canPrivChore = c => !c || !c.created_by || c.created_by === C.st.me.user_id;
export function choreRow(c) {
  const t = today(), doneToday = c.last_done === t, fin = isFinished(c);
  const late = c.freq === 'once' && !c.last_done && c.due && c.due < t;
  const sub = [`<span class="ctag">${C.esc(c.category || '家事')}</span>`, who(c.assignee, '担当なし'), c.archived ? 'お休み中(' + freqText(c) + ')' : freqText(c),
    c.freq === 'once' && c.due && !c.last_done ? `<span${late ? ' style="color:var(--red);font-weight:700"' : ''}>期限 ${md(c.due)}${late ? ' 過ぎ' : ''}</span>` : '',
    c.last_done ? (c.freq === 'once' ? '完了 ' : '前回 ') + md(c.last_done) : '', c.is_private ? '自分だけ' : ''].filter(Boolean).join('・');
  const box = c.archived ? `<button class="pill" data-act="choreRevive" data-id="${c.id}">復活</button>`
    : `<button class="box" data-act="choreDone" data-id="${c.id}" aria-label="${C.esc(c.name)}を${doneToday || fin ? '未完了に戻す' : '完了にする'}" aria-pressed="${doneToday || fin}">${doneToday || fin ? '✓' : ''}</button>`;
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
  <div class="head"><div><small>ふたりで分担</small><h1>やること</h1></div></div>
  ${chips}
  <section class="card list"><h2 class="group-title">今日やること(残り${due.filter(c => c.last_done !== t).length})</h2>
    ${due.length ? due.map(choreRow).join('') : '<p class="muted" style="margin:0 0 10px">今日やることはありません</p>'}</section>
  <section class="card list"><h2 class="group-title">これから・くり返し</h2>
    ${rest.length ? rest.map(choreRow).join('') : `<p class="muted" style="margin:0 0 10px">${all.length ? 'ありません' : '「＋」から、ゴミ出し・掃除・手続きなどを登録してください'}</p>`}</section>
  ${fin.length ? `<section class="card list"><button class="group-title plain fold" data-act="choreDoneFold" aria-expanded="${!!open}">完了したもの・お休み中(${fin.length}) ${open ? '▴' : '▾'}</button>
    ${open ? fin.slice(0, 30).map(choreRow).join('') + '<p class="muted" style="margin:4px 0 8px;font-size:13px">✓を押すと未完了に戻ります(復活)。「お休み中」はくり返しを終えたものです。</p>' : ''}</section>` : ''}
  <button class="fab" data-act="choreNew" aria-label="やることを追加">＋</button></main>`;
}
// 追加と修正で共通の入力欄
function choreFields(c) {
  const o = (v, l) => `<option value="${v}" ${(c?.freq || 'once') === v ? 'selected' : ''}>${l}</option>`;
  const wd = (c?.weekdays || '').split(',');
  const scope = canPrivChore(c) ? field('chScope', '見せる範囲', `<select id="chScope"><option value="shared">ふたりに見せる</option><option value="private" ${c?.is_private ? 'selected' : ''}>自分だけ(相手には見えません)</option></select>`)
    : '<p class="muted" style="margin:0;font-size:13px">相手が登録したものなので、見せる範囲は相手だけが変えられます。</p>';
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
    <p class="muted" style="margin:0;font-size:13px">「1回だけ」を「毎週」などに変えると、くり返しのやることになります(固定化)。</p>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">保存する</button></form>
    ${state}
    ${s.confirm ? '<button class="btn danger" data-act="choreDelYes">本当に削除する(7日間はゴミ箱から戻せます)</button>' : '<button class="btn danger" data-act="choreDel">削除する</button>'}${closeBtn()}`);
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
  return `<section class="card list"><h2 class="group-title">カード利用・レシートの確認待ち(${ib.length})</h2>
    <p class="muted" style="margin:0 0 4px;font-size:13px">押して分類を選ぶと家計簿に入ります。家計簿に入れないもの(仕事・アパートの分など)は「記録しない」を選んでください。自分にだけ見えています。</p>
    <button class="btn" style="margin:4px 0" data-act="inboxBulk">推測の分類のまま、まとめて記録(${ib.length}件)</button>
    ${ib.map(i => `<button class="row" data-act="inboxOpen" data-id="${i.id}"><span class="main"><span class="name">${esc(i.merchant || '(お店の名前なし)')}</span>
      <span class="sub">${md(inboxDate(i))}・${esc(i.card || 'カード')}${i.items ? `・品目${i.items.length}件(${catsOf(i).join('・')})` : '・推測:' + catFor(i)}${!i.items && infoFix(i) ? `・固定費「${esc(infoFix(i).name)}」と同じ金額` : ''}</span>
      ${i.note ? `<span class="sub" style="color:var(--red)">${esc(i.note)}</span>` : ''}</span><b>${yen(i.amount)}</b></button>`).join('')}</section>`;
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
  return `<section class="card" style="padding:12px 16px"><label class="btn green" style="display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">
      📷 レシートを読み込む<input id="rcptFile" type="file" accept="image/*" multiple hidden></label>
    <p class="muted" style="margin:0;font-size:12px">撮影するか、写真を何枚か選ぶと、品目ごとに読み取って「確認待ち」に入れます(読み取りはGoogleのGeminiを使います)。</p></section>
  ${inboxHtml()}<section class="card"><div class="sum"><div><small>ふたりの支出</small><b>${yen(total)}</b></div><div><small>自分だけの支出</small><b>${yen(priv)}</b></div></div>
    ${byCat.map(x => `<div class="bar"><span>${x.c}</span><span>${yen(x.spent)}${x.budget ? ' / ' + yen(x.budget) : ''}</span>
      ${x.budget ? `<i><b style="width:${Math.min(100, x.spent / x.budget * 100)}%;background:${x.spent > x.budget ? 'var(--red)' : 'var(--blue)'}"></b></i>` : ''}</div>`).join('')}
  </section>
  ${settleHtml}
  <section class="card list"><h2 class="group-title">記録(${tx.length}件)</h2>
    ${days.length ? days.map(d => `<h3 class="day-title">${md(d)}</h3>` + tx.filter(t => t.date === d).map(t => `<button class="row" data-act="txOpen" data-id="${t.id}" ${edge(t.paid_by)}>
      <span class="dot" style="background:${C.colorOf(t.paid_by)}"></span><span class="main"><span class="name">${esc(t.shop || t.category)}</span>
      <span class="sub">${t.category}・${who(t.paid_by)}が払った${t.scope === 'private' ? '・自分だけ' : ''}${t.fixed_cost_id ? '・固定費' : ''}</span></span><b>${yen(t.amount)}</b></button>`).join('')).join('')
      : '<p class="muted" style="margin:0 0 10px">この月の記録はまだありません</p>'}
    ${tx.length ? '<button class="btn text" data-act="csv">この月をCSVで書き出す</button>' : ''}</section>
  <button class="fab" data-act="txNew" aria-label="支出を記録">＋</button>`;
}
function txFormHtml() {
  const { st, esc } = C, s = st.sheet, def = s.cat || '食費', t = s.edit ? (st.tx || []).find(x => x.id === s.edit) : null;
  const date = s.date || (st.kb.month === thisMonth() ? today() : st.kb.month + '-01');
  const mine = !t || t.owner === st.me.user_id, scope = s.scope || 'shared';
  const sc = (v, l) => `<option value="${v}" ${v === scope ? 'selected' : ''}>${l}</option>`;
  return sheetWrap(t ? '記録を直す' : s.inbox ? 'カード利用を家計簿に記録' : '支出を記録', `<form class="stack" data-form="tx" novalidate>
    ${mine ? field('txScope', '見せる範囲', `<select id="txScope">${sc('shared', 'ふたりの支出(精算の対象)')}${sc('private', '自分だけ(相手には見えません)')}</select>`)
      : '<p class="muted" style="margin:0;font-size:13px">相手が記録した支出なので、見せる範囲は相手だけが変えられます。</p>'}
    ${s.inbox ? `<p class="muted" style="margin:0">${esc(s.card || 'カード')}で払った分です。</p>` : ''}
    ${field('txAmt', '金額(円)', `<input id="txAmt" type="text" inputmode="numeric" maxlength="9" placeholder="例：1280" value="${s.amt || ''}">`)}
    <fieldset class="chips"><legend>分類</legend>${CATS.map(c => `<label><input type="radio" name="cat" value="${c}" ${c === def ? 'checked' : ''}><span>${c}</span></label>`).join('')}</fieldset>
    ${field('txShop', 'お店・内容(なくてもよい)', `<input id="txShop" type="text" maxlength="40" placeholder="例：スーパー" value="${esc(s.shop || '')}">`)}
    <div class="two">${field('txDate', '日付', `<input id="txDate" type="date" value="${date}">`)}${field('txWho', '払った人', `<select id="txWho">${memberOpts(s.who || st.me.user_id)}</select>`)}</div>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">${t ? '保存する' : '記録する'}</button>
    ${s.inbox ? '<button class="btn" type="button" data-act="inboxIgnore">家計簿に記録しない(仕事・アパートの分など)</button>' : ''}${closeBtn('やめる')}</form>`);
}
function txSheetHtml() {
  const { st, esc } = C, s = st.sheet, t = (st.tx || []).find(x => x.id === s.id); if (!t) return '';
  return sheetWrap(`${esc(t.shop || t.category)} ${yen(t.amount)}`, `<p class="muted" style="margin:0">${md(t.date)}・${t.category}・${esc(C.nameOf(t.paid_by))}が払った・${t.scope === 'private' ? '自分だけ' : 'ふたりの支出'}</p>
    ${t.items?.length ? `<div class="items">${t.items.map(x => `<div class="irow ro"><span>${esc(x.name)}</span><span>${yen(x.price)}</span></div>`).join('')}</div>` : ''}
    <button class="btn" data-act="txEdit">内容を直す</button>
    ${t.fixed_cost_id ? '<p class="muted" style="margin:0">固定費から自動で記録したものです。この月の分は「内容を直す」で直せます。毎月の金額や記録の停止は「固定費」で変えてください。</p>'
      : s.confirm ? '<button class="btn danger" data-act="txDelYes">本当に削除する(7日間はゴミ箱から戻せます)</button>' : '<button class="btn danger" data-act="txDel">この記録を削除</button>'}${closeBtn()}`);
}
// 固定費の入力欄(追加と修正で共通。p は id の頭文字)
function fxFields(p, f) {
  const { st, esc } = C, me = st.me.user_id, mine = !f || f.owner === me;
  const o = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return `<div class="two">${field(p + 'Name', '名前', `<input id="${p}Name" type="text" maxlength="30" placeholder="例：家賃" value="${esc(f?.name || '')}">`)}${field(p + 'Amt', '金額(円)', `<input id="${p}Amt" type="text" inputmode="numeric" maxlength="9" placeholder="例：73000" value="${f?.amount || ''}">`)}</div>
    <div class="two">${field(p + 'Cat', '分類', `<select id="${p}Cat">${CATS.map(c => o(c, f?.category, c)).join('')}</select>`)}${field(p + 'Who', '払う人', `<select id="${p}Who">${memberOpts(f?.paid_by || me)}</select>`)}</div>
    ${field(p + 'Rec', '家計簿への記録', `<select id="${p}Rec">${o('on', f && !f.active ? 'off' : 'on', '毎月1日に自動で記録する')}${o('off', f && !f.active ? 'off' : 'on', '記録しない(金額を把握するだけ)')}</select>`)}
    ${mine ? field(p + 'Scope', '見せる範囲', `<select id="${p}Scope">${o('shared', f?.scope || 'shared', 'ふたりに見せる')}${o('private', f?.scope || 'shared', '自分だけ(相手には見えません)')}</select>`)
      : '<p class="muted" style="margin:0;font-size:13px">相手が登録した固定費なので、見せる範囲は相手だけが変えられます。</p>'}`;
}
function kbFixed() {
  const { st, esc } = C, fx = st.fixed || [], sum = a => a.reduce((x, f) => x + f.amount, 0);
  const rec = fx.filter(f => f.active), info = fx.filter(f => !f.active), mt = st.fixMatched || [];
  const row = f => `<button class="row" data-act="fixOpen" data-id="${f.id}" ${edge(f.paid_by)}><span class="main"><span class="name">${esc(f.name)}</span>
    <span class="sub">${f.category}・${who(f.paid_by)}が払う${f.scope === 'private' ? '・自分だけ' : ''}</span></span><b>${yen(f.amount)}</b></button>`;
  const group = (title, list, empty) => `<h3 class="sub-title">${title}(${list.length}件・${yen(sum(list))})</h3>
    ${list.length ? list.map(row).join('') : `<p class="muted" style="margin:0 0 8px;font-size:13px">${empty}</p>`}`;
  const fname = id => fx.find(f => f.id === id)?.name || '(削除した固定費)';
  return `<section class="card"><div class="sum"><div><small>毎月の固定費</small><b>${yen(sum(fx))}</b></div><div><small>うち家計簿に記録</small><b>${yen(sum(rec))}</b></div></div></section>
  <section class="card list">${group('毎月1日に自動で記録', rec, '家賃・保険など、口座から払うものがおすすめです')}
    ${group('記録しない(把握だけ)', info, '金額を知っておきたいだけのものを入れます')}
    <p class="muted" style="margin:6px 0 0;font-size:13px">押すと、名前・金額・記録するかどうか・見せる範囲を直せます。</p></section>
  ${mt.length ? `<section class="card list"><h2 class="group-title">固定費で記録済みと判断したカード利用(${mt.length})</h2>
    <p class="muted" style="margin:0 0 4px;font-size:13px">固定費と同じ金額だったので、二重にならないよう確認待ちから外しました。違っていたら「取り消す」を押すと確認待ちに戻ります。</p>
    ${mt.map(i => `<div class="row"><span class="main"><span class="name">${esc(i.merchant || '(お店の名前なし)')} ${yen(i.amount)}</span>
      <span class="sub">${md(ymd(new Date(i.used_at)))}・${esc(i.card || 'カード')} → 固定費「${esc(fname(i.fixed_cost_id))}」</span></span>
      <button class="pill" data-act="fixUnmatch" data-id="${i.id}">取り消す</button></div>`).join('')}</section>` : ''}
  <form class="card stack" data-form="fix" novalidate><h2>固定費を追加</h2>${fxFields('fx')}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">追加する</button>
    <p class="muted" style="margin:0;font-size:13px">カードで払う固定費も「記録する」で大丈夫です。同じ金額のカード利用が取り込まれたら、自動で見分けて二重に数えません。</p></form>`;
}
function fixSheetHtml() {
  const { st, esc } = C, s = st.sheet, f = (st.fixed || []).find(x => x.id === s.id); if (!f) return '';
  return sheetWrap(`固定費「${esc(f.name)}」を直す`, `<form class="stack" data-form="fixEdit" novalidate>${fxFields('fe', f)}
    <p class="muted" style="margin:0;font-size:13px">見せる範囲を変えると、これまでにこの固定費から記録した分も同じ範囲に変わります。</p>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">保存する</button></form>
    <button class="btn danger" data-act="fixDel" data-id="${f.id}">この固定費を削除</button>${closeBtn()}`);
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
  return sheetWrap(s.title, `<p class="muted" style="margin:0">${s.note || '消したものは7日間、「設定 → ゴミ箱」から戻せます。'}</p>
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

// ---------- レシート ----------
const catsOf = i => [...new Set((i.items || []).map(x => x.category))];
// 品目を分類ごとにまとめる。品目の合計と支払額の差(税・値引きの読み違いなど)は、いちばん大きい分類に入れる
export function splitByCategory(items, total) {
  const g = {};
  items.forEach(x => { (g[x.category] ||= { amount: 0, items: [] }); g[x.category].amount += x.price; g[x.category].items.push(x); });
  const keys = Object.keys(g); if (!keys.length) return [];
  const diff = total - keys.reduce((a, k) => a + g[k].amount, 0);
  if (diff) { const big = keys.sort((a, b) => g[b].amount - g[a].amount)[0]; g[big].amount += diff; g[big].items.push({ name: '調整(税・値引きなど)', price: diff, category: big }); }
  return Object.entries(g).filter(([, v]) => v.amount > 0).map(([category, v]) => ({ category, amount: v.amount, items: v.items }));
}
async function shrink(file) {   // 写真を長い辺1600pxのJPEGにして、送る量を減らす
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.8).split(',')[1];
}
async function readReceipts(files) {
  if (!files.length) return;
  let ok = 0, merged = 0; const errs = [];
  for (const [n, f] of files.entries()) {
    toast(`レシート ${n + 1}/${files.length} を読み取り中…`);
    try {
      const { data, error } = await sb().functions.invoke('receipt-read', { body: { image: await shrink(f), mime: 'image/jpeg' } });
      const msg = data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || error?.message;
      if (msg) throw new Error(msg);
      ok++; if (data.merged) merged++;
    } catch (e) { errs.push(`${n + 1}枚目:${e.message}`); }
  }
  await reloadInbox(); C.render();
  toast(`${ok}枚を読み取りました${merged ? `(${merged}枚はカード利用とまとめました)` : ''}${errs.length ? `。読めなかったもの ${errs.length}枚` : ''}`);
  if (errs.length) setTimeout(() => alertBox(errs), 2300);
}
function alertBox(errs) { C.st.sheet = { type: 'info', title: '読み取れなかったレシート', lines: errs }; C.render(); }
const infoHtml = () => sheetWrap(C.st.sheet.title, `<p class="muted" style="margin:0">${C.st.sheet.lines.map(C.esc).join('<br>')}</p>
  <p class="muted" style="margin:0;font-size:13px">明るい場所で、レシート全体が入るように撮り直すと読めることがあります。</p>${closeBtn()}`);
function rcptHtml() {
  const { st, esc } = C, i = (st.inbox || []).find(x => x.id === st.sheet.id); if (!i) return '';
  const sum = i.items.reduce((a, x) => a + x.price, 0);
  return sheetWrap(`${esc(i.merchant)} ${yen(i.amount)}`, `<form class="stack" data-form="rcpt" novalidate>
    ${field('rcScope', '見せる範囲', '<select id="rcScope"><option value="shared">ふたりの支出(精算の対象)</option><option value="private">自分だけ(相手には見えません)</option></select>')}
    <p class="muted" style="margin:0">${md(inboxDate(i))}・${esc(i.card)}${i.note ? `<br><span style="color:var(--red)">${esc(i.note)}</span>` : ''}</p>
    <div class="items">${i.items.map((x, n) => `<div class="irow" data-i="${n}">
      <input type="text" class="iname" maxlength="40" value="${esc(x.name)}" aria-label="品名">
      <input type="text" class="iprice" inputmode="numeric" value="${x.price}" aria-label="金額">
      <select class="icat" aria-label="分類">${CATS.map(c => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`).join('')}</div>
    <p class="muted" style="margin:0;font-size:13px">品目の合計 ${yen(sum)}${sum !== i.amount ? `(支払額との差 ${yen(i.amount - sum)} は、いちばん大きい分類に「調整」として入れます)` : ''}</p>
    ${field('rcWho', '払った人', `<select id="rcWho">${memberOpts(st.me.user_id)}</select>`)}
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">分類ごとに分けて記録する</button>
    <button class="btn" type="button" data-act="inboxIgnore">家計簿に記録しない(仕事・アパートの分など)</button>${closeBtn('やめる')}</form>`);
}

// ---------- シート(下から出る画面) ----------
export function sheetHtml() {
  const t = C.st.sheet?.type;
  return ({ evNew: evFormHtml, ev: evSheetHtml, choreNew: choreFormHtml, chore: choreSheetHtml, txNew: txFormHtml, tx: txSheetHtml, goalAdd: goalAddHtml, confirm: confirmHtml, bulk: bulkHtml, rcpt: rcptHtml, info: infoHtml, fix: fixSheetHtml }[t] || (() => ''))();
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
    const inboxId = st.sheet?.inbox, row = { date, amount, shop, category, paid_by: val('txWho') || me.user_id, scope };
    if (old) { await run(sb().from('transactions').update(row).eq('id', editId), '記録を直しました');
      if (scope === 'shared') activity(`${me.display_name}さんが家計簿の記録(${category} ${yen(amount)})を直しました`);
      st.sheet = null; st.kb.month = date.slice(0, 7); await loadTx(false); C.render(); return true; }
    await run(sb().from('transactions').insert({ household_id: h(), ...row }), '記録しました');
    if (inboxId) { await run(sb().from('card_inbox').update({ status: 'recorded' }).eq('id', inboxId)); await reloadInbox(); }
    if (scope === 'shared') activity(`${me.display_name}さんが家計簿に${category} ${yen(amount)}を記録しました`);
    st.sheet = null; st.kb.month = date.slice(0, 7); st.kb.tab = 'list'; await loadTx(true); C.render(); return true;
  }
  if (f === 'rcpt') {
    const i = st.inbox.find(x => x.id === st.sheet.id); if (!i) return true;
    const items = [...document.querySelectorAll('.irow')].map(r => ({ name: r.querySelector('.iname').value.trim() || '(品名なし)',
      price: toNum(r.querySelector('.iprice').value) * (/^\s*[-ー−－]/.test(r.querySelector('.iprice').value) ? -1 : 1), category: r.querySelector('.icat').value }));
    const scope = val('rcScope'), parts = splitByCategory(items, i.amount);
    if (!parts.length) return err('品目の金額を確かめてください');
    await run(sb().from('transactions').insert(parts.map(p => ({ household_id: h(), date: inboxDate(i), amount: p.amount, shop: i.merchant, category: p.category,
      paid_by: val('rcWho') || me.user_id, scope, items: p.items }))));
    await run(sb().from('card_inbox').update({ status: 'recorded' }).eq('id', i.id), `${parts.length}つの分類に分けて記録しました`);
    if (scope === 'shared') activity(`${me.display_name}さんが家計簿に${i.merchant} ${yen(i.amount)}を記録しました`);
    st.sheet = null; await Promise.all([loadTx(true), reloadInbox()]); C.render(); return true;
  }
  if (f === 'bulk') {
    const ib = st.inbox || [], scope = val('bkScope') || 'private';
    if (!ib.length) { st.sheet = null; C.render(); return true; }
    await run(sb().from('transactions').insert(ib.flatMap(i => i.items?.length
      ? splitByCategory(i.items, i.amount).map(p => ({ household_id: h(), date: inboxDate(i), amount: p.amount, shop: i.merchant, category: p.category, paid_by: me.user_id, scope, items: p.items }))
      : [{ household_id: h(), date: inboxDate(i), amount: i.amount, shop: i.merchant || null, category: catFor(i), paid_by: me.user_id, scope }])));
    await run(sb().from('card_inbox').update({ status: 'recorded' }).in('id', ib.map(i => i.id)), `${ib.length}件を記録しました`);
    if (scope === 'shared') activity(`${me.display_name}さんがカード利用${ib.length}件を家計簿に記録しました`);
    st.sheet = null; await Promise.all([loadTx(true), reloadInbox()]); C.render(); return true;
  }
  if (f === 'fix' || f === 'fixEdit') {
    const p = f === 'fix' ? 'fx' : 'fe', name = val(p + 'Name'), amount = toNum(val(p + 'Amt')); if (!name || !amount) return err('名前と金額を入れてください');
    const row = { name, amount, category: val(p + 'Cat'), paid_by: val(p + 'Who') || me.user_id, active: val(p + 'Rec') !== 'off' };
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
    case 'calDay': { const [y, m] = el.dataset.d.split('-').map(Number); st.cal = { y, m: m - 1, sel: el.dataset.d }; C.render(); return true; }
    case 'calWeek': try { localStorage.setItem(WS_KEY, el.dataset.v); } catch {} C.toast(el.dataset.v === '1' ? 'カレンダーを月曜始まりにしました' : 'カレンダーを日曜始まりにしました'); C.render(); return true;
    case 'calYear': if (st.cal.view === 'year') st.cal.view = null; else { st.cal.view = 'year'; st.cal.yy = st.cal.y; } C.render(); window.scrollTo(0, 0); return true;
    case 'calYearMove': { const n = Number(el.dataset.n); st.cal.yy = n ? st.cal.yy + n : new Date().getFullYear(); C.render(); return true; }
    case 'calPick': { const [y, m] = el.dataset.d.split('-').map(Number); st.cal = { y, m: m - 1, sel: el.dataset.d }; C.render(); window.scrollTo(0, 0); return true; }
    case 'calMove': {
      calShift(Number(el.dataset.n)); C.render(); return true;
    }
    case 'evNew': openSheet({ type: 'evNew' }); return true;
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

// ---------- 設定:カード利用の取り込み(iPhoneのショートカット) ----------
export function calSettingsHtml() {
  const ws = weekStart(), b = (v, l) => `<button class="pill${ws === v ? ' on' : ''}" data-act="calWeek" data-v="${v}" aria-pressed="${ws === v}">${l}</button>`;
  return `<section class="card stack"><h2>カレンダーの週の始まり</h2><div class="nav">${b(0, '日曜始まり')}${b(1, '月曜始まり')}</div>
    <p class="muted" style="margin:0;font-size:13px">この端末だけの設定です。相手の画面は変わりません。</p></section>`;
}
// ---------- 設定:通知 ----------
const NOTIFY = [['partner', '相手が予定・買い物・やること・家計簿を追加・変更したとき'], ['urgent', '買い物に「急ぎ」が付いたとき'],
  ['todo', 'やることの期限(朝7時に今日やることをまとめて)'], ['events', '予定(前日20時に明日の分、朝7時に今日の分)'],
  ['remind', '予定ごとのお知らせ(予定で選んだ「30分前」などの時刻)'], ['budget', '予算の8割を使ったとき・超えたとき'], ['card', 'カード利用の確認待ちがあるとき(20時)']];
const b64uBytes = s => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0)); };
async function loadPush() {
  const p = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) };
  p.perm = p.supported ? Notification.permission : 'unsupported';
  try { const reg = p.supported && await navigator.serviceWorker.getRegistration(); p.subscribed = !!(reg && await reg.pushManager.getSubscription()); } catch { p.subscribed = false; }
  const { data } = await sb().from('notify_prefs').select('*').eq('user_id', C.st.me.user_id).maybeSingle();
  p.prefs = Object.fromEntries(NOTIFY.map(([k]) => [k, data ? data[k] !== false : true]));
  C.st.push = p;
}
async function pushOn() {
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
async function pushOff() {
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
    ? '<p class="muted" style="margin:0;font-size:13px">通知は、ホーム画面に追加した暮らし帳から開いたときに使えます(iPhoneは iOS 16.4 以降)。Safariで開いている場合は、共有ボタン →「ホーム画面に追加」から開き直してください。</p>'
    : p.perm === 'denied' ? '<p class="muted" style="margin:0;font-size:13px">通知が「許可しない」になっています。iPhoneの「設定」→「通知」→「暮らし帳」で許可してから、もう一度押してください。</p>' : '';
  const sw = (k, l) => `<label class="switch"><input type="checkbox" data-act="notifyPref" data-k="${k}" ${p.prefs[k] ? 'checked' : ''}><span>${l}</span></label>`;
  return `<section class="card stack"><h2>通知</h2>${head}
    ${p.supported && p.standalone ? (p.subscribed
      ? '<p style="margin:0">✅ この端末で通知を受け取っています</p><div class="two"><button class="btn" data-act="pushTest">テスト通知を送る</button><button class="btn" data-act="pushOff">この端末の通知を止める</button></div>'
      : '<button class="btn primary" data-act="pushOn">この端末で通知を受け取る</button>') : ''}
    <fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="muted" style="font-size:13px;margin-bottom:4px">受け取る通知(人ごとの設定です。相手には影響しません)</legend>${NOTIFY.map(([k, l]) => sw(k, l)).join('')}</fieldset>
    <p class="muted" style="margin:0;font-size:13px">「自分だけ」の予定・やることは、通知では名前を伏せて「自分だけの予定」と出します。</p></section>`;
}

// ---------- 検索(予定・家計簿・やること・買い物・固定費をまとめて) ----------
const like = q => '%' + q.replace(/[%_,()\\]/g, ' ').trim() + '%';
const has = (v, q) => String(v || '').toLowerCase().includes(q.toLowerCase());
async function doSearch(q) {
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
    const txSum = r.tx.reduce((a, t) => a + t.amount, 0);
    body = sec('予定', r.ev.map(e => row('goEv', `data-id="${e.id}" data-d="${e.date}" ${edge(e.for_user)}`, esc(e.title), `${e.date.slice(0, 4)}/${md(e.date)}・${timeText(e)}${e.repeat_rule ? '・' + repText(e.repeat_rule) : ''}・${who(e.for_user)}`)))
      + (r.tx.length ? `<p class="muted" style="margin:0;font-size:13px">家計簿の合計 ${yen(txSum)}(${r.tx.length}件)</p>` : '')
      + sec('家計簿', r.tx.map(t => row('goTx', `data-id="${t.id}" data-d="${t.date}" ${edge(t.paid_by)}`, esc(t.shop || t.category), `${t.date.slice(0, 4)}/${md(t.date)}・${t.category}・${who(t.paid_by)}が払った${t.scope === 'private' ? '・自分だけ' : ''}`, `<b>${yen(t.amount)}</b>`)))
      + sec('やること', r.ch.map(c => row('goCh', `data-id="${c.id}" ${edge(c.assignee)}`, esc(c.name), `${c.category || '家事'}・${c.archived ? 'お休み中' : freqText(c)}${c.last_done ? '・前回 ' + md(c.last_done) : ''}`)))
      + sec('買い物', r.sh.map(i => row('goSh', `data-id="${i.id}"`, esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : ''), i.done ? 'カゴに入れた' : 'リストにある')))
      + sec('固定費', r.fx.map(f => row('goFx', `data-id="${f.id}"`, esc(f.name), `${f.category}・${f.active ? '毎月記録' : '記録しない'}`, `<b>${yen(f.amount)}</b>`)));
    if (!body.trim()) body = `<p class="muted">「${esc(sr.q)}」は見つかりませんでした</p>`;
    if (r.local) body = '<p class="muted" style="margin:0;font-size:13px">圏外のため、端末に残っている分(家計簿は表示中の月だけ)から探しました。</p>' + body;
  }
  return `<main class="screen">
  <div class="head"><div><small><a href="#home">‹ ホーム</a></small><h1>検索</h1></div></div>
  <form class="addrow" data-form="search" role="search"><label class="sr" for="q">探す言葉</label>
    <input id="q" type="search" maxlength="40" placeholder="例:車検、美容院、ドミー" value="${esc(sr.q)}" autocomplete="off" enterkeyhint="search"><button class="plus" type="submit" aria-label="探す">🔍</button></form>
  <p class="muted" style="margin:0;font-size:13px">予定・家計簿(お店・分類)・やること・買い物・固定費から、全部の期間を探します。ゴミ箱の中は探しません。</p>
  ${body}</main>`;
}

// ---------- ゴミ箱(消したものを7日間は戻せる) ----------
const TRASH = [['events', '予定', x => x.title], ['chores', 'やること', x => x.name], ['transactions', '家計簿', x => `${x.shop || x.category} ${yen(x.amount)}`],
  ['fixed_costs', '固定費', x => `${x.name} ${yen(x.amount)}`], ['goals', '目標貯金', x => x.name]];
async function loadTrash() {
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
  <div class="head"><div><small><a href="#settings">‹ 設定</a></small><h1>ゴミ箱</h1></div></div>
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
    <p class="muted" style="margin:0;font-size:13px">自宅PCの「C:\\_Work\\01_ツール\\暮らし帳_バックアップ」が、毎日このアプリのデータを保存します。下の鍵を、そのフォルダの「鍵.txt」に貼ってください。鍵は読むだけで書き換えはできませんが、中身が読めるので人に見せないでください。</p>
    ${k ? `<div class="codebox">${esc(k)}</div><button class="btn primary" data-act="copy" data-v="${esc(k)}">鍵をコピー</button>
      <button class="btn" data-act="backupKeyRenew">鍵を作り直す(古い鍵は使えなくなります)</button>`
      : '<button class="btn" data-act="backupKey">鍵を表示</button>'}</section>`;
}

// ---------- 設定:ホーム画面のウィジェット(Scriptable) ----------
export function widgetSettingsHtml() {
  const { st } = C, ready = st.widgetKey && st.widgetSrc;
  return `<section class="card stack"><h2>ホーム画面のウィジェット</h2>
    <p class="muted" style="margin:0;font-size:13px">予定と買い物リストを、iPhoneのホーム画面やロック画面に出します。無料アプリ「Scriptable」を使います。ウィジェット用の鍵は「読むだけ」で、これでは何も書き換えられません。</p>
    ${ready ? `<button class="btn primary" data-act="widgetCopy">スクリプトをコピー(鍵入り)</button>
      <ol class="steps"><li>App Storeで「Scriptable」を入れて開く</li><li>右上の「＋」→ 中身を全部消して貼り付け</li><li>上の題名を「暮らし帳」にして「Done」</li>
      <li>ホーム画面を長押し →「編集」→「ウィジェットを追加」→ Scriptable → 大きさを選ぶ</li><li>置いたウィジェットを長押し →「ウィジェットを編集」→ Script で「暮らし帳」を選ぶ</li></ol>
      <p class="muted" style="margin:0;font-size:13px">Parameter に「予定」または「買い物」と書くと、片方だけを大きく出します。表示はおよそ15分ごとに新しくなります(間隔はiPhoneが決めます)。</p>
      <button class="btn" data-act="widgetKeyRenew">鍵を作り直す(古いウィジェットは表示されなくなります)</button>`
      : '<button class="btn primary" data-act="widgetKey">ウィジェットの準備をする</button>'}</section>`;
}
async function loadWidget(renew) {
  const { st, run } = C;
  const [k, src] = await Promise.all([
    run(sb().rpc('widget_token', { p_renew: !!renew }), renew ? '鍵を作り直しました。スクリプトをコピーし直して、Scriptableに貼り直してください' : null),
    st.widgetSrc ? st.widgetSrc : fetch('widget.js', { cache: 'no-cache' }).then(r => r.ok ? r.text() : null).catch(() => null)]);
  if (!src) C.toast('スクリプトを読み込めませんでした。通信を確かめて、もう一度押してください');
  st.widgetKey = k; st.widgetSrc = src; C.render();
}
const widgetScript = () => C.st.widgetSrc.replace('__KEY__', C.st.widgetKey).replace('__URL__', C.url).replace('__APIKEY__', C.key).replace('__WS__', String(weekStart()));

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
