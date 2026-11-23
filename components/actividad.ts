/**
 * Actividad del tutor (harness conversacional, diseño 2A con el tick de 2C,
 * elegido por David el 23-nov-2026): cada herramienta es una línea con su
 * estado y su nombre en español; mientras corre, el gerundio del paso.
 */

/** Lo mínimo de una parte de herramienta que hace falta aquí. */
export interface ParteConTipo {
	type: string;
	state?: string;
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
