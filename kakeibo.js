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
function queueHtml() {
  const { st, esc } = C, q = st.rq || []; if (!q.length) return '';
  const when = d => new Date(d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<section class="card list"><h2 class="group-title">${ic('receipt')}読み取り待ちのレシート(${q.length})</h2>
    <p class="muted hint" style="margin:0 0 4px;font-size:0.8125rem">AIが混み合っていて読めなかった写真です。写真は保存してあり、時間をおいて自動で読み直します(10分→20分→40分…と間をあけます)。読めたら「確認待ち」に入ります。</p>
    ${q.map(x => `<div class="row"><span class="main"><span class="name">${when(x.created_at)}に撮ったレシート</span>
      <span class="sub">${x.status === 'failed' ? '<span style="color:var(--red)">自動の読み直しを止めました</span>' : `次の読み直し ${when(x.next_at)}ごろ`}・${x.tries}回試しました</span>
      ${x.last_error ? `<span class="sub">${esc(x.last_error.slice(0, 80))}</span>` : ''}</span>
      <button class="pill" data-act="rqRetry" data-id="${x.id}">今すぐ読む</button><button class="pill" data-act="rqDel" data-id="${x.id}">取り消す</button></div>`).join('')}</section>`;
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
// 負担の分け方:'equal'(空も)=割り勘、'u:<人>:70'=その人が70%、'y:<人>:820'=その人が820円。残りはほかの人で等分
const parseSplit = sp => { const m = /^([uy]):([0-9a-f-]{36}):(\d+)$/.exec(sp || ''); return m && C.st.members.some(x => x.user_id === m[2]) ? { yen: m[1] === 'y', uid: m[2], n: Number(m[3]) } : null; };
// 画面に出す短い言い方(割り勘のときは空)。budget=true は予算向けの「〇〇持ち」
export function splitText(sp, budget) {
  if (sp === 'deal') return '返してもらった額で済み';
  const p = parseSplit(sp); if (!p) return '';
  const n = C.nameOf(p.uid);
  return p.yen ? `${n}${yen(p.n)}負担` : p.n === 100 ? (budget ? `${n}持ち` : `${n}のおごり`) : `${n}${p.n % 10 ? p.n + '%' : p.n / 10 + '割'}負担`;
}
// 負担の分け方の入力欄(選ぶ欄+割合・金額の欄)。id は欄の名前の頭、budget=true は予算用(金額では決めない)、blank は先頭の空の選択肢
export function splitField(id, cur, { budget = false, blank = '' } = {}) {
  const p = parseSplit(cur), mode = cur === '' || cur == null ? (blank ? '' : 'equal') : cur === 'deal' && !budget ? 'deal' : !p ? 'equal' : p.yen ? 'a:' + p.uid : p.n === 100 ? 'u:' + p.uid + ':100' : 'p:' + p.uid;
  const o = (v, l) => `<option value="${v}" ${v === mode ? 'selected' : ''}>${l}</option>`;
  const opts = (blank ? o('', blank) : '') + o('equal', '割り勘(人数で等分)') + (budget ? '' : o('deal', '返してもらった額で済ませる(割合を決めない)')) + C.st.members.map(m => { const n = C.esc(m.display_name);
    return o(`u:${m.user_id}:100`, budget ? `${n}持ち` : `${n}のおごり(全額)`) + o('p:' + m.user_id, `${n}が割合で負担…`) + (budget ? '' : o('a:' + m.user_id, `${n}が金額で負担…`)); }).join('');
  const show = /^[pa]:/.test(mode), unit = mode.startsWith('a:') ? '円' : '%';
  return `<select id="${id}" data-split="${id}">${opts}</select>
    <div class="splitn" id="${id}Box" ${show ? '' : 'hidden'}><input id="${id}N" type="text" inputmode="numeric" maxlength="9" placeholder="${unit === '円' ? '例:820' : '例:70'}" value="${p && p.n !== 100 || p?.yen ? p.n : ''}" aria-label="負担の${unit === '円' ? '金額' : '割合'}"><span id="${id}U">${unit}</span></div>`;
}
// 入力欄から split を組み立てる。まちがいは { err }
export function readSplit(id, amount) {
  const v = (document.getElementById(id)?.value ?? '').trim(); if (!/^[pa]:/.test(v)) return { split: v || null };
  const raw = (document.getElementById(id + 'N')?.value ?? '').replace(/[\uFF10-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[,\uFF0C円%\uFF05\s]/g, '');
  const n = Number(raw), uid = v.slice(2);
  if (!raw || !Number.isInteger(n) || n < 0) return { err: '負担の割合・金額を数字で入れてください' };
  if (v.startsWith('p:')) return n > 100 ? { err: '割合は0〜100で入れてください' } : { split: `u:${uid}:${n}` };
  return amount && n > amount ? { err: '負担の金額が支払いの金額より大きくなっています' } : { split: `y:${uid}:${n}` };
}
// 1件の支出を、だれがいくら負担するかに分ける
function burden(t) {
  const ms = C.st.members, n = ms.length || 1, p = parseSplit(t.split), out = {};
  if (t.split === 'deal' && n >= 2) {   // ほかの人は返した額だけ、残りは払った人
    const r = Math.min(t.repaid_amount || 0, t.amount);
    ms.forEach(m => { out[m.user_id] = m.user_id === t.paid_by ? t.amount - r : r / (n - 1); }); return out;
  }
  if (!p || n < 2) { ms.forEach(m => { out[m.user_id] = t.amount / n; }); return out; }
  const mine = p.yen ? Math.min(p.n, t.amount) : t.amount * p.n / 100;
  ms.forEach(m => { out[m.user_id] = m.user_id === p.uid ? mine : (t.amount - mine) / (n - 1); });
  return out;
}
// 精算:ふたりの支出を負担の分け方どおりに割り、払った額との差を出す
// 返してもらった額は、払った人の「払った」から引き、ほかの人の「払った」に負担の割合で足す
export function settle() {
  const { st } = C, shared = (st.tx || []).filter(t => t.scope === 'shared' && !isIncome(t));
  const total = shared.reduce((a, t) => a + t.amount, 0), owe = {}, paid = {};
  shared.forEach(t => {
    const b = burden(t), r = Math.min(t.repaid_amount || 0, t.amount);
    for (const k in b) owe[k] = (owe[k] || 0) + b[k];
    paid[t.paid_by] = (paid[t.paid_by] || 0) + t.amount - r;
    if (r) { const others = st.members.filter(m => m.user_id !== t.paid_by), sum = others.reduce((a, m) => a + (b[m.user_id] || 0), 0);
      others.forEach(m => { paid[m.user_id] = (paid[m.user_id] || 0) + r * (sum ? (b[m.user_id] || 0) / sum : 1 / others.length); }); }
  });
  const bal = st.members.map(m => { const pd = paid[m.user_id] || 0, share = owe[m.user_id] || 0; return { m, paid: pd, share, diff: pd - share }; });
  const custom = shared.some(t => parseSplit(t.split) || t.split === 'deal' || t.repaid_amount);
  return { total, bal, custom };
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
  const { st } = C, mo = st.kb.month, sw = rvSwitch();
  if (st.kb.rv === 'year') return sw + kbYear();
  if (st.review?.mo !== mo) { st.review = { mo, rows: null }; loadReview(mo).then(() => C.render()).catch(() => {}); }
  const rows = st.review.rows;
  if (!rows) return sw + '<section class="card"><p class="muted" style="margin:0">読み込んでいます…</p></section>';
  const exp = rows.filter(t => t.scope === 'shared' && t.kind !== 'income');
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(mo, i - 5));
  const tot = months.map(m => exp.filter(t => t.date.startsWith(m)).reduce((a, t) => a + t.amount, 0)), max = Math.max(1, ...tot);
  const prev = shiftMonth(mo, -1), cur = tot.at(-1), pv = tot.at(-2);
  const diff = pv ? Math.round((cur - pv) / pv * 100) : null;
  const byCat = c => m => exp.filter(t => t.category === c && t.date.startsWith(m)).reduce((a, t) => a + t.amount, 0);
  const cats = CATS.map(c => ({ c, now: byCat(c)(mo), before: byCat(c)(prev) })).filter(x => x.now || x.before).sort((a, b) => b.now - a.now);
  const top = cats[0];
  const lbl = m => `${Number(m.slice(5))}月`;
  return sw + `<section class="card"><h2>${lbl(mo)}のふたりの支出</h2>
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
// ふり返りの「月ごと/1年」の切り替え
const rvSwitch = () => { const v = C.st.kb.rv || 'month';
  return `<div class="seg" role="tablist" style="grid-template-columns:repeat(2,1fr)">${[['month', '月ごと'], ['year', '1年']].map(([k, l]) => `<button role="tab" aria-selected="${v === k}" data-act="kbRv" data-v="${k}">${l}</button>`).join('')}</div>`; };
// 1年(1月〜12月)の記録をまとめて読む。1回で返る件数に上限(1000件)があるので、1000件ずつ分けて読む
async function loadYear(y) {
  const rows = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb().from('transactions').select('id,date,amount,shop,category,scope,kind,paid_by,split,repaid_amount,fixed_cost_id')
      .eq('household_id', h()).is('deleted_at', null).gte('date', `${y}-01-01`).lt('date', `${y + 1}-01-01`).order('date').order('id').range(i, i + 999);
    if (error) break;
    rows.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  C.st.year = { y, rows };
}
// 「ふたりの分」はふたりの記録だけ、「自分だけの分も入れる」は自分だけの記録(自分にしか見えない)も足す
const yearRows = () => { const { st } = C; return (st.year?.rows || []).filter(t => st.kb.mine || t.scope === 'shared'); };
const man = v => v >= 10000 ? Math.round(v / 10000) + '万' : v ? Math.round(v / 1000) + '千' : '';
function kbYear() {
  const { st } = C, kb = st.kb, y = kb.year ||= Number(kb.month.slice(0, 4));
  if (st.year?.y !== y) { st.year = { y, rows: null }; loadYear(y).then(() => C.render()).catch(() => {}); }
  const head = `<section class="card" style="padding:10px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between"><button class="iconbtn" data-act="kbYr" data-n="-1" aria-label="前の年">${ic('left')}</button><b style="font-size:1.125rem">${y}年(1月〜12月)</b><button class="iconbtn" data-act="kbYr" data-n="1" aria-label="次の年">${ic('right')}</button></div>
    <div class="seg" role="tablist" style="grid-template-columns:repeat(2,1fr)">${[[0, 'ふたりの分'], [1, '自分だけの分も入れる']].map(([k, l]) => `<button role="tab" aria-selected="${(kb.mine ? 1 : 0) === k}" data-act="kbMine" data-v="${k}">${l}</button>`).join('')}</div></section>`;
  if (!st.year.rows) return head + '<section class="card"><p class="muted" style="margin:0">読み込んでいます…</p></section>';
  const rows = yearRows(), sum = a => a.reduce((x, t) => x + t.amount, 0), exp = rows.filter(t => !isIncome(t)), inc = rows.filter(isIncome);
  if (!rows.length) return head + `<section class="card"><p class="muted" style="margin:0">${y}年の記録はありません</p></section>`;
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const mE = months.map(m => sum(exp.filter(t => t.date.startsWith(m)))), mI = months.map(m => sum(inc.filter(t => t.date.startsWith(m))));
  const tE = sum(exp), tI = sum(inc), n = mE.filter(v => v).length, avg = v => yen(n ? Math.round(v / n) : 0), max = Math.max(1, ...mE), cur = thisMonth();
  const cats = CATS.map(c => ({ c, v: sum(exp.filter(t => t.category === c)) })).filter(x => x.v).sort((a, b) => b.v - a.v);
  const icats = INCOME_CATS.map(c => ({ c, v: sum(inc.filter(t => t.category === c)) })).filter(x => x.v);
  const bal = tI - tE;
  return head + `<section class="card"><div class="sum"><div><small>支出の合計</small><b>${yen(tE)}</b></div><div><small>月あたり(記録のある${n}か月)</small><b>${avg(tE)}</b></div></div>
    ${tI ? `<div class="sum"><div><small>収入の合計</small><b class="plus">+${yen(tI)}</b></div><div><small>収支(収入 − 支出)</small><b class="${bal >= 0 ? 'plus' : 'minus'}">${bal >= 0 ? '+' : '−'}${yen(Math.abs(bal))}</b></div></div>` : ''}</section>
  <section class="card"><h2 class="group-title">月ごとの支出</h2>
    <div class="rbars" style="grid-template-columns:repeat(12,1fr);gap:2px" role="img" aria-label="${y}年の月ごとの支出">${months.map((m, i) => `<div class="rbar${m === cur ? ' cur' : ''}"><span class="v">${man(mE[i])}</span><i style="height:${Math.round(mE[i] / max * 100)}%;width:80%"></i><span class="m">${i + 1}</span></div>`).join('')}</div></section>
  <section class="card list"><h2 class="group-title">分類ごとの支出(1年)</h2>
    <table class="rtable"><thead><tr><th>分類</th><th>1年</th><th>月あたり</th><th>割合</th></tr></thead><tbody>${cats.map(x => `<tr><td>${x.c}</td><td>${yen(x.v)}</td><td>${avg(x.v)}</td><td>${Math.round(x.v / tE * 100)}%</td></tr>`).join('')}</tbody></table>
    ${icats.length ? `<table class="rtable" style="margin-top:10px"><thead><tr><th>収入の分類</th><th>1年</th><th>割合</th></tr></thead><tbody>${icats.map(x => `<tr><td>${x.c}</td><td class="plus">+${yen(x.v)}</td><td>${Math.round(x.v / tI * 100)}%</td></tr>`).join('')}</tbody></table>` : ''}</section>
  <section class="card list"><h2 class="group-title">月ごとの表</h2>
    <table class="rtable"><thead><tr><th>月</th><th>支出</th>${tI ? '<th>収入</th><th>収支</th>' : ''}</tr></thead><tbody>${months.map((m, i) => mE[i] || mI[i] ? `<tr><td><button class="btn text" data-act="kbGoMonth" data-m="${m}" style="padding:0;min-height:36px">${i + 1}月</button></td><td>${yen(mE[i])}</td>${tI ? `<td class="plus">${mI[i] ? '+' + yen(mI[i]) : ''}</td><td class="${mI[i] - mE[i] >= 0 ? 'plus' : 'minus'}">${mI[i] - mE[i] >= 0 ? '+' : '−'}${yen(Math.abs(mI[i] - mE[i]))}</td>` : ''}</tr>` : '').join('')}
      <tr><td><b>合計</b></td><td><b>${yen(tE)}</b></td>${tI ? `<td class="plus"><b>+${yen(tI)}</b></td><td class="${bal >= 0 ? 'plus' : 'minus'}"><b>${bal >= 0 ? '+' : '−'}${yen(Math.abs(bal))}</b></td>` : ''}</tr></tbody></table>
    <button class="btn text" data-act="csvYear">この1年をCSVで書き出す(${rows.length}件)</button>
    <p class="muted hint" style="margin:6px 0 0;font-size:0.8125rem">${kb.mine ? 'ふたりの記録と、自分だけの記録(自分にしか見えない分)を合わせています。' : 'ふたりの記録だけを数えています(自分だけの記録は入りません)。'}月の名前を押すと、その月の記録を開きます。</p></section>`;
}
function kbList() {
  const { st, esc } = C, tx = st.tx || [];
  const { total, bal, custom } = settle();
  const priv = tx.filter(t => t.scope === 'private' && !isIncome(t)).reduce((a, t) => a + t.amount, 0);
  const inc = tx.filter(isIncome), me = st.me.user_id, sumOf = a => a.reduce((x, t) => x + t.amount, 0);
  const myIn = sumOf(inc.filter(t => t.paid_by === me)), myOut = sumOf(tx.filter(t => !isIncome(t) && t.paid_by === me)), bal0 = myIn - myOut;
  const byCat = CATS.map(c => ({ c, spent: tx.filter(t => t.scope === 'shared' && !isIncome(t) && t.category === c).reduce((a, t) => a + t.amount, 0), budget: (st.budgets.find(b => b.category === c) || {}).amount || 0, sp: splitText((st.budgets.find(b => b.category === c) || {}).split, true) }))
    .filter(x => x.spent || x.budget);
  const settled = st.settles.find(s => s.month === st.kb.month);
  let settleHtml = '';
  if (st.members.length >= 2 && total) {
    const sorted = [...bal].sort((a, b) => a.diff - b.diff);
    const msg = st.members.length === 2
      ? (Math.round(sorted[1].diff) > 0 ? `<b>${esc(sorted[0].m.display_name)}さん → ${esc(sorted[1].m.display_name)}さんに ${yen(sorted[1].diff)}</b> 払うと${custom ? '決めた負担どおり' : '半分ずつ'}になります` : `ちょうど${custom ? '決めた負担どおり' : '半分ずつ'}です`)
      : bal.map(b => `${esc(b.m.display_name)}:${b.diff >= 0 ? '+' : '−'}${yen(Math.abs(b.diff))}`).join(' / ');
    settleHtml = `<section class="card"><h2>精算(ふたりの支出を負担の分け方どおりに割る)</h2>
      ${bal.map(b => `<p style="margin:0">${esc(b.m.display_name)}さん:払った ${yen(Math.round(b.paid))}・負担 ${yen(Math.round(b.share))}</p>`).join('')}
      ${tx.some(t => t.repaid_amount && t.scope === 'shared') ? '<p class="muted" style="margin:0;font-size:0.8125rem">「払った」は、その場で返してもらった額をやりとりしたあとの額です。</p>' : ''}<p style="margin:0">${msg}</p>
      ${settled ? `<p class="muted" style="margin:0">${new Date(settled.settled_at).toLocaleDateString('ja-JP')}に${esc(C.nameOf(settled.settled_by))}さんが精算済みにしました</p><button class="btn" data-act="unsettle">精算済みを取り消す</button>`
        : '<button class="btn green" data-act="settle">精算済みにする</button>'}</section>`;
  }
  const days = [...new Set(tx.map(t => t.date))];
  const rb = st.rcBusy;
  return `${rb ? `<section class="card" style="padding:12px 16px" aria-live="polite"><div class="btn green" role="status" aria-busy="true" style="display:flex;align-items:center;justify-content:center;gap:10px;opacity:.85;cursor:default">
      <span class="spin" aria-hidden="true"></span>${rb.paper ? '紙を読み取り中…' : `取り込み中… ${rb.n}/${rb.total}枚`}</div>
    <p class="muted hint" style="margin:0;font-size:0.75rem">AIが${rb.paper ? '紙' : 'レシート'}を読み取っています(1枚10秒ほど)。終わると${rb.paper ? '候補の画面が開きます' : '「確認待ち」に入ります'}。ほかの画面に移っても続きます。</p></section>`
  : `<section class="card" style="padding:12px 16px"><label class="btn green" style="display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">
      ${ic('camera')}レシートを読み込む<input id="rcptFile" type="file" accept="image/*" multiple hidden></label>
    <p class="muted hint" style="margin:0;font-size:0.75rem">撮影するか、写真を何枚か選ぶと、品目ごとに読み取って「確認待ち」に入れます(読み取りはGoogleのGeminiを使います)。</p></section>`}
  ${billsHtml()}${missesHtml()}${queueHtml()}${inboxHtml()}<section class="card"><div class="sum"><div><small>ふたりの支出</small><b>${yen(total)}</b></div><div><small>自分だけの支出</small><b>${yen(priv)}</b></div></div>
    ${inc.length ? `<div class="sum"><div><small>収入(見えている分)</small><b class="plus">+${yen(sumOf(inc))}</b></div><div><small>自分の収支(自分の収入 − 自分が払った分)</small><b class="${bal0 >= 0 ? 'plus' : 'minus'}">${bal0 >= 0 ? '+' : '−'}${yen(Math.abs(bal0))}</b></div></div>` : ''}
    <button class="btn text" data-act="txNewIncome" style="padding:0;min-height:40px;align-self:flex-start">${ic('income')}収入を記録</button>
    ${byCat.map(x => `<div class="bar"><span>${x.c}${x.sp ? `<small class="muted">(${esc(x.sp)})</small>` : ''}</span><span>${yen(x.spent)}${x.budget ? ' / ' + yen(x.budget) : ''}</span>
      ${x.budget ? `<i><b style="width:${Math.min(100, x.spent / x.budget * 100)}%;background:${x.spent > x.budget ? 'var(--red)' : 'var(--blue)'}"></b></i>` : ''}</div>`).join('')}
  </section>
  ${settleHtml}
  <section class="card list"><h2 class="group-title">記録(${tx.length}件)</h2>
    ${days.length ? days.map(d => `<h3 class="day-title">${md(d)}</h3>` + tx.filter(t => t.date === d).map(t => `<button class="row" data-act="txOpen" data-id="${t.id}" ${edge(t.paid_by)}>
      <span class="dot" style="background:${C.colorOf(t.paid_by)}"></span><span class="main"><span class="name">${esc(t.shop || t.category)}</span>
      <span class="sub">${isIncome(t) ? '<span class="ctag inc">収入</span>・' : ''}${t.category}・${who(t.paid_by)}が${isIncome(t) ? '受け取った' : '払った'}${t.scope === 'private' ? '・自分だけ' : splitText(t.split) ? '・' + esc(splitText(t.split)) : ''}${t.repaid_amount && t.scope === 'shared' ? `・${yen(t.repaid_amount)}返金済み` : ''}${t.fixed_cost_id ? '・固定費' : ''}${t.receipt_path ? '・写真あり' : ''}</span></span><b${isIncome(t) ? ' class="plus"' : ''}>${isIncome(t) ? '+' : ''}${yen(t.amount)}</b></button>`).join('')).join('')
      : '<p class="muted" style="margin:0 0 10px">この月の記録はまだありません</p>'}
    ${tx.length ? '<button class="btn text" data-act="csv">この月をCSVで書き出す</button>' : ''}</section>
`;
}
// 入れないといけない欄(ラベルに「必須」をつけて目立たせる)
const reqField = (id, label, inner) => `<div class="field req"><label for="${id}">${label}<span class="reqmark">必須</span></label>${inner}</div>`;
export function txFormHtml() {
  const { st, esc } = C, s = st.sheet, t = s.edit ? (st.tx || []).find(x => x.id === s.edit) : null;
  const kind = s.kind || (t ? t.kind || 'expense' : 'expense'), inc = kind === 'income', cats = inc ? INCOME_CATS : CATS;
  const def = cats.includes(s.cat) ? s.cat : inc ? '給与' : '食費';
  const date = s.date || (st.kb.month === thisMonth() ? today() : st.kb.month + '-01');
  const mine = !t || t.owner === st.me.user_id, scope = s.scope || t?.scope || (inc ? 'private' : 'shared');   // 収入は、初めは自分だけ
  const sc = (v, l) => `<option value="${v}" ${v === scope ? 'selected' : ''}>${l}</option>`;
  const kd = (v, l) => `<button type="button" class="${kind === v ? 'on' : ''}" data-act="txKind" data-v="${v}" aria-pressed="${kind === v}">${l}</button>`;
  return sheetWrap(t ? '記録を直す' : s.inbox ? 'カード利用を家計簿に記録' : inc ? '収入を記録' : '支出を記録', `<form class="stack" data-form="tx" novalidate>
    ${s.inbox ? '' : `<div class="seg two-seg" role="group" aria-label="支出か収入か">${kd('expense', '支出')}${kd('income', '収入')}</div>`}
    ${s.inbox ? `<p class="muted" style="margin:0">${esc(s.card || 'カード')}で払った分です。</p>` : ''}
    ${reqField('txAmt', '金額(円)', `<input id="txAmt" class="big" type="text" inputmode="numeric" maxlength="9" placeholder="例:1280" value="${s.amt || ''}" required>`)}
    <fieldset class="chips req"><legend>分類<span class="reqmark">必須</span></legend>${cats.map(c => `<label><input type="radio" name="cat" value="${esc(c)}" ${c === def ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}
      ${s.catAdd ? '' : `<button type="button" class="chipadd" data-act="catAddOpen">＋ 分類を足す</button>`}</fieldset>
    ${s.catAdd ? `<div class="catadd"><input id="txNewCat" type="text" maxlength="12" placeholder="例:ペット" aria-label="足す分類の名前"><button type="button" class="btn" data-act="catAdd">足す</button></div>
      <p class="muted hint" style="margin:-6px 0 0;font-size:0.8125rem">足した分類はふたりの一覧に入ります。外すときは「予算」のいちばん下から。</p>` : ''}
    ${mine ? field('txScope', '見せる範囲', `<select id="txScope">${inc ? sc('private', '自分だけ(相手には見えません)') + sc('shared', 'ふたりに見せる') : sc('shared', 'ふたりの支出(精算の対象)') + sc('private', '自分だけ(相手には見えません)')}</select>`)
      : `<p class="muted hint" style="margin:0;font-size:0.8125rem">相手が記録した${inc ? '収入' : '支出'}なので、見せる範囲は相手だけが変えられます。</p>`}
    ${inc ? '' : `<div class="stack sharebox" id="txShareBox" ${scope === 'shared' ? '' : 'hidden'}>
      ${field('txSplit', '負担の分け方', s.split !== undefined ? splitField('txSplit', s.split, t ? {} : { blank: '分類のめやすどおり(決めていなければ割り勘)' }) : t ? splitField('txSplit', t.split || 'equal') : splitField('txSplit', '', { blank: '分類のめやすどおり(決めていなければ割り勘)' }))}
      ${field('txRepaid', '払った人が、その場で返してもらった額(円・なくてもよい)', `<input id="txRepaid" type="text" inputmode="numeric" maxlength="9" placeholder="例:820" value="${s.repaid ?? t?.repaid_amount ?? ''}">`)}</div>`}
    ${field('txShop', inc ? '入ってきた先・内容(なくてもよい)' : 'お店・内容(なくてもよい)', `<input id="txShop" type="text" maxlength="40" placeholder="${inc ? '例:会社、証券会社' : '例:スーパー'}" value="${esc(s.shop || '')}">`)}
    <div class="two">${field('txDate', '日付', `<input id="txDate" type="date" value="${date}">`)}${field('txWho', inc ? '受け取った人' : '払った人', `<select id="txWho">${memberOpts(s.who || st.me.user_id)}</select>`)}</div>
    ${inc ? '<p class="muted hint" style="margin:0;font-size:0.8125rem">収入は、ふたりの支出・精算・予算には入りません。</p>' : ''}
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">${t ? '保存する' : '記録する'}</button>
    ${s.inbox ? '<button class="btn" type="button" data-act="inboxIgnore">家計簿に記録しない(仕事・アパートの分など)</button>' : ''}${closeBtn('やめる')}</form>`);
}
export function txSheetHtml() {
  const { st, esc } = C, s = st.sheet, t = (st.tx || []).find(x => x.id === s.id); if (!t) return '';
  return sheetWrap(`${esc(t.shop || t.category)} ${isIncome(t) ? '+' : ''}${yen(t.amount)}`, `<p class="muted" style="margin:0">${md(t.date)}・${isIncome(t) ? '収入・' : ''}${t.category}・${esc(C.nameOf(t.paid_by))}が${isIncome(t) ? '受け取った' : '払った'}・${t.scope === 'private' ? '自分だけ' : isIncome(t) ? 'ふたりに見せる' : 'ふたりの支出・' + esc(splitText(t.split) || '割り勘') + (t.repaid_amount ? `・${yen(t.repaid_amount)}返金済み` : '')}</p>
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
  // 種類ごとに行をそろえる(予定/やること・買い物/お金)
  const g = (label, tiles) => `<p class="qlabel">${label}</p><div class="qgrid">${tiles}</div>`;
  return sheetWrap('追加する', `<div class="qgroups">${g('予定', t('ev', 'cal', '予定') + f('paperFile', 'doc', '紙のお知らせ'))}${g('やること・買い物', t('todo', 'todo', 'やること') + t('shop', 'cart', '買い物'))}${g('お金', t('tx', 'wallet', '支出') + t('inc', 'income', '収入') + f('rcptFile', 'camera', 'レシートを撮る', true))}</div>${closeBtn()}`);
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
  const { st, esc } = C, bOf = c => st.budgets.find(b => b.category === c) || {};
  // 予算を負担のめやすで割った、ひとりあたりのおおよその額
  const est = {}; st.budgets.filter(b => b.amount > 0).forEach(b => { const x = burden(b); for (const k in x) est[k] = (est[k] || 0) + x[k]; });
  const estHtml = st.members.length >= 2 && Object.keys(est).length
    ? `<p class="muted" style="margin:0;font-size:0.8125rem">負担のめやす:${st.members.map(m => `${esc(m.display_name)}さん 約${yen(Math.round((est[m.user_id] || 0) / 1000) * 1000)}`).join('・')}</p>` : '';
  return `<form class="card stack" data-form="budget" novalidate><h2>1か月の予算(ふたりの支出)</h2>
    ${CATS.map((c, i) => `<div class="brow"><label for="bg${i}">${c}</label><input id="bg${i}" type="text" inputmode="numeric" maxlength="9" placeholder="なし" value="${bOf(c).amount || ''}"></div>
      <div class="brow bsp"><span></span><div>${splitField('bs' + i, bOf(c).split || 'equal', { budget: true })}</div></div>`).join('')}
    ${estHtml}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">保存する</button><p class="muted hint" style="margin:0;font-size:0.8125rem">空にすると、その分類の予算はなしになります。下の欄は「だれが持つか」のめやすで、その分類の支出を記録するときの初めの負担の分け方になります(記録ごとに変えられます)。</p></form>
  ${catListHtml()}`;
}
// 自分で足した分類の一覧(外せる)
function catListHtml() {
  const { st, esc } = C, mine = st.customCats || [];
  return `<section class="card stack"><h2>自分で足した分類</h2>
    ${mine.length ? mine.map(c => `<div class="brow"><span>${esc(c.name)}${c.kind === 'income' ? '(収入)' : ''}</span><button class="btn ${st.catDelConfirm === c.name ? 'danger' : 'text'}" data-act="catDel" data-v="${esc(c.name)}">${st.catDelConfirm === c.name ? 'もう一度押すと外します' : '一覧から外す'}</button></div>`).join('')
      : '<p class="muted" style="margin:0">まだありません。記録の画面の「＋ 分類を足す」から足せます。</p>'}
    <p class="muted hint" style="margin:0;font-size:0.8125rem">外しても、これまでの記録の分類はそのまま残ります。</p></section>`;
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
const CSV_HEAD = ['日付', '金額', 'お店・内容', '分類', '払った人', '共有', '固定費', '種類', '負担の分け方'];
const csvRow = t => [t.date, isIncome(t) ? t.amount : -t.amount, t.shop || '', t.category, C.nameOf(t.paid_by), t.scope === 'shared' ? 'ふたり' : '自分だけ', t.fixed_cost_id ? '○' : '', isIncome(t) ? '収入' : '支出', t.scope === 'shared' && !isIncome(t) ? (splitText(t.split) || '割り勘') + (t.repaid_amount ? `(${t.repaid_amount}円返金済み)` : '') : ''];
function saveCsv(rows, name) {
  const text = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const file = new File([text], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}
export function csv() {
  const { st } = C;
  return saveCsv([CSV_HEAD, ...[...st.tx].reverse().map(csvRow)], `家計簿_${st.kb.month}.csv`);
}
export function csvYear() {
  const { st } = C;
  return saveCsv([CSV_HEAD, ...yearRows().map(csvRow)], `家計簿_${st.kb.year}年_${st.kb.mine ? '自分の分も含む' : 'ふたり'}.csv`);
}
