/**
 * Ritmo de estudio (ticket 06 de la segunda ronda): la operación `ritmo` devuelve,
 * del espacio activo, los días estudiados en las últimas 4 semanas, la racha
 * actual, los repasos hechos a tiempo (reconstruidos rehaciendo la traza del
 * regulador), los intentos valorados por semana con su tendencia y la actividad
 * diaria de 365 días. Día estudiado es el de la agenda. Se llama por nombre con el
 * plugin activado, como la agenda.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { activate } from '../src/backend.ts';
import { addDays, localDate } from '../src/assessment/calendar.ts';
import { openStudyStore, type StudyStore } from '../src/study/store.ts';
import { answerHash } from '../src/practice/schema.ts';
import type { LecturaRitmo as Ritmo } from '../src/ritmo.ts';

interface Chat { id: string; title: string; mensajes: { role: 'user' | 'assistant'; at: string }[] }

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-ritmo-'));
  const controller = new AbortController();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const chats = new Map<string, Chat>();
  const ultimo = (c: Chat) => c.mensajes.map(m => m.at).sort().at(-1) ?? new Date().toISOString();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on() { return () => {}; } },
    learning: {
      getSession: (id: string) => {
        const c = chats.get(id);
        return c ? {
          id: c.id, title: c.title, createdAt: c.mensajes[0]?.at, updatedAt: ultimo(c),
          messages: c.mensajes.map((m, i) => ({ id: `${c.id}-${i}`, role: m.role, content: 'x', timestamp: Date.parse(m.at) })),
        } : null;
      },
      listSessions: () => [...chats.values()].map(c => ({ id: c.id, title: c.title, createdAt: c.mensajes[0]?.at, updatedAt: ultimo(c), kind: 'teach', messageCount: c.mensajes.length, busy: false })),
    },
    registerInstructions() { return () => {}; },
    registerTools() { return () => {}; },
    inference: { async catalog() { return { slots: {} }; }, async complete() { throw new Error('sin modelo en estas pruebas'); } },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  const store = openStudyStore(path.join(ctx.dataDirectory, 'study'));
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async <T>(name: string, input?: unknown) => await handlers.get(name)!(input) as T;
  return { call, store, chats };
}
type F = Awaited<ReturnType<typeof fixture>>;
type Unit = { id: string; revision: number; title: string };


const ZONA = 'Europe/Madrid';
const HOY = () => localDate(new Date().toISOString(), ZONA);
const mediodia = (dia: string) => new Date(`${dia}T11:00:00.000Z`).toISOString();

async function espacio(f: F, name: string): Promise<string> {
  const area = await f.call<{ id: string }>('crear-espacio', { name });
  await f.call('activar-espacio', { areaId: area.id });
  return area.id;
}

async function unidades(f: F, titulos: string[]): Promise<Unit[]> {
  const units: Unit[] = [];
  for (const title of titulos) units.push(await f.call<Unit>('crear-unidad', { title, capability: `Explicar ${title}` }));
  return units;
}

/** Un intento valorado sin ayuda; con fidelidad 3 es un éxito y, si es elegible, alarga el intervalo del regulador. */
function intento(store: StudyStore, unitId: string, id: string, at: string, fidelity: 0 | 1 | 2 | 3 = 3, juicioDelModelo: 0 | 1 | 2 | 3 | null = null) {
  store.saveTask({ id: `t-${id}`, revision: 1, unitId, kind: 'libre', prompt: 'Explica', cues: ['1', '2', '3', '4', '5'], reference: 'r', rubric: ['r'], createdAt: at, model: { provider: 'p', id: 'm' } }, null);
  store.saveAttempt({
    id, revision: 1, unitId, taskId: `t-${id}`, taskKind: 'libre', openedAt: at, confidence: 50,
    cueLevel: 0, cueLevelAtFreeze: 0, answer: 'a', answerHash: answerHash('a'), frozenAt: at,
    status: 'graded', contextLabel: 'libre',
    judgments: juicioDelModelo === null ? [] : [{ fidelity: juicioDelModelo, failureType: null, rationale: 'r', judgedAt: at, model: { provider: 'p', id: 'm' } }],
    grades: [{ fidelity, use: null, failureType: null, gradedAt: at, correction: false }],
  }, null);
}

function volcado(store: StudyStore, unitId: string, fecha: string) {
  const actual = store.getHechos(unitId);
  const nuevo = { tipo: 'volcado' as const, fecha, texto: 'Sé que…', origen: 'pagina' as const, chatId: null };
  store.saveHechos({ id: unitId, revision: (actual?.revision ?? 0) + 1, hechos: [...(actual?.hechos ?? []), nuevo] }, actual?.revision ?? null);
}

function conversacion(f: F, id: string, areaId: string, mensajes: Chat['mensajes']) {
  f.chats.set(id, { id, title: `Conversación ${id}`, mensajes });
  f.store.saveConversation({ id, revision: 1, briefing: null, briefedAt: null, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId, unitId: null, origen: null }, null);
}

test('sin actividad, todo a cero y 365 días de actividad vacía que acaban hoy', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const hoy = HOY();
  const r = await f.call<Ritmo>('ritmo');
  assert.equal(r.hoy, hoy);
  assert.equal(r.diasEstudiados, 0);
  assert.equal(r.racha, 0);
  assert.deepEqual(r.repasos, { total: 0, aTiempo: 0 });
  assert.deepEqual(r.intentosPorSemana, [0, 0, 0, 0]);
  assert.equal(r.tendencia, 'igual');
  assert.equal(r.actividad.length, 365);
  assert.deepEqual([r.actividad[0]!.dia, r.actividad.at(-1)!.dia], [addDays(hoy, -364), hoy]);
  assert.ok(r.actividad.every(d => d.n === 0));
});

test('días estudiados y racha con la definición de la agenda; otro espacio no cuenta', async t => {
  const f = await fixture(t);
  const otro = await espacio(f, 'Física');
  const [ajena] = await unidades(f, ['Cinemática']);
  const area = await espacio(f, 'Grafos');
  const [flujo, cortes] = await unidades(f, ['Flujo', 'Cortes']);
  const hoy = HOY(), d = (n: number) => mediodia(addDays(hoy, -n));

  intento(f.store, flujo!.id, 'i-hoy', d(0));
  volcado(f.store, cortes!.id, d(1));
  intento(f.store, cortes!.id, 'i-ayer', d(1));
  conversacion(f, 'c-david', area, [{ role: 'user', at: d(2) }, { role: 'assistant', at: d(2) }]);
  // Solo escribió el tutor: hace tres días no se estudió y la racha se corta ahí.
  conversacion(f, 'c-tutor', area, [{ role: 'user', at: d(40) }, { role: 'assistant', at: d(3) }]);
  volcado(f.store, flujo!.id, d(5));
  // Fuera de las cuatro semanas: cuenta en la actividad, no en los días estudiados.
  volcado(f.store, flujo!.id, d(30));
  intento(f.store, ajena!.id, 'i-ajeno', d(3));
  conversacion(f, 'c-ajena', otro, [{ role: 'user', at: d(3) }]);

  const r = await f.call<Ritmo>('ritmo');
  assert.equal(r.diasEstudiados, 4);
  assert.equal(r.racha, 3);
  const n = (k: number) => r.actividad.find(x => x.dia === addDays(hoy, -k))!.n;
  assert.deepEqual([0, 1, 2, 3, 5, 30, 40].map(n), [1, 2, 1, 0, 1, 1, 1]);
});

test('si hoy aún no se estudió, la racha llega hasta ayer; sin ayer ni hoy, es cero', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [flujo] = await unidades(f, ['Flujo']);
  const hoy = HOY(), d = (n: number) => mediodia(addDays(hoy, -n));
  volcado(f.store, flujo!.id, d(1));
  volcado(f.store, flujo!.id, d(2));
  assert.equal((await f.call<Ritmo>('ritmo')).racha, 2);

  const g = await fixture(t);
  await espacio(g, 'Grafos');
  const [cortes] = await unidades(g, ['Cortes']);
  volcado(g.store, cortes!.id, d(2));
  volcado(g.store, cortes!.id, d(3));
  const r = await g.call<Ritmo>('ritmo');
  assert.equal(r.racha, 0);
  assert.equal(r.diasEstudiados, 2);
});

test('«a tiempo» rehace las fechas del regulador: el primer intento no es repaso, un repaso tardío no cuenta y la práctica adelanta la fecha', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [flujo, cortes, redes, sola] = await unidades(f, ['Flujo', 'Cortes', 'Redes', 'Sola']);
  const d = (n: number) => mediodia(addDays(HOY(), -n));

  // Flujo: el éxito de hace 20 días fija hace 18 (2 días); el de hace 18 fija hace 11 (7 días) y llega hace 8, tarde.
  intento(f.store, flujo!.id, 'f1', d(20));
  intento(f.store, flujo!.id, 'f2', d(18));
  intento(f.store, flujo!.id, 'f3', d(8));
  // Cortes: su repaso tardío de hace 50 días queda fuera de las cuatro semanas; el de hace 10 llega tarde a hace 43.
  intento(f.store, cortes!.id, 'c1', d(60));
  intento(f.store, cortes!.id, 'c2', d(50));
  intento(f.store, cortes!.id, 'c3', d(10));
  // Redes: hace 26 fija hace 24, a tiempo; hace 24 fija hace 17, pero el fallo en práctica de hace 23 (tras una
  // exposición) lo adelanta a hace 22, y el repaso de hace 19, que habría ido a tiempo, llega tarde.
  intento(f.store, redes!.id, 'r1', d(26));
  intento(f.store, redes!.id, 'r2', d(24));
  f.store.saveExposures({ id: redes!.id, revision: 1, instants: [new Date(Date.parse(d(23)) - 3_600_000).toISOString()] }, null);
  intento(f.store, redes!.id, 'r3', d(23), 1);
  intento(f.store, redes!.id, 'r4', d(19));
  // Sola: un único intento, ningún repaso.
  intento(f.store, sola!.id, 's1', d(3));

  const r = await f.call<Ritmo>('ritmo');
  // A tiempo: f2 y r2. Tarde: f3, c3 y r4.
  assert.deepEqual(r.repasos, { total: 5, aTiempo: 2 });
});

test('sin repasos, el total es cero aunque haya intentos', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [flujo, cortes] = await unidades(f, ['Flujo', 'Cortes']);
  intento(f.store, flujo!.id, 'f1', mediodia(addDays(HOY(), -2)));
  intento(f.store, cortes!.id, 'c1', mediodia(HOY()));
  assert.deepEqual((await f.call<Ritmo>('ritmo')).repasos, { total: 0, aTiempo: 0 });
});

test('intentos valorados por semana, de la más antigua a la actual, y su tendencia frente a la media de las anteriores', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [flujo] = await unidades(f, ['Flujo']);
  const d = (n: number) => mediodia(addDays(HOY(), -n));
  // Semana actual: hoy a hace 6; la anterior, hace 7 a 13; y así. Hace 28 ya no entra.
  for (const [i, n] of [0, 6, 7, 13, 14, 15, 16, 21, 28].entries()) intento(f.store, flujo!.id, `i${i}`, d(n));
  const r = await f.call<Ritmo>('ritmo');
  assert.deepEqual(r.intentosPorSemana, [1, 3, 2, 2]);
  assert.equal(r.tendencia, 'igual');

  intento(f.store, flujo!.id, 'extra', d(1));
  assert.equal((await f.call<Ritmo>('ritmo')).tendencia, 'sube');
  intento(f.store, flujo!.id, 'vieja1', d(22));
  intento(f.store, flujo!.id, 'vieja2', d(23));
  intento(f.store, flujo!.id, 'vieja3', d(24));
  intento(f.store, flujo!.id, 'vieja4', d(25));
  assert.equal((await f.call<Ritmo>('ritmo')).tendencia, 'baja');
});

test('una valoración discutida con el modelo fija la verificación al día siguiente, y el repaso que llega después va tarde', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [flujo] = await unidades(f, ['Flujo']);
  const d = (n: number) => mediodia(addDays(HOY(), -n));
  // Hace 20 fija hace 18; el de hace 18, con el modelo en 0 frente a un 3, pide verificar hace 17 en lugar de hace 11.
  intento(f.store, flujo!.id, 'v1', d(20));
  intento(f.store, flujo!.id, 'v2', d(18), 3, 0);
  intento(f.store, flujo!.id, 'v3', d(15));
  assert.deepEqual((await f.call<Ritmo>('ritmo')).repasos, { total: 2, aTiempo: 1 });
});
