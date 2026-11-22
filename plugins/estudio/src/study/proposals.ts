import type { StudyStore } from './store.ts';
import { StudyError, type PlanOp, type PlanProposal, type StudyPlan, type StudyUnit } from './types.ts';

type UnitLookup = (id: string) => Pick<StudyUnit, 'status' | 'title'> | null;

const unitName = (unit: UnitLookup, id: string) => { const title = unit(id)?.title; return title ? `«${title}»` : `la unidad ${id}`; };

function pending(store: StudyStore, proposalId: string): PlanProposal {
  const proposal = store.getProposal(proposalId);
  if (!proposal) throw new StudyError('NOT_FOUND', `El cambio del plan ${proposalId} no existe`);
  if (proposal.status !== 'pendiente') throw new StudyError('INVALID_TRANSITION', `Ese cambio del plan ya está ${proposal.status}`);
  return proposal;
}

/** Applies every op or none; an op that does not fit the current plan rejects the whole proposal.
 * Archived units cannot be added; proposed units can, because applying the proposal confirms them. */
export function applyOps(unitIds: readonly string[], ops: readonly PlanOp[], unit: UnitLookup): string[] {
  const next = [...unitIds];
  const name = (id: string) => unitName(unit, id);
  for (const op of ops) {
    const at = next.indexOf(op.unitId);
    if (op.op === 'add') {
      const status = unit(op.unitId)?.status ?? null;
      if (status === null) throw new StudyError('INVALID_INPUT', `${name(op.unitId)} no existe`);
      if (status === 'archivada') throw new StudyError('INVALID_INPUT', `${name(op.unitId)} está archivada`);
      if (at !== -1) throw new StudyError('INVALID_INPUT', `${name(op.unitId)} ya está en el plan`);
      const index = op.index ?? next.length;
      if (index > next.length) throw new StudyError('INVALID_INPUT', `el plan no tiene la posición ${index + 1} para ${name(op.unitId)}`);
      next.splice(index, 0, op.unitId);
    } else if (op.op === 'remove') {
      if (at === -1) throw new StudyError('INVALID_INPUT', `${name(op.unitId)} no está en el plan`);
      next.splice(at, 1);
    } else {
      if (at === -1) throw new StudyError('INVALID_INPUT', `${name(op.unitId)} no está en el plan`);
      if (op.index >= next.length) throw new StudyError('INVALID_INPUT', `el plan no tiene la posición ${op.index + 1} para ${name(op.unitId)}`);
      next.splice(at, 1);
      next.splice(op.index, 0, op.unitId);
    }
  }
  return next;
}

/** Why a pending proposal no longer fits its plan, in words for David; null when it can still be applied.
 * A plan's unit list only changes by applying proposals, so what changed since this one was written are the
 * proposals applied to the same plan afterwards (and the one the plan records as applied, in case marking it
 * failed). The proposal is stale when its ops no longer fit the current plan, when it touches a unit those
 * changes touched, or when it places a unit by position and the list has changed since: the number no longer
 * points where the tutor meant. Otherwise it is applied to the current plan. */
export function staleReason(proposal: PlanProposal, plan: StudyPlan, proposals: readonly PlanProposal[], unit: UnitLookup): string | null {
  try {
    applyOps(plan.unitIds, proposal.ops, unit);
  } catch (error) {
    if (error instanceof StudyError) return error.message;
    throw error;
  }
  if (plan.revision === proposal.baseRevision) return null;
  const later = proposals.filter(p => p.planId === plan.id && p.id !== proposal.id
    && ((p.status === 'aplicada' && (p.decidedAt ?? '') >= proposal.createdAt) || p.id === plan.lastAppliedProposalId));
  if (later.length === 0) return null;
  const touched = new Set(later.flatMap(p => p.ops.map(op => op.unitId)));
  const clash = proposal.ops.find(op => touched.has(op.unitId));
  if (clash) return `otro cambio del plan ya tocó ${unitName(unit, clash.unitId)}`;
  const placed = proposal.ops.find(op => op.op === 'move' || (op.op === 'add' && op.index !== undefined));
  if (placed) return `el plan cambió después y la posición que proponía para ${unitName(unit, placed.unitId)} ya no es la misma`;
  return null;
}

function decide(store: StudyStore, proposal: PlanProposal, status: PlanProposal['status'], now: string): PlanProposal {
  return store.saveProposal({ ...proposal, revision: proposal.revision + 1, status, decidedAt: now }, proposal.revision);
}

/** A proposal that no longer fits the plan (`staleReason`) becomes stale and leaves the plan untouched,
 * unless the plan records it as already applied (a failure between the two writes). */
export function applyProposal(store: StudyStore, proposalId: string, now: string): StudyPlan {
  const proposal = pending(store, proposalId);
  const plan = store.getPlan(proposal.planId);
  if (!plan) throw new StudyError('NOT_FOUND', 'El plan de este cambio ya no existe');
  if (plan.lastAppliedProposalId === proposal.id) {
    decide(store, proposal, 'aplicada', now);
    return plan;
  }
  const unit: UnitLookup = id => store.getUnit(id);
  const reason = staleReason(proposal, plan, store.listProposals(), unit);
  if (reason !== null) {
    decide(store, proposal, 'obsoleta', now);
    throw new StudyError('CONFLICT', `Este cambio del plan ya no encaja, porque ${reason}. Se ha retirado sin tocar el plan.`);
  }
  const unitIds = applyOps(plan.unitIds, proposal.ops, unit);
  for (const op of proposal.ops) {
    const added = op.op === 'add' ? store.getUnit(op.unitId) : null;
    if (added?.status === 'propuesta') store.saveUnit({ ...added, status: 'activa', revision: added.revision + 1, updatedAt: now }, added.revision);
  }
  const saved = store.savePlan({ ...plan, revision: plan.revision + 1, unitIds, updatedAt: now, lastAppliedProposalId: proposal.id }, plan.revision);
  decide(store, proposal, 'aplicada', now);
  return saved;
}

/** Discarding a proposal that no longer fits records it as stale, not as rejected by David. */
export function rejectProposal(store: StudyStore, proposalId: string, now: string): PlanProposal {
  const proposal = pending(store, proposalId);
  const plan = store.getPlan(proposal.planId);
  const stale = !plan || staleReason(proposal, plan, store.listProposals(), id => store.getUnit(id)) !== null;
  return decide(store, proposal, stale ? 'obsoleta' : 'rechazada', now);
}
