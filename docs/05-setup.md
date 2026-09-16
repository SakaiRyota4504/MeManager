# セットアップ手順

**PCには何もインストールしない。** ブラウザだけで公開まで終わる。

Supabase（データの置き場）と Vercel（アプリの置き場）を、
それぞれのサイトで設定してつなぐ。所要時間は15分ほど。

```
   GitHub のこのリポジトリ
            │
            │ つなぐと自動でビルドされる
            ▼
   ┌─────────────────┐        ┌──────────────────┐
   │     Vercel      │ ─────▶ │    Supabase      │
   │  （アプリの置き場） │        │ （データの置き場）  │
   │  https://...    │        │  テーブル・ログイン │
   └─────────────────┘        └──────────────────┘
            │
            ▼
   家族がこのURLを開いて使う
```

---

## 1. Supabase を用意する

### 1-1. プロジェクトを作る

1. https://supabase.com にアクセスし、GitHub アカウントでサインイン
2. **New project** を押す
3. 入力する
   - **Name**: `memanager`（何でもよい）
   - **Database Password**: 適当に作って控えておく
   - **Region**: `Northeast Asia (Tokyo)`
4. **Create new project** を押し、2〜3分待つ

### 1-2. テーブルを作る

1. リポジトリの **[`supabase/schema.sql`](../supabase/schema.sql)** を開く
2. 中身を**全部**コピーする（1800行ほどある）
3. Supabase の画面左の **SQL Editor** を開く
4. 貼り付けて **Run**（`Ctrl/Cmd + Enter` でも可）

**Success. No rows returned** と出れば完了。
左の **Table Editor** に5つのテーブルが見える。

| テーブル | 中身 |
| --- | --- |
| `families` | 家族 |
| `members` | メンバー |
| `calendars` | カレンダー |
| `events` | 予定 |
| `event_assignees` | 予定の担当者 |

> 全体が `begin;` 〜 `commit;` で囲んであるので、
> 途中で失敗しても中途半端なテーブルは残らない。貼り直せばよい。

> `schema.sql` は `supabase/migrations/` から機械的に作った写し。
> **手で書き換えない。**

### 1-3. 勝手にアカウントを作られないようにする

**忘れると、URLを知った人が誰でもアカウントを作れてしまう。**

1. 左の **Authentication** → **Sign In / Providers**
2. **Allow new users to sign up** を **オフ** にして保存

> 忘れても家族のデータは漏れない。アプリとDBにも同じ守りがあり、
> 登録していない人はDBのトリガーで弾かれる。ただし入口は閉じておく。

### 1-4. 接続情報を控える

左の **Project Settings** → **API Keys** を開く。使うのは3つだけ。

**鍵の名前は、プロジェクトを作った時期で2通りある。どちらでも動く。**
2025年以降に作ったプロジェクトは新しい表記になっていることが多い。

| 用途 | 新しい表記 | 古い表記 | 設定する名前 |
| --- | --- | --- | --- |
| URL | Project URL | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| ブラウザ用の鍵 | **Publishable key**（`sb_publishable_…`） | **anon public** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| サーバー用の鍵 | **Secret key**（`sb_secret_…`） | **service_role** | `SUPABASE_SERVICE_ROLE_KEY` |

Secret key は最初は隠れている。**Reveal** を押すと出る。

**3つ目の鍵はすべてのデータを操作できる。** 人に見せない。
チャットやメールに貼らない。GitHub に入れない。

> ブラウザ用の鍵（1つ目）は公開されて構わない。
> これで何ができるかは RLS が決めていて、
> 他の家族のデータは取れないようになっている。

---

## 2. Vercel に置く

### 2-1. リポジトリをつなぐ

1. https://vercel.com にアクセスし、GitHub アカウントでサインイン
2. **Add New...** → **Project**
3. `SakaiRyota4504/MeManager` を選んで **Import**

### 2-2. 設定する

デプロイ前の画面で2か所いじる。

**Root Directory**（重要）

- **Edit** を押して `apps/web` を選ぶ
- アプリは `apps/web` にあるので、ここを変えないとビルドが失敗する

**Environment Variables**

1-4 で控えた3つを入れる。

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL（`https://xxxx.supabase.co`） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key（または anon public） |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key（または service_role） |

名前は**1文字も間違えない**（大文字小文字も含めて）。
`NEXT_PUBLIC_` の付け外しを間違えると動かない。

Environment は **Production / Preview / Development** の3つとも
チェックを入れたままでよい。

**Deploy** を押す。2〜3分でURLが出る。

### 2-3. Supabase にURLを教える

ログインの戻り先として登録する。

1. Supabase の **Authentication** → **URL Configuration**
2. **Site URL** に Vercel のURL（`https://....vercel.app`）を貼る
3. 保存

---

## 3. 使い始める

1. Vercel のURLを開く
2. **アカウントを作る** から最初のアカウントを作る
   - ここで作った人が家族の管理者になる
   - 家族と「家族共有」カレンダーも同時に作られる
3. **メンバー** 画面から家族を登録する
   - ログインさせる人には、メールアドレスとパスワードを決めて伝える
   - 小さいお子さんは名前だけでよい（予定の担当者に指定できる）
4. **カレンダー** 画面で予定を追加する

スマートフォンからも同じURLで使える。

---

## 更新するとき

GitHub の既定ブランチ（`claude/eager-euler-1p9wkr`）に変更が入ると、
**Vercel が自動でビルドし直す。** 何もしなくてよい。

ただし**テーブルの形が変わったときだけ**、Supabase 側の更新が要る。
そのときはこちらから知らせるので、新しい SQL を SQL Editor で実行する。

---

## 開発するとき（コードをいじる場合）

使うだけなら、ここから先は読まなくてよい。

### 手元で動かす

```bash
pnpm install
cp .env.example .env.local     # 1-4 の3つを書き込む
pnpm dev
```

http://localhost:3000 が開く。データは Supabase を共有するので、
Vercel 版と同じものが見える。

### データも手元で動かす（Docker が必要）

本番のデータを触りたくないときは、Supabase も手元に立てる。

```bash
supabase start        # Docker と Supabase CLI が要る
supabase db reset     # 手元のDBを作り直し、マイグレーションを全部流す
```

`supabase start` が出す URL と鍵を `.env.local` に書き写す。
止めるときは `supabase stop`。

---

## うまくいかないとき

**Vercel のビルドが失敗する**
Root Directory が `apps/web` になっているか確認する（2-2）。
それでも失敗するなら、ビルドログを見せてほしい。

**「接続できません」と出る**
環境変数の3つを確認する。Vercel では
**Settings** → **Environment Variables** から直せる。
直したあとは **Deployments** → 最新の **⋯** → **Redeploy** が必要。

**ログインできない**
1-3 でサインアップを止めているので、`/signup` は最初の1人にしか使えない。
2人目以降は、1人目がログインして「メンバー」画面から登録する。

**「SUPABASE_SERVICE_ROLE_KEY が未設定」と出る**
3つ目の鍵を入れ忘れている。アカウントの作成に必要。

**テーブルが見当たらない**
1-2 の SQL を流し忘れている。SQL Editor で
`select * from families;` を実行して確かめる。
