/** Rutas de trabajo del compilado (`rutas.json`). Carpetas temporales reales:
 * nunca se tocan los datos de David. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { resolverRutas, CLAVES, OPCIONALES } = require("../electron/rutas.cjs") as {
	resolverRutas(options: { archivo: string; env: Record<string, string | undefined> }):
		| { ok: true; entorno: Record<string, string> }
		| { ok: false; errores: { clave: string; ruta: string; motivo: string }[]; mensaje: string };
	CLAVES: Record<string, string>;
	OPCIONALES: Set<string>;
};

let raiz: string;
let archivo: string;
let datos: string, conocimiento: string, almacen: string, uv: string;
const sinEntorno = {};

function escribir(contenido: unknown) {
	writeFileSync(archivo, typeof contenido === "string" ? contenido : JSON.stringify(contenido));
}
const valido = () => ({ datos, conocimiento, almacen, uv });

before(() => {
	raiz = mkdtempSync(path.join(tmpdir(), "lh-rutas-"));
	datos = path.join(raiz, "datos");
	conocimiento = path.join(raiz, "conocimiento");
	almacen = path.join(raiz, "almacen");
	uv = path.join(raiz, "uv.exe");
	for (const dir of [datos, conocimiento, almacen]) mkdirSync(dir);
	writeFileSync(uv, "");
	archivo = path.join(raiz, "rutas.json");
});
after(() => rmSync(raiz, { recursive: true, force: true }));

describe("rutas.json válido", () => {
	it("entrega las cuatro variables del servidor con las rutas del archivo", () => {
		escribir(valido());
		const resultado = resolverRutas({ archivo, env: sinEntorno });
		assert.ok(resultado.ok);
		assert.deepEqual(resultado.entorno, {
			LH_DATA_DIR: datos, ESTUDIO_KB_DIR: conocimiento, KBOL_ALMACEN: almacen, ESTUDIO_UV: uv,
		});
	});

	it("una variable de entorno definida gana a la del archivo, y la del archivo no se valida", () => {
		const otra = path.join(raiz, "otra");
		mkdirSync(otra);
		escribir({ ...valido(), datos: path.join(raiz, "no-existe") });
		const resultado = resolverRutas({ archivo, env: { LH_DATA_DIR: otra } });
		assert.ok(resultado.ok);
		assert.equal(resultado.entorno.LH_DATA_DIR, otra);
		assert.equal(resultado.entorno.ESTUDIO_KB_DIR, conocimiento);
		rmSync(otra, { recursive: true });
	});

	it("con las cuatro variables definidas no hace falta el archivo", () => {
		const env = { LH_DATA_DIR: datos, ESTUDIO_KB_DIR: conocimiento, KBOL_ALMACEN: almacen, ESTUDIO_UV: uv };
		const resultado = resolverRutas({ archivo: path.join(raiz, "no-hay.json"), env });
		assert.ok(resultado.ok);
		assert.deepEqual(resultado.entorno, env);
	});

	it("una variable vacía no cuenta como definida", () => {
		escribir(valido());
		const resultado = resolverRutas({ archivo, env: { LH_DATA_DIR: "" } });
		assert.ok(resultado.ok);
		assert.equal(resultado.entorno.LH_DATA_DIR, datos);
	});
});

describe("rutas.json defectuoso: nunca hay valores por defecto", () => {
	it("sin archivo, el error nombra el archivo", () => {
		const falta = path.join(raiz, "no-hay.json");
		const resultado = resolverRutas({ archivo: falta, env: sinEntorno });
		assert.ok(!resultado.ok);
		assert.ok(resultado.mensaje.includes(falta));
		assert.equal(resultado.errores[0]!.ruta, falta);
	});

	it("con JSON inválido, el error nombra el archivo", () => {
		escribir("{ no es json");
		const resultado = resolverRutas({ archivo, env: sinEntorno });
		assert.ok(!resultado.ok);
		assert.ok(resultado.mensaje.includes(archivo));
		assert.match(resultado.mensaje, /JSON/);
	});

	it("con algo que no es un objeto, falla", () => {
		escribir("[1, 2]");
		assert.ok(!resolverRutas({ archivo, env: sinEntorno }).ok);
	});

	it("sin «uv» arranca igual y no fija ESTUDIO_UV (es opcional)", () => {
		escribir({ datos, conocimiento, almacen });
		const resultado = resolverRutas({ archivo, env: sinEntorno });
		assert.ok(resultado.ok);
		assert.deepEqual(resultado.entorno, { LH_DATA_DIR: datos, ESTUDIO_KB_DIR: conocimiento, KBOL_ALMACEN: almacen });
	});

	it("«nombre» es opcional: si está, llega como ESTUDIO_NOMBRE; varias líneas o más de 60 caracteres fallan", () => {
		escribir({ ...valido(), nombre: "Lucía" });
		const bien = resolverRutas({ archivo, env: sinEntorno });
		assert.ok(bien.ok);
		assert.equal(bien.entorno.ESTUDIO_NOMBRE, "Lucía");
		for (const malo of ["Lucía\nOtra", "x".repeat(61)]) {
			escribir({ ...valido(), nombre: malo });
			const r = resolverRutas({ archivo, env: sinEntorno });
			assert.ok(!r.ok);
			assert.deepEqual(r.errores.map(e => e.clave), ["nombre"]);
		}
	});

	it("con las tres carpetas en el entorno no hace falta el archivo", () => {
		const env = { LH_DATA_DIR: datos, ESTUDIO_KB_DIR: conocimiento, KBOL_ALMACEN: almacen };
		const resultado = resolverRutas({ archivo: path.join(raiz, "no-hay.json"), env });
		assert.ok(resultado.ok);
		assert.deepEqual(resultado.entorno, env);
	});

	for (const clave of Object.keys(CLAVES).filter(c => !OPCIONALES.has(c))) {
		it(`con la clave «${clave}» ausente, el error la nombra`, () => {
			const contenido: Record<string, string> = valido();
			delete contenido[clave];
			escribir(contenido);
			const resultado = resolverRutas({ archivo, env: sinEntorno });
			assert.ok(!resultado.ok);
			assert.deepEqual(resultado.errores.map(e => e.clave), [clave]);
			assert.ok(resultado.mensaje.includes(clave));
		});

		it(`con la ruta de «${clave}» inexistente, el error nombra clave y ruta`, () => {
			const inexistente = path.join(raiz, "inexistente", clave);
			escribir({ ...valido(), [clave]: inexistente });
			const resultado = resolverRutas({ archivo, env: sinEntorno });
			assert.ok(!resultado.ok);
			assert.deepEqual(resultado.errores.map(e => [e.clave, e.ruta]), [[clave, inexistente]]);
			assert.ok(resultado.mensaje.includes(clave) && resultado.mensaje.includes(inexistente));
		});
	}

	it("una ruta de entorno inexistente también falla, nombrando la variable", () => {
		escribir(valido());
		const inexistente = path.join(raiz, "inexistente");
		const resultado = resolverRutas({ archivo, env: { ESTUDIO_KB_DIR: inexistente } });
		assert.ok(!resultado.ok);
		assert.equal(resultado.errores[0]!.ruta, inexistente);
		assert.ok(resultado.mensaje.includes("ESTUDIO_KB_DIR"));
	});

	it("una carpeta donde debería haber un archivo (uv), o al revés, falla", () => {
		escribir({ ...valido(), uv: datos });
		assert.deepEqual(resolverRutas({ archivo, env: sinEntorno }).ok, false);
		escribir({ ...valido(), datos: uv });
		assert.deepEqual(resolverRutas({ archivo, env: sinEntorno }).ok, false);
	});

	it("una ruta relativa falla: el servidor trabaja desde otra carpeta", () => {
		escribir({ ...valido(), almacen: "almacen" });
		const resultado = resolverRutas({ archivo, env: sinEntorno });
		assert.ok(!resultado.ok);
		assert.equal(resultado.errores[0]!.clave, "almacen");
	});

	it("informa de todos los fallos a la vez", () => {
		escribir({ datos: path.join(raiz, "a"), conocimiento: path.join(raiz, "b"), almacen, uv });
		const resultado = resolverRutas({ archivo, env: sinEntorno });
		assert.ok(!resultado.ok);
		assert.deepEqual(resultado.errores.map(e => e.clave), ["datos", "conocimiento"]);
	});
});
