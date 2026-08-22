/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_MEDIA_BASE?: string;
  readonly PUBLIC_AMAZON_TAG?: string;
  readonly PUBLIC_GOATCOUNTER_CODE?: string;
  readonly PUBLIC_GOATCOUNTER_TOKEN?: string;
  readonly PUBLIC_GOOGLE_SITE_VERIFICATION?: string;
  readonly PUBLIC_GITHUB_REPO?: string;
  readonly PUBLIC_GITHUB_BRANCH?: string;
  readonly INCLUDE_ADMIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /**
   * Engagement counter. Always safe to call — it is a no-op when analytics is
   * disabled, which is why every call site uses `window.pnwTrack?.(...)`
   * without a feature check.
   */
  pnwTrack?: (name: string) => void;
  goatcounter?: { count: (opts: Record<string, unknown>) => void };
}

/** src/lib/style.mjs is plain JavaScript shared with the Node-side CI gate. */
declare module '*/style.mjs';
