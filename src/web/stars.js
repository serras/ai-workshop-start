// A repository's stars as the page shows them: shared by the page and the tests, so no DOM here.

/** `999`, `1k`, `56.2k`, `1.3m`: rounded to one decimal, without a trailing `.0`. */
export function stars(n) {
  if (n < 1000) return String(n);
  const thousands = Math.round(n / 100) / 10;
  if (thousands < 1000) return `${thousands}k`;
  return `${Math.round(n / 100_000) / 10}m`;
}
