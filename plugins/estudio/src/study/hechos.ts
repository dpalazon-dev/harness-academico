import { fields, id, instant, text } from './schema.ts';
import { StudyError } from './types.ts';

/** Hechos del ciclo (ADR 0004): constancia, con fecha, de que algo del ciclo ocurrió en una unidad. Junto con la
 * evidencia de práctica es de donde salen el estado de los grupos y el paso propuesto. Un registro por unidad, con su
 * id; una unidad sin registro no tiene hechos (nada se migra). */

/** «Lo que sabía antes»: qué sabe, cree, no sabe y se pregunta, escrito por David sin IA, en la página de la unidad
 * o como respuesta a la petición del sondeador. */
export interface HechoVolcado { tipo: 'volcado'; fecha: string; texto: string; origen: 'pagina' | 'sondeo'; chatId: string | null }
/** Se cerró el lector de una fuente de la unidad con capturas nuevas: queda pendiente reconstruirla. */
export interface HechoFuenteTrabajada { tipo: 'fuente-trabajada'; fecha: string; documentoId: string; capturas: number }
/** Reconstrucción sin mirar al terminar un bloque de trabajo, con contraste, reparación, Δ y dudas. */
export interface HechoCierreBloque { tipo: 'cierre-bloque'; fecha: string; chatId: string | null }
export type HechoCiclo = HechoVolcado | HechoFuenteTrabajada | HechoCierreBloque;

export interface HechosUnidad { id: string; revision: number; hechos: HechoCiclo[] }

export const VOLCADO_MAX = 20000;
const MAX_HECHOS = 5000;
const MAX_CAPTURAS = 10000;

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

const chatRef = (value: unknown, path: string) => (value === undefined || value === null ? null : id(value, path));

export function capturas(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_CAPTURAS) invalid(`${path} must be an integer from 1 to ${MAX_CAPTURAS}`);
  return value as number;
}

function parseHecho(value: unknown, path: string): HechoCiclo {
  const r = fields(value, ['tipo', 'fecha', 'texto', 'origen', 'chatId', 'documentoId', 'capturas'], path);
  const fecha = instant(r.fecha, `${path}.fecha`);
  if (r.tipo === 'volcado') {
    if (r.origen !== 'pagina' && r.origen !== 'sondeo') invalid(`${path}.origen has an unsupported value`);
    return { tipo: 'volcado', fecha, texto: text(r.texto, VOLCADO_MAX, `${path}.texto`, { required: true }), origen: r.origen, chatId: chatRef(r.chatId, `${path}.chatId`) };
  }
  if (r.tipo === 'fuente-trabajada') return { tipo: 'fuente-trabajada', fecha, documentoId: id(r.documentoId, `${path}.documentoId`), capturas: capturas(r.capturas, `${path}.capturas`) };
  if (r.tipo === 'cierre-bloque') return { tipo: 'cierre-bloque', fecha, chatId: chatRef(r.chatId, `${path}.chatId`) };
  return invalid(`${path}.tipo has an unsupported value`);
}

export function parseHechos(value: unknown): HechosUnidad {
  const r = fields(value, ['id', 'revision', 'hechos'], 'hechos');
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) invalid('hechos.revision must be a positive integer');
  if (!Array.isArray(r.hechos) || r.hechos.length > MAX_HECHOS) invalid(`hechos.hechos must be a list of at most ${MAX_HECHOS} facts`);
  return { id: id(r.id, 'hechos.id'), revision: r.revision as number, hechos: r.hechos.map((h, i) => parseHecho(h, `hechos.hechos[${i}]`)) };
}

/** El volcado de la unidad: el primero, porque es «lo que sabía antes». */
export const volcadoDe = (hechos: readonly HechoCiclo[]): HechoVolcado | null =>
  hechos.find((h): h is HechoVolcado => h.tipo === 'volcado') ?? null;
