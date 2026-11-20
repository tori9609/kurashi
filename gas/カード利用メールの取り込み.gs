/**
 * ふたりの暮らし帳:カード利用メールの取り込み(Google Apps Script)。2026-11-21
 *
 * Gmail に届くカードの利用通知メールを読み、お店・金額・日時を暮らし帳の「カード利用の確認待ち」へ送る。
 * 読むだけで、メールを消したり、ラベルを付けたり、送ったりはしない。
 * 同じメールを2回送っても、暮らし帳の側で1回分にまとめる(ウォレットで取り込み済みの支払いとも重ならない)。
 *
 * 対応しているメール
 *  - ANA JCB など JCB:「JCBカード／ショッピングご利用のお知らせ」「（売上到着分）JCBカード/ショッピングご利用のお知らせ」
 *  - 三井住友カード(Olive・Amazonマスター):「ご利用のお知らせ【三井住友カード】」
 *    ※「利用不可のお知らせ」(止められた支払い)は取り込まない
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

/** 毎日動く:直近3日分 */
function daily() { importMails_(FROM + ' newer_than:3d'); }

/** 最初に1回:10月1日から */
function backfill() { importMails_(FROM + ' after:2026/10/01'); }

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

// node での試験用(Apps Script では使われない)
if (typeof module !== 'undefined') module.exports = { parseMail };
