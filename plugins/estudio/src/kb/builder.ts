import type { StudyDocument } from '../documents/types.ts';
import { formatPdfAnchor, LINE_BREAK_HYPHEN } from '../documents/citas.ts';
import { newKbId } from './records.ts';
import { AMBITO, AUTHOR } from './repo.ts';
import type { EntityClass, KbEntidad, KbFuenteDerivada, KbFuenteOriginal, KbHecho, KbPregunta, KbSintesis } from './types.ts';
import { nombreEstudiante } from '../identidad.ts';

const common = { clase: 'registro' as const, ambito: AMBITO, autor: AUTHOR, eventos: [] as [] };
const line = (s: string, max = 300) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export interface Built<T> { record: T; body: string }

/** KBOL reads `<clausula>` and `<hecho>` in a body as markup; free text escapes them so a note cannot break validation. */
export const escapeBody = (text: string) => text.replace(/(?<!\\)<(\/?)(clausula|hecho)\b/g, '\\<$1$2');

/** The quote as KBOL compares it: words split at a line break are joined first, as `kbol citas` does, then spaces collapse. */
export const quoteContext = (quote: string) => quote.replace(LINE_BREAK_HYPHEN, '$1$2').replace(/\s+/g, ' ').trim();

/** The PDF of an incorporated paper, identified by its own hash. */
export function fuenteOriginal(doc: StudyDocument, extra: { origen: string; acceso: string }): Built<KbFuenteOriginal> {
  if (doc.status !== 'listo' || !doc.original) throw new Error('Solo se registran documentos ya incorporados');
  const record: KbFuenteOriginal = {
    ...common, id: newKbId('fuente'), type: 'fuente', title: line(doc.title), description: line(`PDF incorporado al estudio (${doc.paginas ?? '?'} páginas).`),
    sources: [], estado: 'registrada', subtipo: 'original', origen: line(extra.origen, 1000),
    ubicacion: `almacen:sha256/${doc.original.sha256}`, formato: 'application/pdf', sha256: doc.original.sha256, acceso: line(extra.acceso, 500),
  };
  return { record, body: escapeBody(`# ${record.title}\n\nPDF original del estudio, en el almacén de Document Intelligence por su huella. Ruta al incorporarlo: \`${doc.path}\`.`) };
}

/** The estructura-v1 representation of a paper's PDF, against which its citations resolve. */
export function fuenteDerivada(doc: StudyDocument, originalId: string, acceso: string): Built<KbFuenteDerivada> {
  if (doc.status !== 'listo' || !doc.estructuraSha256) throw new Error('Solo se registran documentos ya incorporados');
  const contraste = doc.contraste;
  const record: KbFuenteDerivada = {
    ...common, id: newKbId('fuente'), type: 'fuente', title: line(`${doc.title}: estructura`), description: 'Representación estructura-v1 (perfil genérico de kbol-di) contra la que se resuelven las citas.',
    sources: [], estado: 'registrada', subtipo: 'derivada', ubicacion: `almacen:sha256/${doc.estructuraSha256}`, formato: 'application/json',
    sha256: doc.estructuraSha256, acceso: line(acceso, 500), derivada_de: [originalId], procesador: 'kbol-di/generica', version_procesador: '0.2',
    configuracion_ref: 'tools/di de KBOL, perfil generica, orden de lectura corregido', procesado_en: (doc.finishedAt ?? doc.startedAt).replace(/\.\d{3}Z$/, 'Z'),
    procesamiento: 'procesado',
    calidad: {
      contraste_con_pypdf: contraste
        ? { metodo: 'kbol-di contraste: recuerdo y respaldo por página frente a la capa de texto leída con pypdf', resultado: contraste.recuerdo >= 0.98 && contraste.respaldo >= 0.98 ? 'conforme' : 'parcial', limites: `recuerdo ${contraste.recuerdo}, respaldo ${contraste.respaldo}${contraste.paginasSinTexto.length ? `, páginas sin capa de texto: ${contraste.paginasSinTexto.join(', ')}` : ''}` }
        : 'no_evaluado',
      orden_lectura: 'no_evaluado',
    },
  };
  return { record, body: escapeBody(`# ${record.title}\n\nEstructura del PDF \`${originalId}\` producida por Document Intelligence. Revisar: ${doc.revisar.join('; ') || 'nada señalado'}.`) };
}

export function entidad(input: { nombre: string; clase_entidad: EntityClass; alias?: string[]; descripcion?: string }): Built<KbEntidad> {
  const record: KbEntidad = {
    ...common, id: newKbId('entidad'), type: 'entidad', title: line(input.nombre), description: line(input.descripcion || `${input.nombre} (${input.clase_entidad}).`),
    sources: [], estado: 'propuesta', nombre: line(input.nombre), alias: (input.alias ?? []).map(a => line(a)).filter(Boolean), clase_entidad: input.clase_entidad,
  };
  return { record, body: escapeBody(`# ${record.title}`) };
}

export interface FactInput {
  original: string;
  derivada: string;
  /** SHA-256 of the original PDF: `kbol citas` compares the citation hash with the source's own hash. */
  originalSha256: string;
  page: number;
  quote: string;
  afirmacion: string;
  titulo: string;
  fecha: string;
  precision: 'dia' | 'mes' | 'anio';
  entidades: string[];
  origen: 'david' | 'tutor';
}

/** A claim of a paper, with its literal quote at a physical page; the date is that of the paper's statement. */
export function hechoFromQuote(input: FactInput): Built<KbHecho> {
  const record: KbHecho = {
    ...common, id: newKbId('hecho'), type: 'hecho', title: line(input.titulo), description: line(input.afirmacion),
    sources: [{ id: 's1', resource: input.original, representacion_id: input.derivada, hash: input.originalSha256, ancla: formatPdfAnchor(input.page), contexto: quoteContext(input.quote) }],
    estado: 'propuesta', afirmacion: input.afirmacion.trim(), clase_evidencia: 'declarado', precision: input.precision, fecha: input.fecha,
    basada_en: [input.original], ...(input.entidades.length ? { afecta_a: input.entidades } : {}),
  };
  const who = input.origen === 'tutor' ? `Propuesta del tutor, confirmada por ${nombreEstudiante()}.` : `Capturada por ${nombreEstudiante()}.`;
  return { record, body: escapeBody(`# ${record.title}\n\nLo que declara la fuente \`${input.original}\`. ${who}\n\n- \`${formatPdfAnchor(input.page)}\`: «${record.sources[0]!.contexto}»`) };
}

export function pregunta(input: { titulo: string; texto: string; subtipo: 'incognita' | 'discrepancia'; condicionCierre: string; responsable: string; afectaA: string[]; basadaEn: string[] }): Built<KbPregunta> {
  const record: KbPregunta = {
    ...common, id: newKbId('pregunta'), type: 'pregunta', title: line(input.titulo), description: line(input.texto), sources: [], estado: 'abierta',
    subtipo: input.subtipo, responsable: input.responsable, condicion_cierre: line(input.condicionCierre, 1000),
    ...(input.basadaEn.length ? { basada_en: input.basadaEn } : {}), ...(input.afectaA.length ? { afecta_a: input.afectaA } : {}),
  };
  return { record, body: escapeBody(`# ${record.title}\n\n${input.texto.trim()}`) };
}

export function sintesis(input: { titulo: string; texto: string; dependencias: string[] }): Built<KbSintesis> {
  const record: KbSintesis = {
    ...common, id: newKbId('sintesis'), type: 'sintesis', title: line(input.titulo), description: line(input.texto), sources: [], estado: 'borrador',
    dependencias: input.dependencias, evaluaciones: [],
  };
  return { record, body: escapeBody(`# ${record.title}\n\n${input.texto.trim()}`) };
}
