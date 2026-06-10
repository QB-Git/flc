<script lang="ts">
	import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
	import {
		ArrowDownIcon,
		ArrowUpIcon,
		FolderPlusIcon,
		RefreshCcwIcon,
		SquareDashedIcon,
		Trash2Icon
	} from "@lucide/svelte";

	import { Badge } from "$ui/badge/index.js";
	import { Button } from "$ui/button/index.js";
	import * as Empty from "$ui/empty/index.js";
	import { Switch } from "$ui/switch/index.js";
	import * as Alert from "$ui/alert/index.js";
	import {
		clientModules,
		deleteClientModule,
		getSortedClientModules,
		importClientModule,
		moveClientModule,
		reimportClientModule,
		setClientModuleEnabled,
		type ClientModule
	} from "$scripts/client-modules.svelte.js";

	let error = $state<string>("");
	let importing = $state<boolean>(false);
	let reimportingId = $state<string>("");
	let modules = $derived(getSortedClientModules());

	async function handleImportModule() {
		const path = await tauriOpen({
			directory: true,
			multiple: false,
			title: "Select Foundry module directory"
		});

		if (!path || Array.isArray(path)) {
			return;
		}

		importing = true;
		error = "";

		try {
			await importClientModule(path);
		} catch (caughtError) {
			error = caughtError instanceof Error ? caughtError.message : String(caughtError);
		} finally {
			importing = false;
		}
	}

	async function handleReimportModule(clientModule: ClientModule) {
		reimportingId = clientModule.id;
		error = "";

		try {
			await reimportClientModule(clientModule.id);
		} catch (caughtError) {
			error = caughtError instanceof Error ? caughtError.message : String(caughtError);
		} finally {
			reimportingId = "";
		}
	}
</script>

<section class="space-y-4">
	<Button
		onclick={handleImportModule}
		disabled={importing}
		variant="outline"
		class="bg-secondary/20 w-full">
		<FolderPlusIcon />
		{importing ? "Importing Module" : "Import Module"}
	</Button>

	{#if error}
		<Alert.Root variant="destructive">
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if modules.length}
		<div class="grid gap-3">
			{#each modules as clientModule, index (clientModule.id)}
				<div
					class="bg-muted/40 flex min-h-28 w-full items-center gap-2 rounded-md border p-1.5 shadow-sm">
					<div class="grid gap-1">
						<Button
							onclick={() => moveClientModule(clientModule.id, "up")}
							disabled={index === 0}
							class="hover:text-primary"
							size="icon"
							variant="outline"
							title="Move Up"><ArrowUpIcon /></Button>
						<Button
							onclick={() => moveClientModule(clientModule.id, "down")}
							disabled={index === modules.length - 1}
							class="hover:text-primary"
							size="icon"
							variant="outline"
							title="Move Down"><ArrowDownIcon /></Button>
					</div>

					<div class="bg-accent/50 ring-border min-w-0 flex-1 rounded-md px-4 py-3 ring-1">
						<div class="grid gap-2">
							<div class="flex min-w-0 items-start justify-between gap-3">
								<div class="min-w-0">
									<h1 class="overflow-hidden font-semibold text-nowrap text-ellipsis">
										{clientModule.title}
									</h1>
									<p
										class="text-muted-foreground overflow-hidden text-xs text-nowrap text-ellipsis">
										{clientModule.rootPath}
									</p>
								</div>
								<Switch
									checked={clientModule.enabled}
									onCheckedChange={(enabled) => setClientModuleEnabled(clientModule.id, enabled)}
									aria-label="Toggle module" />
							</div>

							<div class="flex flex-wrap gap-1 text-xs">
								<Badge variant="outline">{clientModule.manifestId}</Badge>
								{#if clientModule.version}
									<Badge variant="outline">{clientModule.version}</Badge>
								{/if}
								<Badge variant="outline">{clientModule.scripts.length} scripts</Badge>
								<Badge variant="outline">{clientModule.esmodules.length} esmodules</Badge>
								<Badge variant="outline">{clientModule.styles.length} styles</Badge>
							</div>
						</div>
					</div>

					<div class="grid gap-1">
						<Button
							onclick={() => handleReimportModule(clientModule)}
							disabled={reimportingId === clientModule.id}
							class="hover:text-primary"
							size="icon"
							variant="outline"
							title="Reimport Module"><RefreshCcwIcon /></Button>
						<Button
							onclick={() => deleteClientModule(clientModule.id)}
							class="hover:text-destructive"
							variant="outline"
							size="icon"
							title="Delete Module"><Trash2Icon /></Button>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<Empty.Root class="border border-dashed">
			<Empty.Header>
				<Empty.Media variant="icon">
					<SquareDashedIcon />
				</Empty.Media>
				<Empty.Title>No Modules</Empty.Title>
				<Empty.Description
					>Import a Foundry module directory to inject it in game.</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{/if}
</section>
