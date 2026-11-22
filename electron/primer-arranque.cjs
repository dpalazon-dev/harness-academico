"use strict";
/** Aviso de espera del compilado (fork HarnessAcademico, ticket 07).
 *
 * Tras instalar, Windows comprueba por primera vez los archivos nuevos y el
 * servidor puede tardar medio minuto en responder. Sin ventana, parece que la
 * app no arranca. Este aviso aparece solo si la espera pasa de `retrasoMs`
 * (un arranque normal, de 2 a 3 s, nunca lo ve) y se cierra cuando la
 * ventana real está abierta. No importa Electron: lo recibe, para poder
 * probarlo sin pantalla. */

const html = (fondo, texto) => `<!doctype html><meta charset="utf-8"><title>HarnessAcademico</title>
<style>html,body{margin:0;height:100%;background:${fondo};color:${texto};font:14px system-ui,sans-serif}
body{display:flex;flex-direction:column;justify-content:center;gap:10px;padding:0 28px;-webkit-app-region:drag}
h1{margin:0;font-size:17px;font-weight:600}p{margin:0;opacity:.7;line-height:1.4}</style>
<h1>Preparando HarnessAcademico…</h1>
<p>Si es el primer arranque tras instalar, Windows comprueba los archivos nuevos y puede tardar más de lo normal. No hace falta hacer nada.</p>`;

/**
 * @param {{BrowserWindow: any, appearance?: {mode?: string, background?: string}, title?: string, retrasoMs?: number, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout}} options
 * @returns {{cerrar(): void, readonly cancelada: boolean}}
 */
function esperarConAviso({ BrowserWindow, appearance = {}, title = "HarnessAcademico", retrasoMs = 4000, setTimeout: after = setTimeout, clearTimeout: cancel = clearTimeout }) {
	let ventana = null;
	let cerrada = false;
	let cancelada = false;
	const timer = after(() => {
		if (cerrada) return;
		const oscuro = appearance.mode === "dark";
		const fondo = /^#[0-9a-f]{3,8}$/i.test(appearance.background ?? "") ? appearance.background : oscuro ? "#141414" : "#ffffff";
		ventana = new BrowserWindow({
			width: 460, height: 170, title, frame: false, resizable: false, maximizable: false,
			minimizable: false, fullscreenable: false, backgroundColor: fondo,
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
		});
		ventana.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		ventana.webContents.on("will-navigate", (event) => event.preventDefault());
		// Cerrarla a mano cancela el arranque: la carcasa sale sin diálogo de error.
		ventana.on("closed", () => { ventana = null; if (!cerrada) cancelada = true; });
		ventana.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(fondo, oscuro ? "#e8e8e8" : "#1a1a1a"))}`);
	}, retrasoMs);
	return {
		cerrar() {
			cerrada = true;
			cancel(timer);
			const abierta = ventana;
			ventana = null;
			if (abierta && !abierta.isDestroyed?.()) abierta.destroy();
		},
		get cancelada() { return cancelada; },
	};
}

module.exports = { esperarConAviso };
