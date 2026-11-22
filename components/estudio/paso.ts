/**
 * A dónde lleva un paso propuesto (ADR 0004). El plugin dice qué toca y por
 * qué; el armazón decide la pantalla. Los repasos y reconstrucciones lanzados
 * desde el inicio vuelven al inicio al terminar; desde la unidad, a la unidad.
 */
import { rutaPracticar } from "./intento";
import type { Paso } from "./tipos";

export type DestinoPaso = { tipo: "ruta"; ruta: string } | { tipo: "tutor" };

/** El ancla del campo del volcado en la página de unidad. */
export const ANCLA_VOLCADO = "volcado";
/** La página de la unidad con el campo del volcado a la vista. */
export const rutaVolcado = (unitId: string) => `/unidad/${unitId}#${ANCLA_VOLCADO}`;

export function destinoDelPaso(paso: Paso, unitId: string, desde: "inicio" | "unidad"): DestinoPaso {
	switch (paso.tipo) {
		case "decidir": return { tipo: "ruta", ruta: `/unidad/${unitId}` };
		case "volcado": return { tipo: "ruta", ruta: rutaVolcado(unitId) };
		case "reconstruir":
		case "repasar": return { tipo: "ruta", ruta: rutaPracticar(unitId, desde === "inicio" ? { volver: "/" } : {}) };
		case "tutor": return { tipo: "tutor" };
	}
}
