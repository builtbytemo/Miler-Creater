import Image from 'next/image';

const MASCOT_WIDTH = 1335;
const MASCOT_HEIGHT = 814;

type LogoSize = 'sm' | 'md' | 'lg';

const LOGO_SIZE_CLASSES: Record<LogoSize, string> = {
  sm: 'h-6 w-6 text-[13px]',
  md: 'h-7 w-7 text-[15px]',
  lg: 'h-9 w-9 text-lg',
};

/**
 * Geometric Zahi seal monogram combining a near-black/ivory field with a crisp
 * Pomegranate Red architectural notch in one corner.
 */
export function ZahiLogoMark({
  size = 'md',
  className = '',
}: {
  size?: LogoSize;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[6px] bg-[var(--accent)] text-[var(--accent-ink)] font-brand-serif font-semibold tracking-tight shadow-xs select-none ${LOGO_SIZE_CLASSES[size]} ${className}`}
      aria-hidden="true"
    >
      <span
        className="pointer-events-none absolute top-[2px] right-[2px] h-[5px] w-[5px] border-t border-r border-white/55"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute bottom-[2px] left-[2px] h-[5px] w-[5px] border-b border-l border-white/55"
        aria-hidden="true"
      />
      <span className="leading-none">Z</span>
    </span>
  );
}

/**
 * Editorial serif wordmark for the Zahi brand identity.
 */
export function ZahiWordmark({
  uppercase = false,
  className = '',
}: {
  uppercase?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`font-brand-serif font-semibold text-[var(--text-primary)] ${
        uppercase ? 'uppercase tracking-[0.16em]' : 'tracking-[-0.015em]'
      } ${className}`}
    >
      Zahi
    </span>
  );
}

type CornerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_TRANSFORM: Record<CornerPosition, string> = {
  'top-left': '',
  'top-right': 'scale(-1, 1)',
  'bottom-left': 'scale(1, -1)',
  'bottom-right': 'scale(-1, -1)',
};

/**
 * Restrained single-line interlocking architectural corner bracket inspired by
 * contemporary Arabian geometry. Used selectively on brand framing only.
 */
export function ZahiCornerBracket({
  position,
  className = '',
}: {
  position: CornerPosition;
  className?: string;
}) {
  const posClass =
    position === 'top-left'
      ? 'top-0 left-0'
      : position === 'top-right'
        ? 'top-0 right-0'
        : position === 'bottom-left'
          ? 'bottom-0 left-0'
          : 'bottom-0 right-0';

  return (
    <svg
      viewBox="0 0 88 88"
      fill="none"
      className={`pointer-events-none absolute w-14 h-14 sm:w-20 sm:h-20 text-[var(--accent-text)] opacity-45 ${posClass} ${className}`}
      style={
        CORNER_TRANSFORM[position]
          ? { transform: CORNER_TRANSFORM[position] }
          : undefined
      }
      aria-hidden="true"
    >
      <path
        d="M1 86V1H86M1 22H36V1M22 1V52H1M14 14H48V28H28V48H14V14Z"
        stroke="currentColor"
        strokeWidth="1.1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Renders the canonical monochrome Zahi mascot from public/brand/zahi-mascot.png
 * preserving original silhouette, expression, and proportions.
 */
export function ZahiMascot({
  variant = 'bare',
  className = '',
  imgClassName = 'w-28 h-auto',
  priority = false,
  alt = 'Zahi mascot',
}: {
  variant?: 'bare' | 'medallion';
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  alt?: string;
}) {
  if (variant === 'medallion') {
    return (
      <div
        className={`relative inline-flex items-center justify-center rounded-[var(--radius-lg)] bg-[#F8F7F4] border border-[var(--border-subtle)] px-4 py-3 shadow-[var(--shadow-card)] ${className}`}
      >
        <span
          className="pointer-events-none absolute top-1.5 left-1.5 h-2 w-2 border-t border-l border-[#922F39]/40"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r border-[#922F39]/40"
          aria-hidden="true"
        />
        <Image
          src="/brand/zahi-mascot.png"
          alt={alt}
          width={MASCOT_WIDTH}
          height={MASCOT_HEIGHT}
          priority={priority}
          className={`block select-none object-contain ${imgClassName}`}
        />
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <Image
        src="/brand/zahi-mascot.png"
        alt={alt}
        width={MASCOT_WIDTH}
        height={MASCOT_HEIGHT}
        priority={priority}
        className={`block select-none object-contain dark:drop-shadow-[0_0_2px_rgba(248,247,244,0.65)] ${imgClassName}`}
      />
    </span>
  );
}
