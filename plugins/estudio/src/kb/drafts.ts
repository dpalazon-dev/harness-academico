import { fields, id, text } from '../study/schema.ts';
import { StudyError } from '../study/types.ts';
import type { KbRecord } from './types.ts';

/** Knowledge waiting for David: nothing reaches the KBOL repository until he confirms it. */
export interface KbDraft {
  id: string;
  revision: number;
  kind: 'hecho' | 'pregunta' | 'sintesis';
  summary: string;
  origin: 'david' | 'tutor';
  records: { record: KbRecord; body: string }[];
  status: 'pendiente' | 'confirmado' | 'descartado';
  createdAt: string;
  commit: string | null;
}

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

export function parseDraft(value: unknown): KbDraft {
  const r = fields(value, ['id', 'revision', 'kind', 'summary', 'origin', 'records', 'status', 'createdAt', 'commit'], 'draft');
  if (!['hecho', 'pregunta', 'sintesis'].includes(r.kind as string)) invalid('draft.kind has an unsupported value');
  if (!['david', 'tutor'].includes(r.origin as string)) invalid('draft.origin has an unsupported value');
  if (!['pendiente', 'confirmado', 'descartado'].includes(r.status as string)) invalid('draft.status has an unsupported value');
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) invalid('draft.revision must be a positive integer');
  if (!Array.isArray(r.records) || r.records.length === 0) invalid('draft.records must be a non-empty list');
  const records = r.records.map((x, i) => {
    const e = fields(x, ['record', 'body'], `draft.records[${i}]`);
    const record = e.record as { id?: unknown; type?: unknown };
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || typeof record.type !== 'string') invalid(`draft.records[${i}].record must be a KBOL record`);
    return { record: e.record as KbRecord, body: text(e.body, 100000, `draft.records[${i}].body`) };
  });
  if (typeof r.createdAt !== 'string') invalid('draft.createdAt must be an instant');
  return {
    id: id(r.id, 'draft.id'), revision: r.revision as number, kind: r.kind as KbDraft['kind'], summary: text(r.summary, 1000, 'draft.summary'),
    origin: r.origin as KbDraft['origin'], records, status: r.status as KbDraft['status'], createdAt: r.createdAt,
    commit: r.commit === null ? null : text(r.commit, 40, 'draft.commit'),
  };
}
