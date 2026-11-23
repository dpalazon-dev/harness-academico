import {
  PLAN_ESTADOS, StudyError, TIPOS_ELEMENTO, UNIT_KINDS, UNIT_POLICIES, UNIT_STATUSES,
  type CambioPlan, type ElementoPlan, type PlanOp, type PlanProposal, type SourceRef, type StudyArea, type StudyPlan, type StudyPreferences,
  type StudyUnit, type SugerenciaUnidad, type UnitOrigin,
} from './types.ts';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

export function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} must be an object`);
  return value as Record<string, unknown>;
}

/** Rejects unknown keys; missing optional keys are allowed. */
export function fields(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  const record = object(value, path);
  for (const key of Object.keys(record)) if (!allowed.includes(key)) invalid(`${path}.${key} is not allowed`);
  return record;
}

export function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID.test(value)) invalid(`${path} must be an id of letters, digits, _ or -`);
  return value;
}

export function text(value: unknown, max: number, path: string, { required = false } = {}): string {
  if (typeof value !== 'string') invalid(`${path} must be text`);
  if (value.length > max) invalid(`${path} exceeds ${max} characters`);
  if (required && value.trim() === '') invalid(`${path} must not be empty`);
  return value;
}

export function instant(value: unknown, path: string): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) invalid(`${path} must be an ISO instant`);
  return value;
}

/** A local calendar date, YYYY-MM-DD, that exists. */
export function fecha(value: unknown, path: string): string {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) invalid(`${path} must be a date YYYY-MM-DD`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) invalid(`${path} must be a date YYYY-MM-DD`);
  return value;
}

function revision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${path} must be a positive integer`);
  return value as number;
}

function member<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`${path} has an unsupported value`);
  return value as T;
}

function nullableMember<T extends string>(value: unknown, allowed: readonly T[], path: string): T | null {
  return value === null ? null : member(value, allowed, path);
}

function list<T>(value: unknown, max: number, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(value)) invalid(`${path} must be a list`);
  if (value.length > max) invalid(`${path} exceeds ${max} items`);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}

function unique(values: string[], path: string): string[] {
  if (new Set(values).size !== values.length) invalid(`${path} contains duplicates`);
  return values;
}

/** A record's space: absent or null in records written before spaces existed. */
export function areaRef(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : id(value, path);
}

export function parseArea(value: unknown): StudyArea {
  const r = fields(value, ['id', 'revision', 'name', 'description', 'archived', 'createdAt', 'updatedAt'], 'area');
  if (typeof r.archived !== 'boolean') invalid('area.archived must be a boolean');
  return {
    id: id(r.id, 'area.id'),
    revision: revision(r.revision, 'area.revision'),
    name: text(r.name, LIMITS.areaName, 'area.name', { required: true }).trim(),
    description: text(r.description, LIMITS.areaDescription, 'area.description'),
    archived: r.archived,
    createdAt: instant(r.createdAt, 'area.createdAt'),
    updatedAt: instant(r.updatedAt, 'area.updatedAt'),
  };
}

export function parsePreferences(value: unknown): StudyPreferences {
  const r = fields(value, ['id', 'revision', 'activeAreaId'], 'preferences');
  if (r.id !== 'estudio') invalid('preferences.id must be estudio');
  return { id: 'estudio', revision: revision(r.revision, 'preferences.revision'), activeAreaId: areaRef(r.activeAreaId, 'preferences.activeAreaId') };
}

export const LIMITS = { areaName: 120, areaDescription: 1000, title: 500, capability: 4000, criterion: 4000, notes: 20000, goal: 4000, rationale: 4000, path: 1000, elementoTitulo: 500, elementos: 100 } as const;

export function parseSource(value: unknown, path: string): SourceRef {
  const r = fields(value, ['path', 'locator'], path);
  const source: SourceRef = { path: text(r.path, LIMITS.path, `${path}.path`, { required: true }) };
  if (r.locator !== undefined) source.locator = text(r.locator, 200, `${path}.locator`);
  return source;
}

function parseOrigin(value: unknown, path: string): UnitOrigin {
  const r = fields(value, ['kind', 'chatId', 'toolCallId', 'strand'], path);
  const origin: UnitOrigin = { kind: member(r.kind, ['sondeo', 'manual', 'tutor'] as const, `${path}.kind`) };
  if (r.chatId !== undefined) origin.chatId = text(r.chatId, 200, `${path}.chatId`, { required: true });
  if (r.toolCallId !== undefined) origin.toolCallId = text(r.toolCallId, 200, `${path}.toolCallId`, { required: true });
  if (r.strand !== undefined) origin.strand = text(r.strand, LIMITS.title, `${path}.strand`);
  return origin;
}

const UNIT_KEYS = ['id', 'revision', 'createdAt', 'updatedAt', 'status', 'title', 'capability', 'criterion', 'kind', 'policy',
  'graphNodeIds', 'sources', 'checkIds', 'origin', 'notes', 'areaId', 'sugerencia'] as const;

function parseSugerencia(value: unknown, path: string): SugerenciaUnidad {
  const r = fields(value, ['capability', 'criterion', 'chatId', 'createdAt'], path);
  return {
    capability: text(r.capability, LIMITS.capability, `${path}.capability`),
    criterion: text(r.criterion, LIMITS.criterion, `${path}.criterion`),
    chatId: text(r.chatId, 200, `${path}.chatId`, { required: true }),
    createdAt: instant(r.createdAt, `${path}.createdAt`),
  };
}

export function parseUnit(value: unknown): StudyUnit {
  const r = fields(value, UNIT_KEYS, 'unit');
  const unit: StudyUnit = {
    id: id(r.id, 'unit.id'),
    revision: revision(r.revision, 'unit.revision'),
    createdAt: instant(r.createdAt, 'unit.createdAt'),
    updatedAt: instant(r.updatedAt, 'unit.updatedAt'),
    status: member(r.status, UNIT_STATUSES, 'unit.status'),
    title: text(r.title, LIMITS.title, 'unit.title', { required: true }),
    capability: text(r.capability, LIMITS.capability, 'unit.capability'),
    criterion: text(r.criterion, LIMITS.criterion, 'unit.criterion'),
    kind: nullableMember(r.kind, UNIT_KINDS, 'unit.kind'),
    policy: nullableMember(r.policy, UNIT_POLICIES, 'unit.policy'),
    graphNodeIds: unique(list(r.graphNodeIds, 500, 'unit.graphNodeIds', (v, p) => text(v, 200, p, { required: true })), 'unit.graphNodeIds'),
    sources: list(r.sources, 100, 'unit.sources', parseSource),
    checkIds: unique(list(r.checkIds, 500, 'unit.checkIds', id), 'unit.checkIds'),
    origin: parseOrigin(r.origin, 'unit.origin'),
    notes: text(r.notes, LIMITS.notes, 'unit.notes'),
    areaId: areaRef(r.areaId, 'unit.areaId'),
  };
  if (r.sugerencia !== undefined) unit.sugerencia = parseSugerencia(r.sugerencia, 'unit.sugerencia');
  return unit;
}

export function elementoTitulo(value: unknown, path: string): string {
  return text(value, LIMITS.elementoTitulo, path, { required: true }).trim();
}

export function parseElemento(value: unknown, path: string): ElementoPlan {
  const r = fields(value, ['id', 'tipo', 'titulo', 'hecho', 'unitId', 'fecha'], path);
  if (typeof r.hecho !== 'boolean') invalid(`${path}.hecho must be a boolean`);
  const elemento: ElementoPlan = {
    id: id(r.id, `${path}.id`), tipo: member(r.tipo, TIPOS_ELEMENTO, `${path}.tipo`),
    titulo: elementoTitulo(r.titulo, `${path}.titulo`), hecho: r.hecho,
  };
  if (r.unitId !== undefined) {
    if (elemento.tipo !== 'tema') invalid(`${path}.unitId is only allowed on a tema`);
    elemento.unitId = id(r.unitId, `${path}.unitId`);
  }
  if (r.fecha !== undefined) {
    if (elemento.tipo !== 'hito') invalid(`${path}.fecha is only allowed on a hito`);
    elemento.fecha = fecha(r.fecha, `${path}.fecha`);
  }
  return elemento;
}

export function parsePlan(value: unknown): StudyPlan {
  const r = fields(value, ['id', 'revision', 'createdAt', 'updatedAt', 'goal', 'estado', 'elementos', 'origen', 'chatId', 'lastAppliedProposalId', 'areaId'], 'plan');
  const plan: StudyPlan = {
    id: id(r.id, 'plan.id'),
    revision: revision(r.revision, 'plan.revision'),
    createdAt: instant(r.createdAt, 'plan.createdAt'),
    updatedAt: instant(r.updatedAt, 'plan.updatedAt'),
    goal: text(r.goal, LIMITS.goal, 'plan.goal', { required: true }),
    estado: member(r.estado, PLAN_ESTADOS, 'plan.estado'),
    elementos: list(r.elementos, LIMITS.elementos, 'plan.elementos', parseElemento),
    origen: member(r.origen, ['tutor', 'manual'] as const, 'plan.origen'),
    areaId: areaRef(r.areaId, 'plan.areaId'),
  };
  unique(plan.elementos.map(e => e.id), 'plan.elementos ids');
  unique(plan.elementos.flatMap(e => e.unitId ? [e.unitId] : []), 'plan.elementos units');
  if (r.chatId !== undefined) plan.chatId = text(r.chatId, 200, 'plan.chatId', { required: true });
  if (r.lastAppliedProposalId !== undefined) plan.lastAppliedProposalId = id(r.lastAppliedProposalId, 'plan.lastAppliedProposalId');
  return plan;
}

function parseAdd(r: Record<string, unknown>, path: string): PlanOp {
  fields(r, ['op', 'tipo', 'titulo', 'fecha', 'index'], path);
  const tipo = member(r.tipo, TIPOS_ELEMENTO, `${path}.tipo`);
  const op: PlanOp = { op: 'add', tipo, titulo: elementoTitulo(r.titulo, `${path}.titulo`) };
  if (r.fecha !== undefined && r.fecha !== null) {
    if (tipo !== 'hito') invalid(`${path}.fecha is only allowed on a hito`);
    op.fecha = fecha(r.fecha, `${path}.fecha`);
  }
  if (r.index !== undefined) op.index = index(r.index, `${path}.index`);
  return op;
}

export function parsePlanOp(value: unknown, path: string): PlanOp {
  const r = object(value, path);
  switch (r.op) {
    case 'add': return parseAdd(r, path);
    case 'remove':
      fields(r, ['op', 'elementoId'], path);
      return { op: 'remove', elementoId: id(r.elementoId, `${path}.elementoId`) };
    case 'move':
      fields(r, ['op', 'elementoId', 'index'], path);
      return { op: 'move', elementoId: id(r.elementoId, `${path}.elementoId`), index: index(r.index, `${path}.index`) };
    default: return invalid(`${path}.op must be add, remove or move`);
  }
}

/** David's direct edits: the proposal ops plus `edit`. */
export function parseCambioPlan(value: unknown, path: string): CambioPlan {
  const r = object(value, path);
  if (r.op !== 'edit') return parsePlanOp(r, path);
  fields(r, ['op', 'elementoId', 'titulo', 'hecho', 'fecha'], path);
  const op: CambioPlan = { op: 'edit', elementoId: id(r.elementoId, `${path}.elementoId`) };
  if (r.titulo !== undefined) op.titulo = elementoTitulo(r.titulo, `${path}.titulo`);
  if (r.hecho !== undefined) {
    if (typeof r.hecho !== 'boolean') invalid(`${path}.hecho must be a boolean`);
    op.hecho = r.hecho;
  }
  if (r.fecha !== undefined) op.fecha = r.fecha === null ? null : fecha(r.fecha, `${path}.fecha`);
  return op;
}

function index(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${path} must be a non-negative integer`);
  return value as number;
}

export function parseProposal(value: unknown): PlanProposal {
  const r = fields(value, ['id', 'revision', 'planId', 'baseRevision', 'ops', 'rationale', 'author', 'status', 'createdAt', 'decidedAt'], 'proposal');
  const proposal: PlanProposal = {
    id: id(r.id, 'proposal.id'),
    revision: revision(r.revision, 'proposal.revision'),
    planId: id(r.planId, 'proposal.planId'),
    baseRevision: revision(r.baseRevision, 'proposal.baseRevision'),
    ops: list(r.ops, 100, 'proposal.ops', parsePlanOp),
    rationale: text(r.rationale, LIMITS.rationale, 'proposal.rationale'),
    author: member(r.author, ['tutor', 'david'] as const, 'proposal.author'),
    status: member(r.status, ['pendiente', 'aplicada', 'rechazada', 'obsoleta'] as const, 'proposal.status'),
    createdAt: instant(r.createdAt, 'proposal.createdAt'),
  };
  if (proposal.ops.length === 0) invalid('proposal.ops must not be empty');
  if (r.decidedAt !== undefined) proposal.decidedAt = instant(r.decidedAt, 'proposal.decidedAt');
  return proposal;
}
