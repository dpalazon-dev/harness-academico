/**
 * La pantalla de intento dedicada del armazón de estudio (ticket 06), pintada
 * en estático: el intento de la lectura del plugin dentro, marcado fuera.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PantallaConfianzaEstudio, PantallaIntentoEstudio, destinoDeVuelta, rutaIntento, rutaPracticar } from "../components/estudio/intento.tsx";
import { sinBarraLateral } from "../components/estudio/barra-lateral.tsx";
import type { LecturaIntento } from "../components/estudio/tipos.ts";

const nada = () => {};
const acciones = { escribir: nada, congelar: nada, pista: nada, verReferencia: nada, abandonar: nada, autoevaluar: nada, discutir: nada, salir: nada };

const ABIERTO: LecturaIntento = {
	titulo: "Caminos mínimos",
	attempt: { id: "a1", unitId: "u1", taskKind: "libre", status: "open", confidence: 60, cueLevel: 1, answer: "Usa una cola", judgments: [], grades: [] },
	prompt: "Explica por qué Dijkstra no admite pesos negativos.",
	cues: ["Piensa en cuándo se fija una distancia."],
	reference: null,
	rubric: null,
};
const CONGELADO: LecturaIntento = {
	...ABIERTO,
	attempt: { ...ABIERTO.attempt, status: "frozen", answer: "Porque no revisa distancias fijadas.", judgments: [{ fidelity: 2, failureType: "precision", rationale: "Le falta el porqué." }] },
	cues: ["c1", "c2", "c3", "c4", "c5"],
	reference: "Porque fija distancias definitivas y un peso negativo podría mejorarlas.",
	rubric: ["Distancias definitivas", "Contraejemplo"],
};

const intento = (i: LecturaIntento, extra: Partial<React.ComponentProps<typeof PantallaIntentoEstudio>> = {}) =>
	renderToStaticMarkup(<PantallaIntentoEstudio intento={i} borrador={i.attempt.answer} aviso={null} ocupado={false} mensaje={null} error={null} acciones={acciones} {...extra} />);

/** Nada que lleve a una fuente ni a otra parte de la app mientras dura el intento. */
function sinFuentes(html: string) {
	for (const fuera of ["Biblioteca", "Abrir la fuente", "/plugins/estudio", "Cuadernos", "data-sidebar", "<a "]) assert.doesNotMatch(html, new RegExp(fuera), fuera);
}

describe("PantallaIntentoEstudio", () => {
	it("las rutas de practicar e intento no pintan la barra lateral; el resto, sí", () => {
		assert.equal(sinBarraLateral("/practicar/u1"), true);
		assert.equal(sinBarraLateral("/intento/a1"), true);
		for (const ruta of ["/", "/unidad/u1", "/chat/c1", "/progreso", null]) assert.equal(sinBarraLateral(ruta), false, String(ruta));
	});

	it("la confianza se declara antes de ver la tarea", () => {
		const html = renderToStaticMarkup(<PantallaConfianzaEstudio titulo="Caminos mínimos" confianza={50} ocupado={false} mensaje={null} error={null} acciones={{ cambiar: nada, empezar: nada, salir: nada }} />);
		assert.match(html, /Caminos mínimos/);
		assert.match(html, /<input[^>]*type="range"[^>]*aria-label="Confianza antes de empezar"/);
		assert.match(html, /<li[^>]*aria-current="step"[^>]*>.*Confianza<\/li>/);
		assert.match(html, />Empezar<\/button>/);
		assert.doesNotMatch(html, /Dijkstra no admite/);
		sinFuentes(html);
	});

	it("mientras prepara la tarea, espera y lo dice", () => {
		const html = renderToStaticMarkup(<PantallaConfianzaEstudio titulo="X" confianza={50} ocupado mensaje="El modelo está preparando la tarea…" error={null} acciones={{ cambiar: nada, empezar: nada, salir: nada }} />);
		assert.match(html, /<button[^>]*disabled=""[^>]*>Empezar/);
		assert.match(html, /El modelo está preparando la tarea…/);
	});

	it("un intento abierto pide la respuesta sin fuente, con pistas y sin referencia", () => {
		const html = intento(ABIERTO);
		assert.match(html, /data-pantalla="intento"/);
		assert.match(html, /<li[^>]*aria-current="step"[^>]*>.*Respuesta<\/li>/);
		assert.match(html, /Confianza declarada: 60/);
		assert.match(html, /Explica por qué Dijkstra no admite pesos negativos\./);
		assert.match(html, /Piensa en cuándo se fija una distancia\./);
		assert.match(html, /<textarea[^>]*aria-label="Tu respuesta"[^>]*>Usa una cola<\/textarea>/);
		for (const boton of ["Congelar respuesta", "Necesito una pista", "Me rindo: ver la referencia", "Abandonar", "Salir y seguir luego"]) assert.match(html, new RegExp(`>${boton}</button>`), boton);
		assert.doesNotMatch(html, /Referencia|Discutir/);
		sinFuentes(html);
	});

	it("con todas las pistas pedidas o tras ver la referencia, esos botones se apagan", () => {
		assert.match(intento({ ...ABIERTO, attempt: { ...ABIERTO.attempt, cueLevel: 5 } }), /disabled=""[^>]*>Necesito una pista/);
		assert.match(intento({ ...ABIERTO, attempt: { ...ABIERTO.attempt, cueLevel: 6 } }), /disabled=""[^>]*>Me rindo: ver la referencia/);
	});

	it("un intento congelado contrasta respuesta y referencia, propone el fallo del modelo y pide la valoración", () => {
		const html = intento(CONGELADO);
		assert.match(html, /<li[^>]*aria-current="step"[^>]*>.*Valoración<\/li>/);
		assert.match(html, /Tu respuesta[\s\S]*Porque no revisa distancias fijadas\./);
		assert.match(html, /Referencia[\s\S]*Porque fija distancias definitivas/);
		assert.match(html, /Contraejemplo/);
		assert.match(html, /Contraste del modelo[\s\S]*Incompleto · fallo de precisión\. Le falta el porqué\./);
		assert.match(html, /<option value="precision" selected="">Precisión<\/option>/);
		for (const f of ["No lo tenía", "Errores importantes", "Incompleto", "Completo"]) assert.match(html, new RegExp(`>${f}</button>`), f);
		assert.doesNotMatch(html, /¿Lo aplicaste\?/);
		assert.doesNotMatch(html, /<textarea/);
		assert.match(html, />.*Discutir con el tutor<\/button>/);
		sinFuentes(html);
	});

	it("un caso aplicado pide también si se aplicó", () => {
		assert.match(intento({ ...CONGELADO, attempt: { ...CONGELADO.attempt, taskKind: "aplicada" } }), /¿Lo aplicaste\?[\s\S]*Sin pistas/);
	});

	it("si el contraste del modelo falló, lo avisa y deja valorar igualmente", () => {
		const html = intento({ ...CONGELADO, attempt: { ...CONGELADO.attempt, judgments: [] } }, { aviso: "No se pudo obtener el contraste del modelo (sin red). Puedes autoevaluar igualmente." });
		assert.match(html, /role="alert"[^>]*>No se pudo obtener el contraste/);
		assert.match(html, />Completo<\/button>/);
	});

	it("un intento valorado muestra la valoración, vuelve a la unidad y se puede discutir", () => {
		const html = intento({ ...CONGELADO, attempt: { ...CONGELADO.attempt, status: "graded", grades: [{ fidelity: 3, use: null, failureType: null }] } });
		assert.match(html, /Tu valoración: Completo\./);
		assert.match(html, />Volver a la unidad<\/button>/);
		assert.match(html, />.*Discutir con el tutor<\/button>/);
		assert.doesNotMatch(html, /aria-label="Fidelidad"/);
	});

	it("lanzado desde el inicio, vuelve al inicio (ticket 07); el destino solo admite rutas de la app", () => {
		const valorado = { ...CONGELADO, attempt: { ...CONGELADO.attempt, status: "graded" as const, grades: [{ fidelity: 3, use: null, failureType: null }] } };
		assert.match(intento(valorado, { volver: "/" }), />Volver al inicio<\/button>/);
		const confianza = renderToStaticMarkup(<PantallaConfianzaEstudio titulo="x" confianza={50} ocupado={false} mensaje={null} error={null} volver="/" acciones={{ cambiar: nada, empezar: nada, salir: nada }} />);
		assert.match(confianza, />Volver al inicio<\/button>/);
		assert.equal(rutaPracticar("u1", { volver: "/" }), "/practicar/u1?volver=%2F");
		assert.equal(rutaIntento("a1", { volver: "/" }), "/intento/a1?volver=%2F");
		assert.equal(rutaIntento("a1"), "/intento/a1");
		for (const fuera of ["//ejemplo.com", "/\\ejemplo.com", "https://ejemplo.com", "javascript:alert(1)", ""]) {
			assert.equal(destinoDeVuelta(fuera), null, fuera);
			assert.equal(rutaIntento("a1", { volver: fuera }), "/intento/a1", fuera);
		}
		assert.equal(destinoDeVuelta("/unidad/u1"), "/unidad/u1");
	});

	it("tras ver la referencia antes de terminar, lo deja dicho", () => {
		assert.match(intento({ ...CONGELADO, attempt: { ...CONGELADO.attempt, cueLevel: 6 } }), /cuenta como no recuperado/);
	});

	it("un intento abandonado no se discute ni se valora", () => {
		const html = intento({ ...ABIERTO, attempt: { ...ABIERTO.attempt, status: "abandoned" } });
		assert.match(html, /Abandonaste este intento/);
		assert.doesNotMatch(html, /Discutir|<textarea|Congelar/);
	});

	it("mientras una operación está en curso, los controles esperan y se dice qué pasa", () => {
		const html = intento(ABIERTO, { ocupado: true, mensaje: "Respuesta congelada. El modelo está preparando el contraste…" });
		assert.match(html, /<textarea[^>]*disabled=""/);
		assert.match(html, /disabled=""[^>]*>Congelar respuesta/);
		assert.match(html, /El modelo está preparando el contraste…/);
	});

	it("no muestra el grafo ni el conmutador de práctica", () => {
		for (const html of [intento(ABIERTO), intento(CONGELADO)]) {
			for (const fuera of ["home-mode-switch", "Graph", "Chains", "new-session-practice"]) assert.doesNotMatch(html, new RegExp(fuera), fuera);
		}
	});
});
