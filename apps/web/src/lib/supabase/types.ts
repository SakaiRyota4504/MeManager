/**
 * Supabase のスキーマから生成する型の置き場。
 *
 * 生成コマンド:
 *   pnpm --filter web gen:types
 *
 * まだテーブルが無いので、今は空の定義を置いている。
 * Step 1 でテーブルを作ったら生成し直す。
 */
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
