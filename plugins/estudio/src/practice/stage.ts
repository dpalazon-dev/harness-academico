import { INTERVALS, type UnitRegulation } from './policy.ts';

/** Where a unit stands, derived only from graded evidence. Never «learned» or «mastered»: the regulator does not
 * claim that, and a stage is a description of the evidence, not a verdict (design, sections 6 quater and 6 octies). */
export type StageKind = 'nueva' | 'practicada' | 'reaprendiendo' | 'intervalo' | 'mantenimiento' | 'fuera';

export interface UnitStage {
  kind: StageKind;
  label: string;
  /** Interval earned, in days, for kind «intervalo». */
  days: number | null;
}

export function unitStage(regulation: UnitRegulation, graded: number): UnitStage {
  if (regulation.mode === 'fuera') return { kind: 'fuera', label: 'Sin repaso', days: null };
  if (graded === 0) return { kind: 'nueva', label: 'Sin practicar', days: null };
  if (regulation.eligibleCount === 0) return { kind: 'practicada', label: 'Solo práctica en sesión', days: null };
  if (regulation.mode === 'mantenimiento') return { kind: 'mantenimiento', label: 'Mantenimiento por uso', days: null };
  if (regulation.step < 0) return { kind: 'reaprendiendo', label: 'Reaprendiendo', days: null };
  const days = INTERVALS[Math.min(regulation.step, INTERVALS.length - 1)]!;
  return { kind: 'intervalo', label: `Recuperada · intervalo de ${days} días`, days };
}
