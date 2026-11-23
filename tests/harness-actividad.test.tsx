import React from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { nombreHerramienta } from "../components/actividad.ts";
import { ToolCallCard } from "../components/artifacts/tool-call-card.tsx";
import { ColaMensajes, colaLista, encolar, quitar, textoDeCola } from "../components/cola-mensajes.tsx";

const tarjeta = (state: string, extra: Record<string, unknown> = {}) =>
	renderToStaticMarkup(<ToolCallCard part={{ type: "tool-estudio_estado", state, toolCallId: "t1", input: {}, ...extra } as never} />);

describe("harness — herramientas en líneas con su estado", () => {
	it("nombra en español, también las herramientas desconocidas", () => {
		assert.equal(nombreHerramienta("estudio_estado").enCurso, "Consultando tu plan");
		assert.equal(nombreHerramienta("read").hecho, "Leer archivo");
		assert.equal(nombreHerramienta("mi_plugin__hacer_cosa").hecho, "Hacer cosa");
	});
	it("hecha: tick y el nombre en infinitivo", () => {
		const html = tarjeta("output-available", { output: "ok" });
		assert.match(html, /data-estado-herramienta="hecha"/);
		assert.match(html, /Consultar tu plan/);
	});
	it("en marcha: giro y el paso en gerundio", () => {
		const html = tarjeta("input-available");
		assert.match(html, /data-estado-herramienta="en-marcha"/);
		assert.match(html, /Consultando tu plan…/);
	});
	it("fallida: aviso", () => {
		assert.match(tarjeta("output-error", { errorText: "no" }), /data-estado-herramienta="fallida"/);
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
		const { AvisoRama } = await import("../components/acciones-mensaje.tsx");
		const html = renderToStaticMarkup(<AvisoRama forkedFrom={{ chatId: "chat_a", title: "Regla de la cadena" }} />);
		assert.match(html, /Bifurcada de «Regla de la cadena»/);
		assert.match(html, /href="\/chat\/chat_a"/);
	});
});

describe("harness — mensajes fijados", () => {
	it("la lista enseña una ficha por mensaje y nada si está vacía", async () => {
		const { FijadosConversacion, textoDeMensaje } = await import("../components/acciones-mensaje.tsx");
		assert.equal(renderToStaticMarkup(<FijadosConversacion mensajes={[]} onIr={() => {}} />), "");
		const html = renderToStaticMarkup(<FijadosConversacion mensajes={[{ id: "a1", texto: "Porque cada función escala" }]} onIr={() => {}} />);
		assert.match(html, /Fijados:/);
		assert.match(html, /Porque cada función escala/);
		assert.equal(textoDeMensaje([{ type: "reasoning", text: "x" }, { type: "text", text: "Uno" }, { type: "text", text: "Dos" }]), "Uno\n\nDos");
	});
});
