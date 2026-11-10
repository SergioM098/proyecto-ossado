"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon, type IconName, Spinner } from "./icons";
import { CompanyPicker, type PickerItem, toSearchText } from "./CompanyPicker";

interface PublicConnection {
  id: string;
  serverId: string;
  serverLabel: string;
  database: string;
  nit: string | null;
  nombre: string | null;
}

interface ServerError {
  serverLabel: string;
  error: string;
}

// "NIT - Nombre", o el nombre de la base si no tiene datos en la tabla empresas
function companyLabel(c: PublicConnection): string {
  if (c.nit && c.nombre) return `${c.nit} - ${c.nombre}`;
  return c.nombre ?? c.nit ?? c.database;
}

// Agrupadas por servidor; dentro de cada uno, primero las que tienen NIT y nombre
function toPickerItems(connections: PublicConnection[]): PickerItem[] {
  return [...connections]
    .sort(
      (a, b) =>
        a.serverLabel.localeCompare(b.serverLabel, "es") ||
        Number(!a.nombre) - Number(!b.nombre) ||
        companyLabel(a).localeCompare(companyLabel(b), "es")
    )
    .map((c) => ({
      id: c.id,
      label: companyLabel(c),
      detail: `Base ${c.database}`,
      group: c.serverLabel,
      search: toSearchText(c.nit, c.nombre, c.database),
    }));
}

interface Lists {
  dataSyncTables: string[];
  schemaSyncDataTables: string[];
  billingProcedures: string[];
  generalProcedures: string[];
}

type OptionId = "1" | "2" | "3" | "4" | "5";

interface LogLine {
  kind: "info" | "ok" | "error" | "title";
  text: string;
}

interface Summary {
  tablesCreated: string[];
  columnsAdded: string[];
  rowsCopied: { table: string; rows: number }[];
  proceduresCreated: string[];
  proceduresSkipped: string[];
  errors: string[];
}

type ActionError = { action: string; error: string };

const OPTIONS: {
  id: OptionId;
  title: string;
  description: string;
  destructive: boolean;
  icon: IconName;
}[] = [
  {
    id: "1",
    title: "Sincronizar esquemas",
    description: "Crea tablas y columnas faltantes, y reemplaza la data de las tablas de esquemas.",
    destructive: true,
    icon: "table",
  },
  {
    id: "2",
    title: "Reemplazar data de opciones y formas",
    description: "Borra y copia la data de las tablas opcion*, formas, monedas, ciudades y paises_fe.",
    destructive: true,
    icon: "copy",
  },
  {
    id: "3",
    title: "Esquemas + data",
    description: "Ejecuta la opción 1 y luego la opción 2.",
    destructive: true,
    icon: "layers",
  },
  {
    id: "4",
    title: "Estructura de facturación",
    description: "Tablas y procedimientos de facturación, y reemplaza la data de opcion04.",
    destructive: true,
    icon: "receipt",
  },
  {
    id: "5",
    title: "Copiar procedimientos generales",
    description: "Crea los procedimientos que falten en el destino. No reemplaza los que ya existen.",
    destructive: false,
    icon: "code",
  },
];

const STORAGE_KEY = "ossado-sync-selection";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function emptySummary(): Summary {
  return {
    tablesCreated: [],
    columnsAdded: [],
    rowsCopied: [],
    proceduresCreated: [],
    proceduresSkipped: [],
    errors: [],
  };
}

function describeSteps(option: OptionId, lists: Lists): string[] {
  const schema = [
    "Crea las tablas que existan en origen y falten en destino",
    "Agrega las columnas que falten en las tablas que ya existen",
    `Borra y reemplaza la data de: ${lists.schemaSyncDataTables.join(", ")}`,
  ];
  const data = [
    `Borra y reemplaza la data de ${lists.dataSyncTables.length} tablas: ${lists.dataSyncTables.join(", ")}`,
  ];
  switch (option) {
    case "1":
      return schema;
    case "2":
      return data;
    case "3":
      return [...schema, ...data];
    case "4":
      return [
        "Crea o completa las tablas de facturacion (estructura_json_*, errores_fe_dian)",
        `Crea los procedimientos que falten: ${lists.billingProcedures.join(", ")}`,
        "Borra y reemplaza la data de opcion04",
      ];
    case "5":
      return [
        `Crea los procedimientos que falten: ${lists.generalProcedures.join(", ")}`,
        "Los que ya existen en destino no se tocan",
      ];
  }
}

export function SyncPanel() {
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [lists, setLists] = useState<Lists | null>(null);
  const [loadError, setLoadError] = useState("");
  const [serverErrors, setServerErrors] = useState<ServerError[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [running, setRunning] = useState<OptionId | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, setPending] = useState<OptionId | null>(null);
  const cancelRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function loadConnections() {
    setLoadingConnections(true);
    setLoadError("");
    try {
      const res = await fetch("/api/config");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar la configuracion");
      setConnections(data.connections);
      setServerErrors(data.serverErrors ?? []);
      setLists(data.lists);

      let saved: { sourceId?: string; targetId?: string } = {};
      try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      } catch {}
      const ids = new Set(data.connections.map((c: PublicConnection) => c.id));
      setSourceId((current) => {
        const id = current || saved.sourceId || "";
        return ids.has(id) ? id : "";
      });
      setTargetId((current) => {
        const id = current || saved.targetId || "";
        return ids.has(id) ? id : "";
      });
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoadingConnections(false);
    }
  }

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sourceId, targetId }));
    } catch {}
  }, [sourceId, targetId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const pickerItems = useMemo(() => toPickerItems(connections), [connections]);
  const source = connections.find((c) => c.id === sourceId);
  const target = connections.find((c) => c.id === targetId);
  const selectionError =
    sourceId && targetId && sourceId === targetId ? "Origen y destino deben ser distintos" : "";
  const canRun = !!source && !!target && !selectionError && !!lists && !running;

  async function run(option: OptionId) {
    if (!source || !target || !lists) return;

    cancelRef.current = false;
    setRunning(option);
    setLog([]);
    const sum = emptySummary();
    setSummary(sum);

    const add = (kind: LogLine["kind"], text: string) =>
      setLog((prev) => [...prev, { kind, text }]);
    const refresh = () => setSummary({ ...sum });
    const addErrors = (errors: ActionError[] = []) => {
      for (const e of errors) {
        add("error", `[ERROR] ${e.action}: ${e.error}`);
        sum.errors.push(`${e.action}: ${e.error}`);
      }
      refresh();
    };
    const checkCancel = () => {
      if (cancelRef.current) throw new Error("__cancelled__");
    };

    // Reintenta cuando falla al abrir la conexion (antes de ejecutar nada en la base),
    // asi un timeout momentaneo no corta todo el proceso.
    async function call<T>(body: Record<string, unknown>): Promise<T> {
      const delays = [2000, 5000, 10000];
      for (let attempt = 0; ; attempt++) {
        try {
          return await callOnce<T>(body);
        } catch (err) {
          const message = (err as Error).message;
          const retryable = /^connect E/.test(message);
          if (!retryable || attempt >= delays.length) throw err;
          add("info", `  Conexion fallo (${message}), reintentando en ${delays[attempt] / 1000}s...`);
          await new Promise((r) => setTimeout(r, delays[attempt]));
          checkCancel();
        }
      }
    }

    async function callOnce<T>(body: Record<string, unknown>): Promise<T> {
      const res = await fetch("/api/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId, ...body }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        throw new Error("Sesion expirada");
      }
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data.result as T;
    }

    // Si un grupo falla del todo, se reporta y se sigue con el siguiente
    async function callOrReport<T>(body: Record<string, unknown>, action: string): Promise<T | null> {
      try {
        return await call<T>(body);
      } catch (err) {
        if ((err as Error).message === "__cancelled__") throw err;
        addErrors([{ action, error: (err as Error).message }]);
        return null;
      }
    }

    async function createAndCompare(missing: string[], common: string[]) {
      add("title", `Tablas faltantes en destino: ${missing.length}`);
      for (const group of chunk(missing, 10)) {
        checkCancel();
        const r = await callOrReport<{ tablesCreated: string[]; errors: ActionError[] }>(
          { step: "create-tables", tables: group },
          `CREATE TABLE ${group.join(", ")}`
        );
        if (!r) continue;
        for (const t of r.tablesCreated) add("ok", `[OK] Tabla creada: ${t}`);
        sum.tablesCreated.push(...r.tablesCreated);
        addErrors(r.errors);
      }

      add("title", `Comparando columnas en ${common.length} tablas`);
      let done = 0;
      for (const group of chunk(common, 20)) {
        checkCancel();
        done += group.length;
        const r = await callOrReport<{ columnsAdded: { table: string; column: string }[]; errors: ActionError[] }>(
          { step: "add-columns", tables: group },
          `COMPARAR COLUMNAS ${group.join(", ")}`
        );
        if (!r) continue;
        for (const c of r.columnsAdded) add("ok", `[OK] Columna agregada: ${c.table}.${c.column}`);
        sum.columnsAdded.push(...r.columnsAdded.map((c) => `${c.table}.${c.column}`));
        addErrors(r.errors);
        add("info", `  ${done}/${common.length} tablas revisadas`);
      }
    }

    async function replaceData(tables: string[]) {
      for (const table of tables) {
        checkCancel();
        try {
          const r = await call<{ rows: number }>({ step: "replace-data", table });
          add("ok", `[DATA] ${table}: OK (${r.rows} filas)`);
          sum.rowsCopied.push({ table, rows: r.rows });
          refresh();
        } catch (err) {
          addErrors([{ action: `REEMPLAZAR DATA ${table}`, error: (err as Error).message }]);
        }
      }
    }

    async function createProcedures(names: string[]) {
      for (const name of names) {
        checkCancel();
        try {
          const r = await call<{
            proceduresCreated: string[];
            proceduresSkipped: string[];
            errors: ActionError[];
          }>({ step: "create-procedures", names: [name] });
          for (const p of r.proceduresCreated) add("ok", `[OK] Procedimiento creado: ${p}`);
          for (const p of r.proceduresSkipped) add("info", `[SKIP] Ya existe: ${p}`);
          sum.proceduresCreated.push(...r.proceduresCreated);
          sum.proceduresSkipped.push(...r.proceduresSkipped);
          addErrors(r.errors);
        } catch (err) {
          addErrors([{ action: `CREATE PROCEDURE ${name}`, error: (err as Error).message }]);
        }
      }
    }

    async function schemaSync() {
      add("title", "=== SINCRONIZACION DE ESQUEMAS ===");
      const plan = await call<{
        db1Count: number;
        db2Count: number;
        missingTables: string[];
        commonTables: string[];
      }>({ step: "schema-plan" });
      add("info", `Destino: ${plan.db1Count} tablas · Origen: ${plan.db2Count} tablas`);
      await createAndCompare(plan.missingTables, plan.commonTables);

      add("title", "Reemplazando data de tablas de esquemas");
      await replaceData(lists!.schemaSyncDataTables);
    }

    async function dataSync() {
      add("title", "=== REEMPLAZO DE DATA ===");
      await replaceData(lists!.dataSyncTables);
    }

    try {
      if (option === "1" || option === "3") await schemaSync();
      if (option === "2" || option === "3") await dataSync();

      if (option === "4") {
        add("title", "=== ESTRUCTURA DE FACTURACION ===");
        const plan = await call<{
          missingTables: string[];
          commonTables: string[];
          errors: ActionError[];
        }>({ step: "billing-plan" });
        addErrors(plan.errors);
        await createAndCompare(plan.missingTables, plan.commonTables);
        add("title", "Procedimientos de facturacion");
        await createProcedures(lists.billingProcedures);
        add("title", "Reemplazando data de opcion04");
        await replaceData(["opcion04"]);
      }

      if (option === "5") {
        add("title", "=== COPIA DE PROCEDIMIENTOS ===");
        await createProcedures(lists.generalProcedures);
      }

      add("title", "Proceso completado.");
    } catch (err) {
      if ((err as Error).message === "__cancelled__") {
        add("error", "Proceso cancelado. Lo que ya se ejecuto no se revierte.");
      } else {
        add("error", `[ERROR FATAL] ${(err as Error).message}`);
      }
    } finally {
      refresh();
      setRunning(null);
    }
  }

  // Deja la pantalla como recien abierta: sin empresas elegidas, sin registro ni resumen
  function clearAll() {
    setSourceId("");
    setTargetId("");
    setLog([]);
    setSummary(null);
    setPending(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  const runningOption = OPTIONS.find((o) => o.id === running);
  const errorCount = summary?.errors.length ?? 0;
  const endpoints = [
    { id: "source", label: "Origen", pill: "read", pillText: "Se lee", hint: "Base de donde se leen tablas y data.", value: sourceId, set: setSourceId, selected: source },
    { id: "target", label: "Destino", pill: "write", pillText: "Se escribe", hint: "Base que se va a modificar.", value: targetId, set: setTargetId, selected: target },
  ];

  return (
    <>
      {loadError && (
        <div className="notice error" style={{ marginTop: 0, marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          {loadError}
        </div>
      )}

      <section className="card">
        <div className="section-head">
          <div className="section-title">
            <span className="step">1</span>
            <div>
              <h2>Empresas</h2>
              <p>De dónde se copia y a dónde se escribe.</p>
            </div>
          </div>
          <div className="row">
            <button
              className="ghost"
              onClick={clearAll}
              disabled={!!running}
              title="Quita las empresas elegidas, el registro y el resumen"
            >
              <Icon name="eraser" size={15} /> Limpiar todo
            </button>
            <button onClick={loadConnections} disabled={!!running || loadingConnections}>
              {loadingConnections ? <Spinner /> : <Icon name="refresh" size={15} />}
              {loadingConnections ? "Cargando..." : "Recargar lista"}
            </button>
          </div>
        </div>

        <div className="endpoints">
          {endpoints.map((field, i) => (
            <Fragment key={field.id}>
              {i === 1 && (
                <div className="endpoint-arrow">
                  <Icon name="arrowRight" size={20} />
                </div>
              )}
              <div className="endpoint">
                <div className="endpoint-head">
                  <label htmlFor={field.id}>{field.label}</label>
                  <span className={`pill ${field.pill}`}>{field.pillText}</span>
                </div>
                <CompanyPicker
                  id={field.id}
                  items={pickerItems}
                  value={field.value}
                  onChange={field.set}
                  disabled={!!running || loadingConnections}
                  placeholder={loadingConnections ? "Cargando empresas..." : "Escribe NIT o nombre para buscar..."}
                />
                {field.selected ? (
                  <div className="endpoint-meta">
                    <span className="pill">
                      <Icon name="database" size={11} /> {field.selected.database}
                    </span>
                    <span className="pill">{field.selected.serverLabel}</span>
                  </div>
                ) : (
                  <p className="hint">{field.hint}</p>
                )}
              </div>
            </Fragment>
          ))}
        </div>

        {selectionError && (
          <div className="notice error">
            <Icon name="alert" size={15} />
            {selectionError}
          </div>
        )}
        {serverErrors.map((e) => (
          <div key={e.serverLabel} className="notice error">
            <Icon name="alert" size={15} />
            No se pudo leer el servidor {e.serverLabel}: {e.error}
          </div>
        ))}
      </section>

      <section className="card">
        <div className="section-head">
          <div className="section-title">
            <span className="step">2</span>
            <div>
              <h2>Operación</h2>
              <p>
                {source && target
                  ? "Elige qué ejecutar. Siempre se pide confirmación antes."
                  : "Elige origen y destino para habilitar las operaciones."}
              </p>
            </div>
          </div>
        </div>
        <div className="options">
          {OPTIONS.map((o) => (
            <div className={`option${running === o.id ? " running" : ""}`} key={o.id}>
              <div className="option-head">
                <div className="option-icon">
                  <Icon name={o.icon} size={17} />
                </div>
                <div>
                  <strong>
                    {o.id}. {o.title}
                  </strong>
                  <p>{o.description}</p>
                </div>
              </div>
              <div className="option-foot">
                {o.destructive ? (
                  <span className="pill write">
                    <Icon name="alert" size={11} /> Borra datos
                  </span>
                ) : (
                  <span className="pill ok">
                    <Icon name="check" size={11} /> Solo agrega
                  </span>
                )}
                <button className="primary" disabled={!canRun} onClick={() => setPending(o.id)}>
                  {running === o.id ? <Spinner /> : <Icon name="play" size={13} />}
                  {running === o.id ? "Ejecutando..." : "Ejecutar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {(log.length > 0 || running) && (
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="step">
                <Icon name="terminal" size={13} />
              </span>
              <div>
                <h2>Registro</h2>
                <p>
                  {running
                    ? `Ejecutando: ${runningOption?.title}`
                    : errorCount > 0
                      ? `Terminó con ${errorCount} error${errorCount === 1 ? "" : "es"}`
                      : "Terminó sin errores"}
                </p>
              </div>
            </div>
            {running && (
              <button
                className="danger"
                onClick={() => (cancelRef.current = true)}
                title="Se detiene al terminar el paso actual"
              >
                <Icon name="x" size={14} /> Cancelar
              </button>
            )}
          </div>
          <div className="terminal">
            <div className="terminal-bar">
              <div className="dots">
                <i />
                <i />
                <i />
              </div>
              <span className="row">
                {running && <Spinner size={11} />}
                {log.length} líneas
              </span>
            </div>
            <div className="log" ref={logRef}>
              {log.map((line, i) => (
                <div key={i} className={line.kind}>
                  {line.text}
                </div>
              ))}
            </div>
          </div>
          {running && (
            <p className="hint">Cancelar detiene el proceso al terminar el paso actual. Lo ya ejecutado no se revierte.</p>
          )}
        </section>
      )}

      {summary && (
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="step">
                <Icon name="check" size={13} />
              </span>
              <h2>Resumen</h2>
            </div>
          </div>
          <div className="stats">
            <div className="stat">
              <b>{summary.tablesCreated.length}</b>
              <small>Tablas creadas</small>
            </div>
            <div className="stat">
              <b>{summary.columnsAdded.length}</b>
              <small>Columnas agregadas</small>
            </div>
            <div className="stat">
              <b>{summary.rowsCopied.length}</b>
              <small>Tablas con data reemplazada</small>
            </div>
            <div className="stat">
              <b>{summary.proceduresCreated.length}</b>
              <small>Procedimientos creados</small>
            </div>
            <div className="stat">
              <b>{summary.proceduresSkipped.length}</b>
              <small>Procedimientos omitidos</small>
            </div>
            <div className={`stat ${errorCount ? "bad" : "ok"}`}>
              <b style={{ color: errorCount ? "var(--danger)" : "var(--ok)" }}>{errorCount}</b>
              <small>Errores</small>
            </div>
          </div>
          {summary.rowsCopied.length > 0 && (
            <details>
              <summary>Filas copiadas por tabla</summary>
              <ul>
                {summary.rowsCopied.map((r) => (
                  <li key={r.table}>
                    <span className="mono">{r.table}</span>: {r.rows.toLocaleString("es-CO")} filas
                  </li>
                ))}
              </ul>
            </details>
          )}
          {summary.errors.length > 0 && (
            <details open>
              <summary>Errores</summary>
              <ul>
                {summary.errors.map((e, i) => (
                  <li key={i} className="error-text">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {pending && source && target && lists && (
        <ConfirmDialog
          optionTitle={`${pending}. ${OPTIONS.find((o) => o.id === pending)!.title}`}
          destructive={OPTIONS.find((o) => o.id === pending)!.destructive}
          source={{ title: companyLabel(source), database: source.database, server: source.serverLabel }}
          target={{ title: companyLabel(target), database: target.database, server: target.serverLabel }}
          steps={describeSteps(pending, lists)}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const option = pending;
            setPending(null);
            run(option);
          }}
        />
      )}
    </>
  );
}
