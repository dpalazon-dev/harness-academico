import { randomUUID } from 'node:crypto';
import { applyOps, applyProposal, rejectProposal, staleReason } from './study/proposals.ts';
import { fields, id, LIMITS, parseCambioPlan, parsePlanOp, parseSource, text } from './study/schema.ts';
import type { StudyStore } from './study/store.ts';
import { inArea, type AreaFilter } from './study/areas.ts';
import {
  PLAN_ESTADOS, StudyError, UNIT_KINDS, UNIT_POLICIES,
  type PlanEstado, type PlanProposal, type StudyPlan, type StudyUnit, type UnitKind, type UnitOrigin, type UnitPolicy,
} from './study/types.ts';

export interface StudyState { plans: StudyPlan[]; units: StudyUnit[]; proposals: PlanProposal[] }

export interface StudyOperations {
  /** Plans, units and proposals of one space, or of all when the filter is null. */
  state(filter?: AreaFilter): StudyState;
  /** Plans of the space that are not archived: proposed and active, the most recently updated first. */
  plans(filter?: AreaFilter): StudyPlan[];
  /** The plan that is not archived and has a tema linked to the unit, or null. */
  planOfUnit(unitId: string): StudyPlan | null;
  /** An empty active plan written by David. */
  createPlan(input: unknown, areaId?: string | null): StudyPlan;
  /** A whole plan drafted by the tutor, `propuesto` until David accepts or discards it. */
  proposePlan(input: unknown, chatId: string, areaId?: string | null): StudyPlan;
  /** Goal, or archiving and unarchiving; a proposed plan is accepted or discarded instead. */
  editPlan(input: unknown): StudyPlan;
  acceptPlan(input: unknown): StudyPlan;
  /** A proposed plan goes to the bin; nothing else of it existed yet. */
  discardPlan(input: unknown): void;
  /** David's own edits to the elements, applied at once. */
  changePlan(input: unknown): StudyPlan;
  /** Turns a tema into an active unit with its title and links them; a tema with a unit returns it. */
  workOnTema(input: unknown): StudyUnit;
  createUnit(input: unknown, origin?: UnitOrigin, status?: 'propuesta' | 'activa', areaId?: string | null): StudyUnit;
  editUnit(input: unknown): StudyUnit;
  confirmUnit(input: unknown): StudyUnit;
  archiveUnit(input: unknown): StudyUnit;
  /** Adds a source to a unit; adding the same path and locator again changes nothing. */
  addSource(unitId: string, expectedRevision: unknown, source: unknown): StudyUnit;
  /** A change the tutor suggests for an active plan. */
  proposePlanChange(input: unknown): PlanProposal;
  applyProposal(input: unknown): StudyPlan;
  rejectProposal(input: unknown): PlanProposal;
  /** Why a pending proposal can no longer be applied, in words for David; null when it still can. */
  staleReason(proposal: PlanProposal): string | null;
  /** The tutor's capability and criterion for a unit; a new one replaces the previous. */
  suggestCapability(unitId: unknown, input: unknown, chatId: string): StudyUnit;
  acceptSuggestion(input: unknown): StudyUnit;
  discardSuggestion(input: unknown): StudyUnit;
}

function kind(value: unknown): UnitKind | null {
  if (value === undefined || value === null) return null;
  if (!UNIT_KINDS.includes(value as UnitKind)) throw new StudyError('INVALID_INPUT', 'kind has an unsupported value');
  return value as UnitKind;
}

function policy(value: unknown): UnitPolicy | null {
  if (value === undefined || value === null) return null;
  if (!UNIT_POLICIES.includes(value as UnitPolicy)) throw new StudyError('INVALID_INPUT', 'policy has an unsupported value');
  return value as UnitPolicy;
}

function revisionOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new StudyError('INVALID_INPUT', 'expectedRevision must be a positive integer');
  return value as number;
}

const CONFLICT = 'Esto cambió mientras tanto: vuelve a cargarlo e inténtalo de nuevo';

/** Validated operations over the study store; the backend and the tutor's tools both go through here. */
export function createOperations(store: StudyStore, now: () => string, newId: () => string = randomUUID): StudyOperations {
  function existingUnit(unitId: string): StudyUnit {
    const unit = store.getUnit(unitId);
    if (!unit) throw new StudyError('NOT_FOUND', `La unidad ${unitId} no existe`);
    return unit;
  }

  function existingPlan(planId: unknown, path = 'input.id'): StudyPlan {
    const plan = store.getPlan(id(planId, path));
    if (!plan) throw new StudyError('NOT_FOUND', 'El plan no existe');
    return plan;
  }

  function changeStatus(input: unknown, from: StudyUnit['status'][], to: StudyUnit['status']): StudyUnit {
    const r = fields(input, ['id', 'expectedRevision'], 'input');
    const unit = existingUnit(id(r.id, 'input.id'));
    const expected = revisionOf(r.expectedRevision);
    if (!from.includes(unit.status)) throw new StudyError('INVALID_TRANSITION', `«${unit.title}» ya está ${unit.status}`);
    return store.saveUnit({ ...unit, status: to, revision: expected + 1, updatedAt: now() }, expected);
  }

  function savePlan(plan: StudyPlan, changes: Partial<StudyPlan>, expected = plan.revision): StudyPlan {
    if (plan.revision !== expected) throw new StudyError('CONFLICT', CONFLICT);
    return store.savePlan({ ...plan, ...changes, revision: expected + 1, updatedAt: now() }, expected);
  }

  function plans(filter: AreaFilter = null): StudyPlan[] {
    return store.listPlans().filter(p => p.estado !== 'archivado' && inArea(p, filter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function suggestion(input: unknown, keep: boolean): StudyUnit {
    const r = fields(input, ['id', 'expectedRevision'], 'input');
    const unit = existingUnit(id(r.id, 'input.id'));
    const expected = revisionOf(r.expectedRevision);
    if (!unit.sugerencia) throw new StudyError('INVALID_TRANSITION', 'Esta unidad no tiene ninguna sugerencia pendiente');
    const { sugerencia, ...rest } = unit;
    const next: StudyUnit = { ...rest, revision: expected + 1, updatedAt: now() };
    if (keep) { next.capability = sugerencia.capability; next.criterion = sugerencia.criterion; }
    return store.saveUnit(next, expected);
  }

  return {
    state(filter = null) {
      const all = store.listPlans().filter(p => inArea(p, filter));
      const planIds = new Set(all.map(p => p.id));
      return { plans: all, units: store.listUnits().filter(u => inArea(u, filter)), proposals: store.listProposals().filter(p => planIds.has(p.planId)) };
    },
    plans,

    planOfUnit(unitId) {
      return plans(null).find(p => p.elementos.some(e => e.unitId === unitId)) ?? null;
    },

    createPlan(input, areaId = null) {
      const r = fields(input, ['goal'], 'input');
      const at = now();
      return store.savePlan({
        id: newId(), revision: 1, createdAt: at, updatedAt: at, goal: text(r.goal, LIMITS.goal, 'input.goal', { required: true }).trim(),
        estado: 'activo', elementos: [], origen: 'manual', areaId,
      }, null);
    },

    proposePlan(input, chatId, areaId = null) {
      const r = fields(input, ['goal', 'elementos'], 'input');
      if (!Array.isArray(r.elementos) || r.elementos.length === 0) throw new StudyError('INVALID_INPUT', 'elementos must be a non-empty list');
      if (r.elementos.length > LIMITS.elementos) throw new StudyError('INVALID_INPUT', `elementos exceeds ${LIMITS.elementos} items`);
      const adds = r.elementos.map((e, i) => parsePlanOp({ ...(e as object), op: 'add' }, `input.elementos[${i}]`));
      const at = now();
      return store.savePlan({
        id: newId(), revision: 1, createdAt: at, updatedAt: at, goal: text(r.goal, LIMITS.goal, 'input.goal', { required: true }).trim(),
        estado: 'propuesto', elementos: applyOps([], adds, newId), origen: 'tutor', chatId, areaId,
      }, null);
    },

    editPlan(input) {
      const r = fields(input, ['id', 'expectedRevision', 'goal', 'estado'], 'input');
      const plan = existingPlan(r.id);
      const changes: Partial<StudyPlan> = {};
      if (r.goal !== undefined) changes.goal = text(r.goal, LIMITS.goal, 'input.goal', { required: true }).trim();
      if (r.estado !== undefined) {
        if (!PLAN_ESTADOS.includes(r.estado as PlanEstado) || r.estado === 'propuesto') throw new StudyError('INVALID_INPUT', 'estado must be activo or archivado');
        if (plan.estado === 'propuesto') throw new StudyError('INVALID_TRANSITION', 'Acepta o descarta primero el plan propuesto');
        changes.estado = r.estado as PlanEstado;
      }
      return savePlan(plan, changes, revisionOf(r.expectedRevision));
    },

    acceptPlan(input) {
      const r = fields(input, ['id', 'expectedRevision'], 'input');
      const plan = existingPlan(r.id);
      if (plan.estado !== 'propuesto') throw new StudyError('INVALID_TRANSITION', 'Este plan ya no está propuesto');
      return savePlan(plan, { estado: 'activo' }, revisionOf(r.expectedRevision));
    },

    discardPlan(input) {
      const r = fields(input, ['id', 'expectedRevision'], 'input');
      const plan = existingPlan(r.id);
      if (plan.estado !== 'propuesto') throw new StudyError('INVALID_TRANSITION', 'Solo se descarta un plan propuesto; uno aceptado se archiva');
      store.trashPlan(plan.id, revisionOf(r.expectedRevision));
    },

    changePlan(input) {
      const r = fields(input, ['id', 'expectedRevision', 'ops'], 'input');
      const plan = existingPlan(r.id);
      if (plan.estado === 'archivado') throw new StudyError('INVALID_TRANSITION', 'El plan está archivado');
      if (!Array.isArray(r.ops) || r.ops.length === 0) throw new StudyError('INVALID_INPUT', 'ops must be a non-empty list');
      const ops = r.ops.map((op, i) => parseCambioPlan(op, `input.ops[${i}]`));
      const elementos = applyOps(plan.elementos, ops, newId);
      if (elementos.length > LIMITS.elementos) throw new StudyError('INVALID_INPUT', `Un plan admite como mucho ${LIMITS.elementos} elementos`);
      return savePlan(plan, { elementos }, revisionOf(r.expectedRevision));
    },

    workOnTema(input) {
      const r = fields(input, ['planId', 'elementoId'], 'input');
      const plan = existingPlan(r.planId, 'input.planId');
      if (plan.estado !== 'activo') throw new StudyError('INVALID_TRANSITION', plan.estado === 'propuesto' ? 'Acepta primero el plan' : 'El plan está archivado');
      const elementoId = id(r.elementoId, 'input.elementoId');
      const tema = plan.elementos.find(e => e.id === elementoId);
      if (!tema) throw new StudyError('NOT_FOUND', 'Ese elemento ya no está en el plan');
      if (tema.tipo !== 'tema') throw new StudyError('INVALID_INPUT', 'Solo un tema se convierte en unidad');
      if (tema.unitId) { const linked = store.getUnit(tema.unitId); if (linked) return linked; }
      const at = now();
      const unit = store.saveUnit({
        id: newId(), revision: 1, createdAt: at, updatedAt: at, status: 'activa', title: tema.titulo, capability: '', criterion: '',
        kind: null, policy: null, graphNodeIds: [], sources: [], checkIds: [], origin: { kind: 'manual' }, notes: '', areaId: plan.areaId,
      }, null);
      savePlan(plan, { elementos: plan.elementos.map(e => (e.id === elementoId ? { ...e, unitId: unit.id } : e)) });
      return unit;
    },

    createUnit(input, origin = { kind: 'manual' }, status = 'activa', areaId = null) {
      const r = fields(input, ['title', 'capability', 'criterion', 'kind', 'policy', 'sources', 'notes'], 'input');
      const at = now();
      return store.saveUnit({
        id: newId(), revision: 1, createdAt: at, updatedAt: at, status,
        title: text(r.title, LIMITS.title, 'input.title', { required: true }),
        capability: r.capability === undefined ? '' : text(r.capability, LIMITS.capability, 'input.capability'),
        criterion: r.criterion === undefined ? '' : text(r.criterion, LIMITS.criterion, 'input.criterion'),
        kind: kind(r.kind), policy: policy(r.policy), graphNodeIds: [],
        sources: r.sources === undefined ? [] : (Array.isArray(r.sources) ? r.sources : [r.sources]).map((s, i) => parseSource(s, `input.sources[${i}]`)),
        checkIds: [], origin, notes: r.notes === undefined ? '' : text(r.notes, LIMITS.notes, 'input.notes'), areaId,
      }, null);
    },

    editUnit(input) {
      const r = fields(input, ['id', 'expectedRevision', 'title', 'capability', 'criterion', 'kind', 'policy', 'notes'], 'input');
      const unit = existingUnit(id(r.id, 'input.id'));
      const expected = revisionOf(r.expectedRevision);
      const next: StudyUnit = { ...unit, revision: expected + 1, updatedAt: now() };
      if (r.title !== undefined) next.title = text(r.title, LIMITS.title, 'input.title', { required: true });
      if (r.capability !== undefined) next.capability = text(r.capability, LIMITS.capability, 'input.capability');
      if (r.criterion !== undefined) next.criterion = text(r.criterion, LIMITS.criterion, 'input.criterion');
      if (r.kind !== undefined) next.kind = kind(r.kind);
      if (r.policy !== undefined) next.policy = policy(r.policy);
      if (r.notes !== undefined) next.notes = text(r.notes, LIMITS.notes, 'input.notes');
      return store.saveUnit(next, expected);
    },

    addSource(unitId, expectedRevision, value) {
      const unit = existingUnit(id(unitId, 'input.unitId'));
      const expected = revisionOf(expectedRevision);
      if (unit.revision !== expected) throw new StudyError('CONFLICT', `La unidad «${unit.title}» cambió mientras tanto (se esperaba la revisión ${expected} y está en la ${unit.revision}): vuelve a cargarla e inténtalo de nuevo`);
      const source = parseSource(value, 'input.source');
      if (unit.sources.some(s => s.path === source.path && s.locator === source.locator)) return unit;
      return store.saveUnit({ ...unit, sources: [...unit.sources, source], revision: expected + 1, updatedAt: now() }, expected);
    },

    confirmUnit: input => changeStatus(input, ['propuesta'], 'activa'),
    archiveUnit: input => changeStatus(input, ['propuesta', 'activa'], 'archivada'),

    proposePlanChange(input) {
      const r = fields(input, ['planId', 'ops', 'rationale'], 'input');
      const plan = existingPlan(r.planId, 'input.planId');
      if (plan.estado !== 'activo') throw new StudyError('INVALID_TRANSITION', plan.estado === 'propuesto' ? 'That plan is still proposed: the learner has to accept it first' : 'That plan is archived');
      if (!Array.isArray(r.ops) || r.ops.length === 0) throw new StudyError('INVALID_INPUT', 'ops must be a non-empty list');
      const ops = r.ops.map((op, i) => parsePlanOp(op, `input.ops[${i}]`));
      applyOps(plan.elementos, ops, () => 'x');
      return store.saveProposal({
        id: newId(), revision: 1, planId: plan.id, baseRevision: plan.revision, ops,
        rationale: r.rationale === undefined ? '' : text(r.rationale, LIMITS.rationale, 'input.rationale'),
        author: 'tutor', status: 'pendiente', createdAt: now(),
      }, null);
    },

    applyProposal(input) {
      const r = fields(input, ['id'], 'input');
      return applyProposal(store, id(r.id, 'input.id'), now(), newId);
    },

    rejectProposal(input) {
      const r = fields(input, ['id'], 'input');
      return rejectProposal(store, id(r.id, 'input.id'), now());
    },

    staleReason(proposal) {
      const plan = store.getPlan(proposal.planId);
      return plan ? staleReason(proposal, plan, store.listProposals()) : 'su plan ya no existe';
    },

    suggestCapability(unitId, input, chatId) {
      const r = fields(input, ['capability', 'criterion'], 'input');
      const unit = existingUnit(id(unitId, 'input.unitId'));
      if (unit.status === 'archivada') throw new StudyError('INVALID_TRANSITION', `«${unit.title}» is archived`);
      const at = now();
      return store.saveUnit({
        ...unit, revision: unit.revision + 1, updatedAt: at,
        sugerencia: {
          capability: text(r.capability, LIMITS.capability, 'input.capability', { required: true }),
          criterion: text(r.criterion, LIMITS.criterion, 'input.criterion', { required: true }),
          chatId, createdAt: at,
        },
      }, unit.revision);
    },
    acceptSuggestion: input => suggestion(input, true),
    discardSuggestion: input => suggestion(input, false),
  };
}
