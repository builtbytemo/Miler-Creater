import Image from 'next/image';
import { clsx } from 'clsx';

export function ZahiLogoMark({
  size = 'md',
  className,
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClass =
    size === 'xs'
      ? 'h-5 w-5 text-[10px] rounded-[5px]'
      : size === 'sm'
        ? 'h-6 w-6 text-[11px] rounded-[6px]'
        : size === 'lg'
          ? 'h-9 w-9 text-sm rounded-[8px]'
          : 'h-7 w-7 text-xs rounded-[6px]';

  const innerFrameClass =
    size === 'xs'
      ? 'inset-[3px] rounded-[1px]'
      : size === 'lg'
        ? 'inset-[5px] rounded-[1.5px]'
        : 'inset-[4px] rounded-[1px]';

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[var(--accent)] font-semibold tracking-tight text-[var(--accent-ink)] select-none',
        sizeClass,
        className
      )}
    >
      {/* Concentric dual-square Khatam / Rub el Hizb proportion behind monogram */}
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none absolute rotate-45 border border-[var(--accent-ink)]/28',
          innerFrameClass
        )}
      />
      <span className="relative z-10 leading-none">Z</span>
    </span>
  );
}

/**
 * Geometric mu'ayyan (45° diamond) motif derived from the embroidered hem
 * of Zahi's canonical mascot, used sparingly as an intentional focal marker.
 */
export function ZahiDiamondMark({
  size = 'xs',
  tone = 'accent',
  className,
}: {
  size?: 'xs' | 'sm' | 'md';
  tone?: 'accent' | 'muted' | 'ink';
  className?: string;
}) {
  const dimClass =
    size === 'md'
      ? 'h-1.5 w-1.5 rounded-[1px]'
      : size === 'sm'
        ? 'h-[5px] w-[5px] rounded-[0.5px]'
        : 'h-1 w-1 rounded-[0.5px]';

  const colorClass =
    tone === 'muted'
      ? 'bg-[var(--border-strong)]'
      : tone === 'ink'
        ? 'bg-[var(--text-primary)]'
        : 'bg-[var(--accent)]';

  return (
    <span
      aria-hidden="true"
      className={clsx('inline-block shrink-0 rotate-45', dimClass, colorClass, className)}
    />
  );
}

/**
 * Architectural hairline rule anchored by a centered mu'ayyan diamond node,
 * reserved for deliberate focal moments (auth masthead & mascot empty states).
 */
export function ZahiDividerRule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx('zahi-hairline-rule flex items-center gap-2', className)}
    >
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--border-strong)]" />
      <ZahiDiamondMark size="sm" tone="accent" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[var(--border-strong)]" />
    </div>
  );
}

export function ZahiWordmark({
  className,
  uppercase = false,
  showMark = true,
}: {
  className?: string;
  uppercase?: boolean;
  showMark?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-semibold tracking-[-0.025em] text-[var(--text-primary)]',
        uppercase && 'uppercase tracking-[0.06em]',
        className
      )}
    >
      <span>Zahi</span>
      {showMark && <ZahiDiamondMark size="xs" tone="accent" />}
    </span>
  );
}

/**
 * Canonical monochrome Zahi mascot — rendered unboxed and unframed,
 * adapting line ink cleanly to dark mode via invert while preserving silhouette.
 */
export function ZahiMascot({
  size = 44,
  className,
  imgClassName,
  alt = 'Zahi mascot',
  decorative = false,
}: {
  size?: number;
  className?: string;
  imgClassName?: string;
  alt?: string;
  decorative?: boolean;
}) {
  return (
    <span
      aria-hidden={decorative ? 'true' : undefined}
      className={clsx('inline-flex shrink-0 items-center justify-center', className)}
    >
      <Image
        src="/brand/zahi-mascot.png"
        alt={decorative ? '' : alt}
        width={1024}
        height={672}
        unoptimized
        style={{ width: `${size}px`, height: 'auto' }}
        className={clsx(
          'block h-auto object-contain select-none dark:invert',
          imgClassName
        )}
      />
    </span>
  );
}
