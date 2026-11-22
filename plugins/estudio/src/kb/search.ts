/* Lexical retrieval over the knowledge base and the incorporated papers. KB-DPP order: filter by id and entity,
 * bounded lexical search, one-hop expansion along relations, and a declared coverage. Embeddings only if the
 * evaluation bench shows lexical search falls short. */

const STOPWORDS = new Set((
  'de la el los las un una unos unas y o u a en por para con sin sobre entre del al lo que se su sus es son como mas pero ' +
  'este esta estos estas ese esa eso no si ya muy tambien cuando donde cual cuales quien hay ha han fue ser sido le les me mi nos ' +
  'the of and or an to in on for with by from at as is are was were be been this that these those it its into than then not no ' +
  'we our they their which can may also such using use used based via'
).split(' '));

/** Lowercase, accents folded, words of two or more letters or digits, stopwords removed (Spanish and English). */
export function tokenize(text: string): string[] {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

export interface SearchDoc {
  /** Record id, or `documento:<id>#<clave>` for a paper section. */
  id: string;
  kind: string;
  title: string;
  text: string;
  locator?: string;
  /** Ids this item points to (basada_en, afecta_a, dependencias, derivada_de). */
  links: string[];
  /** An entity's name and aliases: paper sections that mention one of them count as linked to it. */
  names?: string[];
}

export interface Hit { id: string; kind: string; title: string; score: number; locator?: string; snippet: string; via?: string }
export interface SearchResult {
  hits: Hit[];
  relacionados: Hit[];
  cobertura: { registros: number; secciones: number; conversaciones: number; notas: number; documentosNoListos: number; coincidencias: number; truncado: boolean };
  vacio: 'base_vacia' | 'consulta_vacia' | 'sin_coincidencias' | null;
}

const K1 = 1.2, B = 0.75;

export interface SearchIndex {
  docs: SearchDoc[];
  tf: Map<string, number>[];
  lengths: number[];
  df: Map<string, number>;
  avgLength: number;
  documentosNoListos: number;
}

export function buildIndex(docs: SearchDoc[], documentosNoListos = 0): SearchIndex {
  const tf: Map<string, number>[] = [], lengths: number[] = [], df = new Map<string, number>();
  for (const d of docs) {
    const tokens = tokenize(`${d.title} ${d.title} ${d.text}`);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(counts);
    lengths.push(tokens.length);
  }
  const avgLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  return { docs, tf, lengths, df, avgLength, documentosNoListos };
}

function snippet(text: string, terms: Set<string>, width = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const words = flat.split(' ');
  const at = words.findIndex(w => tokenize(w).some(t => terms.has(t)));
  if (at === -1) return flat.slice(0, width);
  const start = Math.max(0, at - 8);
  const piece = words.slice(start).join(' ');
  return `${start > 0 ? '…' : ''}${piece.slice(0, width)}${piece.length > width ? '…' : ''}`;
}

export interface SearchOptions { k?: number; entidad?: string; tipos?: string[] }

export function search(index: SearchIndex, query: string, options: SearchOptions = {}): SearchResult {
  const k = Math.max(1, Math.min(options.k ?? 8, 50));
  const secciones = index.docs.filter(d => d.id.startsWith('documento:')).length;
  const conversaciones = index.docs.filter(d => d.id.startsWith('conversacion:')).length;
  const notas = index.docs.filter(d => d.id.startsWith('cuaderno:')).length;
  const cobertura = { registros: index.docs.length - secciones - conversaciones - notas, secciones, conversaciones, notas, documentosNoListos: index.documentosNoListos, coincidencias: 0, truncado: false };
  if (index.docs.length === 0) return { hits: [], relacionados: [], cobertura, vacio: 'base_vacia' };

  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 && !options.entidad) return { hits: [], relacionados: [], cobertura, vacio: 'consulta_vacia' };
  const termSet = new Set(terms);
  const byId = new Map(index.docs.map((d, i) => [d.id, i]));
  let candidates = index.docs.map((_, i) => i);
  if (options.entidad) {
    // Records link to the entity explicitly; paper sections have no links, so they count when they mention its name or an alias.
    const entity = index.docs[byId.get(options.entidad) ?? -1];
    const names = (entity?.names ?? []).map(n => tokenize(n)).filter(t => t.length > 0);
    const mentions = (i: number) => index.docs[i]!.id.startsWith('documento:') && names.some(n => n.every(t => index.tf[i]!.has(t)));
    candidates = candidates.filter(i => index.docs[i]!.id === options.entidad || index.docs[i]!.links.includes(options.entidad!) || mentions(i));
  }
  if (options.tipos?.length) candidates = candidates.filter(i => options.tipos!.includes(index.docs[i]!.kind));

  const n = index.docs.length;
  const scored = candidates.map(i => {
    let score = 0;
    for (const t of terms) {
      const f = index.tf[i]!.get(t);
      if (!f) continue;
      const df = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * index.lengths[i]! / (index.avgLength || 1)));
    }
    // With an entity filter and no query terms, every linked item is relevant.
    if (terms.length === 0 && options.entidad) score = 1;
    return { i, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || index.docs[a.i]!.id.localeCompare(index.docs[b.i]!.id));

  cobertura.coincidencias = scored.length;
  cobertura.truncado = scored.length > k;
  const toHit = (i: number, score: number, via?: string): Hit => {
    const d = index.docs[i]!;
    return { id: d.id, kind: d.kind, title: d.title, score: Math.round(score * 1000) / 1000, ...(d.locator ? { locator: d.locator } : {}), snippet: snippet(d.text, termSet), ...(via ? { via } : {}) };
  };
  const hits = scored.slice(0, k).map(s => toHit(s.i, s.score));

  // One hop along relations, both directions, marked with the hit that led to it.
  const seen = new Set(hits.map(h => h.id));
  const relacionados: Hit[] = [];
  for (const h of hits) {
    const i = byId.get(h.id)!;
    const out = index.docs[i]!.links.map(id => byId.get(id)).filter((x): x is number => x !== undefined);
    const incoming = index.docs.map((d, j) => (d.links.includes(h.id) ? j : -1)).filter(j => j >= 0);
    for (const j of [...out, ...incoming]) {
      const d = index.docs[j]!;
      if (seen.has(d.id) || d.id.startsWith('documento:')) continue;
      seen.add(d.id);
      relacionados.push(toHit(j, h.score / 2, h.id));
    }
  }
  if (relacionados.length > k) cobertura.truncado = true;
  return { hits, relacionados: relacionados.slice(0, k), cobertura, vacio: hits.length === 0 ? 'sin_coincidencias' : null };
}
