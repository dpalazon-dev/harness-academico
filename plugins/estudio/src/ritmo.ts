import { addDays, localDate } from './assessment/calendar.ts';
import type { AreaFilter } from './study/areas.ts';
import type { TraceEntry } from './practice/policy.ts';
import type { LeerHecho } from './agenda.ts';

/** El ritmo de estudio del espacio activo (ticket 06 de la segunda ronda): cuatro cifras para el inicio y la actividad
 * de un año para Progreso. Día estudiado es el de la agenda (`LeerHecho`); no se mide tiempo de estudio. */
export interface LecturaRitmo {
  hoy: string;
  /** Días estudiados en las últimas `RITMO_SEMANAS` semanas, hoy incluido. */
  diasEstudiados: number;
  /** Días estudiados seguidos hasta hoy; si hoy aún no, hasta ayer, para que la racha no caiga a cero cada mañana. */
  racha: number;
  /** Repasos de las últimas `RITMO_SEMANAS` semanas y cuántos se hicieron en la fecha fijada o antes. */
  repasos: { total: number; aTiempo: number };
  /** Intentos valorados por semana, la más antigua primero; la última acaba hoy. */
  intentosPorSemana: number[];
  /** La última semana frente a la media de las anteriores. */
  tendencia: 'sube' | 'baja' | 'igual';
  /** Cuánto se hizo cada día (elementos de lo hecho, como la agenda), el más antiguo primero, `ACTIVIDAD_DIAS` días. */
  actividad: { dia: string; n: number }[];
}

export const RITMO_SEMANAS = 4;
export const ACTIVIDAD_DIAS = 365;

export interface FuentesRitmo {
  hecho: LeerHecho;
  /** La traza del regulador de cada unidad del espacio, en orden de valoración. Solo las unidades que el regulador
   * programa (activas y sin política `localizar`) tienen traza: sus intentos marcan día estudiado, pero no entran en los
   * repasos ni en los intentos por semana. */
  trazas: (filter: AreaFilter) => TraceEntry[][];
  now: () => string;
  timeZone: string;
}

/** Rehace las fechas que fijó el regulador: un intento elegible es un repaso si un intento anterior fijó fecha, y va a
 * tiempo si se hizo ese día o antes. La fecha sigue a `regulate`: un intento elegible la fija; uno de práctica solo
 * puede adelantarla. Como en el regulador, un fallo en práctica antes del primer elegible ya fija fecha, y ese primer
 * elegible cuenta como repaso. */
function repasos(traza: readonly TraceEntry[], desde: string): { total: number; aTiempo: number } {
  let fijada = null as string | null, total = 0, aTiempo = 0;
  for (const t of traza) {
    if (t.eligible && fijada !== null && t.day >= desde) {
      total++;
      if (t.day <= fijada) aTiempo++;
    }
    if (t.days === null) continue;
    const nueva = addDays(t.day, t.days);
    fijada = t.eligible || fijada === null || nueva < fijada ? nueva : fijada;
  }
  return { total, aTiempo };
}

export function createRitmo(f: FuentesRitmo): (filter: AreaFilter) => LecturaRitmo {
  return filter => {
    const hoy = localDate(f.now(), f.timeZone);
    const hecho = f.hecho(addDays(hoy, 1 - ACTIVIDAD_DIAS), hoy, filter);
    const actividad = Array.from({ length: ACTIVIDAD_DIAS }, (_, i) => {
      const dia = addDays(hoy, i + 1 - ACTIVIDAD_DIAS);
      return { dia, n: hecho.get(dia)?.length ?? 0 };
    });
    const estudiado = (dia: string) => hecho.has(dia);

    const desde = addDays(hoy, 1 - 7 * RITMO_SEMANAS);
    const diasEstudiados = actividad.filter(d => d.dia >= desde && d.n > 0).length;

    let racha = 0;
    for (let dia = estudiado(hoy) ? hoy : addDays(hoy, -1); racha < ACTIVIDAD_DIAS && estudiado(dia); dia = addDays(dia, -1)) racha++;

    const trazas = f.trazas(filter);
    const total = { total: 0, aTiempo: 0 };
    for (const traza of trazas) {
      const r = repasos(traza, desde);
      total.total += r.total;
      total.aTiempo += r.aTiempo;
    }

    const intentosPorSemana = Array.from({ length: RITMO_SEMANAS }, (_, i) => {
      const fin = addDays(hoy, -7 * (RITMO_SEMANAS - 1 - i)), inicio = addDays(fin, -6);
      return trazas.reduce((n, traza) => n + traza.filter(t => t.day >= inicio && t.day <= fin).length, 0);
    });
    const ultima = intentosPorSemana.at(-1)!, anteriores = intentosPorSemana.slice(0, -1);
    // Sin divisiones: la última por el número de semanas anteriores frente a su suma.
    const comparada = ultima * anteriores.length - anteriores.reduce((s, n) => s + n, 0);
    const tendencia = comparada > 0 ? 'sube' : comparada < 0 ? 'baja' : 'igual';

    return { hoy, diasEstudiados, racha, repasos: total, intentosPorSemana, tendencia, actividad };
  };
}
