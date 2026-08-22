/**
 * Build-time Amazon affiliate tagging.
 *
 * Book links in content stay plain. The Associates tag is appended here, at
 * build, so the ID exists in exactly one place instead of being pasted across
 * 95 markdown files — and so changing it is an environment variable rather than
 * a corpus-wide find and replace.
 *
 * The tag is not secret; it is visible in every outbound link. It lives in
 * config for maintainability, not for secrecy.
 */
import { AMAZON_TAG } from '../config';

/** amazon.com, amazon.co.uk, amazon.ca, smile.amazon.com, www.amazon.de, ... */
const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i;

export function isAmazonUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  try {
    return AMAZON_HOST.test(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Return the URL with `tag=<affiliate tag>` set. Non-Amazon URLs and the
 * no-tag-configured case both return the original untouched, so an unset tag
 * degrades to plain outbound links rather than breaking them.
 */
export function withAffiliateTag(rawUrl?: string | null, tag: string = AMAZON_TAG): string {
  if (!rawUrl) return '';
  if (!tag || !isAmazonUrl(rawUrl)) return rawUrl;
  try {
    const u = new URL(rawUrl);
    u.searchParams.set('tag', tag);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Attributes every tagged outbound book link must carry.
 * `sponsored` is required by Amazon's operating agreement and by the FTC's
 * endorsement guides; `noopener` is required by anything opening a new tab.
 */
export const affiliateRel = (url?: string | null): string =>
  isAmazonUrl(url) && AMAZON_TAG ? 'noopener nofollow sponsored' : 'noopener';
