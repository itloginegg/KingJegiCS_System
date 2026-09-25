/**
 * The light markdown Gemini writes in chat replies — **bold**, *italic*, "- " and "* "
 * bullets, "### " headings — turned into something readable.
 *
 * The chat bubble used to print it raw, so customers saw "**Party Set A**". This is
 * deliberately small: bold and italic become real elements, bullets become "•", heading
 * marks are dropped. Everything is built as React elements, never HTML, so a reply can't
 * inject markup. The bubble keeps `white-space: pre-wrap`, which handles line breaks.
 *
 * The voice path strips the same marks server-side (VoiceSpeech); plainChatText is the
 * text-chat equivalent for the browser's own speech synthesis.
 */
import type { ReactNode } from 'react';

/** Line-level marks: a bullet becomes "• ", a heading loses its #s. */
function normaliseLine(line: string): string {
  return line
    .replace(/^(\s*)[-*•]\s+/, '$1• ')
    .replace(/^\s*#{1,6}\s+/, '');
}

/** **bold** / __bold__ first, then *italic* / _italic_, within one line. */
const INLINE = /(\*\*|__)(.+?)\1|(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\3(?![\w*])/g;

export function renderChatText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, li) => {
    const line = normaliseLine(raw);
    let last = 0;
    for (const m of line.matchAll(INLINE)) {
      const at = m.index ?? 0;
      if (at > last) out.push(line.slice(last, at));
      out.push(m[2] !== undefined
        ? <strong key={`${li}-${at}`}>{m[2]}</strong>
        : <em key={`${li}-${at}`}>{m[4]}</em>);
      last = at + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    if (li < lines.length - 1) out.push('\n');
  });
  return out;
}

/** The same text with the marks removed, for speech. */
export function plainChatText(text: string): string {
  return text
    .split('\n')
    .map((l) => normaliseLine(l).replace(/^• /, ''))
    .join('\n')
    .replace(INLINE, (_m, _d, bold, _s, italic) => bold ?? italic ?? '');
}
