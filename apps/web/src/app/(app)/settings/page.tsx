import { redirect } from "next/navigation";

import { FEATURES } from "@/lib/nav/features";

/** 設定は最初の画面へ送る。画面が増えたら、ここに一覧を作る */
export default function SettingsPage() {
  const settings = FEATURES.find((f) => f.id === "settings")!;
  redirect(settings.screens[0].href);
}
