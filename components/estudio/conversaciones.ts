import type { LecturaPlan } from "./tipos";

/** De dónde se abrió una conversación (ticket 03 de la segunda ronda); las antiguas sin registro, por su unidad. */
export type OrigenConversacion = "unidad" | "pasaje" | "intento" | "libre";

/** Lo que la barra lateral necesita de una conversación del espacio. */
export interface ConversacionLista {
	id: string;
	title: string;
	updatedAt: string;
	origen: OrigenConversacion;
	/** La unidad de su contexto de estudio, o null. */
	unidad: { id: string; titulo: string } | null;
	/** El plan de esa unidad: el que la incluye o, fuera de él, el de su espacio. */
	plan: { id: string; objetivo: string } | null;
}

export const ACTIVIDADES: readonly { id: OrigenConversacion; etiqueta: string }[] = [
	{ id: "unidad", etiqueta: "Estudio de unidad" },
	{ id: "pasaje", etiqueta: "Pasaje" },
	{ id: "intento", etiqueta: "Intento" },
	{ id: "libre", etiqueta: "Libre" },
];

export const FECHAS = [
	{ id: "siempre", etiqueta: "Siempre" },
	{ id: "7", etiqueta: "7 días" },
	{ id: "30", etiqueta: "30 días" },
] as const;

export interface FiltrosConversaciones {
	/** Por unidad del plan dentro de un espacio; con «Todos», por plan. */
	agrupar: "fecha" | "unidad";
	actividad: "toda" | OrigenConversacion;
	fecha: typeof FECHAS[number]["id"];
}

export const FILTROS_INICIALES: FiltrosConversaciones = { agrupar: "fecha", actividad: "toda", fecha: "siempre" };

export interface GrupoConversaciones {
	/** Única en la lista: la etiqueta puede repetirse entre unidades o planes. */
	clave: string;
	etiqueta: string;
	/** Su lugar en el plan, si el grupo es una unidad del plan. */
	numero: number | null;
	conversaciones: ConversacionLista[];
}

const DIA = 24 * 60 * 60 * 1000;
const inicioDeHoy = (ahora: Date) => new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
const reciente = (a: { updatedAt: string }, b: { updatedAt: string }) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

/** Agrupa por la fecha local de su última actividad, de la más reciente a la
 * más antigua, y omite los grupos vacíos. */
export function agruparPorFecha(conversaciones: readonly ConversacionLista[], ahora = new Date()): GrupoConversaciones[] {
	const hoy = inicioDeHoy(ahora);
	const grupos: GrupoConversaciones[] = ["Hoy", "Ayer", "Últimos 7 días", "Antes"].map(etiqueta => ({ clave: etiqueta, etiqueta, numero: null, conversaciones: [] }));
	for (const c of [...conversaciones].sort(reciente)) {
		const t = new Date(c.updatedAt).getTime();
		const grupo = t >= hoy ? 0 : t >= hoy - DIA ? 1 : t >= hoy - 7 * DIA ? 2 : 3;
		grupos[grupo]!.conversaciones.push(c);
	}
	return grupos.filter(g => g.conversaciones.length > 0);
}

/** Agrupa según `grupoDe`: primero los grupos en el orden de `orden`, luego los demás por su conversación más
 * reciente y, al final, las que no tienen grupo, bajo `sinClave`. */
function agruparPor(
	conversaciones: readonly ConversacionLista[],
	grupoDe: (c: ConversacionLista) => { id: string; etiqueta: string } | null,
	orden: readonly { id: string; numero: number | null }[],
	sinClave: string,
): GrupoConversaciones[] {
	const grupos = new Map<string, GrupoConversaciones>();
	const sin: ConversacionLista[] = [];
	for (const c of [...conversaciones].sort(reciente)) {
		const k = grupoDe(c);
		if (!k) { sin.push(c); continue; }
		const grupo = grupos.get(k.id) ?? { clave: k.id, etiqueta: k.etiqueta, numero: orden.find(o => o.id === k.id)?.numero ?? null, conversaciones: [] };
		grupo.conversaciones.push(c);
		grupos.set(k.id, grupo);
	}
	const conocidos = orden.flatMap(o => grupos.get(o.id) ?? []);
	// Un Map conserva el orden de inserción: el de su conversación más reciente.
	const otros = [...grupos.entries()].filter(([id]) => !orden.some(o => o.id === id)).map(([, g]) => g);
	return [...conocidos, ...otros, ...(sin.length ? [{ clave: "", etiqueta: sinClave, numero: null, conversaciones: sin }] : [])];
}

/** Filtra por actividad y por fecha, y agrupa por fecha o por unidad del plan del espacio (con «Todos», por plan). */
export function agruparConversaciones(
	conversaciones: readonly ConversacionLista[],
	filtros: FiltrosConversaciones,
	{ ahora = new Date(), plan, todos }: { ahora?: Date; plan: LecturaPlan | null; todos: boolean },
): GrupoConversaciones[] {
	const desde = filtros.fecha === "siempre" ? -Infinity : inicioDeHoy(ahora) - Number(filtros.fecha) * DIA;
	const visibles = conversaciones.filter(c =>
		(filtros.actividad === "toda" || c.origen === filtros.actividad) && new Date(c.updatedAt).getTime() >= desde);
	if (filtros.agrupar === "fecha") return agruparPorFecha(visibles, ahora);
	if (todos) return agruparPor(visibles, c => c.plan && { id: c.plan.id, etiqueta: c.plan.objetivo }, [], "Sin plan");
	// Las del plan con su número; las de fuera del plan, tras ellas y sin número, como en la sección «Plan».
	let n = 0;
	const orden = (plan?.unidades ?? []).map(u => ({ id: u.id, numero: u.fueraDelPlan ? null : ++n }));
	return agruparPor(visibles, c => c.unidad && { id: c.unidad.id, etiqueta: c.unidad.titulo }, orden, "Sin unidad");
}

const CLAVE_FILTROS = "estudio:barra:conversaciones";

/** Los selectores de la sección, recordados en este navegador como las secciones plegadas; lo desconocido vuelve a
 * su valor inicial. */
export function filtrosConversaciones(): FiltrosConversaciones {
	try {
		const g = JSON.parse(window.localStorage.getItem(CLAVE_FILTROS) ?? "{}") as Record<string, unknown>;
		if (typeof g !== "object" || g === null) return FILTROS_INICIALES;
		return {
			agrupar: g.agrupar === "unidad" ? "unidad" : "fecha",
			actividad: ACTIVIDADES.some(a => a.id === g.actividad) ? g.actividad as OrigenConversacion : "toda",
			fecha: FECHAS.find(f => f.id === g.fecha)?.id ?? "siempre",
		};
	} catch { return FILTROS_INICIALES; }
}

export function recordarFiltros(filtros: FiltrosConversaciones): void {
	try { window.localStorage.setItem(CLAVE_FILTROS, JSON.stringify(filtros)); } catch { /* sin almacenamiento, no se recuerda */ }
}
