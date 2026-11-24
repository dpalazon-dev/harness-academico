"use client";

import type { FrontendPlugin } from "@/components/plugin-manager";
import { PluginMountPoint } from "@/components/plugins";
import { PluginSettingsRows } from "@/components/plugin-ui-host";
import { SettingsSection } from "./controls";
import { AportacionEstudio } from "@/components/estudio/aportacion";

/** Plugin persistence belongs to the registration; the host only presents it. */
export function PluginSettingsPage({ plugin }: { plugin: FrontendPlugin }) {
	const { info, settings } = plugin;
	const name = info.manifest?.name ?? info.id;
	return <SettingsSection title={name} testid={`section-plugin-${info.id}`}>
		{plugin.error && <p role="alert" className="break-words text-xs text-destructive">{plugin.error}</p>}
		{plugin.phase === "loading" ? <p role="status" className="text-xs text-muted-foreground">Cargando los ajustes del plugin…</p>
			: plugin.phase === "error" ? !plugin.error && <p role="alert" className="text-xs text-destructive">No se pudieron cargar los ajustes del plugin.</p>
				// HarnessAcademico: Estudio no tiene ajustes, pero muestra lo que aporta al tutor.
				: !settings && info.id === "estudio" ? <AportacionEstudio />
				: !settings ? <p className="text-xs text-muted-foreground">Este plugin no tiene ajustes.</p>
					: typeof settings === "function" ? <PluginMountPoint pluginId={info.id} mount={settings} label={`Ajustes de ${name}`} />
						: <PluginSettingsRows schema={settings} />}
	</SettingsSection>;
}
