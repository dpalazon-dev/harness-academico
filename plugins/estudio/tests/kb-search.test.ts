import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex, search, tokenize, type SearchDoc } from '../src/kb/search.ts';
import { createKbSearch } from '../src/kb/corpus.ts';
import { estructura, ORIGINAL_SHA, tempAlmacen } from './documents-fixtures.ts';

const doc = (id: string, kind: string, title: string, text: string, links: string[] = []): SearchDoc => ({ id, kind, title, text, links });

const DOCS = [
  doc('ENT-swat', 'entidad', 'SWaT', 'Secure Water Treatment testbed dataset'),
  doc('ENT-gdn', 'entidad', 'GDN', 'Graph Deviation Network method'),
  doc('HE-1', 'hecho', 'GDN en SWaT', 'GDN obtiene F1 0,81 en SWaT con umbral fijo', ['F-1', 'ENT-gdn', 'ENT-swat']),
  doc('HE-2', 'hecho', 'USAD en SWaT', 'USAD obtiene F1 0,79 en SWaT', ['F-2', 'ENT-swat']),
  doc('SIN-1', 'sintesis', 'Nota de lectura GDN', 'Atención sobre sensores para detección de anomalías', ['HE-1']),
  doc('F-1', 'fuente', 'GDN paper', 'PDF', []),
];

test('tokenization folds accents and case and drops stopwords', () => {
  assert.deepEqual(tokenize('La Detección de ANOMALÍAS en el agua'), ['deteccion', 'anomalias', 'agua']);
});

test('a rare term outranks a common one, and accents do not matter', () => {
  const r = search(buildIndex(DOCS), 'umbral swat');
  assert.equal(r.hits[0]!.id, 'HE-1');
  assert.equal(search(buildIndex(DOCS), 'deteccion de anomalias').hits[0]!.id, 'SIN-1');
});

test('an entity filter keeps the entity and what points to it; with no terms all of them match', () => {
  const r = search(buildIndex(DOCS), '', { entidad: 'ENT-swat' });
  assert.deepEqual(r.hits.map(h => h.id).sort(), ['ENT-swat', 'HE-1', 'HE-2']);
});

test('one hop of relations is returned apart and says which hit led to it', () => {
  const r = search(buildIndex(DOCS), 'atencion sensores');
  assert.deepEqual(r.hits.map(h => h.id), ['SIN-1']);
  assert.deepEqual(r.relacionados.map(h => [h.id, h.via]), [['HE-1', 'SIN-1']]);
});

test('an empty base, no matches and truncation are all declared', () => {
  assert.equal(search(buildIndex([]), 'x').vacio, 'base_vacia');
  assert.equal(search(buildIndex(DOCS), 'transformers').vacio, 'sin_coincidencias');
  const r = search(buildIndex(DOCS), 'swat', { k: 1 });
  assert.equal(r.hits.length, 1);
  assert.equal(r.cobertura.truncado, true);
  assert.ok(r.cobertura.coincidencias > 1);
});

test('paper sections are searchable with their page; unready papers are counted, not hidden', t => {
  const { almacen, estructuraSha } = tempAlmacen(t, estructura());
  const ready = { id: 'd1', title: 'GDN paper', status: 'listo', original: { sha256: ORIGINAL_SHA, bytes: 1 }, estructuraSha256: estructuraSha } as never;
  const pending = { id: 'd2', title: 'Otro', status: 'procesando' } as never;
  const s = createKbSearch({ records: () => [], documents: () => [ready, pending], almacen });
  const r = s.search('graph neural network attention');
  assert.equal(r.hits[0]!.id, 'documento:d1#seccion=2;pagina=2');
  assert.equal(r.hits[0]!.locator, 'pdf-v1:p=2');
  assert.equal(r.cobertura.documentosNoListos, 1);
});

test('a query of stopwords alone is declared empty, not a miss', () => {
  assert.equal(search(buildIndex(DOCS), 'de la the of').vacio, 'consulta_vacia');
});

test('an entity filter also keeps paper sections that mention its name or an alias', () => {
  const docs = [
    { ...doc('ENT-swat', 'entidad', 'SWaT', 'dataset'), names: ['SWaT', 'Secure Water Treatment'] },
    doc('documento:d1#s1', 'seccion', 'P › 4', 'We evaluate on the secure water treatment testbed', []),
    doc('documento:d1#s2', 'seccion', 'P › 5', 'Results on WADI', []),
  ];
  assert.deepEqual(search(buildIndex(docs), '', { entidad: 'ENT-swat' }).hits.map(h => h.id).sort(), ['ENT-swat', 'documento:d1#s1']);
});

test('related records beyond k mark the result as truncated', () => {
  const r = search(buildIndex(DOCS), 'gdn swat umbral', { k: 1 });
  assert.equal(r.hits.length, 1);
  assert.equal(r.cobertura.truncado, true);
});
