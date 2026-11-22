import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readArtifact, readEstructura } from '../src/documents/almacen.ts';
import { pageText, parseEstructura, unitKind } from '../src/documents/estructura.ts';
import { estructura, tempAlmacen } from './documents-fixtures.ts';

test('the unit kind comes from the key suffix', () => {
  assert.deepEqual(['seccion=1;pagina=1', 'seccion=1;tabla=2', 'seccion=3;figura=1', 'seccion=0;pagina=4'].map(unitKind), ['seccion', 'tabla', 'figura', 'seccion']);
});

test('page text joins every unit on the page, tables and figures included; a missing page is null', () => {
  assert.equal(pageText(estructura(), 1), '1 Introduction\nAnomaly detection in water treatment plants is hard.\nSWaT F1 0.89');
  assert.match(pageText(estructura(), 2)!, /Figure 1: Architecture/);
  assert.equal(pageText(estructura(), 3), null);
});

test('the store returns an artifact only when its bytes match its hash', t => {
  const { almacen, estructuraSha } = tempAlmacen(t);
  assert.equal(readEstructura(almacen, estructuraSha).unidades.length, 4);
  fs.appendFileSync(path.join(almacen, 'sha256', estructuraSha), ' ');
  assert.throws(() => readArtifact(almacen, estructuraSha), /no coincide con su huella/);
  assert.throws(() => readArtifact(almacen, 'a'.repeat(64)), /no está en el almacén/);
  assert.throws(() => readArtifact(almacen, '../x'), /Huella no válida/);
});

test('only estructura-v1 with pages, units and an original hash is accepted', () => {
  assert.throws(() => parseEstructura({ ...estructura(), perfil: 'otro' }), /no es estructura-v1/);
  assert.throws(() => parseEstructura({ ...estructura(), original_sha256: 'x' }), /huella del original/);
  assert.throws(() => parseEstructura({ ...estructura(), unidades: [{ clave: 1 }] }), /mal formada/);
});
