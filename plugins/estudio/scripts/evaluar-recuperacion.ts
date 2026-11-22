/**
 * Measures retrieval against David's bench before considering embeddings.
 *
 *   npx tsx scripts/evaluar-recuperacion.ts --datos <core-plugin-data/estudio> [--kb <Learning>] [--almacen <dir>] [--k 5]
 *
 * The bench lives in `<Learning>/evaluacion/preguntas.json`: [{ "pregunta": "...", "esperados": ["HE-…", "documento:<id>#<clave>"] }].
 */
import fs from 'node:fs';
import path from 'node:path';
import { documentConfig } from '../src/documents/incorporar.ts';
import { createKbSearch } from '../src/kb/corpus.ts';
import { evaluate, parseBench } from '../src/kb/eval.ts';
import { kbConfig, openKbRepo } from '../src/kb/repo.ts';
import { openStudyStore } from '../src/study/store.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const datos = arg('datos');
if (!datos) { console.error('Falta --datos <carpeta de datos del plugin Estudio>'); process.exit(2); }
const kbDir = arg('kb') ?? kbConfig().kbDir;
const almacen = arg('almacen') ?? documentConfig().almacen;
const k = Number(arg('k') ?? 5);

const study = openStudyStore(path.join(datos, 'study'));
const repo = openKbRepo({ ...kbConfig(), kbDir }, () => new Date().toISOString());
const bench = parseBench(JSON.parse(fs.readFileSync(path.join(kbDir, 'evaluacion', 'preguntas.json'), 'utf8')));
const search = createKbSearch({ records: () => repo.list(), documents: () => study.listDocuments(), almacen });
const report = evaluate((q, kk) => search.search(q.pregunta, { k: kk, ...(q.entidad ? { entidad: q.entidad } : {}) }), bench, k);
console.log(JSON.stringify(report, null, 2));
