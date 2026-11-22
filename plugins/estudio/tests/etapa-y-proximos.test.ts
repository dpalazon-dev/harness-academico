/** La etapa de una unidad y los repasos de los próximos 7 días: lo que leían la Ruta y Hoy de la vista antigua y
 * ahora leen el inicio, la barra lateral y Progreso del armazón. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unitStage } from '../src/practice/stage.ts';
import type { UnitRegulation } from '../src/practice/policy.ts';
import type { UnitOverview } from '../src/practice/service.ts';

const REG: UnitRegulation = {
  unitId: 'u1', since: '2026-11-01T10:00:00.000Z', mode: 'cola', step: -1, dueDate: '2026-11-12', nextTaskKind: 'libre',
  needsVerification: false, eligibleCount: 0, lastFailure: null, brier: null,
};

test('the stage only describes the evidence: no attempts, practice only, relearning, an interval, maintenance', () => {
  assert.equal(unitStage(REG, 0).kind, 'nueva');
  assert.equal(unitStage(REG, 2).kind, 'practicada');
  assert.equal(unitStage({ ...REG, eligibleCount: 1 }, 1).kind, 'reaprendiendo');
  assert.deepEqual(unitStage({ ...REG, eligibleCount: 2, step: 1 }, 2), { kind: 'intervalo', label: 'Recuperada · intervalo de 7 días', days: 7 });
  assert.equal(unitStage({ ...REG, eligibleCount: 3, step: 2, mode: 'mantenimiento' }, 3).kind, 'mantenimiento');
  assert.equal(unitStage({ ...REG, mode: 'fuera' }, 0).kind, 'fuera');
  for (const s of [0, 1, 2, 3]) assert.doesNotMatch(unitStage({ ...REG, eligibleCount: 1, step: s }, 1).label, /domin|aprendid/i);
});

const overview = (unitId: string, title: string, graded: number, step = -1, eligibleCount = 0): UnitOverview => {
  const r = { ...REG, unitId, step, eligibleCount };
  return { ...r, title, stage: unitStage(r, graded), graded, lastGradedAt: null, open: false };
};

test('the next seven days group the reviews the regulator dated, from tomorrow, without unattempted units', async () => {
  const { upcomingReviews } = await import('../src/inicio.ts');
  const at = (unitId: string, title: string, dueDate: string | null, graded = 1) => ({ ...overview(unitId, title, graded, 0, 1), dueDate });
  const days = upcomingReviews([
    at('a', 'Hoy mismo', '2026-11-12'), at('b', 'Mañana B', '2026-11-13'), at('c', 'Mañana A', '2026-11-13'),
    at('d', 'Dentro de siete', '2026-11-19'), at('e', 'Dentro de ocho', '2026-11-20'), at('f', 'Sin intentos', '2026-11-14', 0), at('g', 'Sin fecha', null),
  ], '2026-11-12');
  assert.deepEqual(days.map(d => [d.day, d.units.map(u => u.title)]), [['2026-11-13', ['Mañana A', 'Mañana B']], ['2026-11-19', ['Dentro de siete']]]);
});
