/**
 * La pantalla de intento del armazón (ticket 06) usa las mismas operaciones
 * que la vista antigua (`empezar`, `guardar-respuesta`, `congelar`,
 * `autoevaluar`) y una lectura nueva, `intento`, para retomar o revisar un
 * intento sin volver a pedir la confianza. Aquí se comprueba que la evidencia
 * llega al regulador como antes y que la lectura no adelanta la referencia.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { activate } from '../src/backend.ts';

const TAREA = { prompt: 'Explica por qué Dijkstra no admite pesos negativos.', cues: ['c1', 'c2', 'c3', 'c4', 'c5'], reference: 'Porque fija distancias definitivas.', rubric: ['Distancias definitivas'] };

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-intento-'));
  const controller = new AbortController();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on() { return () => {}; } },
    learning: { getSession: () => null, listSessions: () => [] },
    registerInstructions() { return () => {}; },
    registerTools() { return () => {}; },
    inference: {
      async catalog() { return { slots: { strong: { model: { provider: 'test', id: 'strong' } } } }; },
      async complete(request: { context: { systemPrompt: string } }) {
        const json = request.context.systemPrompt.includes('generador de tareas') ? TAREA : { fidelity: 2, failureType: 'precision', rationale: 'Le falta el porqué.' };
        return { stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(json) }] };
      },
    },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  return async <T>(name: string, input?: unknown) => await handlers.get(name)!(input) as T;
}

interface Publico { attempt: { id: string; unitId: string; status: string; answer: string; confidence: number }; prompt: string; reference: string | null; rubric: string[] | null; titulo?: string }
interface Unidad { intentos: { id: string; estado: string; fidelidad: number | null }[]; proximoRepaso: string | null; ciclo: { mantener: string } }

test('un intento hecho desde la pantalla llega al regulador como antes', async t => {
  const call = await fixture(t);
  const unidad = await call<{ id: string }>('crear-unidad', { title: 'Caminos mínimos' });
  const antes = await call<Unidad>('unidad', { id: unidad.id });
  assert.equal(antes.proximoRepaso, null);

  const abierto = await call<Publico>('empezar', { unitId: unidad.id, confidence: 60 });
  const leido = await call<Publico>('intento', { attemptId: abierto.attempt.id });
  assert.equal(leido.titulo, 'Caminos mínimos');
  assert.equal(leido.prompt, TAREA.prompt);
  assert.equal(leido.reference, null, 'antes de congelar no sale la referencia');
  assert.equal(leido.rubric, null);

  await call('guardar-respuesta', { attemptId: abierto.attempt.id, answer: 'Porque una vez fijada una distancia no se revisa.' });
  const retomado = await call<Publico>('intento', { attemptId: abierto.attempt.id });
  assert.equal(retomado.attempt.answer, 'Porque una vez fijada una distancia no se revisa.', 'un intento a medias conserva la respuesta');
  const otraVez = await call<Publico>('empezar', { unitId: unidad.id, confidence: 10 });
  assert.equal(otraVez.attempt.id, abierto.attempt.id, 'practicar de nuevo retoma el intento abierto');
  assert.equal(otraVez.attempt.confidence, 60);

  const congelado = await call<{ attempt: Publico; warning: string | null }>('congelar', { attemptId: abierto.attempt.id });
  assert.equal(congelado.warning, null);
  assert.equal(congelado.attempt.reference, TAREA.reference);
  assert.equal((await call<Unidad>('unidad', { id: unidad.id })).intentos[0]?.estado, 'frozen');

  await call('autoevaluar', { attemptId: abierto.attempt.id, fidelity: 2, failureType: 'precision' });
  const despues = await call<Unidad>('unidad', { id: unidad.id });
  assert.deepEqual(despues.intentos.map(i => [i.id, i.estado, i.fidelidad]), [[abierto.attempt.id, 'graded', 2]]);
  assert.match(despues.proximoRepaso ?? '', /^\d{4}-\d{2}-\d{2}$/, 'el regulador fija el próximo repaso');
  const progreso = await call<{ units: { unitId: string; trace: { fidelity?: number }[] }[] }>('progreso');
  assert.equal(progreso.units.find(u => u.unitId === unidad.id)?.trace.length, 1, 'la traza del regulador recoge el intento');

  const revisado = await call<Publico>('intento', { attemptId: abierto.attempt.id });
  assert.equal(revisado.attempt.status, 'graded');
  assert.equal(revisado.reference, TAREA.reference);
});

test('la lectura de intento rechaza un intento que no existe y entradas extrañas', async t => {
  const call = await fixture(t);
  await assert.rejects(async () => call('intento', { attemptId: 'nope' }), /does not exist/);
  await assert.rejects(async () => call('intento', { attemptId: 'nope', extra: 1 }), /not allowed/);
});
