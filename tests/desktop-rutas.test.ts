/** El main REAL del compilado, sin pantalla: resuelve rutas.json y toma el
 * cerrojo de datos antes de lanzar el servidor, y se niega a arrancar si algo
 * falta o ya hay otra instancia. Carpetas temporales para userData y para las
 * rutas; nunca los datos de David. El módulo de cerrojo se ensaya aparte
 * (cerrojo.test.ts): aquí se sustituye para no escribir archivos. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const mainFile = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
const mainSource = readFileSync(mainFile, "utf8");
const mainRequire = createRequire(mainFile);

let raiz: string;
let datos: string, conocimiento: string, almacen: string, uv: string;
before(() => {
	raiz = mkdtempSync(path.join(tmpdir(), "lh-main-rutas-"));
	[datos, conocimiento, almacen] = ["datos", "conocimiento", "almacen"].map(n => path.join(raiz, n)) as [string, string, string];
	for (const dir of [datos, conocimiento, almacen]) mkdirSync(dir);
	uv = path.join(raiz, "uv.exe");
	writeFileSync(uv, "");
});
after(() => rmSync(raiz, { recursive: true, force: true }));

/** Arranca main() en modo compilado (sin LH_DEV_URL) con userData propio. */
type Cerrojo = { ok: true; liberar(): void } | { ok: false; modo: string | null; pid: number };
async function arrancar(rutasJson: unknown, env: Record<string, string> = {}, ocupado?: { modo: string; pid: number }, respuestas: number[] = [2]) {
	const userData = mkdtempSync(path.join(raiz, "userdata-"));
	if (rutasJson !== null) writeFileSync(path.join(userData, "rutas.json"), typeof rutasJson === "string" ? rutasJson : JSON.stringify(rutasJson));
	const spawns: { binary: string; env: Record<string, string> }[] = [];
	const dialogs: { title: string; content: string }[] = [];
	const exits: number[] = [];
	const windows: string[] = [];
	const cerrojos: { dir: string; modo: string }[] = [];
	const preguntas: string[] = [];
	let liberados = 0;
	const child = () => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, kill() {} });
	class FakeWindow extends EventEmitter {
		static getAllWindows() { return []; }
		webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, send() {}, getZoomFactor: () => 1 });
		loadURL(url: string) { windows.push(url); }
	}
	const app = Object.assign(new EventEmitter(), {
		isPackaged: true, setName() {}, getPath: () => userData, setPath() {},
		requestSingleInstanceLock: () => false, quit() {}, whenReady: async () => {}, exit: (code: number) => exits.push(code),
	});
	const electron = {
		app, BrowserWindow: FakeWindow, nativeTheme: { themeSource: "system" },
		ipcMain: { handle() {}, on() {} },
		Menu: { buildFromTemplate() {}, setApplicationMenu() {} },
		session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeSendHeaders() {} } } },
		shell: { openExternal() {} },
		dialog: {
			showErrorBox: (title: string, content: string) => dialogs.push({ title, content }),
			// Primer uso: cada llamada consume la siguiente respuesta (2 = «Salir»).
			showMessageBox: async (options: { title: string; detail: string }) => { preguntas.push(options.detail); return { response: respuestas.shift() ?? 2 }; },
			showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
		},
	};
	const modules: Record<string, unknown> = {
		electron,
		// Los módulos de sesión y suscripción se ensayan aparte; aquí solo importa el lanzamiento.
		"./chatgpt.cjs": { createChatGPT: () => ({ close() {}, pause() {}, resume() {} }), fileStore: () => ({}) },
		"./chatgpt-ipc.cjs": { attachChatGPTChild: () => ({ send() {}, dispose() {} }), trustedSender: () => true, chatGPTControl: () => ({}) },
		"./subscriptions.cjs": { createSubscriptions: () => ({ ready: Promise.resolve(), close() {}, pause() {}, resume() {} }), loadSubscriptionSDK() {} },
		"./subscription-ipc.cjs": { attachSubscriptionChild: () => ({ send() {}, dispose() {} }), subscriptionControl() {} },
		"./cerrojo.cjs": { tomarCerrojo: (dir: string, modo: string): Cerrojo => {
			cerrojos.push({ dir, modo });
			return ocupado ? { ok: false, ...ocupado } : { ok: true, liberar: () => { liberados++; } };
		} },
		"./dev-server-readiness.cjs": { waitForDevServer: async () => {}, waitForPackagedServer: async () => {} },
		"node:child_process": { spawn: (binary: string, _args: string[], options: { env: Record<string, string> }) => { spawns.push({ binary, env: options.env }); return child(); } },
		"node:http": { get: (_url: string, callback: (res: { resume(): void; statusCode: number }) => void) => { callback({ resume() {}, statusCode: 200 }); return { on() {} }; } },
	};
	const context = {
		require: (id: string) => id in modules ? modules[id] : mainRequire(id),
		process: Object.assign(new EventEmitter(), { platform: "win32", argv: [], env, execPath: "C:\\fixture\\HarnessAcademico.exe", resourcesPath: "C:\\fixture\\resources" }),
		__dirname: path.dirname(mainFile), URL, AbortController, setInterval() {}, setTimeout() {},
		console: { log() {} },
	};
	runInNewContext(mainSource, context, { filename: mainFile });
	await runInNewContext("main()", context);
	return { userData, spawns, dialogs, exits, windows, cerrojos, preguntas, liberados: () => liberados, salir: () => context.process.emit("exit") };
}

const validas = () => ({ datos, conocimiento, almacen, uv });

describe("el compilado resuelve rutas.json antes de lanzar el servidor", () => {
	it("con un rutas.json válido, el servidor recibe las cuatro variables y LH_DATA_DIR ya no es userData/data", async () => {
		const f = await arrancar(validas());
		assert.equal(f.spawns.length, 1);
		const env = f.spawns[0]!.env;
		assert.equal(env.LH_DATA_DIR, datos);
		assert.equal(env.ESTUDIO_KB_DIR, conocimiento);
		assert.equal(env.KBOL_ALMACEN, almacen);
		assert.equal(env.ESTUDIO_UV, uv);
		assert.notEqual(env.LH_DATA_DIR, path.join(f.userData, "data"));
		assert.equal(env.LH_AUTH_FILE, path.join(f.userData, "auth.json"));
		assert.deepEqual(f.dialogs, []);
		assert.equal(f.windows.length, 1);
	});

	it("una variable de entorno definida gana a la del archivo", async () => {
		const otra = path.join(raiz, "otra-kb");
		mkdirSync(otra, { recursive: true });
		const f = await arrancar(validas(), { ESTUDIO_KB_DIR: otra });
		assert.equal(f.spawns[0]!.env.ESTUDIO_KB_DIR, otra);
		assert.equal(f.spawns[0]!.env.LH_DATA_DIR, datos);
	});

	const casos: [string, unknown, (string | RegExp)[]][] = [
		["con JSON inválido", "{ no es json", ["rutas.json", "JSON"]],
		["con una ruta inexistente", { ...validas(), almacen: path.join(raiz, "no-existe") }, ["almacen", path.join(raiz, "no-existe")]],
		["con una clave obligatoria ausente", { datos, conocimiento, uv }, ["almacen"]],
	];
	for (const [etiqueta, contenido, esperado] of casos) {
		it(`${etiqueta}: diálogo con clave y ruta, ningún servidor ni ventana, salida con error`, async () => {
			const f = await arrancar(contenido);
			assert.equal(f.dialogs.length, 1);
			for (const trozo of esperado) assert.ok(f.dialogs[0]!.content.includes(String(trozo)), `falta «${trozo}» en: ${f.dialogs[0]!.content}`);
			assert.deepEqual(f.spawns, [], "no se lanza ningún proceso de servidor");
			assert.deepEqual(f.windows, []);
			assert.deepEqual(f.exits, [1]);
		});
	}
});

describe("primer uso: sin rutas.json en este equipo", () => {
	it("pregunta antes de crear nada; «Salir» no crea carpetas ni archivo y sale sin error", async () => {
		const f = await arrancar(null);
		assert.equal(f.preguntas.length, 1);
		assert.match(f.preguntas[0]!, /HarnessAcademico/);
		assert.equal(existsSync(path.join(f.userData, "rutas.json")), false);
		assert.equal(existsSync(path.join(f.userData, "HarnessAcademico")), false);
		assert.deepEqual(f.spawns, []); assert.deepEqual(f.dialogs, []); assert.deepEqual(f.exits, [0]);
	});
	it("«Usar esta carpeta» crea las tres carpetas y rutas.json, y arranca con ellas", async () => {
		const f = await arrancar(null, {}, undefined, [0]);
		const base = path.join(f.userData, "HarnessAcademico"); // en la prueba, Documentos es userData
		const escrito = JSON.parse(readFileSync(path.join(f.userData, "rutas.json"), "utf8"));
		assert.equal(escrito.datos, path.join(base, "datos"));
		assert.equal(escrito.conocimiento, path.join(base, "conocimiento"));
		assert.equal(escrito.almacen, path.join(base, "almacen"));
		assert.equal(f.spawns.length, 1);
		assert.equal(f.spawns[0]!.env.LH_DATA_DIR, path.join(base, "datos"));
		assert.deepEqual(f.cerrojos, [{ dir: path.join(base, "datos"), modo: "compilado" }]);
		assert.deepEqual(f.dialogs, []); assert.equal(f.windows.length, 1);
	});
	it("un rutas.json existente con errores no se sustituye: sigue el diálogo de error", async () => {
		const f = await arrancar("{ no es json");
		assert.deepEqual(f.preguntas, []); assert.equal(f.dialogs.length, 1); assert.deepEqual(f.exits, [1]);
	});
});

describe("el cerrojo de datos se toma tras resolver las rutas y antes de lanzar el servidor", () => {
	it("compilado: toma el cerrojo en la carpeta de datos de rutas.json con el modo «compilado» y lo libera al salir", async () => {
		const f = await arrancar(validas());
		assert.deepEqual(f.cerrojos, [{ dir: datos, modo: "compilado" }]);
		assert.equal(f.spawns.length, 1);
		assert.equal(f.liberados(), 0);
		f.salir();
		assert.equal(f.liberados(), 1);
	});

	it("compilado con otra instancia abierta: diálogo con el modo, sin servidor ni ventana, salida con error", async () => {
		const f = await arrancar(validas(), {}, { modo: "desarrollo", pid: 4242 });
		assert.equal(f.dialogs.length, 1);
		assert.match(f.dialogs[0]!.content, /ya está abierto en modo desarrollo/);
		assert.deepEqual(f.spawns, []);
		assert.deepEqual(f.windows, []);
		assert.deepEqual(f.exits, [1]);
	});

	it("con rutas defectuosas ni siquiera intenta el cerrojo", async () => {
		const f = await arrancar(null);
		assert.deepEqual(f.cerrojos, []);
	});

	it("desarrollo: toma el cerrojo en LH_DATA_DIR con el modo «desarrollo», sin rutas.json", async () => {
		const f = await arrancar(null, { LH_DEV_URL: "http://localhost:3000", LH_DATA_DIR: datos });
		assert.deepEqual(f.cerrojos, [{ dir: datos, modo: "desarrollo" }]);
		assert.deepEqual(f.dialogs, []);
		assert.deepEqual(f.spawns, [], "el desarrollo no lanza servidor propio");
		assert.deepEqual(f.windows, ["http://localhost:3000"]);
	});

	it("desarrollo con otra instancia abierta: diálogo, sin ventana", async () => {
		const f = await arrancar(null, { LH_DEV_URL: "http://localhost:3000", LH_DATA_DIR: datos }, { modo: "compilado", pid: 77 });
		assert.match(f.dialogs[0]!.content, /ya está abierto en modo compilado/);
		assert.deepEqual(f.windows, []);
		assert.deepEqual(f.exits, [1]);
	});
});
