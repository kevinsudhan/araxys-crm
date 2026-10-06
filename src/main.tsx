import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import "./index.css";

/*
  The service worker (public/sw.js) is what lets the home-screen app open like
  an app, and quickly. Production only: in development it would cache the
  modules the dev server is changing under it.
*/
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/*
  After a release, a tab still open on the last one asks for a page's file by
  its old name, which is gone: Vite says so with this event. The app reloads
  once to the new release rather than leaving a page that will not open; a
  second failure in the same minute is left to show its error (6 Oct).
*/
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("araxys:reloaded-for-release") ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("araxys:reloaded-for-release", String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
