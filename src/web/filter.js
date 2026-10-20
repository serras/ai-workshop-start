// The filter above the list of skills: shared by the page and the tests, so no DOM here.

/** Whether a skill's name matches what is typed in the filter: contains it, ignoring case and outer spaces. */
export function matches(name, typed) {
  const text = typed.trim().toLowerCase();
  return name.toLowerCase().includes(text);
}

/** What the list shows for the filter: nothing for every skill or some, a message for none. */
export function noMatch(names, typed) {
  const text = typed.trim();
  return text && !names.some((name) => matches(name, text)) ? `No skill matches "${text}".` : null;
}
