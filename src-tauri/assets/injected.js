window.addEventListener("load", () => {
  const wait = setInterval(() => {
    console.log("qby - try hooks exists");
    if (window.Hooks) {
      clearInterval(wait);
      console.log("qby - hooks exist");

      Hooks.once("ready", () => {
        console.log("Foundry is ready");
      });
    }
  }, 50);
});