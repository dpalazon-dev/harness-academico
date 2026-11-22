import { readEstructura } from '../documents/almacen.ts';
import { unitKind } from '../documents/estructura.ts';
import { formatPdfAnchor } from '../documents/citas.ts';
import type { StudyDocument } from '../documents/types.ts';
import type { StoredRecord } from './repo.ts';
import { buildIndex, search, type SearchIndex, type SearchOptions, type SearchResult, type SearchDoc } from './search.ts';

const LINKS = ['basada_en', 'afecta_a', 'dependencias', 'derivada_de'] as const;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function recordDoc(r: StoredRecord): SearchDoc {
  const h = r.header;
  const text = [h.description, h.afirmacion, h.nombre, ...list(h.alias), h.clase_entidad, h.condicion_cierre, r.body].map(str).filter(Boolean).join('\n');
  return {
    id: str(h.id), kind: str(h.type), title: str(h.title), text, links: LINKS.flatMap(k => list(h[k])),
    ...(h.type === 'entidad' ? { names: [str(h.nombre), ...list(h.alias)].filter(Boolean) } : {}),
  };
}

/** Every unit of a ready paper is searchable with its physical page, so a hit can be cited and opened. */
export function sectionDocs(doc: StudyDocument, almacen: string): SearchDoc[] {
  const estructura = readEstructura(almacen, doc.estructuraSha256!);
  return estructura.unidades.filter(u => u.texto.trim() !== '').map(u => ({
    id: `documento:${doc.id}#${u.clave}`,
    kind: unitKind(u.clave),
    title: [doc.title, ...(u.ruta ?? []), u.leyenda ?? ''].filter(Boolean).join(' › '),
    text: u.texto,
    locator: formatPdfAnchor(u.paginas[0] ?? 1),
    links: [],
  }));
}

export interface KbSearch {
  search(query: string, options?: SearchOptions): SearchResult;
  /** Drop the cached index after any write to the base or a finished incorporation. */
  invalidate(): void;
}

export function createKbSearch(sources: { records: () => StoredRecord[]; documents: () => StudyDocument[]; almacen: string; conversations?: () => SearchDoc[]; notebooks?: () => SearchDoc[] }): KbSearch {
  let index: SearchIndex | null = null;
  function build(): SearchIndex {
    const docs: SearchDoc[] = sources.records().filter(r => r.header.type !== 'persona' && r.header.type !== 'rol').map(recordDoc);
    let notReady = 0;
    for (const d of sources.documents()) {
      if (d.status !== 'listo') { notReady++; continue; }
      try { docs.push(...sectionDocs(d, sources.almacen)); } catch { notReady++; }
    }
    // Conversations are searchable like records; reading them must not cost the rest of the index.
    try { docs.push(...(sources.conversations?.() ?? [])); } catch { /* the base and papers stay searchable */ }
    try { docs.push(...(sources.notebooks?.() ?? [])); } catch { /* David's notes are lost from search, not the rest */ }
    return buildIndex(docs, notReady);
  }
  return {
    search(query, options) { index ??= build(); return search(index, query, options); },
    invalidate() { index = null; },
  };
}
