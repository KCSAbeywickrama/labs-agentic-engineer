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

/** Data: the table of records and the activity timeline. */

import { Box, Chip, Table as OxygenTable, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@wso2/oxygen-ui";
import type { ThemeTableProps, ThemeTimelineProps } from "@wso2/prototype-kit";
import { TitledCard } from "./card.js";

export function Table({ title, columns, rows }: ThemeTableProps) {
  return (
    <TitledCard title={title} flush>
      <TableContainer>
        <OxygenTable size="small" aria-label={title ?? "Records"}>
          <TableHead>
            <TableRow>
              {columns.map((c, i) => (
                <TableCell key={i} sx={{ fontWeight: 600, color: "text.secondary" }}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} hover selected={row.highlighted} aria-selected={row.highlighted} onClick={row.onPress} sx={{ cursor: "pointer", "&:last-child td": { borderBottom: 0 } }} {...row.root}>
                {row.cells.map((value, i) => (
                  <TableCell key={i}>{i === row.cells.length - 1 && row.tone ? <Chip size="small" label={value} color={row.tone} /> : value}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </OxygenTable>
      </TableContainer>
    </TitledCard>
  );
}

export function Timeline({ title, entries }: ThemeTimelineProps) {
  return (
    <TitledCard title={title}>
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {entries.map((e, i) => (
          <Box component="li" key={i} sx={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 1.5, pl: 1.5, borderLeft: 2, borderColor: "divider" }}>
            <Typography component="time" variant="caption" color="text.secondary">
              {e.when}
            </Typography>
            <div>
              <Typography variant="body2">{e.text}</Typography>
              <Typography variant="caption" color="text.secondary">
                {e.who}
              </Typography>
            </div>
          </Box>
        ))}
      </Box>
    </TitledCard>
  );
}
