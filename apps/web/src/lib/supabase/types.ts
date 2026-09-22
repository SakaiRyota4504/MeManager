/**
 * Supabase のスキーマに対応する型。
 *
 * 本来は `pnpm --filter web gen:types` で生成する（Supabase CLI が必要）。
 * CLI を使える環境ではそちらで上書きすること。
 * supabase/migrations/ を変更したら、この型も合わせて更新する。
 */

export type MemberRole = "admin" | "member" | "viewer";
export type CalendarVisibility = "family" | "private";

type Timestamps = {
  created_at: string;
  updated_at: string;
};

export type Family = {
  id: string;
  name: string;
  week_start: number;
} & Timestamps;

export type Member = {
  id: string;
  family_id: string;
  user_id: string | null;
  display_name: string;
  color: string;
  role: MemberRole;
  timezone: string;
  is_active: boolean;
  /** ログインに使うアドレス。Supabase 側で同じアドレスのユーザーを作ると紐付く */
  login_email: string | null;
} & Timestamps;

export type EventStatus = "confirmed" | "tentative" | "cancelled";

export type CalendarEvent = {
  id: string;
  family_id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  /** 時刻付きのとき。終了は排他的 */
  starts_at: string | null;
  ends_at: string | null;
  /** 終日のとき。終了は包含的 */
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  color: string | null;
  status: EventStatus;
  /** 繰り返しルール（RFC 5545 の RRULE）。null なら1回きり */
  rrule: string | null;
  /** 取り込み元での識別子。重複の検出にだけ使う */
  external_key: string | null;
  /** どの取り込みで入ったか。null なら手で作った予定 */
  import_batch_id: string | null;
  /** まとめて消されたか。戻すときの目印 */
  deleted_with_batch: boolean;
  created_by: string | null;
  deleted_at: string | null;
} & Timestamps;

export type EventAssignee = {
  event_id: string;
  member_id: string;
};

/** 取り込み1回ぶん */
export type ImportBatch = {
  id: string;
  family_id: string;
  name: string;
  file_name: string | null;
  source: string;
  event_count: number;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
};

/** 取り込みの設定。名前を付けて残し、家族で共有する */
export type ImportPreset = {
  id: string;
  family_id: string;
  name: string;
  settings: Record<string, unknown>;
  created_by: string | null;
} & Timestamps;

/** 繰り返し予定のうち、出さない回 */
export type EventException = {
  event_id: string;
  occurrence_date: string;
  created_at: string;
};

export type UserPreferences = {
  member_id: string;
  family_id: string;
  /** 画面の状態。キーは "schedule.members" のように機能名で始める */
  prefs: Record<string, unknown>;
} & Timestamps;

export type Calendar = {
  id: string;
  family_id: string;
  name: string;
  color: string;
  owner_member_id: string | null;
  visibility: CalendarVisibility;
  is_default: boolean;
} & Timestamps;

/** 家計簿の費目。支出用と収入用がある（docs/07-budget-requirements.md 4.2） */
export type CategoryKind = "expense" | "income";

export type BudgetCategory = {
  id: string;
  family_id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  /** 小さいほど先に出る */
  sort_order: number;
  /** 使わなくなった費目は false。過去の記録は残る */
  is_active: boolean;
} & Timestamps;

/** 家計簿の記録1件 */
export type Transaction = {
  id: string;
  family_id: string;
  occurred_on: string;
  /** 円。支出も収入も正の数で、向きは kind で表す */
  amount: number;
  kind: CategoryKind;
  category_id: string;
  /** 使った人。抜けた人の記録は null になる */
  member_id: string | null;
  note: string | null;
  /** どの固定費から入ったか。手で入れた記録は null */
  recurring_id: string | null;
  created_by: string | null;
  deleted_at: string | null;
} & Timestamps;

/** 費目ごとの月の予算。category_id が null なら全体の予算 */
export type Budget = {
  id: string;
  family_id: string;
  /** その月の1日 */
  month: string;
  category_id: string | null;
  amount: number;
} & Timestamps;

/** budget_status() が返す1行。費目・予算・使った額をまとめたもの */
export type CategoryStatus = {
  category_id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  sort_order: number;
  is_active: boolean;
  /** 予算を決めていなければ null */
  budget: number | null;
  /** その月に使った額 */
  used: number;
  /** 直近90日の件数。よく使う順に並べるために使う */
  uses: number;
};

/** 習慣の頻度の種類。schedule=曜日で決める / count=期間内に何回 */
export type HabitKind = "schedule" | "count";
export type HabitPeriod = "week" | "month";
export type HabitVisibility = "family" | "private";

/** 続けたいこと。予定とは別に持つ（00-product-vision.md 4.4） */
export type Habit = {
  id: string;
  family_id: string;
  /** 担当は1人（FR-H02） */
  member_id: string;
  name: string;
  color: string;
  kind: HabitKind;
  /** kind = "schedule" のとき。スケジュールと同じ RRULE */
  rrule: string | null;
  /** kind = "count" のとき */
  target_count: number | null;
  period: HabitPeriod | null;
  /** "private" は本人だけ。記録も見えない */
  visibility: HabitVisibility;
  is_active: boolean;
  created_by: string | null;
} & Timestamps;

/** やった日。できなかった日の行は作らない */
export type HabitLog = {
  habit_id: string;
  done_on: string;
  created_by: string | null;
  created_at: string;
};

/** 毎月決まって出ていくもの。自動では記録に入れない（FR-B22） */
export type RecurringExpense = {
  id: string;
  family_id: string;
  name: string;
  /** 毎月変わるもの（光熱費）は null。押したときに金額を聞く */
  amount: number | null;
  category_id: string;
  member_id: string | null;
  /** スケジュールと同じ RRULE */
  rrule: string;
  /** 展開の起点 */
  start_date: string;
  is_active: boolean;
  created_by: string | null;
} & Timestamps;

/** budget_trend() が返す1行。月ごとの合計 */
export type TrendPoint = {
  /** その月の1日 */
  month: string;
  expense: number;
  income: number;
};

export type Database = {
  public: {
    Tables: {
      families: {
        Row: Family;
        Insert: Partial<Family> & Pick<Family, "name">;
        Update: Partial<Family>;
        Relationships: [];
      };
      members: {
        Row: Member;
        Insert: Partial<Member> & Pick<Member, "family_id" | "display_name">;
        Update: Partial<Member>;
        Relationships: [];
      };
      events: {
        Row: CalendarEvent;
        Insert: Partial<CalendarEvent>;
        Update: Partial<CalendarEvent>;
        Relationships: [];
      };
      event_assignees: {
        Row: EventAssignee;
        Insert: EventAssignee;
        Update: Partial<EventAssignee>;
        // 外部キーを書いておかないと、supabase-js が
        // `select("*, event_assignees(...)")` の埋め込みを解決できない。
        Relationships: [
          {
            foreignKeyName: "event_assignees_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_assignees_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      user_preferences: {
        Row: UserPreferences;
        Insert: Partial<UserPreferences> &
          Pick<UserPreferences, "member_id" | "family_id">;
        Update: Partial<UserPreferences>;
        Relationships: [];
      };
      import_batches: {
        Row: ImportBatch;
        Insert: Partial<ImportBatch> & Pick<ImportBatch, "family_id" | "name">;
        Update: Partial<ImportBatch>;
        Relationships: [];
      };
      import_presets: {
        Row: ImportPreset;
        Insert: Partial<ImportPreset> &
          Pick<ImportPreset, "family_id" | "name">;
        Update: Partial<ImportPreset>;
        Relationships: [];
      };
      event_exceptions: {
        Row: EventException;
        Insert: Pick<EventException, "event_id" | "occurrence_date">;
        Update: Partial<EventException>;
        Relationships: [
          {
            foreignKeyName: "event_exceptions_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      calendars: {
        Row: Calendar;
        Insert: Partial<Calendar> & Pick<Calendar, "family_id" | "name">;
        Update: Partial<Calendar>;
        Relationships: [];
      };
      budget_categories: {
        Row: BudgetCategory;
        Insert: Partial<BudgetCategory> &
          Pick<BudgetCategory, "family_id" | "name">;
        Update: Partial<BudgetCategory>;
        Relationships: [];
      };
      transactions: {
        Row: Transaction;
        Insert: Partial<Transaction>;
        Update: Partial<Transaction>;
        // 一覧で費目を一緒に引くため、外部キーを書いておく
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "budget_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      habits: {
        Row: Habit;
        Insert: Partial<Habit> &
          Pick<Habit, "family_id" | "member_id" | "name">;
        Update: Partial<Habit>;
        Relationships: [];
      };
      habit_logs: {
        Row: HabitLog;
        Insert: Pick<HabitLog, "habit_id" | "done_on">;
        Update: Partial<HabitLog>;
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey";
            columns: ["habit_id"];
            isOneToOne: false;
            referencedRelation: "habits";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_expenses: {
        Row: RecurringExpense;
        Insert: Partial<RecurringExpense> &
          Pick<
            RecurringExpense,
            "family_id" | "name" | "category_id" | "rrule"
          >;
        Update: Partial<RecurringExpense>;
        Relationships: [];
      };
      budgets: {
        Row: Budget;
        Insert: Partial<Budget> &
          Pick<Budget, "family_id" | "month" | "amount">;
        Update: Partial<Budget>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_event: {
        Args: { payload: Record<string, unknown> };
        Returns: string;
      };
      update_event: {
        Args: {
          target_event_id: string;
          payload: Record<string, unknown>;
          scope?: string;
          occurrence?: string | null;
        };
        Returns: void;
      };
      delete_event: {
        Args: {
          target_event_id: string;
          scope?: string;
          occurrence?: string | null;
        };
        Returns: void;
      };
      restore_event: {
        Args: { target_event_id: string };
        Returns: void;
      };
      prepare_member_for_account: {
        Args: {
          target_family_id: string;
          name?: string | null;
          target_member_id?: string | null;
        };
        Returns: string;
      };
      commit_import: {
        Args: { payload: Record<string, unknown> };
        Returns: { batch_id: string; count: number };
      };
      save_import_preset: {
        Args: { preset_name: string; settings: Record<string, unknown> };
        Returns: string;
      };
      delete_import_batch: {
        Args: { target_batch_id: string };
        Returns: number;
      };
      restore_import_batch: {
        Args: { target_batch_id: string };
        Returns: number;
      };
      budget_status: {
        Args: { target_month?: string | null };
        Returns: CategoryStatus[];
      };
      create_habit: {
        Args: { payload: Record<string, unknown> };
        Returns: string;
      };
      update_habit: {
        Args: { target_habit_id: string; payload: Record<string, unknown> };
        Returns: void;
      };
      toggle_habit_log: {
        Args: { target_habit_id: string; target_date?: string | null };
        Returns: boolean;
      };
      habit_logs_between: {
        Args: { from_date: string; to_date: string };
        Returns: { habit_id: string; done_on: string }[];
      };
      create_recurring_expense: {
        Args: { payload: Record<string, unknown> };
        Returns: string;
      };
      update_recurring_expense: {
        Args: {
          target_recurring_id: string;
          payload: Record<string, unknown>;
        };
        Returns: void;
      };
      record_recurring: {
        Args: {
          target_recurring_id: string;
          target_date: string;
          new_amount?: number | null;
        };
        Returns: string;
      };
      recorded_recurring: {
        Args: { target_month?: string | null };
        Returns: {
          recurring_id: string;
          occurred_on: string;
          amount: number;
        }[];
      };
      budget_trend: {
        Args: { target_month?: string | null; months?: number };
        Returns: { month: string; expense: number; income: number }[];
      };
      total_budget: {
        Args: { target_month?: string | null };
        Returns: number | null;
      };
      effective_budget: {
        Args: { target_category_id: string | null; target_month: string };
        Returns: number | null;
      };
      create_transaction: {
        Args: { payload: Record<string, unknown> };
        Returns: string;
      };
      update_transaction: {
        Args: {
          target_transaction_id: string;
          payload: Record<string, unknown>;
        };
        Returns: void;
      };
      delete_transaction: {
        Args: { target_transaction_id: string };
        Returns: void;
      };
      restore_transaction: {
        Args: { target_transaction_id: string };
        Returns: void;
      };
      create_budget_category: {
        Args: { payload: Record<string, unknown> };
        Returns: string;
      };
      update_budget_category: {
        Args: {
          target_category_id: string;
          payload: Record<string, unknown>;
        };
        Returns: void;
      };
      set_budget: {
        Args: {
          target_category_id: string | null;
          target_month: string | null;
          new_amount: number | null;
        };
        Returns: void;
      };
      save_preference: {
        Args: { key: string; value: unknown };
        Returns: void;
      };
      is_bootstrap: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      add_offline_member: {
        Args: {
          target_family_id: string;
          name: string;
          login_email?: string | null;
        };
        Returns: string;
      };
      set_member_login_email: {
        Args: { target_member_id: string; email: string | null };
        Returns: void;
      };
      deactivate_member: {
        Args: { target_member_id: string };
        Returns: void;
      };
      reactivate_member: {
        Args: { target_member_id: string };
        Returns: void;
      };
      set_member_role: {
        Args: { target_member_id: string; new_role: string };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
