import { describe, it, expect } from 'vitest';
import {
  validateTaskDependency,
  type TaskNode,
  type TaskDependencyEdge,
} from '../src/lib/tasks/dependencies';

describe('Task Dependency Multi-Step Cycle Detection & Workspace Isolation', () => {
  const ws1 = 'ws-1111-1111';
  const ws2 = 'ws-2222-2222';

  const taskMap = new Map<string, TaskNode>([
    ['A', { id: 'A', workspaceId: ws1 }],
    ['B', { id: 'B', workspaceId: ws1 }],
    ['C', { id: 'C', workspaceId: ws1 }],
    ['D', { id: 'D', workspaceId: ws1 }],
    ['E', { id: 'E', workspaceId: ws1 }],
    ['X_ws2', { id: 'X_ws2', workspaceId: ws2 }],
  ]);

  it('rejects self-dependencies (A -> A)', () => {
    const result = validateTaskDependency(
      [],
      { taskId: 'A', dependsOnTaskId: 'A', workspaceId: ws1 },
      taskMap
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/cannot depend on itself/);
  });

  it('rejects cross-workspace dependency attempts', () => {
    // Task A in Workspace 1 attempting to link with Task X in Workspace 2
    const result = validateTaskDependency(
      [],
      { taskId: 'A', dependsOnTaskId: 'X_ws2', workspaceId: ws1 },
      taskMap
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/same workspace/);
  });

  it('rejects non-existent task references', () => {
    const result = validateTaskDependency(
      [],
      { taskId: 'A', dependsOnTaskId: 'NON_EXISTENT', workspaceId: ws1 },
      taskMap
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/do not exist/);
  });

  it('allows valid initial directed dependency (A -> B)', () => {
    const result = validateTaskDependency(
      [],
      { taskId: 'A', dependsOnTaskId: 'B', workspaceId: ws1 },
      taskMap
    );
    expect(result.valid).toBe(true);
  });

  it('rejects 2-task circular dependency (A -> B, then B -> A)', () => {
    const existingEdges: TaskDependencyEdge[] = [
      { taskId: 'A', dependsOnTaskId: 'B', workspaceId: ws1 },
    ];

    // Attempt to add B -> A
    const result = validateTaskDependency(
      existingEdges,
      { taskId: 'B', dependsOnTaskId: 'A', workspaceId: ws1 },
      taskMap
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Circular task dependency detected/);
  });

  it('rejects 3-task circular chain (A -> B -> C, then C -> A)', () => {
    const existingEdges: TaskDependencyEdge[] = [
      { taskId: 'A', dependsOnTaskId: 'B', workspaceId: ws1 },
      { taskId: 'B', dependsOnTaskId: 'C', workspaceId: ws1 },
    ];

    // Attempt to add C -> A
    const result = validateTaskDependency(
      existingEdges,
      { taskId: 'C', dependsOnTaskId: 'A', workspaceId: ws1 },
      taskMap
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Circular task dependency detected/);
  });

  it('rejects deep N-step circular chains (A -> B -> C -> D -> E, then E -> A)', () => {
    const existingEdges: TaskDependencyEdge[] = [
      { taskId: 'A', dependsOnTaskId: 'B', workspaceId: ws1 },
      { taskId: 'B', dependsOnTaskId: 'C', workspaceId: ws1 },
      { taskId: 'C', dependsOnTaskId: 'D', workspaceId: ws1 },
      { taskId: 'D', dependsOnTaskId: 'E', workspaceId: ws1 },
    ];

    // Attempt to close cycle with E -> A
    const result = validateTaskDependency(
      existingEdges,
      { taskId: 'E', dependsOnTaskId: 'A', workspaceId: ws1 },
      taskMap
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Circular task dependency detected/);
  });

  it('permits valid Directed Acyclic Graph (DAG) structures like diamond dependencies', () => {
    // Diamond DAG:
    // D depends on B and C
    // B depends on A
    // C depends on A
    // (A must finish before B and C; B and C must finish before D)
    const existingEdges: TaskDependencyEdge[] = [
      { taskId: 'B', dependsOnTaskId: 'A', workspaceId: ws1 },
      { taskId: 'C', dependsOnTaskId: 'A', workspaceId: ws1 },
      { taskId: 'D', dependsOnTaskId: 'B', workspaceId: ws1 },
    ];

    // Adding D -> C is valid and does NOT create a cycle
    const result = validateTaskDependency(
      existingEdges,
      { taskId: 'D', dependsOnTaskId: 'C', workspaceId: ws1 },
      taskMap
    );

    expect(result.valid).toBe(true);
  });
});
