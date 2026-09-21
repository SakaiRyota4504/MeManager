# MeManager

家族で共有して使う「暮らしの管理」アプリ。
操作性重視のデスクトップアプリと、外出先から参照・入力できるウェブアプリのハイブリッド構成を目指す。

## 提供予定の機能

| 機能 | 概要 | 状態 |
| --- | --- | --- |
| スケジュール管理 | 家族の予定を共有カレンダーで管理する | 実装中（第1弾） |
| 習慣管理 | 続けたいことを記録し、続いているかを見えるようにする | 未着手 |
| 家計簿 | 収支の記録・集計・予算管理 | 未着手 |
| 献立管理 | 献立の計画と、家計簿・買い物との連携 | 未着手 |

第1弾の完了後の順番は
[docs/03-roadmap.md](docs/03-roadmap.md) の「この後」に素案を書いてある。

## 技術構成

| 層 | 技術 |
| --- | --- |
| ウェブアプリ | Next.js (App Router) + TypeScript |
| バックエンド | Supabase（PostgreSQL / Auth / Realtime / Storage） |
| デスクトップアプリ | Tauri v2（ウェブアプリと同一のコードベースを利用） |

詳細と選定理由は [docs/01-architecture.md](docs/01-architecture.md) を参照。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/00-product-vision.md](docs/00-product-vision.md) | プロダクト全体像、利用者像、全機能のスコープ感 |
| [docs/01-architecture.md](docs/01-architecture.md) | 技術構成と選定理由、Supabase の使い方 |
| [docs/02-schedule-requirements.md](docs/02-schedule-requirements.md) | スケジュール管理の要件定義（機能・非機能・データモデル・API・画面） |
| [docs/03-roadmap.md](docs/03-roadmap.md) | 実装の進め方とステップ |
| [docs/04-csv-format.md](docs/04-csv-format.md) | 取り込みCSVの形式と、football-data.org からのCSVの作り方 |
| [docs/05-setup.md](docs/05-setup.md) | **動かすまでの手順**（PCに何も入れずに公開できる） |
| [docs/06-app-shell.md](docs/06-app-shell.md) | 機能が4つに増えたときのメニューと画面の並び |
| [docs/prototypes/](docs/prototypes/) | 実装前に操作感を確かめた試作画面 |

## 利用者の管理

- **アプリにサインアップ画面は無い。** ログイン画面からアカウントは作れず、
  招待リンクのような仕組みも作らない。
  用意していない枠にアカウントが増えることはない
- 用意するのは管理者だけで、方法は2つ
  - **メンバー画面**でメールアドレスとパスワードを決めて登録し、本人に伝える
  - **Supabase の管理画面**で作る。この場合はメンバー画面で
    メールアドレスだけ先に登録しておき、同じアドレスのユーザーを作ると紐付く
  - 名前だけで登録しておいて、あとからログインを足すこともできる
- 最初の1人だけは Supabase でユーザーを作る。開いた時点で家族ができる
- 管理者はメンバーを外せる。外した時点でその人からはデータが見えなくなる
- アカウントを持たない家族（小さいお子さんなど）もメンバーとして登録できる

## スケジュール管理の要点

- 予定には**担当者の指定を必須**とし、人単位で絞り込めるようにする
- 外部データの取込口は**ファイルの取り込み1つ**に統一する。
  アプリが外部サービスを直接呼ぶことはしない
  - football-data.org のようなデータ源は、別途作るプログラムで
    **MeManager 標準CSV形式**のファイルにしてから取り込む
  - Google カレンダー / Outlook の .ics や、配られた日程表の CSV も同じ画面から取り込む
- **塊で入れて、塊で消す。** 取り込みは1回分が「バッチ」として記録され、
  間違えたり日程が変わったりしたときは、その回に入った分だけをまとめて削除して
  入れ直す。差分更新の仕組みは作らない
- 取り込みの頻度は**月1回（休日）と年1回（サッカーの年間日程）**を想定する。
  自動化は作らず、そのぶん毎月の繰り返し操作を短くすることに手をかける
  （取り込み設定を「プリセット」として保存し、次回はファイルを渡すだけにする）

## 動かす

**手順は [docs/05-setup.md](docs/05-setup.md) にある。PCには何もインストールしない。**

1. **Supabase** でプロジェクトを作り、[`supabase/schema.sql`](supabase/schema.sql)
   を SQL Editor に貼り付けて実行する
2. サインアップを止め、接続情報3つを控える
3. **Vercel** でこのリポジトリを取り込む
   - **Root Directory を `apps/web`** にする（ここを変えないとビルドが失敗する）
   - 環境変数に2の3つを入れる
4. 出てきたURLを Supabase の **Site URL** に登録する
5. Supabase の **Authentication** で自分のユーザーを1つ作り、URLを開いてログインする
   （このとき家族と「家族共有」カレンダーができ、自分が管理者になる）

あとは家族をメンバー画面から足せば、URLを開いて使える。スマートフォンからも同じURL。
以後は既定ブランチに変更が入るたび、Vercel が自動でビルドし直す。

## 開発

コードをいじるときだけ、手元でも動かせる。

```bash
pnpm install
cp .env.example .env.local        # Supabase の画面から3つの値を書き写す
pnpm dev
```

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | 開発サーバーの起動 |
| `pnpm build` | 本番ビルド |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 型チェック |
| `pnpm test` | 日付計算などのユニットテスト（Vitest） |
| `pnpm format` | Prettier での整形（Markdown は対象外） |
| `pnpm check` | lint・型チェック・整形確認・テストをまとめて実行 |
| `pnpm --filter web gen:types` | Supabase のスキーマから TypeScript の型を生成 |
| `supabase/tests/run.sh` | マイグレーションと RLS の検証（PostgreSQL が必要） |
| `supabase/bundle.sh` | `supabase/schema.sql` を作り直す（migrations を変えたとき） |

### RLS の検証

`supabase/tests/run.sh` は、使い捨てのデータベースにマイグレーションを流し、
別の家族のデータが見えないことなどを確認する。
Supabase CLI（Docker）が無くても、PostgreSQL さえあれば動く。
CI でも毎回実行している。

### ディレクトリ

```
apps/web/           … Next.js アプリ（ウェブ・デスクトップ共通の画面）
  src/app/(app)/    … ログイン後の画面。機能ごとに分ける
    schedule/       … スケジュール管理
    settings/       … 設定（メンバーなど）
  src/lib/nav/      … 機能の一覧。メニューはここから作る
  src/lib/supabase/ … Supabase クライアント
  src/proxy.ts      … セッション更新（Next.js 16 で middleware.ts から改名）
supabase/           … DBスキーマ（migrations/）とローカル環境の設定
docs/               … 要件定義と設計
```

## 現在のフェーズ

[ロードマップ](docs/03-roadmap.md) の **Step 6（CSV取込と一括削除）まで実装済み**。
次は Step 7（取り込みの繰り返しを楽にする）。

- ログイン、メンバーの登録（ログイン付き／名前だけ）・削除と復帰・名前の変更
- カレンダーの月表示・一覧表示、予定の作成・編集・削除・詳細
- 担当者の色分け、確定／仮／中止の表示
- 機能を切り替えるメニュー（パソコンは上のタブ、スマートフォンは下のバー）
- 担当者での絞り込み、「自分の予定のみ」（`M` キー）、状態の保存
- 週表示・日表示。空いているところをなぞると、その時刻で予定を作れる
- キーボードショートカット（`←` `→` `T` `N` `M` `1`〜`4`）
- 繰り返し予定（毎日／毎週／毎月／毎年）と、
  「この回のみ／これ以降／すべて」の編集・削除
- CSV の取り込み（プレビュー付き）と、取り込み1回ぶんの一括削除・復元

カレンダーは画面の端まで使う。既定は月表示。
予定の入力は開始・終了を常に同じ位置に出し、押した日付が初期値に入る。

DB スキーマと RLS は `supabase/tests/run.sh` で検証済み（79項目）。
日付・絞り込み・繰り返し・CSV の読み取りは `pnpm test` で検証済み（108項目）。
画面の作りは [試作](docs/prototypes/calendar.html)をなぞっている。

未決定事項は [docs/02-schedule-requirements.md](docs/02-schedule-requirements.md) の
「13. 要確認事項」にまとめてある。
