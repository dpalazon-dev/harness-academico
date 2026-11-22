import { areaRef, fields, id, text } from '../study/schema.ts';
import { StudyError } from '../study/types.ts';
import type { StudyDocument } from './types.ts';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const SHA = /^[0-9a-f]{64}$/;

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }
const instant = (v: unknown, p: string) => (typeof v === 'string' && INSTANT.test(v) ? v : invalid(`${p} must be an ISO instant`));
const sha = (v: unknown, p: string) => (typeof v === 'string' && SHA.test(v) ? v : invalid(`${p} must be a SHA-256`));
const nullable = <T>(v: unknown, f: (v: unknown) => T): T | null => (v === null ? null : f(v));
const number = (v: unknown, p: string) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : invalid(`${p} must be a non-negative number`));

export function parseDocument(value: unknown): StudyDocument {
  const r = fields(value, ['id', 'revision', 'title', 'path', 'status', 'error', 'startedAt', 'finishedAt', 'original', 'doclingSha256',
    'estructuraSha256', 'paginas', 'contraste', 'revisar', 'areaId'], 'document');
  if (!['procesando', 'listo', 'error'].includes(r.status as string)) invalid('document.status has an unsupported value');
  if (!Array.isArray(r.revisar)) invalid('document.revisar must be a list');
  const doc: StudyDocument = {
    id: id(r.id, 'document.id'),
    revision: number(r.revision, 'document.revision'),
    title: text(r.title, 500, 'document.title', { required: true }),
    path: text(r.path, 2000, 'document.path', { required: true }),
    status: r.status as StudyDocument['status'],
    error: nullable(r.error, v => text(v, 4000, 'document.error')),
    startedAt: instant(r.startedAt, 'document.startedAt'),
    finishedAt: nullable(r.finishedAt, v => instant(v, 'document.finishedAt')),
    original: nullable(r.original, v => {
      const o = fields(v, ['sha256', 'bytes'], 'document.original');
      return { sha256: sha(o.sha256, 'document.original.sha256'), bytes: number(o.bytes, 'document.original.bytes') };
    }),
    doclingSha256: nullable(r.doclingSha256, v => sha(v, 'document.doclingSha256')),
    estructuraSha256: nullable(r.estructuraSha256, v => sha(v, 'document.estructuraSha256')),
    paginas: nullable(r.paginas, v => number(v, 'document.paginas')),
    contraste: nullable(r.contraste, v => {
      const c = fields(v, ['recuerdo', 'respaldo', 'paginasSinTexto'], 'document.contraste');
      if (!Array.isArray(c.paginasSinTexto)) invalid('document.contraste.paginasSinTexto must be a list');
      return { recuerdo: number(c.recuerdo, 'recuerdo'), respaldo: number(c.respaldo, 'respaldo'), paginasSinTexto: c.paginasSinTexto.map(p => number(p, 'pagina')) };
    }),
    revisar: r.revisar.map((x, i) => text(x, 2000, `document.revisar[${i}]`)),
    areaId: areaRef(r.areaId, 'document.areaId'),
  };
  if (doc.status === 'listo' && (doc.original === null || doc.estructuraSha256 === null)) invalid('a ready document needs its original and structure hashes');
  return doc;
}
