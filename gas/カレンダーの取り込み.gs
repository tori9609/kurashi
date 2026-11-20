/**
 * ふたりの暮らし帳:Googleカレンダーの取り込み(Google Apps Script)。2026-11-21
 *
 * このスクリプトを入れたGoogleアカウントの「自分のカレンダー」の予定を、暮らし帳の「予定」へ送る。
 * 範囲は今日から60日先まで。1時間ごとに、追加・変更・削除を反映する。カレンダーは読むだけで、書き換えない。
 *
 * - 新しく取り込んだ予定は「自分だけ」(同居人には見えない)。アプリで1件ずつ「ふたりに見せる」にできる。
 * - SHARE に名前を書いたカレンダーは、最初から「ふたりに見せる」で取り込む。
 * - SKIP に名前を書いたカレンダーは取り込まない(仕事用など)。
 * - 大学のアドレスと dg のアドレスの両方で、それぞれ新しいプロジェクトを作って同じものを入れる。
 *
 * 使い方
 *  1. 下の CAL_TOKEN に「③ 取り込み用の鍵」を貼る(カード利用メールの取り込みと同じ鍵)
 *  2. 関数「listCalendars」を実行して、カレンダーの名前を確かめる(SKIP・SHARE を決めるときに使う)
 *  3. 関数「syncCalendars」を1回実行する(初回の取り込み)
 *  4. 関数「setupCalendarTrigger」を1回実行する(1時間ごとに自動で動く)
 */

const CAL_TOKEN = 'ここに取り込み用の鍵を貼る';
const CAL_URL = 'https://nvvacuteciogpfvdjmwp.supabase.co/rest/v1/rpc/calendar_sync';
const CAL_APIKEY = 'sb_publishable_Ulmut1q_CM0YTTa7s_o32Q_T9WpzcE0';
const CAL_DAYS = 60;
const SKIP = [];   // 例:['仕事']
const SHARE = [];  // 例:['ふたりの予定']

function listCalendars() {
  CalendarApp.getAllOwnedCalendars().forEach(c => Logger.log(`${c.getName()}${SKIP.includes(c.getName()) ? '(取り込まない)' : SHARE.includes(c.getName()) ? '(ふたりに見せる)' : '(自分だけ)'}`));
}

function setupCalendarTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncCalendars').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCalendars').timeBased().everyHours(1).create();
  Logger.log('1時間ごとに動くよう設定しました');
}

function syncCalendars() {
  if (CAL_TOKEN.indexOf('ここに') === 0) throw new Error('CAL_TOKEN に取り込み用の鍵を貼ってください');
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + CAL_DAYS * 864e5);
  CalendarApp.getAllOwnedCalendars().filter(c => !SKIP.includes(c.getName())).forEach(cal => {
    const events = cal.getEvents(from, to).map(e => toRow(e, from)).filter(Boolean);
    const res = UrlFetchApp.fetch(CAL_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { apikey: CAL_APIKEY },
      payload: JSON.stringify({ p_token: CAL_TOKEN, p_calendar_id: cal.getId(), p_calendar_name: cal.getName(),
        p_from: ymd(from), p_to: ymd(to), p_events: events, p_share: SHARE.includes(cal.getName()) }),
    });
    Logger.log(`${cal.getName()}: ${events.length}件 → ${res.getResponseCode() === 200 ? res.getContentText() : '失敗 ' + res.getContentText().slice(0, 200)}`);
  });
}

// ---------- 予定1件を暮らし帳の形にする(試験しやすいよう、Google に頼らない形にしている) ----------
const TZ = 'Asia/Tokyo';
function fmt(d, f) { return typeof Utilities !== 'undefined' ? Utilities.formatDate(d, TZ, f) : fmtLocal(d, f); }
function fmtLocal(d, f) {  // node での試験用(日本時間で書く)
  const j = new Date(d.getTime() + 9 * 3600e3), p = n => String(n).padStart(2, '0');
  return f === 'yyyy-MM-dd' ? `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}`
    : f === 'HH:mm' ? `${p(j.getUTCHours())}:${p(j.getUTCMinutes())}` : `${j.getUTCMonth() + 1}/${j.getUTCDate()}`;
}
function ymd(d) { return fmt(d, 'yyyy-MM-dd'); }

function toRow(e, from) {
  const allDay = e.isAllDayEvent();
  let start = allDay ? e.getAllDayStartDate() : e.getStartTime();
  const end = allDay ? new Date(e.getAllDayEndDate().getTime() - 1) : e.getEndTime();  // 終日の終わりは翌日0時なので1ミリ秒戻す
  if (start < from) start = from;   // 期間の前から続いている予定は、今日の分として出す
  const multi = ymd(start) !== ymd(end);
  return {
    ext_id: e.getId() + '@' + ymd(allDay ? e.getAllDayStartDate() : e.getStartTime()) + (allDay ? '' : 'T' + fmt(e.getStartTime(), 'HH:mm')),
    title: (e.getTitle() || '').slice(0, multi ? 70 : 80) + (multi ? `(〜${fmt(end, 'M/d')})` : ''),
    date: ymd(start),
    time: allDay || multi ? null : fmt(e.getStartTime(), 'HH:mm'),
    end_time: allDay || multi ? null : fmt(e.getEndTime(), 'HH:mm'),
  };
}

if (typeof module !== 'undefined') module.exports = { toRow };
