import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlan, parseProposal, parseUnit } from '../src/study/schema.ts';
import { StudyError } from '../src/study/types.ts';
import { plan, proposal, unit, tema } from './study-fixtures.ts';

const invalid = (error: unknown) => error instanceof StudyError && error.code === 'INVALID_INPUT';

test('a valid unit, plan and proposal round-trip unchanged', () => {
  assert.deepEqual(parseUnit(unit()), unit());
  assert.deepEqual(parsePlan(plan()), plan());
  assert.deepEqual(parseProposal(proposal()), proposal());
});

test('unknown fields are rejected at every level', () => {
  assert.throws(() => parseUnit({ ...unit(), extra: 1 }), invalid);
  assert.throws(() => parseUnit(unit({ origin: { kind: 'manual', extra: 1 } as never })), invalid);
  assert.throws(() => parseUnit(unit({ sources: [{ path: 'a.pdf', page: 3 } as never] })), invalid);
  assert.throws(() => parseProposal(proposal({ ops: [{ op: 'add', unitId: 'u1', extra: 1 } as never] })), invalid);
});

test('kind and policy accept only their values or null', () => {
  assert.equal(parseUnit(unit({ kind: null, policy: null })).kind, null);
  assert.throws(() => parseUnit(unit({ kind: 'hecho' as never })), invalid);
  assert.throws(() => parseUnit(unit({ policy: 'memorizar' as never })), invalid);
});

test('titles must be present and bounded; long texts are bounded', () => {
  assert.throws(() => parseUnit(unit({ title: '   ' })), invalid);
  assert.throws(() => parseUnit(unit({ title: 'x'.repeat(501) })), invalid);
  assert.throws(() => parseUnit(unit({ capability: 'x'.repeat(4001) })), invalid);
  assert.throws(() => parseUnit(unit({ criterion: 'x'.repeat(4001) })), invalid);
});

test('ids accept only letters, digits, underscore and hyphen', () => {
  for (const id of ['', 'a b', '../x', 'a/b', 'á']) assert.throws(() => parseUnit(unit({ id })), invalid);
  assert.throws(() => parsePlan(plan({ elementos: [tema('no/')] })), invalid);
});

test('duplicates in id lists and empty proposals are rejected', () => {
  assert.throws(() => parsePlan(plan({ elementos: [tema('e1'), tema('e1')] })), invalid);
  assert.throws(() => parsePlan(plan({ elementos: [tema('e1', { unitId: 'u1' }), tema('e2', { unitId: 'u1' })] })), invalid, 'a unit is linked to one tema');
  assert.throws(() => parsePlan(plan({ elementos: [{ id: 'e1', tipo: 'tarea', titulo: 'x', hecho: false, unitId: 'u1' }] })), invalid, 'only a tema has a unit');
  assert.throws(() => parsePlan(plan({ elementos: [{ id: 'e1', tipo: 'tema', titulo: 'x', hecho: false, fecha: '2027-01-01' }] })), invalid, 'only a hito has a date');
  assert.throws(() => parsePlan(plan({ elementos: [{ id: 'e1', tipo: 'hito', titulo: 'x', hecho: false, fecha: '2027-02-30' }] })), invalid, 'a date that does not exist');
  assert.equal(parsePlan(plan({ elementos: [{ id: 'e1', tipo: 'hito', titulo: ' Examen ', hecho: true, fecha: '2027-02-28' }] })).elementos[0]!.titulo, 'Examen');
  assert.throws(() => parseProposal(proposal({ ops: [] })), invalid);
});
