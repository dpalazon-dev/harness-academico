/** Fork HarnessAcademico: the shell NEVER updates. Actual shell functions with
 * fake Electron/filesystem. No app, profile, network, timer or updater is run;
 * any attempt to load electron-updater fails the test. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const mainFile = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
const mainSource = readFileSync(mainFile, "utf8");
const mainRequire = createRequire(mainFile);

function fixture({ packaged = true } = {}) {
	const requested: string[] = [];
	const settingsReads: string[] = [];
	const intervals: { callback: () => void; delay: number }[] = [];
	const handles = new Map<string, (event: unknown) => unknown>();
	const windows: FakeWindow[] = [];
	let userData = "/fixture/custom-user-data";
	let menu: { submenu?: { label?: string; click?: () => void }[] }[] = [];
	class FakeWebContents extends EventEmitter {
		mainFrame = { url: "http://127.0.0.1:9000/" };
		messages: { channel: string; value: unknown }[] = [];
		loading = false;
		send(channel: string, value: unknown) {
			this.messages.push({ channel, value: JSON.parse(JSON.stringify(value)) });
		}
		isLoadingMainFrame() { return this.loading; }
		setWindowOpenHandler() {}
		getZoomFactor() { return 1; }
	}
	class FakeWindow extends EventEmitter {
		webContents = new FakeWebContents();
		minimized = false;
		focused = false;
		constructor() { super(); windows.push(this); }
		loadURL() { this.webContents.loading = true; }
		isMinimized() { return this.minimized; }
		restore() { this.minimized = false; }
		focus() { this.focused = true; }
		show() {}
		static getAllWindows() { return windows; }
		static fromWebContents(contents: FakeWebContents) { return windows.find(win => win.webContents === contents); }
	}
	const app = Object.assign(new EventEmitter(), {
		isPackaged: packaged,
		name: "HarnessAcademico",
		setName() {},
		getPath: () => userData,
		setPath: (_: string, value: string) => { userData = value; },
		requestSingleInstanceLock: () => false,
		quit() {},
		whenReady: async () => {},
	});
	const electron = {
		app, BrowserWindow: FakeWindow,
		Menu: { buildFromTemplate: (value: typeof menu) => value, setApplicationMenu: (value: typeof menu) => { menu = value; } },
		ipcMain: { on() {}, handle: (channel: string, fn: (event: unknown) => unknown) => handles.set(channel, fn) },
		nativeTheme: { shouldUseDarkColors: true, themeSource: "system", on() {} },
		session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
	};
	const context = createContext({
		require: (id: string) => {
			requested.push(id);
			if (id === "electron") return electron;
			if (id === "electron-updater") throw new Error("electron-updater must never be loaded in this fork");
			// The actual dev readiness helper is tested separately; keep this
			// shell fixture entirely offline and already ready.
			if (id === "./dev-server-readiness.cjs") return { waitForDevServer: async () => {} };
			// The data lock (cerrojo.test.ts) must not write files from this fixture.
			if (id === "./cerrojo.cjs") return { tomarCerrojo: () => ({ ok: true, liberar() {} }) };
			if (id === "node:fs") return {
				readFileSync: (file: string) => { settingsReads.push(file); throw new Error("ENOENT"); },
				mkdirSync() {}, appendFileSync() {},
			};
			return mainRequire(id);
		},
		process: { argv: [], env: { LH_DEV_URL: "http://127.0.0.1:9000" }, platform: "darwin", on() {} },
		__dirname: path.dirname(mainFile), URL, AbortController,
		setInterval: (callback: () => void, delay: number) => intervals.push({ callback, delay }),
		setTimeout() {},
	});
	runInContext(mainSource, context, { filename: mainFile });
	const run = (code: string) => runInContext(code, context);
	return {
		run, windows, intervals, handles, settingsReads, requested,
		window: () => new FakeWindow(),
		state: () => JSON.parse(JSON.stringify(run("updateState"))),
		menuCheck: () => menu[0]!.submenu!.find(item => item.label === "Check for Updates…")!.click!(),
	};
}

describe("auto-update is disabled in the fork", () => {
	for (const packaged of [true, false]) {
		it(`${packaged ? "packaged" : "unpackaged"}: reports disabled and never loads electron-updater`, () => {
			const f = fixture({ packaged });
			f.run("setupAutoUpdater()");
			assert.equal(f.state().status, "disabled");
			assert.ok(!f.requested.includes("electron-updater"));
			assert.equal(f.run("autoUpdater"), null);
		});
	}

	it("automatic and manual checks do nothing: no feed, no settings read, no status change", () => {
		const f = fixture();
		f.run("setupAutoUpdater()");
		const before = f.state();
		f.run("checkForUpdates()");
		f.run("checkForUpdates({ manual: true })");
		assert.deepEqual(f.settingsReads, []);
		assert.deepEqual(f.state(), before);
	});

	it("pushes the disabled state to open windows", () => {
		const f = fixture(); const win = f.window();
		f.run("setupAutoUpdater()");
		assert.deepEqual(win.webContents.messages.at(-1), { channel: "lh:update-status", value: f.state() });
	});

	it("boot schedules no 24h check and the baked feed override is ignored", async () => {
		const f = fixture();
		await f.run("main()");
		assert.deepEqual(f.intervals, []);
		assert.equal(f.state().status, "disabled");
		assert.ok(!f.requested.includes("electron-updater"));
	});
});

describe("trusted IPC and menu wiring around the disabled updater", () => {
	it("the snapshot IPC reports disabled to an owned main frame and rejects anyone else; check never throws for it", async () => {
		const f = fixture(); await f.run("main()");
		const sender = f.windows[0]!.webContents;
		const event = { sender, senderFrame: sender.mainFrame };
		const get = f.handles.get("lh:update:get")!; const check = f.handles.get("lh:update:check")!;
		assert.equal((get(event) as { status: string }).status, "disabled");
		check(event);
		assert.equal((get(event) as { status: string }).status, "disabled");
		for (const bad of [
			{ sender: {}, senderFrame: sender.mainFrame },
			{ sender, senderFrame: { url: sender.mainFrame.url } },
		]) {
			assert.throws(() => get(bad), /Untrusted/); assert.throws(() => check(bad), /Untrusted/);
		}
		sender.mainFrame.url = "https://untrusted.invalid/";
		assert.throws(() => check(event), /Untrusted/);
	});

	it("menu restores/focuses a minimized window and opens General, where the update shows as disabled", async () => {
		const f = fixture(); await f.run("main()");
		const win = f.windows[0]!; win.webContents.loading = false; win.minimized = true;
		f.menuCheck();
		assert.equal(win.minimized, false); assert.equal(win.focused, true);
		assert.ok(win.webContents.messages.some(message => message.channel === "lh:open-settings" && message.value === "general"));
		assert.equal(f.state().status, "disabled");
	});

	it("menu reopens a window and delivers General after load", async () => {
		const f = fixture(); await f.run("main()");
		f.windows.length = 0; f.menuCheck();
		assert.equal(f.windows.length, 1);
		const win = f.windows[0]!;
		assert.ok(!win.webContents.messages.some(message => message.channel === "lh:open-settings"));
		win.webContents.emit("did-finish-load");
		assert.ok(win.webContents.messages.some(message => message.channel === "lh:open-settings"));
	});
});

describe("packaging has no update feed", () => {
	it("electron-builder.yml declares the fork identity and no publish block", () => {
		const text = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
		assert.match(text, /^productName: HarnessAcademico\s*$/m);
		assert.match(text, /^appId: com\.harnessacademico\.app\s*$/m);
		assert.doesNotMatch(text, /^publish:/m);
		assert.doesNotMatch(text, /amosblomqvist/);
	});

	it("the shell is named HarnessAcademico", () => {
		assert.match(mainSource, /const PRODUCT_NAME = "HarnessAcademico";/);
		assert.match(mainSource, /app\.setName\(PRODUCT_NAME\)/);
	});
});
