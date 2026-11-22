import assert from 'node:assert/strict';
import test from 'node:test';
import { autorKbol, nombreEstudiante } from '../src/identidad.ts';

test('el nombre sale de ESTUDIO_NOMBRE o del usuario de Windows con mayúscula; sin ninguno, neutro', () => {
  assert.equal(nombreEstudiante({ ESTUDIO_NOMBRE: '  Lucía Pérez ' }, () => 'david'), 'Lucía Pérez');
  assert.equal(nombreEstudiante({}, () => 'david'), 'David');
  assert.equal(nombreEstudiante({ ESTUDIO_NOMBRE: '' }, () => 'ana'), 'Ana');
  assert.equal(nombreEstudiante({}, () => { throw new Error('sin usuario'); }), 'Estudiante');
});

test('el autor KBOL es human:<slug> sin tildes ni espacios, y en el equipo de David sigue siendo human:david', () => {
  assert.equal(autorKbol('David'), 'human:david');
  assert.equal(autorKbol('Lucía Pérez'), 'human:lucia-perez');
  assert.equal(autorKbol('***'), 'human:estudiante');
  assert.match(autorKbol('José María O\'Neill'), /^human:\S+$/);
});
