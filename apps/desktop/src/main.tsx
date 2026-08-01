import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./zhiji/App";
import "./zhiji/styles/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到应用根节点");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
