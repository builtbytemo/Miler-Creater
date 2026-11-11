import type { BriefingSnapshot } from './model';
import { blockTimeLabel, isEmptyFor, timeLabel } from './labels';
import { formatLongDate, formatShortDate } from './time';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export type EmailConcept = 'journal' | 'planner';

export interface RenderEmailOptions {
  /**
   * Concept variant:
   * - 'journal' (Recommended): Editorial Morning Journal — refined serif date headline, warm cream paper, elegant vertical item flow.
   * - 'planner': Architectural Atelier Planner — precision desk stationery, clean weekday header, structured time badges.
   */
  concept?: EmailConcept;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface Section {
  title: string;
  indexLabel?: string;
  rows: Array<{ title: string; detail: string }>;
}

const FONT_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_SERIF = "'Charter','Bitstream Charter','Sitka Text','Cambria',Georgia,serif";

/* =========================================================================
   CONCEPT 1: The Editorial Morning Journal (Recommended)
   Aesthetic: Warm natural stationery, serene serif date, generous breathing room.
   ========================================================================= */
function renderJournalHtml(
  subject: string,
  longDate: string,
  sections: Section[],
  empty: boolean,
  emptyLine: string
): string {
  const C = {
    canvas: '#f6f4ef',
    page: '#ffffff',
    ink: '#1c1b18',
    secondary: '#6d6a62',
    muted: '#949187',
    border: '#ebe6dd',
    hairline: '#f2eee6',
    headerRule: '#eee9e0',
  };

  const sectionRows = sections
    .map((s) => {
      const itemsHtml = s.rows
        .map((r, i) => {
          const isLast = i === s.rows.length - 1;
          const border = isLast ? '' : `border-bottom:1px solid ${C.hairline};`;
          return `<tr><td style="padding:14px 0;${border}">
<div style="font-family:${FONT_SANS};font-size:15px;line-height:22px;color:${C.ink};font-weight:600;">${escapeHtml(r.title)}</div>
<div style="padding-top:3px;font-family:${FONT_SANS};font-size:13px;line-height:18px;color:${C.secondary};font-weight:400;">${escapeHtml(r.detail)}</div>
</td></tr>`;
        })
        .join('');

      return `<tr><td style="padding:32px 0 0 0;">
<div style="font-family:${FONT_SANS};font-size:11px;line-height:16px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};font-weight:700;padding-bottom:8px;border-bottom:1px solid ${C.headerRule};">${escapeHtml(s.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemsHtml}</table>
</td></tr>`;
    })
    .join('');

  const bodyContent = empty
    ? `<tr><td style="padding:36px 0 16px 0;font-family:${FONT_SANS};font-size:15px;line-height:24px;color:${C.secondary};">${escapeHtml(emptyLine)}</td></tr>`
    : sectionRows;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:480px){.page-card{padding:24px 20px!important}.hero-date{font-size:22px!important;line-height:28px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td class="page-card" style="background:${C.page};border:1px solid ${C.border};border-radius:8px;padding:40px 44px;box-shadow:0 1px 4px rgba(0,0,0,0.02);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-family:${FONT_SANS};font-size:11px;line-height:14px;letter-spacing:0.22em;text-transform:uppercase;color:${C.muted};font-weight:600;">M I L E R</td></tr>
<tr><td style="padding-top:14px;font-family:${FONT_SANS};font-size:11px;line-height:14px;letter-spacing:0.12em;text-transform:uppercase;color:${C.secondary};font-weight:600;">Daily Briefing</td></tr>
<tr><td class="hero-date" style="padding-top:6px;font-family:${FONT_SERIF};font-size:26px;line-height:32px;font-weight:400;color:${C.ink};letter-spacing:-0.01em;">${escapeHtml(longDate)}</td></tr>
<tr><td style="padding-top:18px;border-bottom:1px solid ${C.headerRule};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr>
${bodyContent}
<tr><td style="padding-top:40px;font-family:${FONT_SANS};font-size:11px;line-height:16px;color:${C.muted};text-align:center;">Miler Operational Workspace</td></tr>
</table></td></tr>
</table></td></tr></table></body></html>`;
}

/* =========================================================================
   CONCEPT 2: The Architectural Atelier Planner
   Aesthetic: Precision stationery, structured date block, understated time badges.
   ========================================================================= */
function renderPlannerHtml(
  subject: string,
  longDate: string,
  sections: Section[],
  empty: boolean,
  emptyLine: string
): string {
  const C = {
    canvas: '#f3f2ee',
    page: '#ffffff',
    ink: '#1e1d1a',
    secondary: '#5c5952',
    muted: '#807d74',
    border: '#dfdad0',
    hairline: '#ece7dd',
    badgeBg: '#f5f2eb',
    badgeText: '#4c4942',
    topBar: '#262420',
  };

  const sectionRows = sections
    .map((s, idx) => {
      const numLabel = `0${idx + 1} / `;
      const itemsHtml = s.rows
        .map((r, i) => {
          const isLast = i === s.rows.length - 1;
          const border = isLast ? '' : `border-bottom:1px solid ${C.hairline};`;
          return `<tr><td style="padding:13px 0;${border}">
<div style="font-family:${FONT_SANS};font-size:15px;line-height:21px;color:${C.ink};font-weight:600;">${escapeHtml(r.title)}</div>
<div style="padding-top:4px;">
<span style="display:inline-block;background:${C.badgeBg};color:${C.badgeText};font-family:${FONT_SANS};font-size:12px;line-height:16px;font-weight:500;padding:2px 8px;border-radius:4px;letter-spacing:0.02em;">${escapeHtml(r.detail)}</span>
</div>
</td></tr>`;
        })
        .join('');

      return `<tr><td style="padding:28px 0 0 0;">
<div style="font-family:${FONT_SANS};font-size:11px;line-height:16px;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};font-weight:700;padding-bottom:6px;border-bottom:1px solid ${C.border};"><span style="color:${C.ink};">${numLabel}</span>${escapeHtml(s.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemsHtml}</table>
</td></tr>`;
    })
    .join('');

  const bodyContent = empty
    ? `<tr><td style="padding:32px 0 16px 0;font-family:${FONT_SANS};font-size:15px;line-height:24px;color:${C.secondary};">${escapeHtml(emptyLine)}</td></tr>`
    : sectionRows;

  // Split date into Weekday and Month Day Year for architectural typography hierarchy
  const parts = longDate.split(',');
  const weekday = parts[0]?.trim() || longDate;
  const monthDayYear = parts.slice(1).join(',').trim();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:480px){.page-card{padding:24px 18px!important}.hero-day{font-size:22px!important;line-height:26px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="height:2px;background:${C.topBar};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="page-card" style="background:${C.page};border:1px solid ${C.border};border-top:0;padding:34px 38px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="vertical-align:top;">
<span style="display:inline-block;background:${C.topBar};color:#ffffff;font-family:${FONT_SANS};font-size:10px;font-weight:700;letter-spacing:0.12em;padding:2px 7px;border-radius:3px;text-transform:uppercase;">MILER</span>
<div class="hero-day" style="padding-top:10px;font-family:${FONT_SANS};font-size:25px;line-height:29px;font-weight:700;color:${C.ink};letter-spacing:-0.02em;">${escapeHtml(weekday)}</div>
<div style="padding-top:2px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${C.secondary};font-weight:500;">${escapeHtml(monthDayYear || longDate)}</div>
</td></tr>
<tr><td style="padding-top:18px;border-bottom:1px solid ${C.border};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr>
${bodyContent}
<tr><td style="padding-top:36px;font-family:${FONT_SANS};font-size:11px;line-height:16px;color:${C.muted};text-align:center;">Miler Daily Planner</td></tr>
</table></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Renders the approved Miler Daily Briefing email presentation.
 * Preserves the exact section order: Tasks -> Content -> Day Finder.
 * Defaults to Concept 1 ('journal', recommended), with Concept 2 ('planner') supported via options.
 */
export function renderEmail(snap: BriefingSnapshot, options: RenderEmailOptions = {}): RenderedEmail {
  const concept = options.concept ?? 'journal';
  const longDate = formatLongDate(snap.localDate);
  const subject = `Your Miler briefing · ${formatShortDate(snap.localDate)}`;

  const taskRows = snap.tasks.map((t) => ({ title: t.title, detail: timeLabel(t, snap) }));
  const contentRows = snap.content.map((c) => ({ title: c.title, detail: timeLabel(c, snap) }));
  const blockRows = snap.dayFinder.map((b) => ({ title: b.name, detail: blockTimeLabel(b, snap) }));

  const sections: Section[] = [
    { title: 'Tasks', rows: taskRows },
    { title: 'Content', rows: contentRows },
    { title: 'Day Finder', rows: blockRows },
  ].filter((s) => s.rows.length > 0);

  const empty = isEmptyFor('email', snap);
  const emptyLine = 'Nothing is scheduled for today. Enjoy the open day.';

  const text = [
    `Your Miler briefing`,
    longDate,
    '',
    ...(empty
      ? [emptyLine]
      : sections.flatMap((s) => [s.title.toUpperCase(), ...s.rows.map((r) => `${r.title} | ${r.detail}`), ''])),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');

  const html =
    concept === 'planner'
      ? renderPlannerHtml(subject, longDate, sections, empty, emptyLine)
      : renderJournalHtml(subject, longDate, sections, empty, emptyLine);

  return { subject, text, html };
}
