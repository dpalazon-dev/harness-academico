/**
 * Los personajes del tutor vistos desde el armazón (ticket 12g): lo que devuelven las operaciones `personajes`,
 * `guardar-personaje`, `borrar-personaje` y `persona-cuaderno` del plugin Estudio, y las reglas de a quién se firma cada
 * comentario y con qué tinta. Sin pantalla: la cabecera, la barra y el margen leen de aquí.
 */
import type { Comentario, Cuaderno, Tinta } from "./cuadernos";
import { colorDeTinta } from "./tintas";

export interface Personaje {
	id: string;
	nombre: string;
	/** En uno de serie, qué busca; en uno de David, sus palabras. */
	descripcion: string;
	tinta: Tinta;
	predefinido: boolean;
}

export interface ListaPersonajes {
	predefinidos: Personaje[];
	propios: Personaje[];
	max: { personajes: number; nombre: number; descripcion: number };
}

/** El personaje de un cuaderno que no eligió ninguno, o cuyo personaje se borró. */
export const PERSONAJE_POR_DEFECTO = "profesor";
/** La firma de un comentario que no dice quién lo escribió, y la de uno cuyo personaje ya no existe y no guardó su nombre. */
export const FIRMA_TUTOR = "Tutor", FIRMA_BORRADO = "Personaje borrado";

/** El color del punto de un personaje: su tinta; el acento (el del Profesor) sigue la del cuaderno, que la página pone en `--tinta-margen`. */
export const colorDePersonaje = (p: Pick<Personaje, "tinta">): string =>
	p.tinta === "acento" ? `var(--tinta-margen, ${colorDeTinta(undefined)})` : colorDeTinta(p.tinta);

export const todos = (l: ListaPersonajes): Personaje[] => [...l.predefinidos, ...l.propios];

/** El personaje que comenta solo en el cuaderno: el elegido, y el Profesor si no hay elección o el elegido se borró. */
export function personajeDeCuaderno(c: Pick<Cuaderno, "persona">, l: ListaPersonajes): Personaje {
	const lista = todos(l);
	return lista.find(p => p.id === c.persona) ?? lista.find(p => p.id === PERSONAJE_POR_DEFECTO) ?? l.predefinidos[0]!;
}

/**
 * Quién firma el comentario: el nombre vigente del personaje, así que renombrarlo cambia también la firma de sus comentarios
 * antiguos. Si el personaje se borró (o aún no ha llegado la lista), el nombre que el comentario copió al escribirse; y sin
 * él, «Tutor» (comentarios de antes de los personajes) o «Personaje borrado».
 */
export function firmaDe(c: Pick<Comentario, "persona" | "firma">, l?: ListaPersonajes | null): string {
	const vigente = l && c.persona !== "tutor" ? todos(l).find(p => p.id === c.persona)?.nombre : undefined;
	return vigente ?? c.firma ?? (c.persona === "tutor" ? FIRMA_TUTOR : FIRMA_BORRADO);
}

/**
 * La tinta de un comentario. `undefined` es la del cuaderno (la de su cabecera): la usan los comentarios de antes de los
 * personajes y los de un personaje cuya tinta es el acento, el del Profesor, que no impone color. Los demás llevan la de su
 * personaje; si el personaje se borró, la neutra (`texto`), legible en cualquier tema. Sin la lista aún, la del cuaderno.
 */
export function tintaDeComentario(c: Pick<Comentario, "persona">, l: ListaPersonajes | null | undefined): Tinta | undefined {
	if (c.persona === "tutor" || !l) return undefined;
	const p = todos(l).find(x => x.id === c.persona);
	if (!p) return "texto";
	return p.tinta === "acento" ? undefined : p.tinta;
}
