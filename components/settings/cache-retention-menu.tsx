"use client";

import type { CacheRetention } from "@earendil-works/pi-ai";

const OPTIONS = [
	{ value: undefined, compact: "por defecto", label: "Lo que decida Pi", description: "Deja la opción sin fijar. Se aplican el comportamiento normal de Pi y lo que diga el entorno." },
	{ value: "none", compact: "no pedida", label: "No pedir caché", description: "Pasa a Pi la preferencia none. El proveedor puede guardar en caché de todos modos." },
	{ value: "short", compact: "corta", label: "Retención corta", description: "Pasa a Pi la preferencia short. La duración depende del proveedor y del modelo." },
	{ value: "long", compact: "larga", label: "Retención larga", description: "Pasa a Pi la preferencia long. Escribir en la caché puede costar más." },
] as const;

export function cacheRetentionLabel(value: CacheRetention | undefined): string {
	return `Caché: ${OPTIONS.find((option) => option.value === value)!.compact}`;
}

export function CacheRetentionMenu({ value, onPick }: {
	value: CacheRetention | undefined;
	onPick: (value: CacheRetention | undefined) => void;
}) {
	return <>
		<div className="border-b border-border px-2 pb-2">
			<p className="text-card-foreground">Retención de caché</p>
			<p className="mt-1 text-muted-foreground">La preferencia de retención de caché que se envía a Pi. Que funcione y cuánto dure depende del proveedor y del modelo. No garantiza que se aproveche la caché.</p>
		</div>
		{OPTIONS.map((option) => <button
			key={option.value ?? "default"}
			type="button"
			data-testid={`cache-retention-option-${option.value ?? "default"}`}
			aria-pressed={value === option.value}
			onClick={() => onPick(option.value)}
			className={`anillo-foco rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted ${value === option.value ? "bg-muted/60" : ""}`}
		>
			<span className="flex justify-between gap-2 text-card-foreground"><span>{option.label}</span>{value === option.value && <span aria-hidden>✓</span>}</span>
			<span className="mt-1 block text-muted-foreground">{option.description}</span>
		</button>)}
	</>;
}
