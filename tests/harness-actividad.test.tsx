import React from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { agruparActividad, cabeceraActividad, nombreHerramienta } from "../components/actividad.ts";
import { ActividadTurno } from "../components/actividad-turno.tsx";
import { ColaMensajes, colaLista, encolar, quitar, textoDeCola } from "../components/cola-mensajes.tsx";

type P = { type: string; state?: string; errorText?: string };
const silenciosa = (p: P) => !["tool-quiz", "tool-demo"].includes(p.type);
const tipos = (segs: ReturnType<typeof agruparActividad<P>>) =>
	segs.map(s => (s.tipo === "actividad" ? `[${s.partes.map(x => x.parte.type).join(",")}]` : s.parte.type));

describe("harness — agrupar la actividad de un turno", () => {
	it("pliega herramientas silenciosas seguidas, con los pasos que caen entre ellas", () => {
		const partes: P[] = [
			{ type: "step-start" }, { type: "tool-read" }, { type: "step-start" }, { type: "tool-grep" },
			{ type: "step-start" }, { type: "text" },
		];
		assert.deepEqual(tipos(agruparActividad(partes, silenciosa)), ["step-start", "[tool-read,step-start,tool-grep]", "step-start", "text"]);
	});
	it("deja fuera del bloque lo que el estudiante tiene que ver", () => {
		const partes: P[] = [{ type: "tool-read" }, { type: "tool-quiz" }, { type: "tool-ls" }, { type: "tool-demo" }];
		assert.deepEqual(tipos(agruparActividad(partes, silenciosa)), ["[tool-read]", "tool-quiz", "[tool-ls]", "tool-demo"]);
	});
	it("sin herramientas no cambia nada", () => {
		const partes: P[] = [{ type: "step-start" }, { type: "reasoning" }, { type: "text" }];
		assert.deepEqual(tipos(agruparActividad(partes, silenciosa)), ["step-start", "reasoning", "text"]);
	});
	it("nombra en español, también las herramientas desconocidas", () => {
		assert.equal(nombreHerramienta("estudio_estado").enCurso, "Consultando tu plan");
		assert.equal(nombreHerramienta("read").hecho, "Leer archivo");
		assert.equal(nombreHerramienta("mi_plugin__hacer_cosa").hecho, "Hacer cosa");
	});
	it("la cabecera dice el paso en curso mientras el turno vive y resume al terminar", () => {
		const partes: P[] = [{ type: "tool-read", state: "output-available" }, { type: "tool-read", state: "output-available" }, { type: "tool-estudio_estado", state: "input-available" }];
		assert.deepEqual(cabeceraActividad(partes, true), { enCurso: true, texto: "Consultando tu plan…", pasos: 3 });
		// Turno terminado (p. ej. detenido): nunca queda un gerundio colgado.
		assert.deepEqual(cabeceraActividad(partes, false), { enCurso: false, texto: "Leer archivo ×2 · Consultar tu plan", pasos: 3 });
	});
	it("el bloque se pinta plegado, con resumen y recuento", () => {
		const html = renderToStaticMarkup(
			<ActividadTurno partes={[{ type: "tool-read", state: "output-available" }]} turnoVivo={false}><span>dentro</span></ActividadTurno>,
		);
		assert.match(html, /Leer archivo/);
		assert.match(html, /1 paso/);
		assert.doesNotMatch(html, /dentro/);
	});
});

describe("harness — cola de mensajes", () => {
	it("encola, quita y junta en un solo mensaje", () => {
		let cola = encolar([], "  Y pon un ejemplo  ", "a");
		cola = encolar(cola, "   ", "b");
		cola = encolar(cola, "con seno", "c");
		assert.deepEqual(cola.map(m => m.id), ["a", "c"]);
		assert.equal(textoDeCola(cola), "Y pon un ejemplo\n\ncon seno");
		assert.deepEqual(quitar(cola, "a").map(m => m.id), ["c"]);
	});
	it("solo se envía con el turno terminado y nada pendiente", () => {
		const base = { ocupado: false, pendiente: false, compactando: false, enviando: false };
		assert.equal(colaLista(base), true);
		for (const k of ["ocupado", "pendiente", "compactando", "enviando"] as const) assert.equal(colaLista({ ...base, [k]: true }), false);
	});
	it("pinta cada mensaje con sus acciones y nada si está vacía", () => {
		assert.equal(renderToStaticMarkup(<ColaMensajes cola={[]} onEditar={() => {}} onQuitar={() => {}} />), "");
		const html = renderToStaticMarkup(<ColaMensajes cola={[{ id: "a", texto: "Y pon un ejemplo" }]} onEditar={() => {}} onQuitar={() => {}} />);
		assert.match(html, /En cola/);
		assert.match(html, /Editar el mensaje en cola/);
		assert.match(html, /Quitar el mensaje de la cola/);
	});
});

describe("harness — aviso de rama", () => {
	it("dice de qué conversación salió y enlaza al original", async () => {
		const { AvisoRama } = await import("../components/bifurcar-mensaje.tsx");
		const html = renderToStaticMarkup(<AvisoRama forkedFrom={{ chatId: "chat_a", title: "Regla de la cadena" }} />);
		assert.match(html, /Bifurcada de «Regla de la cadena»/);
		assert.match(html, /href="\/chat\/chat_a"/);
	});
});
