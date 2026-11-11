import type { BriefingSnapshot } from './model';
import { blockTimeLabel, isEmptyFor, timeLabel } from './labels';
import { formatLongDate, formatShortDate } from './time';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface Section {
  title: string;
  rows: Array<{ title: string; detail: string }>;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Palette: Architectural Atelier Planner (warm neutral canvas, clean white card, charcoal ink, precision accents)
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

/**
 * Production Daily Briefing email renderer: Architectural Atelier Planner.
 * Section order is strictly: 1. Tasks, 2. Content, 3. Day Finder.
 * Displays only titles and relevant times/deadlines; no descriptions or extra metadata.
 */
export function renderEmail(snap: BriefingSnapshot): RenderedEmail {
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

  const sectionRowsHtml = sections
    .map((s, idx) => {
      const numLabel = `0${idx + 1} / `;
      const itemsHtml = s.rows
        .map((r, i) => {
          const isLast = i === s.rows.length - 1;
          const border = isLast ? '' : `border-bottom:1px solid ${C.hairline};`;
          return `<tr><td style="padding:13px 0;${border}">
<div style="font-family:${FONT};font-size:15px;line-height:21px;color:${C.ink};font-weight:600;">${escapeHtml(r.title)}</div>
<div style="padding-top:4px;">
<span style="display:inline-block;background:${C.badgeBg};color:${C.badgeText};font-family:${FONT};font-size:12px;line-height:16px;font-weight:500;padding:2px 8px;border-radius:4px;letter-spacing:0.02em;">${escapeHtml(r.detail)}</span>
</div>
</td></tr>`;
        })
        .join('');

      return `<tr><td style="padding:28px 0 0 0;">
<div style="font-family:${FONT};font-size:11px;line-height:16px;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};font-weight:700;padding-bottom:6px;border-bottom:1px solid ${C.border};"><span style="color:${C.ink};">${numLabel}</span>${escapeHtml(s.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemsHtml}</table>
</td></tr>`;
    })
    .join('');

  const bodyContent = empty
    ? `<tr><td style="padding:32px 0 16px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.secondary};">${escapeHtml(emptyLine)}</td></tr>`
    : sectionRowsHtml;

  // Split date into Weekday and Month Day Year for architectural typography hierarchy
  const parts = longDate.split(',');
  const weekday = parts[0]?.trim() || longDate;
  const monthDayYear = parts.slice(1).join(',').trim();

  const html = `<!doctype html>
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
<span style="display:inline-block;background:${C.topBar};color:#ffffff;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.12em;padding:2px 7px;border-radius:3px;text-transform:uppercase;">MILER</span>
<div class="hero-day" style="padding-top:10px;font-family:${FONT};font-size:25px;line-height:29px;font-weight:700;color:${C.ink};letter-spacing:-0.02em;">${escapeHtml(weekday)}</div>
<div style="padding-top:2px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.secondary};font-weight:500;">${escapeHtml(monthDayYear || longDate)}</div>
</td></tr>
<tr><td style="padding-top:18px;border-bottom:1px solid ${C.border};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr>
${bodyContent}
<tr><td style="padding-top:36px;font-family:${FONT};font-size:11px;line-height:16px;color:${C.muted};text-align:center;">Miler Daily Planner</td></tr>
</table></td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
