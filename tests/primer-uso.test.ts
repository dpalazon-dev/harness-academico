/** Primer uso del compilado sin rutas.json (módulo puro, carpetas temporales). */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const req = createRequire(import.meta.url);
const { necesitaPrimerUso, buscarUv, prepararPrimerUso } = req("../electron/primer-uso.cjs");

let raiz: string;
before(() => { raiz = mkdtempSync(path.join(tmpdir(), "lh-primer-uso-")); });
after(() => rmSync(raiz, { recursive: true, force: true }));

function dialogo(respuestas: number[], elegida?: string) {
	const mensajes: string[] = [];
	return {
		mensajes,
		showMessageBox: async (o: { detail: string }) => { mensajes.push(o.detail); return { response: respuestas.shift() ?? 2 }; },
		showOpenDialog: async () => elegida ? { canceled: false, filePaths: [elegida] } : { canceled: true, filePaths: [] },
	};
}

describe("cuándo hay primer uso", () => {
	it("solo sin archivo y sin las tres carpetas en el entorno", () => {
		const archivo = path.join(raiz, "a", "rutas.json");
		assert.equal(necesitaPrimerUso({ archivo, env: {} }), true);
		assert.equal(necesitaPrimerUso({ archivo, env: { LH_DATA_DIR: "x", ESTUDIO_KB_DIR: "y", KBOL_ALMACEN: "z" } }), false);
		writeFileSync(path.join(raiz, "existe.json"), "{}");
		assert.equal(necesitaPrimerUso({ archivo: path.join(raiz, "existe.json"), env: {} }), false);
	});
});

describe("buscar uv", () => {
	it("lo encuentra en el PATH o en ~/.local/bin, y si no, null", () => {
		const nombre = process.platform === "win32" ? "uv.exe" : "uv";
		const enPath = path.join(raiz, "bin");
		const visto = new Set([path.join(enPath, nombre)]);
		assert.equal(buscarUv({ env: { PATH: enPath }, home: raiz, existe: (f: string) => visto.has(f) }), path.join(enPath, nombre));
		const local = path.join(raiz, ".local", "bin", nombre);
		assert.equal(buscarUv({ env: { PATH: "" }, home: raiz, existe: (f: string) => f === local }), local);
		assert.equal(buscarUv({ env: {}, home: raiz, existe: () => false }), null);
	});
});

describe("preparar el primer uso", () => {
	it("«Salir» no crea nada", async () => {
		const documentos = mkdtempSync(path.join(raiz, "docs-"));
		const archivo = path.join(raiz, "ud1", "rutas.json");
		const r = await prepararPrimerUso({ archivo, documentos, dialog: dialogo([2]), uv: null });
		assert.deepEqual(r, { ok: false });
		assert.equal(existsSync(archivo), false); assert.equal(existsSync(path.join(documentos, "HarnessAcademico")), false);
	});
	it("«Usar esta carpeta» crea las tres carpetas y rutas.json; sin uv lo avisa y lo omite", async () => {
		const documentos = mkdtempSync(path.join(raiz, "docs-"));
		const archivo = path.join(raiz, "ud2", "rutas.json");
		const d = dialogo([0]);
		const r = await prepararPrimerUso({ archivo, documentos, dialog: d, uv: null });
		assert.ok(r.ok);
		const base = path.join(documentos, "HarnessAcademico");
		for (const n of ["datos", "conocimiento", "almacen"]) assert.ok(existsSync(path.join(base, n)));
		assert.deepEqual(JSON.parse(readFileSync(archivo, "utf8")), { datos: path.join(base, "datos"), conocimiento: path.join(base, "conocimiento"), almacen: path.join(base, "almacen") });
		assert.match(d.mensajes[0]!, /No encuentro uv/);
	});
	it("«Elegir otra carpeta» vuelve a confirmar con la nueva y apunta uv si lo hay", async () => {
		const documentos = mkdtempSync(path.join(raiz, "docs-"));
		const otra = mkdtempSync(path.join(raiz, "otra-"));
		const archivo = path.join(raiz, "ud3", "rutas.json");
		const d = dialogo([1, 0], otra);
		const uv = path.join(raiz, "uv.exe");
		const r = await prepararPrimerUso({ archivo, documentos, dialog: d, uv });
		assert.ok(r.ok); assert.equal(r.base, otra);
		assert.equal(d.mensajes.length, 2); assert.ok(d.mensajes[1]!.includes(otra));
		assert.equal(JSON.parse(readFileSync(archivo, "utf8")).uv, uv);
		assert.equal(existsSync(path.join(documentos, "HarnessAcademico")), false);
	});
	it("nunca sobrescribe un rutas.json que apareció entretanto", async () => {
		const documentos = mkdtempSync(path.join(raiz, "docs-"));
		const archivo = path.join(raiz, "ud4", "rutas.json");
		const d = { showMessageBox: async () => { writeFileSync(archivo, '{"datos":"suyo"}'); return { response: 0 }; }, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
		mkdirSync(path.dirname(archivo), { recursive: true });
		await prepararPrimerUso({ archivo, documentos, dialog: d, uv: null });
		assert.equal(readFileSync(archivo, "utf8"), '{"datos":"suyo"}');
	});
});
