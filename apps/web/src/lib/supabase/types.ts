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
  created_by: string | null;
  deleted_at: string | null;
} & Timestamps;

export type EventAssignee = {
  event_id: string;
  member_id: string;
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
      calendars: {
        Row: Calendar;
        Insert: Partial<Calendar> & Pick<Calendar, "family_id" | "name">;
        Update: Partial<Calendar>;
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
        Args: { target_event_id: string; payload: Record<string, unknown> };
        Returns: void;
      };
      delete_event: {
        Args: { target_event_id: string };
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
