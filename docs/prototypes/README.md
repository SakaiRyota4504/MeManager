# 試作（プロトタイプ）

実装に入る前に、操作感を確かめるために作った画面。
**アプリ本体とは別物**で、データは架空・保存もされない。

| ファイル | 内容 | 状態 |
| --- | --- | --- |
| `calendar.html` | カレンダー画面（月表示・一覧表示・絞り込み・予定の追加） | 確認済み |

## 見かた

`calendar.html` は publish 用に `<!doctype html>` などの外枠を持たないので、
ブラウザで直接開くときは次のように包む。

```bash
{ echo '<!doctype html><html><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
  cat docs/prototypes/calendar.html
  echo '</body></html>'
} > /tmp/preview.html
```

## この試作で決めたこと

実装（Step 2〜4）はここで確認した内容に従う。詳細は
[../02-schedule-requirements.md](../02-schedule-requirements.md) の 9章。

- 配色とメンバーの色は `apps/web/src/app/globals.css` と
  `pick_member_color()` に合わせてある。見た目はこのまま実装する
- スマートフォンの既定は一覧表示
- 月表示の予定名は、どの画面幅でも全角5文字以上が読める
- 予定そのものをタップすると詳細、マスの余白をタップすると追加

## 試作で見つかった実装上の注意

1. **`.chip` に `font: inherit` を書くと `font-size` が本文サイズに戻る。**
   button 要素にするときは font 系を個別に指定する
2. **`grid-template-columns: repeat(7, 1fr)` は横スクロールを生む。**
   `1fr` は中身より縮まないため、`minmax(0, 1fr)` にする
3. **7列の月表示は幅430px未満だと1行に5文字入らない。**
   460px以下では2行に折り返す
