/**
 * Actividad del tutor dentro de un turno (harness conversacional, diseño
 * aprobado por David el 23-nov-2026, variante 2B): las llamadas a
 * herramientas «silenciosas» seguidas se pliegan en un solo bloque, con el
 * paso en curso en la cabecera mientras trabaja y un resumen al terminar.
 * Lo que el estudiante tiene que ver (preguntas, problemas, demos, figuras,
 * el plan) nunca entra en el bloque.
 *
 * Funciones puras: chat.tsx decide qué parte es silenciosa (necesita el
 * registro de renderizadores) y este módulo agrupa y pone nombres.
 */

/** Lo mínimo de una parte de mensaje que hace falta para agrupar. */
export interface ParteConTipo {
	type: string;
	state?: string;
}

export type Segmento<P> =
	| { tipo: "parte"; parte: P; indice: number }
	| { tipo: "actividad"; partes: { parte: P; indice: number }[] };

/**
 * Agrupa las tramas de herramientas silenciosas. Una trama son herramientas
 * silenciosas consecutivas, con los separadores de paso (`step-start`) que
 * caen ENTRE ellas; un separador al borde de la trama queda fuera, para que
 * el hilo conserve sus líneas entre pasos. Una trama de una sola herramienta
 * también se pliega: así todas las herramientas se ven igual.
 */
export function agruparActividad<P extends ParteConTipo>(partes: readonly P[], silenciosa: (parte: P) => boolean): Segmento<P>[] {
	const out: Segmento<P>[] = [];
	let trama: { parte: P; indice: number }[] | null = null;
	let separadores: { parte: P; indice: number }[] = [];
	const cerrar = () => {
		if (trama) out.push({ tipo: "actividad", partes: trama });
		trama = null;
		for (const s of separadores) out.push({ tipo: "parte", parte: s.parte, indice: s.indice });
		separadores = [];
	};
	partes.forEach((parte, indice) => {
		if (parte.type === "step-start" && trama) {
			separadores.push({ parte, indice });
			return;
		}
		if (parte.type.startsWith("tool-") && silenciosa(parte)) {
			if (trama) {
				// Los separadores entre dos herramientas de la trama se quedan dentro (no se pintan).
				trama.push(...separadores, { parte, indice });
				separadores = [];
			} else {
				trama = [{ parte, indice }];
			}
			return;
		}
		cerrar();
		out.push({ tipo: "parte", parte, indice });
	});
	cerrar();
	return out;
}

interface Nombre {
	/** Infinitivo, para la lista y el resumen: «Leer archivo». */
	hecho: string;
	/** Gerundio, para el paso en curso: «Leyendo archivo». */
	enCurso: string;
}

const NOMBRES: Record<string, Nombre> = {
	read: { hecho: "Leer archivo", enCurso: "Leyendo archivo" },
	ls: { hecho: "Ver carpeta", enCurso: "Mirando la carpeta" },
	find: { hecho: "Buscar archivos", enCurso: "Buscando archivos" },
	grep: { hecho: "Buscar en archivos", enCurso: "Buscando en los archivos" },
	list_sessions: { hecho: "Consultar conversaciones anteriores", enCurso: "Consultando conversaciones anteriores" },
	list_propositions: { hecho: "Consultar lo aprendido", enCurso: "Consultando lo aprendido" },
	web_search: { hecho: "Buscar en internet", enCurso: "Buscando en internet" },
	web_fetch: { hecho: "Leer una página web", enCurso: "Leyendo una página web" },
	estudio_buscar: { hecho: "Buscar en tu estudio", enCurso: "Buscando en tu estudio" },
	estudio_estado: { hecho: "Consultar tu plan", enCurso: "Consultando tu plan" },
	estudio_proponer_hecho: { hecho: "Proponer un hecho", enCurso: "Proponiendo un hecho" },
	estudio_proponer_unidad: { hecho: "Proponer una unidad", enCurso: "Proponiendo una unidad" },
	estudio_proponer_plan: { hecho: "Proponer un cambio en el plan", enCurso: "Proponiendo un cambio en el plan" },
	estudio_cerrar_bloque: { hecho: "Cerrar el bloque", enCurso: "Cerrando el bloque" },
};

/** Nombre en español de una herramienta; las desconocidas, con su nombre legible. */
export function nombreHerramienta(tool: string): Nombre {
	const conocido = NOMBRES[tool];
	if (conocido) return conocido;
	const legible = tool.replace(/^.*__/, "").replace(/_/g, " ").trim() || "herramienta";
	const capital = legible.charAt(0).toUpperCase() + legible.slice(1);
	return { hecho: capital, enCurso: `Usando «${legible}»` };
}

export function herramientaDe(parte: ParteConTipo): string {
	return parte.type.replace(/^tool-/, "");
}

/** Una herramienta sigue en marcha mientras llegan sus argumentos o espera su resultado. */
export function enMarcha(parte: ParteConTipo): boolean {
	return parte.state === "input-streaming" || parte.state === "input-available";
}

export function fallida(parte: ParteConTipo & { errorText?: unknown }): boolean {
	return parte.state === "output-error" || typeof parte.errorText === "string";
}

/**
 * Cabecera del bloque. En curso: el gerundio del paso activo. Terminado: los
 * nombres distintos en orden de aparición, con «×N» si se repiten, hasta tres
 * y «…» si hay más.
 */
export function cabeceraActividad(partes: readonly ParteConTipo[], turnoVivo: boolean): { enCurso: boolean; texto: string; pasos: number } {
	const herramientas = partes.filter(p => p.type.startsWith("tool-"));
	const pasos = herramientas.length;
	const activa = turnoVivo ? [...herramientas].reverse().find(enMarcha) : undefined;
	if (activa) return { enCurso: true, texto: `${nombreHerramienta(herramientaDe(activa)).enCurso}…`, pasos };
	const cuenta = new Map<string, number>();
	for (const p of herramientas) {
		const nombre = nombreHerramienta(herramientaDe(p)).hecho;
		cuenta.set(nombre, (cuenta.get(nombre) ?? 0) + 1);
	}
	const nombres = [...cuenta].map(([nombre, n]) => (n > 1 ? `${nombre} ×${n}` : nombre));
	const texto = nombres.length > 3 ? `${nombres.slice(0, 3).join(" · ")} · …` : nombres.join(" · ");
	return { enCurso: false, texto, pasos };
}

export function textoPasos(n: number): string {
	return n === 1 ? "1 paso" : `${n} pasos`;
}
