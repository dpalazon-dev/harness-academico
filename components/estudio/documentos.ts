/**
 * Lo que el armazón lee de las operaciones de documentos del plugin Estudio
 * (`plugins/estudio/src/documents/`) y la subida por trozos que antes hacía su
 * vista de Biblioteca (`library-view.ts`). El núcleo no importa el código del
 * plugin: estos tipos copian la forma que devuelven sus operaciones.
 */
import { llamarEstudio } from "./llamar";

export type EstadoDocumento = "procesando" | "listo" | "error";

/** `StudyDocument`: un PDF incorporado con Document Intelligence de KBOL. */
export interface DocumentoEstudio {
	id: string;
	revision: number;
	title: string;
	path: string;
	status: EstadoDocumento;
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	paginas: number | null;
	contraste: { recuerdo: number; respaldo: number; paginasSinTexto: number[] } | null;
	revisar: string[];
	areaId: string | null;
}

/** `DocumentDetail`: la estructura extraída del documento. */
export interface DetalleDocumento {
	document: DocumentoEstudio;
	secciones: { clave: string; titulo: string | null; numero: string | null; tipo: string | null; paginas: number[] }[];
	tablas: { clave: string; leyenda: string | null; paginas: number[] }[];
	figuras: { clave: string; leyenda: string | null; paginas: number[] }[];
	referencias: { clave: string; texto: string }[];
	avisos: string[];
}

/** `PageView`: una página tal como la pinta el lector. */
export interface BloquePagina { clave: string; kind: "seccion" | "tabla" | "figura"; heading: string | null; text: string }
export interface PaginaDocumento { documentId: string; title: string; page: number; total: number; blocks: BloquePagina[] }

/** `QuoteCheck`: si una cita literal está en la página. */
export interface ComprobacionCita { estado: "resuelta" | "rota" | "no_comprobable"; motivo: string }

export const ESTADO_DOCUMENTO: Record<EstadoDocumento, string> = { procesando: "Incorporando", listo: "Listo", error: "Error" };
export const ESTADO_CITA: Record<ComprobacionCita["estado"], string> = { resuelta: "Cita verificada", rota: "Cita rota", no_comprobable: "No comprobable" };

/** El rótulo de una sección: número y título sin repetir (`sectionLabel` del plugin). */
export function rotuloSeccion(numero: string | null | undefined, titulo: string | null | undefined): string {
	const t = (titulo ?? "").trim();
	const n = (numero ?? "").trim();
	if (!n) return t;
	if (!t) return n;
	return t === n || t.startsWith(`${n} `) || t.startsWith(`${n}.`) ? t : `${n} ${t}`;
}

export const RUTA_BIBLIOTECA = "/biblioteca";
/** El ancla de la zona de subir de Biblioteca: «Añadir material» del inicio salta ahí con el botón de elegir archivos enfocado. */
export const ANCLA_SUBIR = "subir";

/** El lector de un documento; abierto desde una unidad, lleva la unidad para vincular lo que se capture. */
export function rutaLector(documentId: string, opciones: { unidad?: string; pagina?: number } = {}): string {
	const q = new URLSearchParams();
	if (opciones.unidad) q.set("unidad", opciones.unidad);
	if (opciones.pagina) q.set("pagina", String(opciones.pagina));
	const consulta = q.toString();
	return `${RUTA_BIBLIOTECA}/${encodeURIComponent(documentId)}${consulta ? `?${consulta}` : ""}`;
}

/** La última página leída de cada documento se recuerda en este navegador. */
const clavePagina = (documentId: string) => `estudio:lector:${documentId}:pagina`;
export function paginaRecordada(documentId: string): number | null {
	try {
		const n = Number(window.localStorage.getItem(clavePagina(documentId)));
		return Number.isSafeInteger(n) && n >= 1 ? n : null;
	} catch { return null; }
}
export function recordarPagina(documentId: string, pagina: number): void {
	try { window.localStorage.setItem(clavePagina(documentId), String(pagina)); } catch { /* sin almacenamiento, no se recuerda */ }
}

/** Lo que hace falta de un archivo para subirlo: un `File` del navegador sirve. */
export interface ArchivoSubida { name: string; size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } }
export interface ProgresoSubida { name: string; sent: number; total: number }

function aBase64(bytes: Uint8Array): string {
	let binario = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binario);
}

/** Envía un PDF por trozos (las llamadas al plugin son JSON con tope de tamaño) y lo pasa a Document Intelligence. */
export async function subirArchivo(archivo: ArchivoSubida, alAvanzar: (p: ProgresoSubida) => void): Promise<DocumentoEstudio> {
	const { uploadId, chunkBytes } = await llamarEstudio<{ uploadId: string; chunkBytes: number }>("subir-inicio", { name: archivo.name, bytes: archivo.size });
	try {
		for (let index = 0, offset = 0; offset < archivo.size; index++, offset += chunkBytes) {
			const bytes = new Uint8Array(await archivo.slice(offset, Math.min(offset + chunkBytes, archivo.size)).arrayBuffer());
			await llamarEstudio("subir-trozo", { uploadId, index, data: aBase64(bytes) });
			alAvanzar({ name: archivo.name, sent: Math.min(offset + chunkBytes, archivo.size), total: archivo.size });
		}
		return await llamarEstudio<DocumentoEstudio>("subir-fin", { uploadId });
	} catch (error) {
		await llamarEstudio("subir-cancelar", { uploadId }).catch(() => {});
		throw error;
	}
}

/** Las entidades de una captura, una por línea: `dataset: SWaT` (`parseEntityLines` del plugin). */
export function entidadesDe(texto: string): { nombre: string; clase_entidad?: string }[] {
	return texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(linea => {
		const m = /^(tarea|metodo|método|dataset|metrica|métrica|concepto|familia_modelo)\s*:\s*(.+)$/i.exec(linea);
		if (!m) return { nombre: linea };
		return { nombre: m[2]!.trim(), clase_entidad: m[1]!.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "") };
	});
}
