import type { BriefingContent, BriefingSnapshot, BriefingTask } from './model';
import { platformLabel } from './build';
import { isEmptyFor, timeLabel } from './labels';
import { formatShortDate } from './time';

/** Telegram counts characters of the message text after entity parsing; we budget on HTML length (stricter). */
export const TELEGRAM_MESSAGE_LIMIT = 4096;
const BUDGET = 3900; // leaves headroom for the "Part x of y" footer

/** Escapes text for Telegram's HTML parse mode (&, <, > — plus quotes for attribute values). */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const esc = escapeTelegramHtml;

export interface RenderedTelegram {
  /** Ordered HTML messages (parse_mode=HTML), each within the Telegram limit. */
  parts: string[];
  /** Plain-text equivalent (tags removed) for logging-free fallbacks and tests. */
  text: string;
}

type Line = { kind: 'fixed'; html: string } | { kind: 'long'; prefix: string; text: string };

const PRIORITY: Record<string, string> = { urgent: '🔴 Urgent', high: '🟠 High', medium: '🟡 Medium', low: '🟢 Low' };
const TASK_STATUS: Record<string, string> = { in_progress: 'In progress', blocked: 'Blocked' };
const CONTENT_STATUS: Record<string, string> = { idea: 'Idea', draft: 'Draft', scheduled: 'Scheduled', publishing: 'Publishing', failed: 'Failed to publish' };

function link(url: string, label?: string): string {
  return `<a href="${esc(url)}">${esc(label ?? url)}</a>`;
}

function context(entry: BriefingTask | BriefingContent, snap: BriefingSnapshot): string[] {
  const bits: string[] = [];
  if (entry.projectName) bits.push(`📁 ${esc(entry.projectName)}`);
  if (entry.kind === 'task' && entry.milestoneName) bits.push(`🎯 ${esc(entry.milestoneName)}`);
  if (snap.workspaceCount > 1 && entry.workspaceName) bits.push(`🏢 ${esc(entry.workspaceName)}`);
  return bits;
}

function taskLines(t: BriefingTask, snap: BriefingSnapshot): Line[] {
  const lines: Line[] = [{ kind: 'fixed', html: `• <b>${esc(t.title)}</b>` }];
  lines.push({ kind: 'fixed', html: `🕒 ${esc(timeLabel(t, snap))}` });
  const meta = [PRIORITY[t.priority] ? `${PRIORITY[t.priority]} priority` : null, TASK_STATUS[t.status] ?? null].filter(Boolean);
  if (meta.length) lines.push({ kind: 'fixed', html: esc(meta.join(' · ')) });
  const ctx = context(t, snap);
  if (ctx.length) lines.push({ kind: 'fixed', html: ctx.join(' · ') });
  if (t.parentTitle) lines.push({ kind: 'fixed', html: `↳ Subtask of ${esc(t.parentTitle)}` });
  if (t.assignedTo) lines.push({ kind: 'fixed', html: `👤 Assigned to ${esc(t.assignedTo)}` });
  if (t.estimatedMinutes) lines.push({ kind: 'fixed', html: `⏱ Estimated ${t.estimatedMinutes} min` });
  if (t.description) lines.push({ kind: 'long', prefix: '📝 ', text: t.description });
  if (t.tags.length) lines.push({ kind: 'fixed', html: `🏷 ${esc(t.tags.join(', '))}` });
  return lines;
}

function contentLines(c: BriefingContent, snap: BriefingSnapshot): Line[] {
  const lines: Line[] = [{ kind: 'fixed', html: `• <b>${esc(c.title)}</b>` }];
  lines.push({ kind: 'fixed', html: `🕒 ${esc(timeLabel(c, snap))}` });
  const what = [`${platformLabel(c.platform)} ${c.actionType}`, c.accountLabel, CONTENT_STATUS[c.status] ?? null, c.durationMinutes ? `${c.durationMinutes} min` : null].filter(Boolean) as string[];
  lines.push({ kind: 'fixed', html: `📣 ${esc(what.join(' · '))}` });
  const ctx = context(c, snap);
  if (ctx.length) lines.push({ kind: 'fixed', html: ctx.join(' · ') });
  if (c.body) lines.push({ kind: 'long', prefix: '✍️ ', text: c.body });
  if (c.notes) lines.push({ kind: 'long', prefix: '📝 Notes: ', text: c.notes });
  if (c.targetUrl) lines.push({ kind: 'fixed', html: `🎯 Target: ${link(c.targetUrl)}` });
  if (c.links.length) lines.push({ kind: 'fixed', html: `🔗 ${c.links.map((l) => link(l.url, l.label)).join(' · ')}` });
  if (c.mediaLinks.length) lines.push({ kind: 'fixed', html: `🖼 ${c.mediaLinks.map((l) => link(l.url, l.label)).join(' · ')}` });
  if (c.tags.length) lines.push({ kind: 'fixed', html: `🏷 ${esc(c.tags.join(', '))}` });
  return lines;
}

/** Largest prefix of `text` (cut at a paragraph/line/word boundary when possible) whose escaped form fits `room`. */
function takeFitting(text: string, room: number): string {
  let len = Math.max(1, Math.min(text.length, room));
  while (len > 1 && esc(text.slice(0, len)).length > room) len = Math.floor(len * 0.9);
  if (len >= text.length) return text;
  const head = text.slice(0, len);
  const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
  return cut > len * 0.5 ? head.slice(0, cut) : head;
}

/** Splits one item into ordered pieces <= max, never dropping text; continuation pieces repeat the title. */
function itemPieces(title: string, lines: Line[], max: number): string[] {
  const contHead = `<b>${esc(title)}</b> <i>(continued)</i>`;
  const pieces: string[] = [];
  let cur = '';
  const flush = () => {
    pieces.push(cur);
    cur = contHead;
  };
  const add = (html: string) => {
    if (cur && cur.length + 1 + html.length > max) flush();
    cur = cur ? `${cur}\n${html}` : html;
  };

  for (const line of lines) {
    if (line.kind === 'fixed') {
      if (line.html.length <= max - contHead.length - 1) {
        add(line.html);
      } else {
        // Pathologically long markup line: fall back to plain escaped text so nothing is lost.
        let rest = line.html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        while (rest) {
          const room = max - contHead.length - 1;
          const piece = takeFitting(rest, room);
          add(esc(piece));
          rest = rest.slice(piece.length).trimStart();
        }
      }
      continue;
    }
    let rest = line.text;
    while (rest) {
      let room = max - (cur ? cur.length + 1 : 0) - line.prefix.length;
      if (room < 200 && cur && cur !== contHead) {
        flush();
        room = max - cur.length - 1 - line.prefix.length;
      }
      const piece = takeFitting(rest, room);
      add(`${line.prefix}${esc(piece)}`);
      rest = rest.slice(piece.length).trimStart();
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, (_m, href: string, label: string) => (href === label ? label : `${label} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** Telegram: Tasks then Content (no Day Finder); detailed items; conversational; split to fit the limit. */
export function renderTelegram(snap: BriefingSnapshot): RenderedTelegram {
  const dateLabel = formatShortDate(snap.localDate);

  if (isEmptyFor('telegram', snap)) {
    const html = `🌿 <b>Your day</b> · ${esc(dateLabel)}\nNothing on your list for today. Enjoy the open day!`;
    return { parts: [html], text: htmlToPlain(html) };
  }

  const intro = `☀️ <b>Your day</b> · ${esc(dateLabel)}\nHere’s what’s on for today:`;
  const sections: Array<{ emoji: string; name: string; count: number; items: Array<{ title: string; lines: Line[] }> }> = [];
  if (snap.tasks.length) {
    sections.push({ emoji: '📋', name: 'Tasks', count: snap.tasks.length, items: snap.tasks.map((t) => ({ title: t.title, lines: taskLines(t, snap) })) });
  }
  if (snap.content.length) {
    sections.push({ emoji: '📣', name: 'Content', count: snap.content.length, items: snap.content.map((c) => ({ title: c.title, lines: contentLines(c, snap) })) });
  }

  const chunks: string[] = [];
  let cur = '';
  // The intro (and first section heading) travel with the first item so message 1 is never just a greeting.
  let lead: string | null = intro;
  for (const s of sections) {
    const full = `${s.emoji} <b>${s.name}</b> (${s.count})`;
    const cont = `${s.emoji} <b>${s.name}</b> <i>(continued)</i>`;
    let heading: string | null = full;
    for (const item of s.items) {
      const max = lead ? BUDGET - intro.length - full.length - 4 : BUDGET - cont.length - 2;
      for (const piece of itemPieces(item.title, item.lines, max)) {
        const lay = (head: string | null) => [lead, head].filter(Boolean).join('\n\n');
        let prefix = lay(heading);
        let block = prefix ? `${prefix}\n\n${piece}` : piece;
        if (cur && cur.length + 2 + block.length > BUDGET) {
          chunks.push(cur);
          cur = '';
          prefix = lay(heading ?? cont);
          block = `${prefix}\n\n${piece}`;
        }
        cur = cur ? `${cur}\n\n${block}` : block;
        heading = null;
        lead = null;
      }
    }
  }
  chunks.push(cur);

  const parts = chunks.length > 1 ? chunks.map((c, i) => `${c}\n\n<i>Part ${i + 1} of ${chunks.length}</i>`) : chunks;
  return { parts, text: parts.map(htmlToPlain).join('\n\n———\n\n') };
}
