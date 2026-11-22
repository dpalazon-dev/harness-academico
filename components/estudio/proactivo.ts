/**
 * Cuándo comenta el tutor por su cuenta (ticket 12e, «Modo proactivo (P3)» de la spec), sin pantalla y sin reloj propio:
 * una función pura que recibe lo que ocurre (la página, lo ya leído, el instante) y dice qué toca. Las cifras de partida
 * (8 s de pausa, tres abiertos sin atender) son parámetros, porque se ajustan tras medir el uso.
 *
 * Lo que garantiza, y lo que no: aquí se decide *cuándo*. Lo que protege el gasto (el tope diario, una sola llamada por
 * cuaderno, los tres fallos seguidos) lo impone además el plugin, así que un fallo de esta regla no puede desbocarlo.
 */
import type { BloqueCuaderno, Comentario, ModoCuaderno } from "./cuadernos";
import { deducirNota, textoDeNota, type Nota } from "./pagina";

export interface ConfigProactiva {
	/** Silencio, en ms, desde la última edición o la última lectura, antes de que el tutor lea. */
	pausaMs: number;
	/** Con este número de comentarios abiertos sin atender, el tutor calla hasta que David responda o descarte. */
	maxAbiertos: number;
	/** Un párrafo con menos letras que esto (sin contar su símbolo) no merece una llamada. */
	minCaracteres: number;
}

export const CONFIG_PROACTIVA: ConfigProactiva = { pausaMs: 8000, maxAbiertos: 3, minCaracteres: 30 };

/** Un párrafo de la página tal y como lo ve David: su texto con el símbolo al principio. */
export interface Parrafo { id: string; texto: string }

export interface EntradaLectura {
	/** El reloj, en ms; solo importan las diferencias. */
	ahora: number;
	/** Cuándo se tocó la página por última vez desde que se abrió; null si no se ha tocado. */
	ultimaEdicion: number | null;
	/** Cuándo terminó la última lectura del tutor; null si no ha habido. */
	ultimaLlamadaFin: number | null;
	parrafos: readonly Parrafo[];
	/** Lo que el tutor ya vio de cada párrafo: el texto de entonces. Al abrir, la página entera cuenta como vista. */
	leidos: Readonly<Record<string, string>>;
	/** Los párrafos que ya tienen un comentario proactivo, estén abiertos, atendidos o descartados: uno por párrafo. */
	comentados: ReadonlySet<string>;
	/** Comentarios abiertos sin atender, de cualquier origen. */
	abiertos: number;
	/** Hay una lectura en curso en este cuaderno. */
	enVuelo: boolean;
	/** El cuaderno está en «Lee y comenta solo», hay modelo barato y no se ha agotado el tope. */
	activo: boolean;
	/** La última lectura falló y David no ha escrito desde entonces. */
	fallo: boolean;
}

export type MotivoNada = "inactivo" | "en-vuelo" | "fallo" | "abiertos" | "sin-cambios";
export type Decision =
	| { accion: "leer"; blockId: string }
	| { accion: "esperar"; enMs: number }
	| { accion: "nada"; motivo: MotivoNada };

/** Lo que había en la página al abrir el cuaderno: nada de lo que ya estaba se comenta sin que David lo toque. */
export const estadoInicialLectura = (parrafos: readonly Parrafo[]): Record<string, string> =>
	Object.fromEntries(parrafos.map(p => [p.id, p.texto]));

/** Las notas de la página como párrafos; los bloques de error y de pregunta no se leen solos. */
export const parrafosParaLeer = (blocks: readonly BloqueCuaderno[]): Parrafo[] =>
	blocks.filter((b): b is Nota => b.kind === "nota").map(b => ({ id: b.id, texto: textoDeNota(b) }));

/** Comentarios abiertos a los que David aún no ha respondido en su hilo: responder (o descartar, o volver a la nota) lo atiende. */
export const abiertosSinAtender = (comments: readonly Comentario[] | undefined): number =>
	(comments ?? []).filter(c => c.state === "abierto" && !c.thread.some(m => m.role === "david")).length;

/** Los párrafos que ya recibieron un comentario del tutor por su cuenta. */
export const comentadosPorElTutor = (comments: readonly Comentario[] | undefined): Set<string> =>
	new Set((comments ?? []).filter(c => c.origen === "proactivo").map(c => c.anchor.blockId));

/** El primer párrafo de la página que merece lectura: nuevo o cambiado desde la última vez, con algo que leer y sin comentario previo. */
function candidato(e: EntradaLectura, config: ConfigProactiva): string | null {
	const hallado = e.parrafos.find(p => {
		if (e.comentados.has(p.id) || e.leidos[p.id] === p.texto) return false;
		return deducirNota(p.texto).text.trim().length >= config.minCaracteres;
	});
	return hallado?.id ?? null;
}

/**
 * Qué toca ahora. Se llama tras cada cambio y cuando vence el aplazamiento que devolvió.
 * - «esperar»: hay algo que leer, pero David acaba de escribir (o acaba de terminar una lectura): faltan `enMs`.
 * - «leer»: pausa cumplida; se lee ese párrafo.
 * - «nada»: no toca, o no puede tocar; no hace falta volver a llamar hasta que algo cambie.
 */
export function decidirLectura(e: EntradaLectura, config: ConfigProactiva = CONFIG_PROACTIVA): Decision {
	if (!e.activo) return { accion: "nada", motivo: "inactivo" };
	if (e.enVuelo) return { accion: "nada", motivo: "en-vuelo" };
	if (e.fallo) return { accion: "nada", motivo: "fallo" };
	if (e.abiertos >= config.maxAbiertos) return { accion: "nada", motivo: "abiertos" };
	const blockId = candidato(e, config);
	if (blockId === null) return { accion: "nada", motivo: "sin-cambios" };
	// Nunca mientras escribe, y nunca dos lecturas seguidas: la pausa se cuenta desde lo último que pasó.
	const ultima = Math.max(e.ultimaEdicion ?? -Infinity, e.ultimaLlamadaFin ?? -Infinity);
	const falta = config.pausaMs - (e.ahora - ultima);
	return falta > 0 ? { accion: "esperar", enMs: falta } : { accion: "leer", blockId };
}

/** Lo que la cabecera cuenta cuando el tutor no comenta solo por algo más que la decisión de David. */
export type MotivoAviso = "tope" | "fallos" | "sin-modelo";

export function textoAviso(motivo: MotivoAviso, tope: number): string {
	if (motivo === "tope") return `El tutor alcanzó su tope diario (${tope} ${tope === 1 ? "lectura" : "lecturas"} por su cuenta) y no comenta solo. Comenta cuando se lo pidas. Podrás volver a activarlo otro día, o ya con un tope más alto.`;
	if (motivo === "fallos") return "El tutor falló tres veces seguidas al leerte y se detuvo. Comenta cuando se lo pidas; vuelve a activarlo cuando quieras.";
	return "No hay modelo económico configurado, así que el tutor no comenta solo. Elígelo en Ajustes; mientras tanto, comenta cuando se lo pidas.";
}

export const ETIQUETA_MODO: Record<ModoCuaderno, string> = { proactivo: "Lee y comenta solo", "a-peticion": "Cuando se lo pido" };
