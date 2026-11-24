/**
 * Un error de la conexión de escritorio (ChatGPT o una suscripción nativa): lleva el código estable que manda Electron
 * (`publicCode` en `electron/chatgpt.cjs` y `electron/subscriptions.cjs`) además del texto en español que se enseña. Los
 * clasificadores del chat (`chatGPTStreamError`, `nativeSubscriptionError`) deciden por el código y nunca por el texto.
 */
export class ErrorDeConexion extends Error {
	constructor(texto: string, readonly code: string) {
		super(texto);
		this.name = "ErrorDeConexion";
	}
}

/** Lo que se clasifica de un error: el código si viene de la conexión de escritorio; si no, su texto crudo (los errores del
 * proveedor y los internos siguen en inglés y son los que buscan los clasificadores). */
export function motivoDeError(error: unknown): string {
	if (error instanceof ErrorDeConexion) return error.code;
	return error instanceof Error ? error.message : String(error ?? "");
}

/** El rechazo de una petición por IPC: con código, un `ErrorDeConexion`; sin él (mensaje antiguo), un error con el texto. */
export function errorDeRespuesta(texto: string | undefined, code: unknown, porDefecto: string): Error {
	return typeof code === "string" && code ? new ErrorDeConexion(texto ?? porDefecto, code) : new Error(texto ?? porDefecto);
}
