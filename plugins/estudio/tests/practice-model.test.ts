import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PluginInference } from 'learnharness-plugin-api';
import { firstJsonObject, generateTask, judgeAttempt } from '../src/practice/model.ts';
import { task } from './practice-fixtures.ts';
import { NOW, unit } from './study-fixtures.ts';

const TASK_JSON = { prompt: 'Explica la derivada.', cues: ['1', '2', '3', '4', '5'], reference: 'Límite del cociente incremental.', rubric: ['Cociente', 'Límite'] };

function inference(reply: string | { stopReason: string; errorMessage?: string }, slot: unknown = { model: { provider: 'p', id: 'm' } }) {
  const requests: unknown[] = [];
  const service = {
    async catalog() { return { slots: { strong: slot } }; },
    async complete(request: unknown) {
      requests.push(request);
      if (typeof reply !== 'string') return { role: 'assistant', content: [], ...reply };
      return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: reply }] };
    },
  } as unknown as PluginInference;
  return { service, requests };
}

const signal = new AbortController().signal;

test('a valid reply becomes a task with the strong model recorded', async () => {
  const { service, requests } = inference(JSON.stringify(TASK_JSON));
  const generated = await generateTask(service, unit(), 'libre', ['Consigna antigua'], signal);
  assert.equal(generated.prompt, TASK_JSON.prompt);
  assert.deepEqual(generated.model, { provider: 'p', id: 'm' });
  const request = requests[0] as { model: unknown; purpose: string; context: { messages: { content: string }[] } };
  assert.deepEqual(request.model, { provider: 'p', id: 'm' });
  assert.equal(request.purpose, 'user');
  assert.match(request.context.messages[0]!.content, /Consigna antigua/);
});

test('JSON wrapped in prose or code fences is still read', async () => {
  const { service } = inference('Aquí tienes:\n```json\n' + JSON.stringify(TASK_JSON) + '\n```');
  assert.equal((await generateTask(service, unit(), 'libre', [], signal)).reference, TASK_JSON.reference);
  assert.deepEqual(firstJsonObject('x {"a":"}{"} y'), { a: '}{' });
});

test('malformed, incomplete or failed replies are refused without a partial task', async () => {
  for (const reply of ['no json', '{"prompt": "x"', JSON.stringify({ ...TASK_JSON, cues: ['1'] }), JSON.stringify({ ...TASK_JSON, extra: 1 }), { stopReason: 'error', errorMessage: 'rate limit' }]) {
    await assert.rejects(generateTask(inference(reply).service, unit(), 'libre', [], signal), /no devolvió una tarea válida/, JSON.stringify(reply));
  }
});

test('without a strong model configured the error says what to do', async () => {
  await assert.rejects(generateTask(inference('{}', null).service, unit(), 'libre', [], signal), /Configura el modelo fuerte/);
});

test('a judgment is parsed and validated; nothing else is accepted', async () => {
  const ok = await judgeAttempt(inference(JSON.stringify({ fidelity: 2, failureType: 'precision', rationale: 'Falta el límite.' })).service, task(), 'resp', NOW, signal);
  assert.deepEqual([ok.fidelity, ok.failureType, ok.judgedAt], [2, 'precision', NOW]);
  await assert.rejects(judgeAttempt(inference(JSON.stringify({ fidelity: 4, failureType: null, rationale: '' })).service, task(), 'r', NOW, signal), /contraste válido/);
  await assert.rejects(judgeAttempt(inference(JSON.stringify({ fidelity: 1, failureType: 'otro', rationale: '' })).service, task(), 'r', NOW, signal), /contraste válido/);
});

test('a source excerpt grounds the task and the judgment; document sources are not listed as paths', async () => {
  const { service, requests } = inference(JSON.stringify(TASK_JSON));
  const withDoc = unit({ sources: [{ path: 'documento:d1', locator: '2' }, { path: 'C:/notas.md' }] });
  await generateTask(service, withDoc, 'libre', [], signal, 'TEXTO DEL PAPER sobre GNN');
  const content = (requests[0] as { context: { messages: { content: string }[] } }).context.messages[0]!.content;
  assert.match(content, /Texto de la fuente estudiada[\s\S]*TEXTO DEL PAPER sobre GNN/);
  assert.match(content, /Fuentes de la unidad: C:\/notas\.md/);
  assert.equal(content.includes('documento:d1'), false);
  const plain = inference(JSON.stringify(TASK_JSON));
  await generateTask(plain.service, unit(), 'libre', [], signal);
  assert.equal((plain.requests[0] as { context: { messages: { content: string }[] } }).context.messages[0]!.content.includes('Texto de la fuente'), false);
  const judge = inference(JSON.stringify({ fidelity: 3, failureType: null, rationale: 'ok' }));
  await judgeAttempt(judge.service, task(), 'r', NOW, signal, 'TEXTO DEL PAPER');
  assert.match((judge.requests[0] as { context: { messages: { content: string }[] } }).context.messages[0]!.content, /manda sobre la referencia[\s\S]*TEXTO DEL PAPER/);
});
