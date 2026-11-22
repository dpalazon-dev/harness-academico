"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");

const NOMBRE_CERROJO = "harnessacademico.lock";

function estaVivo(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if (err.code === "ESRCH") return false;
		if (err.code === "EPERM") return true;
		throw err;
	}
}

function leer(archivo) {
	let texto;
	try {
		texto = fs.readFileSync(archivo, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
	try {
		const dato = JSON.parse(texto);
		if (Number.isInteger(dato?.pid) && dato.pid > 0) return dato;
	} catch { /* un propietario antiguo puede estar escribiendo aún */ }
	return { pid: null, modo: null };
}

// SQLite serializa las operaciones sobre el JSON entre procesos, incluso
// al recuperar un PID muerto. El SO suelta el bloqueo si el proceso cae.
// El archivo SQLite tiene nombre estable y jamás se elimina al liberar.
function arbitrar(archivo, operacion) {
	const db = new DatabaseSync(archivo + ".sqlite");
	try {
		db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
		return operacion();
	} finally {
		db.close();
	}
}

function tomarCerrojo(dir, modo) {
	fs.mkdirSync(dir, { recursive: true });
	const archivo = path.join(dir, NOMBRE_CERROJO);
	const token = randomUUID();
	return arbitrar(archivo, () => {
		const actual = leer(archivo);
		if (actual) {
			if (!actual.pid || estaVivo(actual.pid)) return { ok: false, modo: actual.modo ?? null, pid: actual.pid };
			fs.unlinkSync(archivo);
		}
		// El nombre público solo aparece después de escribir el JSON completo.
		const preparado = archivo + ".tmp";
		fs.writeFileSync(preparado, JSON.stringify({ pid: process.pid, modo, token, iniciado: new Date().toISOString() }));
		try {
			fs.linkSync(preparado, archivo);
		} finally {
			fs.rmSync(preparado, { force: true });
		}
		return {
			ok: true,
			liberar() {
				arbitrar(archivo, () => {
					if (leer(archivo)?.token === token) fs.unlinkSync(archivo);
				});
			},
		};
	});
}

module.exports = { tomarCerrojo, NOMBRE_CERROJO };
