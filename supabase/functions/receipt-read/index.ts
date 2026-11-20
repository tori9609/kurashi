// ふたりの暮らし帳:レシートの読み取り(Supabase Edge Function「receipt-read」)。2026-11-21
//
// アプリから送られたレシートの写真を Gemini に読ませ、お店・日付・合計・品目(分類つき)を受け取って、
// ログインしている本人の「確認待ち」に入れる。写真はどこにも保存しない。
//
// 設定(Supabase の Edge Functions → Secrets)
//   GEMINI_API_KEY … Google AI Studio で作った鍵(必須)
//   GEMINI_MODEL   … 使うモデル名(なくてよい。なければ gemini-flash-latest → gemini-2.5-flash の順に試す)
// AI を別のものに替えるときは、readReceipt() だけを書き換えればよい。

import { createClient } from 'npm:@supabase/supabase-js@2';

export const CATS = ['住居', '食費', '外食', '日用品', '家具・家電', '光熱費', '通信', '交通', '趣味', 'その他'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const PROMPT = `この画像は日本のお店のレシートです。次の決まりで読み取り、JSONだけを返してください。
- is_receipt:レシートでなければ false(ほかの項目は空でよい)
- store:お店の名前(チェーン名と店名。住所や電話番号は入れない)
- date:購入日 YYYY-MM-DD。和暦や「26/11/21」も西暦に直す。読めなければ空
- time:購入時刻 HH:MM。読めなければ空
- total:支払った合計金額(税込・円・整数)。「合計」「お買上計」などの金額。お預り・お釣りではない
- payment:cash(現金)/ card(クレジット・電子マネー・QR)/ unknown
- items:商品ごとに name(商品名。略語は分かる範囲で読みやすく)、price(その商品に払った税込の金額。数量があれば数量分の合計。値引き・割引はその商品から引く)、category(次から1つ:${CATS.join('、')})
- 小計・合計・消費税・お預り・お釣り・ポイント・クーポンの行は items に入れない
- 外税のレシートは、消費税を各商品に割り振って税込にする。items の price の合計が total になるようにする
- 分類の目安:食べ物・飲み物(スーパー・コンビニ)は食費、店で食べたものは外食、洗剤・ティッシュ・薬・化粧品は日用品、家電・家具・照明は家具・家電、ガソリン・駐車・電車は交通`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_receipt: { type: 'BOOLEAN' },
    store: { type: 'STRING' },
    date: { type: 'STRING' },
    time: { type: 'STRING' },
    total: { type: 'INTEGER' },
    payment: { type: 'STRING', enum: ['cash', 'card', 'unknown'] },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, price: { type: 'INTEGER' }, category: { type: 'STRING', enum: CATS } }, required: ['name', 'price', 'category'] } },
  },
  required: ['is_receipt', 'store', 'date', 'total', 'items'],
};

// AI が返した内容を、暮らし帳で使える形にそろえる(数字・分類・日付を確かめる)
export function normalize(r: any, today = new Date()) {
  if (!r || r.is_receipt === false) throw new Error('レシートとして読み取れませんでした');
  const int = (v: unknown) => Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
  const items = (Array.isArray(r.items) ? r.items : []).map((i: any) => ({
    name: String(i?.name || '(品名なし)').slice(0, 40),
    price: int(i?.price),
    category: CATS.includes(i?.category) ? i.category : 'その他',
  })).filter((i: any) => i.price !== 0);
  let total = int(r.total);
  if (total <= 0) total = items.reduce((a: number, i: any) => a + i.price, 0);
  if (total <= 0) throw new Error('合計金額を読み取れませんでした');
  const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  let date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : ymd(today);
  if (date > ymd(today)) date = ymd(today);   // 未来の日付は読み違いとみなす
  const time = /^\d{1,2}:\d{2}$/.test(String(r.time || '')) ? r.time.padStart(5, '0') : null;
  return { store: String(r.store || '').slice(0, 60), date, time, total, payment: r.payment || 'unknown', items };
}

export async function readReceipt(imageB64: string, mime: string) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY が設定されていません');
  const models = [Deno.env.get('GEMINI_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean) as string[];
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mime || 'image/jpeg', data: imageB64 } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  });
  let last = '';
  for (const m of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    });
    if (res.status === 404) { last = `モデル ${m} が見つかりません`; continue; }
    if (res.status === 429) throw new Error('Gemini の無料枠の上限に達しました。しばらくしてから試してください');
    if (!res.ok) throw new Error(`Gemini の呼び出しに失敗しました(${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    return normalize(JSON.parse(text));
  }
  throw new Error(last || 'Gemini を呼び出せませんでした');
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, apikey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!user) return json({ error: 'ログインが必要です' }, 401);
    const { image, mime } = await req.json();
    if (!image || image.length > 8_000_000) return json({ error: '写真がないか、大きすぎます' }, 400);
    const r = await readReceipt(image, mime);
    const { data, error } = await sb.rpc('receipt_add', { p_store: r.store, p_date: r.date, p_total: r.total, p_items: r.items, p_time: r.time });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, merged: data?.merged, receipt: r });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
