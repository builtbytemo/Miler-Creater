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

// Miler visual identity (see globals.css): warm canvas, white surface, ink text, electric-yellow accent.
const C = { canvas: '#faf8f5', surface: '#ffffff', ink: '#121210', secondary: '#575651', muted: '#76746e', border: '#e7e4dc', accent: '#e2f925' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

interface Row {
  title: string;
  detail: string;
}

function rowHtml(row: Row, last: boolean): string {
  const border = last ? '' : `border-bottom:1px solid ${C.border};`;
  return `<tr><td style="padding:12px 0;${border}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
<td class="stack" style="font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};font-weight:600;vertical-align:top;padding-right:12px;">${escapeHtml(row.title)}</td>
<td class="stack right" style="font-family:${FONT};font-size:14px;line-height:22px;color:${C.secondary};vertical-align:top;text-align:right;white-space:nowrap;">${escapeHtml(row.detail)}</td>
</tr></table></td></tr>`;
}

function sectionHtml(title: string, rows: Row[]): string {
  return `<tr><td style="padding:24px 0 0 0;">
<div style="font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};font-weight:700;padding-bottom:4px;border-bottom:2px solid ${C.ink};">${escapeHtml(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.map((r, i) => rowHtml(r, i === rows.length - 1)).join('')}</table>
</td></tr>`;
}

/** Email: Tasks, Content, Day Finder (in that order); minimal rows; empty sections hidden. */
export function renderEmail(snap: BriefingSnapshot): RenderedEmail {
  const longDate = formatLongDate(snap.localDate);
  const subject = `Your Miler briefing · ${formatShortDate(snap.localDate)}`;

  const taskRows = snap.tasks.map((t) => ({ title: t.title, detail: timeLabel(t, snap) }));
  const contentRows = snap.content.map((c) => ({ title: c.title, detail: timeLabel(c, snap) }));
  const blockRows = snap.dayFinder.map((b) => ({ title: b.name, detail: blockTimeLabel(b, snap) }));
  const sections = [
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

  const body = empty
    ? `<tr><td style="padding:24px 0 8px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.secondary};">${escapeHtml(emptyLine)}</td></tr>`
    : sections.map((s) => sectionHtml(s.title, s.rows)).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:480px){.stack{display:block!important;width:100%!important;text-align:left!important;white-space:normal!important;padding-right:0!important}.right{padding-top:2px!important}.card{padding:20px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="height:4px;background:${C.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="card" style="background:${C.surface};border:1px solid ${C.border};border-top:0;padding:28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;letter-spacing:0.04em;color:${C.ink};">Miler</td></tr>
<tr><td style="padding-top:8px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${C.ink};">Your briefing</td></tr>
<tr><td style="padding-top:2px;font-family:${FONT};font-size:15px;line-height:22px;color:${C.secondary};">${escapeHtml(longDate)}</td></tr>
${body}
</table></td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
