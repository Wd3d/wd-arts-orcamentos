self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", () => {
  // noop
});
self.addEventListener("fetch", (e) => {
  // rede primeiro; se quiser cache, podemos evoluir depois
});
