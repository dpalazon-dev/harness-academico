/**
 * El guardado de la respuesta en la pantalla de intento: estado visible como en Cuadernos («Guardado», «No se pudo
 * guardar: …»), salir solo tras confirmar si falló, «Terminar y comparar» avisando de que la respuesta queda fija y la
 * confianza en %, con sus extremos. Pintado en estático y, para el guardado, montado sobre linkedom con `fetch` falso.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import {
	AVISO_SALIR_SIN_GUARDAR, PantallaConfianzaEstudio, PantallaIntentoEstudio, salirGuardando, useGuardarRespuesta,
} from "../components/estudio/intento.tsx";
import type { LecturaIntento } from "../components/estudio/tipos.ts";

const nada = () => {};
const acciones = { escribir: nada, congelar: nada, pista: nada, verReferencia: nada, abandonar: nada, autoevaluar: nada, discutir: nada, salir: nada };
const ABIERTO: LecturaIntento = {
	titulo: "Caminos mínimos",
	attempt: { id: "a1", unitId: "u1", taskKind: "libre", status: "open", confidence: 60, cueLevel: 1, answer: "Usa una cola", judgments: [], grades: [] },
	prompt: "Explica por qué Dijkstra no admite pesos negativos.", cues: [], reference: null, rubric: null,
};
const intento = (extra: Partial<React.ComponentProps<typeof PantallaIntentoEstudio>> = {}) =>
	renderToStaticMarkup(<PantallaIntentoEstudio intento={ABIERTO} borrador="Usa una cola" aviso={null} ocupado={false} mensaje={null} error={null} acciones={acciones} {...extra} />);

describe("pantalla de intento, pintada", () => {
	it("cuenta cómo va el guardado, y el fallo en rojo con su motivo", () => {
		assert.doesNotMatch(intento(), /data-guardado/, "antes de escribir no dice nada");
		assert.match(intento({ guardado: { tipo: "guardado" } }), /role="status" data-guardado="guardado"[^>]*>Guardado</);
		assert.match(intento({ guardado: { tipo: "guardando" } }), />Guardando…</);
		assert.match(intento({ guardado: { tipo: "sin-guardar" } }), />Sin guardar</);
		assert.match(intento({ guardado: { tipo: "error", motivo: "Estudio no respondió (500)" } }), /data-guardado="error"[^>]*text-destructive[^>]*>No se pudo guardar: Estudio no respondió \(500\)</);
	});

	it("«Terminar y comparar» dice que después ya no se podrá cambiar la respuesta; nada de «congelar»", () => {
		const html = intento();
		assert.match(html, /<button[^>]*aria-describedby="terminar-fija"[^>]*>Terminar y comparar<\/button>/);
		assert.match(html, /id="terminar-fija"[^>]*>Al terminar, la respuesta queda fija: ya no podrás cambiarla\./);
		assert.doesNotMatch(html, /[Cc]ongela/);
	});

	it("la confianza va en %, con sus extremos, y sin «regulador»", () => {
		const html = renderToStaticMarkup(<PantallaConfianzaEstudio titulo="X" confianza={50} ocupado={false} mensaje={null} error={null} acciones={{ cambiar: nada, empezar: nada, salir: nada }} />);
		assert.match(html, />Nada<\/span><input[^>]*aria-valuetext="50 %"[\s\S]*>Seguro<\/span><output[^>]*>50(<!-- -->)? %<\/output>/);
		assert.doesNotMatch(html, /regulador/);
		assert.match(intento(), /Confianza declarada: 60(<!-- -->)? %/);
	});
});

describe("salirGuardando", () => {
	it("si guarda bien, sale sin preguntar", async () => {
		const pasos: string[] = [];
		await salirGuardando(async () => { pasos.push("guardar"); }, () => { pasos.push("preguntar"); return true; }, () => pasos.push("salir"));
		assert.deepEqual(pasos, ["guardar", "salir"]);
	});

	it("si no puede guardar, pregunta y solo sale si David confirma", async () => {
		const falla = async () => { throw new Error("caído"); };
		const preguntas: string[] = [];
		let salio = false;
		await salirGuardando(falla, (t) => { preguntas.push(t); return false; }, () => { salio = true; });
		assert.equal(salio, false);
		assert.deepEqual(preguntas, [AVISO_SALIR_SIN_GUARDAR]);
		await salirGuardando(falla, () => true, () => { salio = true; });
		assert.equal(salio, true);
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

describe("useGuardarRespuesta, montado", () => {
	it("guardar cuenta «Guardando…», «Guardado» o el fallo, y el fallo llega a quien guarda", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		let falla = true;
		const enviadas: unknown[] = [];
		const globals: Record<string, unknown> = {
			window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
			fetch: async (_url: string, init: { body: string }) => {
				enviadas.push(JSON.parse(init.body));
				return falla ? new Response(JSON.stringify({ error: "disco lleno" }), { status: 500 }) : new Response(JSON.stringify({ result: {} }), { status: 200 });
			},
		};
		const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		Object.assign(globalThis, globals);
		restore = () => { for (const [key, d] of saved) { if (d) Object.defineProperty(globalThis, key, d); else Reflect.deleteProperty(globalThis, key); } };

		let api: ReturnType<typeof useGuardarRespuesta> | null = null;
		function Prueba() {
			api = useGuardarRespuesta("a1", true);
			return <span id="estado">{api.guardado?.tipo ?? "nada"}</span>;
		}
		root = createRoot(dom.document.querySelector("#root")!);
		await act(async () => { root!.render(<Prueba />); });
		const estado = () => dom.document.querySelector("#estado")!.textContent;
		await act(async () => { api!.cargar("Usa una cola"); });

		await act(async () => { await api!.guardar(); });
		assert.equal(enviadas.length, 0, "lo leído no se vuelve a guardar");

		await act(async () => { api!.escribir("Usa una cola de prioridad"); });
		assert.equal(estado(), "sin-guardar");
		await act(async () => { await assert.rejects(api!.guardar()); });
		assert.equal(estado(), "error");
		assert.deepEqual(api!.guardado, { tipo: "error", motivo: "disco lleno" });

		await act(async () => { api!.escribir("Usa una cola de prioridad mínima"); });
		assert.equal(estado(), "error", "el fallo no se borra hasta que un guardado salga bien");

		falla = false;
		await act(async () => { await api!.guardar(); });
		assert.equal(estado(), "guardado");
		assert.deepEqual(enviadas.at(-1), { operation: "guardar-respuesta", input: { attemptId: "a1", answer: "Usa una cola de prioridad mínima" } });
	});
});
