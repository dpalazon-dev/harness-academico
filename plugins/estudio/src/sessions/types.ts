import { areaRef, fields, id, text } from '../study/schema.ts';
import { StudyError } from '../study/types.ts';

/** What a conversation left behind, written by the cheap model from its transcript. */
export interface ConversationSummary {
  tema: string;
  trabajado: string[];
  claro: string[];
  abierto: string[];
  siguiente: string;
}

/** Where a conversation was opened from: a unit, a passage of the reader, an attempt, or nowhere in particular. */
export const ORIGENES = ['unidad', 'pasaje', 'intento', 'libre'] as const;
export type Origen = typeof ORIGENES[number];

/** The plugin's own record of a native conversation, keyed by its chat id. */
export interface ConversationRecord {
  id: string;
  revision: number;
  /** Snapshot handed to the tutor on the conversation's first turn, frozen for the rest of it. */
  briefing: string | null;
  briefedAt: string | null;
  summary: ConversationSummary | null;
  /** The chat's `updatedAt` the summary was built from; a later one makes it stale. */
  summaryOf: string | null;
  summarizedAt: string | null;
  summaryError: string | null;
  /** Space the conversation belongs to: the one it was opened in from a unit, passage or attempt, otherwise the one
   * active when the briefing was composed; null for «Todos» or conversations older than spaces. */
  areaId: string | null;
  /** Unit the conversation was opened about (its study context), or null. */
  unitId: string | null;
  /** Written when the conversation is created; null in records older than it, which are never rewritten for it. */
  origen: Origen | null;
}

export interface LinkedItem { id: string; title: string; kind: string }

/** A conversation as the view and the briefing see it. */
export interface ConversationView {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary: ConversationSummary | null;
  summaryStale: boolean;
  summaryError: string | null;
  links: LinkedItem[];
  areaId: string | null;
  unitId: string | null;
  /** The recorded origin; without one, `unidad` if the conversation has a unit and `libre` otherwise. */
  origen: Origen;
}

const LIMIT = { tema: 300, item: 500, items: 8 };

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

const nullableText = (v: unknown, max: number, path: string) => (v === null ? null : text(v, max, path));

function list(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(`${path} must be a list`);
  return value.slice(0, LIMIT.items).map((x, i) => text(x, LIMIT.item, `${path}[${i}]`).trim()).filter(Boolean);
}

/** Validates a summary from storage or from the model; overlong lists are cut, not refused. */
export function parseSummary(value: unknown): ConversationSummary {
  const r = fields(value, ['tema', 'trabajado', 'claro', 'abierto', 'siguiente'], 'summary');
  return {
    tema: text(r.tema, LIMIT.tema, 'summary.tema', { required: true }).trim(),
    trabajado: list(r.trabajado, 'summary.trabajado'),
    claro: list(r.claro, 'summary.claro'),
    abierto: list(r.abierto, 'summary.abierto'),
    siguiente: text(r.siguiente, LIMIT.item, 'summary.siguiente').trim(),
  };
}

export function parseConversation(value: unknown): ConversationRecord {
  const r = fields(value, ['id', 'revision', 'briefing', 'briefedAt', 'summary', 'summaryOf', 'summarizedAt', 'summaryError', 'areaId', 'unitId', 'origen'], 'conversation');
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) invalid('conversation.revision must be a positive integer');
  return {
    id: id(r.id, 'conversation.id'), revision: r.revision as number,
    briefing: nullableText(r.briefing, 20000, 'conversation.briefing'), briefedAt: nullableText(r.briefedAt, 40, 'conversation.briefedAt'),
    summary: r.summary === null ? null : parseSummary(r.summary),
    summaryOf: nullableText(r.summaryOf, 40, 'conversation.summaryOf'), summarizedAt: nullableText(r.summarizedAt, 40, 'conversation.summarizedAt'),
    summaryError: nullableText(r.summaryError, 1000, 'conversation.summaryError'),
    areaId: areaRef(r.areaId, 'conversation.areaId'),
    // Records older than study contexts have no unit.
    unitId: r.unitId === undefined || r.unitId === null ? null : id(r.unitId, 'conversation.unitId'),
    origen: r.origen === undefined || r.origen === null ? null : origen(r.origen),
  };
}

function origen(value: unknown): Origen {
  if (!ORIGENES.includes(value as Origen)) invalid(`conversation.origen must be one of ${ORIGENES.join(', ')}`);
  return value as Origen;
}

/** Records older than the origin are read, not migrated: by their unit if they have one. */
export const origenDe = (record: Pick<ConversationRecord, 'origen' | 'unitId'> | undefined): Origen =>
  record?.origen ?? (record?.unitId ? 'unidad' : 'libre');

export const emptyConversation = (chatId: string): ConversationRecord => ({
  id: chatId, revision: 0, briefing: null, briefedAt: null, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId: null, unitId: null, origen: null,
});
