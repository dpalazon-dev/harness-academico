/**
 * La página del cuaderno (ticket 12a), sin pantalla: lo que el editor hace con los bloques mientras David escribe
 * párrafos. Cada párrafo es un bloque `nota` cuyo símbolo se deduce de su inicio; «Error» y «Pregunta de recuperación»
 * se insertan con `/`. El formato guardado no cambia (`blocks`).
 *
 * `deducirNota` y `componerNota` copian `deduceNote` y `composeNote` del plugin (`plugins/estudio/src/notebooks/types.ts`),
 * que el núcleo no importa; una prueba compara las dos con los 18 símbolos.
 */
import { ETIQUETA_SIMBOLO, SIMBOLOS, nuevoBloque, type BloqueCuaderno, type Simbolo } from "./cuadernos";

export type Nota = Extract<BloqueCuaderno, { kind: "nota" }>;

/** Un símbolo, un espacio y el resto tal cual: «? ¿Por qué?». Sin sangría ni salto de línea en lugar del espacio. */
export function deducirNota(crudo: string): { symbol: Simbolo | null; text: string } {
	const symbol = SIMBOLOS.find(s => crudo.startsWith(`${s} `));
	return symbol ? { symbol, text: crudo.slice(symbol.length + 1) } : { symbol: null, text: crudo };
}

/** El párrafo como David lo ve y lo teclea. */
export function componerNota(symbol: Simbolo | null, text: string): string {
	return symbol ? `${symbol} ${text}` : text;
}

export const textoDeNota = (b: Nota): string => componerNota(b.symbol, b.text);

/** La nota con lo que David acaba de teclear; conserva su cita y su localizador. */
export const conTexto = (b: Nota, crudo: string): Nota => ({ ...b, ...deducirNota(crudo) });

/** Qué dice un símbolo al pasar el ratón. */
export const significado = (s: Simbolo): string => ETIQUETA_SIMBOLO[s];

/** La tinta de un símbolo, por familias de significado, con los colores del tema. */
const TINTA: Record<Simbolo, string> = {
	"I": "text-[var(--lh-accent)]", "→": "text-[var(--lh-accent)]", "≠": "text-[var(--lh-accent)]", "Ref:": "text-[var(--lh-accent)]", "D:": "text-[var(--lh-accent)]",
	"#": "text-foreground", "Ex:": "text-foreground", "A:": "text-foreground",
	"Δ": "text-[var(--lh-success)]", "+": "text-[var(--lh-success)]", "★": "text-[var(--lh-success)]",
	"?": "text-[var(--lh-warning)]", "~": "text-[var(--lh-warning)]", "C:": "text-[var(--lh-warning)]", "⚠": "text-[var(--lh-warning)]",
	"X": "text-[var(--lh-error)]", "CE:": "text-[var(--lh-error)]", "−": "text-[var(--lh-error)]",
};
export const tintaDe = (s: Simbolo): string => TINTA[s];

/** Una nota sin nada: ni texto, ni símbolo, ni cita, ni localizador. Es el hueco donde se escribe, no algo que guardar. */
export const notaVacia = (b: BloqueCuaderno): boolean => b.kind === "nota" && !b.text && !b.symbol && !b.quote && !b.locator;

/** Lo que se guarda: los bloques sin los huecos vacíos que quedan al pulsar Intro o `/`. */
export const bloquesParaGuardar = (blocks: BloqueCuaderno[]): BloqueCuaderno[] => blocks.filter(b => !notaVacia(b));

/** Qué bloque se inserta con `/`. */
export const INSERTABLES = [
	{ kind: "error", etiqueta: "Error", pista: "Lo que creías, por qué y la corrección" },
	{ kind: "recuperacion", etiqueta: "Pregunta de recuperación", pista: "Una pregunta con tu respuesta, para practicarla" },
] as const satisfies readonly { kind: BloqueCuaderno["kind"]; etiqueta: string; pista: string }[];
export type Insertable = typeof INSERTABLES[number];

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Las opciones del menú `/` para un párrafo: solo si el párrafo es una barra seguida de una palabra («/», «/err»);
 * null si no lo es, y un menú vacío si ninguna opción encaja.
 */
export function opcionesDeBarra(crudo: string): readonly Insertable[] | null {
	const m = /^\/(\S*)$/.exec(crudo);
	if (!m) return null;
	const q = plano(m[1]!);
	return INSERTABLES.filter(o => plano(o.etiqueta).includes(q) || plano(o.kind).startsWith(q));
}

/** Dónde queda el cursor tras un cambio: en un campo del bloque, en una posición o al final. */
export interface Foco { id: string; campo: string; pos: number | "fin" }

export interface Cambio { blocks: BloqueCuaderno[]; foco: Foco | null }

const campoNota = "texto";

/** Intro en un párrafo: lo que queda antes del cursor se queda y lo que sigue pasa a un párrafo nuevo. */
export function dividirNota(blocks: BloqueCuaderno[], i: number, pos: number, id: string): Cambio {
	const b = blocks[i];
	if (!b || b.kind !== "nota") return { blocks, foco: null };
	const crudo = textoDeNota(b);
	const nueva: Nota = { ...nuevoBloque("nota") as Nota, id, ...deducirNota(crudo.slice(pos)) };
	return {
		blocks: [...blocks.slice(0, i), conTexto(b, crudo.slice(0, pos)), nueva, ...blocks.slice(i + 1)],
		foco: { id, campo: campoNota, pos: 0 },
	};
}

/**
 * Un texto con saltos de línea (un pegado, o Mayús+Intro): cada línea pasa a ser un párrafo con su símbolo deducido. Las líneas
 * en blanco no crean párrafos; el primero conserva la cita y el localizador del párrafo donde se pegó y el cursor queda donde
 * terminó el pegado (`pos`, en el texto completo). `real` es falso si `b` es el hueco del final, que aún no está en `blocks`.
 */
export function partirTexto(blocks: BloqueCuaderno[], i: number, b: Nota, crudo: string, pos: number, nuevoId: () => string): Cambio {
	const trozos: { texto: string; inicio: number }[] = [];
	let inicio = 0;
	for (const linea of crudo.split("\n")) { trozos.push({ texto: linea.replace(/\r$/, ""), inicio }); inicio += linea.length + 1; }
	const contiene = (t: { texto: string; inicio: number }) => pos >= t.inicio && pos <= t.inicio + t.texto.length;
	const quedan = trozos.filter(t => t.texto.trim() !== "" || contiene(t));
	const notas = quedan.map((t, k) => (k === 0 ? conTexto(b, t.texto) : { ...nuevoBloque("nota") as Nota, id: nuevoId(), ...deducirNota(t.texto) }));
	const donde = Math.max(0, quedan.findIndex(contiene));
	const real = i < blocks.length;
	return {
		blocks: real ? [...blocks.slice(0, i), ...notas, ...blocks.slice(i + 1)] : [...blocks, ...notas],
		foco: { id: notas[donde]!.id, campo: campoNota, pos: Math.min(pos - quedan[donde]!.inicio, textoDeNota(notas[donde]!).length) },
	};
}

/** Retroceso al principio de un párrafo: el vacío se quita y el que tiene texto se une al anterior si este es otro párrafo. */
export function retrocederNota(blocks: BloqueCuaderno[], i: number): Cambio | null {
	const b = blocks[i];
	const antes = blocks[i - 1];
	if (!b || b.kind !== "nota" || i === 0) return null;
	const vacio = !b.text && !b.symbol;
	if (vacio && b.quote) return null;
	if (vacio) return { blocks: blocks.filter((_, j) => j !== i), foco: antes ? focoAlFinal(antes) : null };
	if (b.quote || !antes || antes.kind !== "nota") return null;
	const previo = textoDeNota(antes);
	return {
		blocks: [...blocks.slice(0, i - 1), conTexto(antes, previo + textoDeNota(b)), ...blocks.slice(i + 1)],
		foco: { id: antes.id, campo: campoNota, pos: previo.length },
	};
}

/** Dónde enfocar al volver a un bloque desde el siguiente: el final de su último campo. */
export function focoAlFinal(b: BloqueCuaderno): Foco {
	return { id: b.id, campo: b.kind === "nota" ? campoNota : b.kind === "error" ? "fix" : "answer", pos: "fin" };
}

export function focoAlInicio(b: BloqueCuaderno): Foco {
	return { id: b.id, campo: b.kind === "nota" ? campoNota : b.kind === "error" ? "wrong" : "question", pos: 0 };
}

/** Elegir una opción del menú `/`: el párrafo de la barra se convierte en el bloque elegido. */
export function insertarEspecial(blocks: BloqueCuaderno[], i: number, kind: Insertable["kind"], id: string): Cambio {
	const nuevo = { ...nuevoBloque(kind), id };
	return { blocks: blocks.map((b, j) => (j === i ? nuevo : b)), foco: focoAlInicio(nuevo) };
}

export function moverBloque(blocks: BloqueCuaderno[], i: number, d: number): BloqueCuaderno[] {
	const j = i + d;
	if (j < 0 || j >= blocks.length) return blocks;
	const out = [...blocks];
	[out[i], out[j]] = [out[j]!, out[i]!];
	return out;
}

/** Los campos de texto de cada bloque, en el orden en que se recorren con el teclado. */
const CAMPOS = { nota: [campoNota], error: ["wrong", "cause", "fix"], recuperacion: ["question", "answer"] } as const satisfies Record<BloqueCuaderno["kind"], readonly string[]>;
export const camposDeBloque = (b: BloqueCuaderno): readonly string[] => CAMPOS[b.kind];

/**
 * Adónde va el cursor al salir de un campo con las flechas: hacia arriba, el campo anterior del bloque o el final del bloque
 * anterior; hacia abajo, el campo siguiente o el principio del bloque siguiente. `vista` es la página con su hueco final.
 * null en los extremos, donde no hay adónde ir.
 */
export function vecinoDeCampo(vista: BloqueCuaderno[], i: number, campo: string, d: -1 | 1): Foco | null {
	const b = vista[i];
	if (!b) return null;
	const campos = camposDeBloque(b), k = campos.indexOf(campo);
	if (d < 0) return k > 0 ? { id: b.id, campo: campos[k - 1]!, pos: "fin" } : i > 0 ? focoAlFinal(vista[i - 1]!) : null;
	return k >= 0 && k < campos.length - 1 ? { id: b.id, campo: campos[k + 1]!, pos: 0 } : i < vista.length - 1 ? focoAlInicio(vista[i + 1]!) : null;
}

/** Un bloque de error o de pregunta sin nada escrito: se quita con Retroceso, como un párrafo vacío. */
export const bloqueVacio = (b: BloqueCuaderno): boolean =>
	b.kind === "error" ? !b.wrong && !b.cause && !b.fix : b.kind === "recuperacion" ? !b.question && !b.answer : false;

/** Quitar un bloque entero (también con texto) y dejar el cursor en su vecino: el final del anterior o, si es el primero, el principio del siguiente. */
export function quitarBloque(blocks: BloqueCuaderno[], i: number): Cambio {
	const antes = blocks[i - 1], despues = blocks[i + 1];
	return { blocks: blocks.filter((_, j) => j !== i), foco: antes ? focoAlFinal(antes) : despues ? focoAlInicio(despues) : null };
}
