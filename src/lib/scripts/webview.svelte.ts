import { invoke } from "@tauri-apps/api/core";
import { PersistedState } from "runed";
import { getEnabledClientModules } from "$scripts/client-modules.svelte.js";

const incognito = new PersistedState("incognito", false);

export async function openWebview(url: string, id: string, title: string) {
	try {
		console.log("incognito", incognito.current);

		await invoke("open_webview", {
			url,
			id,
			title,
			incognito: incognito.current,
			modules: getEnabledClientModules()
		});
	} catch (error) {
		console.error("Failed to open webview:", error);
		throw error;
	}
}
