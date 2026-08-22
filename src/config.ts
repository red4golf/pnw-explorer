/**
 * Central configuration.
 *
 * Editable, non-sensitive values live in src/data/site.json so they can be
 * changed through the CMS. Environment variables override them at build time
 * and always win.
 *
 * Everything in this file ends up in public HTML. Nothing secret goes here, and
 * nothing here is treated as if it were secret — including, deliberately, no
 * hardcoded fallback tokens. The previous build shipped a GoatCounter dashboard
 * access token as a literal default, which meant the token was public whether or
 * not the operator had ever heard of it. An unset variable now simply disables
 * the feature that needed it.
 */
import site from './data/site.json';

/**
 * Amazon Associates tracking ID, e.g. "pnwhistory-20".
 * Precedence: PUBLIC_AMAZON_TAG > site.json > empty.
 * Not secret — it appears in every outbound book link.
 */
export const AMAZON_TAG: string =
  import.meta.env.PUBLIC_AMAZON_TAG || site.amazonAssociatesTag || '';

/** GoatCounter site code, e.g. "pnwhistory" for pnwhistory.goatcounter.com. */
export const GOATCOUNTER_CODE: string = import.meta.env.PUBLIC_GOATCOUNTER_CODE || '';

/**
 * Read-only dashboard embed for /admin. Requires an explicitly configured
 * token; there is no default. Rotate any time in GoatCounter under
 * Settings > "Generate random secret".
 */
export const GOATCOUNTER_EMBED_URL: string =
  GOATCOUNTER_CODE && import.meta.env.PUBLIC_GOATCOUNTER_TOKEN
    ? `https://${GOATCOUNTER_CODE}.goatcounter.com?access-token=${import.meta.env.PUBLIC_GOATCOUNTER_TOKEN}`
    : '';

/** Repository as "owner/name", for the admin build-health panel. */
export const GITHUB_REPO: string = import.meta.env.PUBLIC_GITHUB_REPO || 'red4golf/pnw-explorer';

export const GITHUB_BRANCH: string = import.meta.env.PUBLIC_GITHUB_BRANCH || 'main';

/** Google Search Console verification token. Not secret. */
export const GOOGLE_SITE_VERIFICATION: string =
  import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION || '';

/**
 * Build-time flag mirroring INCLUDE_ADMIN.
 * Read from process.env because this is a shell/CI variable, not a .env entry —
 * import.meta.env would silently report false in exactly the deploy that set it.
 */
export const INCLUDE_ADMIN: boolean =
  typeof process !== 'undefined' && process.env?.INCLUDE_ADMIN === '1';

export { site };
