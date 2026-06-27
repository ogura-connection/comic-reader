// AniList GraphQL — free, no key, CORS-open. Used to enrich a manga SERIES.
const ENDPOINT = 'https://graphql.anilist.co';

const QUERY = `query ($q: String) {
  Page(perPage: 8) {
    media(search: $q, type: MANGA, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      startDate { year }
      description(asHtml: false)
      genres
      coverImage { medium large }
      countryOfOrigin
      format
      staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`;

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

export async function searchManga(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { q: query } }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  const media = (json.data && json.data.Page && json.data.Page.media) || [];
  return media.map(m => ({
    id: m.id,
    title: (m.title.english || m.title.romaji || m.title.native || '').trim(),
    native: m.title.native || '',
    year: m.startDate && m.startDate.year || null,
    description: stripHtml(m.description),
    genres: m.genres || [],
    cover: m.coverImage && (m.coverImage.medium || m.coverImage.large) || '',
    country: m.countryOfOrigin || '',
    format: m.format || '',
    authors: (m.staff && m.staff.edges || [])
      .filter(e => /story|art|original|mangaka/i.test(e.role))
      .map(e => ({ name: e.node.name.full, role: e.role }))
      .slice(0, 4),
  }));
}
