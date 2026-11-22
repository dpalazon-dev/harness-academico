import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import childProcess from 'node:child_process';
import { createDocumentService, documentConfig } from '../src/documents/incorporar.ts';
import { escapeBody, quoteContext } from '../src/kb/builder.ts';
import { createKbService } from '../src/kb/service.ts';
import { openStudyStore } from '../src/study/store.ts';
import { ORIGINAL_SHA, tempAlmacen } from './documents-fixtures.ts';
import { fakeKbol, tempKb } from './kb-fixtures.ts';
import { tempStore } from './study-fixtures.ts';

async function setup(t: TestContext) {
  fakeKbol(t);
  const { almacen, estructuraSha } = tempAlmacen(t);
  const store = tempStore(t);
  store.saveDocument({
    id: 'd1', revision: 1, title: 'GDN paper', path: 'C:/p.pdf', status: 'listo', error: null, startedAt: '2026-11-11T10:00:00.000Z', finishedAt: '2026-11-11T10:02:00.000Z',
    original: { sha256: ORIGINAL_SHA, bytes: 22 }, doclingSha256: null, estructuraSha256: estructuraSha, paginas: 2, contraste: { recuerdo: 0.99, respaldo: 0.99, paginasSinTexto: [] }, revisar: [], areaId: null,
  }, null);
  const documents = createDocumentService(store, { config: { ...documentConfig({} as NodeJS.ProcessEnv), almacen }, now: () => '2026-11-11T11:00:00.000Z', newId: () => 'x', signal: new AbortController().signal, onChange: () => {} });
  const repo = await tempKb(t);
  const kb = createKbService(store, repo, documents, () => '2026-11-11T11:00:00.000Z');
  const log = () => childProcess.execFileSync('git', ['log', '--format=%s'], { cwd: repo.config.kbDir, encoding: 'utf8' }).trim().split('\n');
  return { store, repo, kb, log };
}

const FACT = { documentId: 'd1', page: 1, quote: 'water treatment plants is hard', afirmacion: 'Detectar anomalías en plantas de tratamiento de agua es difícil.' };

test('discard waits for a confirmation already committing the same draft', async t => {
  const f = await setup(t);
  const draft = await f.kb.captureFact(FACT, 'david');
  const commits = f.log().length;
  const commit = f.repo.commit.bind(f.repo);
  let start!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const resumed = new Promise<void>(resolve => { resume = resolve; });
  t.mock.method(f.repo, 'commit', async (...args: Parameters<typeof commit>) => {
    start();
    await resumed;
    return commit(...args);
  });
  const confirming = f.kb.confirm({ draftIds: [draft.id] });
  await started;
  const discarding = Promise.allSettled([f.kb.discard({ draftId: draft.id })]);
  resume();
  const sha = await confirming;
  const [result] = await discarding;
  assert.equal(result.status, 'rejected');
  assert.match(String(result.reason), /ya se confirmó/);
  const saved = openStudyStore(f.store.root).getDraft(draft.id)!;
  assert.deepEqual([saved.status, saved.commit], ['confirmado', sha]);
  assert.equal(f.log().length, commits + 1);
  assert.ok(f.repo.get(draft.records[0]!.record.id));
});

test('confirmation queued behind discard leaves the fact out of Git', async t => {
  const f = await setup(t);
  const draft = await f.kb.captureFact(FACT, 'david');
  const commits = f.log().length;
  const discarding = f.kb.discard({ draftId: draft.id });
  const confirming = f.kb.confirm({ draftIds: [draft.id] });
  await Promise.all([discarding, assert.rejects(confirming, /no está pendiente/)]);
  const saved = openStudyStore(f.store.root).getDraft(draft.id)!;
  assert.deepEqual([saved.status, saved.commit], ['descartado', null]);
  assert.equal(f.log().length, commits);
  assert.equal(f.repo.get(draft.records[0]!.record.id), null);
});

test('registering a paper commits its two source records once', async t => {
  const f = await setup(t);
  const first = await f.kb.registerDocument({ documentId: 'd1' });
  const again = await f.kb.registerDocument({ documentId: 'd1' });
  assert.deepEqual(again, first);
  assert.equal(f.repo.get(first.derivada)?.header.derivada_de instanceof Array, true);
  assert.equal(f.log().filter(m => m.startsWith('Registra el paper')).length, 1);
});

test('capturing a fact verifies the quote and leaves one draft with the fact, the paper sources and new entities; nothing is committed', async t => {
  const f = await setup(t);
  const draft = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'SWaT', clase_entidad: 'dataset', alias: ['Secure Water Treatment'] }] }, 'tutor');
  assert.equal(draft.status, 'pendiente');
  assert.deepEqual(draft.records.map(x => x.record.type), ['hecho', 'fuente', 'fuente', 'entidad']);
  const [hecho, , , ent] = draft.records;
  assert.equal(f.log().some(m => m.startsWith('Registra el paper')), false, 'the tutor commits nothing');
  assert.equal(hecho!.record.type, 'hecho');
  assert.equal((hecho!.record as { sources: { ancla: string }[] }).sources[0]!.ancla, 'pdf-v1:p=1');
  assert.equal(ent!.record.type, 'entidad');
  assert.deepEqual((hecho!.record as { afecta_a: string[] }).afecta_a, [ent!.record.id]);
  assert.equal(f.repo.get(hecho!.record.id), null, 'nothing is written before confirmation');
});

test('a quote that does not verify blocks the fact', async t => {
  const f = await setup(t);
  await assert.rejects(f.kb.captureFact({ ...FACT, page: 2 }, 'david'), /no se verifica/);
  assert.deepEqual(f.kb.drafts(), []);
});

test('an entity named again by an alias, case or accents is reused, not duplicated', async t => {
  const f = await setup(t);
  const first = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'Detección de anomalías', clase_entidad: 'tarea', alias: ['Anomaly detection'] }] }, 'david');
  const entityId = first.records.find(x => x.record.type === 'entidad')!.record.id;
  const second = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'ANOMALY DETECTION', clase_entidad: 'tarea' }, { nombre: 'deteccion de anomalias', clase_entidad: 'tarea' }] }, 'tutor');
  assert.equal(second.records.length, 1);
  assert.deepEqual((second.records[0]!.record as { afecta_a: string[] }).afecta_a, [entityId]);
});

test('confirming writes every record of the drafts in one commit; discarding writes nothing', async t => {
  const f = await setup(t);
  const a = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'SWaT', clase_entidad: 'dataset' }] }, 'david');
  const b = await f.kb.addSynthesis({ titulo: 'Nota de lectura', texto: 'El problema es difícil por el desequilibrio.', dependencias: [a.records[0]!.record.id] }, 'david');
  const c = await f.kb.addQuestion({ titulo: '¿Comparable?', texto: 'Otro paper da otra cifra.', subtipo: 'discrepancia', condicionCierre: 'Comparar protocolos.', afectaA: [a.records[0]!.record.id] }, 'david');
  await f.kb.discard({ draftId: c.id });
  const sha = await f.kb.confirm({ draftIds: [a.id, b.id] });
  assert.match(sha, /^[0-9a-f]{40}$/);
  for (const r of [...a.records, ...b.records]) assert.ok(f.repo.get(r.record.id), r.record.id);
  assert.equal(f.repo.get(c.records[0]!.record.id), null);
  assert.equal(f.log()[0], 'Confirma 2 registros de estudio');
  assert.deepEqual(f.kb.drafts(), []);
  await assert.rejects(f.kb.confirm({ draftIds: [a.id] }), /no está pendiente/);
});

test('questions are owned by David\'s role and references must exist', async t => {
  const f = await setup(t);
  const q = await f.kb.addQuestion({ titulo: '¿Qué umbral?', texto: 'No dice el umbral.', subtipo: 'incognita', condicionCierre: 'Encontrarlo.' }, 'david');
  assert.equal((q.records[0]!.record as { responsable: string }).responsable, f.repo.owner().rol);
  await assert.rejects(f.kb.addSynthesis({ titulo: 'x', texto: 'y', dependencias: ['HE-nope'] }, 'david'), /no existe/);
  await assert.rejects(f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'Nuevo', clase_entidad: 'otra' }] }, 'david'), /clase_entidad/);
});

test('a year or a month becomes that period\'s first day with the matching precision, as KBOL requires', async t => {
  const f = await setup(t);
  const year = await f.kb.captureFact({ ...FACT, fecha: '2025' }, 'david');
  const month = await f.kb.captureFact({ ...FACT, fecha: '2025-03' }, 'david');
  const h = (d: typeof year) => d.records[0]!.record as { fecha: string; precision: string };
  assert.deepEqual([h(year).fecha, h(year).precision], ['2025-01-01', 'anio']);
  assert.deepEqual([h(month).fecha, h(month).precision], ['2025-03-01', 'mes']);
});

test('the citation hash is the original PDF\'s, which is what kbol citas compares with the source', async t => {
  const f = await setup(t);
  const draft = await f.kb.captureFact(FACT, 'david');
  assert.equal((draft.records[0]!.record as { sources: { hash: string }[] }).sources[0]!.hash, ORIGINAL_SHA);
});

test('two confirmations of the same draft commit once and leave the records in place', async t => {
  const f = await setup(t);
  const a = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'SWaT', clase_entidad: 'dataset' }] }, 'david');
  const [first, second] = await Promise.allSettled([f.kb.confirm({ draftIds: [a.id] }), f.kb.confirm({ draftIds: [a.id] })]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.match(String((second as PromiseRejectedResult).reason), /no está pendiente/);
  for (const r of a.records) assert.ok(f.repo.get(r.record.id), r.record.id);
});

test('a draft that reuses records of another pending draft cannot be confirmed alone, nor the other discarded', async t => {
  const f = await setup(t);
  const a = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'SWaT', clase_entidad: 'dataset' }] }, 'david');
  const b = await f.kb.captureFact({ ...FACT, afirmacion: 'Otra afirmación.', entidades: [{ nombre: 'swat' }] }, 'tutor');
  assert.equal(b.records.length, 1, 'sources and entity come from the first draft');
  await assert.rejects(f.kb.confirm({ draftIds: [b.id] }), /confírmalos juntos/);
  await assert.rejects(f.kb.discard({ draftId: a.id }), /usa registros de este/);
  await f.kb.confirm({ draftIds: [a.id, b.id] });
  assert.ok(f.repo.get(b.records[0]!.record.id));
});

test('a question rests only on sources and facts, and a known name with another class is refused', async t => {
  const f = await setup(t);
  const a = await f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'Transformer', clase_entidad: 'concepto' }] }, 'david');
  const entityId = a.records.find(x => x.record.type === 'entidad')!.record.id;
  await assert.rejects(f.kb.addQuestion({ titulo: 'x', texto: 'y', subtipo: 'incognita', condicionCierre: 'z', basadaEn: [entityId] }, 'david'), /solo admite fuente o hecho/);
  await assert.rejects(f.kb.captureFact({ ...FACT, entidades: [{ nombre: 'transformer', clase_entidad: 'familia_modelo' }] }, 'david'), /ya existe como concepto/);
});

test('confirmation checks the quote again: a paper incorporated with another structure blocks it', async t => {
  const f = await setup(t);
  const a = await f.kb.captureFact(FACT, 'david');
  const doc = f.store.getDocument('d1')!;
  f.store.saveDocument({ ...doc, revision: doc.revision + 1, estructuraSha256: 'f'.repeat(64) }, doc.revision);
  await assert.rejects(f.kb.confirm({ draftIds: [a.id] }), /ya no se puede comprobar/);
});

test('free text cannot open KBOL markup, and a quote keeps the form kbol citas compares', () => {
  assert.equal(escapeBody('<clausula id="C1">\nver <hecho ref="x">y</hecho>'), '\\<clausula id="C1">\nver \\<hecho ref="x">y\\</hecho>');
  assert.equal(quoteContext('detection of infor-\n  mation  flows\nin plants'), 'detection of information flows in plants');
});
