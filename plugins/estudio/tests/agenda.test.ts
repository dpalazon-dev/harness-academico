/**
 * Agenda del inicio (ticket 05 de la segunda ronda): la operación `agenda`, con
 * `desde` y `hasta` en días locales, devuelve por día lo pendiente (repasos
 * fijados, con los vencidos en hoy, y los pasos propuestos de hoy) y lo hecho
 * (intentos, hechos del ciclo y conversaciones con algún mensaje de David), del
 * espacio activo. Se llama por nombre con el plugin activado, como el armazón.
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

/** Una conversación del núcleo: sus mensajes, de David o del tutor, con su instante. */
interface Chat { id: string; title: string; mensajes: { role: 'user' | 'assistant'; at: string }[] }

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-agenda-'));
  const controller = new AbortController();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const chats = new Map<string, Chat>();
  const lecturas: string[] = [];
  const ultimo = (c: Chat) => c.mensajes.map(m => m.at).sort().at(-1) ?? new Date().toISOString();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on() { return () => {}; } },
    learning: {
      getSession: (id: string) => {
        lecturas.push(id);
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
  return { call, store, chats, lecturas };
}
type F = Awaited<ReturnType<typeof fixture>>;
type Unit = { id: string; revision: number; title: string };

interface Elemento { tipo: string; unitId?: string; titulo: string; [k: string]: unknown }
interface DiaAgenda { dia: string; pendientes: Elemento[]; hecho: Elemento[] }
interface Agenda { hoy: string; desde: string; hasta: string; dias: DiaAgenda[] }

const ZONA = 'Europe/Madrid';
const HOY = () => localDate(new Date().toISOString(), ZONA);
/** Un instante a mediodía del día local `dia`: lejos de la medianoche en cualquier época del año. */
const mediodia = (dia: string) => new Date(`${dia}T11:00:00.000Z`).toISOString();

async function espacio(f: F, name: string): Promise<string> {
  const area = await f.call<{ id: string }>('crear-espacio', { name });
  await f.call('activar-espacio', { areaId: area.id });
  return area.id;
}

async function planCon(f: F, titulos: string[], criterio = false): Promise<Unit[]> {
  const plan = await f.call<{ id: string }>('crear-plan', { goal: 'Dominar grafos' });
  if (titulos.length) await f.call('cambiar-plan', { id: plan.id, expectedRevision: 1, ops: titulos.map(titulo => ({ op: 'add', tipo: 'tema', titulo })) });
  const units: Unit[] = [];
  for (const e of f.store.getPlan(plan.id)!.elementos) {
    const u = await f.call<Unit>('trabajar-tema', { planId: plan.id, elementoId: e.id });
    units.push(await f.call<Unit>('editar-unidad', { id: u.id, expectedRevision: u.revision, capability: `Explicar ${e.titulo}`, ...(criterio ? { criterion: 'Lo explico sin mirar' } : {}) }));
  }
  return units;
}

function intento(store: StudyStore, unitId: string, id: string, at: string, status: 'graded' | 'open' | 'abandoned' = 'graded') {
  store.saveTask({ id: `t-${id}`, revision: 1, unitId, kind: 'libre', prompt: 'Explica', cues: ['1', '2', '3', '4', '5'], reference: 'r', rubric: ['r'], createdAt: at, model: { provider: 'p', id: 'm' } }, null);
  const graded = status === 'graded';
  store.saveAttempt({
    id, revision: 1, unitId, taskId: `t-${id}`, taskKind: 'libre', openedAt: at, confidence: 50,
    cueLevel: 0, cueLevelAtFreeze: graded ? 0 : null, answer: 'a', answerHash: answerHash('a'), frozenAt: graded ? at : null,
    status, contextLabel: 'libre', judgments: [],
    grades: graded ? [{ fidelity: 3, use: null, failureType: null, gradedAt: at, correction: false }] : [],
  }, null);
}

function hecho(store: StudyStore, unitId: string, h: { tipo: 'volcado' | 'cierre-bloque'; fecha: string }) {
  const actual = store.getHechos(unitId);
  const nuevo = h.tipo === 'volcado'
    ? { tipo: 'volcado' as const, fecha: h.fecha, texto: 'Sé que…', origen: 'pagina' as const, chatId: null }
    : { tipo: 'cierre-bloque' as const, fecha: h.fecha, chatId: null };
  store.saveHechos({ id: unitId, revision: (actual?.revision ?? 0) + 1, hechos: [...(actual?.hechos ?? []), nuevo] }, actual?.revision ?? null);
}

function conversacion(f: F, id: string, areaId: string, mensajes: Chat['mensajes'], unitId: string | null = null) {
  f.chats.set(id, { id, title: `Conversación ${id}`, mensajes });
  f.store.saveConversation({ id, revision: 1, briefing: null, briefedAt: null, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId, unitId, origen: null }, null);
}

const dia = (a: Agenda, d: string) => a.dias.find(x => x.dia === d);

test('un día pasado trae lo hecho: intentos, hechos del ciclo y conversaciones con algún mensaje de David; otro espacio no cuenta', async t => {
  const f = await fixture(t);
  const otro = await espacio(f, 'Física');
  const [ajena] = await planCon(f, ['Cinemática']);
  const area = await espacio(f, 'Grafos');
  const [flujo, cortes] = await planCon(f, ['Flujo', 'Cortes']);
  const hoy = HOY();
  const ayer = addDays(hoy, -1), anteayer = addDays(hoy, -2), haceTres = addDays(hoy, -3);

  intento(f.store, flujo!.id, 'i-ayer', mediodia(ayer));
  intento(f.store, cortes!.id, 'i-abandonado', mediodia(ayer), 'abandoned');
  hecho(f.store, cortes!.id, { tipo: 'volcado', fecha: mediodia(ayer) });
  hecho(f.store, flujo!.id, { tipo: 'cierre-bloque', fecha: mediodia(anteayer) });
  conversacion(f, 'c-david', area, [{ role: 'user', at: mediodia(ayer) }, { role: 'assistant', at: mediodia(ayer) }], flujo!.id);
  // Anteayer solo escribió el tutor en esta conversación: no la cuenta ese día.
  conversacion(f, 'c-tutor', area, [{ role: 'user', at: mediodia(addDays(hoy, -5)) }, { role: 'assistant', at: mediodia(anteayer) }]);
  intento(f.store, ajena!.id, 'i-ajeno', mediodia(haceTres));
  conversacion(f, 'c-ajena', otro, [{ role: 'user', at: mediodia(haceTres) }]);

  const agenda = await f.call<Agenda>('agenda', { desde: haceTres, hasta: ayer });
  assert.deepEqual([agenda.hoy, agenda.desde, agenda.hasta], [hoy, haceTres, ayer]);

  const deAyer = dia(agenda, ayer)!;
  assert.deepEqual(deAyer.pendientes, []);
  assert.deepEqual(deAyer.hecho.map(e => [e.tipo, e.titulo]).sort(), [
    ['conversacion', 'Conversación c-david'], ['intento', 'Flujo'], ['volcado', 'Cortes'],
  ], 'el intento abandonado no cuenta');
  assert.deepEqual(dia(agenda, anteayer)!.hecho.map(e => [e.tipo, e.titulo]), [['cierre-bloque', 'Flujo']]);
  assert.deepEqual(dia(agenda, haceTres)?.hecho ?? [], [], 'lo de hace tres días es de otro espacio');
});

function documento(store: StudyStore, id: string, areaId: string) {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  store.saveDocument({
    id, revision: 1, title: `Libro ${id}`, path: `C:/${id}.pdf`, status: 'listo', error: null, startedAt: at, finishedAt: at,
    original: { sha256: 'a'.repeat(64), bytes: 10 }, doclingSha256: null, estructuraSha256: 'b'.repeat(64), paginas: 12, contraste: null, revisar: [], areaId,
  }, null);
}

/** Una unidad con volcado y fuente: su único paso posible es repasar. */
async function lista(f: F, u: Unit, area: string) {
  await f.call('guardar-volcado', { unitId: u.id, texto: 'Sé que…' });
  documento(f.store, `doc-${u.id}`, area);
  await f.call('vincular-documento', { unitId: u.id, expectedRevision: f.store.getUnit(u.id)!.revision, documentId: `doc-${u.id}` });
}

const proximoRepaso = async (f: F, u: Unit) => (await f.call<{ proximoRepaso: string | null }>('unidad', { id: u.id })).proximoRepaso!;

test('hoy trae lo pendiente: el intento a medias, los repasos vencidos con sus días de retraso, los de hoy y los pasos propuestos; un día futuro, sus repasos', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [vencida, futura, aMedias, sinVolcado, nueva] = await planCon(f, ['Flujo', 'Cortes', 'Emparejamientos', 'Árboles', 'Coloreado']);
  for (const u of [vencida!, futura!, aMedias!, nueva!]) await lista(f, u, area);
  const hoy = HOY();
  intento(f.store, vencida!.id, 'i-vencida', mediodia(addDays(hoy, -20)));
  intento(f.store, futura!.id, 'i-futura', new Date(Date.now() - 60_000).toISOString());
  intento(f.store, aMedias!.id, 'i-medias', new Date(Date.now() - 60_000).toISOString(), 'open');

  const fijada = await proximoRepaso(f, vencida!);
  const retraso = Math.round((Date.parse(hoy) - Date.parse(fijada)) / 86_400_000);
  assert.ok(retraso > 0, 'el repaso de «Flujo» está vencido');
  const siguiente = await proximoRepaso(f, futura!);
  assert.ok(siguiente > hoy);

  const agenda = await f.call<Agenda>('agenda', { desde: hoy, hasta: siguiente });
  const deHoy = dia(agenda, hoy)!;
  assert.deepEqual(deHoy.pendientes.map(e => [e.tipo, e.titulo, e.intentoId ?? null, e.vencidoDias ?? null]), [
    ['repaso', 'Emparejamientos', 'i-medias', 0],
    ['repaso', 'Flujo', null, retraso],
    ['paso', 'Árboles', null, null],
  ], 'una unidad nunca practicada no es un repaso; el repaso vencido no se repite como paso');
  assert.equal((deHoy.pendientes[2] as unknown as { paso: { tipo: string } }).paso.tipo, 'volcado');
  assert.equal(deHoy.pendientes[1]!.fecha, fijada);

  const tarea = (await f.call<{ unitId: string; nextTaskKind: string }[]>('ruta')).find(r => r.unitId === futura!.id)!.nextTaskKind;
  assert.deepEqual(dia(agenda, siguiente)!.pendientes.map(e => [e.tipo, e.titulo, e.tarea, e.fecha]), [['repaso', 'Cortes', tarea, siguiente]]);
  assert.deepEqual(agenda.dias.filter(d => d.dia !== hoy && d.dia !== siguiente), [], 'los demás días no traen nada');
});

test('un rango que no incluye hoy no trae vencidos ni pasos', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [vencida] = await planCon(f, ['Flujo', 'Árboles']);
  await lista(f, vencida!, area);
  const hoy = HOY();
  intento(f.store, vencida!.id, 'i-vencida', mediodia(addDays(hoy, -20)));
  const agenda = await f.call<Agenda>('agenda', { desde: addDays(hoy, 1), hasta: addDays(hoy, 6) });
  assert.deepEqual(agenda.dias, []);
});

test('responde a un solo día y a varias semanas que cruzan hoy, con lo hecho atrás y los repasos delante', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [flujo] = await planCon(f, ['Flujo']);
  await lista(f, flujo!, area);
  const hoy = HOY();
  const haceDosSemanas = addDays(hoy, -14);
  intento(f.store, flujo!.id, 'i-reciente', new Date(Date.now() - 60_000).toISOString());
  hecho(f.store, flujo!.id, { tipo: 'cierre-bloque', fecha: mediodia(haceDosSemanas) });
  const siguiente = await proximoRepaso(f, flujo!);

  const semanas = await f.call<Agenda>('agenda', { desde: addDays(hoy, -21), hasta: addDays(hoy, 21) });
  assert.deepEqual(semanas.dias.map(d => [d.dia, d.hecho.map(e => e.tipo), d.pendientes.map(e => e.tipo)]), [
    [haceDosSemanas, ['cierre-bloque'], []],
    [hoy, ['intento', 'volcado'], []],
    [siguiente, [], ['repaso']],
  ]);

  const unDia = await f.call<Agenda>('agenda', { desde: haceDosSemanas, hasta: haceDosSemanas });
  assert.deepEqual(unDia.dias.map(d => d.dia), [haceDosSemanas]);
});

test('rechaza fechas mal formadas, un rango al revés y más de un año', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const hoy = HOY();
  for (const input of [undefined, { desde: hoy }, { desde: '14-11-2026', hasta: hoy }, { desde: '2026-02-30', hasta: '2026-03-01' }, { desde: hoy, hasta: addDays(hoy, -1) }, { desde: hoy, hasta: addDays(hoy, 366) }]) {
    await assert.rejects(f.call('agenda', input), { code: 'INVALID_INPUT' }, JSON.stringify(input));
  }
  assert.equal((await f.call<Agenda>('agenda', { desde: hoy, hasta: addDays(hoy, 365) })).hasta, addDays(hoy, 365));
});

test('un espacio sin nada no devuelve ningún día, tampoco hoy', async t => {
  const f = await fixture(t);
  await espacio(f, 'Vacío');
  const hoy = HOY();
  assert.deepEqual((await f.call<Agenda>('agenda', { desde: addDays(hoy, -3), hasta: addDays(hoy, 3) })).dias, []);
});

test('cada conversación se lee una vez por versión: releer la agenda no abre de nuevo su transcripción', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const hoy = HOY();
  const ayer = addDays(hoy, -1);
  conversacion(f, 'c1', area, [{ role: 'user', at: mediodia(addDays(hoy, -2)) }]);
  const rango = { desde: addDays(hoy, -6), hasta: hoy };
  await f.call('agenda', rango);
  await f.call('agenda', rango);
  assert.deepEqual(f.lecturas.filter(id => id === 'c1'), ['c1']);

  f.chats.get('c1')!.mensajes.push({ role: 'user', at: mediodia(ayer) });
  const despues = await f.call<Agenda>('agenda', rango);
  assert.deepEqual(f.lecturas.filter(id => id === 'c1'), ['c1', 'c1'], 'con un mensaje nuevo, se relee');
  assert.deepEqual(dia(despues, ayer)!.hecho.map(e => e.tipo), ['conversacion']);
});
