export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      hazard_checkin_tasks: {
        Row: {
          completed_at: string | null
          confirmation_at: string
          created_at: string
          id: string
          reminder_number: number
          report_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmation_at: string
          created_at?: string
          id?: string
          reminder_number: number
          report_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          confirmation_at?: string
          created_at?: string
          id?: string
          reminder_number?: number
          report_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hazard_checkin_tasks_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "crew_hazard_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_checkin_tasks_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "hazard_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      hazard_events: {
        Row: {
          action: Database["public"]["Enums"]["hazard_action"]
          created_at: string
          id: number
          observation_id: string
          report_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["hazard_action"]
          created_at?: string
          id?: never
          observation_id: string
          report_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["hazard_action"]
          created_at?: string
          id?: never
          observation_id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hazard_events_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: true
            referencedRelation: "crew_observation_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_events_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: true
            referencedRelation: "hazard_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_events_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "crew_hazard_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_events_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "hazard_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      hazard_observations: {
        Row: {
          action: Database["public"]["Enums"]["hazard_action"]
          actor_id: string | null
          created_at: string
          id: string
          location: unknown
          report_id: string
          request_id: string | null
          severity: number
        }
        Insert: {
          action: Database["public"]["Enums"]["hazard_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          location: unknown
          report_id: string
          request_id?: string | null
          severity: number
        }
        Update: {
          action?: Database["public"]["Enums"]["hazard_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          location?: unknown
          report_id?: string
          request_id?: string | null
          severity?: number
        }
        Relationships: [
          {
            foreignKeyName: "hazard_observations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "crew_hazard_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_observations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "hazard_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      hazard_photos: {
        Row: {
          content_type: string
          created_at: string
          id: string
          object_path: string
          observation_id: string | null
          owner_id: string
          site_id: string
        }
        Insert: {
          content_type: string
          created_at?: string
          id: string
          object_path: string
          observation_id?: string | null
          owner_id: string
          site_id: string
        }
        Update: {
          content_type?: string
          created_at?: string
          id?: string
          object_path?: string
          observation_id?: string | null
          owner_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hazard_photos_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "crew_observation_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_photos_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "hazard_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_photos_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      hazard_reports: {
        Row: {
          confirmations: number
          created_at: string
          id: string
          last_confirmed_at: string
          location: unknown
          reporter_id: string
          resolution_reason: string | null
          resolved_at: string | null
          severity: number
          site_id: string
          status: Database["public"]["Enums"]["hazard_status"]
          type: Database["public"]["Enums"]["hazard_type"]
        }
        Insert: {
          confirmations?: number
          created_at?: string
          id?: string
          last_confirmed_at?: string
          location: unknown
          reporter_id: string
          resolution_reason?: string | null
          resolved_at?: string | null
          severity: number
          site_id: string
          status?: Database["public"]["Enums"]["hazard_status"]
          type: Database["public"]["Enums"]["hazard_type"]
        }
        Update: {
          confirmations?: number
          created_at?: string
          id?: string
          last_confirmed_at?: string
          location?: unknown
          reporter_id?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          severity?: number
          site_id?: string
          status?: Database["public"]["Enums"]["hazard_status"]
          type?: Database["public"]["Enums"]["hazard_type"]
        }
        Relationships: [
          {
            foreignKeyName: "hazard_reports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_memberships: {
        Row: {
          role: string
          site_id: string
          user_id: string
        }
        Insert: {
          role?: string
          site_id: string
          user_id: string
        }
        Update: {
          role?: string
          site_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_memberships_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          id: string
          latitude: number
          location: unknown
          longitude: number
          name: string
          report_radius_m: number
        }
        Insert: {
          id?: string
          latitude: number
          location?: unknown
          longitude: number
          name: string
          report_radius_m?: number
        }
        Update: {
          id?: string
          latitude?: number
          location?: unknown
          longitude?: number
          name?: string
          report_radius_m?: number
        }
        Relationships: []
      }
    }
    Views: {
      crew_hazard_feed: {
        Row: {
          confirmations: number | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          last_confirmed_at: string | null
          latitude: number | null
          longitude: number | null
          reporter_id: string | null
          resolution_reason: string | null
          resolved_at: string | null
          severity: number | null
          site_id: string | null
          status: Database["public"]["Enums"]["hazard_status"] | null
          type: Database["public"]["Enums"]["hazard_type"] | null
        }
        Insert: {
          confirmations?: number | null
          created_at?: string | null
          id?: string | null
          is_active?: never
          last_confirmed_at?: string | null
          latitude?: never
          longitude?: never
          reporter_id?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          severity?: number | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["hazard_status"] | null
          type?: Database["public"]["Enums"]["hazard_type"] | null
        }
        Update: {
          confirmations?: number | null
          created_at?: string | null
          id?: string | null
          is_active?: never
          last_confirmed_at?: string | null
          latitude?: never
          longitude?: never
          reporter_id?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          severity?: number | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["hazard_status"] | null
          type?: Database["public"]["Enums"]["hazard_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "hazard_reports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_observation_feed: {
        Row: {
          action: Database["public"]["Enums"]["hazard_action"] | null
          actor_id: string | null
          created_at: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          report_id: string | null
          severity: number | null
          site_id: string | null
          type: Database["public"]["Enums"]["hazard_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "hazard_observations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "crew_hazard_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_observations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "hazard_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_reports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      checkin_hazard_report: {
        Args: {
          p_report_id: string
          p_request_id: string
          p_still_there: boolean
        }
        Returns: Json
      }
      get_site_crew_metrics: {
        Args: { p_site_id: string }
        Returns: {
          crew_risk_term: number
          open_report_count: number
          wildlife_subscore: number
        }[]
      }
      prune_hazard_photo_reservations: {
        Args: { p_photo_ids: string[] }
        Returns: number
      }
      reserve_hazard_photo: {
        Args: { p_content_type: string; p_photo_id: string; p_site_id: string }
        Returns: {
          content_type: string
          created_at: string
          id: string
          object_path: string
          observation_id: string | null
          owner_id: string
          site_id: string
        }
        SetofOptions: {
          from: "*"
          to: "hazard_photos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_hazard_maintenance: { Args: never; Returns: Json }
      submit_hazard_report: {
        Args: {
          p_lat: number
          p_lon: number
          p_photo_id?: string
          p_request_id: string
          p_severity: number
          p_site_id: string
          p_type: Database["public"]["Enums"]["hazard_type"]
        }
        Returns: Json
      }
    }
    Enums: {
      hazard_action: "submitted" | "confirmed" | "resolved" | "expired"
      hazard_status: "open" | "resolved"
      hazard_type: "debris" | "wildlife" | "downed_line" | "washout" | "other"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      hazard_action: ["submitted", "confirmed", "resolved", "expired"],
      hazard_status: ["open", "resolved"],
      hazard_type: ["debris", "wildlife", "downed_line", "washout", "other"],
    },
  },
} as const

