import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Inter, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import { connection } from "next/server";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { PluginsProvider } from "@/components/plugins";
import { readThemeBoot } from "@/src/server";

// HarnessAcademico (guía de diseño, decisión de David del 23-nov-2026):
// interfaz y prosa = Atkinson Hyperlegible Next; JetBrains Mono solo para
// código; Source Sans 3 queda como fuente elegible. Titles = CMU Serif (the
// bundled lh-cmu @font-face in globals.css — no CDN).
// HarnessAcademico (24-nov-2026): Inter pasa a ser la letra de la app (aspecto «limpio» elegido por David);
// Atkinson y Source Sans 3 quedan como fuentes elegibles en Ajustes.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson" });
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

export const metadata: Metadata = {
	// HarnessAcademico (ux2 ticket 11b): the app's name in GLOSSARY.md.
	title: "Estudio",
	description: "Estudiar cualquier tema con un tutor de IA que critica lo que produces.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	// The theme is server-rendered — its class AND its color variables —
	// so no first frame ever shows the wrong theme. connection(): the
	// record and the theme files are per-machine disk state — without it a
	// prerendered route (settings) would bake the BUILD machine's record.
	await connection();
	const { appearance, theme, vars } = readThemeBoot();
	return (
		<html
			lang="es"
			className={`${theme.mode} ${inter.variable} ${atkinson.variable} ${ui.variable} ${prose.variable}`}
			style={vars as React.CSSProperties}
			suppressHydrationWarning
		>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<PluginsProvider>
					<AppearanceProvider initialAppearance={appearance} initialTheme={theme}>
						<SidebarProvider>
							<ActivityProvider>
								<AppShell>{children}</AppShell>
							</ActivityProvider>
						</SidebarProvider>
					</AppearanceProvider>
				</PluginsProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
