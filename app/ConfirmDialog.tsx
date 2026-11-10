"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export interface ConfirmSide {
  title: string; // "NIT - Nombre"
  database: string;
  server: string;
}

interface Props {
  optionTitle: string;
  destructive: boolean;
  source: ConfirmSide;
  target: ConfirmSide;
  steps: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ optionTitle, destructive, source, target, steps, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Para lo que borra datos hay que escribir el nombre de la base destino
  const canConfirm = !destructive || typed.trim() === target.database;

  useEffect(() => {
    (destructive ? inputRef.current : cancelRef.current)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [destructive, onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{optionTitle}</h2>

        <div className="flow">
          <div className="flow-side">
            <small>Origen · se lee</small>
            <strong>{source.title}</strong>
            <span>Base {source.database} · {source.server}</span>
          </div>
          <div className="flow-arrow" aria-hidden="true">
            <Icon name="arrowRight" size={18} />
          </div>
          <div className={`flow-side${destructive ? " flow-target-danger" : ""}`}>
            <small>Destino · se escribe</small>
            <strong>{target.title}</strong>
            <span>Base {target.database} · {target.server}</span>
          </div>
        </div>

        <p className="modal-section-title">Qué va a hacer</p>
        <ul className="modal-steps">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>

        {destructive && (
          <div className="modal-warning">
            <p>
              Esto <b>borra y reemplaza datos</b> en la base <b>{target.database}</b> y no se puede deshacer.
            </p>
            <label htmlFor="confirm-db">
              Escribe <code>{target.database}</code> para confirmar
            </label>
            <input
              id="confirm-db"
              ref={inputRef}
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) onConfirm();
              }}
            />
          </div>
        )}

        <div className="modal-actions">
          <button ref={cancelRef} onClick={onCancel}>
            Cancelar
          </button>
          <button className={destructive ? "danger-filled" : "primary"} disabled={!canConfirm} onClick={onConfirm}>
            <Icon name="play" size={13} /> Ejecutar
          </button>
        </div>
      </div>
    </div>
  );
}
