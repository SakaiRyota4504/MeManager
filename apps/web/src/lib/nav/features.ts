/**
 * 機能の一覧。**メニューはすべてここから作る。**
 *
 * 上のタブ・下のバー・機能の中のタブは、この配列を読んで並べている。
 * 新しい機能を足す作業は、ここに1つ足すことになる。
 * ナビゲーションの実装を機能ごとに書かない（docs/06-app-shell.md 6節）。
 */

export type FeatureId = "schedule" | "habits" | "budget" | "meals" | "settings";

/** 機能の中の画面。2つ以上あるとき、機能のすぐ下にタブとして出る */
export type FeatureScreen = {
  label: string;
  href: string;
  /** 作り終わっているか。省略は true */
  ready?: boolean;
};

export type Feature = {
  id: FeatureId;
  label: string;
  /** メニューを押したときの行き先 */
  href: string;
  /**
   * 作り終わっているか。
   * false の機能はメニューに出さない。押しても何も起きないタブが並ぶと、
   * 壊れているように見えるため。
   */
  ready: boolean;
  screens: FeatureScreen[];
};

export const FEATURES: Feature[] = [
  {
    id: "schedule",
    label: "スケジュール",
    href: "/schedule",
    ready: true,
    // カレンダー1枚だけにする。2段目のタブが出ると、
    // 毎日見る画面の上に「年に13回しか押さないもの」が並んでしまう。
    // 取り込みとその履歴は設定の中に置く（docs/06-app-shell.md 4節）。
    screens: [{ label: "カレンダー", href: "/schedule" }],
  },
  {
    id: "habits",
    label: "習慣",
    href: "/habits",
    ready: false,
    screens: [
      { label: "今日", href: "/habits" },
      { label: "記録", href: "/habits/log" },
    ],
  },
  {
    id: "budget",
    label: "家計簿",
    href: "/budget",
    ready: true,
    // 入力が機能の入口（/budget）。レジを出た直後に開く画面が
    // 集計の下に隠れないようにする（docs/07-budget-requirements.md 6章）。
    screens: [
      { label: "入力", href: "/budget" },
      { label: "一覧", href: "/budget/list" },
      { label: "集計", href: "/budget/summary" },
    ],
  },
  {
    id: "meals",
    label: "献立",
    href: "/meals",
    ready: false,
    screens: [
      { label: "献立", href: "/meals" },
      { label: "レシピ", href: "/meals/recipes" },
      { label: "買い物", href: "/meals/shopping" },
    ],
  },
  {
    id: "settings",
    label: "設定",
    href: "/settings",
    ready: true,
    screens: [
      { label: "メンバー", href: "/settings/members" },
      { label: "費目", href: "/settings/categories" },
      { label: "固定費", href: "/settings/recurring" },
      { label: "取り込み", href: "/settings/import" },
    ],
  },
];

/** メニューに出す機能。画面も、作り終わっているものだけにする */
export const MENU: Feature[] = FEATURES.filter((f) => f.ready).map((f) => ({
  ...f,
  screens: f.screens.filter((s) => s.ready !== false),
}));

/** 最初に開く画面 */
export const HOME = "/schedule";

/** いま開いているパスが、どの機能のものか */
export function featureOf(pathname: string): Feature | undefined {
  return MENU.find(
    (f) => pathname === f.href || pathname.startsWith(`${f.href}/`),
  );
}

/** 機能の中で、いま開いている画面 */
export function screenOf(
  feature: Feature,
  pathname: string,
): FeatureScreen | undefined {
  // 長く一致するものを優先する（/budget より /budget/list）
  return [...feature.screens]
    .sort((a, b) => b.href.length - a.href.length)
    .find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}
