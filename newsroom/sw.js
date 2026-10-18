/* Lets browsers offer "Install" for this site. Nothing is cached: every page and video still loads fresh. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
