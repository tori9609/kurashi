# ふたりの暮らし帳（第1段階）セットアップ手順

いま使えるもの：ログイン（メールのリンク）、暮らし帳の作成、メンバー招待、買い物リスト、ホーム（急ぎの買い物・お知らせ）。
カレンダー・家事は第2段階、家計簿は第3段階で作ります。

---

## 0. 始める前に知っておくこと

### 0-1. 用意するもの
- パソコン（作業は全部パソコンのブラウザで行う。Chrome がおすすめ）
- メールアドレス 1つ（Supabase と GitHub の登録用。副業用の Gmail でも、個人のものでもよい）
- iPhone（最後の確認だけで使う）
- 時間：全部で約40分。手順ごとに区切って、別の日に進めても大丈夫

### 0-2. 登場する3つのサービス

| 名前 | たとえると | このアプリでの役割 | 料金 |
|---|---|---|---|
| Supabase（スパベース） | 鍵付きの共有ノート | 買い物リストなどのデータを保存し、ログインを管理する | 無料プランで足りる |
| GitHub（ギットハブ） | ファイル置き場 | アプリのファイル一式を置く | 無料 |
| GitHub Pages（ギットハブ ページズ） | 掲示板 | 置いたファイルを、iPhone から開けるページとして公開する | 無料 |

### 0-3. 画面が英語でも大丈夫
Supabase と GitHub の画面は英語です。この手順書では、押すボタンの英語表記をそのまま「」で書いています。同じ文字を探して押してください。

### 0-4. 「鍵」の話（ここだけは大事）
Supabase には鍵が2種類あります。

| 鍵 | 見分け方 | 扱い |
|---|---|---|
| Publishable key（公開用） | `sb_publishable_` で始まる | アプリに書いてよい。この鍵だけでは、ログインした本人の分のデータしか触れない |
| Secret key（秘密） | `sb_secret_` で始まる | 何でもできてしまう。**どこにも貼らない・誰にも見せない** |

古い説明では、Publishable key は「anon key」、Secret key は「service_role key」と呼ばれています。Supabase は 2026年末までに古い鍵を使えなくする予定なので、新しい方（Publishable key）を使います。

### 0-5. 無料プランの注意
- しばらく（目安1週間）だれも使わないと、Supabase のプロジェクトが「一時停止（Paused）」になることがあります。そのときは Supabase の画面で「Restore」を押せば戻ります。データは消えません。
- Supabase の標準のメール送信は、1時間に数通までしか送れません。ログイン用のメールを何度も送ると、しばらく届かなくなります。

### 0-6. このフォルダの中身

| ファイル | 役割 | 手順で触るか |
|---|---|---|
| supabase/schema.sql | データベースの設計図 | 手順1で中身をコピーする |
| config.js | Supabase につなぐための住所と鍵 | 手順2で書きかえる |
| index.html・style.css・app.js | アプリ本体（画面・見た目・動き） | 触らない |
| manifest.webmanifest・sw.js・icons | ホーム画面に追加したときの設定とアイコン | 触らない |

---

## 手順1：Supabase でデータベースを作る（約15分）

1. https://supabase.com を開き、右上の「Start your project」を押す
2. 「Continue with GitHub」か、メールアドレスで登録する（迷ったらメールでよい）。確認メールが届いたら、メール内のリンクを押す
3. 初めてだと「Organization（組織）」を作る画面が出る。Name は `tokimaru` など何でもよい。Type は「Personal」、Plan は「Free - $0/month」を選んで「Create organization」
4. 「New project」の画面で、次のように入れる
   - Project name：`kurashi`
   - Database Password：「Generate a password」を押して自動で作る。**このパスワードはメモ帳などに控えておく**（このアプリでは使わないが、あとで必要になることがある）
   - Region：`Northeast Asia (Tokyo)`
   - 「Create new project」を押す。準備に1〜2分かかるので待つ
5. 左のメニューで「SQL Editor」（四角に `>_` のような絵）を押す
6. 「New query」（または「+」）を押して、空の入力欄を開く
7. パソコンで `supabase/schema.sql` をメモ帳で開き、**Ctrl+A（全部選ぶ）→ Ctrl+C（コピー）**
8. Supabase の入力欄に **Ctrl+V（貼り付け）** して、右下の「Run」を押す
9. 下に「Success. No rows returned」と出れば完了
   - 「destructive operation」などの確認が出たら「Run this query」を押してよい（表を作り直す命令が入っているため）
   - 赤い文字のエラーが出たら、その文字をそのまま Claude に貼って相談する

## 手順2：config.js に住所と鍵を貼る（約5分）

1. Supabase の左下の歯車「Project Settings」→「API Keys」を開く
2. 「Publishable key」の欄の右にあるコピーボタンを押す（`sb_publishable_` で始まる文字）
   - 「Create new API keys」というボタンしかない場合は、それを押してから進む
3. パソコンで `config.js` をメモ帳で開き、`ここに Publishable key を貼る` の部分を消して貼り付ける。前後の `'`（シングルクォート）は消さない
4. 次に「Project URL」を探す。画面上部の「Connect」ボタン、または「Project Settings」→「Data API」にある `https://xxxx.supabase.co` の形の文字をコピーする
5. `config.js` の `ここに Project URL を貼る` の部分に貼り付けて、上書き保存する

できあがりの見本：
```
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxxxxxx';
```

## 手順3：GitHub Pages で公開する（約15分）

1. https://github.com で「Sign up」からアカウントを作る。ユーザー名は公開ページの住所に入る（例：`tokimaru66` → `https://tokimaru66.github.io/kurashi/`）。本名を避けたいなら、本名を入れない名前にする
2. ログイン後、右上の「+」→「New repository」
3. Repository name に `kurashi`、「Public」を選び、「Create repository」
   - Public（公開）にしても、見えるのはアプリのファイルだけ。買い物リストなどのデータは Supabase にあり、ログインした本人たちにしか見えない
4. 次の画面の「uploading an existing file」というリンクを押す
5. パソコンで「暮らし帳」フォルダを開き、**中身を全部**選んでブラウザにドラッグする（フォルダごとではなく中身。`supabase` と `icons` のフォルダもいっしょに）
6. 下の「Commit changes」を押す
7. リポジトリ上部の「Settings」→ 左メニュー「Pages」
8. 「Branch」を `main`、その右を `/ (root)` にして「Save」
9. 1〜3分待って画面を再読み込みすると、上に「Your site is live at https://…」と出る。この URL を控える

## 手順4：ログインのリンクの戻り先を登録する（約3分）

ログイン用メールのリンクを押したとき、どのページに戻すかを Supabase に教える手順です。

1. Supabase の左メニュー「Authentication」→「URL Configuration」
2. 「Site URL」に手順3の URL（例：`https://tokimaru66.github.io/kurashi/`）を入れて「Save」
3. 「Redirect URLs」の「Add URL」を押し、同じ URL を入れて保存
   - 最後の `/` まで同じにする。1文字でも違うと、ログイン後に元の画面へ戻れない

## 手順5：iPhone で使う

1. iPhone の **Safari** で手順3の URL を開く（Chrome など別のアプリだとホーム画面に追加できないことがある）
2. メールアドレスを入れて「ログイン用のリンクを送る」→ 届いたメールのリンクを **同じ iPhone で** 押す
3. 呼び名（相手に表示される名前）を入れて「はじめる」
4. Safari の共有ボタン（四角から上向き矢印）→「ホーム画面に追加」→「追加」
5. ホーム画面のアイコンから開き、「設定」→「メンバーを招待する」→「リンクを送る」で同居人に LINE などで送る
6. 同居人は、届いたリンクを Safari で開き、同じように 2〜4 を行う（招待コードは自動で入る）

---

## 困ったとき

| 症状 | 原因と対処 |
|---|---|
| 「あと少しで使えます」と出る | config.js の貼り付けがまだ。手順2をやり直し、GitHub にも上げ直す |
| メールが届かない | 迷惑メールフォルダを見る。何度も送った場合は1時間ほど待つ |
| メールのリンクを押すと別のページに行く | 手順4の URL が手順3と1文字でも違っていないか確認する |
| ページを開くと真っ白 | GitHub にファイルが全部上がっているか、`index.html` が一番上の階層にあるか確認する |
| 修正したのに変わらない | iPhone でアプリを一度閉じて開き直す。それでもだめなら1〜2分待つ |
| 赤いエラーが出た | 画面のスクリーンショットか文字を Claude に送る |

ファイルを直したときは、GitHub のリポジトリで同じように「Add file」→「Upload files」から上書きでアップロードします。
