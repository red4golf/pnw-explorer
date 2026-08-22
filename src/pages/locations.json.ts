import type { APIRoute } from 'astro';
import { categoryByName, slugForCategory } from '../lib/categories';
import { media, mediaVariant } from '../lib/url';
import { publishedLocations, byTitle } from '../lib/publish';

/**
 * The dataset behind the map, the "near me" panel, and the route planner.
 *
 * Deliberately trimmed: coordinates, a short summary, and the two image URLs a
 * card needs. At 95 entries the whole payload is around 40 KB, which is cheap
 * enough to precache for offline use. If the corpus grows past a few hundred
 * this becomes a spatial index plus per-tile fetches — but building that now
 * would be solving a problem the site does not have.
 */
export const GET: APIRoute = async () => {
  const locations = (await publishedLocations()).sort(byTitle);

  const payload = locations.map((l) => {
    const d = l.data;
    return {
      slug: d.slug,
      title: d.title,
      category: d.category,
      categorySlug: slugForCategory(d.category),
      categoryIcon: categoryByName(d.category)?.icon ?? '📍',
      period: d.period,
      lat: d.coordinates.lat,
      lng: d.coordinates.lng,
      summary: d.summary,
      hero: d.hero ? media(d.hero.src) : null,
      card: d.hero ? mediaVariant(d.hero.src, 'card') : null,
      hasAudio: Boolean(d.audio),
    };
  });

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
