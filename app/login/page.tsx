"use client";

import { useState } from "react";
import { Brand } from "../Brand";
import { Icon, Spinner } from "../icons";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "No se pudo iniciar sesion");
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={onSubmit}>
        <Brand subtitle="Acceso restringido" />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <div className="notice error">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        <button className="primary" type="submit" disabled={loading || !password} style={{ marginTop: 16, width: "100%" }}>
          {loading ? <Spinner /> : <Icon name="lock" size={15} />}
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
