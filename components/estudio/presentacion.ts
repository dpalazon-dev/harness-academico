import type { Phase3 } from "@/src/core";

/* Cómo se presenta el tutor en una conversación (23-nov-2026): la etiqueta del agente que atiende cada respuesta y la
 * charla con la que empieza una conversación libre, hasta que David pulsa «Empezar» o lo pide con palabras. */

export type NombreAgente = "Sondeador" | "Tutor" | "Práctica";

/** El agente que generó la respuesta `mi`. El núcleo elige al Tutor en los turnos que siguen a un sondeo concluido, así que
 * cuenta la fase de antes del mensaje: el mensaje que cierra el sondeo aún es del Sondeador. */
export function agenteDelMensaje(fases: readonly Phase3[], mi: number, kind?: "teach" | "practice"): NombreAgente {
	if (kind === "practice") return "Práctica";
	const antes = mi > 0 ? fases[mi - 1] : "probe";
	return antes === "probe" || antes === undefined ? "Sondeador" : "Tutor";
}

/** El mensaje que envía el botón; escribirlo a mano también empieza. */
export const MENSAJE_EMPEZAR = "Empezar";

/** Acciones que se ven atenuadas junto a «Empezar» hasta que llegue el rediseño de planes. */
export const ACCIONES_FUTURAS = ["Diseñar plan", "Bifurcar plan"] as const;

/** Las llamadas que solo hace el tutor una vez empezado: con una de ellas, la charla ha terminado. */
const PREGUNTAS = new Set(["tool-ask_user_question", "tool-quiz", "tool-explain", "tool-probe_done"]);

interface MensajeVista {
	role: string;
	parts: ReadonlyArray<{ type: string; text?: unknown; pluginQuestion?: unknown }>;
}

/** Si la conversación sigue en charla: de enseñanza, sin contexto de estudio, con alguna respuesta del tutor, sin
 * «Empezar» enviado y sin ninguna pregunta del tutor todavía. */
export function charlaEnCurso(mensajes: readonly MensajeVista[], kind?: "teach" | "practice"): boolean {
	if (kind === "practice") return false;
	let respondio = false;
	for (const m of mensajes) {
		for (const p of m.parts) {
			if (p.type === "data-study-context" || PREGUNTAS.has(p.type) || p.pluginQuestion !== undefined) return false;
		}
		if (m.role === "assistant") respondio = true;
		if (m.role === "user") {
			const texto = m.parts.filter((p) => p.type === "text").map((p) => String(p.text ?? "")).join(" ").trim();
			if (texto.toLocaleLowerCase("es") === MENSAJE_EMPEZAR.toLocaleLowerCase("es")) return false;
		}
	}
	return respondio;
}
