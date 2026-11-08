/**
 * Human-friendly terminal table and output formatter for the Miller Creator CLI.
 */

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now.getTime() + 86400000);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;

    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return isoStr;
  }
}

function truncate(str, maxLen = 50) {
  if (!str) return '—';
  const clean = String(str).replace(/\r?\n/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '…';
}

function padRight(str, len) {
  const s = String(str || '');
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

export function formatTable(headers, rows) {
  if (!rows || rows.length === 0) return '';
  const colWidths = headers.map((h, i) => {
    const maxRow = Math.max(...rows.map(r => String(r[i] || '').length));
    return Math.max(h.length, maxRow);
  });

  const headerLine = headers.map((h, i) => padRight(h, colWidths[i])).join('   ');
  const divider = colWidths.map(w => '─'.repeat(w)).join('───');
  const bodyLines = rows.map(row => {
    return row.map((cell, i) => padRight(cell, colWidths[i])).join('   ');
  });

  return [headerLine, divider, ...bodyLines].join('\n');
}

export function formatToolOutput(toolName, result, options = {}) {
  // If explicitly requested JSON or error
  if (options.json) {
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  // Extract payload from MCP result format
  let rawText = '';
  if (result && Array.isArray(result.content) && result.content[0]?.text) {
    rawText = result.content[0].text;
  } else if (typeof result === 'string') {
    rawText = result;
  } else {
    rawText = JSON.stringify(result);
  }

  // Attempt to parse JSON payload
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return rawText;
  }

  // 1. Task listing
  if (toolName === 'search_tasks' || toolName === 'list_overdue_tasks') {
    const list = Array.isArray(data) ? data : (data?.tasks || []);
    if (list.length === 0) return 'No tasks found.';
    const headers = ['STATUS', 'PRIORITY', 'DUE / SCHEDULE', 'TITLE', 'ID'];
    const rows = list.map(t => [
      t.status || 'todo',
      t.priority || 'medium',
      formatDate(t.due_date || t.scheduled_start),
      truncate(t.title, 42),
      (t.id || '').slice(0, 8),
    ]);
    return `Tasks (${list.length}):\n` + formatTable(headers, rows);
  }

  // 2. Task details
  if (toolName === 'get_task_details') {
    const t = data?.task || data;
    if (!t || !t.id) return JSON.stringify(data, null, 2);
    const lines = [
      `Task: ${t.title || 'Untitled'}`,
      `ID:          ${t.id}`,
      `Status:      ${t.status || 'todo'}`,
      `Priority:    ${t.priority || 'medium'}`,
      `Due Date:    ${formatDate(t.due_date)}`,
      `Schedule:    ${t.scheduled_start ? `${formatDate(t.scheduled_start)} (${t.estimated_duration_minutes || 60}m)` : 'Unscheduled'}`,
      `Project:     ${t.project?.name || 'No project'}`,
      t.description ? `Description: ${t.description}` : null,
      t.subtasks && t.subtasks.length > 0 ? `Subtasks (${t.subtasks.length}):\n` + t.subtasks.map(s => `  • [${s.status === 'done' ? 'x' : ' '}] ${s.title}`).join('\n') : null,
    ].filter(Boolean);
    return lines.join('\n');
  }

  // 3. Task mutations
  if (toolName === 'create_task') {
    const t = data?.task || data;
    return `✓ Task created: "${t.title || 'Untitled'}" (ID: ${t.id || ''})`;
  }
  if (toolName === 'update_task' || toolName === 'change_task_status') {
    const t = data?.task || data;
    return `✓ Task updated: "${t.title || 'Task'}" [${t.status || 'updated'}]`;
  }
  if (toolName === 'delete_task') {
    return '✓ Task deleted successfully.';
  }
  if (toolName === 'add_task_dependency') {
    return '✓ Task dependency added.';
  }
  if (toolName === 'remove_task_dependency') {
    return '✓ Task dependency removed.';
  }

  // 4. Content listing
  if (toolName === 'search_content' || toolName === 'list_scheduled_content') {
    const list = Array.isArray(data) ? data : (data?.items || []);
    if (list.length === 0) return 'No content items found.';
    const headers = ['PLATFORM', 'STATUS', 'SCHEDULED AT', 'TITLE / COPY', 'ID'];
    const rows = list.map(c => [
      c.platform || '—',
      c.status || 'draft',
      formatDate(c.scheduled_at),
      truncate(c.title || c.body, 42),
      (c.id || '').slice(0, 8),
    ]);
    return `Content Items (${list.length}):\n` + formatTable(headers, rows);
  }

  // 5. Content mutations
  if (toolName === 'create_content_item') {
    const c = data?.item || data;
    return `✓ Content created: "${truncate(c.title || c.body || 'Post', 30)}" [${c.platform || ''}]`;
  }
  if (toolName === 'update_content_item') {
    return '✓ Content item updated successfully.';
  }
  if (toolName === 'delete_content_item') {
    return '✓ Content item deleted successfully.';
  }

  // 6. Calendar listing
  if (toolName === 'get_calendar') {
    const list = Array.isArray(data) ? data : (data?.entries || data?.items || []);
    if (list.length === 0) return 'No calendar entries in this range.';
    const headers = ['DATE & TIME', 'TYPE', 'STATUS', 'TITLE'];
    const rows = list.map(e => [
      formatDate(e.start || e.scheduled_start || e.scheduled_at),
      e.type || (e.platform ? 'content' : 'task'),
      e.status || 'scheduled',
      truncate(e.title || e.body, 45),
    ]);
    return `Calendar Entries (${list.length}):\n` + formatTable(headers, rows);
  }
  if (toolName === 'create_calendar_entry') {
    const e = data?.entry || data;
    return `✓ Calendar block scheduled: "${e.title || 'Event'}" at ${formatDate(e.scheduled_start)}`;
  }

  // 7. Notifications
  if (toolName === 'list_notifications') {
    const list = Array.isArray(data) ? data : (data?.notifications || []);
    if (list.length === 0) return 'No notifications.';
    const headers = ['STATUS', 'TYPE', 'TIME', 'TITLE'];
    const rows = list.map(n => [
      n.read ? 'read' : 'unread',
      n.entity_type || 'system',
      formatDate(n.created_at),
      truncate(n.title, 45),
    ]);
    return `Notifications (${list.length}):\n` + formatTable(headers, rows);
  }
  if (toolName === 'update_notification' || toolName === 'mark_all_notifications_read') {
    return '✓ Notifications updated.';
  }

  // 8. Reminders
  if (toolName === 'get_reminder_preferences') {
    const p = data?.preferences || data;
    return [
      'Reminder Preferences:',
      `• Lead Time:       ${p.lead_time_minutes ?? 30} minutes before due`,
      `• In-App Alerts:   ${p.in_app_enabled ? 'Enabled' : 'Disabled'}`,
      `• Email Alerts:    ${p.email_enabled ? 'Enabled' : 'Disabled'}`,
    ].join('\n');
  }
  if (toolName === 'update_reminder_preferences') {
    return '✓ Reminder preferences updated successfully.';
  }

  // 9. Workspace summary
  if (toolName === 'get_workspace_summary') {
    const s = data?.summary || data;
    const lines = [
      `Workspace: ${s.workspace_name || 'My Workspace'}`,
      '─'.repeat(45),
      `• Tasks:         ${s.open_tasks_count ?? s.task_count ?? 0} active (${s.overdue_tasks_count ?? 0} overdue)`,
      `• Content:       ${s.draft_content_count ?? 0} drafts, ${s.scheduled_content_count ?? 0} scheduled`,
      `• Projects:      ${s.projects_count ?? 0} active`,
      `• Notifications: ${s.unread_notifications_count ?? 0} unread`,
    ];
    return lines.join('\n');
  }

  // 10. Projects & Accounts
  if (toolName === 'list_projects') {
    const list = Array.isArray(data) ? data : (data?.projects || []);
    if (list.length === 0) return 'No projects found.';
    const headers = ['NAME', 'ID'];
    const rows = list.map(p => [p.name, p.id]);
    return `Projects (${list.length}):\n` + formatTable(headers, rows);
  }

  if (toolName === 'list_social_accounts') {
    const list = Array.isArray(data) ? data : (data?.accounts || []);
    if (list.length === 0) return 'No social profiles found.';
    const headers = ['PLATFORM', 'HANDLE', 'NAME', 'ID'];
    const rows = list.map(a => [a.platform, a.account_handle, a.account_name || '—', a.id]);
    return `Social Accounts (${list.length}):\n` + formatTable(headers, rows);
  }
  if (toolName === 'create_social_account') {
    const a = data?.account || data;
    return `✓ Social planning profile added: ${a.platform} (${a.account_handle})`;
  }

  // Default: parsed JSON indented
  return JSON.stringify(data, null, 2);
}

export function formatToolsList(tools, options = {}) {
  if (options.json) {
    return JSON.stringify(tools, null, 2);
  }

  const lines = [
    `Available MCP Tools (${tools.length}):`,
    '',
  ];

  for (const t of tools) {
    lines.push(`  • ${padRight(t.name, 28)} ${truncate(t.description, 60)}`);
  }

  lines.push('');
  lines.push('Run `miler describe <tool_name>` to inspect inputs, or `miler --help` for commands.');
  return lines.join('\n');
}
