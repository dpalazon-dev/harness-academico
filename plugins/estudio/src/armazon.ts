import { localDate } from './assessment/calendar.ts';
import { effectivePolicy, regulate } from './practice/policy.ts';
import { DOCUMENT_PREFIX } from './practice/prompts.ts';
import { unitStage, type UnitStage } from './practice/stage.ts';
import { SOURCE_OPENED, type AttemptStatus, type Fidelity, type PracticeAttempt, type TaskKind } from './practice/types.ts';
import { inArea, type AreaFilter } from './study/areas.ts';
import type { Notebook, NotebookKind } from './notebooks/types.ts';
import type { StudyStore } from './study/store.ts';
import { StudyError, type StudyPlan, type StudyUnit, type UnitKind, type UnitPolicy, type UnitStatus } from './study/types.ts';
import type { ConversationView } from './sessions/types.ts';
import { volcadoDe, type HechoCiclo } from './study/hechos.ts';

/** Lo que el armazón de estudio lee del plugin: el plan del espacio para la barra lateral y la unidad para su
 * página (spec del armazón, ADR 0002). El ciclo se deriva, sin modelo, de los hechos del ciclo (ADR 0004) y de la
 * evidencia de práctica; nada se guarda aquí. */

export type EstadoGrupo = 'hecho' | 'pendiente' | 'vacio';
export interface CicloUnidad { orientar: EstadoGrupo; exponer: EstadoGrupo; reconstruir: EstadoGrupo; mantener: EstadoGrupo }

export interface FuenteUnidad {
  path: string;
  documentoId: string | null;
  titulo: string;
  paginas: number | null;
  localizador: string | null;
  /** Capturas registradas al cerrar el lector de esa fuente desde la unidad (hechos «fuente trabajada»). */
  capturas: number;
  /** Fecha de la última fuente trabajada, o null si nunca se trabajó desde la unidad. */
  ultimaCaptura: string | null;
  /** Después de su última captura hubo un cierre de bloque o un intento sin abrir la fuente. */
  reconstruida: boolean;
}
export interface NotaUnidad { cuadernoId: string; cuaderno: string; id: string; simbolo: string | null; texto: string; cita: string; localizador: string }
export interface PreguntaUnidad { cuadernoId: string; cuaderno: string; id: string; pregunta: string }
/** Un cuaderno vinculado a la unidad, aunque aún no tenga bloques. */
export interface CuadernoUnidad { id: string; titulo: string; tipo: NotebookKind; notas: number; preguntas: number; actualizado: string }
export interface IntentoUnidad { id: string; fecha: string; tarea: TaskKind; estado: AttemptStatus; fidelidad: Fidelity | null }

/** Dónde está la unidad en el plan de su espacio, contando solo las unidades no archivadas. `subir` y `bajar`
 * son el índice de la lista del plan al que moverla (op `move`) para cambiarla por la vecina, o null en un extremo. */
export interface LugarEnPlan { posicion: number; total: number; subir: number | null; bajar: number | null }

/** Una conversación sobre la unidad con lo que dejó su resumen: de qué trató, qué quedó abierto y qué sigue. */
export interface ConversacionUnidad {
  id: string;
  title: string;
  updatedAt: string;
  resumen: { tema: string; abierto: string[]; siguiente: string } | null;
  /** El resumen es anterior a los últimos mensajes. */
  resumenAntiguo: boolean;
  /** Por qué falló el último resumen, si falló. */
  resumenError: string | null;
}

export interface LecturaUnidad {
  id: string;
  revision: number;
  titulo: string;
  estado: UnitStatus;
  /** El espacio de la unidad, o null si no tiene. */
  areaId: string | null;
  /** Su lugar en el plan de su espacio, o null si está fuera de él (o el espacio no tiene plan). */
  lugarEnPlan: LugarEnPlan | null;
  /** El plan actual del espacio de la unidad, aunque esté activo «Todos»; null si ese espacio no tiene. */
  planId: string | null;
  capacidad: string;
  criterio: string;
  tipo: UnitKind | null;
  practica: UnitPolicy | null;
  /** La forma de practicar que se aplica: la elegida o la que implica el tipo. */
  practicaEfectiva: UnitPolicy;
  etapa: UnitStage;
  ciclo: CicloUnidad;
  /** «Lo que sabía antes», o null si aún no lo escribió. */
  volcado: { texto: string; fecha: string; origen: 'pagina' | 'sondeo' } | null;
  fuentes: FuenteUnidad[];
  notas: NotaUnidad[];
  preguntas: PreguntaUnidad[];
  /** Del editado más recientemente al más antiguo. */
  cuadernos: CuadernoUnidad[];
  /** Del más reciente al más antiguo. */
  intentos: IntentoUnidad[];
  /** Fecha local del próximo repaso, si el regulador lo fija. */
  proximoRepaso: string | null;
  conversaciones: ConversacionUnidad[];
  /** El siguiente paso que la aplicación propone para la unidad (ADR 0004), o null si no hay ninguno. */
  paso: Paso | null;
}

/** Qué hace el paso: el armazón decide a dónde lleva cada tipo. */
export type TipoPaso = 'decidir' | 'volcado' | 'reconstruir' | 'repasar' | 'tutor';
export interface Paso { tipo: TipoPaso; accion: string; motivo: string; boton: string }
export interface PasoDeUnidad extends Paso { unitId: string; titulo: string }

const fechaCorta = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const notas = (n: number) => (n === 1 ? '1 nota' : `${n} notas`);

/** El paso propuesto de una unidad, con la prioridad de la spec (variante A del prototipo): propuesta, sin volcado,
 * fuente capturada sin reconstruir, repaso vencido, sin fuentes. Nunca bloquea otras acciones: solo las ordena. */
export function pasoDe(u: Pick<LecturaUnidad, 'estado' | 'volcado' | 'fuentes' | 'proximoRepaso' | 'etapa'>, hoy: string): Paso | null {
  if (u.estado === 'archivada') return null;
  if (u.estado === 'propuesta') return { tipo: 'decidir', accion: 'Decide si entra en tu plan', motivo: 'El tutor la propuso; no cambia nada hasta que la confirmes.', boton: 'Revisar propuesta' };
  if (!u.volcado) return { tipo: 'volcado', accion: 'Escribe lo que ya sabes', motivo: 'Sin volcado inicial no podrás ver después qué cambió.', boton: 'Escribir volcado' };
  const pendiente = u.fuentes.find(f => f.capturas > 0 && !f.reconstruida);
  if (pendiente) return { tipo: 'reconstruir', accion: 'Reconstruye sin mirar', motivo: `Capturaste ${notas(pendiente.capturas)} de «${pendiente.titulo}» y aún no lo has reconstruido.`, boton: 'Empezar reconstrucción' };
  if (u.proximoRepaso && u.proximoRepaso <= hoy) {
    const cuando = u.proximoRepaso === hoy ? 'para hoy' : `para el ${fechaCorta.format(new Date(`${u.proximoRepaso}T00:00:00Z`)).replace('.', '')}`;
    return { tipo: 'repasar', accion: 'Repasa', motivo: `El regulador lo fijó ${cuando}: ${u.etapa.label.charAt(0).toLowerCase()}${u.etapa.label.slice(1)}.`, boton: 'Practicar ahora' };
  }
  if (u.fuentes.length === 0) return { tipo: 'tutor', accion: 'Estudia con el tutor', motivo: 'Tienes el volcado pero ninguna fuente: empieza exponiéndote.', boton: 'Estudiar con el tutor' };
  return null;
}

export interface UnidadDelPlan {
  id: string;
  titulo: string;
  propuesta: boolean;
  /** Propuestas y unidades activas que no están en el plan: se listan detrás para no perderlas. */
  fueraDelPlan: boolean;
  ciclo: CicloUnidad;
}
export interface LecturaPlan { plan: { id: string; objetivo: string } | null; unidades: UnidadDelPlan[] }

export interface LecturasArmazon {
  /** El plan actual del espacio, en orden; detrás, las propuestas del tutor y las unidades activas fuera de él. */
  plan(filter: AreaFilter): LecturaPlan;
  /** Una unidad del espacio; fuera de él no existe. */
  unidad(unitId: string, filter: AreaFilter): LecturaUnidad;
  /** Los pasos propuestos de las unidades confirmadas, en el orden del plan y después las de fuera de él. Las
   * propuestas del tutor no entran: se deciden en la bandeja. */
  pasos(filter: AreaFilter): PasoDeUnidad[];
}

export interface OpcionesLecturas {
  now: () => string;
  timeZone: string;
  conversaciones: (filter: AreaFilter) => ConversationView[];
  /** El plan actual de un espacio, el mismo al que van los cambios propuestos sin plan explícito. */
  planActual: (filter: AreaFilter) => StudyPlan | null;
}

const vigente = (a: PracticeAttempt) => (a.status === 'frozen' || a.status === 'graded') && a.frozenAt !== null;
/** Una respuesta congelada sin haber abierto la fuente es una reconstrucción sin mirar. */
const sinMirar = (a: PracticeAttempt) => vigente(a) && (a.cueLevelAtFreeze ?? a.cueLevel) < SOURCE_OPENED;
const valorado = (a: PracticeAttempt) => a.status === 'graded' && a.grades.length > 0;

/** Lo trabajado de cada documento: capturas, fecha de la última y si se reconstruyó después. */
function trabajoPorFuente(hechos: readonly HechoCiclo[], attempts: readonly PracticeAttempt[]) {
  const reconstrucciones = [
    ...hechos.filter(h => h.tipo === 'cierre-bloque').map(h => h.fecha),
    ...attempts.filter(sinMirar).map(a => a.frozenAt!),
  ];
  const trabajo = new Map<string, { capturas: number; ultima: string; reconstruida: boolean }>();
  for (const h of hechos) {
    if (h.tipo !== 'fuente-trabajada') continue;
    const t = trabajo.get(h.documentoId);
    trabajo.set(h.documentoId, { capturas: (t?.capturas ?? 0) + h.capturas, ultima: t && t.ultima > h.fecha ? t.ultima : h.fecha, reconstruida: false });
  }
  for (const t of trabajo.values()) t.reconstruida = reconstrucciones.some(r => r > t.ultima);
  return trabajo;
}

interface EntradaCiclo {
  volcado: boolean;
  hechos: readonly HechoCiclo[];
  attempts: readonly PracticeAttempt[];
  etapa: UnitStage['kind'];
  repasoVencido: boolean;
}

/** Las reglas de la spec para los cuatro grupos. Un intento es uno terminado (congelado o valorado): uno abierto o
 * abandonado no es evidencia de nada. */
function cicloDe({ volcado, hechos, attempts, etapa, repasoVencido }: EntradaCiclo): CicloUnidad {
  const trabajo = [...trabajoPorFuente(hechos, attempts).values()];
  const intentos = attempts.some(vigente);
  const cierre = hechos.some(h => h.tipo === 'cierre-bloque');
  return {
    orientar: volcado ? 'hecho' : 'pendiente',
    exponer: trabajo.length > 0 ? 'hecho' : volcado ? 'pendiente' : 'vacio',
    reconstruir: trabajo.some(t => !t.reconstruida) ? 'pendiente' : cierre || intentos ? 'hecho' : 'vacio',
    // Sin intentos no hay nada que mantener. Fuera de los casos de la spec (sin valorar, solo práctica en sesión, o
    // sin repasos como con «localizar») aún no hay un repaso que mantener: sin empezar, nunca pendiente para siempre.
    mantener: !intentos ? 'vacio'
      : repasoVencido || etapa === 'reaprendiendo' ? 'pendiente'
      : etapa === 'intervalo' || etapa === 'mantenimiento' ? 'hecho'
      : 'vacio',
  };
}

export function createLecturas(store: StudyStore, options: OpcionesLecturas): LecturasArmazon {
  const { now, timeZone } = options;

  /** Las capturas de una fuente salen de sus hechos «fuente trabajada»; su última captura es la fecha del último. Una
   * fuente está reconstruida si después hubo un cierre de bloque o un intento sin abrir la fuente. */
  function fuentes(unit: StudyUnit, hechos: HechoCiclo[], attempts: PracticeAttempt[]): FuenteUnidad[] {
    const trabajo = trabajoPorFuente(hechos, attempts);
    return unit.sources.map(source => {
      const documentoId = source.path.startsWith(DOCUMENT_PREFIX) ? source.path.slice(DOCUMENT_PREFIX.length) : null;
      const doc = documentoId ? store.getDocument(documentoId) : null;
      const t = documentoId ? trabajo.get(documentoId) : undefined;
      return {
        path: source.path, documentoId, titulo: doc?.title ?? source.path, paginas: doc?.paginas ?? null,
        localizador: source.locator ?? null, capturas: t?.capturas ?? 0, ultimaCaptura: t?.ultima ?? null, reconstruida: t?.reconstruida ?? false,
      };
    });
  }

  /** Con `completa` falso basta el ciclo: la barra lateral no necesita conversaciones. */
  function leer(unit: StudyUnit, cuadernosTodos: Notebook[], filter: AreaFilter, completa: boolean): LecturaUnidad {
    const attempts = store.listAttempts(unit.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const regulation = regulate(unit, attempts, store.getExposures(unit.id)?.instants ?? [], now(), timeZone);
    const valorados = attempts.filter(valorado).length;
    const etapa = unitStage(regulation, valorados);
    // Sin evidencia valorada, la fecha del regulador es la de la primera práctica, no un repaso.
    const proximoRepaso = regulation.mode === 'fuera' || valorados === 0 ? null : regulation.dueDate;
    const hechos = store.getHechos(unit.id)?.hechos ?? [];
    const deFuentes = fuentes(unit, hechos, attempts);
    const volcado = volcadoDe(hechos);
    const cuadernos = cuadernosTodos.filter(nb => nb.unitId === unit.id);
    const notas: NotaUnidad[] = [];
    const preguntas: PreguntaUnidad[] = [];
    for (const nb of cuadernos) for (const b of nb.blocks) {
      if (b.kind === 'nota') notas.push({ cuadernoId: nb.id, cuaderno: nb.title, id: b.id, simbolo: b.symbol, texto: b.text, cita: b.quote, localizador: b.locator });
      if (b.kind === 'recuperacion') preguntas.push({ cuadernoId: nb.id, cuaderno: nb.title, id: b.id, pregunta: b.question });
    }

    const hoy = localDate(now(), timeZone);
    const ciclo = cicloDe({
      volcado: volcado !== null, hechos, attempts, etapa: etapa.kind,
      repasoVencido: proximoRepaso !== null && proximoRepaso <= hoy,
    });

    const plan = completa ? options.planActual(unit.areaId) : null;
    const lectura: LecturaUnidad = {
      id: unit.id, revision: unit.revision, titulo: unit.title, estado: unit.status, areaId: unit.areaId,
      planId: plan?.id ?? null, lugarEnPlan: plan ? lugarEn(plan, unit.id) : null,
      capacidad: unit.capability, criterio: unit.criterion, tipo: unit.kind, practica: unit.policy, practicaEfectiva: effectivePolicy(unit),
      etapa, ciclo, volcado: volcado && { texto: volcado.texto, fecha: volcado.fecha, origen: volcado.origen }, fuentes: deFuentes, notas, preguntas,
      cuadernos: [...cuadernos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(nb => ({
        id: nb.id, titulo: nb.title, tipo: nb.kind, actualizado: nb.updatedAt,
        notas: nb.blocks.filter(b => b.kind === 'nota').length, preguntas: nb.blocks.filter(b => b.kind === 'recuperacion').length,
      })),
      intentos: attempts.map(a => ({ id: a.id, fecha: a.openedAt, tarea: a.taskKind, estado: a.status, fidelidad: a.grades.at(-1)?.fidelity ?? null })),
      proximoRepaso,
      conversaciones: completa
        ? options.conversaciones(filter).filter(c => c.links.some(l => l.kind === 'unidad' && l.id === unit.id)).map(c => ({
          id: c.id, title: c.title, updatedAt: c.updatedAt,
          resumen: c.summary && { tema: c.summary.tema, abierto: c.summary.abierto, siguiente: c.summary.siguiente },
          resumenAntiguo: c.summaryStale, resumenError: c.summaryError,
        }))
        : [],
      paso: null,
    };
    lectura.paso = pasoDe(lectura, hoy);
    return lectura;
  }

  function lugarEn(plan: StudyPlan, unitId: string): LugarEnPlan | null {
    // Las archivadas siguen en la lista del plan pero no se ven: los vecinos son los visibles.
    const visibles = plan.unitIds.map((id, indice) => ({ id, indice })).filter(x => store.getUnit(x.id)?.status !== 'archivada');
    const i = visibles.findIndex(x => x.id === unitId);
    if (i === -1) return null;
    return { posicion: i + 1, total: visibles.length, subir: visibles[i - 1]?.indice ?? null, bajar: visibles[i + 1]?.indice ?? null };
  }

  /** Las unidades del espacio en el orden de la barra lateral: el plan, y detrás las que están fuera de él. */
  function ordenadas(filter: AreaFilter) {
    const plan = options.planActual(filter);
    const units = store.listUnits().filter(u => inArea(u, filter));
    const byId = new Map(units.map(u => [u.id, u]));
    const enPlan = (plan?.unitIds ?? []).map(id => byId.get(id)).filter((u): u is StudyUnit => !!u && u.status !== 'archivada');
    const fuera = units.filter(u => u.status !== 'archivada' && !enPlan.includes(u))
      // Primero las propuestas, que piden decisión; dentro de cada grupo, por antigüedad.
      .sort((a, b) => Number(a.status !== 'propuesta') - Number(b.status !== 'propuesta') || a.createdAt.localeCompare(b.createdAt));
    return { plan, enPlan, fuera };
  }

  return {
    plan(filter) {
      const { plan, enPlan, fuera } = ordenadas(filter);
      const cuadernos = store.listNotebooks();
      const fila = (u: StudyUnit, fueraDelPlan: boolean): UnidadDelPlan => ({
        id: u.id, titulo: u.title, propuesta: u.status === 'propuesta', fueraDelPlan, ciclo: leer(u, cuadernos, filter, false).ciclo,
      });
      return {
        plan: plan ? { id: plan.id, objetivo: plan.goal } : null,
        unidades: [...enPlan.map(u => fila(u, false)), ...fuera.map(u => fila(u, true))],
      };
    },

    unidad(unitId, filter) {
      const unit = store.getUnit(unitId);
      if (!unit || !inArea(unit, filter)) throw new StudyError('NOT_FOUND', `La unidad ${unitId} no existe`);
      return leer(unit, store.listNotebooks(), filter, true);
    },

    pasos(filter) {
      const { enPlan, fuera } = ordenadas(filter);
      const cuadernos = store.listNotebooks();
      return [...enPlan, ...fuera].filter(u => u.status === 'activa').flatMap(u => {
        const { paso } = leer(u, cuadernos, filter, false);
        return paso ? [{ ...paso, unitId: u.id, titulo: u.title }] : [];
      });
    },
  };
}
