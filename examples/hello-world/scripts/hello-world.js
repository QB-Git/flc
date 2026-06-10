(function () {
	function showHelloWorld() {
		if (globalThis.ui?.notifications?.info) {
			globalThis.ui.notifications.info("Hello World");
		}

		if (document.getElementById("flc-hello-world-banner")) {
			return;
		}

		const banner = document.createElement("div");
		banner.id = "flc-hello-world-banner";
		banner.textContent = "Hello World";
		document.body.appendChild(banner);
	}

	if (globalThis.Hooks?.once) {
		globalThis.Hooks.once("ready", showHelloWorld);
	} else if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", showHelloWorld, { once: true });
	} else {
		showHelloWorld();
	}
})();
