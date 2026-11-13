'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { AlertTriangle, CalendarClock, Loader2, Mail, Send, Unplug } from 'lucide-react';
import {
  disconnectTelegramAction,
  getDailyBriefingStateAction,
  sendTestBriefingMessageAction,
  startTelegramConnectionAction,
  updateDailyBriefingPreferencesAction,
  type DailyBriefingState,
} from '@/lib/actions/daily-briefing-actions';
import type { BriefingChannel } from '@/lib/briefing/types';

function Toggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5 min-w-0">
        <label
          htmlFor={id}
          className="text-xs font-semibold text-[var(--text-primary)] cursor-pointer block"
        >
          {label}
        </label>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{description}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded accent-[var(--accent)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      />
    </div>
  );
}

export function DailyBriefingSettings() {
  const [state, setState] = useState<DailyBriefingState | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const res = await getDailyBriefingStateAction();
    if (res.error) setMessage({ kind: 'error', text: res.error });
    else if (res.data) setState(res.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDailyBriefingStateAction().then((res) => {
      if (cancelled) return;
      if (res.error) setMessage({ kind: 'error', text: res.error });
      else if (res.data) setState(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = (fn: () => Promise<{ error?: string }>, okText?: string) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(
        res.error
          ? { kind: 'error', text: res.error }
          : okText
            ? { kind: 'ok', text: okText }
            : null
      );
      await load();
    });

  const update = (patch: Parameters<typeof updateDailyBriefingPreferencesAction>[0]) =>
    run(() => updateDailyBriefingPreferencesAction(patch), 'Daily Briefing preferences saved.');

  const test = (channel: BriefingChannel) =>
    run(() => sendTestBriefingMessageAction(channel), 'Test message sent.');

  const connect = () =>
    startTransition(async () => {
      const res = await startTelegramConnectionAction();
      if (res.error) setMessage({ kind: 'error', text: res.error });
      else setDeepLink(res.data?.deepLink ?? null);
    });

  if (!state) {
    return (
      <div className="surface-card p-6 flex items-center gap-2.5 text-xs text-[var(--text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
        <span>Loading Daily Briefing settings...</span>
      </div>
    );
  }

  const { service } = state;
  const generatorReady = service.contentConfigured;

  return (
    <section className="space-y-4" aria-labelledby="daily-briefing-heading">
      <div>
        <h2
          id="daily-briefing-heading"
          className="heading-section text-sm sm:text-base flex items-center gap-2"
        >
          <CalendarClock className="w-4 h-4 text-[var(--accent)]" />
          <span>Daily Briefing</span>
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
          Scheduled digest delivery to the channels you explicitly enable. Separate from reminder
          preferences above.
        </p>
      </div>

      {(!service.schedulerEnabled || !generatorReady) && (
        <div
          role="status"
          className="p-3.5 rounded-[var(--radius-sm)] border badge-warning text-xs flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            The delivery service is not yet active
            {!service.schedulerEnabled ? ' (scheduler disabled)' : ''}
            {!generatorReady ? ' (briefing content not available yet)' : ''}. Nothing will be sent
            automatically.
          </span>
        </div>
      )}

      {message && (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-[var(--radius-sm)] border text-xs ${
            message.kind === 'error' ? 'badge-danger' : 'badge-success'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="surface-card p-5 space-y-5">
        <div className="space-y-2">
          <Toggle
            id="toggle-briefing"
            label="Daily Briefing"
            description="Master switch. Off by default."
            checked={state.enabled}
            disabled={pending}
            onChange={(v) => update({ enabled: v })}
          />
          <p className="text-xs text-[var(--text-muted)]">
            Delivery time:{' '}
            <span className="font-mono font-medium text-[var(--text-primary)]">
              {state.deliveryLocalTime}
            </span>{' '}
            <span className="font-mono text-[11px]">({state.timezone})</span>
          </p>
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
          <Toggle
            id="toggle-briefing-email"
            label="Email"
            description={
              service.emailRecipientMismatch
                ? 'Your verified account email does not match the authorized recipient for this server.'
                : !service.emailConfigured
                  ? 'Email delivery is not configured on this server.'
                  : state.emailAddressVerified
                    ? 'Send to your verified account email. Enabling records your consent.'
                    : 'Your account email address must be verified first.'
            }
            checked={state.emailEnabled && service.emailConfigured}
            disabled={pending || !service.emailConfigured || !state.emailAddressVerified}
            onChange={(v) => update({ emailEnabled: v })}
          />
          <button
            type="button"
            disabled={pending || !service.emailConfigured || !state.emailAddressVerified}
            onClick={() => test('email')}
            className="btn-secondary px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            title={
              service.emailConfigured ? 'Send a test email' : 'Email delivery is not configured yet'
            }
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Send test email</span>
          </button>
          {service.emailRecipientMismatch ? (
            <p className="text-xs text-[var(--status-warning-text)]">
              Your verified account email does not match the authorized recipient for this server.
            </p>
          ) : (
            !service.emailConfigured && (
              <p className="text-xs text-[var(--text-muted)]">
                Email delivery is not configured on this server yet.
              </p>
            )
          )}
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
          <Toggle
            id="toggle-briefing-telegram"
            label="Telegram"
            description={
              state.telegram.status === 'active'
                ? `Connected${state.telegram.username ? ` as @${state.telegram.username}` : ''}.`
                : state.telegram.status === 'blocked'
                  ? 'The bot was blocked in this chat. Reconnect to resume.'
                  : 'Not connected.'
            }
            checked={state.telegramEnabled}
            disabled={pending || state.telegram.status !== 'active'}
            onChange={(v) => update({ telegramEnabled: v })}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !service.telegramConfigured}
              onClick={connect}
              className="btn-accent px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {state.telegram.status === 'not_connected'
                  ? 'Connect Telegram'
                  : 'Reconnect Telegram'}
              </span>
            </button>
            {state.telegram.status !== 'not_connected' && (
              <>
                <button
                  type="button"
                  disabled={pending || state.telegram.status !== 'active' || !service.telegramConfigured}
                  onClick={() => test('telegram')}
                  className="btn-secondary px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send test message</span>
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(disconnectTelegramAction, 'Telegram disconnected.')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border badge-danger text-xs font-medium transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              </>
            )}
          </div>
          {!service.telegramConfigured && (
            <p className="text-xs text-[var(--text-muted)]">
              Telegram is not configured on this server yet.
            </p>
          )}
          {deepLink && (
            <p className="text-xs text-[var(--text-secondary)]">
              Open{' '}
              <a
                href={deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent-text)] font-medium underline"
              >
                this link in Telegram
              </a>{' '}
              and press Start. It expires in 10 minutes and works once.{' '}
              <button
                type="button"
                onClick={load}
                className="text-[var(--accent-text)] font-medium underline"
              >
                Refresh status
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
