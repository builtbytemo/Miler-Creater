'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Check,
  Clock,
  Info,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type { NotificationPreferencesWithDefaults } from '@/lib/services/notification-service';
import {
  getNotificationPreferencesAction,
  updateNotificationPreferencesAction,
} from '@/lib/actions/notification-actions';

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
}: NotificationPreferencesFormProps) {
  const [, setPreferences] = useState<NotificationPreferencesWithDefaults | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [inAppEnabled, setInAppEnabled] = useState<boolean>(true);
  const [notifyUpcomingTasks, setNotifyUpcomingTasks] = useState<boolean>(true);
  const [notifyOverdueTasks, setNotifyOverdueTasks] = useState<boolean>(true);
  const [notifyUpcomingContent, setNotifyUpcomingContent] = useState<boolean>(true);
  const [notifyStatusChanges, setNotifyStatusChanges] = useState<boolean>(true);
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number>(60);
  const [isCustomLeadTime, setIsCustomLeadTime] = useState<boolean>(false);

  const applyLoadedPreferences = useCallback((data: NotificationPreferencesWithDefaults) => {
    setPreferences(data);
    setInAppEnabled(data.in_app_notifications_enabled);
    setNotifyUpcomingTasks(data.notify_upcoming_tasks);
    setNotifyOverdueTasks(data.notify_overdue_tasks);
    setNotifyUpcomingContent(data.notify_upcoming_content);
    setNotifyStatusChanges(data.notify_status_changes);
    setLeadTimeMinutes(data.reminder_lead_minutes);

    const isStandard = PRESET_LEAD_TIMES.some(
      (p) => p.value === data.reminder_lead_minutes
    );
    setIsCustomLeadTime(!isStandard);
  }, []);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getNotificationPreferencesAction(workspaceId);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        applyLoadedPreferences(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [applyLoadedPreferences, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    getNotificationPreferencesAction(workspaceId)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
        } else if (res.data) {
          applyLoadedPreferences(res.data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load preferences');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyLoadedPreferences, workspaceId]);

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
      <div className="surface-card flex flex-col items-center justify-center py-16 text-[var(--text-muted)] gap-2.5">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
        <span className="text-xs font-medium">Loading notification preferences...</span>
      </div>
    );
  }

  const eventCategoryToggles = [
    {
      id: 'toggle-status-changes',
      label: 'Status Changes (Tasks & Content)',
      description:
        'Notify when collaborators mark tasks as done, blocked, or cancelled, or archive content.',
      checked: notifyStatusChanges && inAppEnabled,
      onChange: setNotifyStatusChanges,
    },
    {
      id: 'toggle-upcoming-tasks',
      label: 'Upcoming Task Reminders',
      description: 'Receive reminders before scheduled tasks begin based on your lead time setting.',
      checked: notifyUpcomingTasks && inAppEnabled,
      onChange: setNotifyUpcomingTasks,
    },
    {
      id: 'toggle-overdue-tasks',
      label: 'Overdue Task Alerts',
      description: 'Receive alerts when scheduled tasks or deadlines pass without completion.',
      checked: notifyOverdueTasks && inAppEnabled,
      onChange: setNotifyOverdueTasks,
    },
    {
      id: 'toggle-upcoming-content',
      label: 'Scheduled Content Alerts',
      description: 'Alert when social content is scheduled or due for publishing.',
      checked: notifyUpcomingContent && inAppEnabled,
      onChange: setNotifyUpcomingContent,
    },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {successMessage && (
        <div
          role="status"
          className="p-3.5 rounded-[var(--radius-sm)] border badge-success text-xs flex items-center gap-2.5"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-[var(--radius-sm)] border badge-danger text-xs flex items-center justify-between gap-2"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadPreferences}
            className="btn-secondary px-2.5 py-1 text-xs"
            title="Reload settings"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Section 1: Channel Delivery Toggles */}
      <section className="space-y-3">
        <div>
          <h2 className="heading-section text-sm sm:text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-[var(--accent)]" />
            <span>Delivery Channels</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Choose where real-time operational alerts are dispatched.
          </p>
        </div>

        <div className="surface-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <label
                htmlFor="toggle-in-app"
                className="text-xs font-semibold text-[var(--text-primary)] cursor-pointer block"
              >
                In-App Notifications
              </label>
              <p className="text-xs text-[var(--text-secondary)]">
                Receive notifications in the Zahi bell badge and notifications inbox.
              </p>
            </div>
            <input
              id="toggle-in-app"
              type="checkbox"
              checked={inAppEnabled}
              onChange={(e) => setInAppEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--accent)] mt-0.5 cursor-pointer shrink-0"
            />
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <div className="flex items-start justify-between gap-4 opacity-65">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    htmlFor="toggle-email"
                    className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>Instant Email Alerts</span>
                  </label>
                  <span className="badge badge-neutral text-[10px]">Scheduled</span>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Instant per-event email alerts are reserved for a future release; configure Daily
                  Briefing digests below for scheduled email delivery.
                </p>
              </div>
              <input
                id="toggle-email"
                type="checkbox"
                disabled
                checked={false}
                className="w-4 h-4 rounded cursor-not-allowed mt-0.5 shrink-0"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Event Category Preferences */}
      <section className="space-y-3">
        <div>
          <h2 className="heading-section text-sm sm:text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--status-success-text)]" />
            <span>Event Categories</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Select which workspace events generate notifications.
          </p>
        </div>

        <div className="surface-card divide-y divide-[var(--border-subtle)] px-5">
          {eventCategoryToggles.map((toggle) => (
            <div
              key={toggle.id}
              className="flex items-start justify-between gap-4 py-4 first:pt-4 last:pb-4"
            >
              <div className="space-y-0.5 min-w-0">
                <label
                  htmlFor={toggle.id}
                  className="text-xs font-semibold text-[var(--text-primary)] cursor-pointer block"
                >
                  {toggle.label}
                </label>
                <p className="text-xs text-[var(--text-secondary)]">{toggle.description}</p>
              </div>
              <input
                id={toggle.id}
                type="checkbox"
                disabled={!inAppEnabled}
                checked={toggle.checked}
                onChange={(e) => toggle.onChange(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--accent)] mt-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Reminder Lead Time */}
      <section className="space-y-3">
        <div>
          <h2 className="heading-section text-sm sm:text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--status-warning-text)]" />
            <span>Reminder Timing</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Configure how early upcoming task and content reminders fire.
          </p>
        </div>

        <div className="surface-card p-5 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="select-lead-time"
              className="text-xs font-medium text-[var(--text-secondary)] block"
            >
              Default Lead Time
            </label>
            <select
              id="select-lead-time"
              value={isCustomLeadTime ? -1 : leadTimeMinutes}
              onChange={(e) => handleLeadTimePresetChange(e.target.value)}
              disabled={!inAppEnabled}
              className="input-control w-full sm:w-80 py-1.5 px-3 min-h-9 text-xs leading-tight appearance-auto disabled:opacity-50"
            >
              {PRESET_LEAD_TIMES.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {isCustomLeadTime && (
            <div className="space-y-1.5 pt-1">
              <label
                htmlFor="input-custom-lead-time"
                className="text-xs font-medium text-[var(--text-secondary)] block"
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
                  className="input-control w-36 px-3 py-1.5 text-xs font-mono disabled:opacity-50"
                />
                <span className="text-xs text-[var(--text-muted)]">minutes</span>
              </div>
            </div>
          )}

          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface-muted)]/70 border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] flex items-start gap-2">
            <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <span>
              Lead time defines how far ahead automated reminder sweeps dispatch notifications before
              due times and scheduled publishing windows.
            </span>
          </div>
        </div>
      </section>

      {/* Save Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-xs text-[var(--text-muted)]">
          Preferences apply across all devices within this workspace.
        </span>

        <button
          type="submit"
          disabled={saving || !inAppEnabled}
          className="btn-accent px-5 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
