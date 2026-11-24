/**
 * El menú de espacios de la barra lateral, montado de verdad: el menú de Radix
 * solo existe abierto y en un portal, así que el render estático no lo ve.
 * Recoge lo que la vista antigua de siete pestañas ofrecía sobre los espacios
 * y el armazón no tenía (ticket 11): recuperar un espacio archivado y traer
 * al activo lo que no tiene espacio, y mover el plan a otro espacio. Mismo
 * arreglo de DOM que menu-conversacion-estudio.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { installModalDom } from "./modal-dom.ts";
import type { DatosBarraLateral } from "../components/estudio/barra-lateral.tsx";

// Radix elige sus efectos al importarse: se carga con un DOM, como en el navegador.
const bootstrap = parseHTML("<html><body></body></html>");
const bootstrapGlobals = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window: bootstrap.window, document: bootstrap.document });
const { SidebarProvider } = await import("../components/ui/sidebar.tsx");
const { BarraLateralEstudio } = await import("../components/estudio/barra-lateral.tsx");
for (const [key, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }

let root: Root | null = null;
let restore: (() => void) | null = null;

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	// Desmontado abierto, Radix devuelve el foco en el tick siguiente: que ocurra con el DOM todavía instalado.
	await new Promise(r => setTimeout(r, 0));
	root = null;
	restore?.();
	restore = null;
});

const ESPACIOS: DatosBarraLateral["espacios"] = { areas: [
	{ id: "a1", name: "Grafos", archived: false, revision: 1 },
	{ id: "a2", name: "Doctorado", archived: false, revision: 1 },
	{ id: "a3", name: "Viejo", archived: true, revision: 4 },
], activeAreaId: "a1" };
const PLANES: DatosBarraLateral["planes"] = { planes: [], sinPlan: [] };

async function abrirMenu(datos: Partial<DatosBarraLateral> = {}) {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
		SVGElement: dom.window.SVGElement, ShadowRoot: dom.window.ShadowRoot, IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
		DOMRect: class { x = 0; y = 0; width = 0; height = 0; top = 0; left = 0; right = 0; bottom = 0; static fromRect() { return new this(); } toJSON() {} },
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	const restoreModal = installModalDom(dom);
	Object.assign(dom.window, {
		getSelection: () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 }),
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
	});
	restore = () => {
		restoreModal();
		for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	};
	const llamadas: string[] = [];
	const nada = () => {};
	const acciones = {
		elegirEspacio: nada, crearEspacio: nada, renombrarEspacio: nada, abrirAjustes: nada, navegar: nada, abrirPaleta: nada,
		renombrarConversacion: nada, exportarConversacion: nada, resumirConversacion: nada, borrarConversacion: nada, alternarSeccion: nada, abrirPorDecidir: nada, cambiarFiltros: nada,
		archivarEspacio: (id: string) => { llamadas.push(`archivar ${id}`); },
		recuperarEspacio: (id: string) => { llamadas.push(`recuperar ${id}`); },
		traerSinEspacio: () => { llamadas.push("traer"); },
		crearPlan: (objetivo: string) => { llamadas.push(`plan ${objetivo}`); },
	};
	root = createRoot(dom.document.querySelector("#root")!);
	await act(async () => {
		root!.render(
			<SidebarProvider open onOpenChange={() => {}}>
				<BarraLateralEstudio espacios={ESPACIOS} conversaciones={[]} planes={PLANES} ruta="/" acciones={acciones} {...datos} />
			</SidebarProvider>,
		);
	});
	/** linkedom no tiene KeyboardEvent: un evento con las propiedades que leen React y Radix. */
	const disparador = dom.document.querySelector<HTMLElement>('[data-testid="menu-espacio"]')!;
	await act(async () => {
		disparador.dispatchEvent(Object.assign(new dom.window.Event("keydown", { bubbles: true, cancelable: true }), { key: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }));
	});
	const opciones = () => [...dom.document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
	const opcion = (texto: string) => opciones().find(o => o.textContent === texto);
	/** Abre un submenú como un clic sobre su disparador, que Radix atiende para el tacto. */
	const abrirSubmenu = async (texto: string) => {
		const disparadorSub = dom.document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]');
		const el = [...disparadorSub].find(d => d.textContent?.startsWith(texto));
		assert.ok(el, `submenú «${texto}»`);
		await act(async () => { el.click(); });
	};
	return { dom, llamadas, opciones, opcion, abrirSubmenu };
}

it("lista los espacios archivados aparte, cada uno con «Recuperar», que lo devuelve", async () => {
	const m = await abrirMenu();
	assert.ok(m.dom.document.body.textContent?.includes("Archivados"));
	assert.ok(!m.opciones().some(o => o.textContent === "Viejo"), "un archivado no se elige como espacio");
	await act(async () => { m.opcion("Recuperar «Viejo»")!.click(); });
	assert.deepEqual(m.llamadas, ["recuperar a3"]);
});

it("sin espacios archivados no pinta la sección", async () => {
	const m = await abrirMenu({ espacios: { areas: ESPACIOS!.areas.filter(a => !a.archived), activeAreaId: "a1" } });
	assert.ok(!m.dom.document.body.textContent?.includes("Archivados"));
	assert.ok(!m.opciones().some(o => o.textContent?.startsWith("Recuperar")));
});

it("con un espacio activo, «Traer aquí lo que no tiene espacio» lo pide para ese espacio", async () => {
	const m = await abrirMenu();
	await act(async () => { m.opcion("Traer aquí lo que no tiene espacio")!.click(); });
	assert.deepEqual(m.llamadas, ["traer"]);
});

it("con «Todos» activo no hay adónde traer nada", async () => {
	const m = await abrirMenu({ espacios: { ...ESPACIOS!, activeAreaId: null } });
	assert.equal(m.opcion("Traer aquí lo que no tiene espacio"), undefined);
});

it("el menú de espacios ya no mueve planes: un espacio tiene varios y cada uno se mueve desde su página", async () => {
	const m = await abrirMenu();
	assert.equal(m.dom.document.querySelector('[data-slot="dropdown-menu-sub-trigger"]'), null);
});
