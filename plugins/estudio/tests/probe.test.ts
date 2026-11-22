import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractProbeResults, ingestProbeResults, type ChatRecord } from '../src/probe.ts';
import { NOW, tempStore } from './study-fixtures.ts';

const STRANDS = [
  { strand: 'La derivada como límite', assessment: 'Domina límites; no conecta con pendiente.' },
  { strand: 'Regla de la cadena', assessment: 'No la conoce.' },
];

function record(messages: unknown[]): ChatRecord {
  return { id: 'chat-1', title: 't', createdAt: NOW, updatedAt: NOW, messages } as unknown as ChatRecord;
}
function call(id = 'call-1', stopReason = 'toolUse', strands: unknown = STRANDS) {
  return { role: 'assistant', stopReason, content: [{ type: 'toolCall', id, name: 'probe_done', arguments: { assessment: { strands, summary: 'Entrar por la pendiente.' } } }] };
}
function result(id = 'call-1', extra: Record<string, unknown> = {}) {
  return { role: 'toolResult', toolName: 'probe_done', toolCallId: id, isError: false, details: { ok: true }, content: [], ...extra };
}

test('a concluded probe_done yields its strands and summary', () => {
  assert.deepEqual(extractProbeResults(record([call(), result()])), [
    { chatId: 'chat-1', toolCallId: 'call-1', strands: STRANDS, summary: 'Entrar por la pendiente.' },
  ]);
});

test('failed, aborted, errored or unanswered probes yield nothing', () => {
  assert.deepEqual(extractProbeResults(record([call('c', 'error'), result('c')])), []);
  assert.deepEqual(extractProbeResults(record([call('c', 'aborted'), result('c')])), []);
  assert.deepEqual(extractProbeResults(record([call('c'), result('c', { isError: true })])), []);
  assert.deepEqual(extractProbeResults(record([call('c'), result('c', { details: { ok: false } })])), []);
  assert.deepEqual(extractProbeResults(record([call('c')])), []);
  assert.deepEqual(extractProbeResults(record([result('c')])), []);
  assert.deepEqual(extractProbeResults(record([call('c', 'toolUse', 'not a list'), result('c')])), []);
});

test('each strand becomes a proposed unit carrying its assessment and origin', t => {
  const store = tempStore(t);
  const created = ingestProbeResults(store, extractProbeResults(record([call(), result()])), NOW);
  assert.equal(created.length, 2);
  const first = created[0]!;
  assert.equal(first.status, 'propuesta');
  assert.equal(first.title, 'La derivada como límite');
  assert.equal(first.capability, '');
  assert.equal(first.criterion, '');
  assert.equal(first.notes, 'Domina límites; no conecta con pendiente.');
  assert.deepEqual(first.origin, { kind: 'sondeo', chatId: 'chat-1', toolCallId: 'call-1', strand: 'La derivada como límite' });
});

test('ingesting the same probe twice creates nothing new', t => {
  const store = tempStore(t);
  const results = extractProbeResults(record([call(), result()]));
  ingestProbeResults(store, results, NOW);
  assert.deepEqual(ingestProbeResults(store, results, NOW), []);
  assert.equal(store.listUnits().length, 2);
});
