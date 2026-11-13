import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { FormField, Input } from '../src/components/ui/Input';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { EmptyState } from '../src/components/ui/EmptyState';
import {
  ZahiLogoMark,
  ZahiMascot,
  ZahiWordmark,
} from '../src/components/brand/ZahiBrand';
import {
  COMMAND_PALETTE_ITEMS,
  filterCommandPaletteItems,
} from '../src/components/ui/CommandPalette';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

describe('Zahi Phase 1 Design System Foundation', () => {
  it('defines Pomegranate Red (#922F39), Warm Ivory (#F8F7F4), Near-Black (#191919), and crisp Geist typography in globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

    expect(css).toContain('#922F39');
    expect(css).toContain('#F8F7F4');
    expect(css).toContain('#191919');
    expect(css).toContain('#FFFFFF');
    expect(css).toContain('--font-geist-sans');
    expect(css).toContain('--font-geist-mono');
    expect(css).not.toContain('#e2f925');
    expect(css).not.toContain('--font-zahi-serif');
  });

  it('renders clean Zahi logo, unboxed monochrome mascot, and wordmark without ornamental corner SVGs', () => {
    const brandPath = join(process.cwd(), 'src/components/brand/ZahiBrand.tsx');
    const brandSource = readFileSync(brandPath, 'utf8');
    expect(brandSource).not.toContain('ZahiCornerBracket');
    expect(brandSource).not.toContain('medallion');

    const logoHtml = renderToStaticMarkup(<ZahiLogoMark size="md" />);
    expect(logoHtml).toContain('>Z<');
    expect(logoHtml).toContain('bg-[var(--accent)]');

    const wordmarkHtml = renderToStaticMarkup(<ZahiWordmark />);
    expect(wordmarkHtml).toContain('Zahi');

    const mascotHtml = renderToStaticMarkup(<ZahiMascot size={48} />);
    expect(mascotHtml).toContain('/brand/zahi-mascot.png');
    expect(mascotHtml).toContain('dark:invert');
    expect(mascotHtml).not.toContain('border-[var(--border-subtle)]');
  });

  it('renders standardized Button, Badge, Input, SectionHeader, and compact EmptyState primitives', () => {
    const html = renderToStaticMarkup(
      <div>
        <SectionHeader
          title="Priority Tasks"
          badge={<Badge tone="accent">Urgent</Badge>}
        />
        <FormField label="Workspace Name" htmlFor="ws-name">
          <Input id="ws-name" placeholder="Command Center" />
        </FormField>
        <Button variant="primary">Create Task</Button>
        <EmptyState
          title="No active work"
          description="Create a task or scheduled post."
          showMascot
        />
      </div>
    );

    expect(html).toContain('Priority Tasks');
    expect(html).toContain('Urgent');
    expect(html).toContain('Workspace Name');
    expect(html).toContain('Create Task');
    expect(html).toContain('No active work');
    expect(html).toContain('/brand/zahi-mascot.png');
  });

  it('provides searchable keyboard-first Command Palette destinations', () => {
    expect(COMMAND_PALETTE_ITEMS.length).toBeGreaterThanOrEqual(7);
    const tokensMatches = filterCommandPaletteItems('token');
    expect(tokensMatches.some((item) => item.href === '/settings/tokens')).toBe(true);

    const briefingMatches = filterCommandPaletteItems('briefing');
    expect(briefingMatches.some((item) => item.href === '/settings/notifications')).toBe(true);
  });
});
