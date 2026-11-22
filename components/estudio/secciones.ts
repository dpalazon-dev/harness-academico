/**
 * Las secciones plegables de la barra lateral (ticket 01 de la segunda ronda) y su estado plegado, que se recuerda
 * en este navegador, como la página del lector (`documentos.ts`).
 */
export const SECCIONES = ["plan", "materiales", "conversaciones"] as const;
export type IdSeccion = typeof SECCIONES[number];

const CLAVE_PLEGADAS = "estudio:barra:plegadas";

export function seccionesPlegadas(): IdSeccion[] {
	try {
		const guardado: unknown = JSON.parse(window.localStorage.getItem(CLAVE_PLEGADAS) ?? "[]");
		return Array.isArray(guardado) ? SECCIONES.filter(s => guardado.includes(s)) : [];
	} catch { return []; }
}

export function recordarPlegadas(plegadas: readonly IdSeccion[]): void {
	try { window.localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify(plegadas)); } catch { /* sin almacenamiento, no se recuerda */ }
}
