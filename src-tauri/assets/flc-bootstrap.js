console.log("[FLC] bootstrap loaded");

/**
 * Global FLC runtime
 */
window.FLC = {
  modules: new Map(),

  registerModule(mod) {
    this.modules.set(mod.id, mod);
    console.log(`[FLC] module registered: ${mod.id}`);
  },

  getModule(id) {
    return this.modules.get(id);
  },

  enable(id) {
    const m = this.modules.get(id);
    if (m) m.enabled = true;
  },

  disable(id) {
    const m = this.modules.get(id);
    if (m) m.enabled = false;
  }
};

async function loadModules() {
  console.log("[FLC] loading modules...");

  // liste manuelle pour commencer (stable)
  const moduleList = await fetch("/modules/modules.json")
    .then(r => r.json())
    .catch(() => []);

  for (const mod of moduleList) {
    if (mod.enabled === false) continue;

    try {
      const url = `/modules/${mod.id}/${mod.main}`;

      const script = document.createElement("script");
      script.src = url;

      script.onload = () => {
        console.log(`[FLC] loaded module: ${mod.id}`);
      };

      document.head.appendChild(script);

    } catch (e) {
      console.error("[FLC] module error", mod.id, e);
    }
  }
}

Hooks.once("ready", async () => {
  console.log("[FLC] Foundry ready → loading modules");

  await loadModules();

  // init modules
  for (const mod of FLC.modules.values()) {
    if (mod.init) mod.init();
  }
});