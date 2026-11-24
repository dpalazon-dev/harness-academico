/**
 * Cómo se presenta el tutor (23-nov-2026): la etiqueta del agente en cada respuesta, la charla de una conversación
 * libre hasta «Empezar», las fichas en español de las instrucciones y lo que aporta Estudio.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { agenteDelMensaje, charlaEnCurso } from "../components/estudio/presentacion.ts";
import { cadenaDeAgente, FICHAS_INSTRUCCIONES, fichaInstruccion } from "../components/estudio/instrucciones-sistema.ts";
import { ListaAportacion, type Aportacion } from "../components/estudio/aportacion.tsx";
import { listSourceSegments } from "../src/agent/prompt-segments.ts";

const usuario = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });
const tutor = (...types: string[]) => ({ role: "assistant", parts: [{ type: "text", text: "Hola." }, ...types.map((type) => ({ type }))] });

describe("la etiqueta del agente", () => {
	it("cuenta la fase de antes del mensaje: el que cierra el sondeo aún es del Sondeador", () => {
		const fases = ["probe", "probe", "plan", "plan", "teach"] as const;
		assert.deepEqual([0, 1, 2, 3, 4].map((mi) => agenteDelMensaje(fases, mi)), ["Sondeador", "Sondeador", "Sondeador", "Tutor", "Tutor"]);
	});
	it("en una sesión de práctica siempre es Práctica", () => {
		assert.equal(agenteDelMensaje(["probe"], 0, "practice"), "Práctica");
	});
});

describe("la charla antes de empezar", () => {
	it("sigue mientras el tutor solo conversa", () => {
		assert.equal(charlaEnCurso([usuario("hola"), tutor()]), true);
		assert.equal(charlaEnCurso([usuario("hola"), tutor("tool-estudio_estado")]), true);
	});
	it("no hay botón antes de la primera respuesta", () => {
		assert.equal(charlaEnCurso([]), false);
		assert.equal(charlaEnCurso([usuario("hola")]), false);
	});
	it("termina con «Empezar», escrito como sea", () => {
		assert.equal(charlaEnCurso([usuario("hola"), tutor(), usuario("  empezar ")]), false);
	});
	it("termina en cuanto el tutor pregunta, aunque lo pidiera con palabras", () => {
		for (const tipo of ["tool-ask_user_question", "tool-quiz", "tool-explain", "tool-probe_done"]) {
			assert.equal(charlaEnCurso([usuario("enséñame derivadas"), tutor(tipo)]), false, tipo);
		}
		assert.equal(charlaEnCurso([usuario("x"), { role: "assistant", parts: [{ type: "tool-plugin", pluginQuestion: {} }] }]), false);
	});
	it("no aplica a conversaciones con contexto ni a la práctica", () => {
		assert.equal(charlaEnCurso([{ role: "user", parts: [{ type: "data-study-context" }] }, usuario("hola"), tutor()]), false);
		assert.equal(charlaEnCurso([usuario("hola"), tutor()], "practice"), false);
	});
});

describe("las fichas de las instrucciones", () => {
	it("todo fragmento del núcleo tiene nombre y propósito en español", () => {
		const rutas = new Set((["teacher", "prober", "practice"] as const).flatMap((a) => listSourceSegments(a).map((s) => s.path)));
		for (const ruta of rutas) {
			const ficha = FICHAS_INSTRUCCIONES[ruta];
			assert.ok(ficha && ficha.nombre && ficha.proposito, ruta);
		}
		assert.deepEqual(Object.keys(FICHAS_INSTRUCCIONES).filter((r) => !rutas.has(r)), [], "fichas de fragmentos que ya no existen");
	});
	it("la tarjeta de un agente encadena sus instrucciones en orden, con las de Estudio al final", () => {
		const estudio = [{ nombre: "Arranque y encuadre", agentes: ["prober"] }, { nombre: "Dónde lo dejaste", agentes: ["prober", "teacher"] }];
		assert.deepEqual(cadenaDeAgente(["system-prompt.md", "prober/10-probe-doctrine.md"], estudio, "prober"), [
			{ nombre: "Base del tutor", deEstudio: false },
			{ nombre: "Cómo sondea", deEstudio: false },
			{ nombre: "Arranque y encuadre", deEstudio: true },
			{ nombre: "Dónde lo dejaste", deEstudio: true },
		]);
		assert.deepEqual(cadenaDeAgente(["practice/00-base.md"], estudio, "practice").map((p) => p.nombre), ["Base de la práctica"]);
	});
	it("un fragmento sin ficha se muestra con su ruta", () => {
		assert.deepEqual(fichaInstruccion("shared/99-nuevo.md"), { nombre: "shared/99-nuevo.md", proposito: "" });
	});
});

describe("lo que aporta Estudio", () => {
	const aportacion: Aportacion = {
		instrucciones: [{ id: "cierre-de-bloque", nombre: "Cierre de bloque", proposito: "Tú reconstruyes.", agentes: ["prober", "teacher"] }],
		herramientas: [{ nombre: "estudio_estado", descripcion: "Lee tu plan." }],
	};
	it("pinta instrucciones con sus agentes y herramientas", () => {
		const html = renderToStaticMarkup(<ListaAportacion aportacion={aportacion} />);
		assert.match(html, /Cierre de bloque/);
		assert.match(html, /Las usa: Sondeador y Tutor/);
		assert.match(html, /estudio_estado/);
		assert.match(html, /Herramientas que da al tutor/);
	});
	it("en Ajustes › Instrucciones solo pinta las instrucciones", () => {
		const html = renderToStaticMarkup(<ListaAportacion aportacion={aportacion} soloInstrucciones />);
		assert.match(html, /Cierre de bloque/);
		assert.doesNotMatch(html, /estudio_estado/);
	});
});
