# セットアップ手順

動かすまでの手順。**A と B のどちらか一方**を選べばよい。

| | A. Supabase のサイトを使う | B. 手元で動かす |
| --- | --- | --- |
| 必要なもの | ブラウザと Node.js | ブラウザ、Node.js、**Docker**、**Supabase CLI** |
| 家族が使えるか | **使える**（URLを開くだけ） | 自分のPCでしか動かない |
| 向いている場面 | **実際に使い始めるとき** | コードをいじって試すとき |

迷ったら **A** を選ぶ。家族に使ってもらうには結局 A が必要になる。

---

## A. Supabase のサイトを使う（Docker も CLI も不要）

### A-1. Supabase のプロジェクトを作る

1. https://supabase.com でアカウントを作る（無料）
2. 「New project」でプロジェクトを作る
   - Region は `Northeast Asia (Tokyo)` が近い
   - Database Password は控えておく（あとで使うことがある）
3. 数分待つと準備が終わる

### A-2. テーブルを作る

ここが CLI の代わり。**SQL を1回貼り付けるだけ**で済む。

まず、このリポジトリで次を実行して1つのファイルにまとめる。

```bash
supabase/bundle.sh > schema.sql
```

できた `schema.sql` の中身を全部コピーし、
Supabase の画面左の **SQL Editor** に貼り付けて **Run** を押す。

「Success. No rows returned」と出れば完了。
左の **Table Editor** に `families` `members` `calendars` `events`
`event_assignees` の5つのテーブルが見えるはず。

> `schema.sql` は生成物なので Git には入れない。
> テーブルを変えたいときは `supabase/migrations/` を直してから作り直す。

### A-3. 勝手にアカウントを作られないようにする

**この設定を忘れると、URLを知った人が誰でもアカウントを作れてしまう。**

1. 左の **Authentication** → **Sign In / Providers**
2. **Allow new users to sign up** を **オフ** にする

アプリ側とDB側にも同じ守りが入っているので、これを忘れても
家族のデータが漏れることはない。ただし入口は閉じておく。

### A-4. 接続情報を控える

左の **Project Settings** → **API** に3つある。

| 画面の表記 | 書き写す先 |
| --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| anon public | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| service_role | `SUPABASE_SERVICE_ROLE_KEY` |

**service_role はすべてのデータを操作できる鍵。** 人に見せない。
`NEXT_PUBLIC_` を付けないこと（付けるとブラウザに配られてしまう）。

### A-5. 動かす

```bash
pnpm install
cp .env.example .env.local     # A-4 の3つを書き込む
pnpm dev
```

http://localhost:3000 を開く。
「接続できました」と出たら、最初のアカウントを作る。

### A-6. 家族が使えるようにする（任意）

自分のPCを閉じても使えるようにするには、ウェブに置く。

1. https://vercel.com でこのリポジトリをつなぐ
2. **Root Directory** を `apps/web` にする
3. 環境変数に A-4 の3つを入れる
4. デプロイすると URL が出る。それを家族に渡す

Supabase 側にも、その URL を登録しておく。
**Authentication** → **URL Configuration** → **Site URL** に貼る。

---

## B. 手元で動かす（開発するとき）

### B-1. 必要なものを入れる

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
  - macOS: `brew install supabase/tap/supabase`
  - Windows: `scoop install supabase`

`supabase --version` が表示されれば入っている。

### B-2. 起動する

```bash
supabase start
```

初回は Docker イメージの取得に数分かかる。
終わると接続情報が表示される。

| 表示 | 用途 |
| --- | --- |
| `API URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role key` | `SUPABASE_SERVICE_ROLE_KEY` |
| `Studio URL` | テーブルの中身を見る画面 |
| `Inbucket URL` | ローカルで送られたメールを見る画面 |

### B-3. テーブルを作る

```bash
supabase db reset
```

**このコマンドは、ローカルのデータベースを作り直して
`supabase/migrations/` のSQLを最初から全部流す。**
中のデータは消える。ローカル専用なので、本番のデータには影響しない。

### B-4. 動かす

```bash
pnpm install
cp .env.example .env.local     # B-2 の3つを書き込む
pnpm dev
```

止めるときは `supabase stop`。

---

## よく出るコマンドの意味

| コマンド | 何をするか | 必要なもの |
| --- | --- | --- |
| `supabase start` | 手元に Supabase 一式を起動する | Docker, CLI |
| `supabase stop` | それを止める | Docker, CLI |
| `supabase db reset` | 手元のDBを作り直し、マイグレーションを全部流す | Docker, CLI |
| `supabase db push` | 本番のDBにマイグレーションを流す | CLI |
| `supabase/bundle.sh` | マイグレーションを1ファイルにまとめる（貼り付け用） | 不要 |
| `pnpm dev` | アプリを起動する | Node.js |
| `pnpm test` | 日付計算などのテスト | Node.js |
| `supabase/tests/run.sh` | DBとRLSの検証 | PostgreSQL |

## うまくいかないとき

**「接続できません」と出る**
`.env.local` の3つの値を確認する。書き換えたら開発サーバーを再起動する。

**ログインできない**
A-3 でサインアップを止めているので、`/signup` は最初の1人にしか使えない。
2人目以降は、1人目がログインして「メンバー」画面から登録する。

**「SUPABASE_SERVICE_ROLE_KEY が未設定」と出る**
`.env.local` に3つ目の鍵を書き忘れている。アカウントの作成に必要。

**テーブルが見当たらない**
A-2 の SQL を流し忘れている。SQL Editor で
`select * from families;` を実行して確かめる。
