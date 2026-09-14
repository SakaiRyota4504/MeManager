# Supabase

DB スキーマとローカル開発環境の設定。

## 必要なもの

- Docker
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## ローカル環境の起動

```bash
supabase start
```

初回は Docker イメージの取得に時間がかかる。
起動すると接続情報が表示されるので、`API URL` と `anon key` を
リポジトリ直下の `.env.local` に書き写す（`.env.example` を参照）。

| URL                    | 用途                                         |
| ---------------------- | -------------------------------------------- |
| http://127.0.0.1:54321 | API                                          |
| http://127.0.0.1:54323 | Studio（テーブルの中身を見る）               |
| http://127.0.0.1:54324 | Inbucket（ローカルで送信されたメールを見る） |

停止は `supabase stop`。

## マイグレーション

スキーマの変更は必ず `migrations/` にファイルを足して行う。
Studio から直接テーブルを触ると、他の環境に反映されない。

```bash
# 新しいマイグレーションファイルを作る
supabase migration new create_families

# ローカルDBを作り直してマイグレーションを全部流す
supabase db reset

# 本番に適用する
supabase db push
```

## 型の生成

テーブルを変更したら、TypeScript の型を作り直す。

```bash
pnpm --filter web gen:types
```
