"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";

/**
 * Estado en vivo y metadatos de las conversaciones para la barra lateral
 * (harness conversacional, diseño 1A aprobado por David el 23-nov-2026).
 * Estudio da la lista agrupada por espacio y unidad; el núcleo sabe lo que
 * pasa ahora (turno en marcha, pregunta esperando) y guarda fijar, archivar y
 * de qué conversación salió una rama. La barra cruza las dos por id.
 */

export type EstadoConversacion = "trabajando" | "te-espera" | "terminada";

export interface MetaConversacion {
	estado: EstadoConversacion;
	fijada: boolean;
	archivada: boolean;
	/** Id de la conversación de la que se bifurcó, si es una rama. */
	bifurcadaDe: string | null;
}

/** Fila de `GET /api/chats` (ChatListItem), solo lo que se usa aquí. */
export interface FilaNucleo {
	id: string;
	busy?: boolean;
	compacting?: boolean;
	pendingQuestion?: boolean;
	pendingProblem?: boolean;
	pinned?: boolean;
	archived?: boolean;
	forkedFrom?: { chatId: string } | null;
}

export function metaDe(fila: FilaNucleo): MetaConversacion {
	const estado: EstadoConversacion = fila.busy || fila.compacting ? "trabajando" : fila.pendingQuestion || fila.pendingProblem ? "te-espera" : "terminada";
	return { estado, fijada: fila.pinned === true, archivada: fila.archived === true, bifurcadaDe: fila.forkedFrom?.chatId ?? null };
}

export const SIN_META: MetaConversacion = { estado: "terminada", fijada: false, archivada: false, bifurcadaDe: null };

export const ETIQUETA_ESTADO: Record<EstadoConversacion, string> = {
	trabajando: "El tutor está trabajando",
	"te-espera": "El tutor espera tu respuesta",
	terminada: "Terminada",
};

/** Normaliza para buscar sin distinguir mayúsculas ni tildes. */
export function normalizar(texto: string): string {
	return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function coincide(titulo: string, busqueda: string): boolean {
	const q = normalizar(busqueda);
	return q === "" || normalizar(titulo).includes(q);
}

/**
 * Reparte las conversaciones: fijadas arriba, archivadas aparte y el resto
 * para los grupos de siempre. La búsqueda filtra las tres; con búsqueda, las
 * archivadas también aparecen (si buscas algo, lo quieres encontrar).
 */
export function repartir<C extends { id: string; title: string }>(
	conversaciones: readonly C[],
	meta: (id: string) => MetaConversacion,
	busqueda: string,
): { fijadas: C[]; resto: C[]; archivadas: C[] } {
	const fijadas: C[] = [], resto: C[] = [], archivadas: C[] = [];
	for (const c of conversaciones) {
		if (!coincide(c.title, busqueda)) continue;
		const m = meta(c.id);
		if (m.archivada) archivadas.push(c);
		else if (m.fijada) fijadas.push(c);
		else resto.push(c);
	}
	return { fijadas, resto, archivadas };
}

/**
 * Coloca cada rama justo debajo de su origen cuando los dos están en la misma
 * lista, con su profundidad para sangrarla. Una rama sin su origen en la
 * lista queda donde estaba, sin sangría.
 */
export function anidarRamas<C extends { id: string }>(lista: readonly C[], meta: (id: string) => MetaConversacion): { conversacion: C; nivel: number }[] {
	const ids = new Set(lista.map(c => c.id));
	const hijas = new Map<string, C[]>();
	const raices: C[] = [];
	for (const c of lista) {
		const padre = meta(c.id).bifurcadaDe;
		if (padre && padre !== c.id && ids.has(padre)) hijas.set(padre, [...(hijas.get(padre) ?? []), c]);
		else raices.push(c);
	}
	const out: { conversacion: C; nivel: number }[] = [];
	const vistos = new Set<string>();
	const visitar = (c: C, nivel: number) => {
		if (vistos.has(c.id)) return;
		vistos.add(c.id);
		out.push({ conversacion: c, nivel });
		for (const h of hijas.get(c.id) ?? []) visitar(h, Math.min(nivel + 1, 3));
	};
	for (const r of raices) visitar(r, 0);
	// Un ciclo (no debería existir) no hace desaparecer filas.
	for (const c of lista) if (!vistos.has(c.id)) visitar(c, 0);
	return out;
}

/** Lee `GET /api/chats` y lo mantiene al día con los eventos del servidor. */
export function useMetaConversaciones(): (id: string) => MetaConversacion {
	const [mapa, setMapa] = useState<ReadonlyMap<string, MetaConversacion>>(new Map());
	const leer = useCallback(() => {
		fetch("/api/chats")
			.then(r => (r.ok ? (r.json() as Promise<{ chats?: FilaNucleo[] }>) : null))
			.then(datos => { if (datos?.chats) setMapa(new Map(datos.chats.map(f => [f.id, metaDe(f)]))); })
			.catch(() => { /* sin estado en vivo, la barra sigue con la lista de Estudio */ });
	}, []);
	useEffect(() => { leer(); }, [leer]);
	useServerEvent("turn-started", leer);
	useServerEvent("turn-settled", leer);
	useServerEvent("chats-changed", leer);
	useServerEvent("compaction-changed", leer);
	useServerResync(leer);
	return useCallback((id: string) => mapa.get(id) ?? SIN_META, [mapa]);
}
