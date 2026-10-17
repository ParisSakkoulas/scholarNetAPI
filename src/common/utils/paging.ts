/** Reads ?page & ?limit from a raw query string with safe defaults and a max page size. */
export function parsePaging(page?: string, limit?: string, maxLimit = 100) {
  const p = Math.max(1, parseInt(page ?? '', 10) || 1);
  const l = Math.min(maxLimit, Math.max(1, parseInt(limit ?? '', 10) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
}
