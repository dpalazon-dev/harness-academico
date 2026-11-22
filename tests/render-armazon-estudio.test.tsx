/**
 * El armazón de estudio pintado (ticket 01): barra lateral e inicio son
 * piezas puras (datos dentro, marcado fuera), así que el render estático
 * fija qué secciones aparecen y que el grafo y el conmutador de práctica
 * del núcleo ya no están. Mismo arreglo de JSX clásico que render-sidebar.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarProvider } from "../components/ui/sidebar.tsx";
import { BarraLateralEstudio, RUTA_PROGRESO, type DatosBarraLateral } from "../components/estudio/barra-lateral.tsx";
import { recordarPlegadas, seccionesPlegadas } from "../components/estudio/secciones.ts";
import { InicioEstudio } from "../components/estudio/inicio.tsx";
import { agruparPorFecha } from "../components/estudio/conversaciones.ts";
import { ActivitySection } from "../components/activity-dock.tsx";
import type { LecturaInicio } from "../components/estudio/tipos.ts";

const AHORA = new Date("2026-11-12T18:00:00");
const nada = () => {};
const acciones = {
	elegirEspacio: nada, crearEspacio: nada, renombrarEspacio: nada, archivarEspacio: nada, recuperarEspacio: nada, traerSinEspacio: nada, moverPlan: nada,
	abrirAjustes: nada, navegar: nada, abrirPaleta: nada,
	renombrarConversacion: nada, exportarConversacion: nada, resumirConversacion: nada, borrarConversacion: nada, alternarSeccion: nada, abrirPorDecidir: nada, cambiarFiltros: nada,
};

function barra(datos: Partial<DatosBarraLateral> = {}, abierta = true) {
	return renderToStaticMarkup(
		<SidebarProvider open={abierta} onOpenChange={nada}>
			<BarraLateralEstudio
				espacios={{ areas: [
					{ id: "a1", name: "Grafos", archived: false },
					{ id: "a2", name: "Viejo", archived: true },
				], activeAreaId: "a1" }}
				conversaciones={[
					{ id: "c1", title: "Qué es un grafo", updatedAt: "2026-11-12T10:00:00", origen: "libre", unidad: null, plan: null },
					{ id: "c2", title: "Caminos mínimos", updatedAt: "2026-11-11T10:00:00", origen: "libre", unidad: null, plan: null },
				]}
				plan={{ plan: { id: "p1", objetivo: "Dominar grafos" }, unidades: [
					{ id: "u1", titulo: "Recorridos", propuesta: false, fueraDelPlan: false, ciclo: { orientar: "hecho", exponer: "pendiente", reconstruir: "vacio", mantener: "vacio" } },
					{ id: "u2", titulo: "Flujo máximo", propuesta: true, fueraDelPlan: true, ciclo: { orientar: "pendiente", exponer: "vacio", reconstruir: "vacio", mantener: "vacio" } },
				] }}
				ruta="/"
				ahora={AHORA}
				acciones={acciones}
				{...datos}
			/>
		</SidebarProvider>,
	);
}

describe("agruparPorFecha", () => {
	it("agrupa en Hoy, Ayer, Últimos 7 días y Antes, de la más reciente a la más antigua", () => {
		const grupos = agruparPorFecha([
			{ id: "viejo", title: "v", updatedAt: "2026-10-01T09:00:00", origen: "libre", unidad: null, plan: null },
			{ id: "hoy-temprano", title: "h1", updatedAt: "2026-11-12T08:00:00", origen: "libre", unidad: null, plan: null },
			{ id: "ayer", title: "a", updatedAt: "2026-11-11T23:30:00", origen: "libre", unidad: null, plan: null },
			{ id: "hoy-tarde", title: "h2", updatedAt: "2026-11-12T17:00:00", origen: "libre", unidad: null, plan: null },
			{ id: "semana", title: "s", updatedAt: "2026-11-07T12:00:00", origen: "libre", unidad: null, plan: null },
		], AHORA);
		assert.deepEqual(grupos.map(g => [g.etiqueta, g.conversaciones.map(c => c.id)]), [
			["Hoy", ["hoy-tarde", "hoy-temprano"]],
			["Ayer", ["ayer"]],
			["Últimos 7 días", ["semana"]],
			["Antes", ["viejo"]],
		]);
	});

	it("omite los grupos vacíos", () => {
		const grupos = agruparPorFecha([{ id: "x", title: "x", updatedAt: "2026-11-12T08:00:00", origen: "libre", unidad: null, plan: null }], AHORA);
		assert.deepEqual(grupos.map(g => g.etiqueta), ["Hoy"]);
	});
});

describe("BarraLateralEstudio", () => {
	it("muestra el espacio activo como menú, Inicio, las conversaciones por fecha, Progreso y Ajustes", () => {
		const html = barra();
		assert.match(html, /data-testid="menu-espacio"/);
		assert.match(html, /Grafos/);
		assert.match(html, /Inicio/);
		assert.match(html, /Conversaciones/);
		assert.match(html, /Hoy/);
		assert.match(html, /Qué es un grafo/);
		assert.match(html, /Ayer/);
		assert.match(html, /Caminos mínimos/);
		assert.match(html, /Progreso/);
		assert.match(html, /Ajustes/);
	});

	it("cada conversación lleva su botón de «más» para el menú (ticket 12)", () => {
		const html = barra();
		assert.match(html, /aria-label="Más acciones de «Qué es un grafo»"/);
		assert.match(html, /aria-label="Más acciones de «Caminos mínimos»"/);
		assert.equal(html.match(/data-testid="conversacion-mas"/g)?.length, 2);
		// El menú solo existe abierto: cerrado no se pinta.
		assert.doesNotMatch(html, /data-testid="menu-conversacion"/);
	});

	it("la actividad en segundo plano va abajo, encima de Progreso y Ajustes, y se oculta con la barra plegada (ticket 12)", () => {
		const html = barra();
		const actividad = html.indexOf('data-testid="activity-section"');
		assert.ok(actividad > 0, "la sección del núcleo está en la barra");
		assert.ok(actividad > html.indexOf("Conversaciones") && actividad < html.indexOf("Progreso"), "entre las conversaciones y Progreso");
		assert.ok(html.indexOf("Progreso") < html.indexOf("Ajustes"));
		// Vacía, solo su cabecera; plegada a iconos, su contenedor se oculta.
		assert.match(html, /<div class="-mx-2 group-data-\[collapsible=icon\]:hidden"><section data-testid="activity-section"/);
		assert.doesNotMatch(html, /data-testid="activity-blob-/);
		assert.match(barra({}, false), /group-data-\[collapsible=icon\]:hidden"><section data-testid="activity-section"/);
	});

	it("la actividad se llena con los procesos en marcha", () => {
		const html = renderToStaticMarkup(
			<ActivitySection feed={{
				jobs: [], pluginWorkers: [],
				extractions: [{ id: "x1", chatId: "c1", title: "Qué es un grafo", phase: "extracting", startedAt: Date.now() - 5000 }],
			}} />,
		);
		assert.match(html, /data-testid="activity-blob-extraction"/);
		assert.match(html, /Qué es un grafo/);
	});

	it("con «Todos» activo lo dice en la cabecera", () => {
		const html = barra({ espacios: { areas: [{ id: "a1", name: "Grafos", archived: false }], activeAreaId: null } });
		assert.match(html, /Todos los espacios/);
	});

	it("sin conversaciones en el espacio lo dice", () => {
		assert.match(barra({ conversaciones: [] }), /Aún no hay conversaciones en este espacio/);
	});

	it("marca la conversación abierta", () => {
		assert.match(barra({ ruta: "/chat/c2" }), /data-active="true"[^>]*>[\s\S]*?Caminos mínimos/);
	});

	it("no ofrece las puertas del núcleo: ni grafo, ni enseñar ni practicar", () => {
		const html = barra();
		for (const fuera of ["new-session-practice", "Practice", "Teaching", "session-kind-filter", "Graph", "Chains"]) {
			assert.doesNotMatch(html, new RegExp(fuera), fuera);
		}
	});

	it("se pliega a iconos y ofrece el botón para hacerlo", () => {
		assert.match(barra({}, false), /data-collapsible="icon"/);
		assert.match(barra(), /data-sidebar="trigger"/);
	});

	it("pinta el plan en orden, cada unidad con la barra de su ciclo, y marca las propuestas", () => {
		const html = barra();
		assert.match(html, />Plan</);
		assert.match(html, /Recorridos[\s\S]*Flujo máximo/);
		assert.match(html, /aria-label="Orientar: Hecho, Exponer y capturar: Pendiente, Reconstruir y contrastar: Sin empezar, Mantener y usar: Sin empezar"/);
		assert.match(html, /Flujo máximo[\s\S]*?propuesta/);
		assert.equal(html.match(/data-ciclo="barra"/g)?.length, 1, "la propuesta no lleva barra de ciclo");
	});

	it("lista detrás las unidades activas fuera del plan, marcadas", () => {
		const html = barra({ plan: { plan: null, unidades: [
			{ id: "u3", titulo: "Suelta", propuesta: false, fueraDelPlan: true, ciclo: { orientar: "pendiente", exponer: "vacio", reconstruir: "vacio", mantener: "vacio" } },
		] } });
		assert.match(html, /Suelta[\s\S]*?fuera del plan/);
	});

	it("lleva a Biblioteca y la marca también con el lector abierto (ticket 05)", () => {
		assert.match(barra(), />Biblioteca</);
		assert.doesNotMatch(barra(), /data-active="true"[^>]*>(?:(?!<\/button>)[\s\S])*Biblioteca/);
		for (const ruta of ["/biblioteca", "/biblioteca/d1?unidad=u1"]) {
			assert.match(barra({ ruta }), /data-active="true"[^>]*>(?:(?!<\/button>)[\s\S])*Biblioteca/);
		}
	});

	it("lleva a Cuadernos y la marca también con un cuaderno abierto (ticket 09)", () => {
		assert.match(barra(), />Cuadernos</);
		assert.doesNotMatch(barra(), /data-active="true"[^>]*>(?:(?!<\/button>)[\s\S])*Cuadernos/);
		for (const ruta of ["/cuadernos", "/cuadernos/nb1?nuevo=1"]) {
			assert.match(barra({ ruta }), /data-active="true"[^>]*>(?:(?!<\/button>)[\s\S])*Cuadernos/);
		}
	});

	it("Progreso es la página del armazón, no la vista antigua de Estudio (ticket 10)", () => {
		assert.equal(RUTA_PROGRESO, "/progreso");
		assert.doesNotMatch(barra(), /data-active="true"[^>]*>(?:(?!<\/button>)[\s\S])*Progreso/);
		assert.match(barra({ ruta: "/progreso" }), /data-active="true"[^>]*>(?:(?!<\/button>)[\s\S])*Progreso/);
	});

	it("marca la unidad abierta", () => {
		assert.match(barra({ ruta: "/unidad/u1" }), /data-active="true"[^>]*>[\s\S]*?Recorridos/);
	});

	it("un espacio sin plan dice qué hacer a continuación", () => {
		const html = barra({ plan: { plan: null, unidades: [] } });
		assert.match(html, /Este espacio aún no tiene plan/);
		assert.match(html, /Inicio/);
	});

	it("un plan sin unidades también lo dice", () => {
		assert.match(barra({ plan: { plan: { id: "p1", objetivo: "x" }, unidades: [] } }), /El plan aún no tiene unidades/);
	});

	it("usa la letra de lectura", () => {
		assert.match(barra(), /font-prose/);
	});
});

describe("BarraLateralEstudio: jerarquía (ticket 01 de la segunda ronda)", () => {
	/** La etiqueta de apertura de la cabecera de una sección. */
	const cabecera = (html: string, seccion: string) => html.match(new RegExp(`<button[^>]*data-seccion="${seccion}"[^>]*>`))?.[0] ?? "";
	/** La etiqueta de apertura del contenedor de los elementos de una sección. */
	const contenedor = (html: string, seccion: string) => html.match(new RegExp(`<div[^>]*data-elementos="${seccion}"[^>]*>`))?.[0] ?? "";

	it("Plan, Materiales y Conversaciones son cabeceras: botón en negrita al tamaño del cuerpo, con chevrón", () => {
		const html = barra();
		for (const [seccion, titulo] of [["plan", "Plan"], ["materiales", "Materiales"], ["conversaciones", "Conversaciones"]] as const) {
			const etiqueta = cabecera(html, seccion);
			assert.ok(etiqueta, `cabecera de ${titulo}`);
			assert.match(etiqueta, /type="button"/);
			assert.match(etiqueta, /aria-expanded="true"/);
			assert.match(etiqueta, /\bfont-bold\b/);
			assert.match(etiqueta, /\btext-sm\b/);
			assert.match(html, new RegExp(`data-seccion="${seccion}"[^>]*><svg[^>]*lucide-chevron-right[\\s\\S]*?</svg>${titulo}</button>`));
		}
	});

	it("sus elementos van a 11,5 px, un punto menos que el cuerpo de la barra (12,5 px), y con sangría, que desaparece plegada la barra a iconos", () => {
		const html = barra();
		for (const [seccion, elemento] of [["plan", "Recorridos"], ["materiales", "Biblioteca"], ["conversaciones", "Qué es un grafo"]] as const) {
			const elementos = contenedor(html, seccion);
			assert.match(elementos, /\bpl-3\b/, seccion);
			assert.match(elementos, /group-data-\[collapsible=icon\]:pl-0/, seccion);
			assert.match(elementos, /\[&amp;_\[data-sidebar=menu-button\]\]:text-\[11\.5px\]/, seccion);
			assert.ok(html.indexOf(elementos) < html.indexOf(elemento), `${elemento} dentro de ${seccion}`);
		}
	});

	it("una sección plegada oculta sus elementos y la cabecera lo dice; las demás siguen desplegadas", () => {
		const html = barra({ plegadas: ["plan"] });
		assert.match(cabecera(html, "plan"), /aria-expanded="false"/);
		assert.match(cabecera(html, "materiales"), /aria-expanded="true"/);
		assert.match(cabecera(html, "conversaciones"), /aria-expanded="true"/);
		const elementos = (seccion: string) => contenedor(html, seccion);
		assert.match(elementos("plan"), /(?<![:\w-])hidden\b/);
		assert.doesNotMatch(elementos("materiales"), /(?<![:\w-])hidden\b/);
		// La cabecera dice qué pliega.
		assert.match(cabecera(html, "plan"), /aria-controls="seccion-plan"/);
		assert.match(elementos("plan"), /id="seccion-plan"/);
	});

	it("plegada la barra a iconos, todo como antes: los elementos de una sección plegada siguen a la vista y no hay cabeceras", () => {
		const html = barra({ plegadas: ["plan", "materiales", "conversaciones"] }, false);
		assert.match(contenedor(html, "plan"), /group-data-\[collapsible=icon\]:block/);
		assert.match(html, /Recorridos/);
		assert.match(html, />Biblioteca</);
		for (const seccion of ["plan", "materiales", "conversaciones"]) assert.match(cabecera(html, seccion), /group-data-\[collapsible=icon\]:hidden/);
	});
});

describe("BarraLateralEstudio: «Por decidir» (ticket 02 de la segunda ronda)", () => {
	const elemento = (html: string) => html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*data-testid="por-decidir"[\s\S]*?<\/li>/)?.[0] ?? "";

	it("con decisiones pendientes, va bajo Inicio con el total en una insignia de acento", () => {
		const html = barra({ porDecidir: 3 });
		assert.match(html, />Inicio<[\s\S]*data-testid="por-decidir"[\s\S]*data-seccion="plan"/, "entre Inicio y el plan");
		const li = elemento(html);
		assert.match(li, />Por decidir</);
		assert.match(li, /data-sidebar="menu-badge"[^>]*class="[^"]*bg-primary[^"]*text-primary-foreground[^"]*"[^>]*>3</, "insignia de acento con el total");
		assert.match(li, /aria-label="Por decidir: 3 pendientes"/);
	});

	it("una sola decisión lo dice en singular", () => {
		assert.match(barra({ porDecidir: 1 }), /aria-label="Por decidir: 1 pendiente"/);
	});

	it("sin decisiones pendientes, o mientras se leen, no aparece", () => {
		assert.doesNotMatch(barra({ porDecidir: 0 }), /data-testid="por-decidir"|Por decidir/);
		assert.doesNotMatch(barra(), /data-testid="por-decidir"|Por decidir/);
	});

	it("plegada la barra a iconos, el total va sobre el icono", () => {
		const li = elemento(barra({ porDecidir: 12 }, false));
		assert.match(li, /data-icono-por-decidir[^>]*group-data-\[collapsible=icon\]:flex[^>]*>9\+</);
	});
});

describe("secciones plegadas recordadas entre sesiones (ticket 01 de la segunda ronda)", () => {
	/** El almacenamiento del navegador, la frontera externa: un mapa en memoria o uno que falla. */
	function conAlmacen<T>(almacen: Pick<Storage, "getItem" | "setItem">, cuerpo: () => T): T {
		const previo = Object.getOwnPropertyDescriptor(globalThis, "window");
		Object.defineProperty(globalThis, "window", { value: { localStorage: almacen }, configurable: true, writable: true });
		try { return cuerpo(); } finally {
			if (previo) Object.defineProperty(globalThis, "window", previo); else Reflect.deleteProperty(globalThis, "window");
		}
	}
	const enMemoria = () => {
		const m = new Map<string, string>();
		return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
	};

	it("sin nada guardado, todas desplegadas", () => {
		assert.deepEqual(conAlmacen(enMemoria(), seccionesPlegadas), []);
	});

	it("lo que se recuerda se lee al volver", () => {
		const almacen = enMemoria();
		conAlmacen(almacen, () => recordarPlegadas(["materiales", "conversaciones"]));
		assert.deepEqual(conAlmacen(almacen, seccionesPlegadas), ["materiales", "conversaciones"]);
		conAlmacen(almacen, () => recordarPlegadas([]));
		assert.deepEqual(conAlmacen(almacen, seccionesPlegadas), []);
	});

	it("ignora lo guardado que no son secciones", () => {
		const casos: [string, string[]][] = [["no es json", []], ['{"plan":true}', []], ['["plan","grafo",3]', ["plan"]]];
		for (const [guardado, esperado] of casos) {
			const almacen = enMemoria();
			almacen.setItem("estudio:barra:plegadas", guardado);
			assert.deepEqual(conAlmacen(almacen, seccionesPlegadas), esperado, guardado);
		}
	});

	it("sin almacenamiento disponible, no recuerda pero no falla", () => {
		const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
		assert.deepEqual(conAlmacen(roto, seccionesPlegadas), []);
		assert.doesNotThrow(() => conAlmacen(roto, () => recordarPlegadas(["plan"])));
	});
});

describe("InicioEstudio", () => {
	const accionesInicio = {
		enviar: nada, paso: nada, repasar: nada, retomar: nada, abrirUnidad: nada, crearPlan: nada,
		ponerAPrueba: nada, anadirMaterial: nada, abrirVolcado: nada,
	};
	const VACIA: LecturaInicio = { plan: null, paso: null, pasos: [], repasos: [], proximos: [], abierto: null };
	const COMPLETA: LecturaInicio = {
		plan: { id: "p1", objetivo: "Dominar los algoritmos de grafos" },
		paso: { unitId: "u2", titulo: "Árboles de expansión", tipo: "volcado", accion: "Escribe lo que ya sabes", motivo: "Sin volcado inicial no podrás ver después qué cambió.", boton: "Escribir volcado" },
		pasos: [{ unitId: "u3", titulo: "Caminos mínimos", tipo: "reconstruir", accion: "Reconstruye sin mirar", motivo: "Capturaste 5 notas.", boton: "Empezar reconstrucción" }],
		repasos: [
			{ unitId: "u4", titulo: "Flujo máximo", tarea: "libre", intentoId: "a1", fecha: null },
			{ unitId: "u1", titulo: "Recorridos BFS y DFS", tarea: "guiada", intentoId: null, fecha: "2026-11-10" },
		],
		proximos: [{ dia: "2026-11-13", unidades: [{ unitId: "u5", titulo: "Coloreado", tarea: "libre" }] }, { dia: "2026-11-16", unidades: [{ unitId: "u6", titulo: "Emparejamientos", tarea: "aplicada" }] }],
		abierto: { chatId: "c1", titulo: "Dudas de Dijkstra", fecha: "2026-11-12T10:00:00.000Z", abierto: ["¿Por qué falla con pesos negativos?"], siguiente: "Probar Bellman-Ford" },
	};
	const AGENDA = { datos: { hoy: "2026-11-12", dias: {} }, onRangos: () => {} };
	const RITMO = { hoy: "2026-11-12", diasEstudiados: 4, racha: 2, repasos: { total: 2, aTiempo: 1 }, intentosPorSemana: [1, 0, 2, 3], tendencia: "sube" as const, actividad: [] };
	const inicio = (props: Partial<React.ComponentProps<typeof InicioEstudio>> = {}) =>
		renderToStaticMarkup(<InicioEstudio espacio="Grafos" lectura={COMPLETA} unidades={[]} agenda={AGENDA} ritmo={null} ahora={AHORA} ocupado={false} error={null} acciones={accionesInicio} {...props} />);

	it("pregunta qué quiere poder hacer, con título en serifa, y ofrece el cuadro de mensaje", () => {
		const html = inicio();
		assert.match(html, /<h1[^>]*font-title[^>]*>¿Qué quieres poder hacer hoy\?<\/h1>/);
		assert.match(html, /<textarea/);
		assert.match(html, /aria-label="Empezar conversación"/);
		assert.match(html, /Dominar los algoritmos de grafos/);
	});

	it("el cuadro lleva como contexto la unidad del paso propuesto, que se puede quitar", () => {
		assert.match(inicio(), /data-contexto="u2"[^>]*><span[^>]*>Árboles de expansión<\/span><button[^>]*aria-label="Quitar la unidad de contexto"/);
		assert.match(inicio({ lectura: VACIA }), /sin unidad de contexto/);
	});

	it("«Continuar» lleva la acción y la unidad del paso propuesto, destacada, con el motivo como descripción emergente", () => {
		const html = inicio();
		assert.match(html, /<button[^>]*title="Sin volcado inicial no podrás ver después qué cambió\."[^>]*data-ficha="continuar"[^>]*data-destacada="true"[^>]*>.*Continuar.*Escribe lo que ya sabes · Árboles de expansión.*<\/button>/);
		assert.doesNotMatch(html, /data-paso=/, "el paso ya no se pinta como botón aparte");
		assert.doesNotMatch(inicio({ lectura: VACIA }), /data-ficha="continuar"/, "sin paso, no se ofrece");
	});

	it("sobre la agenda, la línea de ritmo (ticket 06 de la segunda ronda); sin actividad, ceros", () => {
		const html = inicio({ ritmo: RITMO });
		assert.match(html, /data-ficha="[^"]+"[\s\S]*data-ritmo[\s\S]*<section aria-label="Agenda"/, "acciones, ritmo y agenda, en ese orden");
		assert.match(html, /4<\/strong> días en 4 semanas/);
		const cero = inicio({ ritmo: { ...RITMO, diasEstudiados: 0, racha: 0, repasos: { total: 0, aTiempo: 0 }, intentosPorSemana: [0, 0, 0, 0], tendencia: "igual" } });
		assert.match(cero, /0<\/strong> días en 4 semanas[\s\S]*<section aria-label="Agenda"/);
		assert.doesNotMatch(inicio({ lectura: null, ritmo: RITMO }), /data-ritmo/, "mientras se lee el inicio, tampoco hay ritmo");
	});

	it("bajo las acciones, la agenda sustituye a las listas «Hoy» y «Próximos 7 días» (ticket 05 de la segunda ronda)", () => {
		const html = inicio();
		assert.match(html, /data-ficha="[^"]+"[\s\S]*<section aria-label="Agenda"/, "acciones y agenda, en ese orden");
		assert.doesNotMatch(html, /Repasar · |Retomar el intento · |Reconstruye sin mirar · /, "sin el formato «acción · unidad»");
		assert.doesNotMatch(html, />Hoy<\/h2>|>Próximos 7 días<\/h2>|Mañana/, "sin las listas fijas");
		assert.doesNotMatch(inicio({ lectura: null }), /aria-label="Agenda"/, "mientras se lee el inicio, no hay agenda");
	});

	it("«Retomar» nombra la conversación con algo abierto y lleva lo pendiente como descripción emergente; ya no hay «Quedó abierto»", () => {
		const html = inicio();
		assert.match(html, /<button[^>]*title="¿Por qué falla con pesos negativos\?\nSiguiente: Probar Bellman-Ford"[^>]*data-ficha="retomar"[^>]*>.*Retomar.*«Dudas de Dijkstra».*<\/button>/s);
		assert.doesNotMatch(html, /Quedó abierto/);
		assert.doesNotMatch(inicio({ lectura: VACIA }), /data-ficha="retomar"/);
	});

	it("ya no pinta la bandeja «Por decidir»: va en la barra lateral (ticket 02 de la segunda ronda)", () => {
		for (const html of [inicio(), inicio({ lectura: VACIA })]) {
			assert.doesNotMatch(html, /Por decidir|Nada pendiente de tu decisión|aria-label="Pendiente"/);
			assert.doesNotMatch(html, />(Confirmar|Descartar|Aplicar|Rechazar)</);
		}
	});

	it("vacío, la agenda dice qué hacer a continuación", () => {
		const html = inicio({ lectura: VACIA });
		assert.match(html, /Nada pendiente para hoy\./);
		assert.doesNotMatch(html, /data-paso=/);
	});

	/** Las fichas de acción rápida, en el orden en que se pintan (ticket 04 de la segunda ronda). */
	const fichas = (html: string) => [...html.matchAll(/data-ficha="([^"]+)"/g)].map(m => m[1]);

	it("sin plan, la primera ficha es «Crear plan», sin texto explicativo ni formulario fijo", () => {
		const html = inicio({ lectura: VACIA });
		assert.equal(fichas(html)[0], "crear-plan");
		assert.match(html, /<button[^>]*data-ficha="crear-plan"[^>]*>.*Crear plan.*<\/button>/);
		assert.doesNotMatch(html, /Este espacio aún no tiene plan/);
		assert.doesNotMatch(html, /nuevo-plan/, "el campo del objetivo solo aparece al pulsar la ficha");
		assert.doesNotMatch(inicio(), /data-ficha="crear-plan"/, "con plan, no se ofrece");
	});

	it("«Repasar» cuenta los repasos de hoy y los vencidos, sin los intentos a medias, y solo aparece si hay alguno", () => {
		assert.match(inicio(), /<button[^>]*data-ficha="repasar"[^>]*>.*Repasar.*\(1\).*<\/button>/);
		assert.doesNotMatch(inicio({ lectura: VACIA }), /data-ficha="repasar"/);
		const soloIntento = { ...COMPLETA, repasos: COMPLETA.repasos.filter(r => r.intentoId) };
		assert.doesNotMatch(inicio({ lectura: soloIntento }), /data-ficha="repasar"/, "un intento a medias no es un repaso");
	});

	it("«Ponerme a prueba» se ofrece con unidades activas en el plan, como menú", () => {
		const html = inicio({ unidades: [{ id: "u1", titulo: "Recorridos BFS y DFS" }] });
		assert.match(html, /<button(?=[^>]*aria-haspopup="menu")[^>]*data-ficha="prueba"[^>]*>.*Ponerme a prueba.*<\/button>/);
		assert.doesNotMatch(inicio({ unidades: [] }), /data-ficha="prueba"/);
	});

	it("solo las fichas que tocan, en orden de prioridad y nunca más de cinco", () => {
		assert.deepEqual(fichas(inicio({ lectura: VACIA })), ["crear-plan", "material", "contexto"]);
		assert.deepEqual(fichas(inicio({ unidades: [] })), ["continuar", "repasar", "retomar", "material", "contexto"]);
		assert.deepEqual(fichas(inicio({ unidades: [{ id: "u1", titulo: "Recorridos BFS y DFS" }] })), ["continuar", "repasar", "retomar", "prueba", "material"]);
		const todas = inicio({ lectura: { ...COMPLETA, plan: null }, unidades: [{ id: "u1", titulo: "Recorridos BFS y DFS" }] });
		assert.deepEqual(fichas(todas), ["crear-plan", "continuar", "repasar", "retomar", "prueba"]);
	});

	it("«Añadir material» y «Añadir contexto» se nombran tal cual", () => {
		const html = inicio({ lectura: VACIA });
		assert.match(html, /data-ficha="material"[^>]*>.*Añadir material<\/button>/);
		assert.match(html, /data-ficha="contexto"[^>]*>.*Añadir contexto<\/button>/);
	});

	it("enseña el error cuando lo hay", () => {
		assert.match(inicio({ error: "No se pudo" }), /role="alert"[^>]*>No se pudo</);
	});

	it("no muestra el grafo, sus cadenas, su coste, la importación de notas ni el conmutador", () => {
		const html = inicio();
		for (const fuera of ["home-mode-switch", "home-mode-practice", "open-chain-table", "knowledge-summary", "Import", "Chains", "graph"]) {
			assert.doesNotMatch(html, new RegExp(fuera), fuera);
		}
	});
});
