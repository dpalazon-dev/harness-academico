/* La búsqueda de ⌘K (ticket 08, historias 12 y 47): busca con el índice que ya existe (`kb/search.ts`) en el
 * conocimiento confirmado, el texto de los documentos con su página, las notas y las conversaciones, y devuelve los
 * resultados agrupados por tipo, cada uno con su destino. Documentos, notas y conversaciones son del espacio activo;
 * los registros de la base no tienen espacio y salen siempre. El armazón decide la pantalla de cada destino. */
import { parsePdfAnchor } from './documents/citas.ts';
import { fields } from './study/schema.ts';
import { inArea, type AreaFilter } from './study/areas.ts';
import type { StudyStore } from './study/store.ts';
import type { KbSource } from './kb/types.ts';
import type { Hit, SearchOptions, SearchResult } from './kb/search.ts';

export type TipoResultado = 'conocimiento' | 'documento' | 'nota' | 'conversacion';
export const TIPOS_RESULTADO: readonly TipoResultado[] = ['conocimiento', 'documento', 'nota', 'conversacion'];

export type DestinoPaleta =
  | { tipo: 'documento'; documentId: string; pagina: number | null }
  | { tipo: 'unidad'; unitId: string }
  /** Un cuaderno sin unidad ni documento: hasta que Cuadernos sea página del armazón (ticket 09), no tiene otro sitio. */
  | { tipo: 'cuaderno'; notebookId: string }
  | { tipo: 'conversacion'; chatId: string };

export interface ResultadoPaleta {
  id: string;
  titulo: string;
  fragmento: string;
  /** Página del documento, si la tiene. */
  pagina: number | null;
  /** Null si no hay adónde ir: un registro de la base sin cita en un documento incorporado. */
  destino: DestinoPaleta | null;
}

export interface BusquedaPaleta {
  grupos: { tipo: TipoResultado; resultados: ResultadoPaleta[] }[];
  vacio: SearchResult['vacio'];
}

/** Resultados que pide al índice: el filtro por espacio se aplica después y no debe dejar grupos vacíos. */
const CANDIDATOS = 50;
const POR_GRUPO = 6;
const CONSULTA_MAX = 300;

export interface PaletaDeps {
  search(query: string, options?: SearchOptions): SearchResult;
  store: StudyStore;
  /** Las conversaciones del espacio, como las lista la barra lateral. */
  conversaciones(filtro: AreaFilter): { id: string }[];
  /** Cabecera de un registro de la base por id, para seguir su cita. */
  registro(id: string): Record<string, unknown> | null;
}

const tipoDe = (id: string): TipoResultado =>
  id.startsWith('documento:') ? 'documento' : id.startsWith('cuaderno:') ? 'nota' : id.startsWith('conversacion:') ? 'conversacion' : 'conocimiento';

const paginaDe = (localizador: string | undefined | null): number | null => (localizador ? parsePdfAnchor(localizador)?.p ?? null : null);

export function createPaleta(deps: PaletaDeps) {
  const { store } = deps;

  /** Un hecho lleva a la página citada del documento incorporado cuyo original es el de la cita. */
  function destinoDeRegistro(id: string): { destino: DestinoPaleta; pagina: number | null } | null {
    const header = deps.registro(id);
    const fuente = (header?.sources as KbSource[] | undefined)?.find(s => s.hash && s.ancla);
    if (!fuente) return null;
    const doc = store.listDocuments().find(d => d.status === 'listo' && d.original?.sha256 === fuente.hash);
    if (!doc) return null;
    const pagina = paginaDe(fuente.ancla);
    return { destino: { tipo: 'documento', documentId: doc.id, pagina }, pagina };
  }

  /** El destino de un resultado, o undefined si no es del espacio activo y no se muestra. */
  function resolver(hit: Hit, filtro: AreaFilter, chats: Set<string>): ResultadoPaleta | undefined {
    const base = { id: hit.id, titulo: hit.title, fragmento: hit.snippet };
    switch (tipoDe(hit.id)) {
      case 'documento': {
        const documentId = hit.id.slice('documento:'.length).split('#')[0]!;
        const doc = store.getDocument(documentId);
        if (!doc || !inArea(doc, filtro)) return undefined;
        const pagina = paginaDe(hit.locator);
        return { ...base, pagina, destino: { tipo: 'documento', documentId, pagina } };
      }
      case 'nota': {
        const nb = store.getNotebook(hit.id.slice('cuaderno:'.length));
        if (!nb || !inArea(nb, filtro)) return undefined;
        const destino: DestinoPaleta = nb.unitId ? { tipo: 'unidad', unitId: nb.unitId }
          : nb.documentId ? { tipo: 'documento', documentId: nb.documentId, pagina: null }
          : { tipo: 'cuaderno', notebookId: nb.id };
        return { ...base, pagina: null, destino };
      }
      case 'conversacion': {
        const chatId = hit.id.slice('conversacion:'.length);
        if (!chats.has(chatId)) return undefined;
        return { ...base, pagina: null, destino: { tipo: 'conversacion', chatId } };
      }
      case 'conocimiento': {
        const cita = destinoDeRegistro(hit.id);
        return { ...base, pagina: cita?.pagina ?? null, destino: cita?.destino ?? null };
      }
    }
  }

  return function buscar(input: unknown, filtro: AreaFilter): BusquedaPaleta {
    const r = fields(input, ['consulta', 'tipos'], 'input');
    const consulta = typeof r.consulta === 'string' ? r.consulta.slice(0, CONSULTA_MAX) : '';
    const tipos = Array.isArray(r.tipos) ? TIPOS_RESULTADO.filter(t => (r.tipos as unknown[]).includes(t)) : [...TIPOS_RESULTADO];
    if (consulta.trim() === '') return { grupos: [], vacio: 'consulta_vacia' };
    // Solo conversaciones (⌘⇧F): el índice filtra por su tipo y no gasta los candidatos en el resto.
    const soloConversaciones = tipos.length === 1 && tipos[0] === 'conversacion';
    const result = deps.search(consulta, { k: CANDIDATOS, ...(soloConversaciones ? { tipos: ['conversacion'] } : {}) });
    const chats = new Set(deps.conversaciones(filtro).map(c => c.id));
    const porTipo = new Map<TipoResultado, ResultadoPaleta[]>();
    for (const hit of result.hits) {
      const tipo = tipoDe(hit.id);
      if (!tipos.includes(tipo)) continue;
      const lista = porTipo.get(tipo) ?? [];
      if (lista.length >= POR_GRUPO) continue;
      const resultado = resolver(hit, filtro, chats);
      if (resultado) porTipo.set(tipo, [...lista, resultado]);
    }
    const grupos = TIPOS_RESULTADO.filter(t => porTipo.has(t)).map(tipo => ({ tipo, resultados: porTipo.get(tipo)! }));
    return { grupos, vacio: result.vacio === 'base_vacia' ? 'base_vacia' : grupos.length === 0 ? 'sin_coincidencias' : null };
  };
}
