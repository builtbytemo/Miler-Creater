-- ==============================================================================
-- Migration: 20261031000001_pin_trigger_functions_search_path.sql
-- Description: Pins search_path to empty string ('') for existing PostgreSQL
--              trigger functions, preventing search_path manipulation without
--              altering function bodies, security status, or execution privileges.
-- ==============================================================================

ALTER FUNCTION public.check_task_dependency_cycle() SET search_path = '';
ALTER FUNCTION public.handle_updated_at() SET search_path = '';
ALTER FUNCTION public.prevent_workspace_change() SET search_path = '';
ALTER FUNCTION public.protect_workspace_owner() SET search_path = '';
ALTER FUNCTION public.validate_content_workspace_relations() SET search_path = '';
ALTER FUNCTION public.validate_task_workspace_relations() SET search_path = '';
