import { registerSW } from "virtual:pwa-register";

export function registerRailTalkServiceWorker(): void {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("railtalk-update-available"));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("railtalk-offline-ready"));
    }
  });
}
