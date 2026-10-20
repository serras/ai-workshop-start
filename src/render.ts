// A SKILL.md as HTML for the web view: its front matter as a table, then its Markdown; its
// description, Markdown too, also on its own for the list of skills. The file comes from any
// repository, so nothing in it runs: raw HTML is shown as text, and links keep only web addresses.
import { Marked, type Tokens } from 'marked';
import { stringify } from 'yaml';
import { firstSentence, parseSkill } from './core/parse.ts';

/** Where a SKILL.md is, for the links and images in it: its own link, and its repository's files. */
export type Place = { link: string; root: string };

/** The skill's HTML. */
export function renderSkill(text: string, place: Place): string {
  const parsed = parseSkill(text);
  const properties: [string, unknown][] = [
    ...(parsed.name ? [['name', parsed.name] as [string, unknown]] : []),
    ...(parsed.description ? [['description', parsed.description] as [string, unknown]] : []),
    ...Object.entries(parsed.properties),
  ];
  const table = properties.length
    ? `<table class="front-matter"><tbody>${properties
        .map(([key, value]) => {
          const cell = key === 'description' ? inline(String(value), place) : escape(show(value));
          return `<tr><th>${escape(key)}</th><td>${cell}</td></tr>`;
        })
        .join('')}</tbody></table>\n`
    : '';
  const warning = parsed.warning ? `<p class="warning">${escape(parsed.warning)}</p>\n` : '';
  return warning + table + markdown(place).parse(parsed.body, { async: false });
}

/**
 * The description's first sentence, its Markdown rendered for the list of skills; links and images
 * are only their text there, since each skill in the list is a button.
 */
export function renderSummary(description: string, place: Place): string {
  return inline(firstSentence(description), place, false);
}

function inline(text: string, place: Place, links = true): string {
  return markdown(place, links).parseInline(text, { async: false });
}

function markdown(place: Place, links = true): Marked {
  return new Marked({
    gfm: true,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escape(text);
      },
      link({ href, title, tokens }: Tokens.Link) {
        const label = this.parser.parseInline(tokens);
        const url = links && safeUrl(href, place);
        if (!url) return label;
        return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const url = links && safeUrl(href, place, true);
        if (!url) return escape(text);
        return `<img src="${escape(url)}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ''}>`;
      },
    },
  });
}

/**
 * An address the page may follow, undefined otherwise: relative ones resolved against the file,
 * and `/…` against the repository's files, as GitHub does. A page on http://localhost cannot open
 * file: addresses, so a local directory's own links are only their text; images are https: only,
 * as the page's policy allows.
 */
function safeUrl(href: string, { link, root }: Place, image = false): string | undefined {
  let url: URL;
  try {
    url = /^\/(?!\/)/.test(href) ? new URL(href.slice(1), root) : new URL(href, link);
  } catch {
    return undefined;
  }
  if (!(image ? ['https:'] : ['http:', 'https:', 'mailto:']).includes(url.protocol)) return undefined;
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
