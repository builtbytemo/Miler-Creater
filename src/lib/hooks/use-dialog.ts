'use client';

import { useEffect, useRef } from 'react';

export function useDialog(isOpen: boolean, onClose: () => void, isPending = false) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const pendingRef = useRef(isPending);
  useEffect(() => { closeRef.current = onClose; pendingRef.current = isPending; }, [onClose, isPending]);
  useEffect(() => {
    if (!isOpen || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((el) => el.getClientRects().length > 0);
    (dialog.querySelector<HTMLElement>('input:not([type="hidden"]), textarea') || dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => { dialog.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [isOpen]);
  return ref;
}
