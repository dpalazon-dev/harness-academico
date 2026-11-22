/** Aviso de espera del primer arranque del compilado (ticket 07), sin pantalla. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const req = createRequire(import.meta.url);
const { esperarConAviso } = req("../electron/primer-arranque.cjs");
const readiness = req("../electron/dev-server-readiness.cjs");

function fakeElectron() {
	const created: FakeWindow[] = [];
	class FakeWindow extends EventEmitter {
		destroyed = false; loaded = ""; options: Record<string, unknown>;
		webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
		constructor(options: Record<string, unknown>) { super(); this.options = options; created.push(this); }
		loadURL(url: string) { this.loaded = url; }
		isDestroyed() { return this.destroyed; }
		destroy() { this.destroyed = true; this.emit("closed"); }
	}
	return { BrowserWindow: FakeWindow, created };
}

describe("aviso de primer arranque", () => {
	it("no aparece si el servidor responde antes del retraso", async () => {
		const { BrowserWindow, created } = fakeElectron();
		const aviso = esperarConAviso({ BrowserWindow, retrasoMs: 40 });
		aviso.cerrar(); await delay(80);
		assert.equal(created.length, 0); assert.equal(aviso.cancelada, false);
	});
	it("aparece pasado el retraso, aislada, y se destruye al cerrar sin cancelar", async () => {
		const { BrowserWindow, created } = fakeElectron();
		const aviso = esperarConAviso({ BrowserWindow, appearance: { mode: "dark", background: "#141414" }, retrasoMs: 10 });
		await delay(50);
		assert.equal(created.length, 1);
		const web = created[0]!.options.webPreferences as Record<string, unknown>;
		assert.deepEqual(web, { sandbox: true, contextIsolation: true, nodeIntegration: false });
		assert.match(created[0]!.loaded, /^data:text\/html/); assert.match(decodeURIComponent(created[0]!.loaded), /Preparando HarnessAcademico/);
		aviso.cerrar();
		assert.equal(created[0]!.destroyed, true); assert.equal(aviso.cancelada, false);
	});
	it("cerrarla a mano marca el arranque como cancelado", async () => {
		const { BrowserWindow, created } = fakeElectron();
		const aviso = esperarConAviso({ BrowserWindow, retrasoMs: 10 });
		await delay(50); created[0]!.emit("closed");
		assert.equal(aviso.cancelada, true);
		aviso.cerrar(); // idempotente
	});
	it("ignora un fondo que no sea un color", async () => {
		const { BrowserWindow, created } = fakeElectron();
		const aviso = esperarConAviso({ BrowserWindow, appearance: { background: "red;}</style><script>" }, retrasoMs: 5 });
		await delay(40); assert.equal(created[0]!.options.backgroundColor, "#ffffff"); aviso.cerrar();
	});
});

describe("plazo del servidor empaquetado", () => {
	it("es de dos minutos por defecto y la carcasa no lo recorta", () => {
		assert.equal(readiness.PACKAGED_STARTUP_MS, 120000);
		const main = readFileSync(fileURLToPath(new URL("../electron/main.cjs", import.meta.url)), "utf8");
		assert.match(main, /waitForPackagedServer\(url \+ "\/desktop-ready", child, identity\)/, "sin opciones: usa el plazo por defecto");
		assert.match(main, /espera\?\.cerrar\(\);[^\n]*\r?\n\s*log\(`window open/, "el aviso se cierra tras abrir la ventana real");
	});
});
