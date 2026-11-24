/**
 * El ancho de la barra lateral (petición de David del 23-nov-2026): límites de 200 a 480 px, recuerdo en este
 * navegador y el asa del borde montada sobre linkedom (arrastrar, soltar, clic, doble clic y flechas). Que la
 * barra siga al puntero sin saltos depende del navegador: se comprueba en la app.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { installModalDom } from "./modal-dom.ts";
import { ANCHO_MAXIMO, ANCHO_MINIMO, ANCHO_POR_DEFECTO, anchoGuardado, limitarAncho, recordarAncho } from "../components/estudio/ancho-barra.ts";

const bootstrap = parseHTML("<html><body></body></html>");
const bootstrapGlobals = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window: bootstrap.window, document: bootstrap.document });
const { Sidebar } = await import("../components/ui/sidebar.tsx");
const { ProveedorBarraLateral } = await import("../components/estudio/barra-lateral.tsx");
const { AsaAnchoBarra } = await import("../components/estudio/asa-barra.tsx");
for (const [key, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }

function almacen(inicial: Record<string, string> = {}) {
	const datos = new Map(Object.entries(inicial));
	return {
		datos,
		getItem: (k: string) => datos.get(k) ?? null,
		setItem: (k: string, v: string) => { datos.set(k, v); },
		removeItem: (k: string) => { datos.delete(k); },
	};
}

describe("límites y recuerdo del ancho", () => {
	it("limita a 200–480 px, redondea y cae en 256 con valores sin sentido", () => {
		assert.equal(limitarAncho(100), ANCHO_MINIMO);
		assert.equal(limitarAncho(900), ANCHO_MAXIMO);
		assert.equal(limitarAncho(300.6), 301);
		assert.equal(limitarAncho(Number.NaN), ANCHO_POR_DEFECTO);
	});

	it("recuerda el ancho limitado y lo lee; sin nada guardado o sin almacenamiento, 256", () => {
		const antes = Object.getOwnPropertyDescriptor(globalThis, "window");
		try {
			const ls = almacen();
			Object.assign(globalThis, { window: { localStorage: ls } });
			assert.equal(anchoGuardado(), ANCHO_POR_DEFECTO);
			recordarAncho(1000);
			assert.equal(ls.datos.get("estudio:barra:ancho"), "480");
			assert.equal(anchoGuardado(), 480);
			ls.datos.set("estudio:barra:ancho", "basura");
			assert.equal(anchoGuardado(), ANCHO_POR_DEFECTO);
			Object.assign(globalThis, { window: { get localStorage() { throw new Error("bloqueado"); } } });
			assert.equal(anchoGuardado(), ANCHO_POR_DEFECTO);
			assert.doesNotThrow(() => recordarAncho(300));
		} finally {
			if (antes) Object.defineProperty(globalThis, "window", antes); else Reflect.deleteProperty(globalThis, "window");
		}
	});
});

let root: Root | null = null;
let restore: (() => void) | null = null;

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

async function montar(guardado?: string) {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const ls = almacen(guardado ? { "estudio:barra:ancho": guardado } : {});
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
		SVGElement: dom.window.SVGElement, ShadowRoot: dom.window.ShadowRoot, IS_REACT_ACT_ENVIRONMENT: true,
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	const restoreModal = installModalDom(dom);
	Object.defineProperty(dom.window, "localStorage", { configurable: true, value: ls });
	Object.assign(dom.window, {
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
		requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
	});
	let plegados = 0;
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => {
		restoreModal();
		for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	};
	await act(async () => {
		root!.render(
			<ProveedorBarraLateral open onToggle={() => { plegados++; }}>
				<Sidebar collapsible="icon"><AsaAnchoBarra /></Sidebar>
			</ProveedorBarraLateral>,
		);
	});
	const asa = dom.document.querySelector<HTMLElement>('[data-slot="asa-ancho-barra"]')!;
	const envoltorio = dom.document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!;
	const ancho = () => /--sidebar-width:\s*([\d.]+)px/.exec(envoltorio.getAttribute("style") ?? "")?.[1];
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new dom.window.Event(tipo, { bubbles: true, cancelable: true }), { button: 0, pointerId: 1, clientX: 0, detail: 1, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
	const lanzar = async (tipo: string, extra?: Record<string, unknown>) => { await act(async () => { asa.dispatchEvent(evento(tipo, extra)); }); };
	return { dom, ls, asa, ancho, lanzar, plegados: () => plegados };
}

const esperar = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

describe("el asa del borde", () => {
	it("arranca con el ancho guardado y es un separador accesible", async () => {
		const p = await montar("320");
		assert.equal(p.ancho(), "320");
		assert.equal(p.asa.getAttribute("role"), "separator");
		assert.equal(p.asa.getAttribute("aria-valuenow"), "320");
	});

	it("arrastrar cambia el ancho, lo limita y lo guarda al soltar; el clic que cierra el arrastre no pliega", async () => {
		const p = await montar();
		assert.equal(p.ancho(), "256");
		await p.lanzar("pointerdown", { clientX: 256 });
		await p.lanzar("pointermove", { clientX: 356 });
		assert.equal(p.ancho(), "356");
		assert.equal(p.ls.datos.get("estudio:barra:ancho"), undefined, "no se guarda a medio arrastre");
		await p.lanzar("pointermove", { clientX: 900 });
		assert.equal(p.ancho(), "480");
		await p.lanzar("pointerup", { clientX: 900 });
		await p.lanzar("click");
		await esperar(300);
		assert.equal(p.ls.datos.get("estudio:barra:ancho"), "480");
		assert.equal(p.plegados(), 0);
	});

	it("un clic sin arrastre pliega la barra; un doble clic vuelve a 256 sin plegarla", async () => {
		const p = await montar("400");
		await p.lanzar("pointerdown", { clientX: 400 });
		await p.lanzar("pointerup", { clientX: 401 });
		await p.lanzar("click");
		await esperar(300);
		assert.equal(p.plegados(), 1);
		assert.equal(p.ancho(), "400");

		await p.lanzar("click", { detail: 1 });
		await p.lanzar("click", { detail: 2 });
		await p.lanzar("dblclick", { detail: 2 });
		await esperar(300);
		assert.equal(p.plegados(), 1, "el doble clic no pliega");
		assert.equal(p.ancho(), "256");
		assert.equal(p.ls.datos.get("estudio:barra:ancho"), "256");
	});

	it("con el asa enfocada, ← y → mueven 16 px y lo guardan", async () => {
		const p = await montar("300");
		await p.lanzar("keydown", { key: "ArrowRight" });
		assert.equal(p.ancho(), "316");
		await p.lanzar("keydown", { key: "ArrowLeft" });
		await p.lanzar("keydown", { key: "ArrowLeft" });
		assert.equal(p.ancho(), "284");
		assert.equal(p.ls.datos.get("estudio:barra:ancho"), "284");
	});
});
