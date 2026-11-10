"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PickerItem {
  id: string;
  label: string; // "NIT - Nombre"
  detail: string; // base y servidor
  group: string; // servidor
  search: string; // texto donde se busca
}

interface Props {
  id: string;
  items: PickerItem[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function CompanyPicker({ id, items, value, onChange, disabled, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = items.find((i) => i.id === value);

  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items.filter((i) => words.every((w) => i.search.includes(w)));
  }, [items, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(item: PickerItem) {
    onChange(item.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  let lastGroup = "";

  return (
    <div className="picker" ref={rootRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label ?? ""}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <ul className="picker-list" id={`${id}-list`} role="listbox" ref={listRef}>
          {filtered.length === 0 && <li className="picker-empty">Sin resultados</li>}
          {filtered.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && <div className="picker-group">{header}</div>}
                <div
                  role="option"
                  aria-selected={item.id === value}
                  data-index={index}
                  className={`picker-option${index === active ? " active" : ""}${item.id === value ? " selected" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(item);
                  }}
                >
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function toSearchText(...parts: (string | null | undefined)[]): string {
  return normalize(parts.filter(Boolean).join(" "));
}
