/**
 * Navegar entre mensajes de una conversación (petición de David del 23-nov-2026): la elección de la parada,
 * el salto sobre un contenedor simulado, el registro de Alt+↑/↓ y el despachador, que lo emite también
 * escribiendo en un campo. Que el salto se vea bien con el seguimiento del final se comprueba en la app.
 */
import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { actionForBinding, eventBinding, kbdEventForAction, KEYBOARD_ACTIONS } from "../src/core/keyboard.ts";
import { indiceDestino, irAParada, MARGEN_PARADA } from "../components/estudio/navegar-mensajes.tsx";
import { KeyboardShortcuts } from "../components/keyboard-shortcuts.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";

describe("qué parada toca", () => {
	const cimas = [0, 300, 900, 1400];
	it("la siguiente es la primera por debajo de la línea de lectura; la anterior, la última por encima", () => {
		assert.equal(indiceDestino(cimas, 16, "siguiente"), 1);
		assert.equal(indiceDestino(cimas, 300, "siguiente"), 2);
		assert.equal(indiceDestino(cimas, 300, "anterior"), 0);
		assert.equal(indiceDestino(cimas, 900, "anterior"), 1);
	});
	it("desde la mitad de un mensaje largo, la anterior es su propio inicio", () => {
		assert.equal(indiceDestino(cimas, 1100, "anterior"), 2);
		assert.equal(indiceDestino(cimas, 1100, "siguiente"), 3);
	});
	it("estar casi en una parada cuenta como estar en ella", () => {
		assert.equal(indiceDestino(cimas, 304, "siguiente"), 2);
		assert.equal(indiceDestino(cimas, 296, "anterior"), 0);
	});
	it("en los extremos o sin mensajes, ninguna", () => {
		assert.equal(indiceDestino(cimas, 1416, "siguiente"), null);
		assert.equal(indiceDestino(cimas, 0, "anterior"), null);
		assert.equal(indiceDestino([], 100, "siguiente"), null);
	});
});

describe("el salto", () => {
	/** Un contenedor con paradas a alturas fijas del contenido; el desplazamiento se refleja en sus rectángulos. */
	function contenedor(cimas: number[], ocultas: number[] = []) {
		const c = {
			scrollTop: 0,
			destinos: [] as number[],
			getBoundingClientRect: () => ({ top: 100 }),
			scrollTo({ top }: { top: number }) { c.destinos.push(top); c.scrollTop = top; },
			querySelectorAll: (selector: string) => {
				assert.equal(selector, "[data-parada-mensaje]");
				return cimas.map((cima, i) => ({
					getClientRects: () => (ocultas.includes(i) ? [] : [{}]),
					getBoundingClientRect: () => ({ top: 100 + cima - c.scrollTop }),
				}));
			},
		};
		return c;
	}

	it("baja y sube de parada en parada, con el margen arriba, y no se mueve en los extremos", () => {
		const c = contenedor([0, 300, 900]);
		const ir = (d: "anterior" | "siguiente") => irAParada(c as unknown as HTMLElement, d);
		assert.equal(ir("siguiente"), true);
		assert.equal(c.scrollTop, 300 - MARGEN_PARADA);
		assert.equal(ir("siguiente"), true);
		assert.equal(c.scrollTop, 900 - MARGEN_PARADA);
		assert.equal(ir("siguiente"), false);
		assert.equal(ir("anterior"), true);
		assert.equal(c.scrollTop, 300 - MARGEN_PARADA);
		assert.equal(ir("anterior"), true);
		assert.equal(c.scrollTop, 0, "nunca por encima del principio");
		assert.equal(ir("anterior"), false);
	});

	it("salta las paradas ocultas", () => {
		const c = contenedor([0, 300, 900], [1]);
		irAParada(c as unknown as HTMLElement, "siguiente");
		assert.equal(c.scrollTop, 900 - MARGEN_PARADA);
	});
});

describe("Alt+↑ y Alt+↓", () => {
	it("son las acciones message-prev y message-next del registro, en el grupo de la conversación y reasignables", () => {
		assert.equal(actionForBinding("alt+arrowup"), "message-prev");
		assert.equal(actionForBinding("alt+arrowdown"), "message-next");
		for (const id of ["message-prev", "message-next"]) {
			const def = KEYBOARD_ACTIONS.find(a => a.id === id)!;
			assert.equal(def.scope, "chat");
			assert.ok(!def.displayOnly);
		}
		const tecla = { key: "ArrowUp", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false, code: "ArrowUp" } as KeyboardEvent;
		assert.equal(eventBinding(tecla), "alt+arrowup");
	});

	let root: Root | undefined;
	let limpiar: (() => void) | undefined;
	afterEach(async () => { await act(async () => root?.unmount()); root = undefined; limpiar?.(); limpiar = undefined; });

	it("el despachador las emite también escribiendo en un campo y reclama la tecla", async () => {
		const dom = parseHTML("<html><head></head><body><textarea id='campo'></textarea><div id='root'></div></body></html>");
		const globals = {
			React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
			Node: dom.window.Node, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
		};
		const saved = new Map(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
		Object.assign(globalThis, globals);
		limpiar = () => { for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else Reflect.deleteProperty(globalThis, k); } };
		const router = { bfcacheId: "navegar", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
		root = createRoot(dom.document.querySelector("#root")!);
		await act(async () => root!.render(
			<InteractionLayersProvider><AppRouterContext.Provider value={router}><KeyboardShortcuts /></AppRouterContext.Provider></InteractionLayersProvider>,
		));
		const oidos: string[] = [];
		for (const accion of ["message-prev", "message-next"] as const) dom.window.addEventListener(kbdEventForAction(accion), () => oidos.push(accion));
		const campo = dom.document.querySelector("#campo")!;
		const pulsar = async (key: string) => {
			const e = Object.assign(new dom.window.Event("keydown", { bubbles: true, cancelable: true }), { key, code: key, altKey: true, metaKey: false, ctrlKey: false, shiftKey: false });
			await act(async () => { campo.dispatchEvent(e); });
			return e;
		};
		const arriba = await pulsar("ArrowUp");
		const abajo = await pulsar("ArrowDown");
		assert.deepEqual(oidos, ["message-prev", "message-next"]);
		assert.ok(arriba.defaultPrevented && abajo.defaultPrevented);
	});
});
