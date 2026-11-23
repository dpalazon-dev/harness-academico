import type { StudyStore } from '../study/store.ts';
import type { StudyPlan } from '../study/types.ts';
import type { ConversationView } from './types.ts';

/** A conversation as the sidebar lists it (ticket 03 of the second round): with its origin, the unit it is about and
 * the plan whose tema is linked to that unit, so the list can be grouped by unit within a space and by plan across all
 * of them. */
export type FilaConversacion = ConversationView & {
  unidad: { id: string; titulo: string } | null;
  plan: { id: string; objetivo: string } | null;
};

export function filasConversaciones(views: readonly ConversationView[], store: StudyStore, planes: () => StudyPlan[]): FilaConversacion[] {
  const units = new Map(store.listUnits().map(u => [u.id, u]));
  const planDe = new Map<string, StudyPlan>();
  for (const p of planes()) for (const e of p.elementos) if (e.unitId && !planDe.has(e.unitId)) planDe.set(e.unitId, p);
  return views.map(v => {
    const unit = v.unitId ? units.get(v.unitId) : undefined;
    const plan = unit ? planDe.get(unit.id) ?? null : null;
    return { ...v, unidad: unit ? { id: unit.id, titulo: unit.title } : null, plan: plan ? { id: plan.id, objetivo: plan.goal } : null };
  });
}
