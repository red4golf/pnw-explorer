/**
 * The taxonomy. Nine categories, enforced as an enum in the content schema so a
 * typo in the CMS fails the build instead of creating a tenth category with one
 * entry in it.
 */
export interface CategoryDef {
  name: string;
  slug: string;
  icon: string;
  blurb: string;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    name: 'Natural Wonders',
    slug: 'natural-wonders',
    icon: '🌲',
    blurb: 'Gorges, peaks, caves, and coastlines shaped over millennia.',
  },
  {
    name: 'Culture and Community',
    slug: 'culture-and-community',
    icon: '🎭',
    blurb: 'Theaters, markets, gathering places, and living traditions.',
  },
  {
    name: 'Indigenous Heritage',
    slug: 'indigenous-heritage',
    icon: '🪶',
    blurb: 'First Peoples’ homelands, villages, and sacred places.',
  },
  {
    name: 'Towns and Settlements',
    slug: 'towns-and-settlements',
    icon: '🏘️',
    blurb: 'Boomtowns, ghost towns, and communities that endured.',
  },
  {
    name: 'Military and Conflict',
    slug: 'military-and-conflict',
    icon: '🛡️',
    blurb: 'Forts, batteries, and battlefields guarding the Northwest.',
  },
  {
    name: 'Industry and Agriculture',
    slug: 'industry-and-agriculture',
    icon: '⚙️',
    blurb: 'Mills, mines, dams, and farms that built the region.',
  },
  {
    name: 'Aviation and Transportation',
    slug: 'aviation-and-transportation',
    icon: '✈️',
    blurb: 'Airfields, railways, and the routes that connected the West.',
  },
  {
    name: 'Landmarks and Memorials',
    slug: 'landmarks-and-memorials',
    icon: '🗿',
    blurb: 'Monuments, towers, and places of remembrance.',
  },
  {
    name: 'Maritime',
    slug: 'maritime',
    icon: '⚓',
    blurb: 'Lighthouses, ferries, shipyards, and the working waterfront.',
  },
] as const;

export const categoryBySlug = (slug: string): CategoryDef | undefined =>
  CATEGORIES.find((c) => c.slug === slug);

export const categoryByName = (name: string): CategoryDef | undefined =>
  CATEGORIES.find((c) => c.name === name);

export const slugForCategory = (name: string): string =>
  categoryByName(name)?.slug ?? name.toLowerCase().replace(/\s+/g, '-');
