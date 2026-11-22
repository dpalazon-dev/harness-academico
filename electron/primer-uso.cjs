"use strict";
/** Primer uso del compilado en un equipo sin `rutas.json` (fork HarnessAcademico).
 *
 * Antes, sin el archivo la app mostraba un error y se cerraba: solo servía en
 * el equipo de David. Ahora propone una carpeta base (Documentos\HarnessAcademico),
 * deja elegir otra, y solo al aceptar crea `datos`, `conocimiento` y `almacen`
 * y escribe `rutas.json`. Nada se crea sin confirmación (spec, decisión 3).
 * `uv` se apunta si se encuentra; si no, se omite (es opcional, ver rutas.cjs).
 * Un `rutas.json` existente nunca se toca: sus errores siguen mostrándose.
 * No importa Electron: recibe `dialog`, para probarlo sin pantalla. */
const fs = require("node:fs");
const path = require("node:path");
const { CLAVES, OPCIONALES } = require("./rutas.cjs");

const CARPETAS = ["datos", "conocimiento", "almacen"];

/** Solo cuando falta el archivo y el entorno no fija ya las rutas obligatorias. */
function necesitaPrimerUso({ archivo, env }) {
	if (fs.existsSync(archivo)) return false;
	return Object.keys(CLAVES).some((clave) => !OPCIONALES.has(clave) && !env[CLAVES[clave]]);
}

/** `uv.exe` en el PATH o en `~\.local\bin` (donde lo deja su instalador). */
function buscarUv({ env, home, existe = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } } }) {
	const nombres = process.platform === "win32" ? ["uv.exe"] : ["uv"];
	const dirs = String(env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
	if (home) dirs.push(path.join(home, ".local", "bin"));
	for (const dir of dirs) {
		for (const nombre of nombres) {
			const candidato = path.join(dir, nombre);
			if (path.isAbsolute(candidato) && existe(candidato)) return candidato;
		}
	}
	return null;
}

/**
 * @param {{archivo: string, documentos: string, dialog: any, uv: string | null}} options
 * @returns {Promise<{ok: true, base: string, rutas: Record<string, string>} | {ok: false}>}
 */
async function prepararPrimerUso({ archivo, documentos, dialog, uv }) {
	let base = path.join(documentos, "HarnessAcademico");
	for (;;) {
		const { response } = await dialog.showMessageBox({
			type: "info",
			title: "HarnessAcademico: primer uso",
			message: "¿Dónde guardo tus datos de estudio?",
			detail: `Se crearán tres carpetas en:\n${base}\n\n• datos: conversaciones, unidades y ajustes\n• conocimiento: tu base de conocimiento\n• almacen: los PDF que incorpores\n\n` +
				(uv ? "" : "No encuentro uv: la app funciona, pero incorporar PDF y validar la base necesitan uv y KBOL.\n\n") +
				`Podrás cambiar cada carpeta después en:\n${archivo}`,
			buttons: ["Usar esta carpeta", "Elegir otra carpeta…", "Salir"],
			defaultId: 0, cancelId: 2, noLink: true,
		});
		if (response === 2) return { ok: false };
		if (response === 1) {
			const elegida = await dialog.showOpenDialog({
				title: "Carpeta para los datos de HarnessAcademico",
				defaultPath: documentos,
				properties: ["openDirectory", "createDirectory"],
			});
			if (!elegida.canceled && elegida.filePaths?.[0]) base = elegida.filePaths[0];
			continue; // vuelve a confirmar con la carpeta nueva
		}
		break;
	}
	const rutas = {};
	for (const nombre of CARPETAS) {
		rutas[nombre] = path.join(base, nombre);
		fs.mkdirSync(rutas[nombre], { recursive: true });
	}
	if (uv) rutas.uv = uv;
	fs.mkdirSync(path.dirname(archivo), { recursive: true });
	// `wx`: si otro proceso lo escribió entretanto, se respeta el suyo.
	try {
		fs.writeFileSync(archivo, JSON.stringify(rutas, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
	} catch (err) {
		if (err.code !== "EEXIST") throw err;
	}
	return { ok: true, base, rutas };
}

module.exports = { necesitaPrimerUso, buscarUv, prepararPrimerUso, CARPETAS };
