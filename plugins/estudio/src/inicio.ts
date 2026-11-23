import { addDays, localDate } from './assessment/calendar.ts';
import type { LecturasArmazon, PasoDeUnidad } from './armazon.ts';
import type { KbDraft } from './kb/drafts.ts';
import type { StudyState } from './operations.ts';
import type { Today, UnitOverview } from './practice/service.ts';
import type { TaskKind } from './practice/types.ts';
import type { ConversationView } from './sessions/types.ts';
import type { AreaFilter } from './study/areas.ts';
import type { PlanProposal, StudyPlan } from './study/types.ts';
import { describirOp } from './study/proposals.ts';

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
  /** El de la primera unidad, en el orden de los planes, que tenga uno. */
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

/** Lo que espera la decisión de David, del espacio activo: los planes que propuso el tutor, sus cambios a planes
 * activos y sus sugerencias de capacidad y criterio; y los borradores de conocimiento, que son de la base, común a
 * todos los espacios. */
export interface PorDecidir {
  planes: { id: string; revision: number; objetivo: string; elementos: number }[];
  /** `caducado`: por qué ya no se puede aplicar (otro cambio tocó sus elementos o ya no encaja); solo cabe descartarlo. */
  cambios: { id: string; planId: string; objetivo: string; descripcion: string[]; motivo: string; caducado: string | null }[];
  sugerencias: { unitId: string; revision: number; titulo: string; capacidad: string; criterio: string }[];
  borradores: { id: string; tipo: KbDraft['kind']; resumen: string; origen: KbDraft['origin']; registros: number }[];
}

export interface FuentesPorDecidir {
  estado: (filter: AreaFilter) => StudyState;
  borradores: () => KbDraft[];
  caducidad: (proposal: PlanProposal) => string | null;
}

export interface FuentesInicio {
  lecturas: LecturasArmazon;
  estado: (filter: AreaFilter) => StudyState;
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
  const planes = new Map<string, StudyPlan>(estado.plans.map(p => [p.id, p]));
  const porFecha = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  return {
    planes: estado.plans.filter(p => p.estado === 'propuesto').sort(porFecha)
      .map(p => ({ id: p.id, revision: p.revision, objetivo: p.goal, elementos: p.elementos.length })),
    cambios: estado.proposals.filter(p => p.status === 'pendiente' && p.author === 'tutor').sort(porFecha).flatMap((p: PlanProposal) => {
      const plan = planes.get(p.planId);
      if (!plan || plan.estado === 'archivado') return [];
      return [{ id: p.id, planId: plan.id, objetivo: plan.goal, descripcion: p.ops.map(op => describirOp(op, plan.elementos)), motivo: p.rationale, caducado: f.caducidad(p) }];
    }),
    sugerencias: estado.units.filter(u => u.sugerencia && u.status !== 'archivada').sort((a, b) => a.sugerencia!.createdAt.localeCompare(b.sugerencia!.createdAt))
      .map(u => ({ unitId: u.id, revision: u.revision, titulo: u.title, capacidad: u.sugerencia!.capability, criterio: u.sugerencia!.criterion })),
    borradores: f.borradores().filter(d => d.status === 'pendiente')
      .map(d => ({ id: d.id, tipo: d.kind, resumen: d.summary, origen: d.origin, registros: d.records.length })),
  };
}
