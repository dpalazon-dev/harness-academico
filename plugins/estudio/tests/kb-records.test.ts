import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newKbId, parseRecord, recordPath, renderRecord } from '../src/kb/records.ts';
import type { KbEntidad, KbHecho } from '../src/kb/types.ts';

const ORIGINAL = 'F-11111111-1111-4111-8111-111111111111';

export function hecho(over: Partial<KbHecho> = {}): KbHecho {
  return {
    id: 'HE-22222222-2222-4222-8222-222222222222', type: 'hecho', clase: 'registro',
    title: 'GDN: «atención» sobre sensores: resultado en SWaT', description: 'GDN obtiene F1 0,81 en SWaT.',
    ambito: 'estudio', autor: 'human:david', eventos: [],
    sources: [{ id: 's1', resource: ORIGINAL, representacion_id: 'F-33333333-3333-4333-8333-333333333333', hash: 'a'.repeat(64), ancla: 'pdf-v1:p=7', contexto: 'GDN achieves an F1 of 0.81' }],
    estado: 'propuesta', afirmacion: 'GDN obtiene F1 0,81 en SWaT: según el paper.', clase_evidencia: 'declarado', precision: 'dia', fecha: '2021-05-18',
    basada_en: [ORIGINAL], afecta_a: ['ENT-44444444-4444-4444-8444-444444444444'], ...over,
  };
}

test('ids carry the type prefix and a v4 uuid; paths go to the type folder', () => {
  assert.match(newKbId('hecho'), /^HE-[0-9a-f-]{36}$/);
  assert.match(newKbId('sintesis'), /^SIN-/);
  assert.equal(recordPath({ type: 'entidad', id: 'ENT-x' }), 'kb/entidades/ENT-x.md');
  assert.equal(recordPath({ type: 'rol', id: 'ROL-x' }), 'kb/personas/ROL-x.md');
});

test('a record round-trips: dates stay text, accents and quotes survive, common keys come first, LF only', () => {
  const text = renderRecord(hecho(), '# Título\r\n\r\nCuerpo con «comillas».');
  assert.equal(text.includes('\r'), false);
  assert.match(text, /^---\nid: HE-/);
  assert.match(text, /fecha: '2021-05-18'/);
  const { header, body } = parseRecord(text);
  assert.deepEqual(header, JSON.parse(JSON.stringify(hecho())));
  assert.equal(body, '# Título\n\nCuerpo con «comillas».\n');
});

test('an entity with empty alias and empty sources renders as KBOL expects', () => {
  const e: KbEntidad = { id: 'ENT-1', type: 'entidad', clase: 'registro', title: 'SWaT', description: 'Banco de pruebas.', ambito: 'estudio', autor: 'human:david', eventos: [], sources: [], estado: 'propuesta', nombre: 'SWaT', alias: [], clase_entidad: 'dataset' };
  const text = renderRecord(e, '# SWaT');
  assert.match(text, /eventos: \[\]\nsources: \[\]/);
  assert.match(text, /alias: \[\]/);
});

test('YAML anchors, aliases and merges are refused, as in KBOL', () => {
  assert.throws(() => parseRecord('---\nbase: &b {a: 1}\nother: *b\n---\n'), /anclas/);
  assert.throws(() => parseRecord('---\n<<: {a: 1}\n---\n'), /anclas/);
  assert.throws(() => parseRecord('sin cabecera'), /cabecera/);
});
