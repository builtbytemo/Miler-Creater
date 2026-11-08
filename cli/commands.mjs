// Friendly commands translate to the same authenticated MCP tools as `call`.
const definitions = {
  'tasks list': ['search_tasks', [], { search: 'search', status: 'status', priority: 'priority', limit: ['limit', 'number'] }],
  'tasks show': ['get_task_details', ['task_id'], {}],
  'tasks create': ['create_task', ['title'], { description: 'description', priority: 'priority', due: 'due_date', start: 'scheduled_start', end: 'scheduled_end', project: 'project_id' }],
  'tasks update': ['update_task', ['task_id'], { title: 'title', description: 'description', priority: 'priority', due: 'due_date', start: 'scheduled_start', end: 'scheduled_end', project: 'project_id' }],
  'tasks status': ['change_task_status', ['task_id', 'status'], {}],
  'tasks overdue': ['list_overdue_tasks', [], {}],
  'tasks depend': ['add_task_dependency', ['task_id', 'depends_on_task_id'], {}],
  'tasks undepend': ['remove_task_dependency', ['dependency_id'], {}],
  'tasks delete': ['delete_task', ['task_id'], { 'confirm-title': 'confirm_title' }],
  'content list': ['search_content', [], { search: 'search', status: 'status', platform: 'platform', limit: ['limit', 'number'] }],
  'content show': ['get_content_details', ['content_id'], {}],
  'content scheduled': ['list_scheduled_content', [], { from: 'start_date', to: 'end_date', limit: ['limit', 'number'] }],
  'content create': ['create_content_item', [], { platform: 'platform', title: 'title', body: 'body', status: 'status', at: 'scheduled_at', account: 'social_account_id' }],
  'content update': ['update_content_item', ['content_id'], { title: 'title', body: 'body', platform: 'platform', status: 'status', at: 'scheduled_at' }],
  'content delete': ['delete_content_item', ['content_id'], { 'confirm-delete': ['confirm_delete', 'boolean'] }],
  'calendar list': ['get_calendar', [], { from: 'start_date', to: 'end_date' }],
  'calendar create': ['create_calendar_entry', ['title'], { start: 'scheduled_start', end: 'scheduled_end', description: 'description' }],
  'notifications list': ['list_notifications', [], { limit: ['limit', 'number'], unread: ['unread_only', 'boolean'] }],
  'notifications read': ['update_notification', ['notification_id'], {} , { action: 'read' }],
  'notifications unread': ['update_notification', ['notification_id'], {}, { action: 'unread' }],
  'notifications dismiss': ['update_notification', ['notification_id'], {}, { action: 'dismiss' }],
  'notifications read-all': ['mark_all_notifications_read', [], {}],
  'reminders get': ['get_reminder_preferences', [], {}],
  'reminders update': ['update_reminder_preferences', [], { 'lead-time': ['lead_time_minutes', 'number'], email: ['email_enabled', 'boolean'], 'in-app': ['in_app_enabled', 'boolean'] }],
  'projects list': ['list_projects', [], {}],
  'accounts list': ['list_social_accounts', [], {}],
  'accounts create': ['create_social_account', [], { platform: 'platform', handle: 'account_handle', name: 'account_name' }],
  'workspace summary': ['get_workspace_summary', [], {}],
};

export function parseFriendlyCommand(argv) {
  const [group, action, ...tokens] = argv;
  if (!['tasks', 'content', 'calendar', 'notifications', 'projects', 'accounts', 'workspace', 'reminders'].includes(group)) return null;
  const definition = definitions[`${group} ${action}`];
  if (!definition) throw new Error(`Unknown ${group} command. Run --help for usage.`);
  const [name, positional, options, defaults = {}] = definition;
  const args = { ...defaults };
  let position = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const option = token.slice(2);
      if (!Object.hasOwn(options, option)) throw new Error(`Unknown option: ${token}`);
      const spec = options[option];
      const [key, type] = Array.isArray(spec) ? spec : [spec, 'string'];
      if (Object.hasOwn(args, key)) throw new Error(`Option repeated: ${token}`);
      if (type === 'boolean') args[key] = true;
      else {
        const value = tokens[++i];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
        if (type === 'number') {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${token} must be a whole number.`);
          args[key] = Number(value);
        } else args[key] = value;
      }
    } else {
      if (position >= positional.length) throw new Error(`Unexpected argument: ${token}`);
      args[positional[position++]] = token;
    }
  }
  if (position < positional.length) throw new Error(`Missing argument: ${positional[position]}`);
  if (group === 'tasks' && action === 'delete' && !args.confirm_title) throw new Error('Deleting a task requires --confirm-title with its exact title.');
  if (group === 'content' && action === 'delete' && !args.confirm_delete) throw new Error('Deleting content requires --confirm-delete.');
  if (group === 'calendar' && action === 'list' && (!args.start_date || !args.end_date)) throw new Error('Calendar list requires --from and --to.');
  if (group === 'calendar' && action === 'create' && !args.scheduled_start) throw new Error('Calendar create requires --start.');
  if (group === 'content' && action === 'create' && (!args.platform || (!args.title && !args.body))) throw new Error('Content create requires --platform and --title or --body.');
  if (group === 'accounts' && action === 'create' && (!args.platform || !args.account_handle)) throw new Error('Accounts create requires --platform and --handle.');
  if (group === 'content' && action === 'scheduled' && (!args.start_date || !args.end_date)) throw new Error('Content scheduled requires --from and --to.');
  return { name, arguments: args };
}
