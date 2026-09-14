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

export type Invitation = {
  id: string;
  family_id: string;
  token_hash: string;
  email: string | null;
  member_id: string | null;
  created_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
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
      calendars: {
        Row: Calendar;
        Insert: Partial<Calendar> & Pick<Calendar, "family_id" | "name">;
        Update: Partial<Calendar>;
        Relationships: [];
      };
      invitations: {
        Row: Invitation;
        Insert: Partial<Invitation> &
          Pick<Invitation, "family_id" | "token_hash" | "expires_at">;
        Update: Partial<Invitation>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_invitation: {
        Args: {
          target_family_id: string;
          target_email?: string | null;
          target_member_id?: string | null;
          valid_days?: number;
        };
        Returns: string;
      };
      peek_invitation: {
        Args: { token: string };
        Returns: {
          family_name: string;
          is_valid: boolean;
          requires_email: boolean;
          email_hint: string | null;
        }[];
      };
      accept_invitation: {
        Args: { token: string };
        Returns: string;
      };
      revoke_invitation: {
        Args: { invitation_id: string };
        Returns: void;
      };
      is_bootstrap: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      add_offline_member: {
        Args: { target_family_id: string; name: string };
        Returns: string;
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
