// お金と日付の計算の試験(2026-11-25 追加)。`node tools/check.mjs` から実行される。
// 精算の例は、実際に使いたい分け方(割り勘・7割負担・おごり・返してもらった額・端数だけ)から作った。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, toNum } from '../core.js';
import { payDate, perMonth, perYear } from '../features.js';
import { settle, shiftMonth } from '../kakeibo.js';
import { splitByCategory } from '../receipt.js';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const members = [{ user_id: A }, { user_id: B }];
const tx = (o) => ({ scope: 'shared', kind: 'expense', paid_by: A, amount: 1000, split: null, repaid_amount: 0, ...o });
function diffs(list) {
  C.st = { members, tx: list };
  const r = settle(), d = Object.fromEntries(r.bal.map(x => [x.m.user_id, Math.round(x.diff)]));
  assert.equal(d[A] + d[B], 0, '精算の差の合計は必ず0');
  return d;
}

test('全角や円・カンマが入っても数字として読む', () => {
  assert.equal(toNum('１,２００円'), 1200);
  assert.equal(toNum(''), 0);
});

test('支払日は月末を越えない(うるう年も)', () => {
  assert.equal(payDate('2026-02', 31), '2026-02-28');
  assert.equal(payDate('2028-02', 31), '2028-02-29');
  assert.equal(payDate('2026-04', 0), '2026-04-01');
});

test('年払いは月あたり12で割り、月払いは12倍が1年分', () => {
  assert.equal(perMonth({ cycle: 'yearly', amount: 12000 }), 1000);
  assert.equal(perYear({ cycle: 'monthly', amount: 500 }), 6000);
});

test('月の行き来は年をまたげる', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('割り勘:払った人が半分を受け取る', () => assert.deepEqual(diffs([tx({})]), { [A]: 500, [B]: -500 }));
test('相手が7割負担', () => assert.deepEqual(diffs([tx({ split: `u:${B}:70` })]), { [A]: 700, [B]: -700 }));
test('自分のおごりは精算なし', () => assert.deepEqual(diffs([tx({ split: `u:${A}:100` })]), { [A]: 0, [B]: 0 }));
test('1000円の支払いに820円返してもらって済み', () => assert.deepEqual(diffs([tx({ split: 'deal', repaid_amount: 820 })]), { [A]: 0, [B]: 0 }));
test('合計1212円のうち、相手は端数の12円だけ負担', () => assert.deepEqual(diffs([tx({ amount: 1212, split: `y:${B}:12` })]), { [A]: 12, [B]: -12 }));
test('収入と自分だけの支出は精算に入れない', () => {
  assert.deepEqual(diffs([tx({ kind: 'income' }), tx({ scope: 'personal' })]), { [A]: 0, [B]: 0 });
});

test('レシートの分類分け:合計は必ずレシートの金額に合う', () => {
  const items = [{ name: '牛乳', price: 200, category: '食費' }, { name: '洗剤', price: 300, category: '日用品' }];
  const r = splitByCategory(items, 540);   // 税などで40円の差
  assert.equal(r.reduce((a, x) => a + x.amount, 0), 540);
  assert.equal(r.find(x => x.category === '日用品').amount, 340);   // 差は金額の大きい分類に寄せる
  assert.deepEqual(splitByCategory([], 100), []);
});
