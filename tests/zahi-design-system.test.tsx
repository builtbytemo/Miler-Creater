import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, buttonVariants } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { FormField, Input } from '../src/components/ui/Input';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { EmptyState } from '../src/components/ui/EmptyState';
import {
  ZahiCornerBracket,
  ZahiLogoMark,
  ZahiMascot,
  ZahiWordmark,
} from '../src/components/brand/ZahiBrand';
import {
  CommandPalette,
  COMMAND_PALETTE_ITEMS,
  filterCommandPaletteItems,
} from '../src/components/ui/CommandPalette';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

describe('Zahi Design System Phase 1 Foundations', () => {
  it('replaces legacy electric-lime accent with Pomegranate Red (#922f39), Warm Ivory (#f8f7f4), Near-Black (#191919), and White (#ffffff) tokens', () => {
    const cssPath = path.resolve(process.cwd(), 'src/app/globals.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('--accent: #922f39;');
    expect(css).toContain('--bg-canvas: #f8f7f4;');
    expect(css).toContain('--text-primary: #191919;');
    expect(css).toContain('--bg-surface: #ffffff;');
    expect(css).toContain('--bg-sidebar: #191919;');
    expect(css).toContain('--accent-text: #e4858e;');
    expect(css).toContain('--font-zahi-serif');

    // Old electric lime brand tokens must not remain
    expect(css.toLowerCase()).not.toContain('#e2f925');
    expect(css.toLowerCase()).not.toContain('#d6ee12');
    expect(css.toLowerCase()).not.toContain('#c5dc08');
    expect(css.toLowerCase()).not.toContain('#ebff46');
  });

  it('ships the canonical and transparent monochrome mascot assets on disk', () => {
    const publicDir = path.resolve(process.cwd(), 'public/brand');
    expect(fs.existsSync(path.join(publicDir, 'zahi-mascot-original.png'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(publicDir, 'zahi-mascot.png'))).toBe(true);
  });

  it('renders Zahi brand primitives and mascot variants accurately', () => {
    const markHtml = renderToStaticMarkup(<ZahiLogoMark size="md" />);
    expect(markHtml).toContain('>Z<');

    const wordmarkHtml = renderToStaticMarkup(<ZahiWordmark uppercase />);
    expect(wordmarkHtml).toContain('font-brand-serif');
    expect(wordmarkHtml).toContain('uppercase');
    expect(wordmarkHtml).toContain('Zahi');

    const bracketHtml = renderToStaticMarkup(
      <ZahiCornerBracket position="top-left" />
    );
    expect(bracketHtml).toContain('svg');

    const mascotBareHtml = renderToStaticMarkup(<ZahiMascot variant="bare" />);
    expect(mascotBareHtml).toContain('zahi-mascot.png');
    expect(mascotBareHtml).toContain('alt="Zahi mascot"');

    const mascotMedallionHtml = renderToStaticMarkup(
      <ZahiMascot variant="medallion" />
    );
    expect(mascotMedallionHtml).toContain('bg-[#F8F7F4]');
    expect(mascotMedallionHtml).toContain('zahi-mascot.png');
  });

  it('renders standardized Button, Badge, Input, SectionHeader, and EmptyState UI primitives', () => {
    expect(buttonVariants({ variant: 'primary', size: 'md' })).toContain(
      'btn-accent'
    );

    const uiHtml = renderToStaticMarkup(
      <div>
        <Button variant="primary">Save item</Button>
        <Badge tone="accent">Featured</Badge>
        <FormField htmlFor="title-input" label="Title" hint="Short label">
          <Input id="title-input" placeholder="Draft headline" />
        </FormField>
        <SectionHeader
          eyebrow="Queue"
          title="Priority items"
          count={4}
          accentMarker
        />
        <EmptyState
          showMascot
          title="Nothing pending"
          description="Everything scheduled is complete."
        />
      </div>
    );

    expect(uiHtml).toContain('Save item');
    expect(uiHtml).toContain('badge-accent');
    expect(uiHtml).toContain('Title');
    expect(uiHtml).toContain('input-control');
    expect(uiHtml).toContain('Priority items');
    expect(uiHtml).toContain('zahi-mascot.png');
  });

  it('provides filtered CommandPalette items across routes, settings, and theme actions', () => {
    expect(COMMAND_PALETTE_ITEMS.length).toBeGreaterThanOrEqual(8);

    const briefingMatches = filterCommandPaletteItems('briefing');
    expect(briefingMatches.some((item) => item.href === '/settings/notifications')).toBe(
      true
    );

    const darkMatches = filterCommandPaletteItems('obsidian');
    expect(darkMatches.some((item) => item.id === 'theme-dark')).toBe(true);

    const closedHtml = renderToStaticMarkup(
      <CommandPalette open={false} onOpenChange={() => {}} />
    );
    expect(closedHtml).toBe('');

    const openHtml = renderToStaticMarkup(
      <CommandPalette open={true} onOpenChange={() => {}} />
    );
    expect(openHtml).toContain('role="dialog"');
    expect(openHtml).toContain('Quick command palette');
    expect(openHtml).toContain('Daily Briefing &amp; Notification Settings');
  });
});
