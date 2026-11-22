"use client";

/**
 * Tab y Mayús+Tab en las pantallas del armazón (historia 47, ticket 12). El
 * núcleo anula el Tab del navegador: con Tab emite `lh:kbd-cycle-fields`, al
 * que cada superficie responde con sus campos (`useFieldCycle`, la solución
 * del editor de cuadernos, ticket 09), y con Mayús+Tab emite
 * `lh:kbd-cycle-thinking`, que solo atiende el selector de razonamiento del
 * cuadro de mensaje. Las pantallas que usan este recorrido no montan ese
 * selector, así que aquí Mayús+Tab recorre los campos hacia atrás.
 *
 * Los campos se reúnen al pulsar, del DOM vivo: aparecen y desaparecen con
 * cada paso de la pantalla.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFieldCycle } from "@/components/field-cycle";
import { useOptionalInteractionLayers } from "@/components/interaction-layers";
import { isInteractionScopeEligible } from "@/components/plugin-input-focus";

/** Lo que cuenta como campo: lo que se escribe o se elige, no los botones ni la subida de archivos. */
export const SELECTOR_CAMPOS = 'input:not([type="hidden"]):not([type="file"]), textarea, select';

/** Los campos de `raiz` que se pueden enfocar ahora: habilitados y visibles, en el orden del documento. */
export function camposDe(raiz: ParentNode | null, selector = SELECTOR_CAMPOS): HTMLElement[] {
	if (!raiz) return [];
	// `checkVisibility` descarta también lo que hay dentro de un <details> cerrado, que tiene caja pero no admite foco.
	return [...raiz.querySelectorAll<HTMLElement>(selector)].filter(el =>
		!(el as HTMLInputElement).disabled && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0));
}

/** El campo al que se va desde el enfocado: el primero (o el último hacia atrás) si el foco está fuera. */
export function siguienteCampo(campos: readonly HTMLElement[], activo: Element | null, atras: boolean): HTMLElement | null {
	if (campos.length === 0) return null;
	const i = activo ? campos.findIndex(el => el === activo || el.contains(activo)) : -1;
	if (i < 0) return atras ? campos[campos.length - 1]! : campos[0]!;
	return campos[(i + (atras ? -1 : 1) + campos.length) % campos.length]!;
}

/** Tab hacia delante (con el núcleo) y Mayús+Tab hacia atrás sobre los campos que da `campos`. */
export function useRecorridoCampos(campos: () => readonly HTMLElement[]) {
	useFieldCycle(campos);
	const capas = useOptionalInteractionLayers();
	useEffect(() => {
		const atras = () => {
			const lista = campos().filter(el => isInteractionScopeEligible(el, capas));
			siguienteCampo(lista, document.activeElement, true)?.focus();
		};
		window.addEventListener("lh:kbd-cycle-thinking", atras);
		return () => window.removeEventListener("lh:kbd-cycle-thinking", atras);
	}, [campos, capas]);
}

/** Envuelve una pantalla sin cambiar su maquetación: sus campos se recorren con Tab y Mayús+Tab. */
export function RecorridoCampos({ children }: { children: React.ReactNode }) {
	const raiz = useRef<HTMLDivElement>(null);
	useRecorridoCampos(useCallback(() => camposDe(raiz.current), []));
	return <div ref={raiz} className="contents">{children}</div>;
}
