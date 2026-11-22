import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { PluginInference, PluginLearningData } from 'learnharness-plugin-api';
import { buildIndex, search } from '../src/kb/search.ts';
import { BRIEFING_MAX, composeBriefing } from '../src/sessions/briefing.ts';
import { CATCH_UP_MAX, createSessionService, IDLE_MS } from '../src/sessions/service.ts';
import { clip, transcriptText } from '../src/sessions/transcript.ts';
import type { ChatRecord } from '../src/probe.ts';
import { plan, tempStore, unit } from './study-fixtures.ts';
import type { StudyArea } from '../src/study/types.ts';
import { nombreEstudiante } from '../src/identidad.ts';

const NOW = '2026-11-11T12:00:00.000Z';
const LONG = 'Hablamos de la red de desviación de grafos y de cómo aprende la estructura entre sensores. '.repeat(6);
const SUMMARY = { tema: 'GDN y su grafo aprendido', trabajado: ['Atención entre sensores'], claro: ['Explica el top-k'], abierto: ['Por qué el umbral es fijo'], siguiente: 'Comparar con USAD' };

function chat(id: string, updatedAt: string, extra: unknown[] = [], text = LONG): ChatRecord {
  return {
    id, title: `Charla ${id}`, createdAt: updatedAt, updatedAt, kind: 'teach',
    messages: [
      { id: 'm1', role: 'user', content: text, timestamp: 1 },
      { id: 'm2', role: 'assistant', content: [{ type: 'thinking', thinking: 'secreto' }, { type: 'text', text: 'Respuesta del tutor.' }], stopReason: 'stop', timestamp: 2 },
      { id: 'm3', role: 'assistant', content: [{ type: 'text', text: 'Turno fallido' }], stopReason: 'error', timestamp: 3 },
      ...extra,
    ],
  } as unknown as ChatRecord;
}

function setup(t: TestContext, options: { chats?: ChatRecord[]; cheap?: boolean; reply?: string; error?: string; area?: () => StudyArea | null } = {}) {
  const store = tempStore(t);
  const chats = new Map((options.chats ?? []).map(c => [c.id, c]));
  const requests: { purpose: string; model: { id: string } }[] = [];
  const learning = {
    listSessions: () => [...chats.values()].map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, kind: 'teach', messageCount: c.messages.length, busy: false })),
    getSession: (id: string) => chats.get(id) ?? null,
  } as unknown as PluginLearningData;
  const inference = {
    async catalog() { return { slots: { strong: { model: { provider: 'p', id: 'fuerte' } }, cheap: options.cheap === false ? null : { model: { provider: 'p', id: 'barato' } } } }; },
    async complete(request: { purpose: string; model: { id: string } }) {
      requests.push(request);
      if (options.error) return { stopReason: 'error', errorMessage: options.error, content: [] };
      return { stopReason: 'stop', content: [{ type: 'text', text: options.reply ?? JSON.stringify(SUMMARY) }] };
    },
  } as unknown as PluginInference;
  let changes = 0;
  const sessions = createSessionService({
    store, learning, inference, today: () => ({ queue: [], open: [] }), area: options.area ?? (() => null), kbRecords: () => [], now: () => NOW,
    signal: new AbortController().signal, onChange: () => { changes++; },
  });
  t.after(() => sessions.dispose());
  return { store, chats, sessions, requests, changes: () => changes };
}

test('the transcript keeps what David and the tutor said, without thinking, tools or failed turns; a long one keeps its end', () => {
  const text = transcriptText(chat('c1', NOW, [], 'Hola'));
  assert.equal(text, `${nombreEstudiante()}: Hola\n\nTutor: Respuesta del tutor.`);
  const clipped = clip('a'.repeat(50) + 'FINAL', 30);
  assert.ok(clipped.endsWith('FINAL'));
  assert.match(clipped, /omitidos/);
});

test('a conversation links the units born in it and what the study tools touched, drafts included', async t => {
  const traffic = [
    { id: 'm4', role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'estudio_proponer_hecho', arguments: { documentId: 'doc-1', page: 2 } }], stopReason: 'toolUse', timestamp: 4 },
    { id: 'm5', role: 'toolResult', toolCallId: 't1', toolName: 'estudio_proponer_hecho', content: [{ type: 'text', text: 'ok' }], details: { ok: true, draftId: 'draft-1' }, isError: false, timestamp: 5 },
  ];
  const f = setup(t, { chats: [chat('c1', '2026-11-11T10:00:00.000Z', traffic)] });
  f.store.saveUnit(unit({ id: 'u-born', title: 'Nacida aquí', origin: { kind: 'tutor', chatId: 'c1' } }), null);
  f.store.saveUnit(unit({ id: 'u-other', title: 'Otra' }), null);
  f.store.saveDocument({ id: 'doc-1', revision: 1, title: 'GDN paper', path: 'C:/p.pdf', status: 'listo', error: null, startedAt: NOW, finishedAt: NOW, original: { sha256: 'a'.repeat(64), bytes: 1 }, doclingSha256: null, estructuraSha256: 'b'.repeat(64), paginas: 1, contraste: null, revisar: [], areaId: null }, null);
  f.store.saveDraft({ id: 'draft-1', revision: 1, kind: 'hecho', summary: 's', origin: 'tutor', status: 'pendiente', createdAt: NOW, commit: null, records: [{ record: { id: 'HE-1', type: 'hecho', title: 'GDN en SWaT' } as never, body: '' }] }, null);
  const [view] = f.sessions.list();
  assert.deepEqual(view!.links.map(l => [l.kind, l.id]).sort(), [['documento', 'doc-1'], ['hecho', 'HE-1'], ['unidad', 'u-born']]);
});

test('a conversation quiet for the idle time is summarized once with the cheap model, in the background', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(t, { chats: [chat('c1', '2026-11-11T11:00:00.000Z')] });
  f.sessions.onTurnSettled('c1');
  t.mock.timers.tick(IDLE_MS - 1);
  f.sessions.onTurnSettled('c1');
  t.mock.timers.tick(IDLE_MS - 1);
  assert.equal(f.requests.length, 0, 'a new turn restarts the wait');
  t.mock.timers.tick(1);
  t.mock.timers.reset();
  for (let i = 0; i < 10 && !f.store.getConversation('c1')?.summary; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(f.requests.map(r => [r.purpose, r.model.id]), [['background', 'barato']]);
  assert.deepEqual(f.store.getConversation('c1')!.summary, SUMMARY);
  assert.equal(f.store.getConversation('c1')!.summaryOf, '2026-11-11T11:00:00.000Z');
});

test('without a cheap model nothing is sent to any model and the reason is recorded', async t => {
  const f = setup(t, { chats: [chat('c1', '2026-11-11T11:00:00.000Z')], cheap: false });
  await assert.rejects(f.sessions.summarizeNow('c1'), /Sin modelo barato/);
  assert.equal(f.requests.length, 0);
  assert.match(f.sessions.list()[0]!.summaryError!, /Sin modelo barato/);
});

test('an invalid summary is recorded as an error, and short conversations are not summarized', async t => {
  const f = setup(t, { chats: [chat('c1', '2026-11-11T11:00:00.000Z'), chat('c2', '2026-11-11T11:00:00.000Z', [], 'Hola')], reply: 'no es JSON' });
  await assert.rejects(f.sessions.summarizeNow('c1'), /resumen válido/);
  assert.match(f.store.getConversation('c1')!.summaryError!, /resumen válido/);
  await assert.rejects(f.sessions.summarizeNow('c2'), /demasiado corta/);
  assert.equal(f.requests.length, 1);
});

test('catching up summarizes only recent, quiet, unsummarized conversations, a bounded number of them', async t => {
  const recent = Array.from({ length: CATCH_UP_MAX + 2 }, (_, i) => chat(`r${i}`, `2026-11-0${(i % 9) + 1}T10:00:00.000Z`));
  const f = setup(t, { chats: [...recent, chat('old', '2026-09-01T10:00:00.000Z'), chat('busy-now', '2026-11-11T11:55:00.000Z')] });
  f.sessions.catchUp();
  for (let i = 0; i < 50 && f.requests.length < CATCH_UP_MAX; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  // The conversation active five minutes ago takes a place but waits for its quiet period to end.
  assert.equal(f.requests.length, CATCH_UP_MAX - 1);
  assert.equal(f.store.getConversation('old'), null);
  assert.equal(f.store.getConversation('busy-now'), null, 'a conversation active in the last minutes waits');
});

test('the briefing carries what earlier conversations left open, never the current one, and is frozen', async t => {
  const first = { ...chat('now', '2026-11-11T11:59:00.000Z'), messages: [{ id: 'm1', role: 'user', content: 'Seguimos', timestamp: 1 }] } as unknown as ChatRecord;
  const f = setup(t, { chats: [chat('before', '2026-11-10T10:00:00.000Z'), first] });
  await f.sessions.summarizeNow('before');
  const briefing = f.sessions.briefingFor({ chatId: 'now', agent: 'teacher' });
  assert.match(briefing, /«Charla before»: GDN y su grafo aprendido/);
  assert.match(briefing, /Left open: Por qué el umbral es fijo/);
  assert.doesNotMatch(briefing, /Charla now/);
  f.store.saveUnit(unit({ id: 'u-new', title: 'Unidad posterior', status: 'activa' }), null);
  assert.equal(f.sessions.briefingFor({ chatId: 'now', agent: 'prober' }), briefing);
});

test('the briefing stays within its size whatever the state', () => {
  const many = Array.from({ length: 200 }, (_, i) => `Elemento ${i} ${'x'.repeat(80)}`);
  const text = composeBriefing({
    area: null,
    plan: { goal: 'Meta', units: many }, outsidePlan: many, due: [], openAttempts: 0, recent: [], questions: many, drafts: 3,
    previous: [{ date: '2026-11-10', title: 'T', summary: { ...SUMMARY, abierto: many.slice(0, 8) } }], summariesOff: false,
  });
  assert.ok(text.length <= BRIEFING_MAX);
  assert.match(text, /y 188 más|y 192 más/);
});

test('past conversations are searchable by what was said and by their summary', async t => {
  const f = setup(t, { chats: [chat('c1', '2026-11-10T10:00:00.000Z'), chat('c2', '2026-11-10T11:00:00.000Z', [], 'Hablamos de USAD y autoencoders adversariales en WADI. '.repeat(10))] });
  await f.sessions.summarizeNow('c1');
  const index = buildIndex(f.sessions.searchDocs());
  assert.equal(search(index, 'autoencoders adversariales').hits[0]!.id, 'conversacion:c2');
  assert.equal(search(index, 'umbral fijo').hits[0]!.id, 'conversacion:c1');
  assert.equal(search(index, 'umbral').cobertura.conversaciones, 2);
});

test('short conversations do not take catch-up places from long ones', async t => {
  const shorts = Array.from({ length: CATCH_UP_MAX }, (_, i) => chat(`s${i}`, '2026-11-10T11:00:00.000Z', [], 'hola'));
  const f = setup(t, { chats: [...shorts, chat('long', '2026-11-09T10:00:00.000Z')] });
  f.sessions.catchUp();
  for (let i = 0; i < 20 && !f.store.getConversation('long')?.summary; i++) await new Promise(r => setImmediate(r));
  assert.equal(f.requests.length, 1);
  assert.ok(f.store.getConversation('long')!.summary);
});

test('a conversation active just before activation is summarized once its quiet period ends', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(t, { chats: [chat('recent', '2026-11-11T11:55:00.000Z')] });
  f.sessions.catchUp();
  t.mock.timers.tick(15 * 60 * 1000 - 1);
  assert.equal(f.requests.length, 0);
  t.mock.timers.tick(1);
  t.mock.timers.reset();
  for (let i = 0; i < 10 && !f.store.getConversation('recent')?.summary; i++) await new Promise(r => setImmediate(r));
  assert.equal(f.requests.length, 1);
});

test('a long provider error is recorded cut, and the caller still gets it', async t => {
  const f = setup(t, { chats: [chat('c1', '2026-11-11T11:00:00.000Z')], error: 'x'.repeat(5000) });
  await assert.rejects(f.sessions.summarizeNow('c1'), (error: Error) => error.message.length > 5000);
  assert.equal(f.store.getConversation('c1')!.summaryError!.length, 1000);
});

test('a conversation that already had tutor turns is frozen without a briefing, so its prompt never changes', async t => {
  const f = setup(t, { chats: [chat('old', '2026-11-11T11:00:00.000Z')] });
  assert.equal(f.sessions.briefingFor({ chatId: 'old', agent: 'teacher' }), '');
  f.store.saveUnit(unit({ id: 'u-x', title: 'Nueva' }), null);
  assert.equal(f.sessions.briefingFor({ chatId: 'old', agent: 'teacher' }), '');
  assert.equal(f.store.getConversation('old')!.briefing, '');
});

test('in a space, the briefing names it and carries only its plan, units and conversations, and the conversation keeps it', async t => {
  const area: StudyArea = { id: 'a-fis', revision: 1, name: 'Física', description: 'Mecánica clásica', archived: false, createdAt: NOW, updatedAt: NOW };
  const first = { ...chat('now', '2026-11-11T11:59:00.000Z'), messages: [{ id: 'm1', role: 'user', content: 'Seguimos', timestamp: 1 }] } as unknown as ChatRecord;
  const f = setup(t, { chats: [chat('fis', '2026-11-10T10:00:00.000Z'), chat('mat', '2026-11-10T11:00:00.000Z'), first], area: () => area });
  f.store.saveUnit(unit({ id: 'u-fis', title: 'Leyes de Newton', areaId: 'a-fis' }), null);
  f.store.saveUnit(unit({ id: 'u-mat', title: 'Regla de la cadena', areaId: 'a-mat' }), null);
  f.store.savePlan(plan({ id: 'p-fis', goal: 'Dinámica', unitIds: ['u-fis'], areaId: 'a-fis', updatedAt: '2026-11-10T09:00:00.000Z' }), null);
  f.store.savePlan(plan({ id: 'p-mat', goal: 'Cálculo', unitIds: ['u-mat'], areaId: 'a-mat', updatedAt: '2026-11-11T09:00:00.000Z' }), null);
  const record = (id: string, areaId: string) => ({ id, revision: 1, briefing: null, briefedAt: null, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId, unitId: null, origen: null });
  f.store.saveConversation(record('fis', 'a-fis'), null);
  f.store.saveConversation(record('mat', 'a-mat'), null);
  const briefing = f.sessions.briefingFor({ chatId: 'now', agent: 'teacher' });
  assert.match(briefing, /Study space: «Física» \(Mecánica clásica\)/);
  assert.match(briefing, /goal: Dinámica/);
  assert.match(briefing, /Leyes de Newton/);
  assert.match(briefing, /Charla fis/);
  assert.doesNotMatch(briefing, /Cálculo|Regla de la cadena|Charla mat/);
  assert.equal(f.store.getConversation('now')!.areaId, 'a-fis');
  assert.deepEqual(f.sessions.list('a-fis').map(v => v.id).sort(), ['fis', 'now']);
  assert.deepEqual(f.sessions.list().map(v => v.id).sort(), ['fis', 'mat', 'now']);
});
