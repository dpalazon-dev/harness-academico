"use client";

/**
 * El asa del borde derecho de la barra lateral (petición de David del 23-nov-2026): arrastrarla cambia el ancho
 * entre 200 y 480 px y lo recuerda; un clic pliega o despliega la barra, como el raíl de shadcn; doble clic
 * vuelve a 256 px. Con el asa enfocada, ← y → mueven 16 px. Solo se ve con la barra desplegada.
 *
 * `ProveedorBarraLateral` guarda el ancho y lo pone en `--sidebar-width`; mientras se arrastra quita las
 * transiciones para que la barra siga al puntero sin retraso.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ANCHO_MAXIMO, ANCHO_MINIMO, ANCHO_POR_DEFECTO, anchoGuardado, limitarAncho, PASO_TECLADO, recordarAncho } from "./ancho-barra";

/** Por debajo de este desplazamiento, soltar es un clic y no un arrastre. */
const UMBRAL_ARRASTRE = 3;
/** Lo que espera el clic simple por si llega el segundo de un doble clic. */
const ESPERA_DOBLE_CLIC = 250;

export interface AnchoBarra {
	ancho: number;
	arrastrando: boolean;
	/** Cambia el ancho (limitado); con `guardar`, además lo recuerda. */
	cambiar: (px: number, guardar?: boolean) => void;
	setArrastrando: (si: boolean) => void;
}

const ContextoAncho = createContext<AnchoBarra | null>(null);
export const ProveedorAncho = ContextoAncho.Provider;

/** El estado del ancho para el proveedor de la barra. La preferencia se lee al montar: el servidor no ve el almacenamiento. */
export function useEstadoAncho(): AnchoBarra {
	const [ancho, setAncho] = useState(ANCHO_POR_DEFECTO);
	const [arrastrando, setArrastrando] = useState(false);
	useEffect(() => { setAncho(anchoGuardado()); }, []);
	const cambiar = useCallback((px: number, guardar = false) => {
		const limitado = limitarAncho(px);
		setAncho(limitado);
		if (guardar) recordarAncho(limitado);
	}, []);
	return { ancho, arrastrando, cambiar, setArrastrando };
}

export function AsaAnchoBarra() {
	const contexto = useContext(ContextoAncho);
	const { toggleSidebar } = useSidebar();
	const arrastre = useRef<{ x: number; ancho: number; ultimo: number; movido: boolean } | null>(null);
	/** El último gesto fue un arrastre: el clic que lo cierra no pliega la barra. */
	const fueArrastre = useRef(false);
	const clicPendiente = useRef<number | null>(null);
	useEffect(() => () => { if (clicPendiente.current !== null) window.clearTimeout(clicPendiente.current); }, []);
	if (!contexto) return null;
	const { ancho, cambiar, setArrastrando } = contexto;

	const terminar = (el: HTMLElement, pointerId: number) => {
		const a = arrastre.current;
		arrastre.current = null;
		if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
		document.body.style.removeProperty("cursor");
		document.body.style.removeProperty("user-select");
		if (!a?.movido) return;
		cambiar(a.ultimo, true);
		setArrastrando(false);
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Ancho de la barra lateral"
			aria-valuemin={ANCHO_MINIMO}
			aria-valuemax={ANCHO_MAXIMO}
			aria-valuenow={ancho}
			tabIndex={0}
			title="Arrastra para cambiar el ancho · clic para plegar · doble clic para el ancho inicial"
			data-slot="asa-ancho-barra"
			className={cn(
				"absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none",
				"after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors",
				"hover:after:bg-sidebar-border focus-visible:after:bg-ring",
				"group-data-[collapsible=icon]:hidden",
			)}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.currentTarget.setPointerCapture?.(e.pointerId);
				arrastre.current = { x: e.clientX, ancho, ultimo: ancho, movido: false };
				fueArrastre.current = false;
			}}
			onPointerMove={(e) => {
				const a = arrastre.current;
				if (!a) return;
				const dx = e.clientX - a.x;
				if (!a.movido) {
					if (Math.abs(dx) < UMBRAL_ARRASTRE) return;
					a.movido = true;
					fueArrastre.current = true;
					setArrastrando(true);
					document.body.style.cursor = "col-resize";
					document.body.style.userSelect = "none";
				}
				a.ultimo = limitarAncho(a.ancho + dx);
				cambiar(a.ultimo);
			}}
			onPointerUp={(e) => terminar(e.currentTarget, e.pointerId)}
			onPointerCancel={(e) => terminar(e.currentTarget, e.pointerId)}
			onClick={(e) => {
				if (fueArrastre.current) { fueArrastre.current = false; return; }
				if (e.detail > 1) return;
				clicPendiente.current = window.setTimeout(() => { clicPendiente.current = null; toggleSidebar(); }, ESPERA_DOBLE_CLIC);
			}}
			onDoubleClick={() => {
				if (clicPendiente.current !== null) { window.clearTimeout(clicPendiente.current); clicPendiente.current = null; }
				cambiar(ANCHO_POR_DEFECTO, true);
			}}
			onKeyDown={(e) => {
				if (e.altKey || e.ctrlKey || e.metaKey) return;
				const paso = e.key === "ArrowLeft" ? -PASO_TECLADO : e.key === "ArrowRight" ? PASO_TECLADO : 0;
				if (!paso) return;
				e.preventDefault();
				cambiar(ancho + paso, true);
			}}
		/>
	);
}
