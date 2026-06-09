import { MY_CONST } from "./settings.js";

console.log("Test plugin loaded");
console.log(MY_CONST);

window.FLC.register({
  id: "test-plugin",
  onReady() {
    console.log("[TestPlugin] Foundry is ready!");

    Hooks.on("chatMessage", (chatLog, message) => {
      console.log("[TestPlugin] chat:", message);
    });
  }
});