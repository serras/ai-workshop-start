// The web view: scans what is typed at the top, lists the skills on the left and shows the
// selected SKILL.md on the right. `?repo=…&skill=…` keeps both across a reload.
const form = document.querySelector('#scan');
const input = document.querySelector('#repo');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const summary = document.querySelector('#summary');
const list = document.querySelector('#list');
const warnings = document.querySelector('#warnings');
const article = document.querySelector('#skill');

/** The latest scan; an answer to an earlier one is dropped. */
let current = 0;
let skills = [];

form.addEventListener('submit', (event) => {
  event.preventDefault();
  scan(input.value.trim());
});

const params = new URLSearchParams(location.search);
if (params.get('repo')) {
  input.value = params.get('repo');
  scan(params.get('repo'), params.get('skill'));
}

async function scan(repo, selected) {
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
    skills = body.skills;
    list.replaceChildren(...skills.map(item));
    summary.textContent = `${body.repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
    showWarnings(body.warnings);
    results.hidden = false;
    remember({ repo, skill: null });
    select(skills.find((skill) => skill.path === selected));
  } catch (error) {
    if (request === current) show(`Cannot scan ${repo}: ${error.message}`, true);
  } finally {
    if (request === current) form.querySelector('button').disabled = false;
  }
}

/** One skill in the list: its name and the first sentence of its description, rendered by the server. */
function item(skill) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.path = skill.path;
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

function select(skill) {
  for (const button of list.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.path === skill?.path));
  }
  if (!skill) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = skills.length ? 'Select a skill to read its SKILL.md.' : 'No skills in this repository.';
    return article.replaceChildren(placeholder);
  }
  remember({ skill: skill.path });

  const heading = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = skill.name;
  const link = document.createElement('a');
  link.href = skill.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = skill.path;
  heading.append(title, link);
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
  if (error) results.hidden = true;
}

function remember(changes) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
}
