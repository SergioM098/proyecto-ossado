"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CompanyPicker, type PickerItem, toSearchText } from "./CompanyPicker";
import { Icon, Spinner } from "./icons";

interface License {
  nit: string;
  nombre: string | null;
  desde: string | null;
  hasta: string | null;
}

interface ChangePreview {
  column: "expira" | "pasabordo" | "tasafija";
  label: string;
  current: (string | null)[];
  rows: number;
  error?: string;
}

interface CompanyPreview {
  connection: { id: string; database: string; serverLabel: string; nit: string | null; nombre: string | null };
  changes: ChangePreview[];
  error?: string;
}

interface ActivationStep {
  where: string;
  detail: string;
  ok: boolean;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Si el dia no existe en el mes destino (31 de febrero), usar el ultimo dia del mes
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const NEW_VALUE_LABEL: Record<ChangePreview["column"], (hasta: string) => string> = {
  expira: (hasta) => formatDate(hasta),
  pasabordo: () => "*",
  tasafija: () => ".",
};

export function LicensePanel({ active }: { active: boolean }) {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  // La tabla no tiene llave unica: la fila elegida se identifica por NIT + nombre
  const [selected, setSelected] = useState<{ nit: string; nombre: string | null } | null>(null);
  const [hasta, setHasta] = useState("");

  const [preview, setPreview] = useState<CompanyPreview[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [serverErrors, setServerErrors] = useState<{ serverLabel: string; error: string }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [confirming, setConfirming] = useState(false);
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<ActivationStep[] | null>(null);
  const [activateError, setActivateError] = useState("");

  async function loadLicenses() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/licenses");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar las licencias");
      setLicenses(data.licenses);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // La lista se carga una sola vez, al abrir la pestaña por primera vez.
  // Si falla no se reintenta sola: se usa "Recargar lista".
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (active && !attemptedRef.current) {
      attemptedRef.current = true;
      loadLicenses();
    }
  }, [active]);

  const selectedIndex = selected
    ? licenses.findIndex((l) => l.nit === selected.nit && l.nombre === selected.nombre)
    : -1;
  const license = selectedIndex >= 0 ? licenses[selectedIndex] : undefined;
  const sameNitCount = license ? licenses.filter((l) => l.nit === license.nit).length : 0;
  const sameRowCount = license
    ? licenses.filter((l) => l.nit === license.nit && l.nombre === license.nombre).length
    : 0;
  const today = todayIso();
  const baseDate = license?.hasta && license.hasta.slice(0, 10) > today ? license.hasta.slice(0, 10) : today;

  const pickerItems = useMemo<PickerItem[]>(
    () =>
      licenses.map((l, index) => ({
        id: String(index),
        label: `${l.nit} - ${l.nombre ?? "(sin nombre)"}`,
        detail: `Vence ${formatDate(l.hasta)}`,
        group: "dbcontrol",
        search: toSearchText(l.nit, l.nombre),
      })),
    [licenses]
  );

  async function loadPreview(nit: string) {
    setPreview(null);
    setPreviewError("");
    setServerErrors([]);
    setChecked(new Set());
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/licenses/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo buscar la empresa");
      setPreview(data.companies);
      setServerErrors(data.serverErrors ?? []);
      // Con una sola base coincidente se marca sola; si hay varias, eliges tu
      if (data.companies.length === 1) setChecked(new Set([data.companies[0].connection.id]));
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }

  function selectLicense(id: string) {
    const row = licenses[Number(id)];
    setSelected(row ? { nit: row.nit, nombre: row.nombre } : null);
    const nit = row?.nit ?? "";
    setHasta("");
    setResult(null);
    setActivateError("");
    if (nit) loadPreview(nit);
  }

  function clear() {
    setSelected(null);
    setHasta("");
    setPreview(null);
    setPreviewError("");
    setServerErrors([]);
    setChecked(new Set());
    setResult(null);
    setActivateError("");
  }

  async function activate() {
    if (!license) return;
    setConfirming(false);
    setActivating(true);
    setActivateError("");
    setResult(null);
    try {
      const res = await fetch("/api/licenses/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nit: license.nit, nombre: license.nombre, hasta, connectionIds: [...checked] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo activar");
      setResult(data.steps);
      await loadLicenses();
      await loadPreview(license.nit);
    } catch (err) {
      setActivateError((err as Error).message);
    } finally {
      setActivating(false);
    }
  }

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(hasta);
  const noMatches = preview !== null && preview.length === 0;
  const canActivate =
    !!license && sameRowCount === 1 && validDate && !previewLoading && !activating && preview !== null && (checked.size > 0 || noMatches);
  const chosen = preview?.filter((c) => checked.has(c.connection.id)) ?? [];

  const daysLeft = license?.hasta ? daysBetween(today, license.hasta.slice(0, 10)) : null;
  const daysAdded = license && validDate ? daysBetween(baseDate, hasta) : null;

  function renderCurrent(c: ChangePreview) {
    if (c.current.length === 0) return <span className="hint">(tabla vacía)</span>;
    return c.current.map((v, i) => (
      <span key={i} className="value" style={{ marginRight: 4 }}>
        {v === null ? "NULL" : /^\d{4}-\d{2}-\d{2}/.test(v) ? formatDate(v) : v === "" ? "(vacío)" : v}
      </span>
    ));
  }

  return (
    <div id="license-panel">
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
              <h2>Licencia</h2>
            </div>
          </div>
          <div className="row">
            <button className="ghost" onClick={clear} disabled={activating}>
              <Icon name="eraser" size={15} /> Limpiar todo
            </button>
            <button onClick={loadLicenses} disabled={loading || activating}>
              {loading ? <Spinner /> : <Icon name="refresh" size={15} />}
              {loading ? "Cargando..." : "Recargar lista"}
            </button>
          </div>
        </div>

        <label htmlFor="license">Empresa</label>
        <CompanyPicker
          id="license"
          items={pickerItems}
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          onChange={selectLicense}
          disabled={loading || activating}
          placeholder={loading ? "Cargando licencias..." : "Escribe NIT o nombre para buscar..."}
        />

        {license && (
          <div className="fields">
            <div className="field">
              <small>Desde</small>
              <span>{formatDate(license.desde)}</span>
            </div>
            <div className="field">
              <small>Hasta</small>
              <span>{formatDate(license.hasta)}</span>
            </div>
            <div className="field">
              <small>Estado</small>
              <span>
                {daysLeft === null ? (
                  "—"
                ) : daysLeft >= 0 ? (
                  <span className={`pill ${daysLeft <= 30 ? "warn" : "ok"}`}>
                    {daysLeft <= 30 ? "Por vencer" : "Vigente"} · {daysLeft} días
                  </span>
                ) : (
                  <span className="pill bad">Vencida hace {-daysLeft} días</span>
                )}
              </span>
            </div>
          </div>
        )}
        {license && sameRowCount > 1 && (
          <div className="notice error">
            <Icon name="alert" size={15} />
            Hay {sameRowCount} filas en dbcontrol con este mismo NIT y nombre. No se puede activar hasta corregir los
            datos repetidos.
          </div>
        )}
        {license && sameRowCount === 1 && sameNitCount > 1 && (
          <div className="notice warn">
            <Icon name="alert" size={15} />
            El NIT {license.nit} aparece {sameNitCount} veces en dbcontrol con nombres distintos; solo se actualiza esta
            fila. Revisa que la base encontrada abajo sea la de esta empresa.
          </div>
        )}
        {!license && !loading && licenses.length > 0 && (
          <p className="hint">{licenses.length} licencias en dbcontrol.</p>
        )}
      </section>

      {license && (
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="step">2</span>
              <div>
                <h2>Nueva fecha de vencimiento</h2>
                <p>
                  Los atajos suman desde{" "}
                  {baseDate === today ? "hoy" : `el vencimiento actual (${formatDate(baseDate)})`}.
                </p>
              </div>
            </div>
          </div>
          <div className="date-row">
            <div>
              <label htmlFor="new-hasta">Hasta</label>
              <input id="new-hasta" type="date" value={hasta} min={today} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="chips">
              {[
                { label: "+1 mes", months: 1 },
                { label: "+3 meses", months: 3 },
                { label: "+6 meses", months: 6 },
                { label: "+1 año", months: 12 },
              ].map((o) => (
                <button key={o.label} onClick={() => setHasta(addMonths(baseDate, o.months))}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {validDate && (
            <div className="endpoint-meta" style={{ marginTop: 12 }}>
              <span className="value">{formatDate(license.hasta)}</span>
              <Icon name="arrowRight" size={14} className="change-arrow" />
              <span className="value new">{formatDate(hasta)}</span>
              {daysAdded !== null && daysAdded > 0 && <span className="pill read">+{daysAdded} días</span>}
            </div>
          )}
        </section>
      )}

      {license && (
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="step">3</span>
              <div>
                <h2>Base de la empresa</h2>
                <p>Se busca por NIT {license.nit} en los servidores. Así quedarían los datos:</p>
              </div>
            </div>
            {previewLoading && (
              <span className="row hint" style={{ margin: 0 }}>
                <Spinner /> Buscando...
              </span>
            )}
          </div>

          {previewError && (
            <div className="notice error">
              <Icon name="alert" size={15} />
              {previewError}
            </div>
          )}
          {serverErrors.map((e) => (
            <div key={e.serverLabel} className="notice error">
              <Icon name="alert" size={15} />
              No se pudo leer el servidor {e.serverLabel}: {e.error}
            </div>
          ))}
          {noMatches && (
            <div className="empty">
              <Icon name="building" size={22} />
              <div>No se encontró ninguna base con el NIT {license.nit}.</div>
              <div className="hint">Si activas, solo se actualiza dbcontrol.licencia.</div>
            </div>
          )}
          {preview && preview.length > 1 && (
            <div className="notice warn">
              <Icon name="alert" size={15} />
              Hay varias bases con este NIT. Marca en cuáles aplicar los cambios.
            </div>
          )}
          {preview?.map((company) => {
            const isChecked = checked.has(company.connection.id);
            return (
              <div className={`company-target${isChecked ? " checked" : ""}`} key={company.connection.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={activating}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(company.connection.id);
                      else next.delete(company.connection.id);
                      setChecked(next);
                    }}
                  />
                  <strong>{company.connection.nombre ?? company.connection.database}</strong>
                  <span className="pill">
                    <Icon name="database" size={11} /> {company.connection.database}
                  </span>
                  <span className="pill">{company.connection.serverLabel}</span>
                </label>
                {company.error && <p className="error-text">{company.error}</p>}
                {company.changes.length > 0 && (
                  <div className="table-wrap">
                    <table className="changes">
                      <thead>
                        <tr>
                          <th>Campo</th>
                          <th>Valor actual</th>
                          <th />
                          <th>Nuevo valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {company.changes.map((c) => (
                          <tr key={c.column}>
                            <td className="mono">{c.label}</td>
                            {c.error ? (
                              <td colSpan={3} className="error-text">
                                {c.error}
                              </td>
                            ) : (
                              <>
                                <td>
                                  {renderCurrent(c)}
                                  {c.rows > 1 && <span className="pill warn">{c.rows} filas</span>}
                                </td>
                                <td>
                                  <Icon name="arrowRight" size={14} className="change-arrow" />
                                </td>
                                <td>
                                  {c.column === "expira" && !validDate ? (
                                    <span className="hint">elige la fecha</span>
                                  ) : (
                                    <span className="value new">{NEW_VALUE_LABEL[c.column](hasta)}</span>
                                  )}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {license && (
        <section className="card action-bar">
          <div className="section-title">
            <span className="step">4</span>
            <div>
              <h2>Activar</h2>
              <p>
                {!validDate
                  ? "Elige la nueva fecha para continuar."
                  : preview && !noMatches && checked.size === 0
                    ? "Marca al menos una base."
                    : `${license.nombre ?? license.nit}: hasta ${formatDate(hasta)}`}
              </p>
            </div>
          </div>
          <button className="primary" disabled={!canActivate} onClick={() => setConfirming(true)}>
            {activating ? <Spinner /> : <Icon name="key" size={15} />}
            {activating ? "Activando..." : "Activar licencia"}
          </button>
        </section>
      )}

      {(activateError || result) && (
        <section className="card">
          <div className="section-title" style={{ marginBottom: 4 }}>
            <span className="step">
              <Icon name={activateError || result?.some((s) => !s.ok) ? "alert" : "check"} size={13} />
            </span>
            <h2>Resultado</h2>
          </div>
          {activateError && (
            <div className="notice error">
              <Icon name="alert" size={15} />
              {activateError}
            </div>
          )}
          {result && (
            <ul className="result-list">
              {result.map((s, i) => (
                <li key={i}>
                  <span className={`pill ${s.ok ? "ok" : "bad"}`}>{s.ok ? "OK" : "Error"}</span>
                  <span>
                    <span className="mono">{s.where}</span>: {s.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {confirming && license && (
        <div className="modal-backdrop" onMouseDown={() => setConfirming(false)}>
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Activar licencia</h2>
            <div className="flow-side">
              <small>Empresa</small>
              <strong>
                {license.nit} - {license.nombre}
              </strong>
              <span>
                Vence {formatDate(license.hasta)} → <b>{formatDate(hasta)}</b>
              </span>
            </div>
            <p className="modal-section-title">Qué va a hacer</p>
            <ul className="modal-steps">
              <li>
                <span className="mono">dbcontrol.licencia.hasta</span> = {formatDate(hasta)},{" "}
                <span className="mono">dias</span> = {daysBetween(today, hasta)}
              </li>
              {chosen.map((c) => (
                <li key={c.connection.id}>
                  Base <b>{c.connection.database}</b> ({c.connection.serverLabel}):{" "}
                  <span className="mono">licencia.expira</span> = {formatDate(hasta)},{" "}
                  <span className="mono">pasabordo</span> = *, <span className="mono">tasafija</span> = .
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button onClick={() => setConfirming(false)} autoFocus>
                Cancelar
              </button>
              <button className="primary" onClick={activate}>
                <Icon name="key" size={14} /> Activar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
