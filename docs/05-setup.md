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
| **MeManager のアカウント** | **管理者が用意する** | **カレンダーを使う** | **家族それぞれ** |

上の2つは**準備のため**のもの。GitHub アカウントでサインインするだけで、
家族には関係ない。

3つ目が**アプリを使うためのアカウント**で、こちらが本番。
**自分では作れない。**アプリのログイン画面に「アカウントを作る」は無く、
用意するのは管理者だけ（3章）。
家族は、伝えられたメールアドレスとパスワードでログインするだけになる。

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
2. **右上の「Raw」を押す**（重要）
3. その画面で `Ctrl/Cmd + A` → `Ctrl/Cmd + C` で全部コピーする
4. Supabase の画面左の **SQL Editor** を開く
5. 貼り付けて **Run**（`Ctrl/Cmd + Enter` でも可）

> **2 を飛ばさない。** GitHub の通常の表示は、長いファイルを
> 画面に映っているぶんしか持っていない。そのままコピーすると
> **途中で切れたものが貼られる**。Raw なら1枚のテキストなので切れない。

**Success. No rows returned** と出れば完了。
左の **Table Editor** に6つのテーブルが見える。

| テーブル | 中身 |
| --- | --- |
| `families` | 家族 |
| `members` | メンバー |
| `calendars` | カレンダー |
| `events` | 予定 |
| `event_assignees` | 予定の担当者 |
| `user_preferences` | 画面の設定（絞り込みなど） |

> 全体が `begin;` 〜 `commit;` で囲んであるので、
> 途中で失敗しても中途半端なテーブルは残らない。貼り直せばよい。

> `schema.sql` は `supabase/migrations/` から機械的に作った写し。
> **手で書き換えない。**

### 1-3. 勝手にアカウントを作られないようにする

1. 左の **Authentication** → **Sign In / Providers**
2. **Allow new users to sign up** を **オフ** にして保存

アカウントを作れる口は、これで次の3層すべてが閉じた状態になる。

| 層 | 守り |
| --- | --- |
| 画面 | ログイン画面に「アカウントを作る」が無い |
| Supabase | ここで公開サインアップを止める |
| データベース | 管理者が用意した枠に一致しないユーザーは、作成ごと失敗する |

> 2を忘れても、3が残るので知らない人のアカウントは生まれない。
> それでも入口は閉じておく。

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

**アカウントを作れるのは管理者だけ。** 家族が自分で作る画面は無い。

作り方は2通りある。どちらでも結果は同じ。

| | どこで作る | 向いている場面 |
| --- | --- | --- |
| **A** | アプリの **設定 → メンバー** | ふだんはこちら。Supabase を開かなくてよい |
| **B** | Supabase の **Authentication** | 1人目。あとはパスワードを自分で管理したいとき |

### 3-1. 最初の1人（自分）

**1人目だけは B で作る。**まだアプリにログインできる人がいないため。

1. Supabase の左の **Authentication** → **Users**
2. **Add user** → **Create new user**
3. 入力する
   - **Email**: 自分のメールアドレス（実在しなくても動く）
   - **Password**: 8文字以上
   - **Auto Confirm User**: **オン**（オフだと確認メール待ちになる）
4. **Create user**
5. **Vercel のURL**（`https://....vercel.app`）を開いてログインする

このとき裏で3つが同時に作られる。

- あなたのアカウント（**管理者**）
- 家族
- 「家族共有」カレンダー

> 表示名はメールアドレスの `@` より前、家族の名前は「◯◯ の家族」になる。
> どちらも **設定 → メンバー** の **名前を変える** から直せる。

### 3-2. 家族を増やす

#### A. アプリで作る（ふだんはこちら）

上の **設定** を開き、**メンバーを追加する** で1人ずつ足す。

**ログインさせたい家族**（配偶者など）

1. 表示名を入れる（例: `母`）
2. **この人がログインできるようにする** にチェック
3. メールアドレスと**パスワード**を決めて入力
4. **追加**
5. 決めた内容を本人に伝える。本人は同じURLからログインする

**ログインしない家族**（小さいお子さんなど）

1. 表示名だけ入れて **追加**
2. 予定の担当者として選べるようになる
3. 大きくなったら、行の右の **ログインを設定** からあとで足せる

#### B. Supabase で作る

パスワードを Supabase 側で管理したいときはこちら。**順番が逆になると失敗する。**

1. アプリの **設定 → メンバー** で表示名とメールアドレスを登録する
   （**パスワードは空のまま**「追加」を押す）
2. その人の行に「`◯◯@example.com` を待っています」と出る
3. Supabase の **Authentication** → **Add user** で、**同じメールアドレス**の
   ユーザーを作る（Auto Confirm User はオン）
4. 本人がアプリのURLからログインすると、1で登録したメンバーとして入る

> **先に1をやらずに3をやると、ユーザーの作成そのものが失敗する**
> （`Database error creating new user` と出る）。これは故意にそうしてある。
> 知らないアドレスのアカウントが家族に紛れ込まないようにするため。

### 3-3. 使う

**カレンダー** を開いて予定を追加する。
スマートフォンからも同じURLで使える。

---

## アカウントのまとめ

| やりたいこと | どこを開くか |
| --- | --- |
| 最初のアカウントを作る | Supabase → Authentication → Add user |
| 家族を増やす | アプリのURL → 設定 → メンバーを追加する |
| Supabase 側で家族を増やす | アプリで枠を登録 → Supabase → Add user |
| ログインする | アプリのURL → ログイン |
| 表示名・家族の名前を直す | アプリのURL → 設定 → 名前を変える |
| 誰が登録されているか見る | アプリのURL → 設定（Supabase でなくてよい） |
| テーブルの中身を見る | Supabase → Table Editor |

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

**ログイン画面に「アカウントを作る」が無い**
そういう作りにしてある。アカウントは管理者が用意する（3章）。

**Supabase で `Database error creating new user` と出る**
そのメールアドレスが、どのメンバーにも登録されていない。
先にアプリの **設定 → メンバー** でアドレスを登録してから作り直す（3-2 B）。
1人目（まだ家族が無いとき）だけは、登録なしで作れる。

**Supabase で作ったのにログインできない**
**Auto Confirm User** がオフだと、確認が済むまでログインできない。
Authentication → Users でその人の行を開き、確認済みにするか、作り直す。

**「SUPABASE_SERVICE_ROLE_KEY が未設定」と出る**
3つ目の鍵が Vercel に入っていない。直し方は2通り。

**A. 鍵を入れる**（メンバー画面でパスワードまで決めたい場合）

1. Supabase の **Project Settings** → **API Keys** → **Secret key** を **Reveal** してコピー
2. Vercel の **Settings** → **Environment Variables** で
   `SUPABASE_SERVICE_ROLE_KEY` として追加する
   - 名前は1文字も違わないこと。`NEXT_PUBLIC_` は**付けない**
   - **Production** にチェックが入っていること
3. **Deployments** → 最新の **⋯** → **Redeploy**

> **3を飛ばさない。** 環境変数を足しただけでは、すでに動いているものには反映されない。

**B. 鍵を入れない**（Supabase 側でアカウントを作る場合）

鍵が無いときは、メンバー画面のパスワード欄が最初から出ない。
メールアドレスだけ入れて追加し、Supabase の **Authentication** →
**Add user** で同じアドレスのユーザーを作る（3-2 B）。こちらは鍵が要らない。

**テーブルが見当たらない**
1-2 の SQL を流し忘れている。次の確認用の SQL を実行すると、
どこまで入っているかが1行で分かる。

```sql
select
  to_regclass('public.families')         is not null as "土台",
  to_regclass('public.events')           is not null as "予定",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'members'
            and column_name = 'login_email')         as "アカウント",
  to_regclass('public.user_preferences') is not null as "画面の設定";
```

`false` のところから先が未実行。

**`unterminated dollar-quoted string` と出る**
貼り付けた SQL が**途中で切れている**。
関数の中身が閉じないまま終わったときに出るエラーで、
書いてある行番号は「切れ始めた場所」ではなく「関数が始まった場所」。

GitHub の通常の表示からコピーすると起きる。**Raw の画面からコピーし直す**（1-2）。

> 流し直して構わない。途中まで実行されて困ることはないように書いてある。
