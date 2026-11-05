import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchTool } from '../src/lib/mcp/dispatcher';
import { WORKSPACE_TOOLS } from '../src/lib/mcp/workspace-tools';
import type { AIExecutionContext } from '../src/lib/mcp/types';
import { getTaskById, deleteTask, addTaskDependency, createTask } from '../src/lib/services/task-service';
import { getNotifications, markNotificationAsRead, saveNotificationPreferences } from '../src/lib/services/notification-service';
vi.mock('../src/lib/services/task-service', () => ({ getTaskById: vi.fn(), deleteTask: vi.fn(), addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), completeTask: vi.fn() }));
vi.mock('../src/lib/services/notification-service', () => ({ getNotifications: vi.fn(), markNotificationAsRead: vi.fn(), markNotificationAsUnread: vi.fn(), markAllNotificationsAsRead: vi.fn(), dismissNotification: vi.fn(), getNotificationPreferences: vi.fn(), saveNotificationPreferences: vi.fn() }));
const taskId = '123e4567-e89b-12d3-a456-426614174000';
const otherId = '123e4567-e89b-12d3-a456-426614174001';
const context = { supabase: {}, workspaceId: 'trusted-workspace', userId: 'trusted-user', actorId: 'trusted-token', scopes: ['task:read', 'task:write', 'content:read', 'content:write'], timeZone: 'Africa/Cairo' } as AIExecutionContext;
beforeEach(() => vi.clearAllMocks());
describe('Claude workspace control', () => {
  it.each(Object.keys(WORKSPACE_TOOLS))('%s rejects callers without its required scopes', async (name) => {
    const result = await dispatchTool(name, {}, { ...context, scopes: [] });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FORBIDDEN');
  });
  it('preserves calendar placement and recurrence when Claude creates a subtask', async () => {
    const input = { title: 'Planning session', parent_task_id: taskId, created_from: 'calendar', scheduled_start: '2026-11-06T08:00:00Z', recurrence: { frequency: 'weekly', timezone: 'Africa/Cairo' } };
    const result = await dispatchTool('create_task', input, context);
    expect(result.success).toBe(true);
    expect(createTask).toHaveBeenCalledWith(context.supabase, context.workspaceId, expect.objectContaining({ parent_task_id: taskId, created_from: 'calendar', recurrence: expect.objectContaining({ frequency: 'weekly', timezone: 'Africa/Cairo' }) }), context.userId);
  });
  it('pins notifications to both the token workspace and the token owner', async () => {
    await dispatchTool('list_notifications', { unread_only: true }, context);
    expect(getNotifications).toHaveBeenCalledWith(context.supabase, context.workspaceId, context.userId, { unread_only: true, page: 1, limit: 20 });
    await dispatchTool('update_notification', { notification_id: taskId, action: 'read' }, context);
    expect(markNotificationAsRead).toHaveBeenCalledWith(context.supabase, context.workspaceId, context.userId, taskId);
  });
  it('rejects injected recipient/workspace identities', async () => {
    expect((await dispatchTool('list_notifications', { recipient_id: otherId }, context)).error?.code).toBe('INVALID_ARGUMENTS');
    expect(getNotifications).not.toHaveBeenCalled();
  });
  it('uses the validated domain dependency service', async () => {
    await dispatchTool('add_task_dependency', { task_id: taskId, depends_on_task_id: otherId }, context);
    expect(addTaskDependency).toHaveBeenCalledWith(context.supabase, context.workspaceId, taskId, otherId, 'finish_to_start');
  });
  it('never deletes an inaccessible task or a mismatched target', async () => {
    vi.mocked(getTaskById).mockResolvedValue(null);
    expect((await dispatchTool('delete_task', { task_id: taskId, confirm_title: 'Task' }, context)).error?.code).toBe('NOT_FOUND');
    vi.mocked(getTaskById).mockResolvedValue({ title: 'Different task' } as never);
    expect((await dispatchTool('delete_task', { task_id: taskId, confirm_title: 'Task' }, context)).success).toBe(false);
    expect(deleteTask).not.toHaveBeenCalled();
  });
  it('deletes only the verified target in the authorized workspace', async () => {
    vi.mocked(getTaskById).mockResolvedValue({ title: 'Requested task' } as never);
    const result = await dispatchTool('delete_task', { task_id: taskId, confirm_title: 'Requested task' }, context);
    expect(result.success).toBe(true);
    expect(deleteTask).toHaveBeenCalledWith(context.supabase, context.workspaceId, taskId);
  });
  it('bounds calendar reads and rejects reversed date windows', async () => {
    for (const end_date of ['2027-11-05T00:00:00Z', '2026-11-01T00:00:00Z']) {
      expect((await dispatchTool('get_calendar', { start_date: '2026-11-05T00:00:00Z', end_date }, context)).error?.code).toBe('INVALID_ARGUMENTS');
    }
  });
  it('updates only the authorized user reminder preferences', async () => {
    await dispatchTool('update_reminder_preferences', { reminder_lead_minutes: 15 }, context);
    expect(saveNotificationPreferences).toHaveBeenCalledWith(context.supabase, context.workspaceId, context.userId, { reminder_lead_minutes: 15 });
  });
});
