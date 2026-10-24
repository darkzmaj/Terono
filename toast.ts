/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as Common from "@webpack/common";

// Vencord changed how toasts are shown (October 2026): showToast(text, Toasts.Type.X) became
// showToast({ text, variant }). Terono is built against whatever Vencord the user has, so it speaks both.
export type ToastKind = "success" | "failure" | "message";

export function toast(text: string, kind: ToastKind = "message") {
    const legacy = (Common as any).Toasts;
    try {
        if (legacy?.Type) (Common.showToast as any)(text, legacy.Type[kind === "failure" ? "FAILURE" : kind === "success" ? "SUCCESS" : "MESSAGE"]);
        else (Common.showToast as any)({ text, variant: kind === "failure" ? "critical" : kind === "success" ? "success" : "default" });
    } catch (e) {
        console.warn("[Terono]", text, e);
    }
}
