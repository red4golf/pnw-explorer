/**
 * Editorial publishing rules.
 *
 * Public pages render only what is meant to be live. Admin views use the raw
 * collection so nothing is hidden from the operator. The filter lives here, in
 * one function, so a change to the rule applies everywhere at once rather than
 * being reimplemented slightly differently on each page.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export type Loc = CollectionEntry<'locations'>;

/** Every location, drafts included. Operator views only. */
export async function allLocations(): Promise<Loc[]> {
  return getCollection('locations');
}

/**
 * Locations that belong on the public site.
 *
 * `draft: true` excludes an entry from the build. `publishDate` deliberately
 * does NOT gate anything: this is a static build that only regenerates on
 * deploy, so date-gating would drop a page silently and keep it dropped until
 * somebody happened to push again. It is an informational label in the pipeline
 * board and nothing more. A scheduled publish needs a scheduled build, which is
 * a cron trigger, not a template condition.
 */
export async function publishedLocations(): Promise<Loc[]> {
  return (await getCollection('locations')).filter((l) => !l.data.draft);
}

/** Alphabetical by title — the default order for every listing surface. */
export const byTitle = (a: Loc, b: Loc): number => a.data.title.localeCompare(b.data.title);
