# MeManager

家族で共有して使う「暮らしの管理」アプリ。
操作性重視のデスクトップアプリと、外出先から参照・入力できるウェブアプリのハイブリッド構成を目指す。

## 提供予定の機能

| 機能 | 概要 | 状態 |
| --- | --- | --- |
| スケジュール管理 | 家族の予定を共有カレンダーで管理する | 要件定義中（第1弾） |
| 家計簿 | 収支の記録・集計・予算管理 | 未着手 |
| 献立管理 | 献立の計画と、家計簿・買い物との連携 | 未着手 |

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

## スケジュール管理の要点

- 予定には**担当者の指定を必須**とし、人単位で絞り込めるようにする
- 外部データの取込口は**ファイルの取り込み1つ**に統一する。
  アプリが外部サービスを直接呼ぶことはしない
  - football-data.org のようなデータ源は、別途作るプログラムで
    **MeManager 標準CSV形式**のファイルにしてから取り込む
  - Google カレンダー / Outlook の .ics や、配られた日程表の CSV も同じ画面から取り込む
- 取り込みの頻度は**月1回（休日）と年1回（サッカーの年間日程）**を想定する。
  自動化は作らず、そのぶん毎月の繰り返し操作を短くすることに手をかける
  （取り込み設定を「プリセット」として保存し、次回はファイルを渡すだけにする）

## 現在のフェーズ

要件定義。実装コードはまだ存在しない。

未決定事項は [docs/02-schedule-requirements.md](docs/02-schedule-requirements.md) の
「13. 要確認事項」にまとめてある。
