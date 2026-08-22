/**
 * URL helpers.
 *
 * The site is served from the root of its own origin, so there is no base path
 * to prepend and `href` is the identity function. It exists anyway, and every
 * page uses it, for one reason: if the site ever has to move under a prefix
 * again, that is a one-line change here instead of a search-and-replace across
 * every template plus the service worker plus the manifest. The previous build
 * kept the prefix in three hand-synchronised places; drift between any two of
 * them silently broke offline mode, and it did.
 */
export const href = (path: string): string => path;

/**
 * Where media is served from.
 *
 * Empty (the default) serves media from this origin under /media — which is what
 * local development and a repo-only deploy both want. In production this points
 * at an R2 bucket on its own hostname, so 59 MB of narration audio never has to
 * live in git, never ships in a CI checkout, and never counts against the
 * hosting origin's egress.
 *
 * Content stores media paths origin-agnostically ("/images/foo-hero.jpg"), so
 * flipping between the two is one environment variable and no content edits.
 */
export const MEDIA_BASE: string = (import.meta.env.PUBLIC_MEDIA_BASE ?? '').replace(/\/+$/, '');

/** Resolve a content media path ("/images/x.jpg") to a servable URL. */
export const media = (path: string): string => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return MEDIA_BASE ? `${MEDIA_BASE}${clean}` : `/media${clean}`;
};

/** The webp variant produced by `npm run images`, with the original as fallback. */
export const mediaVariant = (path: string, variant: 'hero' | 'card' | 'thumb'): string =>
  media(path.replace(/\.(jpe?g|png)$/i, `-${variant}.webp`));

/** Absolute URL for canonical tags, OG images, and JSON-LD. */
export const absolute = (path: string, site: URL | undefined): string =>
  site ? new URL(path, site).href : path;
