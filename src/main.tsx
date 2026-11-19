import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { windowKind } from "./services/desktopBridge";
import "./styles/retro-theme.css";
import "./styles/global.css";
import { MainApp } from "./windows/MainApp";
import { OverlayApp } from "./windows/OverlayApp";

// Warm the pixel face so the first expansion of the HUD never flashes a fallback font.
for (const face of ['16px "Pixelify Sans"', '700 16px "Pixelify Sans"']) {
  void document.fonts.load(face).catch(() => undefined);
}

// The default webview menu (Back, Reload, Inspect) would look out of place; keep copy/paste where text lives.
window.addEventListener("contextmenu", (event) => {
  const target = event.target;
  const editable = target instanceof Element && target.closest("input, textarea, .selectable") !== null;
  if (!editable) event.preventDefault();
});

const container = document.getElementById("root");
if (container === null) {
  throw new Error("ClickySketch: #root is missing from index.html");
}

createRoot(container).render(<StrictMode>{windowKind() === "main" ? <MainApp /> : <OverlayApp />}</StrictMode>);
