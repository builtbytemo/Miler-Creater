export interface TaskNode {
  id: string;
  workspaceId: string;
}

export interface TaskDependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
  workspaceId: string;
}

/**
 * Validates a proposed dependency between two tasks.
 * Detects:
 * 1. Self-dependencies (task A depending on task A)
 * 2. Cross-workspace boundaries (tasks in different workspaces)
 * 3. Circular dependency chains of arbitrary length (A -> B -> ... -> A)
 *
 * @param existingEdges Array of existing directed dependencies (taskId -> dependsOnTaskId)
 * @param newEdge The proposed dependency to add
 * @param taskMap Map of taskId to task metadata for workspace verification
 */
export function validateTaskDependency(
  existingEdges: TaskDependencyEdge[],
  newEdge: TaskDependencyEdge,
  taskMap: Map<string, TaskNode>
): { valid: boolean; error?: string } {
  const { taskId, dependsOnTaskId, workspaceId } = newEdge;

  // 1. Direct self-dependency
  if (taskId === dependsOnTaskId) {
    return { valid: false, error: 'A task cannot depend on itself.' };
  }

  // 2. Workspace boundary verification
  const sourceTask = taskMap.get(taskId);
  const targetTask = taskMap.get(dependsOnTaskId);

  if (!sourceTask || !targetTask) {
    return { valid: false, error: 'One or both referenced tasks do not exist.' };
  }

  if (sourceTask.workspaceId !== workspaceId || targetTask.workspaceId !== workspaceId) {
    return {
      valid: false,
      error: 'Tasks in a dependency relationship must belong to the same workspace as the dependency record.',
    };
  }

  // 3. Cycle Detection using Depth-First Search (DFS) / Reachability
  // If `dependsOnTaskId` can already reach `taskId` via existing edges,
  // then adding `taskId -> dependsOnTaskId` closes a cycle!
  //
  // Graph representation: Adjacency list of dependencies.
  // Edge: A -> B means task A depends on task B (B must complete before A).
  const adj = new Map<string, string[]>();
  for (const edge of existingEdges) {
    if (edge.workspaceId !== workspaceId) continue;
    if (!adj.has(edge.taskId)) {
      adj.set(edge.taskId, []);
    }
    adj.get(edge.taskId)!.push(edge.dependsOnTaskId);
  }

  // DFS to check if `taskId` is reachable starting from `dependsOnTaskId`
  const visited = new Set<string>();
  const queue = [dependsOnTaskId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === taskId) {
      return {
        valid: false,
        error: `Circular task dependency detected: task "${dependsOnTaskId}" already depends directly or indirectly on task "${taskId}".`,
      };
    }

    if (!visited.has(curr)) {
      visited.add(curr);
      const neighbors = adj.get(curr) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  return { valid: true };
}
