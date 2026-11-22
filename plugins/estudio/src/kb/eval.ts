import type { SearchResult } from './search.ts';

/** One question of David's bench: the ids (records, or `documento:<id>#<clave>`) a good search must return. */
export interface BenchQuestion { pregunta: string; esperados: string[]; entidad?: string }

export interface BenchReport {
  k: number;
  preguntas: number;
  recallMedio: number;
  mrr: number;
  fallos: { pregunta: string; faltan: string[]; devueltos: string[] }[];
}

export function parseBench(value: unknown): BenchQuestion[] {
  if (!Array.isArray(value)) throw new Error('El banco debe ser una lista de preguntas');
  return value.map((q, i) => {
    const r = q as Partial<BenchQuestion>;
    if (!r || typeof r.pregunta !== 'string' || !Array.isArray(r.esperados) || r.esperados.length === 0 || !r.esperados.every(e => typeof e === 'string')) {
      throw new Error(`Pregunta ${i + 1}: necesita "pregunta" y una lista no vacía de "esperados"`);
    }
    return { pregunta: r.pregunta, esperados: r.esperados, ...(typeof r.entidad === 'string' ? { entidad: r.entidad } : {}) };
  });
}

/** Recall@k over the direct hits (related records do not count: they were not retrieved by the query) and MRR of the first expected hit. */
export function evaluate(run: (q: BenchQuestion, k: number) => SearchResult, bench: BenchQuestion[], k = 5): BenchReport {
  let recall = 0, rr = 0;
  const fallos: BenchReport['fallos'] = [];
  for (const q of bench) {
    const ids = run(q, k).hits.map(h => h.id);
    const found = q.esperados.filter(e => ids.includes(e));
    recall += found.length / q.esperados.length;
    const first = ids.findIndex(id => q.esperados.includes(id));
    rr += first === -1 ? 0 : 1 / (first + 1);
    if (found.length < q.esperados.length) fallos.push({ pregunta: q.pregunta, faltan: q.esperados.filter(e => !ids.includes(e)), devueltos: ids });
  }
  const n = bench.length || 1;
  return { k, preguntas: bench.length, recallMedio: recall / n, mrr: rr / n, fallos };
}
