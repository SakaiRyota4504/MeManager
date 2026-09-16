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
| [docs/prototypes/](docs/prototypes/) | 実装前に操作感を確かめた試作画面 |

## 利用者の管理

- **アカウントは招待がないと作れない。** 家族だけで使うアプリなので、
  知らない人がアカウントを持てないよう入口を閉じている
  - 例外は最初の1人だけ。家族がまだ無いときに限り、招待なしで登録できる
  - 招待リンクには宛先のメールアドレスを指定でき、転送されても他人は使えない
  - 未使用の招待は、使われる前に取り消せる
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

## 開発

### 必要なもの

- Node.js 22 以降
- pnpm 10 以降（`corepack enable` で有効にできる）
- Docker と [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

### 手順

```bash
pnpm install

# Supabase のローカル環境を起動する（初回は Docker イメージの取得に時間がかかる）
supabase start

# 表示された API URL / anon key / service_role key を .env.local に書き写す
# service_role key はアカウントの作成に必要（サーバー側でのみ使う）
cp .env.example .env.local

# マイグレーションを適用する
supabase db reset

pnpm dev
```

http://localhost:3000 を開くと、セットアップの状態が表示される。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | 開発サーバーの起動 |
| `pnpm build` | 本番ビルド |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 型チェック |
| `pnpm format` | Prettier での整形（Markdown は対象外） |
| `pnpm check` | lint・型チェック・整形確認をまとめて実行 |
| `pnpm --filter web gen:types` | Supabase のスキーマから TypeScript の型を生成 |
| `supabase/tests/run.sh` | マイグレーションと RLS の検証（PostgreSQL が必要） |

### RLS の検証

`supabase/tests/run.sh` は、使い捨てのデータベースにマイグレーションを流し、
別の家族のデータが見えないことなどを確認する。
Supabase CLI（Docker）が無くても、PostgreSQL さえあれば動く。
CI でも毎回実行している。

### ディレクトリ

```
apps/web/           … Next.js アプリ（ウェブ・デスクトップ共通の画面）
  src/app/          … 画面とRoute Handler
  src/lib/supabase/ … Supabase クライアント
  src/proxy.ts      … セッション更新（Next.js 16 で middleware.ts から改名）
supabase/           … DBスキーマ（migrations/）とローカル環境の設定
docs/               … 要件定義と設計
```

## 現在のフェーズ

[ロードマップ](docs/03-roadmap.md) の **Step 1（認証と家族・メンバー）まで実装済み**。
次は Step 2（予定の基本機能）。

ログイン・招待リンクの発行と取り消し・メンバーの追加と削除が動く。
DB スキーマと RLS は `supabase/tests/run.sh` で検証済み（33項目）。

カレンダー画面は [試作](docs/prototypes/calendar.html)で操作感を確認済み。
実装は要件定義の9章（画面）に従う。

未決定事項は [docs/02-schedule-requirements.md](docs/02-schedule-requirements.md) の
「13. 要確認事項」にまとめてある。
