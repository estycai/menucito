/** Clickable URL of a public menu: `http://` when `base` is a local host, `https://` otherwise. */
export function publicMenuHref(base: string, slug: string): string {
  const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(base) ? "http" : "https";
  return `${scheme}://${base}/${slug}`;
}
