"use strict";
/** Rutas de trabajo del compilado de HarnessAcademico (fork, 2026-11).
 *
 * `<userData>\rutas.json` dice dónde viven los datos de David. La carcasa las
 * pasa al servidor como variables de entorno. Una variable ya definida gana a
 * la clave del archivo. Nunca hay valores por defecto: si falta algo o una
 * ruta no existe, se devuelve el error y la carcasa se niega a arrancar. */
const fs = require("node:fs");
const path = require("node:path");

/** Clave de rutas.json → variable de entorno del servidor, y qué debe haber. */
const CLAVES = {
	datos: "LH_DATA_DIR",
	conocimiento: "ESTUDIO_KB_DIR",
	almacen: "KBOL_ALMACEN",
	uv: "ESTUDIO_UV",
	nombre: "ESTUDIO_NOMBRE",
};
const TIPO = { datos: "carpeta", conocimiento: "carpeta", almacen: "carpeta", uv: "archivo", nombre: "texto" };
/** Sin `uv` la app arranca: solo incorporar PDF y validar la base lo necesitan
 * (con KBOL), y el plugin explica qué falta al usarlos. Si se indica, debe existir.
 * Sin `nombre`, el plugin usa el usuario de Windows (plugins/estudio/src/identidad.ts). */
const OPCIONALES = new Set(["uv", "nombre"]);

function leerArchivo(archivo) {
	let texto;
	try {
		texto = fs.readFileSync(archivo, "utf8");
	} catch (err) {
		return { error: { clave: "rutas.json", ruta: archivo, motivo: err.code === "ENOENT" ? "no existe" : `no se puede leer (${err.code ?? err.message})` } };
	}
	try {
		const datos = JSON.parse(texto);
		if (datos === null || typeof datos !== "object" || Array.isArray(datos)) throw new Error("debe ser un objeto con las claves " + Object.keys(CLAVES).join(", "));
		return { datos };
	} catch (err) {
		return { error: { clave: "rutas.json", ruta: archivo, motivo: `no es un JSON válido (${err.message})` } };
	}
}

function comprobar(clave, origen, ruta) {
	if (typeof ruta !== "string" || ruta === "") return { clave: origen, ruta: String(ruta ?? ""), motivo: "falta la ruta" };
	if (TIPO[clave] === "texto") {
		return ruta.length <= 60 && !/[\r\n]/.test(ruta) ? null : { clave: origen, ruta: ruta.slice(0, 60), motivo: "debe ser una línea de 60 caracteres como mucho" };
	}
	if (!path.isAbsolute(ruta)) return { clave: origen, ruta, motivo: "debe ser una ruta absoluta" };
	let stat;
	try {
		stat = fs.statSync(ruta);
	} catch {
		return { clave: origen, ruta, motivo: "no existe" };
	}
	if (TIPO[clave] === "carpeta" && !stat.isDirectory()) return { clave: origen, ruta, motivo: "no es una carpeta" };
	if (TIPO[clave] === "archivo" && !stat.isFile()) return { clave: origen, ruta, motivo: "no es un archivo" };
	return null;
}

/** @param {{archivo: string, env: Record<string, string | undefined>}} options
 *  @returns {{ok: true, entorno: Record<string, string>} | {ok: false, errores: {clave: string, ruta: string, motivo: string}[], mensaje: string}} */
function resolverRutas({ archivo, env }) {
	const errores = [];
	const entorno = {};
	const delEntorno = (clave) => (env[CLAVES[clave]] || undefined);

	// El archivo solo hace falta si alguna ruta obligatoria no la fija ya el
	// entorno; si existe, se lee igualmente por las opcionales.
	let contenido = {};
	const faltan = Object.keys(CLAVES).some((clave) => !OPCIONALES.has(clave) && delEntorno(clave) === undefined);
	if (faltan || fs.existsSync(archivo)) {
		const leido = leerArchivo(archivo);
		if (leido.error) errores.push(leido.error);
		else contenido = leido.datos;
	}

	if (errores.length === 0) {
		for (const clave of Object.keys(CLAVES)) {
			const variable = CLAVES[clave];
			const fijada = delEntorno(clave);
			const ruta = fijada ?? contenido[clave];
			if (OPCIONALES.has(clave) && (ruta === undefined || ruta === null || ruta === "")) continue;
			const fallo = comprobar(clave, fijada === undefined ? clave : variable, ruta);
			if (fallo) errores.push(fallo);
			else entorno[variable] = ruta;
		}
	}

	if (errores.length > 0) {
		const lineas = errores.map((e) => `• ${[`${e.clave}:`, e.ruta, e.motivo].filter(Boolean).join(" ")}`);
		return {
			ok: false,
			errores,
			mensaje: `${lineas.join("\n")}\n\nArchivo de rutas: ${archivo}`,
		};
	}
	return { ok: true, entorno };
}

module.exports = { resolverRutas, CLAVES, OPCIONALES };
