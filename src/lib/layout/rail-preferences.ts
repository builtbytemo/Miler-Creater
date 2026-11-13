'use client';

export const SIDEBAR_STORAGE_KEY = 'zahi:sidebar-collapsed';
const SIDEBAR_CHANGE_EVENT = 'zahi:sidebar-change';

export const AI_RAIL_STORAGE_KEY = 'zahi:ai-rail-open';
const AI_RAIL_CHANGE_EVENT = 'zahi:ai-rail-change';

export function getSavedSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent(SIDEBAR_CHANGE_EVENT));
    }
  } catch {
    // Ignore storage access errors
  }
}

export function toggleSidebarCollapsed(): boolean {
  const next = !getSavedSidebarCollapsed();
  setSidebarCollapsed(next);
  return next;
}

export function subscribeToSidebarStore(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handleStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SIDEBAR_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  };
}

export function getSavedAiRailOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AI_RAIL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAiRailOpen(open: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AI_RAIL_STORAGE_KEY, open ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent(AI_RAIL_CHANGE_EVENT));
    }
  } catch {
    // Ignore storage access errors
  }
}

export function toggleAiRailOpen(): boolean {
  const next = !getSavedAiRailOpen();
  setAiRailOpen(next);
  return next;
}

export function subscribeToAiRailStore(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handleStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === AI_RAIL_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(AI_RAIL_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(AI_RAIL_CHANGE_EVENT, onStoreChange);
  };
}
