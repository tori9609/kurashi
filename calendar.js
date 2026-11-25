// ふたりの暮らし帳:予定(カレンダー・1年の一覧・予定の入力と詳細)
// ---------- 予定 ----------
import { C, SHARED_COLOR, W, closeBtn, dt, edge, err, field, ic, md, memberOpts, pad, sheetWrap, today, wdClass, weekStart, who, ymd } from './core.js';
import { addBtn, planSeg } from './features.js';
import { has } from './settings.js';
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
export const timeText = e => e.time ? e.time.slice(0, 5) + (e.end_time ? '〜' + e.end_time.slice(0, 5) : '') : '終日';
export const repText = r => !r ? '' : r.startsWith('weekly') ? `毎週${r.split(':')[1].split(',').map(n => W[n]).join('・')}曜日` : `毎月${r.split(':')[1]}日`;
export const evRow = e => `<button class="row" data-act="evOpen" data-id="${e.id}" ${edge(e.for_user)}><span class="dot" style="background:${evColor(e)}"></span>
  <span class="main"><span class="name">${C.esc(e.title)}</span><span class="sub">${timeText(e)}・${who(e.for_user)}${e.repeat_rule ? '・くり返し' : ''}${imported(e) ? '・' + SRC[e.source] : ''}${e.is_private ? '・自分だけ' : ''}</span></span></button>`;

// 月のマスに件名を出す(3件まで。入りきらない分は「+件数」)。件名はマスの幅で切れる
const chips = evs => (evs.length > 3 ? evs.slice(0, 2) : evs).map(e => `<b style="--c:${evColor(e)}">${C.esc(e.title)}</b>`).join('')
  + (evs.length > 3 ? `<b class="more">+${evs.length - 2}</b>` : '');
export function viewCalendar() {
  const { st } = C, { y, m, sel } = st.cal;
  const ws = weekStart(), lead = (new Date(y, m, 1).getDay() - ws + 7) % 7, days = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  let cells = '';
  for (let k = 0; k < total; k++) {
    const d = new Date(y, m, 1 - lead + k), ds = ymd(d), out = d.getMonth() !== m, evs = eventsOn(ds);
    cells += `<button class="day${out ? ' out' : ''}${wdClass(d.getDay())}${ds === sel ? ' sel' : ''}${ds === today() ? ' today' : ''}" data-act="calDay" data-d="${ds}" aria-label="${d.getMonth() + 1}月${d.getDate()}日、予定${evs.length}件">
      <span>${d.getDate()}</span><i>${chips(evs)}</i></button>`;
  }
  if (st.cal.view === 'year') return viewYear();
  const list = eventsOn(sel);
  return `<main class="screen">
  ${planSeg('calendar')}
  <div class="head"><div><small>${y}年</small><h1><button class="ttl" data-act="calYear" aria-label="${y}年${m + 1}月。押すと1年分の一覧">${m + 1}月<span class="caret">${ic('down')}</span></button></h1></div>
    <div class="nav"><button class="iconbtn" data-act="calMove" data-n="-1" aria-label="前の月">${ic('left')}</button><button class="pill" data-act="calMove" data-n="0">今日</button><button class="iconbtn" data-act="calMove" data-n="1" aria-label="次の月">${ic('right')}</button>${addBtn('evNew', '予定を追加')}</div></div>
  <section class="card"><div class="cal">${[0, 1, 2, 3, 4, 5, 6].map(i => (i + ws) % 7).map(d => `<span class="wd${wdClass(d)}">${W[d]}</span>`).join('')}${cells}</div></section>
  <section class="card list"><h2 class="group-title">${md(sel)}の予定</h2>
    ${list.length ? list.map(evRow).join('') : '<p class="muted" style="margin:0 0 10px">予定はありません</p>'}
    <button class="btn text" data-act="evNew">＋ ${md(sel)}に予定を追加</button>
    <p class="muted hint" style="margin:0 0 8px;font-size:0.75rem">選んでいる日をもう一度押しても追加できます。</p></section>
  <label class="btn icon-left">${ic('doc')}紙のお知らせから予定を作る<input id="paperFile" type="file" accept="image/*" hidden></label>
  <p class="muted hint" style="margin:-4px 4px 0;font-size:0.7812rem">学校や病院のお知らせ・予約票を撮ると、日付と予定を読み取ります。登録の前に確かめられます。</p></main>`;
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
  ${planSeg('calendar')}
  <div class="head"><div><h1><button class="ttl" data-act="calYear" aria-label="月の表示に戻る">${yy}年<span class="caret">${ic('up')}</span></button></h1></div>
    <div class="nav"><button class="iconbtn" data-act="calYearMove" data-n="-1" aria-label="前の年">${ic('left')}</button><button class="pill" data-act="calYearMove" data-n="0">今年</button><button class="iconbtn" data-act="calYearMove" data-n="1" aria-label="次の年">${ic('right')}</button></div></div>
  <p class="muted hint" style="margin:0;font-size:0.8125rem">月の名前を押すとその月へ、日を押すとその日の予定へ移ります。青い日は予定のある日です。</p>
  <section class="card"><div class="ygrid">${months}</div></section></main>`;
}

// 予定の追加・修正(s.edit があれば修正)。見せる範囲は件名のすぐ下に置き、うっかり共有を防ぐ
export const REMIND = [['', 'なし'], ['0', '予定の時刻'], ['10', '10分前'], ['30', '30分前'], ['60', '1時間前'], ['120', '2時間前'], ['1440', '前日の同じ時刻']];
export function evFormHtml() {
  const { st, esc } = C, s = st.sheet, base = s.base ? st.events.find(x => x.id === s.base) : null;
  const e = s.edit ? st.events.find(x => x.id === s.edit) : base;   // 「この日だけ変更」は、元のくり返しの内容を下書きにする
  const mine = !e || e.created_by === st.me.user_id, rep = base ? '' : e?.repeat_rule ? e.repeat_rule.split(':')[0] : '';
  const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  const rmd = e?.remind_min == null ? '' : String(e.remind_min);
  return sheetWrap(base ? `${md(s.day)}だけ変更` : e ? (e.repeat_rule ? 'すべての回を直す' : '予定を直す') : '予定を追加', `<form class="stack" data-form="ev" novalidate>
    ${base ? `<p class="muted hint" style="margin:0;font-size:0.8125rem">くり返しの予定「${esc(base.title)}」の${md(s.day)}の回だけを変えます。ほかの回はそのままです。</p>` : ''}
    ${field('evTitle', 'タイトル', `<input id="evTitle" type="text" maxlength="80" placeholder="例：歯医者" value="${esc(e?.title || '')}">`)}
    ${mine ? `<label class="check"><input id="evPriv" type="checkbox" ${e?.is_private ? 'checked' : ''}> 自分だけに表示する(相手には見えません)</label>`
      : '<p class="muted hint" style="margin:0;font-size:0.8125rem">相手が登録した予定なので、見せる範囲は相手だけが変えられます。</p>'}
    <div class="two">${field('evDate', '日付', `<input id="evDate" type="date" value="${base ? s.day : e?.date || st.cal.sel}">`)}${field('evTime', '時刻(空なら終日)', `<input id="evTime" type="time" value="${e?.time ? e.time.slice(0, 5) : ''}">`)}</div>
    ${field('evEnd', '終わりの時刻(なくてもよい)', `<input id="evEnd" type="time" value="${e?.end_time ? e.end_time.slice(0, 5) : ''}">`)}
    ${field('evFor', 'だれの予定', `<select id="evFor">${memberOpts(e ? e.for_user : st.me.user_id, 'ふたり')}</select>`)}
    ${base ? '' : field('evRep', 'くり返し', `<select id="evRep">${opt('', 'なし', rep)}${opt('weekly', '毎週(同じ曜日)', rep)}${opt('monthly', '毎月(同じ日)', rep)}</select>`)}
    ${field('evRemind', 'お知らせ(時刻のある予定)', `<select id="evRemind">${REMIND.map(([v, l]) => opt(v, l, rmd)).join('')}</select>`)}
    <p class="muted hint" style="margin:-4px 0 0;font-size:0.8125rem">終日の予定は、朝7時と前日20時のまとめでお知らせします。</p>
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">${e ? '保存する' : '追加する'}</button>${closeBtn('やめる')}</form>`);
}

export function evSheetHtml() {
  const { st, esc } = C, s = st.sheet, e = st.events.find(x => x.id === s.id);
  if (!e) return '';
  const cm = s.comments;
  return sheetWrap(esc(e.title), `
    <p class="muted" style="margin:0">${md(s.day || e.date)} ${timeText(e)}・${e.for_user ? esc(C.nameOf(e.for_user)) : 'ふたり'}の予定${e.repeat_rule ? '・' + repText(e.repeat_rule) : ''}<br>${imported(e) ? `${SRC[e.source]}のカレンダー「${esc(e.calendar_name || '')}」から取り込み。内容は${SRC[e.source]}のカレンダーで直してください` : esc(C.nameOf(e.created_by)) + 'さんが登録'}</p>
    ${e.created_by === st.me.user_id ? `<div class="row" style="border:0;min-height:44px"><span class="main"><span class="name">${e.is_private ? '自分だけに見えています' : 'ふたりに見えています'}</span></span>
      <button class="pill ${e.is_private ? '' : 'go on'}" data-act="evShare">${e.is_private ? 'ふたりに見せる' : '自分だけにする'}</button></div>` : ''}
    <div class="comments">${cm === null ? '<p class="muted" style="margin:0">コメントを読み込み中…</p>' : cm.length ? cm.map(c => `<div class="cmt"><span class="dot" style="background:${C.colorOf(c.user_id)}"></span><div><b>${esc(C.nameOf(c.user_id))}</b> ${esc(c.body)}</div></div>`).join('') : '<p class="muted" style="margin:0">コメントはまだありません</p>'}</div>
    <form class="addrow" data-form="cmt"><label class="sr" for="cmtBody">コメント</label><input id="cmtBody" type="text" maxlength="300" placeholder="コメントを書く" autocomplete="off"><button class="plus" type="submit" aria-label="送る">↑</button></form>
    ${e.series_id && !imported(e) ? `<p class="muted hint" style="margin:0;font-size:0.8125rem">くり返しの予定「${esc(st.events.find(x => x.id === e.series_id)?.title || '')}」の、この日だけ変えた回です。</p>` : ''}
    ${imported(e) ? '' : e.repeat_rule ? `<div class="two"><button class="btn" data-act="evOnly">${md(s.day)}だけ変更</button><button class="btn" data-act="evSkip">${md(s.day)}だけ休み</button></div>
      <button class="btn" data-act="evEdit">すべての回を直す</button>
      ${(e.exdates || []).length ? `<div class="list"><p class="muted hint" style="margin:4px 0 0;font-size:0.8125rem">休み・変更にした日</p>${[...e.exdates].sort().map(x => `<div class="row"><span class="main"><span class="name">${md(x)}</span></span><button class="pill" data-act="evUnskip" data-d="${x}">元に戻す</button></div>`).join('')}</div>` : ''}`
      : '<button class="btn" data-act="evEdit">内容を直す</button>'}
    ${imported(e) ? '' : s.confirm ? `<button class="btn danger" data-act="evDelYes">本当に削除する${e.repeat_rule ? '(くり返しのすべての回)' : ''}(7日間はゴミ箱から戻せます)</button>` : `<button class="btn danger" data-act="evDel">${e.repeat_rule ? 'くり返しをすべて削除' : 'この予定を削除'}</button>`}
    ${closeBtn()}`);
}
