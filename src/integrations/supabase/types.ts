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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_bridge_credentials: {
        Row: {
          agent_slug: string
          created_at: string
          is_active: boolean
          secret_sha256: string
          updated_at: string
        }
        Insert: {
          agent_slug: string
          created_at?: string
          is_active?: boolean
          secret_sha256: string
          updated_at?: string
        }
        Update: {
          agent_slug?: string
          created_at?: string
          is_active?: boolean
          secret_sha256?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_bridge_credentials_agent_slug_fkey"
            columns: ["agent_slug"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["slug"]
          },
        ]
      }
      agent_capabilities: {
        Row: {
          agent_id: string
          created_at: string
          description: string
          enabled: boolean
          executions_count: number
          id: string
          name: string
          success_count: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          description?: string
          enabled?: boolean
          executions_count?: number
          id?: string
          name: string
          success_count?: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string
          enabled?: boolean
          executions_count?: number
          id?: string
          name?: string
          success_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_capabilities_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_commands: {
        Row: {
          acknowledged_at: string | null
          agent_id: string
          command: string
          completed_at: string | null
          created_at: string
          error: string
          id: string
          lease_expires_at: string | null
          note: string
          payload: Json
          requested_by: string | null
          result: Json
          started_at: string | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          agent_id: string
          command: string
          completed_at?: string | null
          created_at?: string
          error?: string
          id?: string
          lease_expires_at?: string | null
          note?: string
          payload?: Json
          requested_by?: string | null
          result?: Json
          started_at?: string | null
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          agent_id?: string
          command?: string
          completed_at?: string | null
          created_at?: string
          error?: string
          id?: string
          lease_expires_at?: string | null
          note?: string
          payload?: Json
          requested_by?: string | null
          result?: Json
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_commands_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_connections: {
        Row: {
          agent_id: string
          config: Json
          created_at: string
          health: string
          id: string
          kind: string
          last_checked_at: string | null
          name: string
          target: string
        }
        Insert: {
          agent_id: string
          config?: Json
          created_at?: string
          health?: string
          id?: string
          kind?: string
          last_checked_at?: string | null
          name: string
          target?: string
        }
        Update: {
          agent_id?: string
          config?: Json
          created_at?: string
          health?: string
          id?: string
          kind?: string
          last_checked_at?: string | null
          name?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_connections_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          agent_id: string
          created_at: string
          external_event_id: string | null
          id: string
          level: string
          message: string
          metadata: Json
        }
        Insert: {
          agent_id: string
          created_at?: string
          external_event_id?: string | null
          id?: string
          level?: string
          message: string
          metadata?: Json
        }
        Update: {
          agent_id?: string
          created_at?: string
          external_event_id?: string | null
          id?: string
          level?: string
          message?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_id: string
          capability_id: string | null
          command_id: string | null
          duration_ms: number | null
          external_run_id: string | null
          finished_at: string | null
          id: string
          metadata: Json
          session_id: string | null
          started_at: string
          status: string
          summary: string
          title: string
        }
        Insert: {
          agent_id: string
          capability_id?: string | null
          command_id?: string | null
          duration_ms?: number | null
          external_run_id?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          session_id?: string | null
          started_at?: string
          status?: string
          summary?: string
          title: string
        }
        Update: {
          agent_id?: string
          capability_id?: string | null
          command_id?: string | null
          duration_ms?: number | null
          external_run_id?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          session_id?: string | null
          started_at?: string
          status?: string
          summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "agent_capabilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "agent_commands"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          config: Json
          created_at: string
          description: string
          id: string
          kind: string
          last_heartbeat_at: string | null
          name: string
          slug: string
          status: string
          updated_at: string
          version: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string
          id?: string
          kind?: string
          last_heartbeat_at?: string | null
          name: string
          slug: string
          status?: string
          updated_at?: string
          version?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string
          id?: string
          kind?: string
          last_heartbeat_at?: string | null
          name?: string
          slug?: string
          status?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          actor_email: string
          created_at: string
          details: Json
          id: string
          target: string
        }
        Insert: {
          action: string
          actor?: string | null
          actor_email?: string
          created_at?: string
          details?: Json
          id?: string
          target?: string
        }
        Update: {
          action?: string
          actor?: string | null
          actor_email?: string
          created_at?: string
          details?: Json
          id?: string
          target?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_agent_commands: {
        Args: { _agent_id: string; _lease_seconds?: number; _limit?: number }
        Returns: {
          command: string
          created_at: string
          id: string
          note: string
          payload: Json
        }[]
      }
      enqueue_agent_command: {
        Args: {
          _agent_id: string
          _command: string
          _note?: string
          _payload?: Json
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
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
  public: {
    Enums: {
      app_role: ["admin", "operator", "viewer"],
    },
  },
} as const
