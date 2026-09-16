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

## アカウントは3種類ある

紛らわしいので先に整理しておく。**別物**なので混ぜないこと。

| | どこで作る | 何のため | 誰が持つ |
| --- | --- | --- | --- |
| **Supabase のアカウント** | supabase.com | データベースの管理画面に入る | 作った人だけ |
| **Vercel のアカウント** | vercel.com | アプリの置き場を管理する | 作った人だけ |
| **MeManager のアカウント** | **自分のアプリのURL** | **カレンダーを使う** | **家族それぞれ** |

上の2つは**準備のため**のもの。GitHub アカウントでサインインするだけで、
家族には関係ない。

3つ目が**アプリを使うためのアカウント**で、こちらが本番。
`https://自分のアプリ.vercel.app` を開いて作る。
Supabase の画面では作らない。

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

## 3. アプリのアカウントを作る

**ここからが MeManager 本体の話。** Supabase の画面はもう使わない。

### 3-1. 最初の1人（自分）

1. **Vercel のURL**（`https://....vercel.app`）をブラウザで開く
2. **アカウントを作る** を押す
3. 入力する

| 項目 | 例 | 備考 |
| --- | --- | --- |
| あなたの表示名 | `父` | カレンダーに出る名前 |
| 家族の名前 | `さかい家` | 未入力なら「父 の家族」になる |
| メールアドレス | `chichi@example.com` | ログインに使う。実在しなくても動く |
| パスワード | 8文字以上 | 自分で決める |

4. **アカウントを作る** を押すと、そのままログインした状態になる

このとき裏で3つが同時に作られる。

- あなたのアカウント（管理者）
- 家族
- 「家族共有」カレンダー

> **この画面が使えるのは最初の1人だけ。**
> 2人目以降が `/signup` を開くと「管理者が登録します」と出る。

### 3-2. 家族を登録する

上の **メンバー** を開き、**メンバーを追加する** で1人ずつ足す。

**ログインさせたい家族**（配偶者など）

1. 表示名を入れる（例: `母`）
2. **この人がログインできるようにする** にチェック
3. メールアドレスとパスワードを決めて入力
4. **追加**
5. 決めた内容を本人に伝える。本人は同じURLからログインする

**ログインしない家族**（小さいお子さんなど）

1. 表示名だけ入れて **追加**
2. 予定の担当者として選べるようになる
3. 大きくなったら、行の右の **ログインを設定** からあとで足せる

### 3-3. 使う

**カレンダー** を開いて予定を追加する。
スマートフォンからも同じURLで使える。

---

## アカウントのまとめ

| やりたいこと | どこを開くか |
| --- | --- |
| 最初のアカウントを作る | アプリのURL → アカウントを作る |
| 家族を増やす | アプリのURL → メンバー → メンバーを追加する |
| ログインする | アプリのURL → ログイン |
| テーブルの中身を見る | Supabase → Table Editor |
| 誰が登録されているか見る | アプリのURL → メンバー（Supabase でなくてよい） |

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

**Supabase の Authentication に自分のアカウントが見当たらない**
まだアプリでアカウントを作っていない。
Supabase の画面ではなく、**アプリのURL**を開いて作る（3-1）。

**最初のアカウントが作れない**
1-3 でサインアップを止めていても、この画面は動くようにしてある
（管理APIを使っているため）。それでも失敗するなら、
画面に出たエラーの文言をそのまま知らせてほしい。

**「SUPABASE_SERVICE_ROLE_KEY が未設定」と出る**
3つ目の鍵を入れ忘れている。アカウントの作成に必要。

**テーブルが見当たらない**
1-2 の SQL を流し忘れている。SQL Editor で
`select * from families;` を実行して確かめる。
