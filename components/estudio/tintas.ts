/**
 * Las tintas de los comentarios de un cuaderno (ticket 12f; el 12g las reutiliza para los personajes). Un conjunto pequeño de
 * nombres, cada uno ligado a un color que el tema ya define, nunca un color suelto: así la tinta sigue al tema que David
 * elija. Los colores de estado de un tema (éxito, aviso, error) y su acento están pensados para leerse sobre su página; aquí
 * se mezclan con el color del texto para que, en cualquier tema, claro u oscuro, el subrayado y el filo de la tarjeta se
 * distingan de la página al menos 3 a 1 (lo comprueba `tests/tintas-cuaderno-estudio.test.ts` con los 11 temas integrados).
 * El texto del comentario no se pinta con la tinta: solo el subrayado, el filo y el punto.
 */
import type { Tinta } from "./cuadernos";

export const TINTA_POR_DEFECTO: Tinta = "acento";
/** Cuánto de la tinta del tema queda en el color final; el resto es el color del texto. */
export const MEZCLA_TINTA = 60;

export interface InfoTinta { id: Tinta; etiqueta: string; variable: string }

export const TINTAS: readonly InfoTinta[] = [
	{ id: "acento", etiqueta: "Acento", variable: "--lh-accent" },
	{ id: "verde", etiqueta: "Verde", variable: "--lh-success" },
	{ id: "ambar", etiqueta: "Ámbar", variable: "--lh-warning" },
	{ id: "rojo", etiqueta: "Rojo", variable: "--lh-error" },
	{ id: "texto", etiqueta: "Texto", variable: "--foreground" },
];

/** La tinta guardada, o la de por defecto si falta o no se conoce. */
export function tintaDe(tinta: Tinta | null | undefined): Tinta {
	return TINTAS.some(t => t.id === tinta) ? tinta! : TINTA_POR_DEFECTO;
}

/** El color CSS de una tinta, hecho solo de variables del tema. */
export function colorDeTinta(tinta: Tinta | null | undefined): string {
	const { variable } = TINTAS.find(t => t.id === tintaDe(tinta))!;
	return variable === "--foreground" ? "var(--foreground)" : `color-mix(in oklab, var(${variable}) ${MEZCLA_TINTA}%, var(--foreground))`;
}
