/**
 * ⌘K pintada (ticket 08): la paleta es una pieza pura (datos y resultados
 * dentro, marcado fuera). El render estático fija sus grupos, que cada
 * resultado lleva a su sitio, el modo limitado a conversaciones (⌘⇧F), el
 * formulario de unidad nueva, el botón de la barra lateral, que ⌘K abre la
 * paleta y que no existe en las pantallas de intento.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarProvider } from "../components/ui/sidebar.tsx";
import { BarraLateralEstudio } from "../components/estudio/barra-lateral.tsx";
import { ContenidoPaleta, FormularioUnidad, coincide, rutaDeDestino, type BusquedaPaleta, type DatosPaleta, type ModoPaleta } from "../components/estudio/paleta.tsx";
import { sinBarraLateral } from "../components/estudio/barra-lateral.tsx";
import { actionForBinding, KEYBOARD_ACTIONS } from "../src/core/keyboard.ts";

const nada = () => {};

const DATOS: DatosPaleta = {
	paso: { tipo: "volcado", accion: "Escribe lo que ya sabes", motivo: "Sin volcado inicial no podrás ver después qué cambió.", boton: "Escribir el volcado", unitId: "u1", titulo: "Caminos mínimos" },
	unidades: [
		{ id: "u1", titulo: "Caminos mínimos", propuesta: false },
		{ id: "u2", titulo: "Árboles de expansión", propuesta: false },
		{ id: "u3", titulo: "Planaridad", propuesta: true },
	],
	fuentes: Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, titulo: `Documento ${i}` })),
	conversaciones: [{ id: "c1", titulo: "Dijkstra paso a paso" }],
	unidadActual: null,
};

const BUSQUEDA: BusquedaPaleta = {
	vacio: null,
	grupos: [
		{ tipo: "conocimiento", resultados: [
			{ id: "HE-1", titulo: "Dijkstra no admite pesos negativos", fragmento: "con pesos negativos falla", pagina: 4, destino: { tipo: "documento", documentId: "d1", pagina: 4 } },
			{ id: "ENT-1", titulo: "Dijkstra", fragmento: "algoritmo", pagina: null, destino: null },
		] },
		{ tipo: "documento", resultados: [{ id: "documento:d1#s=2", titulo: "Grafos › 2 Caminos", fragmento: "El algoritmo de Dijkstra…", pagina: 12, destino: { tipo: "documento", documentId: "d1", pagina: 12 } }] },
		{ tipo: "nota", resultados: [{ id: "cuaderno:n1", titulo: "Notas de Dijkstra", fragmento: "I cola de prioridad", pagina: null, destino: { tipo: "unidad", unitId: "u1" } }] },
		{ tipo: "conversacion", resultados: [{ id: "conversacion:c1", titulo: "Dijkstra paso a paso", fragmento: "relajación", pagina: null, destino: { tipo: "conversacion", chatId: "c1" } }] },
	],
};

function paleta(props: { modo?: ModoPaleta; consulta?: string; datos?: DatosPaleta | null; busqueda?: BusquedaPaleta | null; buscando?: boolean; error?: string | null } = {}) {
	return renderToStaticMarkup(
		<ContenidoPaleta
			modo={props.modo ?? "todo"}
			consulta={props.consulta ?? ""}
			onConsulta={nada}
			datos={props.datos === undefined ? DATOS : props.datos}
			busqueda={props.busqueda ?? null}
			buscando={props.buscando ?? false}
			error={props.error}
			onElegir={nada}
		/>,
	);
}

const encabezados = (html: string) => [...html.matchAll(/cmdk-group-heading=""[^>]*>([^<]+)</g)].map(m => m[1]);

describe("ContenidoPaleta", () => {
	it("sin consulta empieza por el paso propuesto y ofrece unidades, fuentes y acciones", () => {
		const html = paleta();
		assert.deepEqual(encabezados(html), ["Siguiente paso", "Unidades", "Fuentes", "Acciones"]);
		assert.match(html, /Escribe lo que ya sabes · Caminos mínimos/);
		assert.match(html, /Sin volcado inicial no podrás ver después qué cambió\./);
		assert.match(html, /Preguntar al tutor</);
		assert.match(html, /Nueva unidad/);
		assert.match(html, /Nuevo cuaderno</, "ticket 09");
		assert.equal((html.match(/>Documento \d</g) ?? []).length, 5, "sin consulta, solo las primeras fuentes");
		assert.match(html, /italic[^"]*">Planaridad/, "la unidad propuesta se distingue");
	});

	it("con consulta añade los resultados del plugin agrupados por tipo, con su página", () => {
		const html = paleta({ consulta: "dijkstra", busqueda: BUSQUEDA });
		assert.deepEqual(encabezados(html), ["Conocimiento", "Documentos", "Notas", "Conversaciones"]);
		assert.match(html, /Grafos › 2 Caminos/);
		assert.match(html, /p\. 12/);
		assert.match(html, /p\. 4/);
		assert.match(html, /sin página/);
		assert.match(html, /data-disabled="true"[^>]*>(?:(?!data-slot="command-item")[\s\S])*?block truncate">Dijkstra</, "sin destino no se puede elegir");
		assert.equal((html.match(/data-disabled="true"/g) ?? []).length, 1);
	});

	it("filtra lo local por todas las palabras, sin acentos ni mayúsculas", () => {
		const html = paleta({ consulta: "arboles" });
		assert.match(html, /Árboles de expansión/);
		assert.doesNotMatch(html, />Caminos mínimos</);
		assert.doesNotMatch(html, /Siguiente paso/);
		assert.equal(coincide("CAMINOS min", "Caminos mínimos"), true);
		assert.equal(coincide("caminos grafos", "Caminos mínimos"), false);
	});

	it("en una unidad, preguntar al tutor la lleva como contexto", () => {
		const html = paleta({ datos: { ...DATOS, unidadActual: { id: "u2", titulo: "Árboles de expansión" } } });
		assert.match(html, /Preguntar al tutor sobre «Árboles de expansión»/);
		assert.match(html, /Nuevo cuaderno para «Árboles de expansión»/, "el cuaderno nace vinculado a la unidad");
	});

	it("limitada a conversaciones (⌘⇧F) no ofrece acciones ni unidades: recientes sin consulta, resultados con ella", () => {
		const recientes = paleta({ modo: "conversaciones" });
		assert.deepEqual(encabezados(recientes), ["Conversaciones recientes"]);
		assert.match(recientes, /placeholder="Busca en tus conversaciones"/);
		const con = paleta({ modo: "conversaciones", consulta: "dijkstra", busqueda: { vacio: null, grupos: [BUSQUEDA.grupos[3]!] } });
		assert.deepEqual(encabezados(con), ["Conversaciones"]);
		assert.doesNotMatch(con, /Nueva unidad|Nuevo cuaderno|Preguntar al tutor/);
	});

	it("dice cuándo busca, cuándo no hay nada y por qué falla", () => {
		assert.match(paleta({ datos: null }), /role="status"[^>]*>Cargando…/);
		assert.match(paleta({ consulta: "dijkstra", buscando: true }), /Buscando en lo estudiado…/);
		assert.match(paleta({ consulta: "zzz", busqueda: { vacio: "sin_coincidencias", grupos: [] } }), /Nada con ese texto en este espacio\./);
		assert.match(paleta({ error: "Estudio no responde" }), /role="alert"[^>]*>Estudio no responde/);
	});

	it("enseña cómo se maneja con teclado", () => {
		const html = paleta();
		assert.match(html, /moverse/);
		assert.match(html, /Esc<\/kbd> cerrar/);
	});
});

describe("rutaDeDestino", () => {
	it("cada resultado va a su sitio: página del documento, unidad, conversación", () => {
		assert.equal(rutaDeDestino({ tipo: "documento", documentId: "d1", pagina: 12 }), "/biblioteca/d1?pagina=12");
		assert.equal(rutaDeDestino({ tipo: "documento", documentId: "d1", pagina: null }), "/biblioteca/d1");
		assert.equal(rutaDeDestino({ tipo: "unidad", unitId: "u1" }), "/unidad/u1");
		assert.equal(rutaDeDestino({ tipo: "conversacion", chatId: "chat_1" }), "/chat/chat_1");
		assert.equal(rutaDeDestino({ tipo: "cuaderno", notebookId: "n1" }), "/cuadernos/n1", "un cuaderno suelto abre su editor (ticket 09)");
	});
});

describe("FormularioUnidad", () => {
	it("pide título, capacidad y criterio, como el formulario «Nueva unidad»", () => {
		const html = renderToStaticMarkup(<FormularioUnidad enviando={false} onCrear={nada} onVolver={nada} />);
		assert.match(html, /Título/);
		assert.match(html, /Qué quiero poder hacer/);
		assert.match(html, /Cómo sabré que lo puedo hacer/);
		assert.match(html, /Crear unidad/);
		assert.match(html, /Volver/);
	});
});

describe("⌘K en el armazón", () => {
	it("⌘K abre la paleta y ⌘⇧F sigue siendo buscar conversaciones", () => {
		assert.equal(actionForBinding("mod+k"), "command-palette");
		assert.equal(actionForBinding("mod+shift+f"), "sessions-search");
		assert.equal(new Set(KEYBOARD_ACTIONS.filter(a => !a.displayOnly).map(a => a.binding)).size, KEYBOARD_ACTIONS.filter(a => !a.displayOnly).length, "ningún atajo repetido");
	});

	it("no existe en las pantallas de intento", () => {
		assert.equal(sinBarraLateral("/practicar/u1"), true);
		assert.equal(sinBarraLateral("/intento/a1"), true);
		assert.equal(sinBarraLateral("/unidad/u1"), false);
	});

	it("la barra lateral ofrece el botón con su atajo", () => {
		const html = renderToStaticMarkup(
			<SidebarProvider open onOpenChange={nada}>
				<BarraLateralEstudio
					espacios={{ areas: [], activeAreaId: null }} conversaciones={[]} plan={{ plan: null, unidades: [] }} ruta="/" atajoPaleta="Ctrl+K"
					acciones={{ elegirEspacio: nada, crearEspacio: nada, renombrarEspacio: nada, archivarEspacio: nada, recuperarEspacio: nada, traerSinEspacio: nada, moverPlan: nada, abrirAjustes: nada, navegar: nada, abrirPaleta: nada, renombrarConversacion: nada, exportarConversacion: nada, resumirConversacion: nada, borrarConversacion: nada, alternarSeccion: nada, abrirPorDecidir: nada, cambiarFiltros: nada }}
				/>
			</SidebarProvider>,
		);
		assert.match(html, /data-testid="abrir-paleta"/);
		assert.match(html, /Buscar o hacer…/);
		assert.match(html, /<kbd[^>]*>Ctrl\+K<\/kbd>/);
	});
});
