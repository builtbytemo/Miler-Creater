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

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-flex shrink-0 items-center justify-center bg-[var(--accent)] font-semibold tracking-tight text-[var(--accent-ink)] select-none',
        sizeClass,
        className
      )}
    >
      Z
    </span>
  );
}

export function ZahiWordmark({
  className,
  uppercase = false,
}: {
  className?: string;
  uppercase?: boolean;
}) {
  return (
    <span
      className={clsx(
        'font-semibold tracking-[-0.025em] text-[var(--text-primary)]',
        uppercase && 'uppercase tracking-[0.06em]',
        className
      )}
    >
      Zahi
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
