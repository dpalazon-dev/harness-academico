import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { corteParaBifurcar, tituloDeRama } from "../src/core/bifurcar.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const m = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, role, content: "", timestamp: 0, ...extra }) as unknown as LhMessage;

describe("bifurcar — corte del historial", () => {
	const historial = [
		m("u1", "user"), m("a1", "assistant"), m("t1", "toolResult"), m("a1b", "assistant"),
		m("u2", "user"), m("a2", "assistant"),
	];
	it("corta al final de la respuesta elegida, con sus herramientas", () => {
		const corte = corteParaBifurcar(historial, "a1");
		assert.deepEqual(corte?.mensajes.map(x => x.id), ["u1", "a1", "t1", "a1b"]);
		assert.equal(corte?.hastaElFinal, false);
	});
	it("la última respuesta se copia entera y lo dice", () => {
		const corte = corteParaBifurcar(historial, "a2");
		assert.equal(corte?.mensajes.length, 6);
		assert.equal(corte?.hastaElFinal, true);
	});
	it("un envío de práctica abre turno como un mensaje del estudiante", () => {
		const practica = [m("a1", "assistant"), m("p1", "custom", { customType: "plugin-problem-submission" }), m("a2", "assistant")];
		assert.deepEqual(corteParaBifurcar(practica, "a1")?.mensajes.map(x => x.id), ["a1"]);
	});
	it("rechaza ids desconocidos y mensajes que no son del tutor", () => {
		assert.equal(corteParaBifurcar(historial, "nada"), null);
		assert.equal(corteParaBifurcar(historial, "u2"), null);
	});
	it("titula la rama sin acumular sufijos", () => {
		assert.equal(tituloDeRama("Regla de la cadena"), "Regla de la cadena (rama)");
		assert.equal(tituloDeRama("Regla de la cadena (rama)"), "Regla de la cadena (rama)");
		assert.equal(tituloDeRama("  "), "Conversación sin título (rama)");
	});
});
