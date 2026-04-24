import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PublicEntryPage } from "./components/PublicEntryPage";
import "./styles.css";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const RootComponent = pathname === "/entry" ? PublicEntryPage : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
