/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/** The theme's root: its design tokens and every component's styles, inline (the frame loads nothing). */

import type { ReactNode } from "react";
import { CONTENT_CSS } from "./components/content.js";
import { LAYOUT_CSS } from "./components/layout.js";

const TOKENS_CSS = `
.pt-root{--pt-bg:#f6f7f9;--pt-surface:#fff;--pt-border:#dfe3e8;--pt-text:#1f2328;--pt-muted:#59636e;--pt-primary:#2563eb;--pt-primary-text:#fff;--pt-danger:#c62828;--pt-info:#0b69a3;--pt-success:#1a7f37;--pt-warning:#9a6700;--pt-error:#c62828;--pt-radius:8px;--proto-select:var(--pt-primary);
font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--pt-text);background:var(--pt-bg);display:flex;flex-direction:column;flex:1;min-height:0;height:100%}
.pt-root *,.pt-root *::before,.pt-root *::after{box-sizing:border-box}
.pt-card{background:var(--pt-surface);border:1px solid var(--pt-border);border-radius:var(--pt-radius);padding:16px}
.pt-card-title{margin:0 0 12px;font-size:15px;font-weight:600}
.pt-muted{color:var(--pt-muted)}
.pt-tone-default{--pt-tone:var(--pt-muted)}.pt-tone-info{--pt-tone:var(--pt-info)}.pt-tone-success{--pt-tone:var(--pt-success)}.pt-tone-warning{--pt-tone:var(--pt-warning)}.pt-tone-error{--pt-tone:var(--pt-error)}
`;

const CSS = [TOKENS_CSS, LAYOUT_CSS, CONTENT_CSS].join("\n");

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <div className="pt-root">
      <style>{CSS}</style>
      {children}
    </div>
  );
}
