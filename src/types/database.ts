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
          read_at: string | null;
          idempotency_key: string | null;
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
          read_at?: string | null;
          idempotency_key?: string | null;
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
          read_at?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          notify_upcoming_tasks: boolean;
          notify_overdue_tasks: boolean;
          notify_upcoming_content: boolean;
          notify_status_changes: boolean;
          reminder_lead_minutes: number;
          email_notifications_enabled: boolean;
          in_app_notifications_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          notify_upcoming_tasks?: boolean;
          notify_overdue_tasks?: boolean;
          notify_upcoming_content?: boolean;
          notify_status_changes?: boolean;
          reminder_lead_minutes?: number;
          email_notifications_enabled?: boolean;
          in_app_notifications_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          notify_upcoming_tasks?: boolean;
          notify_overdue_tasks?: boolean;
          notify_upcoming_content?: boolean;
          notify_status_changes?: boolean;
          reminder_lead_minutes?: number;
          email_notifications_enabled?: boolean;
          in_app_notifications_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_api_tokens: {
        Row: {
          id: string;
          workspace_id: string;
          client_name: string;
          name: string | null;
          token_hash: string;
          token_prefix: string;
          scopes: string[];
          is_revoked: boolean;
          revoked_at: string | null;
          created_by: string;
          last_used_at: string | null;
          expires_at: string | null;
          resource?: string | null;
          oauth_client_id?: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          client_name: string;
          name?: string | null;
          token_hash: string;
          token_prefix: string;
          scopes: string[];
          is_revoked?: boolean;
          revoked_at?: string | null;
          created_by: string;
          last_used_at?: string | null;
          expires_at?: string | null;
          resource?: string | null;
          oauth_client_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          client_name?: string;
          name?: string | null;
          token_hash?: string;
          token_prefix?: string;
          scopes?: string[];
          is_revoked?: boolean;
          revoked_at?: string | null;
          created_by?: string;
          last_used_at?: string | null;
          expires_at?: string | null;
          resource?: string | null;
          oauth_client_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      oauth_clients: {
        Row: {
          id: string;
          client_id: string;
          client_name: string;
          redirect_uris: string[];
          grant_types: string[];
          response_types: string[];
          token_endpoint_auth_method: string;
          created_by_ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          client_name: string;
          redirect_uris: string[];
          grant_types?: string[];
          response_types?: string[];
          token_endpoint_auth_method?: string;
          created_by_ip?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          client_name?: string;
          redirect_uris?: string[];
          grant_types?: string[];
          response_types?: string[];
          token_endpoint_auth_method?: string;
          created_by_ip?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      oauth_authorization_codes: {
        Row: {
          id: string;
          code_hash: string;
          client_id: string;
          user_id: string;
          workspace_id: string;
          redirect_uri: string;
          scopes: string[];
          code_challenge: string;
          code_challenge_method: string;
          resource: string;
          consumed_at: string | null;
          grant_id: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          code_hash: string;
          client_id: string;
          user_id: string;
          workspace_id: string;
          redirect_uri: string;
          scopes: string[];
          code_challenge: string;
          code_challenge_method?: string;
          resource: string;
          consumed_at?: string | null;
          grant_id?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          code_hash?: string;
          client_id?: string;
          user_id?: string;
          workspace_id?: string;
          redirect_uri?: string;
          scopes?: string[];
          code_challenge?: string;
          code_challenge_method?: string;
          resource?: string;
          consumed_at?: string | null;
          grant_id?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      oauth_refresh_tokens: {
        Row: {
          id: string;
          token_hash: string;
          grant_id: string;
          access_token_id: string;
          client_id: string;
          user_id: string;
          workspace_id: string;
          scopes: string[];
          resource: string;
          consumed_at: string | null;
          replaced_by_hash: string | null;
          is_revoked: boolean;
          revoked_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          token_hash: string;
          grant_id?: string;
          access_token_id: string;
          client_id: string;
          user_id: string;
          workspace_id: string;
          scopes: string[];
          resource: string;
          consumed_at?: string | null;
          replaced_by_hash?: string | null;
          is_revoked?: boolean;
          revoked_at?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          token_hash?: string;
          grant_id?: string;
          access_token_id?: string;
          client_id?: string;
          user_id?: string;
          workspace_id?: string;
          scopes?: string[];
          resource?: string;
          consumed_at?: string | null;
          replaced_by_hash?: string | null;
          is_revoked?: boolean;
          revoked_at?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_token_rate_limits: {
        Row: {
          token_id: string;
          window_start: string;
          request_count: number;
          updated_at: string;
        };
        Insert: {
          token_id: string;
          window_start?: string;
          request_count?: number;
          updated_at?: string;
        };
        Update: {
          token_id?: string;
          window_start?: string;
          request_count?: number;
          updated_at?: string;
        };
        Relationships: [];
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
          workspace_id: string | null;
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
          workspace_id?: string | null;
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
          workspace_id?: string | null;
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
      check_and_increment_ai_token_rate_limit: {
        Args: {
          p_token_id: string;
          p_window_seconds?: number;
          p_max_requests?: number;
          p_now?: string;
        };
        Returns: {
          allowed: boolean;
          remaining_requests: number;
          retry_after_seconds: number;
          current_count: number;
        }[];
      };
      exchange_oauth_authorization_code: {
        Args: {
          p_code_hash: string;
          p_client_id: string;
          p_redirect_uri: string;
          p_computed_code_challenge: string;
          p_expected_resource: string;
          p_requested_scopes?: string[] | null;
          p_new_access_token_hash: string;
          p_new_access_token_prefix: string;
          p_new_refresh_token_hash: string;
          p_token_name: string;
          p_access_expires_at: string;
          p_refresh_expires_at: string;
          p_now?: string;
        };
        Returns: {
          allowed: boolean;
          error_code: string | null;
          error_reason: string | null;
          access_token_id: string | null;
          workspace_id: string | null;
          user_id: string | null;
          granted_scopes: string[] | null;
          resource: string | null;
        }[];
      };
      rotate_oauth_refresh_token: {
        Args: {
          p_old_refresh_token_hash: string;
          p_client_id: string;
          p_expected_resource: string;
          p_requested_scopes?: string[] | null;
          p_new_access_token_hash: string;
          p_new_access_token_prefix: string;
          p_new_refresh_token_hash: string;
          p_token_name: string;
          p_access_expires_at: string;
          p_refresh_expires_at: string;
          p_now?: string;
        };
        Returns: {
          allowed: boolean;
          error_code: string | null;
          error_reason: string | null;
          new_access_token_id: string | null;
          old_access_token_id: string | null;
          workspace_id: string | null;
          user_id: string | null;
          granted_scopes: string[] | null;
          resource: string | null;
        }[];
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
