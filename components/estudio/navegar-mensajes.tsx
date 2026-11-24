"use client";

/**
 * Ir al mensaje anterior o al siguiente de una conversación (petición de David del 23-nov-2026): con Alt+↑ y
 * Alt+↓ (acciones `message-prev` y `message-next` del registro, reasignables) y con dos botones en el borde
 * derecho de la conversación. Las paradas son los mensajes de David y las respuestas del tutor, que el chat
 * marca con `data-parada-mensaje`; tarjetas de contexto y separadores no cuentan. El inicio de la parada
 * queda arriba de la vista, con el mismo margen que los enlaces a un mensaje.
 *
 * Vive dentro de `Conversation` (necesita el contexto de use-stick-to-bottom): `stopScroll` suelta el
 * seguimiento del final antes de saltar, o el chat volvería abajo.
 */
import { useCallback, useEffect, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { kbdEventForAction, type KeyAction } from "@/src/core";

export type Direccion = "anterior" | "siguiente";

export const ATRIBUTO_PARADA = "data-parada-mensaje";
/** Lo que queda por encima de la parada al llegar, como `scrollSessionTarget`. */
export const MARGEN_PARADA = 16;
/** Una parada a menos de esto de la posición actual es la actual, no la siguiente. */
const TOLERANCIA = 8;

const ACCION: Record<Direccion, KeyAction> = { anterior: "message-prev", siguiente: "message-next" };

/** El índice de la parada a la que ir, o null si no hay más en esa dirección. `cimas` va en orden de documento
 * (de arriba abajo), en coordenadas del contenido; `posicion` es la línea de lectura (scroll + margen). La
 * anterior desde la mitad de un mensaje largo es su propio inicio. */
export function indiceDestino(cimas: readonly number[], posicion: number, direccion: Direccion): number | null {
	if (direccion === "siguiente") {
		const i = cimas.findIndex(c => c > posicion + TOLERANCIA);
		return i === -1 ? null : i;
	}
	for (let i = cimas.length - 1; i >= 0; i--) if (cimas[i]! < posicion - TOLERANCIA) return i;
	return null;
}

/** Desplaza el contenedor de la conversación hasta la parada anterior o siguiente. Devuelve si se movió. */
export function irAParada(contenedor: HTMLElement, direccion: Direccion): boolean {
	const paradas = Array.from(contenedor.querySelectorAll<HTMLElement>(`[${ATRIBUTO_PARADA}]`))
		.filter(p => p.getClientRects().length > 0); // las ocultas no son parada
	const origen = contenedor.getBoundingClientRect().top - contenedor.scrollTop;
	const cimas = paradas.map(p => p.getBoundingClientRect().top - origen);
	const i = indiceDestino(cimas, contenedor.scrollTop + MARGEN_PARADA, direccion);
	if (i === null) return false;
	const destino = Math.max(0, cimas[i]! - MARGEN_PARADA);
	// Arriba del todo, el primer mensaje queda por encima de la línea de lectura pero ya está a la vista.
	if (Math.abs(destino - contenedor.scrollTop) < 1) return false;
	contenedor.scrollTo({ top: destino, behavior: "instant" });
	return true;
}

export function NavegacionMensajes({ visible }: { visible: boolean }) {
	const contexto = useStickToBottomContext();
	// El contexto cambia de identidad mientras se asienta el primer desplazamiento (session-navigation.tsx):
	// por referencia, los oyentes se ponen una vez.
	const ref = useRef(contexto);
	ref.current = contexto;
	const ir = useCallback((direccion: Direccion) => {
		const { scrollRef, stopScroll } = ref.current;
		const contenedor = scrollRef.current;
		if (!contenedor) return;
		stopScroll();
		irAParada(contenedor, direccion);
	}, []);

	useEffect(() => {
		const anterior = () => ir("anterior");
		const siguiente = () => ir("siguiente");
		window.addEventListener(kbdEventForAction("message-prev"), anterior);
		window.addEventListener(kbdEventForAction("message-next"), siguiente);
		return () => {
			window.removeEventListener(kbdEventForAction("message-prev"), anterior);
			window.removeEventListener(kbdEventForAction("message-next"), siguiente);
		};
	}, [ir]);

	if (!visible) return null;
	return (
		<div data-testid="navegacion-mensajes" className="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1">
			{(["anterior", "siguiente"] as const).map(direccion => (
				<Hint key={direccion} label={direccion === "anterior" ? "Mensaje anterior" : "Mensaje siguiente"} action={ACCION[direccion]} side="left">
					<button
						type="button"
						aria-label={direccion === "anterior" ? "Mensaje anterior" : "Mensaje siguiente"}
						// Sin robar el foco: quien escribía sigue en el campo.
						onPointerDown={e => e.preventDefault()}
						onClick={() => ir(direccion)}
						className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
					>
						{direccion === "anterior" ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
					</button>
				</Hint>
			))}
		</div>
	);
}
