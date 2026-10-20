// The filter at the top of the list of skills: shared by the page and the tests, so no DOM here.

/** Whether a skill's name matches what is typed in the filter: contains it, ignoring case and outer spaces. */
export function matches(name, typed) {
  const text = typed.trim().toLowerCase();
  return name.toLowerCase().includes(text);
}

/** What the list shows for the filter: nothing when some skill matches, a message when none does or there is none. */
export function noMatch(names, typed) {
  return names.some((name) => matches(name, typed)) ? null : 'No skills found';
}

/** `N skills`, or `1 skill`. */
export function count(n, one = 'skill', many = 'skills') {
  return `${n} ${n === 1 ? one : many}`;
}
