import { redirect } from "next/navigation";

import { MENU } from "@/lib/nav/features";

/** 設定は最初の画面へ送る。画面が増えたら、ここに一覧を作る */
export default function SettingsPage() {
  const settings = MENU.find((f) => f.id === "settings")!;
  redirect(settings.screens[0].href);
}
