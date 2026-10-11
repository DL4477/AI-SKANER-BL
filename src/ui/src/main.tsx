import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SystemPromptWindow from "./model/SystemPromptWindow";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get("view") ===
    "system-prompt" ? (
      <SystemPromptWindow />
    ) : (
      <App />
    )}
  </StrictMode>,
);
