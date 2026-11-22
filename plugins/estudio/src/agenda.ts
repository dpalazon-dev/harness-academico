import { addDays, daysBetween, localDate } from './assessment/calendar.ts';
import type { StudyStore } from './study/store.ts';
import { inArea, type AreaFilter } from './study/areas.ts';
import { fields } from './study/schema.ts';
import { StudyError } from './study/types.ts';
import type { ChatRecord } from './probe.ts';
import type { TaskKind } from './practice/types.ts';
import type { Today, UnitOverview } from './practice/service.ts';
import type { PasoDeUnidad } from './armazon.ts';

/** La agenda del inicio (ticket 05 de la segunda ronda): por día, lo hecho y lo pendiente del espacio activo. Un día
 * estudiado es uno con al menos un intento, un hecho del ciclo o un mensaje de David en una conversación del espacio
 * (spec, «Día estudiado»); las ediciones de cuaderno no cuentan: solo se guarda la fecha de la última. */

/** Lo hecho un día. */
export type HechoAgenda =
  | { tipo: 'intento'; unitId: string; titulo: string; tarea: TaskKind; intentoId: string }
  | { tipo: 'volcado' | 'fuente-trabajada' | 'cierre-bloque'; unitId: string; titulo: string }
  | { tipo: 'conversacion'; chatId: string; titulo: string; unitId: string | null };

/** Lo pendiente un día: los repasos que el regulador fijó para él y, hoy, también los vencidos, el intento a medias
 * (sin fecha) y los pasos propuestos. */
export type PendienteAgenda =
  | { tipo: 'repaso'; unitId: string; titulo: string; tarea: TaskKind; intentoId: string | null; fecha: string | null; vencidoDias: number }
  | { tipo: 'paso'; unitId: string; titulo: string; paso: PasoDeUnidad };

export interface DiaAgenda { dia: string; pendientes: PendienteAgenda[]; hecho: HechoAgenda[] }
export interface LecturaAgenda { hoy: string; desde: string; hasta: string; dias: DiaAgenda[] }

/** Un año: un rango elegido a mano no pide más, y acota el trabajo de una lectura. */
export const AGENDA_MAX_DIAS = 366;

export interface FuentesAgenda {
  store: StudyStore;
  /** Las conversaciones del núcleo, con la fecha de su última actividad. */
  sesiones: () => { id: string; title: string; updatedAt: string }[];
  sesion: (id: string) => ChatRecord | null;
  hoy: (filter: AreaFilter) => Today;
  ruta: (filter: AreaFilter) => UnitOverview[];
  pasos: (filter: AreaFilter) => PasoDeUnidad[];
  now: () => string;
  timeZone: string;
}

/** Los pasos que abren la pantalla de práctica, como un repaso: si la unidad ya está en los repasos, no se repite. */
const DE_PRACTICA = new Set<PasoDeUnidad['tipo']>(['repasar', 'reconstruir']);

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

function rango(input: unknown): { desde: string; hasta: string } {
  const r = fields(input, ['desde', 'hasta'], 'input');
  const fecha = (v: unknown, nombre: string) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) invalid(`input.${nombre} debe ser una fecha AAAA-MM-DD`);
    try { addDays(v, 0); } catch { invalid(`input.${nombre} no es una fecha válida`); }
    return v;
  };
  const desde = fecha(r.desde, 'desde'), hasta = fecha(r.hasta, 'hasta');
  const dias = daysBetween(desde, hasta) + 1;
  if (dias < 1) invalid('input.hasta no puede ser anterior a input.desde');
  if (dias > AGENDA_MAX_DIAS) invalid(`La agenda lee como mucho ${AGENDA_MAX_DIAS} días`);
  return { desde, hasta };
}

/** Los instantes de los mensajes de David en una conversación, leídos una vez por versión (`updatedAt`): la agenda se
 * relee con cada aviso del plugin y no debe abrir cada vez todas las transcripciones. */
type MensajesDeDavid = (sesion: { id: string; updatedAt: string }) => string[];

function mensajesDeDavid(sesion: FuentesAgenda['sesion']): MensajesDeDavid {
  const cache = new Map<string, { updatedAt: string; instantes: string[] }>();
  return ({ id, updatedAt }) => {
    const hit = cache.get(id);
    if (hit?.updatedAt === updatedAt) return hit.instantes;
    let chat: ChatRecord | null = null;
    try { chat = sesion(id); } catch { /* una conversación ilegible no tumba la agenda */ }
    const instantes = (chat?.messages ?? [])
      .filter(m => m.role === 'user' && typeof m.timestamp === 'number' && Number.isFinite(m.timestamp))
      .map(m => new Date((m as { timestamp: number }).timestamp).toISOString());
    if (chat) cache.set(id, { updatedAt, instantes });
    return instantes;
  };
}

/** Lo hecho del espacio por día entre `desde` y `hasta`, sin pasar de hoy: la definición de día estudiado, que comparten
 * la agenda y el ritmo. Un día sin nada no aparece. */
export type LeerHecho = (desde: string, hasta: string, filter: AreaFilter) => Map<string, HechoAgenda[]>;

/** `LeerHecho` con su caché de mensajes para toda la activación. */
export function createHecho(f: Pick<FuentesAgenda, 'store' | 'sesiones' | 'sesion' | 'now' | 'timeZone'>): LeerHecho {
  const mensajes = mensajesDeDavid(f.sesion);
  return (desde, hasta, filter) => {
    const hoy = localDate(f.now(), f.timeZone);
    const diaDe = (instante: string) => localDate(instante, f.timeZone);
    const enRango = (d: string) => d >= desde && d <= hasta && d <= hoy;
    const dias = new Map<string, HechoAgenda[]>();
    const anotar = (d: string, h: HechoAgenda) => {
      const x = dias.get(d);
      if (x) x.push(h); else dias.set(d, [h]);
    };

    // Lo pasado vale aunque la unidad esté archivada después: ocurrió.
    const unidades = f.store.listUnits().filter(u => inArea(u, filter));
    const titulos = new Map(unidades.map(u => [u.id, u.title]));

    for (const a of f.store.listAttempts()) {
      const titulo = titulos.get(a.unitId);
      if (titulo === undefined || a.status === 'abandoned' || a.status === 'open' || !a.frozenAt) continue;
      const d = diaDe(a.frozenAt);
      if (enRango(d)) anotar(d, { tipo: 'intento', unitId: a.unitId, titulo, tarea: a.taskKind, intentoId: a.id });
    }

    for (const u of unidades) {
      for (const h of f.store.getHechos(u.id)?.hechos ?? []) {
        const d = diaDe(h.fecha);
        if (enRango(d)) anotar(d, { tipo: h.tipo, unitId: u.id, titulo: u.title });
      }
    }

    const registros = new Map(f.store.listConversations().map(c => [c.id, c]));
    for (const s of f.sesiones()) {
      const registro = registros.get(s.id);
      // Un mensaje en el rango deja la conversación actualizada después de su comienzo.
      if (!inArea({ areaId: registro?.areaId ?? null }, filter) || diaDe(s.updatedAt) < desde) continue;
      const conMensaje = new Set<string>();
      for (const instante of mensajes(s)) {
        const d = diaDe(instante);
        if (enRango(d)) conMensaje.add(d);
      }
      for (const d of conMensaje) anotar(d, { tipo: 'conversacion', chatId: s.id, titulo: s.title, unitId: registro?.unitId ?? null });
    }
    return dias;
  };
}

/** La operación `agenda`, sobre la lectura de lo hecho que comparte con el ritmo. */
export function createAgenda(f: FuentesAgenda, hecho: LeerHecho): (input: unknown, filter: AreaFilter) => LecturaAgenda {
  return (input, filter) => leerAgenda(f, hecho, input, filter);
}

function leerAgenda(f: FuentesAgenda, hecho: LeerHecho, input: unknown, filter: AreaFilter): LecturaAgenda {
  const { desde, hasta } = rango(input);
  const hoy = localDate(f.now(), f.timeZone);
  const enRango = (d: string) => d >= desde && d <= hasta;

  const dias = new Map<string, DiaAgenda>();
  const del = (d: string) => {
    let x = dias.get(d);
    if (!x) dias.set(d, x = { dia: d, pendientes: [], hecho: [] });
    return x;
  };
  for (const [d, h] of hecho(desde, hasta, filter)) del(d).hecho.push(...h);
  const titulos = new Map(f.store.listUnits().filter(u => inArea(u, filter)).map(u => [u.id, u.title]));

  const ruta = f.ruta(filter);
  // Una unidad nunca practicada se estudia antes de repasarse: el regulador la pone en cola, pero no es un repaso.
  const fijada = (r: UnitOverview) => r.stage.kind !== 'nueva' && r.stage.kind !== 'fuera' && r.dueDate !== null;
  if (enRango(hoy)) {
    const { queue, open } = f.hoy(filter);
    const nuevas = new Set(ruta.filter(r => r.stage.kind === 'nueva').map(r => r.unitId));
    const retraso = (fecha: string) => Math.max(0, daysBetween(fecha, hoy));
    const repasos: PendienteAgenda[] = [
      ...open.map(({ attempt }) => ({ tipo: 'repaso' as const, unitId: attempt.unitId, titulo: titulos.get(attempt.unitId) ?? attempt.unitId, tarea: attempt.taskKind, intentoId: attempt.id, fecha: null, vencidoDias: 0 })),
      ...queue.filter(q => !nuevas.has(q.unitId) && q.dueDate !== null)
        .map(q => ({ tipo: 'repaso' as const, unitId: q.unitId, titulo: q.title, tarea: q.nextTaskKind, intentoId: null, fecha: q.dueDate, vencidoDias: retraso(q.dueDate!) }))
        .sort((a, b) => b.vencidoDias - a.vencidoDias || a.titulo.localeCompare(b.titulo, 'es')),
    ];
    const enRepasos = new Set(repasos.map(r => r.unitId));
    const pasos = f.pasos(filter).filter(p => !(DE_PRACTICA.has(p.tipo) && enRepasos.has(p.unitId)))
      .map(p => ({ tipo: 'paso' as const, unitId: p.unitId, titulo: p.titulo, paso: p }));
    if (repasos.length + pasos.length > 0) del(hoy).pendientes.push(...repasos, ...pasos);
  }
  for (const r of ruta) {
    if (!fijada(r) || r.dueDate! <= hoy || !enRango(r.dueDate!)) continue;
    del(r.dueDate!).pendientes.push({ tipo: 'repaso', unitId: r.unitId, titulo: r.title, tarea: r.nextTaskKind, intentoId: null, fecha: r.dueDate, vencidoDias: 0 });
  }
  for (const d of dias.values()) if (d.dia !== hoy) d.pendientes.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));

  return { hoy, desde, hasta, dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)) };
}
