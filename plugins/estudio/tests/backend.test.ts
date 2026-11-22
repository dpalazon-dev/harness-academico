import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext, PluginTools } from 'learnharness-plugin-api';
import { activate, CHANGED_TOPIC } from '../src/backend.ts';

type Listener = (event: { type: string; chatId?: string }) => void;

function context(root: string, controller = new AbortController()) {
  const cleanups: (() => unknown)[] = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  const listeners: Listener[] = [];
  const sessions = new Map<string, unknown>();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup(fn: () => unknown) { cleanups.push(fn); },
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on(listener: Listener) { listeners.push(listener); return () => {}; } },
    learning: { getSession: (id: string) => sessions.get(id) ?? null, listSessions: () => [] },
    registerInstructions() { return () => {}; },
    registerTools() { return () => {}; },
  } as unknown as PluginBackendContext;
  return { ctx, controller, cleanups, handlers, listeners, sessions,
    async teardown(stop?: () => Promise<void>) { await stop?.(); for (const fn of cleanups.splice(0).reverse()) await fn(); } };
}

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-backend-'));
  const controller = new AbortController();
  const cleanups: (() => unknown)[] = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: string[] = [];
  const sessions = new Map<string, unknown>();
  const listeners: Listener[] = [];
  const tools: PluginTools[] = [];
  const instructions: { agents: string[]; text: string }[] = [];
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup(fn: () => unknown) { cleanups.push(fn); },
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit(topic: string) { emitted.push(topic); }, on(listener: Listener) { listeners.push(listener); return () => {}; } },
    learning: { getSession: (id: string) => sessions.get(id) ?? null, listSessions: () => [] },
    registerInstructions(c: { agents: string[]; text: string }) { instructions.push(c); return () => {}; },
    inference: {
      async catalog() { return { slots: { strong: { model: { provider: 'test', id: 'strong' } } } }; },
      async complete(request: { context: { systemPrompt: string } }) {
        const scaffold = request.context.systemPrompt.includes('escalera de pistas');
        const json = scaffold ? { cues: ['p1', 'p2', 'p3', 'p4', 'p5'], rubric: ['Dice que es denso'] } : { fidelity: 3, failureType: null, rationale: 'Coincide.' };
        return { stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(json) }] };
      },
    },
    registerTools(c: PluginTools) { tools.push(c); return () => {}; },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  t.after(async () => { await stop(); for (const fn of cleanups.splice(0).reverse()) await fn(); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    controller, emitted, sessions, instructions,
    call: (name: string, input?: unknown) => handlers.get(name)!(input),
    settle: (chatId: string) => listeners.forEach(l => l({ type: 'turn-settled', chatId })),
    tools: (agent = 'teacher') => tools.flatMap(c => c.create({ chatId: 'chat-1', agent } as never)),
  };
}

const PROBE_SESSION = {
  id: 'chat-1', title: 't', createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z',
  messages: [
    { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c1', name: 'probe_done', arguments: { assessment: { strands: [{ strand: 'Límites', assessment: 'Sólido' }] } } }] },
    { role: 'toolResult', toolName: 'probe_done', toolCallId: 'c1', isError: false, details: { ok: true }, content: [] },
  ],
};

test('a settled turn with a concluded probe creates proposed units once and notifies the view', async t => {
  const f = await fixture(t);
  f.sessions.set('chat-1', PROBE_SESSION);
  f.settle('chat-1');
  f.settle('chat-1');
  const state = await f.call('estado') as { units: { status: string; title: string }[] };
  assert.deepEqual(state.units.map(u => [u.status, u.title]), [['propuesta', 'Límites']]);
  assert.deepEqual(f.emitted, [CHANGED_TOPIC]);
});

test('operations validate input and reject unknown fields', async t => {
  const f = await fixture(t);
  assert.throws(() => f.call('crear-plan', { goal: 'Cálculo', extra: 1 }), /not allowed/);
  assert.throws(() => f.call('crear-plan', { goal: '' }), /must not be empty/);
  assert.throws(() => f.call('crear-unidad', { title: 'X', kind: 'hecho' }), /unsupported value/);
  assert.throws(() => f.call('confirmar-unidad', { id: 'nope', expectedRevision: 1 }), /no existe/);
});

test('the tutor proposes; only applying the proposal changes the plan', async t => {
  const f = await fixture(t);
  const [estado, proponerUnidad, proponerPlan] = f.tools();
  assert.deepEqual([estado?.name, proponerUnidad?.name, proponerPlan?.name], ['estudio_estado', 'estudio_proponer_unidad', 'estudio_proponer_plan']);
  const unitResult = await proponerUnidad!.execute('t1', { title: 'Regla de la cadena', capability: 'Aplicarla', criterion: 'Resuelvo sin pistas' });
  const unitId = (unitResult.details as { unitId: string }).unitId;
  const planResult = await proponerPlan!.execute('t2', { goal: 'Cálculo', ops: [{ op: 'add', unitId }], rationale: 'Base' });
  const proposalId = (planResult.details as { proposalId: string }).proposalId;
  let state = await f.call('estado') as { plans: { unitIds: string[] }[]; units: { status: string }[] };
  assert.deepEqual(state.plans[0]?.unitIds, []);
  assert.equal(state.units[0]?.status, 'propuesta');
  f.call('aplicar-propuesta', { id: proposalId });
  state = await f.call('estado') as typeof state;
  assert.deepEqual(state.plans[0]?.unitIds, [unitId]);
  const text = (await estado!.execute('t3', {})).content[0] as { text: string };
  assert.match(text.text, /Regla de la cadena/);
});

test('a refused tool call reports an error result instead of throwing', async t => {
  const f = await fixture(t);
  const proponerPlan = f.tools().find(tool => tool.name === 'estudio_proponer_plan')!;
  const result = await proponerPlan.execute('t1', { ops: [{ op: 'add', unitId: 'ghost' }], rationale: 'x' }) as { isError?: boolean };
  assert.equal(result.isError, true);
});

test('instructions and tools go to the prober and teacher only', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.instructions.map(i => i.agents), [['prober', 'teacher'], ['prober'], ['teacher'], ['prober', 'teacher']]);
  assert.match(f.instructions[0]!.text, /estudio_estado/);
  // The interaction contract: the learner produces, the tutor critiques (design, 6 septies).
  for (const i of f.instructions.slice(1, 3)) assert.match(i.text, /he recalls → he builds → he explains → you critique/);
  assert.match(f.instructions[1]!.text, /what he already knows about it, what he believes/);
  assert.match(f.instructions[2]!.text, /Closing a block[\s\S]*reconstruct the block without scrolling back/);
  assert.match(f.instructions[0]!.text, /ask him to state it in his own words/);
  assert.doesNotMatch(f.instructions[0]!.text, /paper/i);
});

// Ticket 07 of the second UX round (story 22): the prober takes every new conversation's first turn (the core builds the teacher only after probe_done),
// so the framing lives in its prompt alone.
test('the prober opens a new conversation by asking once what he wants from it and how much time he has', async t => {
  const f = await fixture(t);
  const probe = f.instructions[1]!.text;
  const framing = /## Framing the conversation[\s\S]*?(?=\n## |$)/.exec(probe)?.[0] ?? '';
  assert.match(framing, /ask_user_question/);
  for (const intent of [/learn something new/, /reconstruct or review/, /resolve a specific doubt/, /apply it to a problem of his own/]) assert.match(framing, intent);
  assert.match(framing, /how much time he has/);
  assert.match(framing, /once/);
  // Before the goal is made concrete, and so before his own account: it orients the dump and the probe, it replaces neither.
  assert.ok(probe.indexOf('## Framing the conversation') < probe.indexOf('## Before bracketing: his own account'));
  assert.match(framing, /does not replace his own account or the probe/);
  // What the study context or his opening message already answers is not asked; a unit does not answer it.
  assert.match(framing, /retrieval attempt[\s\S]*passage[^\n]*skip the framing/);
  assert.match(framing, /from a unit[^\n]*ask the framing/);
  assert.match(framing, /opening message already states what he wants[^\n]*skip/);
  assert.match(framing, /specific doubt[^\n]*no time question/);
  // His answer goes where the teacher reads it: probe_done's summary.
  assert.match(framing, /probe_done[^\n]*summary/);
  assert.doesNotMatch(f.instructions[2]!.text, /Framing the conversation/);
});

test('the briefing is composed on a conversation\'s first turn and stays the same for the rest of it', async t => {
  const f = await fixture(t);
  const briefing = f.instructions[3]!.text as unknown as (c: { chatId: string; agent: string }) => string;
  const first = briefing({ chatId: 'chat-9', agent: 'teacher' });
  assert.match(first, /No study plan yet/);
  f.call('crear-plan', { goal: 'Entender GDN' });
  assert.equal(briefing({ chatId: 'chat-9', agent: 'prober' }), first);
  assert.match(briefing({ chatId: 'chat-10', agent: 'teacher' }), /goal: Entender GDN/);
});

test('the route reports the stage of a new unit, and the focus operations are gone', async t => {
  const f = await fixture(t);
  const briefing = f.instructions[3]!.text as unknown as (c: { chatId: string; agent: string }) => string;
  const created = f.call('crear-unidad', { title: 'Regla de la cadena', capability: 'Derivar composiciones' }) as { id: string; status: string };
  assert.equal(created.status, 'activa');
  const route = await f.call('ruta') as { unitId: string; stage: { kind: string } }[];
  assert.deepEqual(route.map(r => [r.unitId, r.stage.kind]), [[created.id, 'nueva']]);
  // ADR 0003: conversations carry their own context; nothing is left for the next briefing to pick up.
  assert.throws(() => f.call('enfocar-unidad', { unitId: created.id }));
  assert.throws(() => f.call('preguntar-pasaje', { documentId: 'd', page: 1, quote: 'q' }));
  assert.doesNotMatch(briefing({ chatId: 'chat-20', agent: 'teacher' }), /work on the unit/);
});

test('after deactivation every operation refuses', async t => {
  const f = await fixture(t);
  f.controller.abort();
  assert.throws(() => f.call('estado'), /Estudio está desactivado/);
  assert.throws(() => f.call('crear-plan', { goal: 'X' }), /Estudio está desactivado/);
});

test('an aborted activation fails and a later activation over the same data works', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-backend-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = context(root);
  first.controller.abort();
  await assert.rejects(activate(first.ctx), /desactivó/);
  await first.teardown();
  const second = context(root);
  const stop = await activate(second.ctx);
  await second.teardown(stop);
});

test('reactivating over the same data does not duplicate units from an already ingested probe', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-backend-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let run = 0; run < 2; run++) {
    const c = context(root);
    const stop = await activate(c.ctx);
    c.sessions.set('chat-1', PROBE_SESSION);
    c.listeners.forEach(l => l({ type: 'turn-settled', chatId: 'chat-1' }));
    const state = await c.handlers.get('estado')!(undefined) as { units: unknown[] };
    assert.equal(state.units.length, 1);
    await c.teardown(stop);
  }
});

test('a unit can only be linked to a document that has been incorporated', async t => {
  const f = await fixture(t);
  const created = f.call('crear-unidad', { title: 'GNN' }) as { id: string; revision: number };
  assert.throws(() => f.call('vincular-documento', { unitId: created.id, expectedRevision: created.revision, documentId: 'nope' }), /ya incorporados/);
  assert.deepEqual(f.call('documentos'), []);
});

test('a retrieval question from a notebook is practised as a task: his question, his answer as the reference', async t => {
  const f = await fixture(t);
  const created = f.call('crear-unidad', { title: 'Embeddings' }) as { id: string };
  const nb = f.call('crear-cuaderno', { title: 'Embeddings', kind: 'conocimiento', unitId: created.id }) as { id: string };
  f.call('guardar-cuaderno', { id: nb.id, expectedRevision: 1, title: 'Embeddings', kind: 'conocimiento', unitId: created.id, documentId: null,
    blocks: [{ id: 'q1', kind: 'recuperacion', question: '¿Qué es un embedding?', answer: 'Un vector denso aprendido.' }] });
  const attempt = await f.call('practicar-pregunta', { notebookId: nb.id, blockId: 'q1', confidence: 70 }) as { attempt: { id: string; confidence: number }; prompt: string; reference: string | null };
  assert.equal(attempt.prompt, '¿Qué es un embedding?');
  assert.equal(attempt.reference, null, 'the reference stays hidden until freezing');
  assert.equal(attempt.attempt.confidence, 70);
  f.call('guardar-respuesta', { attemptId: attempt.attempt.id, answer: 'Un vector denso.' });
  const frozen = await f.call('congelar', { attemptId: attempt.attempt.id }) as { attempt: { reference: string; rubric: string[] } };
  assert.equal(frozen.attempt.reference, 'Un vector denso aprendido.');
  assert.deepEqual(frozen.attempt.rubric, ['Dice que es denso']);
  const found = await f.call('paleta', { consulta: 'embedding vector denso' }) as { grupos: { resultados: { id: string; destino: unknown }[] }[] };
  const hit = found.grupos.flatMap(g => g.resultados).find(r => r.id === `cuaderno:${nb.id}`);
  assert.deepEqual(hit?.destino, { tipo: 'unidad', unitId: created.id }, 'his notebook is searchable and leads to its unit');
});

test('the margin handlers comment on a fragment, notify the views and discard for good', async t => {
  const f = await fixture(t);
  const nb = f.call('crear-cuaderno', { title: 'Margen', kind: 'libre' }) as { id: string };
  const texto = 'Un embedding es un vector denso aprendido.';
  const guardado = f.call('guardar-cuaderno', { id: nb.id, expectedRevision: 1, title: 'Margen', kind: 'libre', unitId: null, documentId: null,
    blocks: [{ id: 'b1', kind: 'nota', symbol: null, text: texto, locator: '', quote: '' }] }) as { revision: number };
  const antes = f.emitted.length;
  const anchor = { blockId: 'b1', text: 'vector denso', start: 19, end: 31, prefix: 'Un embedding es un ', suffix: ' aprendido.' };
  const out = await f.call('comentar-cuaderno', { id: nb.id, anchor, kind: 'pregunta' }) as { revision: number; blocks: unknown[]; comments: { id: string; state: string }[] };
  assert.equal(out.revision, guardado.revision + 1);
  assert.equal(out.comments.length, 1);
  assert.ok(f.emitted.length > antes, 'a comment notifies the views');
  const nota = out.blocks[0] as { text: string };
  assert.equal(nota.text, texto);
  const hecho = f.call('descartar-comentario', { id: nb.id, commentId: out.comments[0]!.id }) as { comments: { state: string }[] };
  assert.equal(hecho.comments[0]!.state, 'descartado');
  const leido = (f.call('cuadernos') as { comments: { state: string }[] }[])[0]!;
  assert.equal(leido.comments[0]!.state, 'descartado');
});

test('the thread handlers store David\'s reply, ask the tutor, attend and notify the views', async t => {
  const f = await fixture(t);
  const nb = f.call('crear-cuaderno', { title: 'Hilo', kind: 'libre' }) as { id: string };
  const texto = 'Un embedding es un vector denso aprendido.';
  f.call('guardar-cuaderno', { id: nb.id, expectedRevision: 1, title: 'Hilo', kind: 'libre', unitId: null, documentId: null,
    blocks: [{ id: 'b1', kind: 'nota', symbol: null, text: texto, locator: '', quote: '' }] });
  const anchor = { blockId: 'b1', text: 'vector denso', start: 19, end: 31, prefix: 'Un embedding es un ', suffix: ' aprendido.' };
  const con = await f.call('comentar-cuaderno', { id: nb.id, anchor, kind: 'pregunta' }) as { comments: { id: string }[] };
  const ids = { id: nb.id, commentId: con.comments[0]!.id };
  const antes = f.emitted.length;
  const dicho = f.call('responder-comentario', { ...ids, text: 'Denso frente a disperso.' }) as { comments: { thread: { role: string }[] }[] };
  assert.deepEqual(dicho.comments[0]!.thread.map(m => m.role), ['tutor', 'david']);
  const contestado = await f.call('contestar-comentario', ids) as { comments: { thread: { role: string }[] }[]; blocks: { text: string }[] };
  assert.deepEqual(contestado.comments[0]!.thread.map(m => m.role), ['tutor', 'david', 'tutor']);
  assert.equal(contestado.blocks[0]!.text, texto);
  const atendido = f.call('atender-comentario', ids) as { comments: { state: string }[] };
  assert.equal(atendido.comments[0]!.state, 'atendido');
  assert.ok(f.emitted.length >= antes + 3, 'every thread operation notifies the views');
  const leido = (f.call('cuadernos') as { comments: { state: string; thread: unknown[] }[] }[])[0]!;
  assert.deepEqual([leido.comments[0]!.state, leido.comments[0]!.thread.length], ['atendido', 3]);
});

test('the proactive handlers switch the mode, report the spending and never call a cheap model that is not configured', async t => {
  const f = await fixture(t);
  const nb = f.call('crear-cuaderno', { title: 'Proactivo', kind: 'libre' }) as { id: string };
  f.call('guardar-cuaderno', { id: nb.id, expectedRevision: 1, title: 'Proactivo', kind: 'libre', unitId: null, documentId: null,
    blocks: [{ id: 'b1', kind: 'nota', symbol: null, text: 'Un embedding es un vector denso aprendido.', locator: '', quote: '' }] });
  // El fixture solo tiene modelo fuerte: sin el barato no hay modo proactivo, y el fuerte no lo sustituye.
  assert.deepEqual(await f.call('estado-proactivo'), { tope: 40, usadas: 0, modeloEconomico: false });
  const lectura = await f.call('lectura-proactiva', { id: nb.id, blockId: 'b1' }) as { resultado: string; motivo: string };
  assert.deepEqual([lectura.resultado, lectura.motivo], ['omitido', 'sin-modelo']);
  const antes = f.emitted.length;
  const fuera = await f.call('modo-cuaderno', { id: nb.id, modo: 'a-peticion' }) as { modo: string };
  assert.equal(fuera.modo, 'a-peticion');
  assert.ok(f.emitted.length > antes, 'changing the mode notifies the views');
  assert.equal(((f.call('cuadernos') as { modo?: string }[])[0])!.modo, 'a-peticion');
  assert.deepEqual(await f.call('tope-proactivo', { tope: 10 }), { tope: 10, usadas: 0, modeloEconomico: false });
  await assert.rejects(Promise.resolve().then(() => f.call('tope-proactivo', { tope: 'mucho' })), /tope/);
});

test('los mensajes que pueden llegar a David salen en español, no en inglés', async t => {
  const f = await fixture(t);
  const unidad = await f.call('crear-unidad', { title: 'Límites', capability: 'Explicar límites' }) as { id: string };
  // Proponer un cambio sin plan ni objetivo: el mensaje llega al panel «Por decidir».
  assert.throws(() => f.call('proponer-cambio', { ops: [{ op: 'add', unitId: unidad.id }] }), /Todavía no hay plan: indica un objetivo para empezar uno/);
  // Una unidad que no existe, desde las lecturas del armazón.
  assert.throws(() => f.call('unidad', { id: 'nada' }), /La unidad nada no existe/);
});
