"use client";

import { useState } from "react";
import { Brand } from "./Brand";
import { Icon } from "./icons";
import { LicensePanel } from "./LicensePanel";
import { SyncPanel } from "./SyncPanel";

type Tab = "sync" | "licenses";

export function AppShell() {
  const [tab, setTab] = useState<Tab>("sync");

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Brand subtitle="Bases de datos y licencias" />
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "sync"}
              className={tab === "sync" ? "active" : ""}
              onClick={() => setTab("sync")}
            >
              <Icon name="refresh" size={15} /> Sincronizar
            </button>
            <button
              role="tab"
              aria-selected={tab === "licenses"}
              className={tab === "licenses" ? "active" : ""}
              onClick={() => setTab("licenses")}
            >
              <Icon name="key" size={15} /> Licencias
            </button>
          </div>
          <button className="ghost" onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión">
            <Icon name="logout" size={15} /> <span className="hide-sm">Cerrar sesión</span>
          </button>
        </div>
      </header>

      <main>
        {/* Ambas quedan montadas para no perder un proceso en curso al cambiar de pestaña */}
        <div hidden={tab !== "sync"}>
          <SyncPanel />
        </div>
        <div hidden={tab !== "licenses"}>
          <LicensePanel active={tab === "licenses"} />
        </div>
      </main>
    </>
  );
}
