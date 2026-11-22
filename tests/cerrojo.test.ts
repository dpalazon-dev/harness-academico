/** Cerrojo de la carpeta de datos compartida por compilado y desarrollo.
 * Procesos hijos reales para los PID vivo y muerto; carpetas temporales. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { tomarCerrojo, NOMBRE_CERROJO } = require("../electron/cerrojo.cjs") as {
	NOMBRE_CERROJO: string;
	tomarCerrojo(dir: string, modo: "compilado" | "desarrollo"):
		| { ok: true; liberar(): void }
		| { ok: false; modo: string | null; pid: number };
};

let dir: string;
let archivo: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "lh-cerrojo-"));
	archivo = path.join(dir, NOMBRE_CERROJO);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Un proceso que sigue vivo hasta que se mata. */
function procesoVivo() {
	const hijo = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	return { pid: hijo.pid!, matar: () => hijo.kill() };
}
/** Un PID que existió y ya no existe. */
function pidMuerto() {
	const hijo = spawnSync(process.execPath, ["-e", ""]);
	return hijo.pid;
}

describe("cerrojo de datos", () => {
	for (const estado of ["libre", "abandonado"]) {
		it(`dos procesos compiten con el cerrojo ${estado} mientras se publica el propietario`, async () => {
			if (estado === "abandonado") writeFileSync(archivo, JSON.stringify({ pid: pidMuerto() }));
			const senal = path.join(dir, "continuar");
			const codigo = `
				const fs = require("node:fs");
				const [dir, senal, papel, modulo] = process.argv.slice(1);
				if (papel === "primero") {
					const escribir = fs.writeFileSync;
					fs.writeFileSync = function (archivo, datos, opciones) {
						const fd = fs.openSync(archivo, opciones?.flag ?? "w");
						try {
							fs.writeSync(fd, "{");
							process.stdout.write("parcial\\n");
							const limite = Date.now() + 4000;
							while (!fs.existsSync(senal) && Date.now() < limite) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
							fs.writeSync(fd, datos, 0, "utf8");
						} finally { fs.closeSync(fd); }
					};
				}
				const { tomarCerrojo } = require(modulo);
				if (papel === "segundo") process.stdout.write("entrando\\n");
				const resultado = tomarCerrojo(dir, papel);
				process.send(resultado.ok);
				process.on("message", () => { if (resultado.ok) resultado.liberar(); process.exit(); });
			`;
			const lanzar = (papel: string) => spawn(process.execPath, ["-e", codigo, dir, senal, papel, require.resolve("../electron/cerrojo.cjs")], { stdio: ["ignore", "pipe", "ignore", "ipc"] });
			const primero = lanzar("primero");
			const finPrimero = once(primero, "exit");
			const respuestaPrimero = once(primero, "message");
			let segundo: ReturnType<typeof lanzar> | undefined;
			let finSegundo: ReturnType<typeof once> | undefined;
			try {
				await once(primero.stdout!, "data");
				segundo = lanzar("segundo");
				finSegundo = once(segundo, "exit");
				const respuestaSegundo = once(segundo, "message");
				await once(segundo.stdout!, "data");
				writeFileSync(senal, "");
				assert.deepEqual(await respuestaPrimero, [true, undefined]);
				assert.deepEqual(await respuestaSegundo, [false, undefined]);
				primero.send("salir");
				segundo.send("salir");
				await Promise.all([finPrimero, finSegundo]);
				assert.equal(existsSync(archivo), false);
			} finally {
				primero.kill();
				segundo?.kill();
				await Promise.all([finPrimero, finSegundo]);
			}
		});
	}
	it("libre: crea el archivo con el PID y el modo", () => {
		const resultado = tomarCerrojo(dir, "desarrollo");
		assert.ok(resultado.ok);
		const contenido = JSON.parse(readFileSync(archivo, "utf8"));
		assert.equal(contenido.pid, process.pid);
		assert.equal(contenido.modo, "desarrollo");
	});

	it("crea la carpeta de datos si aún no existe (primer arranque de desarrollo)", () => {
		const nueva = path.join(dir, "datos", "nuevos");
		const resultado = tomarCerrojo(nueva, "desarrollo");
		assert.ok(resultado.ok);
		assert.ok(existsSync(path.join(nueva, NOMBRE_CERROJO)));
	});

	it("liberar borra el archivo", () => {
		const resultado = tomarCerrojo(dir, "compilado");
		assert.ok(resultado.ok);
		resultado.liberar();
		assert.equal(existsSync(archivo), false);
		resultado.liberar(); // idempotente
	});

	it("ocupado por un PID vivo: avisa de quién y no toca el archivo", () => {
		const otro = procesoVivo();
		try {
			const original = JSON.stringify({ pid: otro.pid, modo: "compilado" });
			writeFileSync(archivo, original);
			const resultado = tomarCerrojo(dir, "desarrollo");
			assert.deepEqual(resultado, { ok: false, modo: "compilado", pid: otro.pid });
			assert.equal(readFileSync(archivo, "utf8"), original);
		} finally {
			otro.matar();
		}
	});

	it("abandonado (el PID ya no existe): lo reemplaza y arranca", () => {
		writeFileSync(archivo, JSON.stringify({ pid: pidMuerto(), modo: "compilado" }));
		const resultado = tomarCerrojo(dir, "desarrollo");
		assert.ok(resultado.ok);
		const contenido = JSON.parse(readFileSync(archivo, "utf8"));
		assert.equal(contenido.pid, process.pid);
		assert.equal(contenido.modo, "desarrollo");
	});

	it("conserva un archivo parcial o sin PID mientras se desconoce el propietario", () => {
		for (const basura of ["", "{no es json", "[]", JSON.stringify({ modo: "compilado" }), JSON.stringify({ pid: "x" })]) {
			writeFileSync(archivo, basura);
			const resultado = tomarCerrojo(dir, "compilado");
			assert.equal(resultado.ok, false);
			assert.equal(readFileSync(archivo, "utf8"), basura);
		}
	});

	it("liberar no borra el cerrojo que otro proceso tomó después", () => {
		const resultado = tomarCerrojo(dir, "compilado");
		assert.ok(resultado.ok);
		const ajeno = JSON.stringify({ pid: process.pid + 1, modo: "desarrollo" });
		writeFileSync(archivo, ajeno);
		resultado.liberar();
		assert.equal(readFileSync(archivo, "utf8"), ajeno);
	});

	it("tras un cierre brusco (archivo sin liberar) el siguiente arranque lo recupera", () => {
		const salida = spawnSync(process.execPath, ["-e", `
			const { tomarCerrojo } = require(${JSON.stringify(require.resolve("../electron/cerrojo.cjs"))});
			tomarCerrojo(${JSON.stringify(dir)}, "compilado");
			process.exit(0);
		`], { encoding: "utf8" });
		assert.equal(salida.status, 0, salida.stderr);
		const huerfano = JSON.parse(readFileSync(archivo, "utf8"));
		assert.notEqual(huerfano.pid, process.pid);
		const resultado = tomarCerrojo(dir, "desarrollo");
		assert.ok(resultado.ok);
	});
});
