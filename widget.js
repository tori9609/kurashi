// 暮らし帳ウィジェット(Scriptable 用)
// 暮らし帳の「設定 → ホーム画面のウィジェット」の「スクリプトをコピー」で、鍵が入った状態でコピーされます。
// ここを直接書き換える必要はありません。

const KEY = "__KEY__";            // あなたのウィジェット用の鍵(読むだけ。人に見せない)
const API = "__URL__/rest/v1/rpc/widget_data";
const APIKEY = "__APIKEY__";      // 公開用の鍵
const WEEK_START = __WS__;        // 0 = 日曜始まり、1 = 月曜始まり(アプリの設定から入ります)
const APP = "https://tori9609.github.io/kurashi/";
const SHOW_PRIVATE = false;       // true にすると「自分だけ」の予定・やることも出す(ロック画面で人に見える点に注意)

// ---------- 色と文字 ----------
const C = {
  bg: Color.dynamic(new Color("#F2F4F8"), new Color("#1C1C1E")),
  ink: Color.dynamic(new Color("#1C1E21"), new Color("#F2F2F7")),
  sub: Color.dynamic(new Color("#65676B"), new Color("#A1A1A6")),
  faint: Color.dynamic(new Color("#B0B3B8"), new Color("#636366")),
  blue: new Color("#0A5BD3"),
  pastBlue: new Color("#7FA6E6"),
  red: new Color("#C62828"),
  redBg: Color.dynamic(new Color("#FDECEC"), new Color("#4A1F1F")),
  shared: new Color("#1E8A5A"),
  white: new Color("#FFFFFF"),
};
const W = "日月火水木金土";
const yen = n => "¥" + Math.round(n).toLocaleString("ja-JP");

// ---------- データを取る(取れないときは前回の分を出す) ----------
async function load() {
  const fm = FileManager.local(), path = fm.joinPath(fm.documentsDirectory(), "kurashi-widget.json");
  try {
    const r = new Request(API);
    r.method = "POST";
    r.timeoutInterval = 15;
    r.headers = { apikey: APIKEY, "Content-Type": "application/json" };
    r.body = JSON.stringify({ p_token: KEY, p_back: 14, p_ahead: 14, p_private: SHOW_PRIVATE });
    const j = await r.loadJSON();
    if (r.response.statusCode >= 300 || !j || !j.events) throw new Error((j && j.message) || "読み込めませんでした");
    fm.writeString(path, JSON.stringify(j));
    return { data: j, stale: false };
  } catch (e) {
    if (fm.fileExists(path)) return { data: JSON.parse(fm.readString(path)), stale: true, err: String(e.message || e) };
    return { data: null, stale: true, err: String(e.message || e) };
  }
}

// ---------- 日付 ----------
const D = s => new Date(s + "T00:00:00");
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return ymd(d); };
const md = s => { const d = D(s); return `${d.getMonth() + 1}/${d.getDate()}(${W[d.getDay()]})`; };
const dayLabel = (s, today) => s === today ? "今日" : s === addDays(today, 1) ? "明日" : md(s);

// ---------- 表示の部品 ----------
function text(stack, s, size, opt = {}) {
  const t = stack.addText(s);
  t.font = opt.bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = opt.color || C.ink;
  t.lineLimit = opt.lines || 1;
  t.minimumScaleFactor = 0.75;
  if (opt.center) t.centerAlignText();
  return t;
}
function col(parent, url) { const s = parent.addStack(); s.layoutVertically(); s.spacing = 2; if (url) s.url = APP + url; return s; }
function row(parent) { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
const title = (stack, s, size, color) => text(stack, s, size, { bold: true, color: color || C.sub });
const more = (stack, n, size) => { if (n > 0) text(stack, `ほか${n}件`, size - 2, { color: C.sub }); };

// 今日やること(期限切れは赤、終えたものは薄く ✓)
function todos(stack, d, max, size) {
  const left = d.chores.filter(c => !c.done);
  title(stack, `✅ 今日やること ${left.length}件`, size - 1);
  if (!d.chores.length) { text(stack, "今日はありません", size, { color: C.sub }); return; }
  d.chores.slice(0, max).forEach(c => {
    const r = row(stack), color = c.done ? C.faint : c.late ? C.red : C.ink;
    text(r, c.done ? "✓ " : c.late ? "❗" : "・", size, { color });
    text(r, c.name + (c.late ? "(期限切れ)" : ""), size, { color, bold: !!c.late });
  });
  more(stack, d.chores.length - max, size);
}
// 買い物(急ぎは赤い帯で目立たせる)
function shopping(stack, d, max, size) {
  const s = d.shopping, urgent = s.filter(x => x.urgent).length;
  title(stack, `🛒 買い物 ${s.length}件${urgent ? `(急ぎ${urgent})` : ""}`, size - 1);
  if (!s.length) { text(stack, "買う物はありません", size, { color: C.sub }); return; }
  s.slice(0, max).forEach(x => {
    const label = x.name + (x.qty > 1 ? ` ×${x.qty}` : "");
    if (x.urgent) {
      const b = row(stack); b.backgroundColor = C.redBg; b.cornerRadius = 5; b.setPadding(1, 4, 1, 6);
      text(b, "急ぎ ", size - 2, { bold: true, color: C.red }); text(b, label, size, { bold: true, color: C.red });
    } else text(stack, "・" + label, size);
  });
  more(stack, s.length - max, size);
}
// これからの予定(今日から先だけを一覧で)
function evLine(stack, e, size) {
  const r = row(stack);
  const dot = r.addText("●"); dot.font = Font.systemFont(size - 4); dot.textColor = e.color ? new Color(e.color) : C.shared;
  r.addSpacer(4);
  text(r, (e.time ? e.time + " " : "") + (e.private ? "🔒" : "") + e.title, size);
}
function upcoming(stack, d, max, size, withHead = true) {
  const list = d.events.filter(e => e.date >= d.today);
  if (withHead) title(stack, "📅 これからの予定", size - 1);
  if (!list.length) { text(stack, "2週間先まで予定はありません", size, { color: C.sub }); return; }
  let used = 0, last = "";
  for (const e of list) {
    const head = e.date !== last;
    if (used + (head ? 2 : 1) > max) { more(stack, list.length - list.indexOf(e), size); break; }
    if (head) { const near = e.date === d.today || e.date === addDays(d.today, 1);
      text(stack, dayLabel(e.date, d.today) + (near ? " " + md(e.date) : ""), size - 2, { bold: true, color: C.sub }); used++; last = e.date; }
    evLine(stack, e, size); used++;
  }
}
// 前後2週間のカレンダー(5週。予定のある日は青、今日は青い丸、過ぎた日は薄く)
function miniCal(stack, d, width) {
  const t = D(d.today), back = (t.getDay() - WEEK_START + 7) % 7;
  const start = addDays(d.today, -14 - back), cw = Math.floor(width / 7), ch = 17;
  const count = {}; d.events.forEach(e => { count[e.date] = (count[e.date] || 0) + 1; });
  const hd = row(stack);
  for (let i = 0; i < 7; i++) {
    const c = hd.addStack(); c.size = new Size(cw, 13); c.centerAlignContent(); const wd = (i + WEEK_START) % 7;
    text(c, W[wd], 9, { color: wd === 0 ? C.red : wd === 6 ? C.blue : C.sub, center: true });
  }
  for (let wk = 0; wk < 5; wk++) {
    const r = row(stack);
    for (let i = 0; i < 7; i++) {
      const s = addDays(start, wk * 7 + i), dd = D(s), isT = s === d.today, n = count[s] || 0, past = s < d.today;
      const c = r.addStack(); c.size = new Size(cw, ch); c.centerAlignContent(); c.cornerRadius = ch / 2;
      if (isT) c.backgroundColor = C.blue;
      const label = dd.getDate() === 1 ? `${dd.getMonth() + 1}/1` : String(dd.getDate());
      text(c, label, 11, { bold: isT || n > 0, center: true, color: isT ? C.white : n > 0 ? (past ? C.pastBlue : C.blue) : past ? C.faint : C.ink });
    }
  }
}
// 今月のお金(ふたりの支出と、予算の残り)
function money(stack, d, size) {
  const r = row(stack);
  text(r, `💴 今月のふたりの支出 ${yen(d.spent)}`, size, { color: C.sub });
  if (d.budget) {
    r.addSpacer();
    const rest = d.budget - d.spent;
    text(r, rest >= 0 ? `予算の残り ${yen(rest)}` : `予算超え ${yen(-rest)}`, size, { bold: true, color: rest >= 0 ? C.shared : C.red });
  }
}
function header(w, d, stale, compact) {
  const h = row(w);
  text(h, "暮らし帳", 12, { bold: true, color: C.blue });
  if (!compact) { h.addSpacer(6); text(h, md(d.today), 11, { color: C.sub }); }
  h.addSpacer();
  text(h, stale ? "⚠︎ 前回の内容" : `${d.at} 更新`, 10, { color: stale ? C.red : C.sub });
  w.addSpacer(6);
}

// ---------- ウィジェットを組み立てる ----------
// ウィジェットの「Parameter」に「予定」「やること」「買い物」と書くと、それだけを大きく出す
async function build(family, param) {
  const want = (param || "").trim();
  const { data: d, stale, err } = await load();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (!d) {
    w.setPadding(12, 12, 12, 12);
    text(w, "暮らし帳", 12, { bold: true, color: C.blue });
    text(w, "読み込めませんでした", 13, { lines: 2 });
    text(w, err || "", 10, { color: C.sub, lines: 3 });
    w.url = APP + "#settings";
    return w;
  }
  d.chores = d.chores || []; d.spent = d.spent || 0;
  const next = d.events.find(e => e.date >= d.today);
  const left = d.chores.filter(c => !c.done).length, urgent = d.shopping.filter(x => x.urgent).length;

  // ---- ロック画面 ----
  if (family === "accessoryInline") {
    w.addText(next ? `${dayLabel(next.date, d.today)} ${next.time || ""} ${next.title}`.replace(/\s+/g, " ") : `やること${left}・買い物${d.shopping.length}`);
    w.url = APP + "#calendar"; return w;
  }
  if (family === "accessoryCircular") {
    const shop = want === "買い物", s = col(w);
    text(s, shop ? "🛒" : "✅", 12, { center: true }); text(s, String(shop ? d.shopping.length : left), 18, { bold: true, center: true });
    w.url = APP + (shop ? "#shopping" : "#chores"); return w;
  }
  if (family === "accessoryRectangular") {
    if (next) { text(w, `${dayLabel(next.date, d.today)} ${next.time || "終日"}`, 11, { bold: true }); text(w, next.title, 13); }
    else text(w, "予定はありません", 13);
    text(w, `✅${left}  🛒${d.shopping.length}${urgent ? `(急ぎ${urgent})` : ""}`, 11);
    w.url = APP + "#calendar"; return w;
  }

  // ---- ホーム画面 ----
  w.setPadding(12, 14, 12, 14);
  header(w, d, stale, family === "small");
  const big = family === "large" || family === "extraLarge";
  if (want === "予定") {
    if (big) { miniCal(col(w, "#calendar"), d, 300); w.addSpacer(8); upcoming(col(w, "#calendar"), d, 12, 12); }
    else upcoming(col(w, "#calendar"), d, family === "small" ? 4 : 5, 13, family !== "small");
    w.url = APP + "#calendar";
  } else if (want === "やること") { todos(col(w, "#chores"), d, big ? 14 : 5, 13); w.url = APP + "#chores"; }
  else if (want === "買い物") { shopping(col(w, "#shopping"), d, big ? 14 : 5, 13); w.url = APP + "#shopping"; }
  else if (family === "small") {
    todos(col(w, "#chores"), d, 3, 12);
    w.addSpacer();
    text(w, `🛒 ${d.shopping.length}件${urgent ? `  急ぎ${urgent}` : ""}`, 11, { bold: urgent > 0, color: urgent ? C.red : C.sub });
    w.url = APP + "#chores";
  } else if (family === "medium") {
    const r = w.addStack(); r.layoutHorizontally(); r.topAlignContent();
    const a = col(r, "#chores"); a.size = new Size(150, 0); todos(a, d, 4, 12);
    r.addSpacer(10);
    shopping(col(r, "#shopping"), d, 4, 12);
    w.addSpacer();
    money(w, d, 10);
    w.url = APP + "#home";
  } else {
    miniCal(col(w, "#calendar"), d, 300);
    w.addSpacer(6);
    upcoming(col(w, "#calendar"), d, 3, 12, false);
    w.addSpacer(8);
    const r = w.addStack(); r.layoutHorizontally(); r.topAlignContent();
    const b = col(r, "#chores"); b.size = new Size(150, 0); todos(b, d, 5, 12);
    r.addSpacer(10);
    shopping(col(r, "#shopping"), d, 5, 12);
    w.addSpacer();
    money(w, d, 11);
    w.url = APP + "#home";
  }
  return w;
}

const widget = await build(config.widgetFamily || "large", args.widgetParameter);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();   // アプリの中で ▶ を押したときの見本
Script.complete();
