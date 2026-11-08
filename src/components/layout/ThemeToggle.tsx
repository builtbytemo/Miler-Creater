'use client';

import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useSyncExternalStore,
} from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { clsx } from 'clsx';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const THEME_EVENT = 'cc:theme-change';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getSavedThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'system';
}

export function getClientResolvedTheme(): ResolvedTheme {
  const pref = getSavedThemePreference();
  return pref === 'system' ? resolveSystemTheme() : pref;
}

function getServerThemePreference(): ThemePreference {
  return 'system';
}

function getServerResolvedTheme(): ResolvedTheme {
  return 'light';
}

export function applyThemeToDocument(preference: ThemePreference): ResolvedTheme {
  const resolved: ResolvedTheme =
    preference === 'system' ? resolveSystemTheme() : preference;

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', preference);
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

function subscribeToThemeStore(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const mediaQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  const handleEnvironmentUpdate = () => {
    applyThemeToDocument(getSavedThemePreference());
    onStoreChange();
  };

  const handleMediaChange = () => {
    if (getSavedThemePreference() === 'system') {
      handleEnvironmentUpdate();
    }
  };

  mediaQuery?.addEventListener('change', handleMediaChange);
  window.addEventListener('storage', handleEnvironmentUpdate);
  window.addEventListener(THEME_EVENT, handleEnvironmentUpdate);

  return () => {
    mediaQuery?.removeEventListener('change', handleMediaChange);
    window.removeEventListener('storage', handleEnvironmentUpdate);
    window.removeEventListener(THEME_EVENT, handleEnvironmentUpdate);
  };
}

export interface ThemeToggleProps {
  variant?: 'segmented' | 'compact';
  className?: string;
}

export function ThemeToggle({ variant = 'segmented', className }: ThemeToggleProps) {
  // Server render and initial client hydration both use the server snapshot ('system' / 'light')
  // so aria-pressed, aria-label, and classNames match on hydration, then sync immediately after.
  const preference = useSyncExternalStore(
    subscribeToThemeStore,
    getSavedThemePreference,
    getServerThemePreference
  );

  const resolvedTheme = useSyncExternalStore(
    subscribeToThemeStore,
    getClientResolvedTheme,
    getServerResolvedTheme
  );

  // Re-apply document attributes on mount, preference updates, and React StrictMode dev remount
  useIsomorphicLayoutEffect(() => {
    applyThemeToDocument(getSavedThemePreference());
  }, [preference, resolvedTheme]);

  const selectPreference = useCallback((nextPref: ThemePreference) => {
    try {
      if (nextPref === 'system') {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, nextPref);
      }
    } catch {
      // Ignore storage errors
    }
    applyThemeToDocument(nextPref);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(THEME_EVENT));
    }
  }, []);

  const toggleLightDark = useCallback(() => {
    const next: ThemePreference = resolvedTheme === 'dark' ? 'light' : 'dark';
    selectPreference(next);
  }, [resolvedTheme, selectPreference]);

  if (variant === 'compact') {
    const nextLabel =
      resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    return (
      <button
        type="button"
        onClick={toggleLightDark}
        aria-label={nextLabel}
        title={nextLabel}
        data-testid="theme-toggle-compact"
        className={clsx(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
          'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          'hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
          className
        )}
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    );
  }

  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'Auto', icon: Monitor },
  ];

  return (
    <div
      role="group"
      aria-label="Color theme"
      data-testid="theme-toggle-group"
      className={clsx(
        'grid w-full min-w-0 grid-cols-3 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-1',
        className
      )}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isSelected = preference === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => selectPreference(opt.value)}
            aria-pressed={isSelected}
            aria-label={`${opt.label} theme`}
            data-testid={`theme-option-${opt.value}`}
            className={clsx(
              'inline-flex min-h-7 min-w-0 items-center justify-center gap-1 rounded-full px-1.5 py-1 text-[11.5px] leading-none font-medium transition-all',
              isSelected
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs ring-1 ring-[var(--border-subtle)] font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
