import type { StudyStore } from './store.ts';
import { StudyError, type CambioPlan, type ElementoPlan, type PlanOp, type PlanProposal, type StudyPlan } from './types.ts';

const TIPO = { tema: 'el tema', tarea: 'la tarea', hito: 'el hito' } as const;

function nombre(elementos: readonly ElementoPlan[], elementoId: string): string {
  const e = elementos.find(x => x.id === elementoId);
  return e ? `${TIPO[e.tipo]} «${e.titulo}»` : 'un elemento que ya no está en el plan';
}

/** A change in words for David, against the plan it would apply to. */
export function describirOp(op: PlanOp, elementos: readonly ElementoPlan[]): string {
  if (op.op === 'add') return `Añadir ${TIPO[op.tipo]} «${op.titulo}»${op.fecha ? ` (${op.fecha})` : ''}${op.index === undefined ? '' : ` en la posición ${op.index + 1}`}`;
  if (op.op === 'remove') return `Quitar ${nombre(elementos, op.elementoId)}`;
  return `Mover ${nombre(elementos, op.elementoId)} a la posición ${op.index + 1}`;
}

function pending(store: StudyStore, proposalId: string): PlanProposal {
  const proposal = store.getProposal(proposalId);
  if (!proposal) throw new StudyError('NOT_FOUND', `El cambio del plan ${proposalId} no existe`);
  if (proposal.status !== 'pendiente') throw new StudyError('INVALID_TRANSITION', `Ese cambio del plan ya está ${proposal.status}`);
  return proposal;
}

/** Applies every change or none; one that does not fit the current list rejects the whole set. `add` gives the new
 * element an id from `newId`. Removing a tema with a unit leaves the unit without a plan; it is never deleted. */
export function applyOps(elementos: readonly ElementoPlan[], ops: readonly CambioPlan[], newId: () => string): ElementoPlan[] {
  const next = elementos.map(e => ({ ...e }));
  for (const op of ops) {
    if (op.op === 'add') {
      const index = op.index ?? next.length;
      if (index > next.length) throw new StudyError('INVALID_INPUT', `el plan no tiene la posición ${index + 1} para «${op.titulo}»`);
      const elemento: ElementoPlan = { id: newId(), tipo: op.tipo, titulo: op.titulo, hecho: false };
      if (op.fecha !== undefined) {
        if (op.tipo !== 'hito') throw new StudyError('INVALID_INPUT', 'Solo un hito lleva fecha');
        elemento.fecha = op.fecha;
      }
      next.splice(index, 0, elemento);
      continue;
    }
    const at = next.findIndex(e => e.id === op.elementoId);
    if (at === -1) throw new StudyError('INVALID_INPUT', `${nombre(elementos, op.elementoId)} no está en el plan`);
    if (op.op === 'remove') {
      next.splice(at, 1);
    } else if (op.op === 'move') {
      if (op.index >= next.length) throw new StudyError('INVALID_INPUT', `el plan no tiene la posición ${op.index + 1} para ${nombre(next, op.elementoId)}`);
      next.splice(op.index, 0, ...next.splice(at, 1));
    } else {
      const e = next[at]!;
      if (op.titulo !== undefined) e.titulo = op.titulo;
      if (op.hecho !== undefined) e.hecho = op.hecho;
      if (op.fecha !== undefined) {
        if (e.tipo !== 'hito') throw new StudyError('INVALID_INPUT', 'Solo un hito lleva fecha');
        if (op.fecha === null) delete e.fecha; else e.fecha = op.fecha;
      }
    }
  }
  return next;
}

/** Why a pending proposal no longer fits its plan, in words for David; null when it can still be applied.
 * What changed since it was written are the proposals applied to the same plan afterwards (and the one the plan
 * records as applied, in case marking it failed) and David's own edits, which raise the revision. It is stale when its
 * changes no longer fit the current list, when the plan is no longer active, when it touches an element that a later
 * proposal touched, or when it places by position and the list has changed since: the number no longer points where
 * the tutor meant. */
export function staleReason(proposal: PlanProposal, plan: StudyPlan, proposals: readonly PlanProposal[]): string | null {
  if (plan.estado !== 'activo') return plan.estado === 'archivado' ? 'el plan está archivado' : 'el plan aún no está aceptado';
  try {
    applyOps(plan.elementos, proposal.ops, () => 'x');
  } catch (error) {
    if (error instanceof StudyError) return error.message;
    throw error;
  }
  if (plan.revision === proposal.baseRevision) return null;
  const later = proposals.filter(p => p.planId === plan.id && p.id !== proposal.id
    && ((p.status === 'aplicada' && (p.decidedAt ?? '') >= proposal.createdAt) || p.id === plan.lastAppliedProposalId));
  const touched = new Set(later.flatMap(p => p.ops.flatMap(op => op.op === 'add' ? [] : [op.elementoId])));
  const clash = proposal.ops.find(op => op.op !== 'add' && touched.has(op.elementoId));
  if (clash && clash.op !== 'add') return `otro cambio del plan ya tocó ${nombre(plan.elementos, clash.elementoId)}`;
  const placed = proposal.ops.find(op => op.op === 'move' || (op.op === 'add' && op.index !== undefined));
  if (placed) return 'el plan cambió después y la posición que proponía ya no es la misma';
  return null;
}

function decide(store: StudyStore, proposal: PlanProposal, status: PlanProposal['status'], now: string): PlanProposal {
  return store.saveProposal({ ...proposal, revision: proposal.revision + 1, status, decidedAt: now }, proposal.revision);
}

/** A proposal that no longer fits the plan (`staleReason`) becomes stale and leaves the plan untouched,
 * unless the plan records it as already applied (a failure between the two writes). */
export function applyProposal(store: StudyStore, proposalId: string, now: string, newId: () => string): StudyPlan {
  const proposal = pending(store, proposalId);
  const plan = store.getPlan(proposal.planId);
  if (!plan) throw new StudyError('NOT_FOUND', 'El plan de este cambio ya no existe');
  if (plan.lastAppliedProposalId === proposal.id) {
    decide(store, proposal, 'aplicada', now);
    return plan;
  }
  const reason = staleReason(proposal, plan, store.listProposals());
  if (reason !== null) {
    decide(store, proposal, 'obsoleta', now);
    throw new StudyError('CONFLICT', `Este cambio del plan ya no encaja, porque ${reason}. Se ha retirado sin tocar el plan.`);
  }
  const elementos = applyOps(plan.elementos, proposal.ops, newId);
  const saved = store.savePlan({ ...plan, revision: plan.revision + 1, elementos, updatedAt: now, lastAppliedProposalId: proposal.id }, plan.revision);
  decide(store, proposal, 'aplicada', now);
  return saved;
}

/** Discarding a proposal that no longer fits records it as stale, not as rejected by David. */
export function rejectProposal(store: StudyStore, proposalId: string, now: string): PlanProposal {
  const proposal = pending(store, proposalId);
  const plan = store.getPlan(proposal.planId);
  const stale = !plan || staleReason(proposal, plan, store.listProposals()) !== null;
  return decide(store, proposal, stale ? 'obsoleta' : 'rechazada', now);
}
