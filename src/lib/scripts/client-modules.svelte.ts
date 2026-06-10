import { invoke } from "@tauri-apps/api/core";
import { PersistedState } from "runed";
import * as z from "zod";

const ClientModuleSchema = z.object({
	id: z.string(),
	manifestId: z.string(),
	title: z.string().trim().min(1),
	version: z.string().optional(),
	rootPath: z.string().trim().min(1),
	scripts: z.array(z.string()),
	esmodules: z.array(z.string()),
	styles: z.array(z.string()),
	enabled: z.boolean(),
	order: z.number()
});

const ImportedFoundryModuleSchema = z.object({
	id: z.string(),
	title: z.string(),
	version: z.string().optional(),
	rootPath: z.string(),
	scripts: z.array(z.string()),
	esmodules: z.array(z.string()),
	styles: z.array(z.string())
});

export type ClientModule = z.infer<typeof ClientModuleSchema>;
export type ImportedFoundryModule = z.infer<typeof ImportedFoundryModuleSchema>;

export const clientModules = new PersistedState<ClientModule[]>("client-modules", []);

export async function importClientModule(path: string) {
	const imported = await invoke<ImportedFoundryModule>("import_foundry_module", { path });
	const result = ImportedFoundryModuleSchema.safeParse(imported);

	if (!result.success) {
		throw new Error(z.prettifyError(result.error));
	}

	return addOrUpdateClientModule(result.data);
}

export async function reimportClientModule(id: string) {
	const existing = clientModules.current.find((clientModule) => clientModule.id === id);

	if (!existing) {
		throw new Error("Module not found");
	}

	const imported = await invoke<ImportedFoundryModule>("import_foundry_module", {
		path: existing.rootPath
	});
	const result = ImportedFoundryModuleSchema.safeParse(imported);

	if (!result.success) {
		throw new Error(z.prettifyError(result.error));
	}

	clientModules.current = clientModules.current.map((clientModule) =>
		clientModule.id === id ? updateClientModuleFromImport(clientModule, result.data) : clientModule
	);

	return result.data;
}

export function deleteClientModule(id: string) {
	clientModules.current = clientModules.current.filter((clientModule) => clientModule.id !== id);
}

export function setClientModuleEnabled(id: string, enabled: boolean) {
	clientModules.current = clientModules.current.map((clientModule) =>
		clientModule.id === id ? { ...clientModule, enabled } : clientModule
	);
}

export function moveClientModule(id: string, direction: "up" | "down") {
	const modules = getSortedClientModules();
	const index = modules.findIndex((clientModule) => clientModule.id === id);
	const targetIndex = direction === "up" ? index - 1 : index + 1;

	if (index < 0 || targetIndex < 0 || targetIndex >= modules.length) {
		return;
	}

	const [module] = modules.splice(index, 1);
	modules.splice(targetIndex, 0, module);

	clientModules.current = modules.map((clientModule, order) => ({ ...clientModule, order }));
}

export function getSortedClientModules() {
	return [...clientModules.current].sort((a, b) => a.order - b.order);
}

export function getEnabledClientModules() {
	return getSortedClientModules().filter((clientModule) => clientModule.enabled);
}

function addOrUpdateClientModule(imported: ImportedFoundryModule) {
	const existing = clientModules.current.find(
		(clientModule) =>
			clientModule.manifestId === imported.id || clientModule.rootPath === imported.rootPath
	);

	if (existing) {
		clientModules.current = clientModules.current.map((clientModule) =>
			clientModule.id === existing.id
				? updateClientModuleFromImport(clientModule, imported)
				: clientModule
		);

		return existing.id;
	}

	clientModules.current = [
		...clientModules.current,
		{
			id: createClientModuleId(),
			manifestId: imported.id,
			title: imported.title,
			version: imported.version,
			rootPath: imported.rootPath,
			scripts: imported.scripts,
			esmodules: imported.esmodules,
			styles: imported.styles,
			enabled: true,
			order: clientModules.current.length
		}
	];
}

function updateClientModuleFromImport(clientModule: ClientModule, imported: ImportedFoundryModule) {
	return {
		...clientModule,
		manifestId: imported.id,
		title: imported.title,
		version: imported.version,
		rootPath: imported.rootPath,
		scripts: imported.scripts,
		esmodules: imported.esmodules,
		styles: imported.styles
	};
}

function createClientModuleId() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`module-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}
