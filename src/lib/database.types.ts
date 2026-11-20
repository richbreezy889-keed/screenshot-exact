export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      applications: {
        Row: {
          campaign_id: string
          created_at: string
          creator_id: string
          id: string
          pitch: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          creator_id: string
          id?: string
          pitch?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          creator_id?: string
          id?: string
          pitch?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_members: {
        Row: {
          brand_id: string
          created_at: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          brand_id: string
          brief: string | null
          budget: number
          created_at: string
          created_by: string
          creator_cap: number | null
          creators_needed: number
          deadline: string
          id: string
          niche: string | null
          platforms: Database["public"]["Enums"]["social_platform"][]
          published_at: string | null
          rate_per_1k: number
          status: Database["public"]["Enums"]["campaign_status"]
          title: string
          updated_at: string
          videos_per_creator: number
        }
        Insert: {
          brand_id: string
          brief?: string | null
          budget: number
          created_at?: string
          created_by?: string
          creator_cap?: number | null
          creators_needed: number
          deadline: string
          id?: string
          niche?: string | null
          platforms?: Database["public"]["Enums"]["social_platform"][]
          published_at?: string | null
          rate_per_1k: number
          status?: Database["public"]["Enums"]["campaign_status"]
          title: string
          updated_at?: string
          videos_per_creator?: number
        }
        Update: {
          brand_id?: string
          brief?: string | null
          budget?: number
          created_at?: string
          created_by?: string
          creator_cap?: number | null
          creators_needed?: number
          deadline?: string
          id?: string
          niche?: string | null
          platforms?: Database["public"]["Enums"]["social_platform"][]
          published_at?: string | null
          rate_per_1k?: number
          status?: Database["public"]["Enums"]["campaign_status"]
          title?: string
          updated_at?: string
          videos_per_creator?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          handle: string
          id: string
          location: string | null
          niche: string | null
          past_campaigns: number
          rating: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          handle: string
          id: string
          location?: string | null
          niche?: string | null
          past_campaigns?: number
          rating?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          handle?: string
          id?: string
          location?: string | null
          niche?: string | null
          past_campaigns?: number
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creators_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          checkpoint_days: number
          default_currency: string
          fee_bps: number
          id: boolean
          max_videos_per_creator: number
          min_rate_per_1k: number
          min_topup: number
          platform_name: string
          review_hours: number
          support_email: string | null
          updated_at: string
        }
        Insert: {
          checkpoint_days?: number
          default_currency?: string
          fee_bps?: number
          id?: boolean
          max_videos_per_creator?: number
          min_rate_per_1k?: number
          min_topup?: number
          platform_name?: string
          review_hours?: number
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          checkpoint_days?: number
          default_currency?: string
          fee_bps?: number
          id?: boolean
          max_videos_per_creator?: number
          min_rate_per_1k?: number
          min_topup?: number
          platform_name?: string
          review_hours?: number
          support_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          phone_verified_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          phone_verified_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          phone_verified_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          avg_views: number
          created_at: string
          creator_id: string
          followers: number
          handle: string
          id: string
          platform: Database["public"]["Enums"]["social_platform"]
          profile_url: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          avg_views?: number
          created_at?: string
          creator_id: string
          followers?: number
          handle: string
          id?: string
          platform: Database["public"]["Enums"]["social_platform"]
          profile_url?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          avg_views?: number
          created_at?: string
          creator_id?: string
          followers?: number
          handle?: string
          id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          profile_url?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          application_id: string
          campaign_id: string
          created_at: string
          creator_id: string
          id: string
          note: string | null
          platform: Database["public"]["Enums"]["social_platform"]
          posted_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["submission_status"]
          updated_at: string
          video_url: string
        }
        Insert: {
          application_id: string
          campaign_id: string
          created_at?: string
          creator_id: string
          id?: string
          note?: string | null
          platform: Database["public"]["Enums"]["social_platform"]
          posted_at: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          updated_at?: string
          video_url: string
        }
        Update: {
          application_id?: string
          campaign_id?: string
          created_at?: string
          creator_id?: string
          id?: string
          note?: string | null
          platform?: Database["public"]["Enums"]["social_platform"]
          posted_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          updated_at?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      view_checkpoints: {
        Row: {
          checkpoint_at: string
          created_at: string
          evidence_url: string | null
          id: string
          status: Database["public"]["Enums"]["checkpoint_status"]
          submission_id: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          views: number
        }
        Insert: {
          checkpoint_at: string
          created_at?: string
          evidence_url?: string | null
          id?: string
          status?: Database["public"]["Enums"]["checkpoint_status"]
          submission_id: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          views?: number
        }
        Update: {
          checkpoint_at?: string
          created_at?: string
          evidence_url?: string | null
          id?: string
          status?: Database["public"]["Enums"]["checkpoint_status"]
          submission_id?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "view_checkpoints_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_checkpoints_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      campaigns_public: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          brief: string | null
          created_at: string | null
          creators_needed: number | null
          deadline: string | null
          id: string | null
          niche: string | null
          open_slots: number | null
          platforms: Database["public"]["Enums"]["social_platform"][] | null
          rate_per_1k: number | null
          status: Database["public"]["Enums"]["campaign_status"] | null
          title: string | null
          updated_at: string | null
          videos_per_creator: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      application_approved_at: {
        Args: { target_application_id: string }
        Returns: string
      }
      application_has_submissions: {
        Args: { target_application_id: string }
        Returns: boolean
      }
      brand_role: {
        Args: { target_brand_id: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      brand_wallet_statement: {
        Args: { p_brand_id: string; p_limit?: number }
        Returns: {
          amount: number
          balance_after: number
          campaign_id: string
          entry_id: number
          kind: string
          occurred_at: string
          reference: string
        }[]
      }
      brand_wallet_summary: { Args: { p_brand_id: string }; Returns: number }
      campaign_has_applications: {
        Args: { target_campaign_id: string }
        Returns: boolean
      }
      campaign_is_live: {
        Args: { target_campaign_id: string }
        Returns: boolean
      }
      can_manage_brand: { Args: { target_brand_id: string }; Returns: boolean }
      can_manage_campaign: {
        Args: { target_campaign_id: string }
        Returns: boolean
      }
      can_manage_submission: {
        Args: { target_submission_id: string }
        Returns: boolean
      }
      can_view_campaign: {
        Args: { target_campaign_id: string }
        Returns: boolean
      }
      can_view_submission: {
        Args: { target_submission_id: string }
        Returns: boolean
      }
      cancel_campaign: {
        Args: { p_campaign_id: string; p_reason: string }
        Returns: string
      }
      close_due_campaigns: { Args: { p_limit?: number }; Returns: number }
      confirm_brand_withdrawal: {
        Args: {
          p_provider?: string
          p_provider_ref: string
          p_reference: string
        }
        Returns: string
      }
      confirm_deposit: {
        Args: {
          p_amount: number
          p_provider?: string
          p_provider_ref: string
          p_reference: string
        }
        Returns: string
      }
      confirm_payout: {
        Args: {
          p_provider?: string
          p_provider_ref: string
          p_reference: string
        }
        Returns: string
      }
      create_brand: {
        Args: { brand_name: string }
        Returns: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "brands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      creator_balances: {
        Args: never
        Returns: {
          in_flight: number
          payable: number
          pending: number
        }[]
      }
      creator_statement: {
        Args: { p_limit?: number }
        Returns: {
          account: string
          amount: number
          balance_after: number
          campaign_id: string
          entry_id: number
          kind: string
          occurred_at: string
          reference: string
        }[]
      }
      expire_stale_deposits: {
        Args: { p_older_than?: string }
        Returns: number
      }
      fail_brand_withdrawal: {
        Args: { p_reason?: string; p_reference: string }
        Returns: string
      }
      fail_deposit: {
        Args: { p_reason?: string; p_reference: string }
        Returns: string
      }
      fail_payout: {
        Args: { p_reason?: string; p_reference: string }
        Returns: string
      }
      flag_accrual: {
        Args: { p_accrual_id: string; p_reason: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_brand: { Args: never; Returns: boolean }
      is_brand_member: { Args: { target_brand_id: string }; Returns: boolean }
      is_creator: { Args: never; Returns: boolean }
      ledger_balance: { Args: { p_account_id: string }; Returns: number }
      ledger_ensure_account: {
        Args: {
          p_brand_id?: string
          p_campaign_id?: string
          p_creator_id?: string
          p_kind: string
        }
        Returns: string
      }
      ledger_integrity_report: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          ok: boolean
        }[]
      }
      ledger_post: {
        Args: {
          p_idempotency_key: string
          p_kind: string
          p_lines: Json
          p_memo?: string
        }
        Returns: string
      }
      list_brand_deposits: {
        Args: { p_brand_id: string; p_limit?: number }
        Returns: {
          amount: number
          confirmed_at: string
          created_at: string
          deposit_id: string
          reference: string
          status: string
        }[]
      }
      list_brand_withdrawals: {
        Args: { p_brand_id: string; p_limit?: number }
        Returns: {
          amount: number
          created_at: string
          destination: string
          reference: string
          settled_at: string
          status: string
          withdrawal_id: string
        }[]
      }
      list_campaign_accruals: {
        Args: { p_campaign_id: string }
        Returns: {
          accrual_id: string
          creator_id: string
          fee: number
          flag_reason: string
          gross: number
          net: number
          release_at: string
          status: string
          views: number
        }[]
      }
      list_my_earnings: {
        Args: never
        Returns: {
          accrual_id: string
          campaign_id: string
          fee: number
          gross: number
          net: number
          release_at: string
          status: string
          submission_id: string
          views: number
        }[]
      }
      list_my_payouts: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          created_at: string
          destination: string
          payout_id: string
          reference: string
          settled_at: string
          status: string
        }[]
      }
      publish_campaign: { Args: { p_campaign_id: string }; Returns: string }
      release_due_accruals: { Args: { p_limit?: number }; Returns: number }
      request_brand_withdrawal: {
        Args: { p_amount: number; p_brand_id: string; p_destination: string }
        Returns: {
          amount: number
          destination: string
          reference: string
          status: string
          withdrawal_id: string
        }[]
      }
      request_deposit: {
        Args: { p_amount: number; p_brand_id: string }
        Returns: {
          amount: number
          deposit_id: string
          reference: string
          status: string
        }[]
      }
      request_payout: {
        Args: { p_amount: number; p_destination: string }
        Returns: {
          amount: number
          destination: string
          payout_id: string
          reference: string
          status: string
        }[]
      }
      resolve_accrual_flag: {
        Args: { p_accrual_id: string; p_decision: string; p_note: string }
        Returns: string
      }
      shares_brand_with: { Args: { target_user_id: string }; Returns: boolean }
    }
    Enums: {
      application_status: "applied" | "approved" | "rejected" | "withdrawn"
      campaign_status: "draft" | "live" | "paused" | "completed" | "cancelled"
      checkpoint_status: "pending" | "verified" | "rejected"
      member_role: "owner" | "manager" | "viewer"
      social_platform:
        | "tiktok"
        | "instagram"
        | "youtube"
        | "x"
        | "facebook"
        | "other"
      submission_status: "awaiting" | "revision" | "approved" | "rejected"
      user_role: "admin" | "brand" | "creator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_status: ["applied", "approved", "rejected", "withdrawn"],
      campaign_status: ["draft", "live", "paused", "completed", "cancelled"],
      checkpoint_status: ["pending", "verified", "rejected"],
      member_role: ["owner", "manager", "viewer"],
      social_platform: [
        "tiktok",
        "instagram",
        "youtube",
        "x",
        "facebook",
        "other",
      ],
      submission_status: ["awaiting", "revision", "approved", "rejected"],
      user_role: ["admin", "brand", "creator"],
    },
  },
} as const
