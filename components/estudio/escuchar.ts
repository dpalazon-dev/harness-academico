"use client";

/**
 * «Escuchar» en el cuaderno (ticket 12j): qué se lee en voz alta y cuándo. Encendido, un mensaje nuevo del tutor (un comentario
 * en el margen o una respuesta en un hilo) se lee cuando llega; nunca los que ya estaban al abrir el cuaderno ni los que llegaron
 * con el interruptor apagado. El interruptor se recuerda por cuaderno en este equipo (las voces son del equipo, no del cuaderno).
 * Cada comentario tiene además su botón, que lee a demanda con el interruptor como esté.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Comentario } from "./cuadernos";
import { estadoVoz, hablar, limpiarParaVoz, parar, vozDisponible } from "./voz";

export interface MensajeTutor { id: string; texto: string }

/** Los mensajes del tutor de unos comentarios, en orden: el primero de cada hilo y sus respuestas. */
export function mensajesDelTutor(comentarios: readonly Comentario[] | undefined): MensajeTutor[] {
	return (comentarios ?? []).flatMap(c => c.thread.filter(m => m.role === "tutor").map(m => ({ id: m.id, texto: m.text })));
}

/** Los mensajes que no estaban entre los ya vistos. */
export const nuevosDelTutor = (vistos: ReadonlySet<string>, mensajes: readonly MensajeTutor[]): MensajeTutor[] => mensajes.filter(m => !vistos.has(m.id));

const clave = (cuadernoId: string) => `estudio.cuaderno.escuchar.${cuadernoId}`;
function recordado(cuadernoId: string): boolean {
	try { return window.localStorage.getItem(clave(cuadernoId)) === "1"; } catch { return false; }
}
function recordar(cuadernoId: string, activo: boolean) {
	try { if (activo) window.localStorage.setItem(clave(cuadernoId), "1"); else window.localStorage.removeItem(clave(cuadernoId)); } catch { /* sin almacenamiento, no se recuerda */ }
}

/** Lo que la cabecera y los comentarios necesitan para escuchar. */
export interface VozVista {
	/** ¿El equipo ofrece síntesis de voz? */
	disponible: boolean;
	activo: boolean;
	/** El id del mensaje que suena ahora, si suena alguno. */
	leyendo: string | null;
	/** Lo que David debe saber: no hay voz en español (se usa la predeterminada) o el motor falló. */
	aviso: "sin-espanol" | "fallo" | null;
	alternar(): void;
	leer(mensajeId: string, texto: string): void;
	/** Corta la lectura si suena alguna; no hace nada si no. */
	parar(): void;
}

const SIN_COMENTARIOS: readonly Comentario[] = [];

/** `cuaderno` es null mientras carga: lo que traiga al cargar cuenta como visto. */
export function useEscuchar(cuaderno: { id: string; comments?: Comentario[] } | null): VozVista {
	const cuadernoId = cuaderno?.id ?? null;
	// Un cuaderno sin comentarios aún no tiene el campo: cargado, cuenta como una lista vacía (null solo mientras carga).
	const comentarios = cuaderno ? cuaderno.comments ?? SIN_COMENTARIOS : null;
	// El editor solo se pinta en el cliente, con el cuaderno ya cargado: leerlo aquí no desajusta la hidratación y evita un primer pintado engañoso.
	const [disponible, setDisponible] = useState(vozDisponible);
	const [activo, setActivo] = useState(false);
	const [leyendo, setLeyendo] = useState<string | null>(null);
	const [sinEspanol, setSinEspanol] = useState(false);
	const [fallo, setFallo] = useState(false);
	const leyendoRef = useRef<string | null>(null);
	/** Los mensajes del tutor que ya se conocían, del cuaderno al que pertenecen; null hasta que carga. */
	const vistos = useRef<{ cuadernoId: string; ids: Set<string> } | null>(null);
	const avisado = useRef(false);

	useEffect(() => {
		if (!cuadernoId) return;
		const hay = vozDisponible();
		setDisponible(hay);
		setActivo(hay && recordado(cuadernoId));
		return () => { parar(); leyendoRef.current = null; };
	}, [cuadernoId]);

	/** Mira las voces y avisa, una vez, de que no hay ninguna en español. */
	const comprobar = useCallback(() => {
		void estadoVoz().then(e => { if (e === "sin-espanol" && !avisado.current) { avisado.current = true; setSinEspanol(true); } });
	}, []);

	const leer = useCallback((mensajeId: string, texto: string) => {
		setFallo(false);
		leyendoRef.current = mensajeId;
		setLeyendo(mensajeId);
		hablar(limpiarParaVoz(texto), (huboFallo) => {
			if (leyendoRef.current === mensajeId) leyendoRef.current = null;
			setLeyendo(m => (m === mensajeId ? null : m));
			if (huboFallo) setFallo(true);
		});
		comprobar();
	}, [comprobar]);

	const detener = useCallback(() => { if (leyendoRef.current !== null) parar(); }, []);

	useEffect(() => {
		if (!cuadernoId || !comentarios) return;
		const mensajes = mensajesDelTutor(comentarios);
		if (vistos.current?.cuadernoId !== cuadernoId) { vistos.current = { cuadernoId, ids: new Set(mensajes.map(m => m.id)) }; return; }
		const nuevos = nuevosDelTutor(vistos.current.ids, mensajes);
		for (const m of nuevos) vistos.current.ids.add(m.id);
		// Si llegan varios a la vez se lee el último: la cola es de uno.
		const ultimo = nuevos[nuevos.length - 1];
		if (ultimo && activo && disponible) leer(ultimo.id, ultimo.texto);
	}, [cuadernoId, comentarios, activo, disponible, leer]);

	// Escape corta la lectura. En captura, porque el hilo y el menú de la página cierran con Escape y paran la propagación.
	useEffect(() => {
		if (leyendo === null) return;
		const alPulsar = (e: KeyboardEvent) => { if (e.key === "Escape") detener(); };
		document.addEventListener("keydown", alPulsar, true);
		return () => document.removeEventListener("keydown", alPulsar, true);
	}, [leyendo, detener]);

	const alternar = () => {
		if (!cuadernoId || !disponible) return;
		const nuevo = !activo;
		setActivo(nuevo);
		recordar(cuadernoId, nuevo);
		if (nuevo) comprobar(); else detener();
	};

	return { disponible, activo, leyendo, aviso: fallo ? "fallo" : sinEspanol ? "sin-espanol" : null, alternar, leer, parar: detener };
}
