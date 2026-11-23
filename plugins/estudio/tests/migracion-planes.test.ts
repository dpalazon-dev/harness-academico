import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { elementoDeUnidad, migrarPlanes } from '../src/study/migracion.ts';
import { LATER, NOW, tempStore, unit } from './study-fixtures.ts';

const escribir = (root: string, dir: string, id: string, record: unknown) => fs.writeFileSync(path.join(root, dir, `${id}.json`), JSON.stringify(record));
const planViejo = (id: string, unitIds: string[], extra: Record<string, unknown> = {}) =>
  ({ id, revision: 3, createdAt: NOW, updatedAt: NOW, goal: `Plan ${id}`, unitIds, archived: false, areaId: 'esp', ...extra });
const cambioViejo = (id: string, ops: unknown[], status = 'pendiente') =>
  ({ id, revision: 1, planId: 'p1', baseRevision: 3, ops, rationale: 'r', author: 'tutor', status, createdAt: NOW });

test('un plan viejo pasa a temas enlazados a sus unidades; los cambios pendientes caducan y las propuestas sueltas se archivan', t => {
  const store = tempStore(t);
  store.saveUnit(unit({ id: 'u1', title: 'Límites' }), null);
  store.saveUnit(unit({ id: 'u2', title: 'Derivadas', status: 'propuesta' }), null);
  store.saveUnit(unit({ id: 'u3', title: 'Suelta propuesta', status: 'propuesta' }), null);
  store.saveUnit(unit({ id: 'u4', title: 'Suelta activa' }), null);
  escribir(store.root, 'plans', 'p1', planViejo('p1', ['u1', 'u2', 'fantasma'], { lastAppliedProposalId: 'q0' }));
  escribir(store.root, 'plans', 'p2', planViejo('p2', [], { archived: true }));
  escribir(store.root, 'proposals', 'q1', cambioViejo('q1', [{ op: 'add', unitId: 'u3', index: 0 }, { op: 'move', unitId: 'u1', index: 1 }]));
  escribir(store.root, 'proposals', 'q0', cambioViejo('q0', [{ op: 'remove', unitId: 'u4' }], 'aplicada'));

  assert.deepEqual(migrarPlanes(store.root, LATER), { planes: 2, cambios: 2, unidadesArchivadas: 1 });

  const p1 = store.getPlan('p1')!;
  assert.deepEqual([p1.revision, p1.updatedAt, p1.estado, p1.origen, p1.areaId, p1.lastAppliedProposalId], [4, LATER, 'activo', 'manual', 'esp', 'q0']);
  assert.deepEqual(p1.elementos, [
    { id: elementoDeUnidad('u1'), tipo: 'tema', titulo: 'Límites', hecho: false, unitId: 'u1' },
    { id: elementoDeUnidad('u2'), tipo: 'tema', titulo: 'Derivadas', hecho: false, unitId: 'u2' },
    { id: elementoDeUnidad('fantasma'), tipo: 'tema', titulo: 'fantasma', hecho: false },
  ]);
  assert.equal(store.getPlan('p2')!.estado, 'archivado');
  assert.deepEqual(['u1', 'u2', 'u3', 'u4'].map(id => store.getUnit(id)!.status), ['activa', 'activa', 'archivada', 'activa']);
  const q1 = store.getProposal('q1')!;
  assert.deepEqual([q1.status, q1.decidedAt, q1.ops], ['obsoleta', LATER, [
    { op: 'add', tipo: 'tema', titulo: 'Suelta propuesta', index: 0 }, { op: 'move', elementoId: elementoDeUnidad('u1'), index: 1 },
  ]]);
  assert.equal(store.getProposal('q0')!.status, 'aplicada', 'un cambio ya decidido conserva su estado');

  assert.deepEqual(migrarPlanes(store.root, LATER), { planes: 0, cambios: 0, unidadesArchivadas: 0 }, 'una segunda vez no hace nada');
  assert.equal(store.getPlan('p1')!.revision, 4);
});

test('una unidad en dos planes viejos queda enlazada al plan vivo más reciente; en el otro, el tema va sin unidad', t => {
  const store = tempStore(t);
  store.saveUnit(unit({ id: 'u1' }), null);
  escribir(store.root, 'plans', 'viejo', planViejo('viejo', ['u1'], { updatedAt: '2026-11-01T10:00:00.000Z' }));
  escribir(store.root, 'plans', 'nuevo', planViejo('nuevo', ['u1'], { updatedAt: '2026-11-10T10:00:00.000Z' }));
  migrarPlanes(store.root, LATER);
  assert.equal(store.getPlan('nuevo')!.elementos[0]!.unitId, 'u1');
  assert.equal(store.getPlan('viejo')!.elementos[0]!.unitId, undefined);
});

test('sin nada del formato viejo no toca nada, ni las unidades propuestas', t => {
  const store = tempStore(t);
  store.saveUnit(unit({ id: 'u1', status: 'propuesta' }), null);
  assert.deepEqual(migrarPlanes(store.root, LATER), { planes: 0, cambios: 0, unidadesArchivadas: 0 });
  assert.equal(store.getUnit('u1')!.status, 'propuesta');
});
