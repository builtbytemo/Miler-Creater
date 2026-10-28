export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type SocialPlatform = 'linkedin' | 'reddit' | 'threads' | 'x';
export type SocialAccountStatus = 'draft' | 'connected' | 'disconnected';
export type ProjectStatus = 'active' | 'completed' | 'archived';
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type ContentActionType = 'post' | 'comment' | 'reply' | 'share' | 'repost' | 'reaction';
export type ContentStatus = 'idea' | 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'archived';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
export type NotificationChannel = 'in_app' | 'email';
export type NotificationStatus = 'pending' | 'delivered' | 'failed' | 'dismissed';
export type AIConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type AuditActorType = 'user' | 'ai_client' | 'system';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          owner_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          owner_id?: string;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          joined_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          joined_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          role?: WorkspaceRole;
          joined_at?: string;
        };        Relationships: [];
      };
      social_accounts: {
        Row: {
          id: string;
          workspace_id: string;
          platform: SocialPlatform;
          account_handle: string;
          account_name: string | null;
          avatar_url: string | null;
          status: SocialAccountStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          platform: SocialPlatform;
          account_handle: string;
          account_name?: string | null;
          avatar_url?: string | null;
          status?: SocialAccountStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          platform?: SocialPlatform;
          account_handle?: string;
          account_name?: string | null;
          avatar_url?: string | null;
          status?: SocialAccountStatus;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          color: string | null;
          status: ProjectStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          color?: string | null;
          status?: ProjectStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          description?: string | null;
          color?: string | null;
          status?: ProjectStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      milestones: {
        Row: {
          id: string;
          workspace_id: string;
          project_id: string | null;
          title: string;
          description: string | null;
          due_date: string | null;
          is_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          project_id?: string | null;
          title: string;
          description?: string | null;
          due_date?: string | null;
          is_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          project_id?: string | null;
          title?: string;
          description?: string | null;
          due_date?: string | null;
          is_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      recurrence_rules: {
        Row: {
          id: string;
          workspace_id: string;
          frequency: RecurrenceFrequency;
          interval: number;
          by_weekday: number[] | null;
          by_monthday: number[] | null;
          until_date: string | null;
          count: number | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          frequency: RecurrenceFrequency;
          interval?: number;
          by_weekday?: number[] | null;
          by_monthday?: number[] | null;
          until_date?: string | null;
          count?: number | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          frequency?: RecurrenceFrequency;
          interval?: number;
          by_weekday?: number[] | null;
          by_monthday?: number[] | null;
          until_date?: string | null;
          count?: number | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      content_items: {
        Row: {
          id: string;
          workspace_id: string;
          social_account_id: string | null;
          platform: SocialPlatform;
          action_type: ContentActionType;
          status: ContentStatus;
          title: string | null;
          body: string;
          scheduled_at: string | null;
          duration_minutes: number | null;
          media_urls: Json;
          external_links: Json;
          target_reference: Json | null;
          tags: string[];
          notes: string | null;
          project_id: string | null;
          milestone_id: string | null;
          recurrence_rule_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          social_account_id?: string | null;
          platform: SocialPlatform;
          action_type: ContentActionType;
          status?: ContentStatus;
          title?: string | null;
          body?: string;
          scheduled_at?: string | null;
          duration_minutes?: number | null;
          media_urls?: Json;
          external_links?: Json;
          target_reference?: Json | null;
          tags?: string[];
          notes?: string | null;
          project_id?: string | null;
          milestone_id?: string | null;
          recurrence_rule_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          social_account_id?: string | null;
          platform?: SocialPlatform;
          action_type?: ContentActionType;
          status?: ContentStatus;
          title?: string | null;
          body?: string;
          scheduled_at?: string | null;
          duration_minutes?: number | null;
          media_urls?: Json;
          external_links?: Json;
          target_reference?: Json | null;
          tags?: string[];
          notes?: string | null;
          project_id?: string | null;
          milestone_id?: string | null;
          recurrence_rule_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          parent_task_id: string | null;
          project_id: string | null;
          milestone_id: string | null;
          title: string;
          description: string | null;
          priority: TaskPriority;
          status: TaskStatus;
          scheduled_start: string | null;
          scheduled_end: string | null;
          due_date: string | null;
          estimated_duration_minutes: number | null;
          is_all_day: boolean;
          completed_at: string | null;
          tags: string[];
          recurrence_rule_id: string | null;
          created_by: string | null;
          assigned_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          parent_task_id?: string | null;
          project_id?: string | null;
          milestone_id?: string | null;
          title: string;
          description?: string | null;
          priority?: TaskPriority;
          status?: TaskStatus;
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          due_date?: string | null;
          estimated_duration_minutes?: number | null;
          is_all_day?: boolean;
          completed_at?: string | null;
          tags?: string[];
          recurrence_rule_id?: string | null;
          created_by?: string | null;
          assigned_to?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          parent_task_id?: string | null;
          project_id?: string | null;
          milestone_id?: string | null;
          title?: string;
          description?: string | null;
          priority?: TaskPriority;
          status?: TaskStatus;
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          due_date?: string | null;
          estimated_duration_minutes?: number | null;
          is_all_day?: boolean;
          completed_at?: string | null;
          tags?: string[];
          recurrence_rule_id?: string | null;
          created_by?: string | null;
          assigned_to?: string | null;
          created_at?: string;
          updated_at?: string;
        };        Relationships: [];
      };
      task_dependencies: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string;
          depends_on_task_id: string;
          dependency_type: DependencyType;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          task_id: string;
          depends_on_task_id: string;
          dependency_type?: DependencyType;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          task_id?: string;
          depends_on_task_id?: string;
          dependency_type?: DependencyType;
          created_at?: string;
        };        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          workspace_id: string;
          recipient_id: string;
          channel: NotificationChannel;
          title: string;
          message: string;
          entity_type: string | null;
          entity_id: string | null;
          scheduled_for: string;
          status: NotificationStatus;
          delivered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          recipient_id: string;
          channel: NotificationChannel;
          title: string;
          message: string;
          entity_type?: string | null;
          entity_id?: string | null;
          scheduled_for?: string;
          status?: NotificationStatus;
          delivered_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          recipient_id?: string;
          channel?: NotificationChannel;
          title?: string;
          message?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          scheduled_for?: string;
          status?: NotificationStatus;
          delivered_at?: string | null;
          created_at?: string;
        };        Relationships: [];
      };
      ai_api_tokens: {
        Row: {
          id: string;
          workspace_id: string;
          client_name: string;
          token_hash: string;
          token_prefix: string;
          scopes: string[];
          is_revoked: boolean;
          created_by: string;
          last_used_at: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          client_name: string;
          token_hash: string;
          token_prefix: string;
          scopes: string[];
          is_revoked?: boolean;
          created_by: string;
          last_used_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          client_name?: string;
          token_hash?: string;
          token_prefix?: string;
          scopes?: string[];
          is_revoked?: boolean;
          created_by?: string;
          last_used_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };        Relationships: [];
      };
      ai_confirmation_requests: {
        Row: {
          id: string;
          workspace_id: string;
          ai_token_id: string;
          operation: string;
          payload: Json;
          status: AIConfirmationStatus;
          requested_at: string;
          responded_at: string | null;
          responded_by: string | null;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          ai_token_id: string;
          operation: string;
          payload: Json;
          status?: AIConfirmationStatus;
          requested_at?: string;
          responded_at?: string | null;
          responded_by?: string | null;
          expires_at: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          ai_token_id?: string;
          operation?: string;
          payload?: Json;
          status?: AIConfirmationStatus;
          requested_at?: string;
          responded_at?: string | null;
          responded_by?: string | null;
          expires_at?: string;
        };        Relationships: [];
      };
      audit_events: {
        Row: {
          id: string;
          workspace_id: string;
          actor_type: AuditActorType;
          actor_id: string;
          event_type: string;
          entity_type: string;
          entity_id: string | null;
          details: Json;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          actor_type: AuditActorType;
          actor_id: string;
          event_type: string;
          entity_type: string;
          entity_id?: string | null;
          details?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          actor_type?: AuditActorType;
          actor_id?: string;
          event_type?: string;
          entity_type?: string;
          entity_id?: string | null;
          details?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_workspace_member: {
        Args: {
          lookup_workspace_id: string;
          required_role?: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      social_platform: SocialPlatform;
      content_action_type: ContentActionType;
      content_status: ContentStatus;
      task_priority: TaskPriority;
      task_status: TaskStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
