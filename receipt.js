// ふたりの暮らし帳:レシート・紙の読み取り、買い物リストとの連動、消耗品の買い時
// ---------- レシート ----------
import { C, CATS, closeBtn, err, field, h, ic, md, memberOpts, sb, sheetWrap, toast, today, yen } from './core.js';
import { reloadInbox } from './features.js';
import { inboxDate } from './kakeibo.js';
export const catsOf = i => [...new Set((i.items || []).map(x => x.category))];
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
// レシートの写真を保存する(自分のフォルダへ)。失敗しても読み取りは続ける
async function savePhoto(b64) {
  try {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), path = `${C.st.me.user_id}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb().storage.from('receipts').upload(path, new Blob([bin], { type: 'image/jpeg' }), { contentType: 'image/jpeg', upsert: false });
    return error ? null : path;
  } catch { return null; }
}
// ---------- 消耗品の買い時 ----------
// 買い物リストに入れた日(最近8回)の間隔から「そろそろ買う頃」を見当付ける
export const pushDate = (arr, d) => { const a = [...(arr || [])]; if (a.at(-1) !== d) a.push(d); return a.slice(-8); };
export function soonItems(names, items, t = today()) {
  const inList = new Set((items || []).filter(i => !i.done).map(i => i.name)), day = d => Date.parse(d + 'T00:00:00Z') / 864e5;
  const out = [];
  for (const r of names || []) {
    const ds = [...new Set(r.added_dates || [])].sort(); if (r.hidden || inList.has(r.name) || ds.length < 3) continue;
    const gaps = ds.slice(1).map((d, i) => day(d) - day(ds[i])).sort((a, b) => a - b), every = gaps[Math.floor(gaps.length / 2)];   // 間隔の真ん中の値
    if (every < 3 || every > 120) continue;
    const since = day(t) - day(ds.at(-1));
    if (since >= every) out.push({ name: r.name, every, since });
  }
  return out.sort((a, b) => b.since / b.every - a.since / a.every).slice(0, 6);
}
export function soonHtml(names, items) {
  const list = soonItems(names, items); if (!list.length) return '';
  return `<section class="card soon"><h2 class="group-title">そろそろ買う頃かもしれません</h2>
    <div class="sugg soonchips">${list.map(x => `<button type="button" data-act="quick" data-name="${C.esc(x.name)}">${ic('plus')}${C.esc(x.name)}<small>だいたい${x.every}日ごと・前回${x.since}日前</small></button>`).join('')}</div>
    <p class="muted hint" style="margin:4px 0 0;font-size:0.7812rem">これまでリストに入れた間隔からの見当です。押すとリストに入ります。</p></section>`;
}
// レシートの品目と同じ買い物リストの品物に、チェックを付ける(ひらがな・カタカナは同じとみなす)
const kana = x => String(x || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s/g, '');
export function boughtItems(items, names) {
  const ns = (names || []).map(kana).filter(Boolean);
  return (items || []).filter(i => !i.done && kana(i.name) && ns.some(n => n.includes(kana(i.name)) || (n.length >= 2 && kana(i.name).includes(n))));
}
async function checkShopping(names) {
  const st = C.st, hit = boughtItems(st.items, names);
  for (const i of hit) { i.done = true; i.done_by = st.me.user_id; await C.send('shopping_items', 'update', { done: true, done_by: st.me.user_id }, { id: i.id }); }
  return hit.map(i => i.name);
}
// 紙のお知らせ・予約票から予定とやることの候補を読み取る(登録は、確かめてから)
export async function readPaper(file) {
  if (!file) return;
  if (C.st.rcBusy) return C.toast('いま取り込み中です。終わってから選んでください');
  C.st.rcBusy = { paper: true }; if (!C.st.sheet) C.render();
  C.toast('紙を読み取り中…(10秒ほどかかります)');
  try {
    const { data, error } = await sb().functions.invoke('receipt-read', { body: { image: await shrink(file), mime: 'image/jpeg', mode: 'paper' } });
    const msg = data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || (error && `読み取りの係から返事がありませんでした(${error.context?.status || '番号なし'})。時間切れのことがあります。少しおいて試してください`);
    if (msg) throw new Error(msg);
    if (!data?.paper?.items?.length) throw new Error('予定ややることを読み取れませんでした。受け取り係(receipt-read)が新しい版か確かめてください');
    C.st.sheet = { type: 'paper', form: true, title: data.paper.title, items: data.paper.items };
  } catch (e) { C.st.sheet = { type: 'info', title: '読み取れませんでした', lines: [e.message] }; }
  C.st.rcBusy = null; C.render();
}
export function paperHtml() {
  const { esc } = C, s = C.st.sheet, o = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return sheetWrap(s.title ? `「${esc(s.title)}」から` : '紙から読み取った候補', `<form class="stack" data-form="paper" novalidate>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">読み取った候補です。日付と名前を確かめ、登録するものに印を付けてください。</p>
    <div class="list">${s.items.map((x, n) => `<div class="prow" data-end="${esc(x.end_time || '')}" data-note="${esc(x.note || '')}">
      <label class="pcheck"><input type="checkbox" class="pon" checked aria-label="${esc(x.title)}を登録する"></label>
      <div class="pfields"><div class="two"><select class="ptype" aria-label="種類">${o('event', x.type, '予定')}${o('todo', x.type, 'やること')}</select><input type="date" class="pdate" value="${x.date}" aria-label="日付"></div>
        <input type="text" class="ptitle" maxlength="60" value="${esc(x.title)}" aria-label="名前">
        <input type="time" class="ptime" value="${x.time || ''}" aria-label="時刻(予定のとき)">
        ${x.note ? `<span class="muted" style="font-size:0.7812rem">メモ:${esc(x.note)}</span>` : ''}</div></div>`).join('')}</div>
    ${field('ppScope', '見せる範囲', `<select id="ppScope">${o('shared', 'shared', 'ふたりに見せる')}${o('private', '', '自分だけ(相手には見えません)')}</select>`)}
    <p class="err" id="err" hidden></p><button class="btn primary" type="submit">印を付けたものを登録</button>${closeBtn('やめる')}</form>`);
}
export async function readReceipts(files) {
  if (!files.length) return;
  if (C.st.rcBusy) return toast('いま取り込み中です。終わってから次のレシートを選んでください');
  let ok = 0, merged = 0, queued = 0; const errs = [], bought = [];
  // 取り込み中の印(家計簿の「レシートを読み込む」のところに、何枚目かと回る印を出す)。入力中の画面は崩さない
  const busy = v => { C.st.rcBusy = v; if (!C.st.sheet) C.render(); };
  try {
  for (const [n, f] of files.entries()) {
    busy({ n: n + 1, total: files.length });
    let path = null;
    try {
      const img = await shrink(f); path = await savePhoto(img);
      const { data, error } = await sb().functions.invoke('receipt-read', { body: { image: img, mime: 'image/jpeg' } });
      const msg = data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || (error && `読み取りの係から返事がありませんでした(${error.context?.status || '番号なし'})。時間切れのことがあります。少しおいて試してください`);
      if (msg) throw new Error(msg);
      if (path && data?.id) await sb().from('card_inbox').update({ receipt_path: path }).eq('id', data.id);   // 写真を確認待ちに結び付ける
      bought.push(...await checkShopping((data?.receipt?.items || []).map(x => x.name)));
      ok++; if (data.merged) merged++;
    } catch (e) {
      // 混み合い・時間切れなら、写真を「読み取り待ち」に入れて、あとで自動で読み直す
      if (path && retryable(e.message) && !(await sb().from('receipt_queue').insert({ household_id: h(), path })).error) queued++;
      else errs.push(`${n + 1}枚目:${e.message}`);
    }
  }
  } finally { C.st.rcBusy = null; }
  await reloadInbox(); C.render();
  toast(`${ok}枚を読み取りました${queued ? `。${queued}枚は混み合いのため「読み取り待ち」にしました(あとで自動で読み直します)` : ''}${merged ? `(${merged}枚はカード利用とまとめました)` : ''}${bought.length ? `。買い物リストの「${bought.slice(0, 3).join('・')}」${bought.length > 3 ? `ほか${bought.length - 3}件` : ''}にチェックを付けました` : ''}${errs.length ? `。読めなかったもの ${errs.length}枚` : ''}`);
  if (errs.length) setTimeout(() => alertBox(errs), 2300);
}
// 読み直してよい失敗か(混み合い・時間切れ・無料枠・返事なし)
const retryable = m => /混み合|返事|時間切れ|無料枠/.test(m || '');
// 読み取り待ちの「今すぐ読み直す」
export async function rqRetry(id) {
  if (C.st.rcBusy) return toast('いま取り込み中です。終わってから試してください');
  C.st.rcBusy = { n: 1, total: 1 }; if (!C.st.sheet) C.render();
  try {
    const { data, error } = await sb().functions.invoke('receipt-read', { body: { mode: 'retry', id } });
    const msg = data?.error || (error && ((await error.context?.json?.().catch(() => null))?.error || `読み取りの係から返事がありませんでした(${error.context?.status || '番号なし'})`));
    toast(msg ? `まだ読み取れませんでした:${msg}` : '読み取りました。「確認待ち」に入れました');
  } finally { C.st.rcBusy = null; }
  await reloadInbox(); C.render();
}
function alertBox(errs) { C.st.sheet = { type: 'info', title: '読み取れなかったレシート', lines: errs }; C.render(); }
export const infoHtml = () => sheetWrap(C.st.sheet.title, `<p class="muted" style="margin:0">${C.st.sheet.lines.map(C.esc).join('<br>')}</p>
  <p class="muted hint" style="margin:0;font-size:0.8125rem">明るい場所で、レシート全体が入るように撮り直すと読めることがあります。</p>${closeBtn()}`);
export function rcptHtml() {
  const { st, esc } = C, i = (st.inbox || []).find(x => x.id === st.sheet.id); if (!i) return '';
  const sum = i.items.reduce((a, x) => a + x.price, 0);
  return sheetWrap(`${esc(i.merchant)} ${yen(i.amount)}`, `<form class="stack" data-form="rcpt" novalidate>
    ${field('rcScope', '見せる範囲', '<select id="rcScope"><option value="shared">ふたりの支出(精算の対象)</option><option value="private">自分だけ(相手には見えません)</option></select>')}
    <p class="muted" style="margin:0">${md(inboxDate(i))}・${esc(i.card)}${i.note ? `<br><span style="color:var(--red)">${esc(i.note)}</span>` : ''}</p>
    ${i.receipt_path ? (st.sheet.photo ? `<img class="rphoto" src="${esc(st.sheet.photo)}" alt="レシートの写真">` : `<button type="button" class="btn" data-act="photoShow" data-path="${esc(i.receipt_path)}">${ic('receipt')}写真を見る(品目と見比べる)</button>`) : ''}
    <div class="items">${i.items.map((x, n) => `<div class="irow" data-i="${n}">
      <input type="text" class="iname" maxlength="40" value="${esc(x.name)}" aria-label="品名">
      <input type="text" class="iprice" inputmode="numeric" value="${x.price}" aria-label="金額">
      <select class="icat" aria-label="分類">${CATS.map(c => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`).join('')}</div>
    <p class="muted hint" style="margin:0;font-size:0.8125rem">品目の合計 ${yen(sum)}${sum !== i.amount ? `(支払額との差 ${yen(i.amount - sum)} は、いちばん大きい分類に「調整」として入れます)` : ''}</p>
    ${field('rcWho', '払った人', `<select id="rcWho">${memberOpts(st.me.user_id)}</select>`)}
    <p class="err" id="err" hidden></p>
    <button class="btn primary" type="submit">分類ごとに分けて記録する</button>
    <button class="btn" type="button" data-act="inboxIgnore">家計簿に記録しない(仕事・アパートの分など)</button>${closeBtn('やめる')}</form>`);
}
