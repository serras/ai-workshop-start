// The web view: scans what is typed at the top, a repository or an organization, lists the skills
// on the left, by repository, and shows the selected SKILL.md on the right. `?repo=…&skill=…` keeps
// both across a reload, `&filter=…` the filter at the top of the list, applied as it is typed. On
// GitHub, the owner's avatar and homepage above the skills, and each repository's stars.
import { count, matches, noMatch } from './filter.js';
import { stars } from './stars.js';

const form = document.querySelector('#scan');
const input = document.querySelector('#repo');
const status = document.querySelector('#status');
const scanned = document.querySelector('#scanned');
const owner = document.querySelector('#owner');
const summary = document.querySelector('#summary');
const filter = document.querySelector('#filter');
const noMatchMessage = document.querySelector('#no-match');
const list = document.querySelector('#list');
const warnings = document.querySelector('#warnings');
const article = document.querySelector('#skill');

/** The latest scan; an answer to an earlier one is dropped. */
let current = 0;
let skills = [];
/** Whether the latest scan is an organization's: its skills come from several repositories. */
let organization = false;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  scan(input.value.trim());
});

filter.addEventListener('input', () => {
  applyFilter();
  remember({ filter: filter.value });
});

const params = new URLSearchParams(location.search);
if (params.get('repo')) {
  input.value = params.get('repo');
  scan(params.get('repo'), params.get('skill'), params.get('filter') ?? '');
}

async function scan(repo, selected, typed = '') {
  if (!repo) return;
  const request = ++current;
  show(`Scanning ${repo}…`);
  form.querySelector('button').disabled = true;
  try {
    const response = await fetch(`/api/scan?repo=${encodeURIComponent(repo)}`);
    const body = await response.json();
    if (request !== current) return;
    if (!response.ok) return show(body.error, true);
    status.hidden = true;
    organization = Boolean(body.organization);
    skills = body.repositories.flatMap((result) => result.skills);
    showOwner(body.owner);
    list.replaceChildren(...body.repositories.map(group));
    summary.textContent = organization
      ? `${body.id} · ${count(skills.length)}${skills.length ? ` in ${count(body.repositories.length, 'repository', 'repositories')}` : ''}`
      : `${body.id} · ${count(skills.length)}`;
    showWarnings(body.warnings);
    filter.value = typed;
    applyFilter();
    scanned.hidden = false;
    remember({ repo, skill: null, filter: typed });
    select(skills.find((skill) => skill.id === selected));
  } catch (error) {
    if (request === current) show(`Cannot scan ${repo}: ${error.message}`, true);
  } finally {
    if (request === current) form.querySelector('button').disabled = false;
  }
}

/**
 * The organization scanned, or the one owning the repository: its avatar, its login linked to its
 * GitHub page, and its homepage; nothing for a local directory.
 */
function showOwner(account) {
  owner.hidden = !account;
  if (!account) return;
  const avatar = owner.querySelector('img');
  avatar.hidden = !account.avatar;
  if (account.avatar) avatar.src = account.avatar;
  else avatar.removeAttribute('src');
  const login = owner.querySelector('.login');
  login.href = account.url;
  login.textContent = account.id;
  const homepage = owner.querySelector('.homepage');
  homepage.hidden = !account.homepage;
  if (account.homepage) {
    homepage.href = account.homepage;
    // As GitHub shows it: without the scheme and the trailing slash.
    homepage.textContent = account.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '');
  } else {
    homepage.removeAttribute('href');
    homepage.textContent = '';
  }
}

/** One repository's skills: its id and how many of them the filter leaves, its stars, then the skills. */
function group({ repository, skills }) {
  const section = document.createElement('section');
  section.className = 'repository';
  section.dataset.id = repository.id;
  const header = document.createElement('header');
  header.append(document.createElement('h3'));
  if (typeof repository.stars === 'number') {
    const badge = document.createElement('span');
    badge.className = 'stars';
    badge.textContent = `★ ${stars(repository.stars)}`;
    badge.title = `${repository.stars.toLocaleString('en-US')} ${repository.stars === 1 ? 'star' : 'stars'}`;
    header.append(badge);
  }
  const ul = document.createElement('ul');
  ul.append(...skills.map(item));
  section.append(header, ul);
  return section;
}

/** One skill in the list: its name and the first sentence of its description, rendered by the server. */
function item(skill) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.id = skill.id;
  button.dataset.name = skill.name;
  const name = document.createElement('strong');
  name.textContent = skill.name;
  button.append(name);
  if (skill.summary) {
    const description = document.createElement('span');
    description.innerHTML = skill.summary;
    button.append(description);
  }
  button.addEventListener('click', () => select(skill));
  const li = document.createElement('li');
  li.append(button);
  return li;
}

/**
 * Lists only the skills whose name matches the filter, by repository, each with how many it found;
 * a repository with none is left out. The selected skill stays on the right.
 */
function applyFilter() {
  for (const section of list.children) {
    const items = [...section.querySelectorAll('li')];
    for (const li of items) li.hidden = !matches(li.firstChild.dataset.name, filter.value);
    const found = items.filter((li) => !li.hidden).length;
    section.querySelector('h3').textContent = `${section.dataset.id} · ${count(found)}`;
    section.hidden = found === 0;
  }
  const message = noMatch(skills.map((skill) => skill.name), filter.value);
  noMatchMessage.textContent = message ?? '';
  noMatchMessage.hidden = !message;
}

function select(skill) {
  for (const button of list.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.id === skill?.id));
  }
  if (!skill) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = skills.length ? 'Select a skill to read its SKILL.md.' : 'No skills found';
    return article.replaceChildren(placeholder);
  }
  remember({ skill: skill.id });

  const heading = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = skill.name;
  // A page on http://localhost cannot open a local directory's file: links: the path is only text.
  const web = /^https?:/.test(skill.link);
  const path = document.createElement(web ? 'a' : 'span');
  if (web) {
    path.href = skill.link;
    path.target = '_blank';
    path.rel = 'noopener noreferrer';
  }
  path.className = 'path';
  // An organization's skills come from several repositories: the path says which.
  path.textContent = organization ? `${skill.repository}/${skill.path}` : skill.path;
  heading.append(title, path);
  if (skill.copies.length) {
    const copies = document.createElement('p');
    copies.className = 'copies';
    copies.textContent = `also in ${skill.copies.join(', ')}`;
    heading.append(copies);
  }
  // Rendered by the server, raw HTML escaped; the page's policy runs no script of the file's.
  const body = document.createElement('div');
  body.className = 'markdown';
  body.innerHTML = skill.html;
  article.replaceChildren(heading, body);
  article.scrollTop = 0;
}

function showWarnings(texts) {
  warnings.hidden = texts.length === 0;
  warnings.querySelector('summary').textContent = `${texts.length} ${texts.length === 1 ? 'warning' : 'warnings'}`;
  warnings.querySelector('ul').replaceChildren(
    ...texts.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function show(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
  status.hidden = false;
  if (!error) return;
  // In place of the skills, and of the one that was selected.
  scanned.hidden = true;
  skills = [];
  list.replaceChildren();
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder';
  placeholder.textContent = 'Scan a GitHub repository, a GitHub organization or a directory.';
  article.replaceChildren(placeholder);
}

function remember(changes) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value?.trim()) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
}
