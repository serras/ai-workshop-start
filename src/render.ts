// A SKILL.md as HTML for the web view: its front matter as a table, then its Markdown; its
// description, Markdown too, also on its own for the list of skills. The file comes from any
// repository, so nothing in it runs: raw HTML is shown as text, and links keep only web addresses.
import { Marked, type Tokens } from 'marked';
import { stringify } from 'yaml';
import { parseSkill } from './core/parse.ts';

/** The skill's HTML; `link` is where its file is, for the relative links and images in it. */
export function renderSkill(text: string, link: string): string {
  const parsed = parseSkill(text);
  const properties: [string, unknown][] = [
    ...(parsed.name ? [['name', parsed.name] as [string, unknown]] : []),
    ...(parsed.description ? [['description', parsed.description] as [string, unknown]] : []),
    ...Object.entries(parsed.properties),
  ];
  const table = properties.length
    ? `<table class="front-matter"><tbody>${properties
        .map(([key, value]) => {
          const cell = key === 'description' ? inline(String(value), link) : escape(show(value));
          return `<tr><th>${escape(key)}</th><td>${cell}</td></tr>`;
        })
        .join('')}</tbody></table>\n`
    : '';
  const warning = parsed.warning ? `<p class="warning">${escape(parsed.warning)}</p>\n` : '';
  return warning + table + markdown(link).parse(parsed.body, { async: false });
}

/**
 * The description's first sentence, its Markdown rendered for the list of skills; links and images
 * are only their text there, since each skill in the list is a button.
 */
export function renderSummary(description: string, link: string): string {
  return inline(firstSentence(description), link, false);
}

/** The first sentence of the Markdown; a `.` in a code span does not end one. */
function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^(?:`[^`]*`|[^`])*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}

function inline(text: string, base: string, links = true): string {
  return markdown(base, links).parseInline(text, { async: false });
}

function markdown(base: string, links = true): Marked {
  return new Marked({
    gfm: true,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escape(text);
      },
      link({ href, title, tokens }: Tokens.Link) {
        const label = this.parser.parseInline(tokens);
        const url = links && safeUrl(href, base);
        if (!url) return label;
        return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const url = links && safeUrl(href, base, true);
        if (!url) return escape(text);
        return `<img src="${escape(url)}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ''}>`;
      },
    },
  });
}

/** An address the page may follow, relative ones resolved against the file; undefined otherwise. */
function safeUrl(href: string, base: string, image = false): string | undefined {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  const local = new URL(base).protocol === 'file:';
  if (!['http:', 'https:', 'mailto:', ...(local && !image ? ['file:'] : [])].includes(url.protocol)) return undefined;
  // An image in the repository: GitHub shows its bytes for `?raw=true`, not for its page.
  if (image && url.hostname === 'github.com' && url.pathname.split('/')[3] === 'blob') url.searchParams.set('raw', 'true');
  return url.href;
}

function show(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringify(value).trimEnd();
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
