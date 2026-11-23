/**
 * Bifurcar una conversación desde un mensaje del tutor (HarnessAcademico,
 * diseño 4A aprobado por David el 23-nov-2026): la rama es una conversación
 * nueva con el historial hasta el final de esa respuesta. El registro de
 * mensajes no cambia de forma: es una copia recortada.
 */
import type { LhMessage } from "./native-messages.ts";

/** Marcadores que abren un turno del estudiante, igual que un mensaje `user`. */
const TURNOS_DEL_ESTUDIANTE = new Set(["plugin-problem-submission", "practice-thinking", "practice-next"]);

function abreTurno(m: LhMessage): boolean {
	if (m.role === "user") return true;
	return m.role === "custom" && TURNOS_DEL_ESTUDIANTE.has(m.customType);
}

export interface CorteBifurcacion {
	mensajes: LhMessage[];
	/** El corte llega al final del registro: la respuesta elegida es la última. */
	hastaElFinal: boolean;
}

/**
 * Los mensajes de la rama: desde el principio hasta justo antes del siguiente
 * turno del estudiante posterior a `messageId`. Null si el id no está o no es
 * una respuesta del tutor.
 */
export function corteParaBifurcar(messages: readonly LhMessage[], messageId: string): CorteBifurcacion | null {
	const i = messages.findIndex(m => m.id === messageId);
	if (i < 0 || messages[i]?.role !== "assistant") return null;
	let fin = messages.length;
	for (let j = i + 1; j < messages.length; j++) {
		const m = messages[j];
		if (m && abreTurno(m)) { fin = j; break; }
	}
	return { mensajes: messages.slice(0, fin), hastaElFinal: fin === messages.length };
}

/** Título de la rama: el del original con «(rama)», sin acumular sufijos. */
export function tituloDeRama(titulo: string): string {
	const base = titulo.replace(/\s*\(rama(?: \d+)?\)\s*$/, "").trim() || "Conversación sin título";
	return `${base} (rama)`;
}
