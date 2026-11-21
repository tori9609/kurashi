// ふたりの暮らし帳:家計簿(記録・ふり返り・固定費・予算・目標貯金・期限・追加メニュー)
// ---------- 家計簿 ----------
// お店の名前から分類を推測する。前に同じお店で記録した分類があれば、それを優先する
import { C, CATS, closeBtn, dt, edge, err, field, h, ic, ls, md, memberOpts, sb, sheetWrap, thisMonth, today, who, yen, ymd } from './core.js';
import { INCOME_CATS, addBtn, catFor, cycText, infoFix, isIncome, isYearly, payDate, payThisMonth, perMonth, perYear } from './features.js';
import { catsOf } from './receipt.js';
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
export const inboxDate = i => ymd(new Date(i.used_at));
export const inboxCount = () => (C.st.inbox || []).length;
// ウォレットから届いたが、金額を読み取れなかった支払い:届いた値を見せて、手で記録できるようにする
// カードの引き落とし予定:使った分の合計なので、支出には入れず、口座に用意する額として見せる
function billsHtml() {
  const { st, esc } = C, bs = st.bills || []; if (!bs.length) return '';
  const wd = md;   // 例:12/4(金)
  return `<section class="card list bills"><h2 class="group-title">${ic('card')}カードの引き落とし予定</h2>
    ${bs.map(b => `<div class="row"><span class="main"><span class="name">${esc(b.card)}</span>
      <span class="sub">${wd(b.pay_date)}に引き落とし${b.prepare_date ? `・口座へは${wd(b.prepare_date)}までに` : ''}</span></span><b>${yen(b.amount)}</b></div>`).join('')}
    <p class="muted hint" style="margin:4px 0 0;font-size:0.8125rem">カード会社のお知らせメールから取り込んだ、自分だけに見える予定です。使った分はそれぞれ記録済みなので、この金額は支出に足しません。</p></section>`;
}
function missesHtml() {
  const { st, esc } = C, ms = st.misses || []; if (!ms.length) return '';
  const when = d => new Date(d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<section class="card list miss"><h2 class="group-title">${ic('card')}金額が届かなかった支払い(${ms.length})</h2>
    <p class="muted" style="margin:0 0 4px;font-size:0.8125rem">ウォレットから届いたものの、金額を読み取れませんでした。「記録する」で金額を入れてください。</p>
    ${ms.map(m => `<div class="row"><span class="main"><span class="name">${esc(m.merchant || '(お店の名前なし)')}</span>
      <span class="sub">${when(m.used_at)}・${esc(m.card || 'カード')}・届いた値「${esc(m.amount_raw || '空')}」</span></span>
      <button class="pill" data-act="missRec" data-id="${m.id}">記録する</button><button class="pill" data-act="missDel" data-id="${m.id}" aria-label="消す">消す</button></div>`).join('')}</section>`;
}
function inboxHtml() {
  const { st, esc } = C, ib = st.inbox || [];
  if (!ib.length) return '';
  return `<section class="card list"><h2 class="group-title">カード利用・レシートの確認待ち(${ib.length})</h2>
    <p class="muted hint" style="margin:0 0 4px;font-size:0.8125rem">押して分類を選ぶと家計簿に入ります。家計簿に入れないもの(仕事・アパートの分など)は「記録しない」を選んでください。自分にだけ見えています。</p>
    <button class="btn" style="margin:4px 0" data-act="inboxBulk">推測の分類のまま、まとめて記録(${ib.length}件)</button>
    ${ib.map(i => `<button class="row" data-act="inboxOpen" data-id="${i.id}"><span class="main"><span class="name">${esc(i.merchant || '(お店の名前なし)')}</span>
      <span class="sub">${md(inboxDate(i))}・${esc(i.card || 'カード')}${i.items ? `・品目${i.items.length}件(${catsOf(i).join('・')})` : '・推測:' + catFor(i)}${!i.items && infoFix(i) ? `・固定費「${esc(infoFix(i).name)}」と同じ金額` : ''}</span>
      ${i.note ? `<span class="sub" style="color:var(--red)">${esc(i.note)}</span>` : ''}</span><b>${yen(i.amount)}</b></button>`).join('')}</section>`;
}
export const monthLabel = mo => `${Number(mo.slice(0, 4))}年${Number(mo.slice(5))}月`;
export const shiftMonth = (mo, n) => { const [y, m] = mo.split('-').map(Number); return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); };
// 精算:ふたりの支出を人数で割り、払った額との差を出す
export function settle() {
  const { st } = C, shared = (st.tx || []).filter(t => t.scope === 'shared' && !isIncome(t));
  const total = shared.reduce((a, t) => a + t.amount, 0), n = st.members.length || 1, share = total / n;
  const bal = st.members.map(m => { const paid = shared.filter(t => t.paid_by === m.user_id).reduce((a, t) => a + t.amount, 0); return { m, paid, diff: paid - share }; });
  return { total, share, bal };
}
export const sharedTotal = () => settle().total;
// 今月あと使える額:予算の合計 − ふたりの支出 − これから払う固定費(予算のある分類だけ)を、今日を含む残りの日数で割る
export function perDay() {
  const st = C.st, bud = (st.budgets || []).filter(b => b.amount > 0); if (!bud.length || st.kb?.month !== thisMonth()) return null;
  const cats = new Set(bud.map(b => b.category)), budget = bud.reduce((a, b) => a + b.amount, 0), spent = settle().total;
  const done = new Set((st.tx || []).filter(t => t.fixed_cost_id).map(t => t.fixed_cost_id)), t0 = today();
  const upcoming = (st.fixed || []).filter(f => f.active && f.scope !== 'private' && cats.has(f.category) && !done.has(f.id) && payThisMonth(f, thisMonth()) && payDate(thisMonth(), f.pay_day) > t0).reduce((a, f) => a + f.amount, 0);
  const d = new Date(), left = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1, rest = budget - spent - upcoming;
  return { budget, spent, upcoming, left, rest, day: Math.floor(rest / left) };
}
// はじめての案内(ホームの上。「わかった」で消え、設定の「使い方をもう一度見る」で戻る)
export function welcomeHtml() {
  if (ls('kurashi.welcome')) return '';
  const t = (k, b) => `<li>${ic(k)}<span>${b}</span></li>`;
  return `<section class="card welcome"><h2>暮らし帳の使い方</h2><ul>
    ${t('plus', '下の真ん中の「＋」から、予定・やること・買い物・支出を、どの画面からでも追加できます')}
    ${t('cal', '「予定」の上の切り替えで、カレンダーとやることを行き来します')}
    ${t('heart', '予定や家計簿の記録は「自分だけ」にでき、相手の画面には出ません')}
    ${t('bell', '右上の自分の丸 →「通知」で「受け取る」を押すと、相手の追加や急ぎの買い物が届きます')}
    ${t('help', '画面の右上の「？」を押すと、その画面の説明が出ます')}</ul>
    <button class="btn primary" data-act="welcomeDone">わかった</button></section>`;
}
// ホームのお金のカード:あと使える額(大きく)と、今月のふたりの支出
export function moneyCardHtml() {
  if (!isThisMonth()) return '';
  const p = perDay(), spent = sharedTotal();
  if (!p) return `<a class="card money" href="#kakeibo"><small>今月のふたりの支出</small><b class="big">${yen(spent)}</b>
    <span class="muted" style="font-size:0.8125rem">家計簿の「予算」を決めると、1日あたりあと使える額が出ます</span></a>`;
  const used = Math.min(100, Math.round((p.spent + p.upcoming) / p.budget * 100)), over = p.rest < 0;
  return `<a class="card money${over ? ' over' : ''}" href="#kakeibo"><small>${over ? '今月の予算' : '今月あと使える'}</small>
    <b class="big">${over ? `${yen(-p.rest)} 超えそう` : `1日 ${yen(p.day)}`}</b>
    <span class="meter" role="img" aria-label="予算の${used}%"><i style="width:${used}%"></i></span>
    <span class="muted" style="font-size:0.7812rem">ふたりの支出 ${yen(spent)}${p.upcoming ? `・これから払う固定費 ${yen(p.upcoming)}` : ''}・予算 ${yen(p.budget)}・あと${p.left}日</span></a>`;
}
export function perDayHtml() {
  const p = perDay(); if (!p) return '';
  return p.rest >= 0
    ? `<p style="margin:4px 0 0">今日から月末まで <b style="font-size:1.25rem;color:var(--green)">1日 ${yen(p.day)}</b> 使えます</p><p class="muted hint" style="margin:0;font-size:0.7812rem">予算 ${yen(p.budget)} − 使った分 ${yen(p.spent)}${p.upcoming ? ` − これから払う固定費 ${yen(p.upcoming)}` : ''} = 残り ${yen(p.rest)}(あと${p.left}日)</p>`
    : `<p style="margin:4px 0 0;color:var(--red);font-weight:700">予算を ${yen(-p.rest)} 超えそうです</p><p class="muted hint" style="margin:0;font-size:0.7812rem">予算 ${yen(p.budget)} − 使った分 ${yen(p.spent)}${p.upcoming ? ` − これから払う固定費 ${yen(p.upcoming)}` : ''}</p>`;
}
export const isThisMonth = () => C.st.kb?.month === thisMonth();

export function viewKakeibo() {
  const { st } = C, kb = st.kb;
  const tabs = [['list', '記録'], ['review', 'ふり返り'], ['fixed', '固定費'], ['budget', '予算'], ['goals', '目標貯金']];
  const body = { list: kbList, review: kbReview, fixed: kbFixed, budget: kbBudget, goals: kbGoals }[kb.tab]();
  return `<main class="screen">
  <div class="head"><div><small>${Number(kb.month.slice(0, 4))}年</small><h1>${Number(kb.month.slice(5))}月</h1></div>
    <div class="nav"><button class="iconbtn" data-act="kbMove" data-n="-1" aria-label="前の月">${ic('left')}</button><button class="pill" data-act="kbMove" data-n="0">今月</button><button class="iconbtn" data-act="kbMove" data-n="1" aria-label="次の月">${ic('right')}</button>${addBtn('txNew', '支出を記録')}</div></div>
  <div class="seg" role="tablist" style="grid-template-columns:repeat(${tabs.length},1fr)">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${kb.tab === k}" data-act="kbTab" data-t="${k}">${l}</button>`).join('')}</div>
  ${body}</main>`;
}
// ふり返り:6か月のふたりの支出の推移と、この月の分類ごとの前の月との比べ
async function loadReview(mo) {
  const from = shiftMonth(mo, -5) + '-01', to = shiftMonth(mo, 1) + '-01';
  const { data, error } = await sb().from('transactions').select('date,amount,category,scope,kind,paid_by').eq('household_id', h())
    .is('deleted_at', null).gte('date', from).lt('date', to);
  C.st.review = { mo, rows: error ? [] : data || [] };
}
function kbReview() {
  const { st } = C, mo = st.kb.month;
  if (st.review?.mo !== mo) { st.review = { mo, rows: null }; loadReview(mo).then(() => C.render()).catch(() => {}); }
  const rows = st.review.rows;
  if (!rows) return '<section class="card"><p class="muted" style="margin:0">読み込んでいます…</p></section>';
  const exp = rows.filter(t => t.scope === 'shared' && t.kind !== 'income');
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(mo, i - 5));
  const tot = months.map(m => exp.filter(t => t.date.startsWith(m)).reduce((a, t) => a + t.amount, 0)), max = Math.max(1, ...tot);
  const prev = shiftMonth(mo, -1), cur = tot.at(-1), pv = tot.at(-2);
  const diff = pv ? Math.round((cur - pv) / pv * 100) : null;
  const byCat = c => m => exp.filter(t => t.category === c && t.date.startsWith(m)).reduce((a, t) => a + t.amount, 0);
  const cats = CATS.map(c => ({ c, now: byCat(c)(mo), before: byCat(c)(prev) })).filter(x => x.now || x.before).sort((a, b) => b.now - a.now);
  const top = cats[0];
  const lbl = m => `${Number(m.slice(5))}月`;
  return `<section class="card"><h2>${lbl(mo)}のふたりの支出</h2>
    <p style="margin:0;font-size:1.625rem;font-weight:700">${yen(cur)}</p>
    <p class="muted" style="margin:0">${diff === null ? '前の月の記録はありません' : `前の月(${yen(pv)})より ${diff >= 0 ? '+' : ''}${diff}%`}${top?.now ? `・いちばん多いのは${top.c} ${yen(top.now)}` : ''}</p></section>
  <section class="card"><h2 class="group-title">6か月の推移(ふたりの支出)</h2>
    <div class="rbars" role="img" aria-label="6か月のふたりの支出の推移">${months.map((m, i) => `<div class="rbar${m === mo ? ' cur' : ''}"><span class="v">${tot[i] ? Math.round(tot[i] / 1000) + '千' : ''}</span><i style="height:${Math.round(tot[i] / max * 100)}%"></i><span class="m">${lbl(m)}</span></div>`).join('')}</div></section>
  <section class="card list"><h2 class="group-title">分類ごと(${lbl(mo)}と${lbl(prev)})</h2>
    ${cats.length ? `<table class="rtable"><thead><tr><th>分類</th><th>${lbl(mo)}</th><th>${lbl(prev)}</th><th>差</th></tr></thead><tbody>${cats.map(x => {
      const d = x.now - x.before; return `<tr><td>${x.c}</td><td>${yen(x.now)}</td><td>${yen(x.before)}</td><td class="${d > 0 ? 'minus' : d < 0 ? 'plus' : ''}">${d > 0 ? '+' : d < 0 ? '−' : ''}${yen(Math.abs(d))}</td></tr>`; }).join('')}</tbody></table>`
      : '<p class="muted" style="margin:0 0 8px">この月の記録はまだありません</p>'}
    <p class="muted hint" style="margin:6px 0 0;font-size:0.8125rem">ふたりの支出だけを数えています(自分だけの支出・収入は入りません)。差の赤は増えた分、緑は減った分です。</p></section>`;
}
function kbList() {
  const { st, esc } = C, tx = st.tx || [];
  const { total, bal } = settle();
  const priv = tx.filter(t => t.scope === 'private' && !isIncome(t)).reduce((a, t) => a + t.amount, 0);
  const inc = tx.filter(isIncome), me = st.me.user_id, sumOf = a => a.reduce((x, t) => x + t.amount, 0);
  const myIn = sumOf(inc.filter(t => t.paid_by === me)), myOut = sumOf(tx.filter(t => !isIncome(t) && t.paid_by === me)), bal0 = myIn - myOut;
  const byCat = CATS.map(c => ({ c, spent: tx.filter(t => t.scope === 'shared' && !isIncome(t) && t.category === c).reduce((a, t) => a + t.amount, 0), budget: (st.budgets.find(b => b.category === c) || {}).amount || 0 }))
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
      ${ic('camera')}レシートを読み込む<input id="rcptFile" type="file" accept="image/*" multiple hidden></label>
    <p class="muted hint" style="margin:0;font-size:0.75rem">撮影するか、写真を何枚か選ぶと、品目ごとに読み取って「確認待ち」に入れます(読み取りはGoogleのGeminiを使います)。</p></section>
  ${billsHtml()}${missesHtml()}${inboxHtml()}<section class="card"><div class="sum"><div><small>ふたりの支出</small><b>${yen(total)}</b></div><div><small>自分だけの支出</small><b>${yen(priv)}</b></div></div>
    ${inc.length ? `<div class="sum"><div><small>収入(見えている分)</small><b class="plus">+${yen(sumOf(inc))}</b></div><div><small>自分の収支(自分の収入 − 自分が払った分)</small><b class="${bal0 >= 0 ? 'plus' : 'minus'}">${bal0 >= 0 ? '+' : '−'}${yen(Math.abs(bal0))}</b></div></div>` : ''}
    <button class="btn text" data-act="txNewIncome" style="padding:0;min-height:40px;align-self:flex-start">${ic('income')}収入を記録</button>
    ${byCat.map(x => `<div class="bar"><span>${x.c}</span><span>${yen(x.spent)}${x.budget ? ' / ' + yen(x.budget) : ''}</span>
      ${x.budget ? `<i><b style="width:${Math.min(100, x.spent / x.budget * 100)}%;background:${x.spent > x.budget ? 'var(--red)' : 'var(--blue)'}"></b></i>` : ''}</div>`).join('')}
  </section>
  ${settleHtml}
  <section class="card list"><h2 class="group-title">記録(${tx.length}件)</h2>
    ${days.length ? days.map(d => `<h3 class="day-title">${md(d)}</h3>` + tx.filter(t => t.date === d).map(t => `<button class="row" data-act="txOpen" data-id="${t.id}" ${edge(t.paid_by)}>
      <span class="dot" style="background:${C.colorOf(t.paid_by)}"></span><span class="main"><span class="name">${esc(t.shop || t.category)}</span>
      <span class="sub">${isIncome(t) ? '<span class="ctag inc">収入</span>・' : ''}${t.category}・${who(t.paid_by)}が${isIncome(t) ? '受け取った' : '払った'}${t.scope === 'private' ? '・自分だけ' : ''}${t.fixed_cost_id ? '・固定費' : ''}${t.receipt_path ? '・写真あり' : ''}</span></span><b${isIncome(t) ? ' class="plus"' : ''}>${isIncome(t) ? '+' : ''}${yen(t.amount)}</b></button>`).join('')).join('')
      : '<p class="muted" style="margin:0 0 10px">この月の記録はまだありません</p>'}
    ${tx.length ? '<button class="btn text" data-act="csv">この月をCSVで書き出す</button>' : ''}</section>
`;
}
export function txFormHtml() {
  const { st, esc } = C, s = st.sheet, t = s.edit ? (st.tx || []).find(x => x.id === s.edit) : null;
  const kind = s.kind || (t ? t.kind || 'expense' : 'expense'), inc = kind === 'income', cats = inc ? INCOME_CATS : CATS;
  const def = cats.includes(s.cat) ? s.cat : inc ? '給与' : '食費';
  const date = s.date || (st.kb.month === thisMonth() ? today() : st.kb.month + '-01');
  const mine = !t || t.owner === st.me.user_id, scope = s.scope || (inc ? 'private' : 'shared');   // 収入は、初めは自分だけ
  const sc = (v, l) => `<option value="${v}" ${v === scope ? 'selected' : ''}>${l}</option>`;
  const kd = (v, l) => `<button type="button" class="${kind === v ? 'on' : ''}" data-act="txKind" data-v="${v}" aria-pressed="${kind === v}">${l}</button>`;
  return sheetWrap(t ? '記録を直す' : s.inbox ? 'カード利用を家計簿に記録' : inc ? '収入を記録' : '支出を記録', `<form class="stack" data-form="tx" novalidate>
    ${s.inbox ? '' : `<div class="seg two-seg" role="group" aria-label="支出か収入か">${kd('expense', '支出')}${kd('income', '収入')}</div>`}
    ${mine ? field('txScope', '見せる範囲', `<select id="txScope">${inc ? sc('private', '自分だけ(相手には見えません)') + sc('shared', 'ふたりに見せる') : sc('shared', 'ふたりの支出(精算の対象)') + sc('private', '自分だけ(相手には見えません)')}</select>`)
      : `<p class="muted hint" style="margin:0;font-size:0.8125rem">相手が記録した${inc ? '収入' : '支出'}なので、見せる範囲は相手だけが変えられます。</p>`}
    ${s.inbox ? `<p class="muted" style="margin:0">${esc(s.card || 'カード')}で払った分です。</p>` : ''}
    ${field('txAmt', '金額(円)', `<input id="txAmt" type="text" inputmode="numeric" maxlength="9" placeholder="例：1280" value="${s.amt || ''}">`)}
    <fieldset class="chips"><legend>分類</legend>${cats.map(c => `<label><input type="radio" name="cat" value="${c}" ${c === def ? 'checked' : ''}><span>${c}</span></label>`).join('')}</fieldset>
    ${field('txShop', inc ? '入ってきた先・内容(なくてもよい)' : 'お店・内容(なくてもよい)', `<input id="txShop" type="text" maxlength="40" placeholder="${inc ? '例:会社、証券会社' : '例：スーパー'}" value="${esc(s.shop || '')}">`)}
    <div class="two">${field('txDate', '日付', `<input id="txDate" type="date" value="${date}">`)}${field('txWho', inc ? '受け取った人' : '払った人', `<select id="txWho">${memberOpts(s.who || st.me.user_id)}</select>`)}</div>
    ${inc ? '<p class="muted hint" style="margin:0;font-size:0.8125rem">収入は、ふたりの支出・精算・予算には入りません。</p>' : ''}
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">${t ? '保存する' : '記録する'}</button>
    ${s.inbox ? '<button class="btn" type="button" data-act="inboxIgnore">家計簿に記録しない(仕事・アパートの分など)</button>' : ''}${closeBtn('やめる')}</form>`);
}
export function txSheetHtml() {
  const { st, esc } = C, s = st.sheet, t = (st.tx || []).find(x => x.id === s.id); if (!t) return '';
  return sheetWrap(`${esc(t.shop || t.category)} ${isIncome(t) ? '+' : ''}${yen(t.amount)}`, `<p class="muted" style="margin:0">${md(t.date)}・${isIncome(t) ? '収入・' : ''}${t.category}・${esc(C.nameOf(t.paid_by))}が${isIncome(t) ? '受け取った' : '払った'}・${t.scope === 'private' ? '自分だけ' : isIncome(t) ? 'ふたりに見せる' : 'ふたりの支出'}</p>
    ${!isIncome(t) ? `<button class="btn" data-act="deadlineNew" data-from="tx">${ic('alarm')}保証・契約の期限をやることに登録</button>` : ''}
    ${t.receipt_path ? (s.photo ? `<img class="rphoto" src="${esc(s.photo)}" alt="レシートの写真">` : `<button class="btn" data-act="photoShow" data-path="${esc(t.receipt_path)}">${ic('receipt')}レシートの写真を見る</button>`) : ''}
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
    ${field(p + 'Cyc', '払い方', `<select id="${p}Cyc" data-cyc="${p}">${o('monthly', f?.cycle || 'monthly', '毎月払う(金額は1か月分)')}${o('yearly', f?.cycle || 'monthly', '年に1回払う(金額は1年分)')}</select>`)}
    <div class="two">${field(p + 'Mon', '支払月', `<select id="${p}Mon" ${isYearly(f || {}) ? '' : 'disabled'}>${Array.from({ length: 12 }, (_, i) => o(String(i + 1), String(f?.pay_month || Number(today().slice(5, 7))), `${i + 1}月`)).join('')}</select>`)}${field(p + 'Day', '支払日', `<select id="${p}Day">${Array.from({ length: 31 }, (_, i) => o(String(i + 1), String(f?.pay_day || 1), i === 30 ? '末日' : `${i + 1}日`)).join('')}</select>`)}</div>
    ${field(p + 'Rec', '家計簿への記録', `<select id="${p}Rec">${o('on', f && !f.active ? 'off' : 'on', '支払日に自動で記録する')}${o('off', f && !f.active ? 'off' : 'on', '記録しない(金額を把握するだけ)')}</select>`)}
    ${mine ? field(p + 'Scope', '見せる範囲', `<select id="${p}Scope">${o('shared', f?.scope || 'shared', 'ふたりに見せる')}${o('private', f?.scope || 'shared', '自分だけ(相手には見えません)')}</select>`)
      : '<p class="muted hint" style="margin:0;font-size:0.8125rem">相手が登録した固定費なので、見せる範囲は相手だけが変えられます。</p>'}`;
}
function kbFixed() {
  const { st, esc } = C, fx = st.fixed || [], sum = a => a.reduce((x, f) => x + f.amount, 0);
  const rec = fx.filter(f => f.active), info = fx.filter(f => !f.active), mt = st.fixMatched || [];
  const sumM = a => a.reduce((x, f) => x + perMonth(f), 0), sumY = a => a.reduce((x, f) => x + perYear(f), 0);
  const row = f => `<button class="row" data-act="fixOpen" data-id="${f.id}" ${edge(f.paid_by)}><span class="main"><span class="name">${esc(f.name)}</span>
    <span class="sub">${cycText(f)}・${f.category}・${who(f.paid_by)}が払う${f.scope === 'private' ? '・自分だけ' : ''}</span></span><span class="amt"><b>${yen(f.amount)}${isYearly(f) ? '<small>/年</small>' : ''}</b><small>${isYearly(f) ? `月あたり ${yen(perMonth(f))}` : `年 ${yen(perYear(f))}`}</small></span></button>`;
  const group = (title, list, empty) => `<h3 class="sub-title">${title}(${list.length}件・月あたり${yen(sumM(list))})</h3>
    ${list.length ? list.map(row).join('') : `<p class="muted hint" style="margin:0 0 8px;font-size:0.8125rem">${empty}</p>`}`;
  const fname = id => fx.find(f => f.id === id)?.name || '(削除した固定費)';
  const now = st.kb.month === thisMonth(), done = new Set((st.tx || []).filter(t => t.fixed_cost_id).map(t => t.fixed_cost_id));
  const soon = now ? rec.filter(f => !done.has(f.id) && payThisMonth(f, thisMonth()) && payDate(thisMonth(), f.pay_day) > today()).sort((a, b) => (a.pay_day || 1) - (b.pay_day || 1)) : [];
  // 1年あたりで多い順(サブスクや保険の見直し用)
  const top = [...fx].sort((a, b) => perYear(b) - perYear(a)), maxY = Math.max(1, ...top.map(perYear));
  return `<section class="card"><div class="sum"><div><small>固定費 月あたり</small><b>${yen(sumM(fx))}</b></div><div><small>1年あたり</small><b>${yen(sumY(fx))}</b></div></div>
    <p class="muted hint" style="margin:6px 0 0;font-size:0.7812rem">年払いのものは12で割って月あたりに入れています。家計簿に記録するのは${yen(sumM(rec))}/月分です。</p></section>
  ${soon.length ? `<section class="card list"><h2 class="group-title">今月これから払う固定費(${soon.length}件・${yen(sum(soon))})</h2>
    ${soon.map(f => `<div class="row" ${edge(f.paid_by)}><span class="main"><span class="name">${esc(f.name)}</span><span class="sub">${md(payDate(thisMonth(), f.pay_day))}に記録します・${f.category}</span></span><b>${yen(f.amount)}</b></div>`).join('')}</section>` : ''}
  ${fx.length ? `<section class="card list"><h2 class="group-title">1年あたりで多い順(見直しの目安)</h2>
    ${top.slice(0, 8).map(f => `<div class="yrow"><span class="yname">${esc(f.name)}</span><span class="ybar"><i style="width:${Math.max(2, Math.round(perYear(f) / maxY * 100))}%"></i></span><b>${yen(perYear(f))}</b></div>`).join('')}
    <p class="muted hint" style="margin:8px 0 0;font-size:0.8125rem">サブスクや保険は、1年分にすると大きさが分かります。使っていないものがあれば、解約や安いプランを考えるきっかけにしてください。</p></section>` : ''}
  <section class="card list">${group('支払日に自動で記録', rec, '家賃・保険など、口座から払うものがおすすめです')}
    ${group('記録しない(把握だけ)', info, '金額を知っておきたいだけのものを入れます')}
    <p class="muted hint" style="margin:6px 0 0;font-size:0.8125rem">押すと、名前・金額・記録するかどうか・見せる範囲を直せます。</p></section>
  ${mt.length ? `<section class="card list"><h2 class="group-title">固定費で記録済みと判断したカード利用(${mt.length})</h2>
    <p class="muted hint" style="margin:0 0 4px;font-size:0.8125rem">固定費と同じ金額だったので、二重にならないよう確認待ちから外しました。違っていたら「取り消す」を押すと確認待ちに戻ります。</p>
    ${mt.map(i => `<div class="row"><span class="main"><span class="name">${esc(i.merchant || '(お店の名前なし)')} ${yen(i.amount)}</span>
      <span class="sub">${md(ymd(new Date(i.used_at)))}・${esc(i.card || 'カード')} → 固定費「${esc(fname(i.fixed_cost_id))}」</span></span>
      <button class="pill" data-act="fixUnmatch" data-id="${i.id}">取り消す</button></div>`).join('')}</section>` : ''}
  <form class="card stack" data-form="fix" novalidate><h2>固定費を追加</h2>${fxFields('fx')}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">追加する</button>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">カードで払う固定費も「記録する」で大丈夫です。同じ金額のカード利用が取り込まれたら、自動で見分けて二重に数えません。</p></form>`;
}
// 期限の登録:保証が切れる日・契約の更新日を、何日前かに「やること」として出す
export const DL_KINDS = [['warranty', '保証が切れる', '保証'], ['renew', '契約の更新・見直し', '更新'], ['other', 'そのほかの期限', '期限']];
export const addYears = (d, n) => { const x = dt(d); x.setFullYear(x.getFullYear() + n); return ymd(x); };
// 真ん中の「＋」:どの画面からでも追加
export function quickHtml() {
  const t = (to, k, l) => `<button class="qtile" data-act="quickGo" data-to="${to}">${ic(k)}<span>${l}</span></button>`;
  const f = (id, k, l, multi) => `<label class="qtile">${ic(k)}<span>${l}</span><input id="${id}" type="file" accept="image/*" ${multi ? 'multiple' : ''} hidden></label>`;
  return sheetWrap('追加する', `<div class="qgrid">${t('ev', 'cal', '予定')}${t('todo', 'todo', 'やること')}${t('shop', 'cart', '買い物')}${t('tx', 'wallet', '支出')}${t('inc', 'income', '収入')}${f('rcptFile', 'camera', 'レシートを撮る', true)}${f('paperFile', 'doc', '紙のお知らせ')}</div>${closeBtn()}`);
}
export function deadlineHtml() {
  const { esc } = C, s = C.st.sheet, o = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return sheetWrap('期限をやることに登録', `<form class="stack" data-form="deadline" novalidate>
    ${field('dlKind', '何の期限', `<select id="dlKind">${DL_KINDS.map(([v, l]) => o(v, s.kind, l)).join('')}</select>`)}
    ${field('dlName', '名前', `<input id="dlName" type="text" maxlength="30" value="${esc(s.name || '')}" placeholder="例:冷蔵庫、スマホの保険">`)}
    <div class="two">${field('dlDate', '期限日', `<input id="dlDate" type="date" value="${s.date}">`)}${field('dlBefore', '知らせる日', `<select id="dlBefore">${[[30, '30日前'], [14, '14日前'], [7, '7日前'], [0, '当日']].map(([v, l]) => o(String(v), '30', l)).join('')}</select>`)}</div>
    ${field('dlScope', '見せる範囲', `<select id="dlScope">${o('shared', s.scope, 'ふたりに見せる')}${o('private', s.scope, '自分だけ(相手には見えません)')}</select>`)}
    <p class="muted hint" style="margin:0;font-size:0.8125rem">「知らせる日」に、やることの「今日やること」に出て、朝7時の通知にも入ります。保証は、家電なら1年(メーカー保証)のことが多いので、保証書で確かめてください。</p>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">やることに登録</button>${closeBtn('やめる')}</form>`);
}
export function fixSheetHtml() {
  const { st, esc } = C, s = st.sheet, f = (st.fixed || []).find(x => x.id === s.id); if (!f) return '';
  return sheetWrap(`固定費「${esc(f.name)}」を直す`, `<form class="stack" data-form="fixEdit" novalidate>${fxFields('fe', f)}
    <p class="muted hint" style="margin:0;font-size:0.8125rem">見せる範囲を変えると、これまでにこの固定費から記録した分も同じ範囲に変わります。</p>
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">保存する</button></form>
    <button class="btn" data-act="deadlineNew" data-from="fix">${ic('alarm')}契約の更新日をやることに登録</button>
    <button class="btn danger" data-act="fixDel" data-id="${f.id}">この固定費を削除</button>${closeBtn()}`);
}
function kbBudget() {
  const { st } = C;
  return `<form class="card stack" data-form="budget" novalidate><h2>1か月の予算(ふたりの支出)</h2>
    ${CATS.map((c, i) => `<div class="brow"><label for="bg${i}">${c}</label><input id="bg${i}" type="text" inputmode="numeric" maxlength="9" placeholder="なし" value="${(st.budgets.find(b => b.category === c) || {}).amount || ''}"></div>`).join('')}
    <button class="btn primary" type="submit">保存する</button><p class="muted hint" style="margin:0;font-size:0.8125rem">空にすると、その分類の予算はなしになります。</p></form>`;
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
export function goalAddHtml() {
  const g = C.st.goals.find(x => x.id === C.st.sheet.id); if (!g) return '';
  return sheetWrap(`${C.esc(g.name)}に入金`, `<form class="stack" data-form="goalAdd" novalidate>
    ${field('gaAmt', '金額(円)。引き出すときは先頭に「-」', '<input id="gaAmt" type="text" inputmode="numeric" maxlength="10" placeholder="例：5000">')}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">記録する</button>${closeBtn('やめる')}</form>`);
}
export function bulkHtml() {
  const ib = C.st.inbox || [], total = ib.reduce((a, i) => a + i.amount, 0);
  return sheetWrap(`${ib.length}件をまとめて記録`, `<form class="stack" data-form="bulk" novalidate>
    <p class="muted" style="margin:0">それぞれ、一覧の「推測」の分類で家計簿に入ります(合計 ${yen(total)})。違う分類のものや、仕事・アパートの分が混ざっていたら、先にそれだけ1件ずつ直してから使ってください。</p>
    ${field('bkScope', '共有', '<select id="bkScope"><option value="private">自分だけ(相手には見えません)</option><option value="shared">ふたりの支出(精算の対象)</option></select>')}
    <button class="btn primary" type="submit">まとめて記録する</button>${closeBtn('やめる')}</form>`);
}
export function confirmHtml() {
  const s = C.st.sheet;
  return sheetWrap(s.title, `<p class="muted" style="margin:0">${s.note || '消したものは7日間、「設定 → ゴミ箱」から戻せます。'}</p>
    <button class="btn danger" data-act="${s.yes}" data-id="${s.id}">削除する</button>${closeBtn('やめる')}`);
}
export function csv() {
  const { st } = C, rows = [['日付', '金額', 'お店・内容', '分類', '払った人', '共有', '固定費']];
  [...st.tx].reverse().forEach(t => rows.push([t.date, isIncome(t) ? t.amount : -t.amount, t.shop || '', t.category, C.nameOf(t.paid_by), t.scope === 'shared' ? 'ふたり' : '自分だけ', t.fixed_cost_id ? '○' : '', isIncome(t) ? '収入' : '支出']));
  const text = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const file = new File([text], `家計簿_${st.kb.month}.csv`, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}
