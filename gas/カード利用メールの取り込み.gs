/**
 * ふたりの暮らし帳:カード利用メールの取り込み(Google Apps Script)。2026-11-21(セゾンの引き落とし予定を追加)
 *
 * Gmail に届くカードの利用通知メールを読み、お店・金額・日時を暮らし帳の「カード利用の確認待ち」へ送る。
 * 読むだけで、メールを消したり、ラベルを付けたり、送ったりはしない。
 * 同じメールを2回送っても、暮らし帳の側で1回分にまとめる(ウォレットで取り込み済みの支払いとも重ならない)。
 *
 * 対応しているメール
 *  - ANA JCB など JCB:「JCBカード／ショッピングご利用のお知らせ」「（売上到着分）JCBカード/ショッピングご利用のお知らせ」
 *  - 三井住友カード(Olive・Amazonマスター):「ご利用のお知らせ【三井住友カード】」
 *    ※「利用不可のお知らせ」(止められた支払い)は取り込まない
 *  - セゾンカード(三井ショッピングパークカードなど):「〇月お支払金額のお知らせ」
 *    → 使った分ではなく「引き落とし予定」として取り込む(家計簿の支出には入れない。口座へのご準備期日に「自分だけ」の予定を入れる)
 *    → にせメール対策:セゾンの署名(DKIM)が正しいメールだけを読む。メール内のリンクは開かない
 *
 * 使い方(README の手順どおり)
 *  1. 下の TOKEN に、暮らし帳アプリの「設定 → カード利用の取り込み」に出る「③ 取り込み用の鍵」を貼る
 *  2. 関数「backfill」を1回実行する(10月1日からの分をまとめて取り込む)
 *  3. 関数「setupTrigger」を1回実行する(毎日 朝7時台に、直近3日分を自動で読む)
 */

const TOKEN = 'ここに取り込み用の鍵を貼る';
const URL = 'https://nvvacuteciogpfvdjmwp.supabase.co/rest/v1/rpc/card_inbox_add';
const APIKEY = 'sb_publishable_Ulmut1q_CM0YTTa7s_o32Q_T9WpzcE0';
const FROM = 'from:(mail@qa.jcb.co.jp OR statement@vpass.ne.jp)';
const BILL_URL = 'https://nvvacuteciogpfvdjmwp.supabase.co/rest/v1/rpc/card_bill_add';
const BILL_FROM = 'from:(saisoncard.co.jp) subject:(お支払金額のお知らせ)';

/** 毎日動く:直近3日分 */
function daily() { importMails_(FROM + ' newer_than:3d'); importBills_(BILL_FROM + ' newer_than:7d'); }

/** 最初に1回:10月1日から */
function backfill() { importMails_(FROM + ' after:2026/10/01'); importBills_(BILL_FROM + ' after:2026/10/01'); }

/** セゾンの「お支払金額のお知らせ」だけを、今すぐ試す */
function testBills() { importBills_(BILL_FROM + ' newer_than:60d'); }

/** 毎日 朝7時台に daily を動かす設定(1回だけ実行する) */
function setupTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'daily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(7).inTimezone('Asia/Tokyo').create();
  Logger.log('毎日 朝7時台に動くよう設定しました');
}

function importMails_(query) {
  if (TOKEN.indexOf('ここに') === 0) throw new Error('TOKEN に取り込み用の鍵を貼ってください');
  const count = { ok: 0, dup: 0, skip: 0, ng: 0 };
  let start = 0;
  while (true) {
    const threads = GmailApp.search(query, start, 100);
    if (!threads.length) break;
    threads.forEach(th => th.getMessages().forEach(m => {
      const uses = parseMail(m.getSubject(), m.getPlainBody());
      if (!uses.length) { count.skip++; return; }
      uses.forEach((u, i) => {
        const r = send_(u, m.getId() + '#' + i);
        count[r]++;
      });
    }));
    start += threads.length;
  }
  Logger.log(`取り込み ${count.ok} 件 / 取り込み済み・重複 ${count.dup} 件 / 対象外のメール ${count.skip} 件 / 失敗 ${count.ng} 件`);
  return count;
}

function importBills_(query) {
  if (TOKEN.indexOf('ここに') === 0) throw new Error('TOKEN に取り込み用の鍵を貼ってください');
  const count = { ok: 0, dup: 0, skip: 0, fake: 0, ng: 0 };
  GmailApp.search(query, 0, 50).forEach(th => th.getMessages().forEach(m => {
    if (!isGenuineSaison(m.getRawContent())) { count.fake++; Logger.log('署名を確かめられないため読みません: ' + m.getSubject()); return; }
    const bills = parseBill(m.getSubject(), m.getPlainBody());
    if (!bills.length) { count.skip++; return; }
    bills.forEach((b, i) => {
      const res = UrlFetchApp.fetch(BILL_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { apikey: APIKEY },
        payload: JSON.stringify({ p_token: TOKEN, p_card: b.card, p_amount: String(b.amount), p_pay_date: b.payDate, p_prepare_date: b.prepareDate, p_ext_id: m.getId() + '#' + i }),
      });
      if (res.getResponseCode() !== 200) { Logger.log('失敗: ' + res.getContentText().slice(0, 200)); count.ng++; return; }
      const r = JSON.parse(res.getContentText());
      count[r === 'ok' ? 'ok' : r === 'dup' || r === 'zero' || r === 'updated' ? 'dup' : 'ng']++;
    });
  }));
  Logger.log(`引き落とし予定 ${count.ok} 件 / 取り込み済み ${count.dup} 件 / 読めないメール ${count.skip} 件 / 署名なし(にせメールの恐れ) ${count.fake} 件 / 失敗 ${count.ng} 件`);
  return count;
}

function send_(u, extId) {
  const res = UrlFetchApp.fetch(URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: APIKEY },
    payload: JSON.stringify({ p_token: TOKEN, p_card: u.card, p_merchant: u.merchant, p_amount: String(u.amount),
      p_used_at: u.usedAt, p_source: 'email', p_ext_id: extId }),
  });
  if (res.getResponseCode() !== 200) { Logger.log('失敗: ' + res.getContentText().slice(0, 200)); return 'ng'; }
  return JSON.parse(res.getContentText()) === 'dup' ? 'dup' : 'ok';
}

// ---------- メールの読み取り(試験しやすいよう、Gmail に頼らない形にしている) ----------
const nfkc = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const toIso = (d, t) => d.replace(/\//g, '-') + 'T' + (t || '00:00') + ':00+09:00';

function parseMail(subject, body) {
  const s = nfkc(subject), b = String(body || '').normalize('NFKC');
  if (s.indexOf('利用不可') >= 0) return [];
  // 三井住友カード
  if (s.indexOf('ご利用のお知らせ【三井住友カード】') >= 0) {
    const card = (b.match(/ご利用カード[::]\s*(.+)/) || [])[1];
    const dt = b.match(/◇利用日[::]\s*(\d{4}\/\d{2}\/\d{2})\s*(\d{2}:\d{2})?/);
    const shop = (b.match(/◇利用先[::]\s*(.+)/) || [])[1];
    const amt = (b.match(/◇利用金額[::]\s*([\d,]+)\s*円/) || [])[1];
    if (!dt || !amt) return [];
    return [{ card: nfkc(card || '三井住友カード'), merchant: nfkc(shop), amount: amt.replace(/,/g, ''), usedAt: toIso(dt[1], dt[2]) }];
  }
  if (s.indexOf('JCBカード') >= 0 && s.indexOf('ショッピングご利用のお知らせ') >= 0) {
    const card = nfkc((b.match(/カード名称\s*[::]\s*(.+)/) || [])[1] || 'JCBカード');
    // 売上到着分:◆ご利用1、◆ご利用2 … と複数並ぶ
    if (s.indexOf('売上到着分') >= 0) {
      return b.split(/◆ご利用\s*\d+/).slice(1).map(block => {
        const d = (block.match(/【ご利用日】\s*(\d{4}\/\d{2}\/\d{2})/) || [])[1];
        const amt = (block.match(/【ご利用金額】\s*([\d,]+)\s*円/) || [])[1];
        const shop = (block.match(/【ご利用先】\s*(.+)/) || [])[1];
        return d && amt ? { card, merchant: nfkc(shop), amount: amt.replace(/,/g, ''), usedAt: toIso(d) } : null;
      }).filter(Boolean);
    }
    // 使ったときの通知
    const dt = b.match(/【ご利用日時(?:\(日本時間\))?】\s*(\d{4}\/\d{2}\/\d{2})\s*(\d{2}:\d{2})?/);
    const amt = (b.match(/【ご利用金額】\s*([\d,]+)\s*円/) || [])[1];
    const shop = (b.match(/【ご利用先】\s*([^\n▼]+)/) || [])[1];
    if (!dt || !amt) return [];
    return [{ card, merchant: nfkc(shop), amount: amt.replace(/,/g, ''), usedAt: toIso(dt[1], dt[2]) }];
  }
  return [];
}

// ---------- セゾン「お支払金額のお知らせ」 ----------
// 本物のセゾンのメールか:受け取ったサーバーが「saisoncard.co.jp の署名(DKIM)が正しい」と確かめたものだけ
function isGenuineSaison(raw) {
  const head = String(raw || '').split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  return /^Authentication-Results:.*\bdkim=pass\b[^;]*header\.(?:d|i)=@?(?:[\w-]+\.)*saisoncard\.co\.jp(?=[\s;)]|$)/im.test(head);
}
const ymdJa = s => { const m = String(s || '').match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
// 本文:カード名 → お支払日 → 口座へのご準備期日 → お支払金額 の順。カードが複数並ぶこともある
function parseBill(subject, body) {
  if (nfkc(subject).indexOf('お支払金額のお知らせ') < 0) return [];
  const b = String(body || '').normalize('NFKC').replace(/\r/g, '');
  const parts = b.split(/お支払日(?!.*準備)/);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1].split('\n').map(nfkc).filter(Boolean);
    const card = before.filter(l => /カード/.test(l) && !/^セゾンカード$|SAISON|ご利用|お問い合わせ|ログイン/i.test(l) && l.length <= 40).pop() || 'セゾンカード';
    const seg = parts[i];
    const payDate = ymdJa(seg);
    const prepareDate = ymdJa((seg.match(/準備期日[\s\S]*?\d{4}年\s*\d{1,2}月\s*\d{1,2}日/) || [''])[0].replace(/^準備期日/, ''));
    const amt = (seg.match(/お支払金額\s*[::]?\s*([\d,]+)\s*円/) || [])[1];
    if (payDate && amt) out.push({ card, payDate, prepareDate, amount: amt.replace(/,/g, '') });
  }
  return out;
}

// node での試験用(Apps Script では使われない)
if (typeof module !== 'undefined') module.exports = { parseMail, parseBill, isGenuineSaison };
