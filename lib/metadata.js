// Turn raw sources (embedded ComicInfo.xml, PDF info dict, the filename) into a
// uniform metadata record used by the library and series grouping.

const text = (el, tag) => {
  const n = el.getElementsByTagName(tag)[0];
  return n && n.textContent ? n.textContent.trim() : '';
};
const splitList = s => s.split(/[,;]/).map(x => x.trim()).filter(Boolean);

// ---- ComicInfo.xml (ComicRack schema) ----
export function parseComicInfo(xmlString) {
  let doc;
  try { doc = new DOMParser().parseFromString(xmlString, 'application/xml'); }
  catch (_) { return null; }
  const root = doc.getElementsByTagName('ComicInfo')[0] || doc.documentElement;
  if (!root) return null;
  const creators = [];
  for (const role of ['Writer', 'Penciller', 'Inker', 'Colorist', 'CoverArtist']) {
    for (const name of splitList(text(root, role))) creators.push({ name, role });
  }
  const manga = text(root, 'Manga');
  const year = text(root, 'Year');
  return {
    source: 'comicinfo',
    series: text(root, 'Series') || '',
    number: text(root, 'Number') || '',
    volume: text(root, 'Volume') || '',
    title: text(root, 'Title') || '',
    year: year ? parseInt(year, 10) : null,
    summary: text(root, 'Summary') || '',
    publisher: text(root, 'Publisher') || '',
    genres: splitList(text(root, 'Genre')),
    creators,
    direction: manga === 'YesAndRightToLeft' ? 'rtl' : null,
  };
}

// ---- PDF info dict (from pdf.js getMetadata) ----
export function fromPdfInfo(info) {
  if (!info) return null;
  const title = (info.Title || '').trim();
  const author = (info.Author || '').trim();
  if (!title && !author) return null;
  return { source: 'pdf', title, creators: author ? [{ name: author, role: 'Author' }] : [] };
}

// ---- filename heuristics ("Marvels 01 (of 04) (1994) (Digital) (Group)") ----
const NUM_TOKENS = [
  [/\b(?:volume|vol|v|book|bk)\.?\s*(\d{1,4})\b/i, 'volume'],
  [/\b(?:chapter|chap|ch)\.?\s*(\d{1,4})\b/i, 'issue'],
  [/(?:#|\bno\.?\s*|\bissue\s+)(\d{1,4})\b/i, 'issue'],
];

export function parseFilename(name) {
  const s = name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const yearM = s.match(/(?:^|[\s(\[])((?:19|20)\d{2})(?=[\s)\]]|$)/);
  const year = yearM ? parseInt(yearM[1], 10) : null;
  // drop bracketed/parenthesised scene tags (group, "Digital", "of 04", year…)
  let core = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s+/g, ' ').trim();
  let number = null, kind = 'issue', matched = false;
  for (const [re, k] of NUM_TOKENS) {
    const mm = core.match(re);
    if (mm) {
      number = String(parseInt(mm[1], 10)); kind = k;
      core = core.slice(0, mm.index); // series is what precedes the number; drop any volume subtitle
      matched = true; break;
    }
  }
  if (!matched) {
    const numM = core.match(/(?:^|\s)(\d{1,4})\s*$/); // trailing bare number
    if (numM) { number = String(parseInt(numM[1], 10)); core = core.slice(0, numM.index); }
  }
  // tidy: drop trailing separators/commas/connector words left dangling before the number
  const series = core.replace(/\s+/g, ' ').replace(/[\s,\-–—:;]+$/, '').trim();
  return { source: 'filename', series: series || s, number, year, kind };
}

// ---- merge into one record (priority: ComicInfo > PDF > filename) ----
export function buildMetadata({ comicInfo, pdfInfo, filename }) {
  const fn = parseFilename(filename);
  const ci = comicInfo || {};
  const pdf = pdfInfo || {};
  const series = (ci.series || pdf.title && '' || fn.series || '').trim();
  const number = (ci.number || ci.volume || fn.number || '').toString().trim();
  const kind = ci.volume && !ci.number ? 'volume' : (fn.kind || 'issue');
  const year = ci.year || fn.year || null;
  const creators = (ci.creators && ci.creators.length ? ci.creators : pdf.creators) || [];
  const summary = ci.summary || '';
  const publisher = ci.publisher || '';
  const genres = ci.genres || [];
  const direction = ci.direction || null;
  // display title
  const issueTitle = ci.title || (pdf.title || '');
  let display;
  if (series && number) display = `${series} ${kind === 'volume' ? 'Vol.' : '#'}${number}`;
  else display = (issueTitle || series || fn.series || filename.replace(/\.[^.]+$/, '')).trim();

  return {
    seriesName: series || (issueTitle || fn.series || display),
    number, kind, year, creators, summary, publisher, genres, direction,
    issueTitle, display,
  };
}

// normalised key for grouping volumes of the same series
export const seriesKey = name => (name || '')
  .toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
