'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { AlertTriangle, CalendarClock, Loader2, Mail, Send, Unplug } from 'lucide-react';
import {
  disconnectTelegramAction,
  getDailyBriefingStateAction,
  sendTestBriefingMessageAction,
  startTelegramConnectionAction,
  updateDailyBriefingPreferencesAction,
  dispatchControlledStagingBriefingAction,
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
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-xs font-semibold text-neutral-200 cursor-pointer">
          {label}
        </label>
        <p className="text-xs text-neutral-400">{description}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-blue-500 disabled:opacity-40"
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = (fn: () => Promise<{ error?: string }>, okText?: string) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.error ? { kind: 'error', text: res.error } : okText ? { kind: 'ok', text: okText } : null);
      await load();
    });

  const update = (patch: Parameters<typeof updateDailyBriefingPreferencesAction>[0]) =>
    run(() => updateDailyBriefingPreferencesAction(patch), 'Daily Briefing preferences saved.');

  const test = (channel: BriefingChannel) =>
    run(() => sendTestBriefingMessageAction(channel), 'Test message sent.');

  const controlledSend = (channel: BriefingChannel) =>
    run(
      async () => {
        const res = await dispatchControlledStagingBriefingAction(channel);
        if (res.error && !res.data) return { error: res.error };
        if (res.data?.status === 'sent') return { error: undefined };
        return { error: res.error };
      },
      `Controlled ${channel === 'telegram' ? 'Telegram' : 'Email'} briefing sent successfully.`
    );

  const connect = () =>
    startTransition(async () => {
      const res = await startTelegramConnectionAction();
      if (res.error) setMessage({ kind: 'error', text: res.error });
      else setDeepLink(res.data?.deepLink ?? null);
    });

  if (!state) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-neutral-500">
        <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> Loading Daily Briefing settings...
      </div>
    );
  }

  const { service } = state;
  const generatorReady = service.contentConfigured;

  return (
    <section className="space-y-4 max-w-3xl" aria-labelledby="daily-briefing-heading">
      <div>
        <h2 id="daily-briefing-heading" className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-blue-400" />
          <span>Daily Briefing</span>
        </h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Scheduled delivery to the channels you explicitly enable. Separate from reminder preferences above.
        </p>
      </div>

      {!service.schedulerEnabled || !generatorReady ? (
        <div role="status" className="p-4 rounded-xl bg-amber-950/40 border border-amber-900/60 text-amber-200 text-xs flex gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            The delivery service is not yet active
            {!service.schedulerEnabled ? ' (scheduler disabled)' : ''}
            {!generatorReady ? ' (briefing content not available yet)' : ''}. Nothing will be sent automatically.
          </span>
        </div>
      ) : null}

      {message && (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={
            message.kind === 'error'
              ? 'p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-200 text-xs'
              : 'p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-xs'
          }
        >
          {message.text}
        </div>
      )}

      <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4">
        <Toggle
          id="toggle-briefing"
          label="Daily Briefing"
          description="Master switch. Off by default."
          checked={state.enabled}
          disabled={pending}
          onChange={(v) => update({ enabled: v })}
        />
        <p className="text-xs text-neutral-400">
          Delivery time: <span className="text-neutral-200">{state.deliveryLocalTime}</span> ({state.timezone})
        </p>

        <div className="border-t border-neutral-800 pt-4 space-y-3">
          <Toggle
            id="toggle-briefing-email"
            label="Email"
            description={
              state.emailAddressVerified
                ? 'Send to your verified account email. Enabling records your consent.'
                : 'Your account email address must be verified first.'
            }
            checked={state.emailEnabled}
            disabled={pending || !state.emailAddressVerified}
            onChange={(v) => update({ emailEnabled: v })}
          />
          <button
            type="button"
            disabled={pending || !service.emailConfigured || !state.emailAddressVerified}
            onClick={() => test('email')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            title={service.emailConfigured ? 'Send a test email' : 'Email delivery is not configured yet'}
          >
            <Mail className="w-3.5 h-3.5" /> Send test email
          </button>
          {!service.emailConfigured && <p className="text-xs text-neutral-500">Email delivery is not configured on this server yet.</p>}
        </div>

        <div className="border-t border-neutral-800 pt-4 space-y-3">
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" /> {state.telegram.status === 'not_connected' ? 'Connect Telegram' : 'Reconnect Telegram'}
            </button>
            {state.telegram.status !== 'not_connected' && (
              <>
                <button
                  type="button"
                  disabled={pending || state.telegram.status !== 'active' || !service.telegramConfigured}
                  onClick={() => test('telegram')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" /> Send test message
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(disconnectTelegramAction, 'Telegram disconnected.')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-900/60 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
                >
                  <Unplug className="w-3.5 h-3.5" /> Disconnect
                </button>
              </>
            )}
          </div>
          {!service.telegramConfigured && <p className="text-xs text-neutral-500">Telegram is not configured on this server yet.</p>}
          {deepLink && (
            <p className="text-xs text-neutral-300">
              Open{' '}
              <a href={deepLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                this link in Telegram
              </a>{' '}
              and press Start. It expires in 10 minutes and works once.{' '}
              <button type="button" onClick={load} className="text-blue-400 underline">
                Refresh status
              </button>
            </p>
          )}
        </div>
      </div>

      {state.controlledDispatch?.isAvailable && (
        <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/60 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-purple-200 flex items-center gap-2">
                <span>Staging Preview Controlled Delivery</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-purple-900/60 text-purple-300 font-mono">
                  Preview Only
                </span>
              </h3>
              <p className="text-xs text-purple-300/80 mt-0.5">
                Send exactly one real-data Daily Briefing for <strong>November 12, 2026</strong> (Africa/Cairo).
                Reuses the production briefing generator, channel adapters, and authentic delivery ledgers.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-neutral-300 bg-neutral-950/60 p-3 rounded-lg border border-neutral-800">
            <div>
              <p className="text-neutral-500 text-[11px]">Briefing Date</p>
              <p className="font-medium text-neutral-200">Thursday, November 12, 2026</p>
              <p className="text-neutral-500 text-[11px] mt-2">Telegram Destination</p>
              <p className="font-mono text-neutral-300">
                {state.controlledDispatch.telegramDestination ?? 'Not connected'}
              </p>
            </div>
            <div>
              <p className="text-neutral-500 text-[11px]">Timezone</p>
              <p className="font-medium text-neutral-200">Africa/Cairo</p>
              <p className="text-neutral-500 text-[11px] mt-2">Email Destination</p>
              <p className="font-mono text-neutral-300">
                {state.controlledDispatch.emailDestination ?? 'Not confirmed'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="space-y-1">
              <button
                type="button"
                disabled={
                  pending ||
                  !state.telegramEnabled ||
                  state.telegram.status !== 'active' ||
                  state.controlledDispatch.telegram.status === 'sent' ||
                  state.controlledDispatch.telegram.status === 'claimed'
                }
                onClick={() => controlledSend('telegram')}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-xs font-medium text-white transition-colors"
              >
                {state.controlledDispatch.telegram.status === 'sent' ? (
                  <>✓ Telegram briefing sent</>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" /> Send controlled Telegram briefing
                  </>
                )}
              </button>
              {state.controlledDispatch.telegram.status === 'sent' && (
                <p className="text-[11px] text-emerald-400">
                  Delivered · Message ID: {state.controlledDispatch.telegram.providerMessageId || 'Confirmed'}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <button
                type="button"
                disabled={
                  pending ||
                  !state.emailEnabled ||
                  state.controlledDispatch.email.status === 'sent' ||
                  state.controlledDispatch.email.status === 'claimed'
                }
                onClick={() => controlledSend('email')}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-xs font-medium text-white transition-colors"
              >
                {state.controlledDispatch.email.status === 'sent' ? (
                  <>✓ Email briefing sent</>
                ) : (
                  <>
                    <Mail className="w-3.5 h-3.5" /> Send controlled Email briefing
                  </>
                )}
              </button>
              {state.controlledDispatch.email.status === 'sent' && (
                <p className="text-[11px] text-emerald-400">
                  Delivered · Message ID: {state.controlledDispatch.email.providerMessageId || 'Confirmed'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
