import { invoke } from "@tauri-apps/api/core";
import { getAllWindows } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";

async function toggleFullscreen() {
	const windows = await getAllWindows();
	const foundryWindows = windows.filter((window) => window.label.includes("foundry"));

	for (const window of foundryWindows) {
		const fullscreen = await window.isFullscreen();
		await window.setFullscreen(!fullscreen);
	}
}

export async function registerShortcuts() {
	await unregisterAll();

	await register("CommandOrControl+F11", async (event) => {
		//console.log(event.state);
		if (event.state === "Pressed") {
			await toggleFullscreen();
		}
	});

	await register("CommandOrControl+Alt+I", async (event) => {
		if (event.state === "Pressed") {
			await openFoundryDevtools();
		}
	});
}

export async function openFoundryDevtools() {
	try {
		await invoke("open_foundry_devtools");
	} catch (error) {
		console.error("Failed to open Foundry devtools:", error);
	}
}
