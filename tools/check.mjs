// 一括チェック(2026-11-25 追加)。講演「All Code Is Slop (Except Mine)」の考え方を取り入れた。
// AIでも人でも、コードを変えたら最後に `node tools/check.mjs` を実行し、全部「合格」になってから完了とする。
// GitHub に上げたときも、SQLや関数を反映する前に自動でこれが走り、不合格なら反映を止める。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const results = [];
function step(name, fn) {
  const ng = [];
  try { fn(ng); } catch (e) { ng.push(String(e?.stack || e)); }
  results.push([name, ng.length === 0]);
  console.log(`\n=== ${name} === ${ng.length ? '不合格' : '合格'}`);
  ng.forEach(x => console.log('  - ' + x));
}
const appJs = readdirSync(ROOT).filter(f => f.endsWith('.js'));

// 1. 文法の誤り(1文字の打ち間違いで、画面が真っ白になるのを防ぐ)
step('文法(node --check)', ng => {
  for (const f of appJs) {
    const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { encoding: 'utf8' });
    if (r.status !== 0) ng.push(`${f}: ${(r.stderr || '').trim().split('\n').slice(0, 4).join(' / ')}`);
  }
});

// 2. import の名前が、相手のファイルに本当にあるか
const exportsOf = (f, seen = new Set()) => {
  if (seen.has(f)) return new Set(); seen.add(f);
  const s = read(f), out = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach(x => out.add(x));
  for (const m of s.matchAll(/^export\s*\*\s*from\s*'\.\/([^']+)'/gm)) exportsOf(m[1], seen).forEach(x => out.add(x));
  return out;
};
const localImports = f => [...read(f).matchAll(/^import\s+(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s+from\s+'\.\/([^']+)'/gm)].map(m => ({ names: m[1], file: m[2] }));
step('importの名前と行き先', ng => {
  for (const f of appJs) for (const { names, file } of localImports(f)) {
    if (!existsSync(join(ROOT, file))) { ng.push(`${f}: 「${file}」がありません`); continue; }
    if (!names) continue;
    const ex = exportsOf(file);
    names.split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach(n => { if (!ex.has(n)) ng.push(`${f}: 「${file}」に ${n} がありません`); });
  }
});

// 3. オフライン用の一覧(sw.js)に、ファイルが全部そろっているか
step('オフライン用の一覧(sw.js)', ng => {
  const files = JSON.parse(read('sw.js').match(/const FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  files.filter(x => x !== './').forEach(x => { if (!existsSync(join(ROOT, x))) ng.push(`一覧にあるのに、ファイルがありません: ${x}`); });
  const need = new Set(), walk = f => { if (need.has(f)) return; need.add(f); localImports(f).forEach(i => walk(normalize(i.file))); };
  walk('app.js');
  [...need].filter(f => !files.includes(f)).forEach(f => ng.push(`app.js から使っているのに、一覧にありません(オフラインで開けない): ${f}`));
});

// 4. SQL の番号が、とびや重なりなく並んでいるか
step('SQLの番号', ng => {
  const nums = readdirSync(join(ROOT, 'supabase')).map(f => /^migration_(\d{3})_.+\.sql$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  nums.forEach((n, i) => { if (i && n === nums[i - 1]) ng.push(`番号が重なっています: ${n}`); else if (i && n !== nums[i - 1] + 1) ng.push(`番号がとんでいます: ${nums[i - 1]} の次が ${n}`); });
});

// 5. 秘密の鍵が、公開するファイルに書かれていないか
step('秘密の鍵が書かれていない', ng => {
  const skip = n => n === '.git' || n === 'node_modules' || n.startsWith('_変更前');
  const walk = d => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (skip(e.name) ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
  for (const f of walk('.').filter(f => /\.(js|mjs|ts|gs|html|sql|json|md|yml)$/.test(f))) {
    const s = read(f);
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(s)) ng.push(`${f}: Secret key(sb_secret_…)が書かれています`);
    if (/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(s)) ng.push(`${f}: 古い形式の鍵(eyJ…)が書かれています。service_role なら危険です`);
  }
});

// 6. 試験(tests/*.test.mjs)。お金の計算などを、決まった例で確かめる
step('試験(node --test)', ng => {
  const tests = readdirSync(join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).map(f => join(ROOT, 'tests', f));
  const r = spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) ng.push(out.split('\n').filter(l => /not ok|Error|expected|actual|✖/.test(l)).slice(0, 20).join('\n    ') || out.slice(-2000));
  else console.log('  ' + (out.match(/# pass \d+/)?.[0] || '').replace('# pass', '合格した試験:'));
});

console.log('\n========== まとめ ==========');
results.forEach(([n, ok]) => console.log(`${ok ? '合格' : '不合格'}  ${n}`));
const ok = results.every(([, v]) => v);
console.log(ok ? '全部合格。完了にしてよい状態です。' : '不合格があります。直してから、もう一度実行してください。');
process.exit(ok ? 0 : 1);
