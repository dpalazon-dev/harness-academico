/**
 * Lo que el armazón lee de las operaciones de cuadernos del plugin Estudio
 * (`plugins/estudio/src/notebooks/`) y lo que antes hacía su vista de
 * cuadernos (`notebooks-view.ts`) fuera de la pantalla: la notación, las
 * rutas, crear un cuaderno y descargar una exportación. El núcleo no importa
 * el código del plugin: estos tipos copian la forma que devuelven sus
 * operaciones.
 */
import { llamarEstudio } from "./llamar";

/** La notación ligera de los handoffs: un símbolo dice para qué sirve la nota, nunca que sea verdad. */
export const SIMBOLOS = ["I", "→", "≠", "#", "★", "Δ", "?", "⚠", "Ex:", "A:", "Ref:", "C:", "CE:", "~", "X", "D:", "+", "−"] as const;
export type Simbolo = typeof SIMBOLOS[number];
export const ETIQUETA_SIMBOLO: Record<Simbolo, string> = {
	"I": "Idea o afirmación", "→": "Relación o mecanismo", "≠": "Distinción", "#": "Dato o cifra", "★": "Importante",
	"Δ": "Cambio en mi comprensión", "?": "Duda", "⚠": "Cautela o verificación pendiente", "Ex:": "Ejemplo", "A:": "Aplicación",
	"Ref:": "Referencia", "C:": "Condición o supuesto", "CE:": "Contraejemplo", "~": "Aproximación", "X": "Error detectado",
	"D:": "Decisión", "+": "Ventaja", "−": "Coste o inconveniente",
};

/** El tipo se conserva en el registro, pero ninguna pantalla lo muestra (ticket 12a). */
export type TipoCuaderno = "fuente" | "conocimiento" | "sintesis" | "libre";

/** `Block`: una nota con su símbolo, un error (lo que creía, por qué y la corrección) o una pregunta de recuperación. */
export type BloqueCuaderno =
	| { id: string; kind: "nota"; symbol: Simbolo | null; text: string; locator: string; quote: string }
	| { id: string; kind: "error"; wrong: string; cause: string; fix: string }
	| { id: string; kind: "recuperacion"; question: string; answer: string };

/** `CommentAnchor`: el fragmento de un párrafo al que cuelga un comentario, con el texto que lo rodea para reencontrarlo. */
export interface AnclaComentario { blockId: string; text: string; start: number; end: number; prefix: string; suffix: string }
/** «pregunta» pregunta y señala lo que falta; «explicacion» explica el fragmento; «dibujo» lo dibuja (ticket 12h). */
export type TipoComentario = "pregunta" | "explicacion" | "dibujo";
export type EstadoComentario = "abierto" | "atendido" | "descartado";
export interface MensajeHilo { id: string; role: "tutor" | "david"; text: string; at: string }
/**
 * `Propuesta` (ticket 12d): lo que el tutor ofrece junto a un comentario. Nada pasa a la página ni a la base hasta que David
 * lo acepta: una pregunta de recuperación entra como bloque suyo tras el párrafo; un hecho, como borrador KBOL en «Por decidir»;
 * una conexión no se acepta, se abre.
 */
export type EstadoPropuesta = "pendiente" | "aceptada" | "descartada";
export type Propuesta =
	| { id: string; tipo: "recuperacion"; estado: EstadoPropuesta; pregunta: string; respuesta: string; bloqueId?: string }
	| { id: string; tipo: "hecho"; estado: EstadoPropuesta; afirmacion: string; documentId: string; pagina: number; cita: string; borradorId?: string }
	| { id: string; tipo: "conexion"; estado: EstadoPropuesta; destino: { tipo: "unidad" | "cuaderno"; id: string }; titulo: string; motivo: string };
/** `Dibujo` (ticket 12h): un diagrama Mermaid que el tutor dibujó a petición. Cuelga del mensaje del tutor que lo trae; es suyo, no
 * de la página de David, y se puede quitar. El código es un dato: lo pinta el renderizador de la aplicación, en modo estricto. */
export interface Dibujo { id: string; mermaid: string; mensajeId: string }
/** `Comment`: lo que el tutor escribe en el margen. Vive en el cuaderno, aparte de `blocks`: nunca en la página de David. */
export interface Comentario {
	id: string;
	anchor: AnclaComentario;
	/** El id del personaje que lo escribió (ticket 12g); "tutor" en un comentario de antes de los personajes. */
	persona: string;
	/** El nombre del personaje cuando lo escribió: se conserva aunque David lo renombre o lo borre. */
	firma?: string;
	kind: TipoComentario;
	state: EstadoComentario;
	createdAt: string;
	thread: MensajeHilo[];
	/** "proactivo": lo escribió el tutor por su cuenta, sin que David lo pidiera (ticket 12e). */
	origen?: "proactivo";
	/** Lo que el tutor ofrece con el comentario (ticket 12d); ausente si no ofreció nada. */
	propuestas?: Propuesta[];
	/** Lo que el tutor dibujó en este comentario, a petición (ticket 12h); ausente si no dibujó nada. */
	dibujos?: Dibujo[];
}

/** "proactivo": el tutor lee mientras David escribe y comenta cuando para (por defecto); "a-peticion": solo cuando se lo pide. */
export type ModoCuaderno = "proactivo" | "a-peticion";
/** Por qué el cuaderno está en "a-peticion" sin que David lo eligiera: el tope diario, tres fallos seguidos, o que al salir de «Solo escucha» no había modelo económico. */
export type AvisoModo = "tope" | "fallos" | "sin-modelo";

/** La tinta de los comentarios de un cuaderno: un nombre que se resuelve con colores del tema (`tintas.ts`). */
export type Tinta = "acento" | "verde" | "ambar" | "rojo" | "texto";
/** El propósito es una línea de David, de hasta este tope. */
export const MAX_PROPOSITO = 200;
/** El propósito que dice «no comentes por tu cuenta»: un texto fijo, igual en el botón y en lo guardado. */
export const SOLO_ESCUCHA = "Solo escucha";
/** Las propuestas de un clic; elegir una rellena la línea, que David edita libremente. */
export const PROPUESTAS_PROPOSITO = ["Pregúntame antes del examen", "Busca mis errores", "Conéctalo con lo que ya sé", SOLO_ESCUCHA] as const;

/** `Notebook`. */
export interface Cuaderno {
	id: string;
	revision: number;
	title: string;
	kind: TipoCuaderno;
	unitId: string | null;
	documentId: string | null;
	blocks: BloqueCuaderno[];
	createdAt: string;
	updatedAt: string;
	areaId: string | null;
	/** Los comentarios del margen; ausente en un cuaderno que nunca tuvo uno. */
	comments?: Comentario[];
	/** El modo del tutor en este cuaderno; ausente, "proactivo". */
	modo?: ModoCuaderno;
	/** Por qué dejó de comentar solo; lo borra David al volver a activarlo. */
	aviso?: AvisoModo;
	/** El modo que David tenía al elegir «Solo escucha», para devolverlo al salir; solo se guarda "a-peticion". */
	modoAntes?: "a-peticion";
	/** Para qué es el cuaderno, con las palabras de David (ticket 12f); ausente si no hay. */
	proposito?: string;
	/** La tinta de los comentarios; ausente, la del acento del tema. */
	tinta?: Tinta;
	/** El personaje que comenta solo en este cuaderno (ticket 12g); ausente, el Profesor. */
	persona?: string;
}

/** Lo que el plugin cuenta del gasto del modo proactivo (operación `estado-proactivo`). */
export interface EstadoProactivo {
	/** Tope diario de lecturas del tutor por su cuenta, entre todos los cuadernos. */
	tope: number;
	/** Las de hoy (día local). */
	usadas: number;
	/** Hay modelo económico configurado; sin él no se comenta solo. */
	modeloEconomico: boolean;
}

/** Lo que devuelve una lectura proactiva: el cuaderno como quedó y qué pasó. */
export interface LecturaProactiva {
	cuaderno: Cuaderno;
	resultado: "comentado" | "sin-comentario" | "omitido" | "fallo";
	/** Por qué se omitió o falló. */
	motivo?: string;
	estado: EstadoProactivo;
}

export const RUTA_CUADERNOS = "/cuadernos";

/** El editor de un cuaderno; recién creado, enfoca el título para nombrarlo. */
export function rutaCuaderno(id: string, opciones: { nuevo?: boolean } = {}): string {
	return `${RUTA_CUADERNOS}/${encodeURIComponent(id)}${opciones.nuevo ? "?nuevo=1" : ""}`;
}

export const TITULO_NUEVO = "Cuaderno sin título";

/** «Nuevo cuaderno», desde Cuadernos, desde una unidad o desde ⌘K: un cuaderno libre, vinculado a la unidad si la hay. */
export function crearCuaderno(unitId?: string | null): Promise<Cuaderno> {
	return llamarEstudio<Cuaderno>("crear-cuaderno", { title: TITULO_NUEVO, kind: "libre", ...(unitId ? { unitId } : {}) });
}

/** «3 notas · 1 error · 2 preguntas»: lo que tiene un cuaderno. */
export function recuento(c: Pick<Cuaderno, "blocks">): string {
	const n = (k: BloqueCuaderno["kind"]) => c.blocks.filter(b => b.kind === k).length;
	const plural = (x: number, uno: string, varios: string) => `${x} ${x === 1 ? uno : varios}`;
	return [plural(n("nota"), "nota", "notas"), n("error") ? plural(n("error"), "error", "errores") : "", n("recuperacion") ? plural(n("recuperacion"), "pregunta", "preguntas") : ""]
		.filter(Boolean).join(" · ");
}

/** Una pregunta se practica con la pregunta y la respuesta escritas y el cuaderno vinculado a una unidad. */
export function practicable(c: Pick<Cuaderno, "unitId">, b: BloqueCuaderno): boolean {
	return b.kind === "recuperacion" && !!c.unitId && !!b.question.trim() && !!b.answer.trim();
}

export function nuevoBloque(kind: BloqueCuaderno["kind"]): BloqueCuaderno {
	const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	if (kind === "nota") return { id, kind, symbol: null, text: "", locator: "", quote: "" };
	if (kind === "error") return { id, kind, wrong: "", cause: "", fix: "" };
	return { id, kind, question: "", answer: "" };
}

/** Guarda el texto como archivo a través del navegador: un diálogo de guardar en la app de escritorio. */
export function descargar(nombre: string, texto: string, tipo = "text/plain"): void {
	const url = URL.createObjectURL(new Blob([texto], { type: `${tipo};charset=utf-8` }));
	const a = document.createElement("a");
	a.href = url;
	a.download = nombre;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
