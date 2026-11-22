/**
 * La cabecera del cuaderno con el modo del tutor (ticket 12e): el interruptor «Lee y comenta solo» / «Cuando se lo pido»,
 * el gasto de hoy con su tope editable y el aviso cuando el tutor dejó de comentar solo. Pintado en estático y, para el
 * teclado y los clics, montado sobre linkedom.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ModoProactivo, motivoDelAviso, type ModoProactivoProps } from "../components/estudio/modo-proactivo.tsx";
import { EditorCuadernoEstudio } from "../components/estudio/editor-cuadernos.tsx";
import type { Cuaderno } from "../components/estudio/cuadernos.ts";

const nada = () => {};
const ESTADO = { tope: 40, usadas: 3, modeloEconomico: true };
const modo = (props: Partial<ModoProactivoProps> = {}) => renderToStaticMarkup(
	<ModoProactivo modo="proactivo" estado={ESTADO} cambiarModo={nada} fijarTope={nada} {...props} />,
);

describe("ModoProactivo, pintado", () => {
	it("por defecto dice «Lee y comenta solo», está activado y cuenta lo gastado hoy frente al tope", () => {
		const html = modo();
		assert.match(html, /role="switch"[^>]*aria-checked="true"/);
		assert.match(html, />Lee y comenta solo</);
		assert.match(html, />3 de 40 hoy</);
		assert.doesNotMatch(html, /data-aviso/);
	});

	it("en «Cuando se lo pido» el interruptor está apagado y no enseña el gasto, que no cambia", () => {
		const html = modo({ modo: "a-peticion" });
		assert.match(html, /aria-checked="false"/);
		assert.match(html, />Cuando se lo pido</);
		assert.doesNotMatch(html, /de 40 hoy/);
	});

	it("mientras el tutor lee lo dice", () => {
		assert.match(modo({ leyendo: true }), /role="status"[^>]*>Leyendo…/);
		assert.doesNotMatch(modo(), /Leyendo…/);
	});

	it("con el tope alcanzado avisa, en español, de por qué dejó de comentar solo y deja cambiar el tope", () => {
		const html = modo({ modo: "a-peticion", aviso: "tope", estado: { ...ESTADO, usadas: 40 } });
		assert.match(html, /data-aviso="tope"[^>]*>El tutor alcanzó su tope diario \(40 lecturas/);
		assert.match(html, />Cambiar el tope</);
		assert.match(html, />Cuando se lo pido</);
	});

	it("tras tres fallos seguidos lo cuenta", () => {
		assert.match(modo({ modo: "a-peticion", aviso: "fallos" }), /data-aviso="fallos"[^>]*>El tutor falló tres veces seguidas/);
	});

	it("sin modelo económico avisa y manda a Ajustes, sin enseñar un gasto que no existe", () => {
		const html = modo({ estado: { ...ESTADO, modeloEconomico: false } });
		assert.match(html, /data-aviso="sin-modelo"[^>]*>No hay modelo económico configurado[^<]*Ajustes/);
		assert.doesNotMatch(html, /de 40 hoy/);
	});

	it("un error al cambiar el modo (por ejemplo, el tope agotado) se muestra tal como lo dice el plugin", () => {
		assert.match(modo({ modo: "a-peticion", error: "Hoy el tutor ya leyó 40 veces." }), /data-aviso="error"[^>]*text-destructive[^>]*>Hoy el tutor ya leyó 40 veces\./);
	});

	it("el motivo del aviso: el guardado manda; sin modelo solo cuenta en modo proactivo", () => {
		assert.equal(motivoDelAviso({ modo: "a-peticion", estado: ESTADO, aviso: "tope" }), "tope");
		assert.equal(motivoDelAviso({ modo: "proactivo", estado: { ...ESTADO, modeloEconomico: false } }), "sin-modelo");
		assert.equal(motivoDelAviso({ modo: "a-peticion", estado: { ...ESTADO, modeloEconomico: false } }), null);
		assert.equal(motivoDelAviso({ modo: "proactivo", estado: null }), null);
		assert.equal(motivoDelAviso({ modo: "proactivo", estado: { ...ESTADO, usadas: 40 } }), "tope", "con el tope agotado, aunque el cuaderno aún no se haya apagado");
		assert.equal(motivoDelAviso({ modo: "a-peticion", estado: { ...ESTADO, usadas: 40 } }), null);
	});

	it("con el tope bajado por debajo de lo gastado la cabecera ya dice la verdad: apagado, con su aviso y sin contador", () => {
		const html = modo({ estado: { tope: 1, usadas: 2, modeloEconomico: true } });
		assert.match(html, /aria-checked="false"/);
		assert.match(html, />Cuando se lo pido</);
		assert.match(html, /data-aviso="tope"[^>]*>El tutor alcanzó su tope diario \(1 lectura /);
		assert.doesNotMatch(html, /2 de 1 hoy/);
	});
});

describe("el editor con el modo del tutor", () => {
	const T = "2026-11-17T10:00:00.000Z";
	const CUADERNO: Cuaderno = { id: "nb1", revision: 1, title: "Dijkstra", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T, blocks: [] };
	const editor = (c: Cuaderno, extra: Partial<React.ComponentProps<typeof EditorCuadernoEstudio>> = {}) => renderToStaticMarkup(
		<EditorCuadernoEstudio cuaderno={c} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false}
			acciones={{ cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, cambiarModo: nada, fijarTope: nada }} {...extra} />,
	);

	it("un cuaderno nuevo (sin modo guardado) está en «Lee y comenta solo»", () => {
		assert.match(editor(CUADERNO, { proactivo: { estado: ESTADO, leyendo: false, error: null } }), /aria-checked="true"[\s\S]*Lee y comenta solo/);
	});

	it("el modo guardado en el cuaderno y su aviso mandan sobre el estado", () => {
		const html = editor({ ...CUADERNO, modo: "a-peticion", aviso: "tope" }, { proactivo: { estado: { ...ESTADO, usadas: 40 }, leyendo: false, error: null } });
		assert.match(html, /aria-checked="false"/);
		assert.match(html, /data-aviso="tope"/);
	});

	it("sin la vista del modo proactivo la cabecera es la de siempre, sin interruptor", () => {
		assert.doesNotMatch(editor(CUADERNO), /role="switch"/);
	});

	it("la página sigue siendo solo el título y el texto: el interruptor no añade bloques", () => {
		const html = editor(CUADERNO, { proactivo: { estado: ESTADO, leyendo: false, error: null } });
		assert.match(html, /aria-label="Página"/);
		assert.equal((html.match(/data-block-id=/g) ?? []).length, 1, "solo el hueco para escribir");
	});
});

let root: Root | null = null;
let restore: (() => void) | null = null;

function montar() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
		SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true,
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	const foco: string[] = [];
	Object.assign(dom.window.HTMLElement.prototype, { focus(this: HTMLElement) { foco.push(this.getAttribute("aria-label") ?? this.tagName); }, attachEvent() {}, detachEvent() {} });
	Object.assign(dom.window.HTMLInputElement.prototype, { select() {} });
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	return { dom, foco };
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

async function pintar(props: Partial<ModoProactivoProps> = {}) {
	const f = montar();
	const llamadas: string[] = [];
	await act(async () => {
		root!.render(<ModoProactivo modo="proactivo" estado={ESTADO} cambiarModo={m => llamadas.push(`modo ${m}`)} fijarTope={n => llamadas.push(`tope ${n}`)} {...props} />);
	});
	const q = <E extends Element>(sel: string) => f.dom.document.querySelector<E>(sel);
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new f.dom.window.Event(tipo, { bubbles: true, cancelable: true }), { key: "", detail: 1, button: 0, ...extra });
	const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(evento("click")); }); };
	const tecla = async (el: Element, key: string) => { await act(async () => { el.dispatchEvent(evento("focusin")); el.dispatchEvent(evento("keydown", { key })); }); };
	return { ...f, llamadas, q, clic, tecla, evento };
}

describe("ModoProactivo, montado", () => {
	it("pulsar el interruptor pide cambiar al otro modo", async () => {
		const f = await pintar();
		await f.clic(f.q("[data-modo-interruptor]")!);
		assert.deepEqual(f.llamadas, ["modo a-peticion"]);
	});

	it("apagado, pulsarlo pide volver a «Lee y comenta solo»", async () => {
		const f = await pintar({ modo: "a-peticion" });
		await f.clic(f.q("[data-modo-interruptor]")!);
		assert.deepEqual(f.llamadas, ["modo proactivo"]);
	});

	it("el contador abre el tope; Intro lo guarda", async () => {
		const f = await pintar();
		await f.clic(f.q("[data-tope]")!);
		const campo = f.q<HTMLInputElement>('input[aria-label="Tope diario de lecturas del tutor"]')!;
		assert.ok(campo, "aparece el campo del tope");
		assert.equal(campo.getAttribute("value") ?? campo.value, "40");
		(campo as unknown as { value: string }).value = "25";
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.llamadas, ["tope 25"]);
		assert.equal(f.q('input[aria-label="Tope diario de lecturas del tutor"]'), null, "el campo se cierra");
	});

	it("Escape deja el tope como estaba, aunque el cierre desenfoque el campo", async () => {
		const f = await pintar();
		await f.clic(f.q("[data-tope]")!);
		const campo = f.q<HTMLInputElement>('input[aria-label="Tope diario de lecturas del tutor"]')!;
		(campo as unknown as { value: string }).value = "99";
		await f.tecla(campo, "Escape");
		await act(async () => { campo.dispatchEvent(f.evento("focusout")); });
		assert.deepEqual(f.llamadas, []);
	});

	it("un tope igual al actual, vacío o negativo no se manda", async () => {
		for (const valor of ["40", "", "-3", "2.5"]) {
			const f = await pintar();
			await f.clic(f.q("[data-tope]")!);
			const campo = f.q<HTMLInputElement>('input[aria-label="Tope diario de lecturas del tutor"]')!;
			(campo as unknown as { value: string }).value = valor;
			await f.tecla(campo, "Enter");
			assert.deepEqual(f.llamadas, [], `«${valor}»`);
			await act(async () => { root?.unmount(); });
			root = null;
			restore?.();
			restore = null;
		}
	});

	it("con el aviso del tope, «Cambiar el tope» abre el campo", async () => {
		const f = await pintar({ modo: "a-peticion", aviso: "tope", estado: { ...ESTADO, usadas: 40 } });
		const enlace = [...f.dom.document.querySelectorAll("button")].find(b => b.textContent === "Cambiar el tope")!;
		await f.clic(enlace);
		assert.ok(f.q('input[aria-label="Tope diario de lecturas del tutor"]'));
	});
});

describe("ModoProactivo con el tope agotado", () => {
	it("el cuaderno se ve apagado pero sigue guardado como proactivo: pulsar lo deja apagado de verdad", async () => {
		const f = await pintar({ estado: { tope: 1, usadas: 2, modeloEconomico: true } });
		assert.equal(f.q("[data-modo-interruptor]")!.getAttribute("aria-checked"), "false");
		await f.clic(f.q("[data-modo-interruptor]")!);
		assert.deepEqual(f.llamadas, ["modo a-peticion"]);
	});
});

describe("salir de «Solo escucha» sin poder volver a leer", () => {
	it("el aviso guardado dice por qué el tutor sigue sin comentar solo", () => {
		const html = renderToStaticMarkup(<ModoProactivo modo="a-peticion" aviso="sin-modelo" estado={{ tope: 40, usadas: 0, modeloEconomico: false }} cambiarModo={nada} fijarTope={nada} />);
		assert.match(html, /data-aviso="sin-modelo"[^>]*>No hay modelo económico configurado[^<]*Ajustes/);
		assert.match(html, />Cuando se lo pido</);
	});
});
