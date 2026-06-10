(function () {
	const expectedOrigin = __FLC_EXPECTED_ORIGIN__;
	const modules = __FLC_MODULES__;

	function isTargetPage() {
		const pathname = window.location.pathname.replace(/\/+$/, "");
		return (
			window.location.origin === expectedOrigin &&
			(pathname === "/game" || pathname.endsWith("/game"))
		);
	}

	if (!isTargetPage()) {
		return;
	}

	const loaderKey = "__flcModuleLoader:" + expectedOrigin + ":" + window.location.pathname;
	if (window[loaderKey]) {
		return;
	}
	window[loaderKey] = true;
	window.__flcModuleAssets = window.__flcModuleAssets || {};

	function whenHeadReady(callback) {
		if (document.head) {
			callback();
			return;
		}

		const observer = new MutationObserver(function () {
			if (document.head) {
				observer.disconnect();
				callback();
			}
		});
		observer.observe(document.documentElement || document, { childList: true, subtree: true });
	}

	function isFoundryRuntimeReady() {
		return Boolean(window.Hooks?.once && window.foundry?.applications?.handlebars?.renderTemplate);
	}

	function whenFoundryRuntimeReady(callback) {
		const startedAt = Date.now();

		function tick() {
			if (isFoundryRuntimeReady()) {
				callback();
				return;
			}

			if (Date.now() - startedAt > 30000) {
				console.error("[FLC] Timed out waiting for Foundry runtime before injecting modules");
				return;
			}

			window.setTimeout(tick, 25);
		}

		tick();
	}

	function markLoaded(key) {
		window.__flcModuleAssets[key] = true;
	}

	function isLoaded(key) {
		return window.__flcModuleAssets[key] === true;
	}

	function loadStyle(asset, moduleId) {
		if (isLoaded(asset.id)) {
			return;
		}

		const style = document.createElement("style");
		style.dataset.flcModuleId = moduleId;
		style.dataset.flcModulePath = asset.path;
		style.textContent = asset.source + "\n/*# sourceURL=" + asset.sourceUrl + " */";
		document.head.appendChild(style);
		markLoaded(asset.id);
	}

	function loadScript(asset, moduleId) {
		if (isLoaded(asset.id)) {
			return;
		}

		const script = document.createElement("script");
		script.dataset.flcModuleId = moduleId;
		script.dataset.flcModulePath = asset.path;
		script.textContent = asset.source + "\n//# sourceURL=" + asset.sourceUrl;

		try {
			document.head.appendChild(script);
			markLoaded(asset.id);
		} catch (error) {
			console.error("[FLC] Failed to run module script", asset.path, error);
		}
	}

	function installTemplateShim() {
		const handlebars = window.foundry?.applications?.handlebars;

		if (!handlebars) {
			return;
		}

		const templates = window.__flcTemplateSources || new Map();
		window.__flcTemplateSources = templates;

		function addTemplate(path, source) {
			const normalizedPath = String(path).replace(/^\/+/, "");
			templates.set(normalizedPath, source);
			templates.set(decodeURIComponent(normalizedPath), source);

			const modulesIndex = normalizedPath.indexOf("modules/");
			if (modulesIndex >= 0) {
				templates.set(normalizedPath.slice(modulesIndex), source);
			}
		}

		for (const module of modules) {
			for (const template of module.templates) {
				addTemplate(template.path, template.source);

				if (module.id !== module.manifestId) {
					addTemplate(
						template.path.replace("/" + module.manifestId + "/", "/" + module.id + "/"),
						template.source
					);
				}
			}
		}

		if (templates.size === 0 || handlebars.__flcTemplateShimInstalled) {
			return;
		}

		const originalRenderTemplate = handlebars.renderTemplate.bind(handlebars);

		function escapeHtml(value) {
			return String(value ?? "")
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		function getTemplateValue(data, path) {
			return String(path)
				.split(".")
				.reduce(function (value, key) {
					return value == null ? undefined : value[key];
				}, data);
		}

		function renderSimpleTemplate(source, data) {
			return source
				.replace(
					/\{\{#if\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
					function (_match, key, content) {
						return getTemplateValue(data, key) ? content : "";
					}
				)
				.replace(
					/\{\{\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}\}\}/g,
					function (_match, key) {
						return String(getTemplateValue(data, key) ?? "");
					}
				)
				.replace(
					/\{\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}\}/g,
					function (_match, key) {
						return escapeHtml(getTemplateValue(data, key));
					}
				);
		}

		function findLocalTemplate(path) {
			const normalizedPath = String(path).replace(/^\/+/, "");
			const modulesIndex = normalizedPath.indexOf("modules/");
			return {
				normalizedPath,
				source:
					templates.get(normalizedPath) ||
					templates.get(decodeURIComponent(normalizedPath)) ||
					(modulesIndex >= 0 ? templates.get(normalizedPath.slice(modulesIndex)) : undefined)
			};
		}

		async function flcRenderTemplate(path, data) {
			const { normalizedPath, source } = findLocalTemplate(path);

			if (!source) {
				console.warn(
					"[FLC] Local template not found, falling back to Foundry",
					normalizedPath,
					Array.from(templates.keys())
				);
				return originalRenderTemplate(path, data);
			}

			const runtime = window.Handlebars || handlebars.Handlebars;

			if (runtime?.compile) {
				return runtime.compile(source)(data || {});
			}

			return renderSimpleTemplate(source, data || {});
		}

		window.__flcHandlebars = Object.create(handlebars);
		window.__flcHandlebars.renderTemplate = flcRenderTemplate;
		window.__flcRenderTemplate = flcRenderTemplate;

		try {
			handlebars.renderTemplate = flcRenderTemplate;
		} catch (error) {
			console.warn("[FLC] Failed to replace Foundry renderTemplate", error);
		}

		handlebars.__flcTemplateShimInstalled = true;
		console.debug("[FLC] Local template shim installed", Array.from(templates.keys()));
	}

	function escapeRegExp(value) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function parseNamedImportBindings(bindings, targetId) {
		const replacements = [];

		for (const binding of bindings.split(",")) {
			const trimmed = binding.trim();

			if (!trimmed) {
				continue;
			}

			const parts = trimmed.split(/\s+as\s+/);
			const exportedName = parts[0].trim();
			const localName = (parts[1] || parts[0]).trim();

			if (/^[A-Za-z_$][\w$]*$/.test(localName) && /^[A-Za-z_$][\w$]*$/.test(exportedName)) {
				replacements.push({
					localName,
					expression: "__flcRequire(" + JSON.stringify(targetId) + ")." + exportedName
				});
			}
		}

		return replacements;
	}

	function replaceIdentifier(source, identifier, expression) {
		return source.replace(
			new RegExp("(^|[^A-Za-z0-9_$])" + escapeRegExp(identifier) + "(?![A-Za-z0-9_$])", "g"),
			function (match, prefix) {
				if (prefix === ".") {
					return match;
				}

				return prefix + "(" + expression + ")";
			}
		);
	}

	function transformModuleSource(asset) {
		let source = asset.source;
		const importedBindings = [];
		const exportedNames = [];

		for (const moduleImport of asset.imports) {
			const targetId = moduleImport.targetId;
			const specifier = escapeRegExp(moduleImport.specifier);
			const namedImportPattern = new RegExp(
				"import\\s*\\{([^}]+)\\}\\s*from\\s*(['\"])" + specifier + "\\2\\s*;?",
				"g"
			);
			const namespaceImportPattern = new RegExp(
				"import\\s+\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*(['\"])" + specifier + "\\2\\s*;?",
				"g"
			);
			const sideEffectImportPattern = new RegExp(
				"import\\s*(['\"])" + specifier + "\\1\\s*;?",
				"g"
			);

			source = source.replace(namedImportPattern, function (_match, bindings) {
				importedBindings.push(...parseNamedImportBindings(bindings, targetId));
				return "";
			});
			source = source.replace(namespaceImportPattern, function (_match, localName) {
				importedBindings.push({
					localName,
					expression: "__flcRequire(" + JSON.stringify(targetId) + ")"
				});
				return "";
			});
			source = source.replace(sideEffectImportPattern, function () {
				return "__flcRequire(" + JSON.stringify(targetId) + ");";
			});
		}

		source = source.replace(
			/\bexport\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/g,
			function (_match, kind, name) {
				exportedNames.push(name);
				return kind + " " + name;
			}
		);
		source = source.replace(
			/\bexport\s+(class|function)\s+([A-Za-z_$][\w$]*)/g,
			function (_match, kind, name) {
				exportedNames.push(name);
				return kind + " " + name;
			}
		);
		source = source.replace(/\bexport\s*\{([^}]+)\}\s*;?/g, function (_match, bindings) {
			for (const binding of bindings.split(",")) {
				const trimmed = binding.trim();

				if (!trimmed) {
					continue;
				}

				const parts = trimmed.split(/\s+as\s+/);
				const localName = parts[0].trim();
				const exportedName = (parts[1] || parts[0]).trim();

				if (/^[A-Za-z_$][\w$]*$/.test(localName) && /^[A-Za-z_$][\w$]*$/.test(exportedName)) {
					source += "\n__exports[" + JSON.stringify(exportedName) + "] = " + localName + ";";
				}
			}

			return "";
		});

		source = source.replace(
			/\b(const|let|var)\s*\{\s*renderTemplate\s*\}\s*=\s*foundry\.applications\.handlebars\s*;?/g,
			function (_match, kind) {
				return (
					kind +
					" renderTemplate = window.__flcRenderTemplate || (() => { const handlebars = window.__flcHandlebars || window['foundry'].applications.handlebars; return handlebars.renderTemplate.bind(handlebars); })();"
				);
			}
		);

		for (const importedBinding of importedBindings) {
			source = replaceIdentifier(source, importedBinding.localName, importedBinding.expression);
		}

		source = source.replace(
			/(^|[^A-Za-z0-9_$.])foundry\.applications\.handlebars\b/g,
			function (_match, prefix) {
				return prefix + "(window.__flcHandlebars || foundry.applications.handlebars)";
			}
		);

		for (const exportedName of exportedNames) {
			source += "\n__exports[" + JSON.stringify(exportedName) + "] = " + exportedName + ";";
		}

		return source + "\n//# sourceURL=" + asset.sourceUrl;
	}

	function loadEsmodules(module) {
		const registry = new Map();

		for (const asset of module.esmodules) {
			registry.set(asset.id, {
				asset,
				exports: {},
				loaded: false,
				loading: false
			});
		}

		function requireModule(moduleId) {
			const record = registry.get(moduleId);

			if (!record) {
				throw new Error("Missing local ES module dependency: " + moduleId);
			}

			if (record.loaded || record.loading) {
				return record.exports;
			}

			record.loading = true;
			try {
				new Function("__exports", "__flcRequire", transformModuleSource(record.asset))(
					record.exports,
					requireModule
				);
				record.loaded = true;
			} finally {
				record.loading = false;
			}

			return record.exports;
		}

		for (const entryId of module.esmoduleEntries) {
			if (isLoaded(entryId)) {
				continue;
			}

			try {
				requireModule(entryId);
				markLoaded(entryId);
			} catch (error) {
				const entry = registry.get(entryId)?.asset;
				console.error("[FLC] Failed to run module script", entry?.path || entryId, error);
			}
		}
	}

	function injectModules() {
		installTemplateShim();

		for (const module of modules) {
			for (const style of module.styles) {
				loadStyle(style, module.id);
			}
			for (const script of module.scripts) {
				loadScript(script, module.id);
			}
			loadEsmodules(module);
		}
	}

	whenHeadReady(function () {
		whenFoundryRuntimeReady(function () {
			try {
				injectModules();
			} catch (error) {
				console.error("[FLC] Failed to inject client modules", error);
			}
		});
	});
})();
