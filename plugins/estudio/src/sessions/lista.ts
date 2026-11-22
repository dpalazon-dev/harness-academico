import type { StudyStore } from '../study/store.ts';
import type { AreaFilter } from '../study/areas.ts';
import type { StudyPlan } from '../study/types.ts';
import type { ConversationView } from './types.ts';

/** A conversation as the sidebar lists it (ticket 03 of the second round): with its origin, the unit it is about and
 * that unit's plan, so the list can be grouped by unit within a space and by plan across all of them. */
export type FilaConversacion = ConversationView & {
  unidad: { id: string; titulo: string } | null;
  plan: { id: string; objetivo: string } | null;
};

export function filasConversaciones(views: readonly ConversationView[], store: StudyStore, planActual: (filter: AreaFilter) => StudyPlan | null): FilaConversacion[] {
  const units = new Map(store.listUnits().map(u => [u.id, u]));
  const plans = store.listPlans().filter(p => !p.archived);
  const actuales = new Map<string, StudyPlan | null>();
  /** The plan a unit belongs to: the live plan that lists it, else the current plan of its space (where the sidebar
   * shows it as outside the plan). A unit removed from the store keeps neither. */
  const planDe = (unitId: string, areaId: string | null) => {
    const propio = plans.find(p => p.unitIds.includes(unitId));
    if (propio || !areaId) return propio ?? null;
    if (!actuales.has(areaId)) actuales.set(areaId, planActual(areaId));
    return actuales.get(areaId)!;
  };
  return views.map(v => {
    const unit = v.unitId ? units.get(v.unitId) : undefined;
    const plan = unit ? planDe(unit.id, unit.areaId) : null;
    return { ...v, unidad: unit ? { id: unit.id, titulo: unit.title } : null, plan: plan ? { id: plan.id, objetivo: plan.goal } : null };
  });
}
