import assert from 'node:assert/strict';
import test from 'node:test';
import { comprobarKbol, errorDeUv } from '../src/kbol-requisitos.ts';

test('sin KBOL o sin el uv indicado, el error dice qué falta y cómo instalarlo', () => {
  assert.throws(() => comprobarKbol('Incorporar un PDF', { kbolDir: 'C:/no/KBOL', uv: 'uv' }, 'tools', () => false),
    (e: Error) => /Incorporar un PDF necesita KBOL y uv/.test(e.message) && /KBOL en/.test(e.message) && /docs\.astral\.sh\/uv/.test(e.message));
  assert.throws(() => comprobarKbol('Guardar', { kbolDir: 'C:/KBOL', uv: 'C:/no/uv.exe' }, '.', f => !String(f).includes('uv.exe')), /uv en C:\/no\/uv\.exe/);
  assert.doesNotThrow(() => comprobarKbol('Guardar', { kbolDir: 'C:/KBOL', uv: 'uv' }, '.', () => true));
});

test('un uv sin ruta que no está en el PATH da la misma guía; otros errores no se traducen', () => {
  const enoent = Object.assign(new Error('spawn uv ENOENT'), { code: 'ENOENT' });
  assert.match(errorDeUv('uv', enoent)!, /No encuentro uv en el PATH/);
  assert.equal(errorDeUv('C:/x/uv.exe', enoent), null);
  assert.equal(errorDeUv('uv', Object.assign(new Error('x'), { code: 'EACCES' })), null);
});
