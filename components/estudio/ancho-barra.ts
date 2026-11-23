/**
 * El ancho de la barra lateral desplegada, que David ajusta arrastrando su borde (petición del 23-nov-2026):
 * entre 200 y 480 px, 256 por defecto, y se recuerda en este navegador como las secciones plegadas.
 */
export const ANCHO_MINIMO = 200;
export const ANCHO_MAXIMO = 480;
export const ANCHO_POR_DEFECTO = 256;
/** Lo que mueve cada flecha con el asa enfocada. */
export const PASO_TECLADO = 16;

const CLAVE_ANCHO = "estudio:barra:ancho";

export function limitarAncho(px: number): number {
	if (!Number.isFinite(px)) return ANCHO_POR_DEFECTO;
	return Math.round(Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, px)));
}

export function anchoGuardado(): number {
	try {
		const guardado = window.localStorage.getItem(CLAVE_ANCHO);
		return guardado === null ? ANCHO_POR_DEFECTO : limitarAncho(Number(guardado));
	} catch { return ANCHO_POR_DEFECTO; }
}

export function recordarAncho(px: number): void {
	try { window.localStorage.setItem(CLAVE_ANCHO, String(limitarAncho(px))); } catch { /* sin almacenamiento, no se recuerda */ }
}
