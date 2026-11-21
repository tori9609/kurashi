// ふたりの暮らし帳:みんなで使う道具(C・アイコン・色・日付やお金の書き方・入力欄の部品)。features.js と settings.js から読む
export const C = {};   // app.js から受け取る道具(st・sb・run・render など)。features.js の準備で中身が入る
// ---------- 見た目(テーマ・アクセントカラー・人の色) ----------
// ---------- アイコン(自作。24×24、線の太さ1.75、角は丸) ----------
export const IC = {
  home: '<path d="M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4.25v-5.25h-5.5V20H5a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" stroke-width="2.4"/>',
  cart: '<path d="M3 4.5h2.1l2.2 10.3a1 1 0 0 0 1 .8h9.3a1 1 0 0 0 1-.75L20.5 8H6"/><circle cx="9.5" cy="19.3" r="1.3"/><circle cx="16.8" cy="19.3" r="1.3"/>',
  wallet: '<path d="M18 7V5.8A1.8 1.8 0 0 0 16.2 4H6a2.5 2.5 0 0 0-2.5 2.5v11A2.5 2.5 0 0 0 6 20h12.5a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2H6a2.5 2.5 0 0 1-2.5-2.5"/><path d="M16.5 13.5h1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  camera: '<path d="M4 8.6A1.6 1.6 0 0 1 5.6 7h2.1l1.5-2.2h5.6L16.3 7h2.1A1.6 1.6 0 0 1 20 8.6v8.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.4z"/><circle cx="12" cy="12.8" r="3.4"/>',
  receipt: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  doc: '<path d="M14 3.5H7.5a1.5 1.5 0 0 0-1.5 1.5v14a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3.5v4h4M9 12.5h6M9 16h4"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.4 1.5M4.5 5 6.8 3M19.5 5l-2.3-2"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  tick: '<path d="m5.5 12.5 4.2 4.2L18.5 8"/>',
  star: '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>',
  chart: '<path d="M4 20h16M7.5 16.5v-4M12 16.5v-8M16.5 16.5v-6"/>',
  bell: '<path d="M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 1.5H5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  edit: '<path d="M4.5 19.5h3.8L19 8.8a2.1 2.1 0 0 0-3-3L5.3 16.5z"/><path d="m14.5 7.3 3 3"/>',
  income: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  card: '<rect x="3.5" y="6" width="17" height="12.5" rx="2.5"/><path d="M3.5 10.5h17M7 15h3"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>', right: '<path d="m9.5 6 6 6-6 6"/>', down: '<path d="m6 9.5 6 6 6-6"/>', up: '<path d="m6 14.5 6-6 6 6"/>',
  cloudOff: '<path d="M4 4l16 16M8.5 8.4A5.5 5.5 0 0 0 7 18.5h10.5M18.6 15.7A3.7 3.7 0 0 0 16.5 9a5.5 5.5 0 0 0-5.6-3.4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17h.01" stroke-width="2.4"/>',
  alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4.2M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  heart: '<path d="M12 19s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 7.4a3.9 3.9 0 0 1 7 2.2C19 14.7 12 19 12 19z"/>',
};
export const ic = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || ''}</svg>`;
// 基本の色(アプリ全体の色。設定で人の色にも変えられる)
export const BRAND = '#4F46E5';
export const PALETTE = [['青', '#0A5BD3'], ['藍', '#3F51B5'], ['紫', '#7B3FC4'], ['桃', '#C2185B'], ['赤', '#C62828'], ['橙', '#C2570C'],
  ['茶', '#8D5524'], ['緑', '#1F7A4F'], ['青緑', '#00796B'], ['水色', '#0277A8'], ['灰', '#4A5568']];
export const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };
export function applyTheme() {
  const root = document.documentElement, theme = ls('kurashi.theme') || 'auto';
  if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
  root.dataset.text = ls('kurashi.text') || 'auto';   // 文字の大きさ
  const acc = ls('kurashi.accent');
  root.style.setProperty('--accent', acc === 'me' && C?.st?.me ? C.colorOf(C.st.me.user_id) : acc && acc !== 'me' ? acc : BRAND);
  const dark = theme === 'dark' || (theme === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0E0F12' : '#F5F6F8');
}
// だれの情報か:人の色の丸と名前(担当なし・ふたりは緑)
export const who = (uid, none = 'ふたり') => uid ? `<span class="who" style="--c:${C.colorOf(uid)}"><i></i>${C.esc(C.nameOf(uid))}</span>` : `<span class="who pair"><i></i>${none}</span>`;
export const edge = uid => `style="--c:${uid ? C.colorOf(uid) : SHARED_COLOR}"`;
export const sb = () => C.sb();
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const thisMonth = () => today().slice(0, 7);
export const W = '日月火水木金土';
export const WS_KEY = 'kurashi.weekStart';
export const weekStart = () => { try { return localStorage.getItem(WS_KEY) === '1' ? 1 : 0; } catch { return 0; } };
export const wdClass = d => d === 0 ? ' sun' : d === 6 ? ' sat' : '';
export const CATS = ['住居', '食費', '外食', '日用品', '家具・家電', '光熱費', '通信', '交通', '趣味', 'その他'];
export const SHARED_COLOR = '#1F8A5B';
export const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
export const dt = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const md = s => { const d = dt(s); return `${d.getMonth() + 1}/${d.getDate()}(${W[d.getDay()]})`; };
export const h = () => C.st.me.household_id;
export const route = () => (location.hash.replace('#', '') || 'home');
export const toast = m => C.toast(m);
export const val = id => (document.getElementById(id)?.value ?? '').trim();
export const chk = id => !!document.getElementById(id)?.checked;
export function err(msg) { const e = document.getElementById('err'); if (e) { e.textContent = msg; e.hidden = false; } return true; }
// 全角数字やカンマが入っていても数字として読む
export const toNum = s => parseInt(String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^\d]/g, ''), 10) || 0;
export function activity(message) { sb().from('activities').insert({ household_id: h(), message }).then(() => {}); }
export const field = (id, label, inner) => `<div class="field"><label for="${id}">${label}</label>${inner}</div>`;
export const memberOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : '') +
  C.st.members.map(m => `<option value="${m.user_id}" ${m.user_id === sel ? 'selected' : ''}>${C.esc(m.display_name)}</option>`).join('');
export const sheetWrap = (title, body) => `<div class="sheet-bg" data-act="close"><div class="sheet" role="dialog" aria-label="${title}" data-stop>
  <span class="grip"></span><h2 style="font-size:1.0625rem">${title}</h2>${body}</div></div>`;
export const closeBtn = (label = '閉じる') => `<button class="btn" type="button" data-act="close">${label}</button>`;
