'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'accent';
  isPending?: boolean;
}

/**
 * Non-native accessible confirmation dialog replacing blocking browser confirm prompts.
 */
export function ConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  isPending = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      maxWidth="sm"
      closeDisabled={isPending}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="btn-secondary h-8 px-3.5 text-xs disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={
              tone === 'danger'
                ? 'inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3.5 text-xs font-medium text-[var(--status-danger-text)] hover:brightness-95 transition-all disabled:opacity-50'
                : 'btn-accent h-8 px-3.5 text-xs disabled:opacity-50'
            }
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            <span>{confirmLabel}</span>
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            tone === 'danger'
              ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border badge-danger'
              : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border badge-accent'
          }
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </div>
        <p className="text-xs sm:text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
    </Modal>
  );
}
