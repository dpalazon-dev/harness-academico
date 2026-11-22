/**
 * El margen del cuaderno (ticket 12b), sin pantalla: dónde cuelga cada comentario en el texto de David y cómo se
 * apilan los del margen. Un comentario se ancla a un fragmento de un párrafo con el selector de texto del núcleo
 * (`createTextSelector`, `findCitationText`): se reencuentra por su texto y el que lo rodea, así que sobrevive a lo que
 * David edite en otros sitios. Si la frase desaparece, el comentario queda «sin su frase».
 */
import { createTextSelector } from "@/src/core";
import { rawRangeFor } from "@/components/selection-text";
import type { AnclaComentario, BloqueCuaderno, Comentario, TipoComentario } from "./cuadernos";
import { textoDeNota, type Nota } from "./pagina";

/** Dónde queda un fragmento: el párrafo y los límites en el texto que David ve (símbolo incluido). */
export interface Sitio { blockId: string; start: number; end: number }

/** El ancla de lo seleccionado en un párrafo (límites en su texto compuesto); null si no hay nada que anclar. */
export function anclaDeSeleccion(b: Nota, inicio: number, fin: number): AnclaComentario | null {
	const texto = textoDeNota(b);
	const a = Math.max(0, Math.min(inicio, fin)), z = Math.min(texto.length, Math.max(inicio, fin));
	const selector = createTextSelector(texto, a, z);
	return selector ? { blockId: b.id, ...selector } : null;
}

/** Los límites crudos de un ancla en un texto, o null si la frase ya no está o es ambigua. */
function buscar(texto: string, ancla: AnclaComentario): { start: number; end: number } | null {
	return rawRangeFor(texto, { text: ancla.text, start: ancla.start, end: ancla.end, prefix: ancla.prefix, suffix: ancla.suffix });
}

/**
 * Dónde está hoy el fragmento: en su párrafo y, si ya no está allí (el párrafo se partió o se unió a otro), en el único
 * párrafo que lo contenga. Con dos sitios posibles no se adivina: null.
 */
export function resolverAncla(blocks: readonly BloqueCuaderno[], ancla: AnclaComentario): Sitio | null {
	const notas = blocks.filter((b): b is Nota => b.kind === "nota");
	const propio = notas.find(b => b.id === ancla.blockId);
	const enPropio = propio && buscar(textoDeNota(propio), ancla);
	if (propio && enPropio) return { blockId: propio.id, ...enPropio };
	const hallazgos = notas.filter(b => b !== propio).flatMap(b => {
		const r = buscar(textoDeNota(b), ancla);
		return r ? [{ blockId: b.id, ...r }] : [];
	});
	return hallazgos.length === 1 ? hallazgos[0]! : null;
}

/** Lo que se muestra en el margen: un comentario y dónde cuelga (null: sin su frase). */
export interface Puesto<T extends { id: string; anchor: AnclaComentario }> { item: T; sitio: Sitio | null }

/** Los descartados no se ven. */
export const visibles = (comments: readonly Comentario[] | undefined): Comentario[] => (comments ?? []).filter(c => c.state !== "descartado");

/**
 * Cada elemento con su sitio, en el orden del margen: los anclados por posición en la página y, al final, los que se
 * quedaron sin su frase, en el orden en que llegaron.
 */
export function colocar<T extends { id: string; anchor: AnclaComentario }>(blocks: readonly BloqueCuaderno[], items: readonly T[]): Puesto<T>[] {
	const puestos = items.map(item => ({ item, sitio: resolverAncla(blocks, item.anchor) }));
	const indice = (id: string) => blocks.findIndex(b => b.id === id);
	const anclados = puestos.filter((p): p is Puesto<T> & { sitio: Sitio } => p.sitio !== null)
		.sort((a, b) => indice(a.sitio.blockId) - indice(b.sitio.blockId) || a.sitio.start - b.sitio.start);
	return [...anclados, ...puestos.filter(p => p.sitio === null)];
}

export interface Segmento { texto: string; inicio: number; ids: string[] }

/** El texto partido donde empieza o acaba un rango o cae un corte, cada trozo con los rangos que lo cubren. */
export function segmentos(texto: string, rangos: readonly { id: string; start: number; end: number }[], cortes: readonly number[] = []): Segmento[] {
	const limites = [...new Set([0, texto.length, ...rangos.flatMap(r => [r.start, r.end]), ...cortes])]
		.filter(n => n >= 0 && n <= texto.length).sort((a, b) => a - b);
	const out: Segmento[] = [];
	for (let i = 0; i < limites.length - 1; i++) {
		const inicio = limites[i]!, fin = limites[i + 1]!;
		out.push({ texto: texto.slice(inicio, fin), inicio, ids: rangos.filter(r => r.start <= inicio && r.end >= fin).map(r => r.id) });
	}
	return out;
}

/**
 * Las posiciones del margen: cada comentario a la altura de su párrafo (`deseo`, null si no tiene) sin pisar al
 * anterior. Los que no tienen sitio van justo después.
 */
export function apilar(items: readonly { deseo: number | null; alto: number }[], hueco = 8): number[] {
	let libre = 0;
	return items.map(({ deseo, alto }) => {
		const top = Math.max(deseo ?? libre, libre);
		libre = top + alto + hueco;
		return top;
	});
}

/** Lo que se pide al tutor, con las palabras de David en el botón. */
export const PETICIONES: Record<TipoComentario, { boton: string; etiqueta: string }> = {
	pregunta: { boton: "Pregúntame", etiqueta: "Pregunta" },
	explicacion: { boton: "Explícamelo", etiqueta: "Explicación" },
	dibujo: { boton: "Dibújalo", etiqueta: "Dibujo" },
};

/** Lo que pasa en el hilo de un comentario fuera de lo guardado: la respuesta que se espera o por qué no llegó. `pendiente` es
 * lo que David acaba de escribir y aún no está en el hilo guardado (se está enviando, o falló). */
export interface EsperaHilo { estado: "pensando" | "error"; error?: string; pendiente?: string }

/** El estado de los hilos del margen: cuál está abierto (uno a la vez), lo que David lleva escrito sin enviar en cada uno y
 * lo que se espera. Vive fuera del editor puro, como las peticiones, para que se vea igual al probarlo. */
export interface EstadoHilos {
	abierto: string | null; borradores: Readonly<Record<string, string>>; espera: Readonly<Record<string, EsperaHilo>>;
	/** Comentarios cuyo tutor contestó mientras su hilo estaba cerrado: la marca lo dice hasta que David lo abre. */
	sinLeer?: Readonly<Record<string, true>>;
}

export const SIN_HILOS: EstadoHilos = { abierto: null, borradores: {}, espera: {} };

/** Llegó una respuesta del tutor al hilo de un comentario: si David no lo tiene abierto, queda sin leer. */
export function conRespuestaNueva(h: EstadoHilos, comentarioId: string): EstadoHilos {
	return h.abierto === comentarioId ? h : { ...h, sinLeer: { ...h.sinLeer, [comentarioId]: true } };
}

/** David abrió el hilo: ya no hay respuesta nueva. */
export function sinRespuestaNueva(h: EstadoHilos, comentarioId: string): EstadoHilos {
	if (!h.sinLeer?.[comentarioId]) return h;
	const { [comentarioId]: _leida, ...resto } = h.sinLeer;
	return { ...h, sinLeer: resto };
}
