"use client";

import { RefreshCw, Settings } from "lucide-react";
import { usePlugins } from "@/components/plugins";
import type { FrontendPlugin } from "@/components/plugin-manager";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsSection, Toggle } from "./controls";

export const PLUGIN_TRUST_WARNING = "Activa solo plugins de confianza. Un plugin ejecuta código local con acceso amplio a archivos y red, sin aislamiento. Si uno falla, puede que haya que reiniciar la app.";

export function PluginsSection({ onOpenSettings, origin = "community" }: { onOpenSettings?: (pluginId: string) => void; origin?: "core" | "community" }) {
	const { manager, snapshot } = usePlugins();
	const core = origin === "core";
	const plugins = snapshot.plugins.filter(plugin => plugin.info.origin === origin);
	return <SettingsSection title={core ? "Plugins de núcleo" : "Plugins de la comunidad"} testid={core ? "section-core-plugins" : "section-plugins"}>
		{!core && <>
		<p className="font-prose text-sm text-muted-foreground">{PLUGIN_TRUST_WARNING}</p>
		<details data-testid="plugin-install-help" className="text-xs text-muted-foreground">
			<summary className="anillo-foco w-fit cursor-pointer list-none text-muted-foreground underline underline-offset-2 hover:text-foreground [&::-webkit-details-marker]:hidden">Cómo instalar un plugin</summary>
			<ol className="mt-2 list-decimal space-y-2 pl-5">
				<li>Clona o copia el plugin en la carpeta de abajo, con su identificador como nombre de carpeta.</li>
				<li>Si es código fuente, instala sus dependencias como indique el repositorio y ejecuta <code>npm run build</code>. Un paquete ya construido trae <code>dist/manifest.json</code> y no necesita construirse.</li>
				<li>Actualiza la lista y activa el plugin. Los plugins nuevos llegan desactivados.</li>
				<li>Reinicia la app después de cambiar código ya cargado. Al actualizar, conserva <code>data/</code> junto a <code>dist/</code>.</li>
			</ol>
		</details>
		<div data-testid="plugin-authoring-help" className="space-y-2 border-t border-border/60 pt-3">
			<h3 className="text-xs uppercase tracking-widest">Crear un plugin</h3>
			<p className="font-prose text-sm text-muted-foreground">Descarga la skill de autoría para tu agente de programación.</p>
			<Button variant="outline" size="sm" asChild><a className="anillo-foco" href="/plugin-authoring/learnharness-plugins.zip" download={`learnharness-plugins-${process.env.LH_VERSION ?? "authoring"}.zip`} data-testid="download-plugin-authoring">Descargar la skill de autoría</a></Button>
		</div>
		<div data-testid="plugin-directory" className="border-t border-border/60 pt-3">
			<p className="text-xs text-muted-foreground">Carpeta de plugins</p>
			<div className="mt-1 flex items-center gap-3">
				<code className="min-w-0 flex-1 break-all text-xs select-text">{snapshot.directory}</code>
				<Button variant="outline" size="icon-sm" aria-label="Actualizar la lista de plugins" title="Actualizar la lista de plugins" aria-busy={snapshot.refreshing}
					disabled={!manager || snapshot.refreshing || snapshot.plugins.some(plugin => plugin.busy)} onClick={() => void manager?.refresh()}>
					<RefreshCw aria-hidden="true" className={snapshot.refreshing ? "animate-spin" : undefined} />
				</Button>
			</div>
		</div>
		{snapshot.conflicts.map(conflict => <p role="alert" key={conflict.id} className="break-words text-xs text-destructive">{conflict.error}</p>)}
		</>}
		{snapshot.error && <p role="alert" className="text-xs text-destructive">{snapshot.error}</p>}
		{snapshot.loading ? <p role="status" className="text-xs text-muted-foreground">Cargando plugins…</p>
			: plugins.length === 0 ? <p className="text-xs text-muted-foreground">{core ? "No hay plugins de núcleo." : "No hay plugins de la comunidad instalados."}</p>
				: plugins.map(plugin => <PluginRow key={plugin.info.id} plugin={plugin}
					onSettings={() => onOpenSettings?.(plugin.info.id)} />)}
	</SettingsSection>;
}

function PluginRow({ plugin, onSettings }: { plugin: FrontendPlugin; onSettings: () => void }) {
	const { manager, snapshot } = usePlugins();
	const { info } = plugin;
	const name = info.manifest?.name ?? info.id;
	return <div className="border-t border-border/60 pt-3" data-testid={`plugin-${info.id}`}>
		<SettingsRow label={name} hint={[info.origin === "community" ? info.manifest?.version : undefined, plugin.busy ? "Guardando…" : plugin.error ? "Error" : plugin.phase === "loading" ? "Cargando…" : info.enabled ? "Activado" : "Desactivado"].filter(Boolean).join(" · ")}>
			<div className="flex shrink-0 items-center gap-2">
				{info.enabled && <button type="button" aria-label={`Ajustes de ${name}`} title={`Ajustes de ${name}`}
					className="anillo-foco flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					onClick={onSettings}><Settings className="size-3.5" aria-hidden="true" /></button>}
				<Toggle label={`Activar ${name}`} checked={info.enabled} disabled={!manager || plugin.busy || snapshot.refreshing || (!info.manifest && !info.enabled)} onChange={enabled => void manager?.setEnabled(info.id, enabled)} />
			</div>
		</SettingsRow>
		{info.manifest?.description && <p className="mt-1 font-prose text-sm text-muted-foreground">{info.manifest.description}</p>}
		{plugin.error && <p role="alert" className="mt-2 break-words text-xs text-destructive">{plugin.error}</p>}
	</div>;
}
