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
      alert_acks: {
        Row: {
          acknowledged_at: string
          alert_id: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          alert_id: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          alert_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_acks_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          cleared_at: string | null
          created_at: string
          dedup_key: string
          id: string
          kind: string
          level: string
          payload: Json
          site_id: string
          status: string
          target_user_ids: string[] | null
        }
        Insert: {
          cleared_at?: string | null
          created_at?: string
          dedup_key: string
          id?: string
          kind: string
          level: string
          payload?: Json
          site_id: string
          status?: string
          target_user_ids?: string[] | null
        }
        Update: {
          cleared_at?: string | null
          created_at?: string
          dedup_key?: string
          id?: string
          kind?: string
          level?: string
          payload?: Json
          site_id?: string
          status?: string
          target_user_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_drafts: {
        Row: {
          content: Json
          for_date: string
          sent_at: string | null
          site_id: string
          source: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          for_date: string
          sent_at?: string | null
          site_id: string
          source?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          for_date?: string
          sent_at?: string | null
          site_id?: string
          source?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefing_drafts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "briefing_drafts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_reads: {
        Row: {
          briefing_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          briefing_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          briefing_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_reads_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "briefings"
            referencedColumns: ["id"]
          },
        ]
      }
      briefings: {
        Row: {
          content: Json
          for_date: string
          generated_at: string
          id: string
          site_id: string
        }
        Insert: {
          content: Json
          for_date: string
          generated_at?: string
          id?: string
          site_id: string
        }
        Update: {
          content?: Json
          for_date?: string
          generated_at?: string
          id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "briefings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_locations: {
        Row: {
          accuracy_m: number | null
          location: unknown
          site_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accuracy_m?: number | null
          location: unknown
          site_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accuracy_m?: number | null
          location?: unknown
          site_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_locations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "crew_locations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
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
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
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
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
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
      job_plans: {
        Row: {
          job: Json
          revision: number
          site_id: string
          updated_at: string
          updated_by: string | null
          work_date: string
        }
        Insert: {
          job: Json
          revision: number
          site_id: string
          updated_at?: string
          updated_by?: string | null
          work_date: string
        }
        Update: {
          job?: Json
          revision?: number
          site_id?: string
          updated_at?: string
          updated_by?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_plans_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "job_plans_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      lightning_state: {
        Row: {
          last_strike_at: string | null
          last_strike_distance_m: number | null
          site_id: string
          status: string
          updated_at: string
        }
        Insert: {
          last_strike_at?: string | null
          last_strike_distance_m?: number | null
          site_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          last_strike_at?: string | null
          last_strike_distance_m?: number | null
          site_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lightning_state_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "lightning_state_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      lightning_strikes: {
        Row: {
          id: number
          latitude: number
          location: unknown
          longitude: number
          source: string
          struck_at: string
        }
        Insert: {
          id?: never
          latitude: number
          location?: unknown
          longitude: number
          source?: string
          struck_at: string
        }
        Update: {
          id?: never
          latitude?: number
          location?: unknown
          longitude?: number
          source?: string
          struck_at?: string
        }
        Relationships: []
      }
      ml_scores: {
        Row: {
          computed_at: string
          horizon: string
          model_version: string
          score: number
          site_id: string
        }
        Insert: {
          computed_at?: string
          horizon: string
          model_version: string
          score: number
          site_id: string
        }
        Update: {
          computed_at?: string
          horizon?: string
          model_version?: string
          score?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_scores_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "ml_scores_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      push_outbox: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          dedup_key: string | null
          id: string
          kind: string
          result: Json | null
          sent_at: string | null
          site_id: string
          status: string
          target: Json
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          dedup_key?: string | null
          id?: string
          kind: string
          result?: Json | null
          sent_at?: string | null
          site_id: string
          status?: string
          target?: Json
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          dedup_key?: string | null
          id?: string
          kind?: string
          result?: Json | null
          sent_at?: string | null
          site_id?: string
          status?: string
          target?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_outbox_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "push_outbox_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          address: string
          channel: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          address: string
          channel: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          address?: string
          channel?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      readings: {
        Row: {
          forecast_for: string
          hazard: Database["public"]["Enums"]["hazard_kind"]
          id: number
          observed_at: string
          site_id: string
          source: string
          unit: string
          value: number
        }
        Insert: {
          forecast_for?: string
          hazard: Database["public"]["Enums"]["hazard_kind"]
          id?: never
          observed_at: string
          site_id: string
          source?: string
          unit: string
          value: number
        }
        Update: {
          forecast_for?: string
          hazard?: Database["public"]["Enums"]["hazard_kind"]
          id?: never
          observed_at?: string
          site_id?: string
          source?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "readings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "readings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_briefing_publications: {
        Row: {
          id: string
          needs_review: boolean
          published_at: string
          published_by: string
          revision_id: string
          site_id: string
          status: string
          valid_until: string
          work_date: string
          worker_payload: Json
        }
        Insert: {
          id?: string
          needs_review?: boolean
          published_at?: string
          published_by: string
          revision_id: string
          site_id: string
          status?: string
          valid_until: string
          work_date: string
          worker_payload: Json
        }
        Update: {
          id?: string
          needs_review?: boolean
          published_at?: string
          published_by?: string
          revision_id?: string
          site_id?: string
          status?: string
          valid_until?: string
          work_date?: string
          worker_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "safety_briefing_publications_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: true
            referencedRelation: "safety_briefing_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_briefing_publications_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "safety_briefing_publications_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_briefing_reads: {
        Row: {
          publication_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          publication_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          publication_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_briefing_reads_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "safety_briefing_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_briefing_revisions: {
        Row: {
          author_id: string | null
          content: Json
          created_at: string
          id: string
          provenance: string
          revision: number
          run_id: string
          site_id: string
          work_date: string
        }
        Insert: {
          author_id?: string | null
          content: Json
          created_at?: string
          id?: string
          provenance: string
          revision: number
          run_id: string
          site_id: string
          work_date: string
        }
        Update: {
          author_id?: string | null
          content?: Json
          created_at?: string
          id?: string
          provenance?: string
          revision?: number
          run_id?: string
          site_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_briefing_revisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "safety_briefing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_briefing_revisions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "safety_briefing_revisions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_briefing_runs: {
        Row: {
          attempt: number
          available_at: string
          created_at: string
          created_by: string | null
          diagnostics: Json
          error_category: string | null
          fingerprint: string
          finished_at: string | null
          id: string
          input_snapshot: Json
          lease_token: string | null
          leased_until: string | null
          site_id: string
          state: string
          work_date: string
        }
        Insert: {
          attempt?: number
          available_at?: string
          created_at?: string
          created_by?: string | null
          diagnostics?: Json
          error_category?: string | null
          fingerprint: string
          finished_at?: string | null
          id?: string
          input_snapshot: Json
          lease_token?: string | null
          leased_until?: string | null
          site_id: string
          state?: string
          work_date: string
        }
        Update: {
          attempt?: number
          available_at?: string
          created_at?: string
          created_by?: string | null
          diagnostics?: Json
          error_category?: string | null
          fingerprint?: string
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          lease_token?: string | null
          leased_until?: string | null
          site_id?: string
          state?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_briefing_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "safety_briefing_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_passages: {
        Row: {
          anchor: string
          conditions: string
          excerpt: string
          id: string
          instruction: string
          search_vector: unknown
          version_id: string
        }
        Insert: {
          anchor: string
          conditions: string
          excerpt: string
          id?: string
          instruction: string
          search_vector?: unknown
          version_id: string
        }
        Update: {
          anchor?: string
          conditions?: string
          excerpt?: string
          id?: string
          instruction?: string
          search_vector?: unknown
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_passages_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "safety_source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_run_evidence: {
        Row: {
          evidence: Json
          evidence_id: string
          run_id: string
        }
        Insert: {
          evidence: Json
          evidence_id: string
          run_id: string
        }
        Update: {
          evidence?: Json
          evidence_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_run_evidence_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "safety_briefing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_source_versions: {
        Row: {
          available: boolean
          conflicts: boolean
          content_hash: string
          document_text: string
          effective_on: string | null
          fetched_at: string
          fictional: boolean
          id: string
          jurisdiction: string
          last_checked_at: string
          review_notes: string | null
          reviewed_at: string | null
          source_id: string
          status: string
          superseded_on: string | null
          task_tags: string[]
        }
        Insert: {
          available?: boolean
          conflicts?: boolean
          content_hash: string
          document_text?: string
          effective_on?: string | null
          fetched_at?: string
          fictional?: boolean
          id?: string
          jurisdiction: string
          last_checked_at?: string
          review_notes?: string | null
          reviewed_at?: string | null
          source_id: string
          status?: string
          superseded_on?: string | null
          task_tags: string[]
        }
        Update: {
          available?: boolean
          conflicts?: boolean
          content_hash?: string
          document_text?: string
          effective_on?: string | null
          fetched_at?: string
          fictional?: boolean
          id?: string
          jurisdiction?: string
          last_checked_at?: string
          review_notes?: string | null
          reviewed_at?: string | null
          source_id?: string
          status?: string
          superseded_on?: string | null
          task_tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "safety_source_versions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "safety_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_sources: {
        Row: {
          audience: string
          canonical_url: string | null
          category: string
          id: string
          issuing_body: string
          site_id: string | null
          source_key: string
          title: string
        }
        Insert: {
          audience: string
          canonical_url?: string | null
          category: string
          id?: string
          issuing_body: string
          site_id?: string | null
          source_key: string
          title: string
        }
        Update: {
          audience?: string
          canonical_url?: string | null
          category?: string
          id?: string
          issuing_body?: string
          site_id?: string | null
          source_key?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_sources_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "safety_sources_site_id_fkey"
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
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "site_memberships_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_risk: {
        Row: {
          base: number
          computed_at: string
          crew_term: number
          horizon: string
          risk: number
          site_id: string
          top_driver: string | null
        }
        Insert: {
          base: number
          computed_at?: string
          crew_term: number
          horizon: string
          risk: number
          site_id: string
          top_driver?: string | null
        }
        Update: {
          base?: number
          computed_at?: string
          crew_term?: number
          horizon?: string
          risk?: number
          site_id?: string
          top_driver?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_risk_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "site_risk_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_safety_profiles: {
        Row: {
          profile: Json
          revision: number
          site_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          profile: Json
          revision: number
          site_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          profile?: Json
          revision?: number
          site_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_safety_profiles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "site_safety_profiles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_subscores: {
        Row: {
          computed_at: string
          flood: number
          heat: number
          lightning: number
          site_id: string
          soil: number
          top_driver: string | null
          weather: number
          wildfire: number
          wildlife: number
        }
        Insert: {
          computed_at?: string
          flood?: number
          heat?: number
          lightning?: number
          site_id: string
          soil?: number
          top_driver?: string | null
          weather?: number
          wildfire?: number
          wildlife?: number
        }
        Update: {
          computed_at?: string
          flood?: number
          heat?: number
          lightning?: number
          site_id?: string
          soil?: number
          top_driver?: string | null
          weather?: number
          wildfire?: number
          wildlife?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_subscores_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "site_subscores_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          coast_distance_m: number | null
          eia_plant_id: string | null
          fema_flood_zone: string | null
          id: string
          latitude: number
          location: unknown
          longitude: number
          name: string
          plant_type: string | null
          report_radius_m: number
          river_distance_m: number | null
          timezone: string
          usgs_gauge_distance_m: number | null
          usgs_gauge_id: string | null
          utility: string | null
        }
        Insert: {
          coast_distance_m?: number | null
          eia_plant_id?: string | null
          fema_flood_zone?: string | null
          id?: string
          latitude: number
          location?: unknown
          longitude: number
          name: string
          plant_type?: string | null
          report_radius_m?: number
          river_distance_m?: number | null
          timezone?: string
          usgs_gauge_distance_m?: number | null
          usgs_gauge_id?: string | null
          utility?: string | null
        }
        Update: {
          coast_distance_m?: number | null
          eia_plant_id?: string | null
          fema_flood_zone?: string | null
          id?: string
          latitude?: number
          location?: unknown
          longitude?: number
          name?: string
          plant_type?: string | null
          report_radius_m?: number
          river_distance_m?: number | null
          timezone?: string
          usgs_gauge_distance_m?: number | null
          usgs_gauge_id?: string | null
          utility?: string | null
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
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
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
      crew_locations_live: {
        Row: {
          accuracy_m: number | null
          is_stale: boolean | null
          latitude: number | null
          longitude: number | null
          site_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          accuracy_m?: number | null
          is_stale?: never
          latitude?: never
          longitude?: never
          site_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          accuracy_m?: number | null
          is_stale?: never
          latitude?: never
          longitude?: never
          site_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_locations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "crew_locations_site_id_fkey"
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
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
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
      hazard_heatmap: {
        Row: {
          cell_lat: number | null
          cell_lon: number | null
          last_seen: string | null
          max_severity: number | null
          observation_count: number | null
          site_id: string | null
          type: Database["public"]["Enums"]["hazard_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "hazard_reports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site_overview"
            referencedColumns: ["site_id"]
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
      site_overview: {
        Row: {
          active_alert_count: number | null
          lat: number | null
          lightning: Json | null
          lon: number | null
          name: string | null
          risk_now: number | null
          risk_tomorrow: number | null
          site_id: string | null
          subscores: Json | null
          timezone: string | null
          top_driver: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ack_hazard_event: {
        Args: { p_consumer: string; p_event_id: number; p_lease_token: string }
        Returns: boolean
      }
      acknowledge_alert: {
        Args: { p_alert_id: string; p_request_id: string }
        Returns: Json
      }
      acknowledge_safety_publication: {
        Args: { p_publication_id: string }
        Returns: undefined
      }
      assign_site_member: {
        Args: { p_email: string; p_site_id: string }
        Returns: Json
      }
      bind_safety_hazards: {
        Args: { p_lease_token: string; p_run_id: string }
        Returns: Json
      }
      checkin_hazard_report: {
        Args: {
          p_report_id: string
          p_request_id: string
          p_still_there: boolean
        }
        Returns: Json
      }
      claim_hazard_events: {
        Args: { p_consumer: string; p_lease_seconds?: number; p_limit?: number }
        Returns: {
          action: Database["public"]["Enums"]["hazard_action"]
          created_at: string
          event_id: number
          lease_token: string
          observation_id: string
          report_id: string
        }[]
      }
      claim_push_outbox: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          created_at: string
          created_by: string | null
          dedup_key: string | null
          id: string
          kind: string
          result: Json | null
          sent_at: string | null
          site_id: string
          status: string
          target: Json
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "push_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_safety_runs: {
        Args: { p_limit?: number }
        Returns: {
          attempt: number
          available_at: string
          created_at: string
          created_by: string | null
          diagnostics: Json
          error_category: string | null
          fingerprint: string
          finished_at: string | null
          id: string
          input_snapshot: Json
          lease_token: string | null
          leased_until: string | null
          site_id: string
          state: string
          work_date: string
        }[]
        SetofOptions: {
          from: "*"
          to: "safety_briefing_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_supervisor_alert: { Args: { p_alert_id: string }; Returns: Json }
      compute_site_risk: {
        Args: {
          p_site_id: string
          p_tomorrow_driver?: string
          p_tomorrow_worst?: number
        }
        Returns: Json
      }
      delete_push_subscription: { Args: { p_id: string }; Returns: undefined }
      demo_generate_briefing: { Args: { p_site_id: string }; Returns: Json }
      demo_inject: {
        Args: { p_params?: Json; p_scenario: string; p_site_id: string }
        Returns: Json
      }
      demo_reset: { Args: { p_site_id: string }; Returns: Json }
      edit_safety_revision: {
        Args: {
          p_content: Json
          p_expected_revision: number
          p_revision_id: string
        }
        Returns: string
      }
      enqueue_due_safety_briefings: {
        Args: { p_now?: string }
        Returns: number
      }
      evaluate_all_sites: { Args: never; Returns: Json }
      evaluate_site: { Args: { p_site_id: string }; Returns: Json }
      finish_push: {
        Args: { p_id: string; p_result: Json; p_status: string }
        Returns: undefined
      }
      finish_safety_run: {
        Args: {
          p_content?: Json
          p_diagnostics?: Json
          p_error?: string
          p_lease_token: string
          p_run_id: string
        }
        Returns: boolean
      }
      generate_due_briefings: { Args: never; Returns: Json }
      get_briefing_inputs: { Args: { p_site_id: string }; Returns: Json }
      get_safety_workspace: {
        Args: { p_site_id: string; p_work_date: string }
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
      ingest_readings: { Args: { p_batch: Json }; Returns: Json }
      ingest_strikes: { Args: { p_batch: Json }; Returns: Json }
      list_site_crew: {
        Args: { p_site_id: string }
        Returns: {
          accuracy_m: number
          email: string
          has_push: boolean
          is_stale: boolean
          latitude: number
          located_at: string
          longitude: number
          name: string
          role: string
          user_id: string
        }[]
      }
      mark_briefing_read: { Args: { p_briefing_id: string }; Returns: Json }
      mark_safety_source_unavailable: {
        Args: { p_source_key: string }
        Returns: undefined
      }
      prune_hazard_photo_reservations: {
        Args: { p_photo_ids: string[] }
        Returns: number
      }
      prune_monitoring_data: { Args: never; Returns: Json }
      publish_safety_revision: {
        Args: { p_expected_revision: number; p_revision_id: string }
        Returns: string
      }
      push_audience: {
        Args: { p_site_id: string; p_target: Json }
        Returns: Json
      }
      push_recipients: {
        Args: { p_id: string }
        Returns: {
          address: string
          subscription_id: string
          user_id: string
        }[]
      }
      refresh_stale_safety_briefings: { Args: never; Returns: number }
      request_briefing_draft: { Args: { p_site_id: string }; Returns: Json }
      request_safety_briefing: {
        Args: { p_regenerate?: boolean; p_site_id: string; p_work_date: string }
        Returns: string
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
      retrieve_safety_evidence: {
        Args: {
          p_lease_token: string
          p_passage_id?: string
          p_query?: string
          p_run_id: string
          p_tool: string
        }
        Returns: Json
      }
      review_safety_source: {
        Args: {
          p_approve: boolean
          p_conflicts?: boolean
          p_notes: string
          p_version_id: string
        }
        Returns: undefined
      }
      run_hazard_maintenance: { Args: never; Returns: Json }
      save_briefing_draft: {
        Args: { p_content: Json; p_for_date: string; p_site_id: string }
        Returns: Json
      }
      save_safety_context: {
        Args: {
          p_job: Json
          p_job_revision: number
          p_profile: Json
          p_profile_revision: number
          p_site_id: string
          p_work_date: string
        }
        Returns: Json
      }
      send_briefing: {
        Args: { p_for_date: string; p_site_id: string }
        Returns: Json
      }
      send_push: {
        Args: {
          p_body: string
          p_site_id: string
          p_target: Json
          p_title: string
        }
        Returns: Json
      }
      stage_safety_source: {
        Args: {
          p_document: string
          p_hash: string
          p_passages: Json
          p_source: Json
        }
        Returns: string
      }
      store_briefing_draft: {
        Args: {
          p_content: Json
          p_for_date: string
          p_site_id: string
          p_source: string
        }
        Returns: undefined
      }
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
      sweep_lightning: { Args: never; Returns: Json }
      unassign_site_member: {
        Args: { p_site_id: string; p_user_id: string }
        Returns: Json
      }
      update_crew_location: {
        Args: {
          p_accuracy_m?: number
          p_lat: number
          p_lon: number
          p_site_id: string
        }
        Returns: Json
      }
      upsert_ml_scores: { Args: { p_batch: Json }; Returns: Json }
      withdraw_safety_publication: {
        Args: { p_publication_id: string }
        Returns: undefined
      }
    }
    Enums: {
      hazard_action: "submitted" | "confirmed" | "resolved" | "expired"
      hazard_kind:
        | "weather"
        | "lightning"
        | "flood"
        | "heat"
        | "wildfire"
        | "soil"
        | "wildlife"
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
      hazard_kind: [
        "weather",
        "lightning",
        "flood",
        "heat",
        "wildfire",
        "soil",
        "wildlife",
      ],
      hazard_status: ["open", "resolved"],
      hazard_type: ["debris", "wildlife", "downed_line", "washout", "other"],
    },
  },
} as const
