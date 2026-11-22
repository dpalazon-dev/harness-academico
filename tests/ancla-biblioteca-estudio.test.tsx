/**
 * El ancla de subida de Biblioteca (ticket 04 de la segunda ronda), montada de
 * verdad: «Añadir material» del inicio llega a `/biblioteca#subir` y el botón
 * «Elegir archivos» queda enfocado; si al llegar el botón falta (subida en
 * curso) o está desactivado, se enfoca cuando esté listo, una sola vez. El
 * desplazamiento a la zona es del navegador y se comprueba en la app.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { installModalDom } from "./modal-dom.ts";
import { BibliotecaEstudio } from "../components/estudio/biblioteca.tsx";
import type { ProgresoSubida } from "../components/estudio/documentos.ts";

let root: Root | null = null;
let restore: (() => void) | null = null;

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

const nada = () => {};
const acciones = { subir: nada, incorporarRuta: nada, leer: nada, detalle: nada, vincular: nada, registrarEnBase: nada, reintentar: nada, borrar: nada };
const SUBIENDO: ProgresoSubida = { name: "cormen.pdf", sent: 1, total: 10 };

async function montar(hash: string, inicial: { subiendo: ProgresoSubida | null; ocupado: boolean }) {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	Object.defineProperty(dom.window, "location", { configurable: true, value: { hash } });
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true,
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	const restoreModal = installModalDom(dom);
	// linkedom no desplaza.
	Object.assign(dom.window.HTMLElement.prototype, { scrollIntoView() {} });
	restore = () => {
		restoreModal();
		for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	};
	root = createRoot(dom.document.querySelector("#root")!);
	const pintar = async (estado: { subiendo: ProgresoSubida | null; ocupado: boolean }) => {
		await act(async () => {
			root!.render(<BibliotecaEstudio documentos={[]} subiendo={estado.subiendo} detalle={null} unidades={[]} ocupado={estado.ocupado} error={null} acciones={acciones} />);
		});
	};
	await pintar(inicial);
	const enfocado = () => dom.document.activeElement?.textContent ?? null;
	return { dom, pintar, enfocado };
}

it("con #subir, enfoca «Elegir archivos» al llegar", async () => {
	const m = await montar("#subir", { subiendo: null, ocupado: false });
	assert.equal(m.enfocado(), "Elegir archivos");
});

it("con una subida en curso al llegar, enfoca el botón cuando la subida termina", async () => {
	const m = await montar("#subir", { subiendo: SUBIENDO, ocupado: false });
	assert.notEqual(m.enfocado(), "Elegir archivos");
	await m.pintar({ subiendo: null, ocupado: false });
	assert.equal(m.enfocado(), "Elegir archivos");
});

it("con el botón desactivado al llegar, lo enfoca cuando se activa, y solo una vez", async () => {
	const m = await montar("#subir", { subiendo: null, ocupado: true });
	assert.notEqual(m.enfocado(), "Elegir archivos");
	await m.pintar({ subiendo: null, ocupado: false });
	assert.equal(m.enfocado(), "Elegir archivos");
	await act(async () => { m.dom.document.body.focus(); });
	await m.pintar({ subiendo: null, ocupado: true });
	await m.pintar({ subiendo: null, ocupado: false });
	assert.notEqual(m.enfocado(), "Elegir archivos", "no vuelve a robar el foco");
});

it("sin el ancla no enfoca nada", async () => {
	const m = await montar("", { subiendo: SUBIENDO, ocupado: false });
	await m.pintar({ subiendo: null, ocupado: false });
	assert.notEqual(m.enfocado(), "Elegir archivos");
});
