import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./pwa";

const root = document.getElementById("root")!;

// SEO 1B uses a browser-generated snapshot, not React server rendering. Clear that
// snapshot explicitly before createRoot boots the SPA; hydrateRoot would be unsafe
// because the captured DOM is not guaranteed to match a fresh client render.
if (root.dataset.prerendered === "true") root.replaceChildren();

createRoot(root).render(<App />);
registerServiceWorker();
