/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

/* ================= one dropdown for every "pick one of many" in Terono =================
   Fonts, name fonts and effects, decorations, nameplates, profile effects and frames. Shows the chosen one (with
   its picture or in its font), opens a list with a search box when it's long, works with the keyboard. The list
   opens in place (it pushes what's below down) instead of floating, so a small window or a scrolled settings
   page can never cut it off. */

export interface DdOption {
    value: string;
    label: string;
    sub?: string;
    img?: string;
    className?: string;
    style?: CSSProperties;
    group?: string;
}

const LIMIT = 300;

export function Dropdown({ value, options, onChange, placeholder = "Choose…", ariaLabel, search }: {
    value: string;
    options: DdOption[];
    onChange(value: string): void;
    placeholder?: string;
    ariaLabel?: string;
    search?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [hi, setHi] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const current = options.find(o => o.value === value);
    const searchable = search ?? options.length > 8;
    const w = q.trim().toLowerCase();
    const shown = useMemo(() => options.filter(o => !w || `${o.label} ${o.sub ?? ""} ${o.group ?? ""}`.toLowerCase().includes(w)).slice(0, LIMIT), [options, w]);

    useEffect(() => {
        if (!open) return;
        setQ("");
        setHi(Math.max(0, options.findIndex(o => o.value === value)));
        const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", away, true);
        return () => document.removeEventListener("mousedown", away, true);
    }, [open]);

    useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(".dz-dd-hi")?.scrollIntoView({ block: "nearest" }); }, [hi, open]);

    const pick = (o: DdOption) => { setOpen(false); if (o.value !== value) onChange(o.value); };

    const onKey = (e: ReactKeyboardEvent) => {
        if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
            return;
        }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setHi(i => Math.min(shown.length - 1, i + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setHi(i => Math.max(0, i - 1)); }
        else if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
    };

    let lastGroup: string | undefined;
    return (
        <div className={`dz-dd${open ? " dz-dd-open" : ""}`} ref={root} onKeyDown={onKey}>
            <button type="button" className="dz-dd-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>
                {current?.img !== undefined && <span className="dz-dd-thumb">{current.img && <img src={current.img} alt="" />}</span>}
                <span className="dz-dd-text">
                    <span className={current?.className} style={current?.style}>{current?.label ?? placeholder}</span>
                    {current?.sub && <small>{current.sub}</small>}
                </span>
                <svg className="dz-dd-chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {open && (
                <div className="dz-dd-panel">
                    {searchable && (
                        <input className="dz-dd-search" autoFocus placeholder={`Search ${options.length}`} value={q}
                            onChange={e => { setQ(e.currentTarget.value); setHi(0); }} aria-label="Search" />
                    )}
                    <div className="dz-dd-list" role="listbox" ref={list} aria-label={ariaLabel}>
                        {shown.map((o, i) => {
                            const head = o.group && o.group !== lastGroup ? <div key={`g-${o.group}`} className="dz-dd-group">{o.group}</div> : null;
                            lastGroup = o.group;
                            return [head,
                                <div key={o.value} role="option" aria-selected={o.value === value} className={`dz-dd-opt${i === hi ? " dz-dd-hi" : ""}`}
                                    onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); pick(o); }}>
                                    {o.img !== undefined && <span className="dz-dd-thumb">{o.img && <img src={o.img} alt="" loading="lazy" />}</span>}
                                    <span className="dz-dd-text">
                                        <span className={o.className} style={o.style}>{o.label}</span>
                                        {o.sub && <small>{o.sub}</small>}
                                    </span>
                                    {o.value === value && <svg className="dz-dd-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                </div>];
                        })}
                        {!shown.length && <div className="dz-dd-empty">Nothing matches “{q}”.</div>}
                        {shown.length === LIMIT && <div className="dz-dd-empty">Type to find the rest.</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

export const DD_CSS = `
.dz-dd { position: relative; width: 100%; max-width: 460px; }
.dz-dd-btn { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; box-sizing: border-box; padding: 6px 10px 6px 12px; border-radius: 10px; cursor: pointer; text-align: left;
    font: 500 14px var(--font-primary, "gg sans", sans-serif); color: var(--text-default, #fff);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 11%, transparent);
    transition: border-color 140ms ease, background 140ms ease; }
.dz-dd-btn:hover { border-color: color-mix(in srgb, var(--dz-accent, #429cff) 50%, transparent); }
.dz-dd-btn:focus-visible { outline: 2px solid var(--dz-accent, #429cff); outline-offset: 1px; }
.dz-dd-open .dz-dd-btn { border-color: var(--dz-accent, #429cff); border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
.dz-dd-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.dz-dd-text > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-dd-text small { font-size: 12px; color: var(--text-muted, #aaa); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-dd-chev { flex: none; color: var(--text-muted, #aaa); transition: rotate 180ms ease; }
.dz-dd-open .dz-dd-chev { rotate: 180deg; }
.dz-dd-thumb { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 8px; overflow: hidden; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-dd-thumb img { width: 100%; height: 100%; object-fit: contain; }
.dz-dd-panel { margin-top: 4px; padding: 6px; border-radius: 4px 4px 12px 12px; box-sizing: border-box;
    background: color-mix(in srgb, var(--dz-card, #111214) 96%, var(--dz-text, #fff)); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 11%, transparent);
    box-shadow: 0 10px 28px rgb(0 0 0 / 30%); animation: dz-dd-in 160ms cubic-bezier(.34, 1.4, .5, 1) both; }
.dz-dd-search { width: 100%; box-sizing: border-box; height: 34px; margin-bottom: 6px; padding: 0 10px; border-radius: 8px; outline: none;
    font: 500 14px var(--font-primary, "gg sans", sans-serif); color: var(--text-default, #fff);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 10%, transparent); }
.dz-dd-search:focus { border-color: var(--dz-accent, #429cff); }
.dz-dd-list { max-height: 300px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.dz-dd-group { padding: 8px 8px 4px; font: 700 11px var(--font-primary, "gg sans", sans-serif); letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted, #aaa); }
.dz-dd-opt { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--text-default, #fff); }
.dz-dd-hi { background: color-mix(in srgb, var(--dz-accent, #429cff) 16%, transparent); }
.dz-dd-opt[aria-selected="true"] { font-weight: 600; }
.dz-dd-check { flex: none; color: var(--dz-accent, #429cff); }
.dz-dd-empty { padding: 10px 8px; font-size: 13px; color: var(--text-muted, #aaa); }
@keyframes dz-dd-in { from { opacity: 0; transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) { .dz-dd-panel { animation: none; } }
`;
