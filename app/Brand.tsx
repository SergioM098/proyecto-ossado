import { Icon } from "./icons";

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Icon name="database" size={17} />
      </div>
      <div>
        <h1>Sincronizador Ossado</h1>
        {subtitle && <small>{subtitle}</small>}
      </div>
    </div>
  );
}
