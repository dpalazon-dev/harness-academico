import { randomUUID } from 'node:crypto';
import { applyProposal, rejectProposal, staleReason } from './study/proposals.ts';
import { fields, id, LIMITS, parsePlanOp, parseSource, text } from './study/schema.ts';
import type { StudyStore } from './study/store.ts';
import { inArea, type AreaFilter } from './study/areas.ts';
import {
  StudyError, UNIT_KINDS, UNIT_POLICIES,
  type PlanProposal, type StudyPlan, type StudyUnit, type UnitKind, type UnitOrigin, type UnitPolicy,
} from './study/types.ts';

export interface StudyState { plans: StudyPlan[]; units: StudyUnit[]; proposals: PlanProposal[] }

export interface StudyOperations {
  /** Plans, units and proposals of one space, or of all when the filter is null. */
  state(filter?: AreaFilter): StudyState;
  createPlan(input: unknown, areaId?: string | null): StudyPlan;
  createUnit(input: unknown, origin?: UnitOrigin, status?: 'propuesta' | 'activa', areaId?: string | null): StudyUnit;
  editUnit(input: unknown): StudyUnit;
  confirmUnit(input: unknown): StudyUnit;
  archiveUnit(input: unknown): StudyUnit;
  /** Adds a source to a unit; adding the same path and locator again changes nothing. */
  addSource(unitId: string, expectedRevision: unknown, source: unknown): StudyUnit;
  /** Without a plan id, the change goes to the current plan of the space, created from `goal` if there is none. */
  proposePlanChange(input: unknown, author: 'tutor' | 'david', areaId?: string | null): PlanProposal;
  applyProposal(input: unknown): StudyPlan;
  rejectProposal(input: unknown): PlanProposal;
  /** Why a pending proposal can no longer be applied, in words for David; null when it still can. */
  staleReason(proposal: PlanProposal): string | null;
  /** The most recently updated plan of the space that is not archived; with a null filter, of any space. */
  currentPlan(filter?: AreaFilter): StudyPlan | null;
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

/** Validated operations over the study store; the backend and the tutor's tools both go through here. */
export function createOperations(store: StudyStore, now: () => string, newId: () => string = randomUUID): StudyOperations {
  function existingUnit(unitId: string): StudyUnit {
    const unit = store.getUnit(unitId);
    if (!unit) throw new StudyError('NOT_FOUND', `La unidad ${unitId} no existe`);
    return unit;
  }

  function changeStatus(input: unknown, from: StudyUnit['status'][], to: StudyUnit['status']): StudyUnit {
    const r = fields(input, ['id', 'expectedRevision'], 'input');
    const unit = existingUnit(id(r.id, 'input.id'));
    const expected = revisionOf(r.expectedRevision);
    if (!from.includes(unit.status)) throw new StudyError('INVALID_TRANSITION', `«${unit.title}» ya está ${unit.status}`);
    return store.saveUnit({ ...unit, status: to, revision: expected + 1, updatedAt: now() }, expected);
  }

  function currentPlan(filter: AreaFilter = null): StudyPlan | null {
    return store.listPlans().filter(p => !p.archived && inArea(p, filter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  }

  function createPlan(input: unknown, areaId: string | null = null): StudyPlan {
    const r = fields(input, ['goal'], 'input');
    const at = now();
    return store.savePlan({ id: newId(), revision: 1, createdAt: at, updatedAt: at, goal: text(r.goal, LIMITS.goal, 'input.goal', { required: true }), unitIds: [], archived: false, areaId }, null);
  }

  return {
    state(filter = null) {
      const plans = store.listPlans().filter(p => inArea(p, filter));
      const planIds = new Set(plans.map(p => p.id));
      return { plans, units: store.listUnits().filter(u => inArea(u, filter)), proposals: store.listProposals().filter(p => planIds.has(p.planId)) };
    },
    currentPlan,
    createPlan,

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

    proposePlanChange(input, author, areaId = null) {
      const r = fields(input, ['planId', 'goal', 'ops', 'rationale'], 'input');
      if (!Array.isArray(r.ops) || r.ops.length === 0) throw new StudyError('INVALID_INPUT', 'ops must be a non-empty list');
      const ops = r.ops.map((op, i) => parsePlanOp(op, `input.ops[${i}]`));
      // Checked before a plan may be created, so a refused proposal leaves nothing behind.
      for (const op of ops) if (op.op === 'add' && existingUnit(op.unitId).status === 'archivada') {
        throw new StudyError('INVALID_INPUT', `La unidad ${op.unitId} está archivada`);
      }
      let plan: StudyPlan | null;
      if (r.planId !== undefined) {
        plan = store.getPlan(id(r.planId, 'input.planId'));
        if (!plan) throw new StudyError('NOT_FOUND', `El plan ${String(r.planId)} no existe`);
      } else {
        plan = currentPlan(areaId) ?? (r.goal === undefined ? null : createPlan({ goal: r.goal }, areaId));
        if (!plan) throw new StudyError('INVALID_INPUT', 'Todavía no hay plan: indica un objetivo para empezar uno');
      }
      return store.saveProposal({
        id: newId(), revision: 1, planId: plan.id, baseRevision: plan.revision, ops,
        rationale: r.rationale === undefined ? '' : text(r.rationale, LIMITS.rationale, 'input.rationale'),
        author, status: 'pendiente', createdAt: now(),
      }, null);
    },

    applyProposal(input) {
      const r = fields(input, ['id'], 'input');
      return applyProposal(store, id(r.id, 'input.id'), now());
    },

    rejectProposal(input) {
      const r = fields(input, ['id'], 'input');
      return rejectProposal(store, id(r.id, 'input.id'), now());
    },

    staleReason(proposal) {
      const plan = store.getPlan(proposal.planId);
      return plan ? staleReason(proposal, plan, store.listProposals(), unitId => store.getUnit(unitId)) : 'su plan ya no existe';
    },
  };
}
