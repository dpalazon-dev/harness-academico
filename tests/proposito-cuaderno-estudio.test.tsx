/**
 * La cabecera del cuaderno con el propósito y la tinta (ticket 12f): una línea discreta con la tinta, el propósito escrito a
 * mano y, al escribir, las propuestas de un clic; «Solo escucha» como elección especial. Pintado en estático y, para el foco, el
 * teclado y los clics, montado sobre linkedom. La tinta pinta el subrayado de la frase y el filo de la tarjeta del margen.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ModoProactivo } from "../components/estudio/modo-proactivo.tsx";
import { PropositoCuaderno, type CambioProposito } from "../components/estudio/proposito-cuaderno.tsx";
import { EditorCuadernoEstudio } from "../components/estudio/editor-cuadernos.tsx";
import { colorDeTinta } from "../components/estudio/tintas.ts";
import { PROPUESTAS_PROPOSITO, SOLO_ESCUCHA, type Cuaderno } from "../components/estudio/cuadernos.ts";

const nada = () => {};
const ESTADO = { tope: 40, usadas: 3, modeloEconomico: true };
const T = "2026-11-17T10:00:00.000Z";
const CUADERNO: Cuaderno = { id: "nb1", revision: 1, title: "Dijkstra", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T, blocks: [] };
const NOTA = { id: "b1", kind: "nota" as const, symbol: null, text: "Funciona siempre que no haya ciclos negativos.", locator: "", quote: "" };
const COMENTARIO = {
	id: "c1", persona: "tutor", kind: "pregunta" as const, state: "abierto" as const, createdAt: T,
	anchor: { blockId: "b1", text: "ciclos negativos", start: 28, end: 44, prefix: "no haya ", suffix: "." },
	thread: [{ id: "m1", role: "tutor" as const, text: "¿Seguro?", at: T }],
};
const VISTA = { estado: ESTADO, leyendo: false, error: null };
const ACCIONES = { cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, cambiarModo: nada, fijarTope: nada };
const editor = (c: Cuaderno, extra: Partial<React.ComponentProps<typeof EditorCuadernoEstudio>> = {}) => renderToStaticMarkup(
	<EditorCuadernoEstudio cuaderno={c} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false} proactivo={VISTA}
		acciones={{ ...ACCIONES, fijarProposito: nada }} {...extra} />,
);
const escapar = (s: string) => s.replace(/[()%]/g, "\\$&");

describe("la cabecera del cuaderno con propósito, pintada", () => {
	it("sin propósito es una línea discreta: el campo vacío con su invitación y ninguna propuesta a la vista", () => {
		const html = editor(CUADERNO);
		assert.match(html, /<input[^>]*aria-label="Propósito del cuaderno"[^>]*placeholder="Para qué es este cuaderno…"/);
		assert.doesNotMatch(html, /Pregúntame antes del examen/, "las propuestas salen al escribir, no ensucian la página");
		assert.doesNotMatch(html, /data-escucha/);
		assert.match(html, /aria-label="Tinta de los comentarios: Acento"/);
		assert.match(html, /aria-label="Página"/);
		assert.equal((html.match(/data-block-id=/g) ?? []).length, 1, "la página sigue limpia: solo el hueco para escribir");
	});

	it("con propósito lo muestra en el campo y no pinta propuestas", () => {
		const html = editor({ ...CUADERNO, proposito: "Preparar el examen de grafos" });
		assert.match(html, /value="Preparar el examen de grafos"/);
		assert.doesNotMatch(html, /data-propuesta/);
	});

	it("«Solo escucha» dice qué hace y es coherente con el interruptor: apagado y «Cuando se lo pido»", () => {
		const html = editor({ ...CUADERNO, proposito: SOLO_ESCUCHA, modo: "a-peticion" });
		assert.match(html, /value="Solo escucha"/);
		assert.match(html, /role="switch"[^>]*aria-checked="false"/);
		assert.match(html, />Cuando se lo pido</);
		assert.match(html, /data-escucha[^>]*>Solo escucha: el tutor no comenta por su cuenta; contesta cuando se lo pides\./);
		assert.doesNotMatch(html, />3 de 40 hoy</, "sin contador de lecturas propias");
	});

	it("sin la acción de propósito la cabecera es la de antes (sin campo)", () => {
		const html = renderToStaticMarkup(
			<EditorCuadernoEstudio cuaderno={CUADERNO} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false} proactivo={VISTA} acciones={ACCIONES} />,
		);
		assert.doesNotMatch(html, /Propósito del cuaderno/);
	});
});

describe("la tinta pinta los comentarios del cuaderno", () => {
	const conComentario = (extra: Partial<Cuaderno> = {}) => editor({ ...CUADERNO, blocks: [NOTA], comments: [COMENTARIO], ...extra });

	it("sin tinta elegida, la del acento; con ella, la elegida, en el contenedor de la página", () => {
		assert.match(conComentario(), new RegExp(`data-notebook-id="nb1"[^>]*--tinta-margen:${escapar(colorDeTinta("acento"))}`));
		const rojo = conComentario({ tinta: "rojo" });
		assert.match(rojo, new RegExp(`--tinta-margen:${escapar(colorDeTinta("rojo"))}`));
		assert.doesNotMatch(rojo, new RegExp(`--tinta-margen:${escapar(colorDeTinta("acento"))}`));
	});

	it("el subrayado y el filo de la tarjeta leen la variable de la tinta, no un color fijo", () => {
		const html = conComentario({ tinta: "verde" });
		assert.match(html, /shadow-\[0_2px_0_0_var\(--tinta-margen\)\]/, "subrayado de la frase");
		assert.match(html, /<article[^>]*border-left-color:var\(--tinta-margen/, "filo de la tarjeta");
		assert.doesNotMatch(html, /--tinta-margen:var\(--tinta-margen/, "sin variable que se refiera a sí misma");
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
	Object.assign(dom.window.HTMLElement.prototype, { focus() {}, attachEvent() {}, detachEvent() {} });
	Object.assign(dom.window.HTMLInputElement.prototype, { select() {} });
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	return { dom };
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

async function pintar(props: Partial<React.ComponentProps<typeof PropositoCuaderno>> = {}) {
	const f = montar();
	const cambios: CambioProposito[] = [];
	await act(async () => { root!.render(<PropositoCuaderno fijar={c => cambios.push(c)} {...props} />); });
	const q = <E extends Element>(sel: string) => f.dom.document.querySelector<E>(sel);
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new f.dom.window.Event(tipo, { bubbles: true, cancelable: true }), { key: "", detail: 1, button: 0, ...extra });
	const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(evento("click")); }); };
	const enfocar = async (el: Element) => { await act(async () => { el.dispatchEvent(evento("focusin")); }); };
	const escribir = async (el: Element, valor: string) => {
		await act(async () => {
			(el as unknown as { value: string }).value = valor;
			el.dispatchEvent(evento("input"));
		});
	};
	const tecla = async (el: Element, key: string) => { await act(async () => { el.dispatchEvent(evento("keydown", { key })); }); };
	return { ...f, cambios, q, clic, enfocar, escribir, tecla, evento };
}

describe("el propósito, montado", () => {
	it("al enfocar el campo salen las cuatro propuestas, en su orden, y «Solo escucha» la última", async () => {
		const f = await pintar();
		assert.equal(f.q("[data-propuestas]"), null);
		await f.enfocar(f.q("input")!);
		const botones = [...f.dom.document.querySelectorAll("[data-propuesta]")].map(b => b.textContent);
		assert.deepEqual(botones, ["Pregúntame antes del examen", "Busca mis errores", "Conéctalo con lo que ya sé", "Solo escucha"]);
		assert.deepEqual(botones, [...PROPUESTAS_PROPOSITO]);
	});

	it("elegir una propuesta rellena la línea y la guarda; David puede seguir editándola", async () => {
		const f = await pintar();
		await f.enfocar(f.q("input")!);
		await f.clic(f.dom.document.querySelectorAll("[data-propuesta]")[1]!);
		assert.deepEqual(f.cambios, [{ proposito: "Busca mis errores" }]);
		const campo = f.q<HTMLInputElement>("input")!;
		assert.equal(campo.value, "Busca mis errores");
		await f.escribir(campo, "Busca mis errores de notación");
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios.at(-1), { proposito: "Busca mis errores de notación" });
	});

	it("Intro guarda lo escrito en una línea; Escape lo deja como estaba; sin cambios no manda nada", async () => {
		const f = await pintar({ proposito: "Repasar" });
		const campo = f.q<HTMLInputElement>("input")!;
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios, [], "igual que lo guardado");
		await f.escribir(campo, "  Preparar   el examen ");
		await f.tecla(campo, "Escape");
		assert.equal(campo.value, "Repasar");
		assert.deepEqual(f.cambios, []);
		await f.escribir(campo, "  Preparar   el examen ");
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios, [{ proposito: "Preparar el examen" }]);
	});

	it("vaciar el campo quita el propósito", async () => {
		const f = await pintar({ proposito: "Repasar" });
		const campo = f.q<HTMLInputElement>("input")!;
		await f.escribir(campo, "   ");
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios, [{ proposito: null }]);
	});

	it("el campo tiene su tope de longitud", () => {
		assert.match(editor(CUADERNO), /<input[^>]*maxLength="200"/i);
	});

	it("con «Solo escucha» elegido, la nota lo cuenta y cambiar de propósito es escribir otro o elegir otra propuesta", async () => {
		const f = await pintar({ proposito: SOLO_ESCUCHA });
		assert.match(f.q("[data-escucha]")!.textContent!, /^Solo escucha: el tutor no comenta por su cuenta/);
		await f.enfocar(f.q("input")!);
		await f.clic(f.dom.document.querySelectorAll("[data-propuesta]")[0]!);
		assert.deepEqual(f.cambios, [{ proposito: "Pregúntame antes del examen" }]);
	});
});

describe("ModoProactivo con la línea del propósito", () => {
	it("el campo del propósito va en la misma línea que el interruptor, y el aviso sigue debajo", () => {
		const html = renderToStaticMarkup(
			<ModoProactivo modo="a-peticion" aviso="tope" estado={{ ...ESTADO, usadas: 40 }} cambiarModo={nada} fijarTope={nada}>
				<PropositoCuaderno fijar={nada} />
			</ModoProactivo>,
		);
		assert.ok(html.indexOf("data-modo-interruptor") < html.indexOf("Propósito del cuaderno"));
		assert.ok(html.indexOf("Propósito del cuaderno") < html.indexOf("data-aviso"));
	});
});
