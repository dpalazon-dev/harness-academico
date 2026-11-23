/**
 * Inicio completo (ticket 07, ADR 0004): el paso propuesto de cada unidad con
 * la prioridad de la spec, y la lectura del inicio del espacio activo (paso
 * principal y demás, repasos de hoy, próximos 7 días y lo que quedó abierto)
 * y lo pendiente de decidir (`por-decidir`, ticket 02 de la segunda ronda),
 * llamadas por nombre con el plugin activado, como las llama el armazón.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { activate } from '../src/backend.ts';
import { pasoDe, type LecturaUnidad } from '../src/armazon.ts';
import { openStudyStore, type StudyStore } from '../src/study/store.ts';
import { answerHash } from '../src/practice/schema.ts';

interface Chat { id: string; title: string; updatedAt: string; messages: number }

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-inicio-'));
  const controller = new AbortController();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const chats = new Map<string, Chat>();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on() { return () => {}; } },
    learning: {
      getSession: (id: string) => {
        const c = chats.get(id);
        return c ? { id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, messages: [] } : null;
      },
      listSessions: () => [...chats.values()].map(c => ({ id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, kind: 'teach', messageCount: c.messages, busy: false })),
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
type TipoPaso = 'decidir' | 'volcado' | 'reconstruir' | 'repasar' | 'tutor';
interface Paso { tipo: TipoPaso; accion: string; motivo: string; boton: string; unitId: string; titulo: string }
interface Inicio {
  paso: Paso | null;
  pasos: Paso[];
  repasos: { unitId: string; titulo: string; tarea: string; intentoId: string | null; fecha: string | null }[];
  proximos: { dia: string; unidades: { unitId: string; titulo: string; tarea: string }[] }[];
  abierto: { chatId: string; titulo: string; abierto: string[]; siguiente: string } | null;
}
interface PorDecidir {
  planes: { id: string; revision: number; objetivo: string; elementos: number }[];
  cambios: { id: string; planId: string; objetivo: string; descripcion: string[]; motivo: string; caducado: string | null }[];
  sugerencias: { unitId: string; revision: number; titulo: string; capacidad: string; criterio: string }[];
  borradores: { id: string; tipo: string; resumen: string; origen: string; registros: number }[];
}

const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000).toISOString();
const DIA = 60 * 24;

function documento(store: StudyStore, id: string, title: string, areaId: string | null) {
  store.saveDocument({
    id, revision: 1, title, path: `C:/${id}.pdf`, status: 'listo', error: null, startedAt: hace(600), finishedAt: hace(590),
    original: { sha256: 'a'.repeat(64), bytes: 10 }, doclingSha256: null, estructuraSha256: 'b'.repeat(64), paginas: 12, contraste: null, revisar: [], areaId,
  }, null);
}

function intento(store: StudyStore, unitId: string, id: string, at: string, status: 'graded' | 'open' = 'graded') {
  store.saveTask({ id: `t-${id}`, revision: 1, unitId, kind: 'libre', prompt: 'Explica', cues: ['1', '2', '3', '4', '5'], reference: 'r', rubric: ['r'], createdAt: at, model: { provider: 'p', id: 'm' } }, null);
  const graded = status === 'graded';
  store.saveAttempt({
    id, revision: 1, unitId, taskId: `t-${id}`, taskKind: 'libre', openedAt: at, confidence: 50,
    cueLevel: 0, cueLevelAtFreeze: graded ? 0 : null, answer: 'a', answerHash: answerHash('a'), frozenAt: graded ? at : null,
    status, contextLabel: 'libre', judgments: [],
    grades: graded ? [{ fidelity: 3, use: null, failureType: null, gradedAt: at, correction: false }] : [],
  }, null);
}

async function espacio(f: F, name: string): Promise<string> {
  const area = await f.call<{ id: string }>('crear-espacio', { name });
  await f.call('activar-espacio', { areaId: area.id });
  return area.id;
}

/** Un plan con un tema por título, cada uno ya convertido en unidad con «Trabajar». */
async function planCon(f: F, titulos: string[]): Promise<Unit[]> {
  const plan = await f.call<{ id: string }>('crear-plan', { goal: 'Dominar grafos' });
  if (titulos.length) await f.call('cambiar-plan', { id: plan.id, expectedRevision: 1, ops: titulos.map(titulo => ({ op: 'add', tipo: 'tema', titulo })) });
  const units: Unit[] = [];
  for (const e of f.store.getPlan(plan.id)!.elementos) {
    const u = await f.call<Unit>('trabajar-tema', { planId: plan.id, elementoId: e.id });
    units.push(await f.call<Unit>('editar-unidad', { id: u.id, expectedRevision: u.revision, capability: `Explicar ${e.titulo}` }));
  }
  return units;
}

/** El plan y el tema enlazados a una unidad. */
function temaDe(f: F, unitId: string) {
  const plan = f.store.listPlans().find(p => p.elementos.some(e => e.unitId === unitId))!;
  return { plan, elementoId: plan.elementos.find(e => e.unitId === unitId)!.id };
}

const volcado = (f: F, u: Unit) => f.call('guardar-volcado', { unitId: u.id, texto: 'Sé que…' });
async function fuente(f: F, u: Unit, docId: string, area: string, capturas: number) {
  documento(f.store, docId, `Libro ${docId}`, area);
  const actual = f.store.getUnit(u.id)!;
  await f.call('vincular-documento', { unitId: u.id, expectedRevision: actual.revision, documentId: docId });
  if (capturas > 0) await f.call('registrar-fuente-trabajada', { unitId: u.id, documentId: docId, capturas });
}

// La prioridad, sobre la lectura de la unidad: cada caso deja de aplicar el anterior.
type Entrada = Parameters<typeof pasoDe>[0];
const base: Entrada = {
  estado: 'activa', volcado: { texto: 'x', fecha: '2026-11-01T10:00:00Z', origen: 'pagina' },
  fuentes: [{ path: 'documento:d', documentoId: 'd', titulo: 'Cormen', paginas: 1, localizador: null, capturas: 0, ultimaCaptura: null, reconstruida: false }],
  proximoRepaso: null, etapa: { kind: 'intervalo', label: 'Recuperada · intervalo de 4 días', days: 4 } as LecturaUnidad['etapa'],
};
const HOY = '2026-11-13';

test('el paso propuesto sigue la prioridad de la spec: propuesta, sin volcado, fuente sin reconstruir, repaso vencido, sin fuentes, nada', () => {
  const capturada = { ...base.fuentes[0]!, capturas: 5 };
  const todo: Entrada = { ...base, estado: 'propuesta', volcado: null, fuentes: [capturada], proximoRepaso: '2026-11-10' };
  assert.equal(pasoDe(todo, HOY)?.tipo, 'decidir');
  assert.equal(pasoDe({ ...todo, estado: 'activa' }, HOY)?.tipo, 'volcado');
  const reconstruir = pasoDe({ ...todo, estado: 'activa', volcado: base.volcado }, HOY);
  assert.equal(reconstruir?.tipo, 'reconstruir');
  assert.equal(reconstruir?.motivo, 'Capturaste 5 notas de «Cormen» y aún no lo has reconstruido.');
  const repaso = pasoDe({ ...base, proximoRepaso: '2026-11-10' }, HOY);
  assert.deepEqual([repaso?.tipo, repaso?.motivo], ['repasar', 'El regulador lo fijó para el 10 nov: recuperada · intervalo de 4 días.']);
  assert.equal(pasoDe({ ...base, proximoRepaso: HOY }, HOY)?.motivo, 'El regulador lo fijó para hoy: recuperada · intervalo de 4 días.');
  assert.equal(pasoDe({ ...base, proximoRepaso: '2026-11-14' }, HOY), null, 'un repaso futuro no es un paso');
  assert.equal(pasoDe({ ...base, fuentes: [] }, HOY)?.tipo, 'tutor');
  assert.equal(pasoDe(base, HOY), null);
  assert.equal(pasoDe({ ...base, fuentes: [{ ...capturada, reconstruida: true }] }, HOY), null, 'una fuente ya reconstruida no pide nada');
  assert.equal(pasoDe({ ...todo, estado: 'archivada' }, HOY), null);
  for (const p of [pasoDe(todo, HOY), pasoDe({ ...base, fuentes: [] }, HOY)]) assert.ok(p!.accion && p!.motivo && p!.boton);
});

test('la lectura de unidad lleva su paso propuesto', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [u] = await planCon(f, ['Caminos mínimos']);
  assert.equal((await f.call<{ paso: Paso | null }>('unidad', { id: u!.id })).paso?.tipo, 'volcado');
  await volcado(f, u!);
  assert.equal((await f.call<{ paso: Paso | null }>('unidad', { id: u!.id })).paso?.tipo, 'tutor');
  await fuente(f, u!, 'doc-1', area, 3);
  const paso = (await f.call<{ paso: Paso | null }>('unidad', { id: u!.id })).paso;
  assert.deepEqual([paso?.tipo, paso?.motivo], ['reconstruir', 'Capturaste 3 notas de «Libro doc-1» y aún no lo has reconstruido.']);
});

test('el inicio lee el espacio activo: paso principal de la primera unidad del plan con uno, demás pasos, repasos, semana y lo abierto; lo pendiente de decidir va aparte', async t => {
  const f = await fixture(t);
  const otro = await espacio(f, 'Física');
  const [ajena] = await planCon(f, ['Cinemática']);
  const area = await espacio(f, 'Grafos');
  const [sinPaso, sinVolcado, capturada, vencida, semana, aMedias] = await planCon(f, ['Recorridos', 'Árboles', 'Caminos mínimos', 'Flujo', 'Coloreado', 'Emparejamientos']);
  await volcado(f, sinPaso!);
  await fuente(f, sinPaso!, 'doc-0', area, 0);
  await volcado(f, capturada!);
  await fuente(f, capturada!, 'doc-1', area, 4);
  await volcado(f, vencida!);
  await fuente(f, vencida!, 'doc-2', area, 0);
  intento(f.store, vencida!.id, 'v1', hace(10 * DIA));
  await volcado(f, semana!);
  await fuente(f, semana!, 'doc-3', area, 0);
  intento(f.store, semana!.id, 's1', hace(10));
  await volcado(f, aMedias!);
  await fuente(f, aMedias!, 'doc-4', area, 0);
  intento(f.store, aMedias!.id, 'm1', hace(5), 'open');

  // Pendiente de decidir: un plan propuesto, un cambio del plan del tutor, una sugerencia de capacidad y un borrador.
  const { plan: grafos, elementoId: recorridos } = temaDe(f, sinPaso!.id);
  f.store.savePlan({ id: 'propuesto-1', revision: 1, createdAt: hace(2), updatedAt: hace(2), goal: 'Planaridad', estado: 'propuesto', elementos: [{ id: 'e1', tipo: 'tema', titulo: 'Kuratowski', hecho: false }], origen: 'tutor', chatId: 'c-x', areaId: area }, null);
  f.store.saveProposal({
    id: 'cambio-1', revision: 1, planId: grafos.id, baseRevision: grafos.revision,
    ops: [{ op: 'remove', elementoId: recorridos }], rationale: 'Ya lo dominas.', author: 'tutor', status: 'pendiente', createdAt: hace(1),
  }, null);
  const arboles = f.store.getUnit(sinVolcado!.id)!;
  f.store.saveUnit({ ...arboles, revision: arboles.revision + 1, sugerencia: { capability: 'Recorrer un árbol', criterion: 'Sin mirar', chatId: 'c-x', createdAt: hace(1) } }, arboles.revision);
  f.store.saveDraft({ id: 'draft-1', revision: 1, kind: 'hecho', summary: 'GDN obtiene F1 0,81 en SWaT.', origin: 'tutor', status: 'pendiente', createdAt: hace(1), commit: null, records: [{ record: { id: 'HE-1', type: 'hecho', title: 'GDN en SWaT' } as never, body: '' }] }, null);

  // Lo que quedó abierto: la conversación más reciente del espacio con algo abierto en su resumen.
  const conversacion = (id: string, title: string, updatedAt: string, abierto: string[], areaId: string) => {
    f.chats.set(id, { id, title, updatedAt, messages: 4 });
    f.store.saveConversation({
      id, revision: 1, briefing: null, briefedAt: null, summaryOf: updatedAt, summarizedAt: updatedAt, summaryError: null, areaId, unitId: null, origen: null,
      summary: { tema: title, trabajado: [], claro: [], abierto, siguiente: abierto.length ? 'Seguir' : '' },
    }, null);
  };
  conversacion('c-vieja', 'Dijkstra', hace(300), ['¿Por qué falla con pesos negativos?'], area);
  conversacion('c-cerrada', 'BFS', hace(60), [], area);
  conversacion('c-ajena', 'Movimiento', hace(1), ['¿Qué es la aceleración?'], otro);

  const inicio = await f.call<Inicio>('inicio');
  assert.deepEqual([inicio.paso?.unitId, inicio.paso?.tipo], [sinVolcado!.id, 'volcado'], 'la primera unidad del plan con paso; «Recorridos» no tiene ninguno');
  assert.deepEqual(inicio.pasos.map(x => [x.titulo, x.tipo]), [['Caminos mínimos', 'reconstruir']],
    'el repaso de «Flujo» va en los repasos; nada de otro espacio');
  assert.deepEqual(inicio.repasos.map(r => [r.titulo, r.intentoId]), [['Emparejamientos', 'm1'], ['Flujo', null]]);
  const lecturaSemana = await f.call<{ proximoRepaso: string }>('unidad', { id: semana!.id });
  assert.deepEqual(inicio.proximos.flatMap(d => d.unidades.map(u => [d.dia, u.titulo])), [[lecturaSemana.proximoRepaso, 'Coloreado']]);
  assert.deepEqual([inicio.abierto?.chatId, inicio.abierto?.abierto], ['c-vieja', ['¿Por qué falla con pesos negativos?']]);
  assert.ok(!('bandeja' in inicio), 'lo pendiente de decidir se lee aparte, en `por-decidir`');
  assert.ok(!JSON.stringify(inicio).includes(ajena!.id), 'nada del otro espacio');

  const decidir = await f.call<PorDecidir>('por-decidir');
  assert.deepEqual(decidir.planes, [{ id: 'propuesto-1', revision: 1, objetivo: 'Planaridad', elementos: 1 }]);
  assert.deepEqual(decidir.cambios, [{ id: 'cambio-1', planId: grafos.id, objetivo: 'Dominar grafos', descripcion: ['Quitar el tema «Recorridos»'], motivo: 'Ya lo dominas.', caducado: null }]);
  assert.deepEqual(decidir.sugerencias.map(x => [x.titulo, x.capacidad, x.criterio]), [['Árboles', 'Recorrer un árbol', 'Sin mirar']]);
  assert.deepEqual(decidir.borradores, [{ id: 'draft-1', tipo: 'hecho', resumen: 'GDN obtiene F1 0,81 en SWaT.', origen: 'tutor', registros: 1 }]);
  assert.ok(!JSON.stringify(decidir).includes(ajena!.id), 'nada del otro espacio');
});

test('si el paso principal es un repaso, su unidad no se repite en los repasos de hoy', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [a, b] = await planCon(f, ['Flujo', 'Cortes']);
  for (const [u, doc] of [[a!, 'd-a'], [b!, 'd-b']] as const) {
    await volcado(f, u);
    await fuente(f, u, doc, area, 0);
    intento(f.store, u.id, `i-${doc}`, hace(10 * DIA));
  }
  const inicio = await f.call<Inicio>('inicio');
  assert.deepEqual([inicio.paso?.titulo, inicio.paso?.tipo], ['Flujo', 'repasar']);
  assert.deepEqual(inicio.repasos.map(r => r.titulo), ['Cortes']);
  assert.deepEqual(inicio.pasos, [], 'el repaso de «Cortes» ya está en los repasos');
});

test('un espacio vacío no propone nada ni tiene nada por decidir; una unidad nunca practicada no es un repaso', async t => {
  const f = await fixture(t);
  await espacio(f, 'Vacío');
  const vacio = await f.call<Inicio>('inicio');
  assert.deepEqual([vacio.paso, vacio.pasos, vacio.repasos, vacio.proximos, vacio.abierto], [null, [], [], [], null]);
  assert.deepEqual(await f.call<PorDecidir>('por-decidir'), { planes: [], cambios: [], sugerencias: [], borradores: [] });

  await planCon(f, ['Nueva']);
  const nueva = await f.call<Inicio>('inicio');
  assert.equal(nueva.paso?.tipo, 'volcado');
  assert.deepEqual(nueva.repasos, [], 'la cola del regulador la incluye, pero se estudia antes de repasarla');
});

test('confirmar y descartar lo pendiente usan las operaciones de propuestas y borradores que ya existen', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [u] = await planCon(f, ['Recorridos']);
  const { plan, elementoId } = temaDe(f, u!.id);
  for (const id of ['c-1', 'c-2']) f.store.saveProposal({
    id, revision: 1, planId: plan.id, baseRevision: plan.revision,
    ops: [{ op: 'remove', elementoId }], rationale: '', author: 'tutor', status: 'pendiente', createdAt: hace(1),
  }, null);
  f.store.saveDraft({ id: 'd-1', revision: 1, kind: 'hecho', summary: 's', origin: 'tutor', status: 'pendiente', createdAt: hace(1), commit: null, records: [{ record: { id: 'HE-1', type: 'hecho', title: 'x' } as never, body: '' }] }, null);
  await f.call('rechazar-propuesta', { id: 'c-1' });
  await f.call('kb-descartar', { draftId: 'd-1' });
  const despues = await f.call<PorDecidir>('por-decidir');
  assert.deepEqual(despues.cambios.map(c => c.id), ['c-2']);
  assert.deepEqual(despues.borradores, []);
  await f.call('aplicar-propuesta', { id: 'c-2' });
  assert.deepEqual((await f.call<PorDecidir>('por-decidir')).cambios, []);
});

test('un cambio del tutor sobre un tema que otro cambio ya tocó sale caducado, se explica en español y solo cabe descartarlo', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [u] = await planCon(f, ['Recorridos']);
  const { plan, elementoId } = temaDe(f, u!.id);
  const proponer = (id: string, index: number) => f.store.saveProposal({
    id, revision: 1, planId: plan.id, baseRevision: plan.revision,
    ops: [{ op: 'move', elementoId, index }], rationale: '', author: 'tutor', status: 'pendiente', createdAt: hace(1),
  }, null);
  proponer('c-1', 0);
  proponer('c-2', 0);
  await f.call('aplicar-propuesta', { id: 'c-1' });
  const [cambio] = (await f.call<PorDecidir>('por-decidir')).cambios;
  assert.deepEqual([cambio?.id, cambio?.caducado], ['c-2', 'otro cambio del plan ya tocó el tema «Recorridos»']);
  await assert.rejects(async () => f.call('aplicar-propuesta', { id: 'c-2' }), /Este cambio del plan ya no encaja, porque otro cambio del plan ya tocó el tema «Recorridos». Se ha retirado sin tocar el plan./);
  assert.deepEqual((await f.call<PorDecidir>('por-decidir')).cambios, [], 'retirado, deja de estar por decidir');
});

test('una unidad con repaso vencido y una fuente sin reconstruir sale una sola vez en hoy: las dos llevan a practicar', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [primera, doble] = await planCon(f, ['Recorridos', 'Caminos mínimos']);
  await volcado(f, doble!);
  intento(f.store, doble!.id, 'd1', hace(10 * DIA));
  await fuente(f, doble!, 'doc-1', area, 2);
  let inicio = await f.call<Inicio>('inicio');
  assert.equal(inicio.paso?.unitId, primera!.id);
  assert.deepEqual(inicio.repasos.map(r => r.titulo), ['Caminos mínimos']);
  assert.deepEqual(inicio.pasos, [], 'su «Reconstruye sin mirar» es el mismo repaso');

  await volcado(f, primera!);
  await fuente(f, primera!, 'doc-0', area, 0);
  inicio = await f.call<Inicio>('inicio');
  assert.deepEqual([inicio.paso?.titulo, inicio.paso?.tipo], ['Caminos mínimos', 'reconstruir']);
  assert.deepEqual(inicio.repasos, [], 'el paso principal ya es esa práctica');
});
