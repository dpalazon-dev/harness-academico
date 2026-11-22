import { addDays, localDate } from './assessment/calendar.ts';
import type { LecturasArmazon, PasoDeUnidad } from './armazon.ts';
import type { KbDraft } from './kb/drafts.ts';
import type { StudyState } from './operations.ts';
import type { Today, UnitOverview } from './practice/service.ts';
import type { TaskKind } from './practice/types.ts';
import type { ConversationView } from './sessions/types.ts';
import type { AreaFilter } from './study/areas.ts';
import type { PlanProposal, StudyPlan } from './study/types.ts';

/** Lo que el inicio del armazón lee del plugin (spec, historias 15 y 17 a 22; ADR 0004): el paso propuesto principal
 * y los demás, lo de hoy, lo fijado para la semana y lo que quedó abierto, del espacio activo. Lo pendiente de decidir
 * se lee aparte (`leerPorDecidir`), porque lo pinta la barra lateral en cualquier pantalla (ticket 02 de la segunda
 * ronda). */

export const UPCOMING_DAYS = 7;

export interface UpcomingDay { day: string; units: UnitOverview[] }

/** Reviews the regulator has already dated, from tomorrow to `days` days ahead, by day. Nothing is estimated:
 * a unit without a date, never attempted or out of the queue does not appear; today and overdue belong to Hoy. */
export function upcomingReviews(route: readonly UnitOverview[], today: string, days = UPCOMING_DAYS): UpcomingDay[] {
  const last = addDays(today, days);
  const byDay = new Map<string, UnitOverview[]>();
  for (const r of route) {
    if (r.stage.kind === 'nueva' || r.stage.kind === 'fuera' || r.dueDate === null) continue;
    if (r.dueDate <= today || r.dueDate > last) continue;
    byDay.set(r.dueDate, [...(byDay.get(r.dueDate) ?? []), r]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, units]) => ({ day, units: units.sort((a, b) => a.title.localeCompare(b.title, 'es')) }));
}

export interface RepasoDeHoy {
  unitId: string;
  titulo: string;
  tarea: TaskKind;
  /** El intento a medias de la unidad, que se retoma en vez de empezar otro. */
  intentoId: string | null;
  /** Fecha del regulador, o null para un intento a medias. */
  fecha: string | null;
}

export interface LecturaInicio {
  plan: { id: string; objetivo: string } | null;
  /** El de la primera unidad del plan que tenga uno. */
  paso: PasoDeUnidad | null;
  /** Los de las demás unidades. Repasar y reconstruir llevan a la misma pantalla de práctica que un repaso: si la
   * unidad ya está en `repasos`, no se repite. */
  pasos: PasoDeUnidad[];
  /** La cola de hoy del regulador y los intentos a medias, sin las unidades nunca practicadas: esas se estudian
   * antes de repasarse. Si el paso principal es de práctica (repasar o reconstruir), su unidad no se repite aquí. */
  repasos: RepasoDeHoy[];
  /** De mañana a siete días, por día; solo fechas que el regulador ya fijó. */
  proximos: { dia: string; unidades: { unitId: string; titulo: string; tarea: TaskKind }[] }[];
  /** La conversación más reciente con algo abierto o un siguiente paso en su resumen. */
  abierto: { chatId: string; titulo: string; fecha: string; abierto: string[]; siguiente: string } | null;
}

/** Lo que espera la decisión de David: las unidades que propuso el tutor y sus cambios del plan, del espacio activo, y
 * los borradores de conocimiento, que son de la base, común a todos los espacios. */
export interface PorDecidir {
  unidades: { id: string; revision: number; titulo: string; capacidad: string; notas: string; planId: string | null }[];
  /** `caducado`: por qué ya no se puede aplicar (otro cambio tocó sus unidades o ya no encaja); solo cabe descartarlo. */
  cambios: { id: string; descripcion: string[]; motivo: string; caducado: string | null }[];
  borradores: { id: string; tipo: KbDraft['kind']; resumen: string; origen: KbDraft['origin']; registros: number }[];
}

export interface FuentesPorDecidir {
  estado: (filter: AreaFilter) => StudyState;
  planActual: (filter: AreaFilter) => StudyPlan | null;
  borradores: () => KbDraft[];
  caducidad: (proposal: PlanProposal) => string | null;
}

export interface FuentesInicio {
  lecturas: LecturasArmazon;
  estado: (filter: AreaFilter) => StudyState;
  planActual: (filter: AreaFilter) => StudyPlan | null;
  hoy: (filter: AreaFilter) => Today;
  ruta: (filter: AreaFilter) => UnitOverview[];
  conversaciones: (filter: AreaFilter) => ConversationView[];
  now: () => string;
  timeZone: string;
}

/** Los pasos que abren la pantalla de práctica, como un repaso. */
const DE_PRACTICA = new Set<PasoDeUnidad['tipo']>(['repasar', 'reconstruir']);

/** El título de una unidad por su id; si no está, el id. */
function titulos(estado: StudyState): (id: string) => string {
  const porId = new Map(estado.units.map(u => [u.id, u.title]));
  return id => porId.get(id) ?? id;
}

function describir(op: PlanProposal['ops'][number], titulo: (id: string) => string): string {
  if (op.op === 'add') return `Añadir «${titulo(op.unitId)}»${op.index === undefined ? '' : ` en la posición ${op.index + 1}`}`;
  if (op.op === 'remove') return `Quitar «${titulo(op.unitId)}»`;
  return `Mover «${titulo(op.unitId)}» a la posición ${op.index + 1}`;
}

export function leerInicio(f: FuentesInicio, filter: AreaFilter): LecturaInicio {
  const hoy = localDate(f.now(), f.timeZone);
  const todos = f.lecturas.pasos(filter);
  const paso = todos[0] ?? null;

  const ruta = f.ruta(filter);
  const nuevas = new Set(ruta.filter(r => r.stage.kind === 'nueva').map(r => r.unitId));
  const { queue, open } = f.hoy(filter);
  const estado = f.estado(filter);
  const titulo = titulos(estado);
  const principalRepaso = paso && DE_PRACTICA.has(paso.tipo) ? paso.unitId : null;
  const repasos: RepasoDeHoy[] = [
    ...open.map(({ attempt }) => ({ unitId: attempt.unitId, titulo: titulo(attempt.unitId), tarea: attempt.taskKind, intentoId: attempt.id, fecha: null })),
    ...queue.filter(q => !nuevas.has(q.unitId)).map(q => ({ unitId: q.unitId, titulo: q.title, tarea: q.nextTaskKind, intentoId: null, fecha: q.dueDate })),
  ].filter(r => r.unitId !== principalRepaso);
  const enRepasos = new Set(repasos.map(r => r.unitId));

  const conAlgo = f.conversaciones(filter).find(c => c.summary && (c.summary.abierto.length > 0 || c.summary.siguiente.trim() !== ''));

  return {
    plan: (() => { const p = f.planActual(filter); return p ? { id: p.id, objetivo: p.goal } : null; })(),
    paso,
    pasos: todos.slice(1).filter(p => !(DE_PRACTICA.has(p.tipo) && enRepasos.has(p.unitId))),
    repasos,
    proximos: upcomingReviews(ruta, hoy).map(d => ({ dia: d.day, unidades: d.units.map(u => ({ unitId: u.unitId, titulo: u.title, tarea: u.nextTaskKind })) })),
    abierto: conAlgo?.summary
      ? { chatId: conAlgo.id, titulo: conAlgo.title, fecha: conAlgo.updatedAt, abierto: conAlgo.summary.abierto, siguiente: conAlgo.summary.siguiente }
      : null,
  };
}

export function leerPorDecidir(f: FuentesPorDecidir, filter: AreaFilter): PorDecidir {
  const estado = f.estado(filter);
  const titulo = titulos(estado);
  return {
    unidades: estado.units.filter(u => u.status === 'propuesta').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(u => ({ id: u.id, revision: u.revision, titulo: u.title, capacidad: u.capability, notas: u.notes, planId: f.planActual(u.areaId)?.id ?? null })),
    cambios: estado.proposals.filter(p => p.status === 'pendiente' && p.author === 'tutor')
      .map(p => ({ id: p.id, descripcion: p.ops.map(op => describir(op, titulo)), motivo: p.rationale, caducado: f.caducidad(p) })),
    borradores: f.borradores().filter(d => d.status === 'pendiente')
      .map(d => ({ id: d.id, tipo: d.kind, resumen: d.summary, origen: d.origin, registros: d.records.length })),
  };
}
