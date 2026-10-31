'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  ChevronLeft,
  Clock,
  Info,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import type { NotificationPreferencesWithDefaults } from '@/lib/services/notification-service';
import {
  getNotificationPreferencesAction,
  updateNotificationPreferencesAction,
} from '@/lib/actions/notification-actions';
import clsx from 'clsx';

export interface NotificationPreferencesFormProps {
  workspaceId: string;
  workspaceName?: string;
}

const PRESET_LEAD_TIMES = [
  { label: 'At event time (0 min)', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '10 minutes before', value: 10 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before (60 min)', value: 60 },
  { label: '2 hours before (120 min)', value: 120 },
  { label: '1 day before (1,440 min)', value: 1440 },
  { label: 'Custom minutes', value: -1 },
];

export function NotificationPreferencesForm({
  workspaceId,
  workspaceName,
}: NotificationPreferencesFormProps) {
  const [preferences, setPreferences] = useState<NotificationPreferencesWithDefaults | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form State
  const [inAppEnabled, setInAppEnabled] = useState<boolean>(true);
  const [notifyUpcomingTasks, setNotifyUpcomingTasks] = useState<boolean>(true);
  const [notifyOverdueTasks, setNotifyOverdueTasks] = useState<boolean>(true);
  const [notifyUpcomingContent, setNotifyUpcomingContent] = useState<boolean>(true);
  const [notifyStatusChanges, setNotifyStatusChanges] = useState<boolean>(true);
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number>(60);
  const [isCustomLeadTime, setIsCustomLeadTime] = useState<boolean>(false);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getNotificationPreferencesAction(workspaceId);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setPreferences(res.data);
        setInAppEnabled(res.data.in_app_notifications_enabled);
        setNotifyUpcomingTasks(res.data.notify_upcoming_tasks);
        setNotifyOverdueTasks(res.data.notify_overdue_tasks);
        setNotifyUpcomingContent(res.data.notify_upcoming_content);
        setNotifyStatusChanges(res.data.notify_status_changes);
        setLeadTimeMinutes(res.data.reminder_lead_minutes);

        const isStandard = PRESET_LEAD_TIMES.some(
          (p) => p.value === res.data!.reminder_lead_minutes
        );
        setIsCustomLeadTime(!isStandard);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleLeadTimePresetChange = (valStr: string) => {
    const val = parseInt(valStr, 10);
    if (val === -1) {
      setIsCustomLeadTime(true);
    } else {
      setIsCustomLeadTime(false);
      setLeadTimeMinutes(val);
    }
  };

  const handleCustomLeadTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    setLeadTimeMinutes(isNaN(parsed) ? 0 : parsed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    setError(null);
    setSuccessMessage(null);

    // Validate reminder lead time boundary [0, 10080]
    if (leadTimeMinutes < 0 || leadTimeMinutes > 10080) {
      setError('Reminder lead time must be between 0 and 10,080 minutes (max 7 days)');
      return;
    }

    setSaving(true);

    try {
      const res = await updateNotificationPreferencesAction(workspaceId, {
        in_app_notifications_enabled: inAppEnabled,
        notify_upcoming_tasks: notifyUpcomingTasks,
        notify_overdue_tasks: notifyOverdueTasks,
        notify_upcoming_content: notifyUpcomingContent,
        notify_status_changes: notifyStatusChanges,
        reminder_lead_minutes: leadTimeMinutes,
      });

      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setSuccessMessage('Notification preferences saved successfully.');
        setPreferences((prev) => (prev ? { ...prev, ...res.data } : null));

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cc:notifications-updated'));
        }

        setTimeout(() => {
          setSuccessMessage(null);
        }, 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while saving preferences');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-500 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="text-sm">Loading notification preferences...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="pb-4 border-b border-neutral-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/notifications"
            className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back to Notifications</span>
          </Link>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-neutral-950 border border-neutral-800 text-xs">
            <Link
              href="/settings/notifications"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-neutral-800 text-neutral-100 font-medium shadow-xs"
            >
              <Bell className="w-3.5 h-3.5 text-blue-400" />
              <span>Notifications</span>
            </Link>
            <Link
              href="/settings/tokens"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>AI &amp; API Tokens</span>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-100">
              Notification Preferences
            </h1>
            <p className="text-xs text-neutral-400">
              Configure how and when you receive in-app alerts
              {workspaceName ? ` in ${workspaceName}` : ''}.
            </p>
          </div>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in duration-200"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-200 text-xs flex items-center justify-between gap-2"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadPreferences}
            className="p-1 rounded hover:bg-rose-900/50 text-rose-100"
            title="Reload settings"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Section 1: Channel Delivery Toggles */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-400" />
            <span>Delivery Channels</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Choose where alerts should be dispatched.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4">
          {/* Master In-App Toggle */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <label
                htmlFor="toggle-in-app"
                className="text-xs font-semibold text-neutral-200 cursor-pointer"
              >
                In-App Notifications
              </label>
              <p className="text-[11px] text-neutral-400">
                Receive notifications in the Command Center bell badge and notification panel.
              </p>
            </div>
            <input
              id="toggle-in-app"
              type="checkbox"
              checked={inAppEnabled}
              onChange={(e) => setInAppEnabled(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-neutral-900 border-neutral-700 focus:ring-blue-500 mt-1 cursor-pointer"
            />
          </div>

          <div className="border-t border-neutral-850 pt-4">
            {/* Email Channel (Coming Soon) */}
            <div className="flex items-start justify-between gap-4 opacity-60">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="toggle-email"
                    className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Email Notifications</span>
                  </label>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                    Coming Soon
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Email notification delivery is currently in development and will be enabled in a
                  future milestone.
                </p>
              </div>
              <input
                id="toggle-email"
                type="checkbox"
                disabled
                checked={false}
                className="w-4 h-4 rounded text-neutral-600 bg-neutral-900 border-neutral-700 cursor-not-allowed mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Event Category Preferences */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Event Categories</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Select which events trigger notifications when actions occur.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4 divide-y divide-neutral-850">
          {/* Status changes toggle */}
          <div className="flex items-start justify-between gap-4 pt-1">
            <div className="space-y-0.5">
              <label
                htmlFor="toggle-status-changes"
                className="text-xs font-medium text-neutral-200 cursor-pointer"
              >
                Status Changes (Tasks & Content)
              </label>
              <p className="text-[11px] text-neutral-400">
                Notify when collaborators mark tasks as done, blocked, or cancelled, or archive content.
              </p>
            </div>
            <input
              id="toggle-status-changes"
              type="checkbox"
              disabled={!inAppEnabled}
              checked={notifyStatusChanges && inAppEnabled}
              onChange={(e) => setNotifyStatusChanges(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-neutral-900 border-neutral-700 focus:ring-blue-500 mt-0.5 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Upcoming tasks toggle */}
          <div className="flex items-start justify-between gap-4 pt-4">
            <div className="space-y-0.5">
              <label
                htmlFor="toggle-upcoming-tasks"
                className="text-xs font-medium text-neutral-200 cursor-pointer"
              >
                Upcoming Task Reminders
              </label>
              <p className="text-[11px] text-neutral-400">
                Receive reminders before scheduled tasks begin based on your lead time setting.
              </p>
            </div>
            <input
              id="toggle-upcoming-tasks"
              type="checkbox"
              disabled={!inAppEnabled}
              checked={notifyUpcomingTasks && inAppEnabled}
              onChange={(e) => setNotifyUpcomingTasks(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-neutral-900 border-neutral-700 focus:ring-blue-500 mt-0.5 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Overdue tasks toggle */}
          <div className="flex items-start justify-between gap-4 pt-4">
            <div className="space-y-0.5">
              <label
                htmlFor="toggle-overdue-tasks"
                className="text-xs font-medium text-neutral-200 cursor-pointer"
              >
                Overdue Task Alerts
              </label>
              <p className="text-[11px] text-neutral-400">
                Receive alerts when scheduled tasks or deadlines pass without completion.
              </p>
            </div>
            <input
              id="toggle-overdue-tasks"
              type="checkbox"
              disabled={!inAppEnabled}
              checked={notifyOverdueTasks && inAppEnabled}
              onChange={(e) => setNotifyOverdueTasks(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-neutral-900 border-neutral-700 focus:ring-blue-500 mt-0.5 cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Upcoming content toggle */}
          <div className="flex items-start justify-between gap-4 pt-4">
            <div className="space-y-0.5">
              <label
                htmlFor="toggle-upcoming-content"
                className="text-xs font-medium text-neutral-200 cursor-pointer"
              >
                Scheduled Content Alerts
              </label>
              <p className="text-[11px] text-neutral-400">
                Alert when social content is scheduled or due for publishing.
              </p>
            </div>
            <input
              id="toggle-upcoming-content"
              type="checkbox"
              disabled={!inAppEnabled}
              checked={notifyUpcomingContent && inAppEnabled}
              onChange={(e) => setNotifyUpcomingContent(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-neutral-900 border-neutral-700 focus:ring-blue-500 mt-0.5 cursor-pointer disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {/* Section 3: Reminder Lead Time */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Reminder Timing</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Configure how early scheduled task and content reminders are intended to occur.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="select-lead-time"
              className="text-xs font-medium text-neutral-300 block"
            >
              Default Lead Time
            </label>
            <select
              id="select-lead-time"
              value={isCustomLeadTime ? -1 : leadTimeMinutes}
              onChange={(e) => handleLeadTimePresetChange(e.target.value)}
              disabled={!inAppEnabled}
              className="w-full sm:w-80 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {PRESET_LEAD_TIMES.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Minute Input */}
          {isCustomLeadTime && (
            <div className="space-y-1.5 pt-2">
              <label
                htmlFor="input-custom-lead-time"
                className="text-xs font-medium text-neutral-300 block"
              >
                Custom Lead Time (Minutes, 0 to 10,080)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="input-custom-lead-time"
                  type="number"
                  min="0"
                  max="10080"
                  value={leadTimeMinutes}
                  onChange={handleCustomLeadTimeChange}
                  disabled={!inAppEnabled}
                  className="w-36 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <span className="text-xs text-neutral-400">minutes</span>
              </div>
            </div>
          )}

          {/* Architecture context callout */}
          <div className="p-3 rounded-lg bg-neutral-900/60 border border-neutral-800 text-[11px] text-neutral-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              This value defines how many minutes in advance upcoming reminders are generated.
              Automated background reminder processing is being configured for Phase 5, Step 5.
            </span>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
        <span className="text-[11px] text-neutral-500">
          Preferences apply across all devices within this workspace.
        </span>

        <button
          type="submit"
          disabled={saving || !inAppEnabled}
          className={clsx(
            'inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm',
            'bg-blue-600 hover:bg-blue-500 text-white',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Saving Changes...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Save Preferences</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
