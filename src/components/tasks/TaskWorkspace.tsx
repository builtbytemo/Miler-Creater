'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  Calendar,
  Filter,
} from 'lucide-react';
import type { TaskWithMeta, TaskDetail } from '@/lib/services/task-service';
import { completeTaskAction } from '@/lib/actions/task-actions';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailModal } from './TaskDetailModal';

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface TaskWorkspaceProps {
  initialTasks: TaskWithMeta[];
  workspaceId: string;
  projects: ProjectOption[];
  userTimeZone: string;
}

export function TaskWorkspace({
  initialTasks,
  workspaceId,
  projects,
  userTimeZone,
}: TaskWorkspaceProps) {
  const [tasks, setTasks] = useState<TaskWithMeta[]>(initialTasks);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  // Filter tasks client-side for immediate responsive interactions
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // 1. Search filter
      if (search.trim() !== '') {
        const query = search.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesDesc = t.description?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc) return false;
      }

      // 2. Status filter
      if (statusFilter === 'active') {
        if (t.status === 'done' || t.status === 'cancelled') return false;
      } else if (statusFilter === 'blocked') {
        if (!t.is_blocked) return false;
      } else if (statusFilter !== 'all') {
        if (t.status !== statusFilter) return false;
      }

      // 3. Priority filter
      if (priorityFilter !== 'all') {
        if (t.priority !== priorityFilter) return false;
      }

      // 4. Project filter
      if (projectFilter !== 'all') {
        if (t.project_id !== projectFilter) return false;
      }

      return true;
    });
  }, [tasks, search, statusFilter, priorityFilter, projectFilter]);

  const handleQuickToggleDone = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setPendingTaskId(taskId);
      const res = await completeTaskAction(workspaceId, taskId);
      if (res.success && res.data) {
        const typedData = res.data as { completedTask: TaskWithMeta; nextOccurrence: TaskWithMeta | null };
        setTasks((prev) => {
          const next = prev.map((t) => (t.id === taskId ? typedData.completedTask : t));
          if (typedData.nextOccurrence) {
            next.unshift(typedData.nextOccurrence);
          }
          return next;
        });
      }
    } finally {
      setPendingTaskId(null);
    }
  };

  const handleOpenDetail = (task: TaskWithMeta) => {
    const detail: TaskDetail = {
      ...task,
      subtasks: tasks.filter((t) => t.parent_task_id === task.id),
      dependencies: [], // Will load detail or mock
    };
    setSelectedTaskDetail(detail);
  };

  return (
    <div className="space-y-6">
      {/* Action & Filter Toolbar */}
      <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by title or keyword..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* New Task Trigger Button */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Task</span>
          </button>
        </div>

        {/* Status Filter Tabs & Dropdowns */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-neutral-900">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {[
              { id: 'all', label: 'All Tasks' },
              { id: 'active', label: 'Active' },
              { id: 'todo', label: 'To Do' },
              { id: 'in_progress', label: 'In Progress' },
              { id: 'blocked', label: 'Blocked' },
              { id: 'done', label: 'Completed' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-neutral-800 text-neutral-100 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Filter className="w-3.5 h-3.5 text-neutral-500" />
            {/* Priority Selector */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-2.5 py-1 text-xs rounded-md border border-neutral-800 bg-neutral-900 text-neutral-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Project Selector */}
            {projects.length > 0 && (
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-md border border-neutral-800 bg-neutral-900 text-neutral-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Task List Container */}
      <div className="space-y-2">
        {filteredTasks.length === 0 ? (
          <div className="p-12 text-center rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-neutral-900 text-neutral-500 flex items-center justify-center mx-auto border border-neutral-800">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">No tasks found</h3>
              <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                {search || statusFilter !== 'all' || priorityFilter !== 'all'
                  ? 'No tasks matched your active filter criteria. Try adjusting your search query or filters.'
                  : 'Get started by creating your first task in this workspace.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Task</span>
            </button>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isCompleted = task.status === 'done';
            const isPending = pendingTaskId === task.id;

            return (
              <div
                key={task.id}
                onClick={() => handleOpenDetail(task)}
                className={`p-4 rounded-xl bg-neutral-950 border transition-all cursor-pointer flex items-start justify-between gap-4 group ${
                  task.is_blocked
                    ? 'border-red-900/50 hover:border-red-800'
                    : isCompleted
                    ? 'border-neutral-900 opacity-60 hover:opacity-100'
                    : 'border-neutral-800/80 hover:border-neutral-700'
                }`}
              >
                {/* Left: Checkbox + Title + Meta */}
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={(e) => handleQuickToggleDone(task.id, e)}
                    className="mt-0.5 text-neutral-500 hover:text-emerald-400 transition-colors shrink-0"
                    title={isCompleted ? 'Completed' : 'Click to complete'}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Circle className="w-4 h-4 text-neutral-500 hover:text-emerald-400" />
                    )}
                  </button>

                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-medium ${
                          isCompleted ? 'line-through text-neutral-500' : 'text-neutral-200'
                        }`}
                      >
                        {task.title}
                      </span>

                      {/* Blocked Badge */}
                      {task.is_blocked && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Blocked</span>
                        </span>
                      )}

                      {/* Recurring Badge */}
                      {task.recurrence_rule_id && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          <Clock className="w-2.5 h-2.5" />
                          <span>Recurring</span>
                        </span>
                      )}
                    </div>

                    {/* Metadata tags */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
                      {/* Priority Tag */}
                      <span
                        className={`capitalize font-medium ${
                          task.priority === 'urgent'
                            ? 'text-red-400'
                            : task.priority === 'high'
                            ? 'text-amber-400'
                            : task.priority === 'medium'
                            ? 'text-blue-400'
                            : 'text-neutral-400'
                        }`}
                      >
                        {task.priority}
                      </span>

                      {/* Project Tag */}
                      {task.project && (
                        <span className="flex items-center gap-1 text-neutral-400">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: task.project.color || '#3b82f6' }}
                          />
                          <span>{task.project.name}</span>
                        </span>
                      )}

                      {/* Due Date */}
                      {task.due_date && (
                        <span className="flex items-center gap-1 text-neutral-400">
                          <Calendar className="w-3 h-3" />
                          <span>
                            Due{' '}
                            {new Date(task.due_date).toLocaleDateString('en-US', {
                              timeZone: userTimeZone,
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </span>
                      )}

                      {/* Subtasks Count */}
                      {task.subtask_count > 0 && (
                        <span className="text-neutral-500 font-mono">
                          {task.completed_subtask_count}/{task.subtask_count} subtasks
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Status Pill */}
                <span className="px-2.5 py-1 rounded-md text-[11px] font-mono capitalize shrink-0 bg-neutral-900 border border-neutral-800 text-neutral-400">
                  {task.status.replace('_', ' ')}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Task Creation Modal */}
      {isCreateOpen && (
        <CreateTaskModal
          workspaceId={workspaceId}
          projects={projects}
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
        />
      )}

      {/* Task Detail Modal */}
      {selectedTaskDetail && (
        <TaskDetailModal
          task={selectedTaskDetail}
          allTasks={tasks}
          workspaceId={workspaceId}
          isOpen={Boolean(selectedTaskDetail)}
          onClose={() => setSelectedTaskDetail(null)}
          onTaskUpdated={() => {
            // Re-render handled by Server Actions revalidatePath
          }}
        />
      )}
    </div>
  );
}
