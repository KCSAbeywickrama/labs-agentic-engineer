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

import { alpha, Box, Typography, useTheme } from '@wso2/oxygen-ui';
import type { Theme } from '@mui/material';
import type { TaskStatus } from '../../services/api';
import { STATUS_DISPLAY, type StatusTone } from './types';

function toneColor(theme: Theme, tone: StatusTone): string {
  switch (tone) {
    case 'primary': return theme.palette.primary.main;
    case 'success': return theme.palette.success.main;
    case 'warning': return theme.palette.warning.main;
    case 'error':   return theme.palette.error.main;
    default:        return theme.palette.text.disabled;
  }
}

// A dot + label pill for a Task's derivedStatus. `live` pulses the dot for the
// in-flight statuses (an active coding/build execution).
export function TaskStatusPill({ status, live }: { status: TaskStatus; live?: boolean }) {
  const theme = useTheme();
  const display = STATUS_DISPLAY[status];
  const color = toneColor(theme, display.tone);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625, flexShrink: 0 }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: color,
          flexShrink: 0,
          position: 'relative',
          ...(live && {
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              bgcolor: color,
              opacity: 0.45,
              animation: 'taskStatusPulse 1.4s ease-out infinite',
            },
            '@keyframes taskStatusPulse': {
              '0%':   { transform: 'scale(0.8)', opacity: 0.5 },
              '100%': { transform: 'scale(2.2)', opacity: 0 },
            },
          }),
        }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, color, whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
        {display.label}
      </Typography>
    </Box>
  );
}

export { toneColor };

// A small filled chip for a standing flag (attention item / hold), tinted by tone.
export function FlagChip({ label, tone }: { label: string; tone: StatusTone }) {
  const theme = useTheme();
  const color = toneColor(theme, tone);
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        px: 0.875,
        borderRadius: 1,
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        color,
        bgcolor: alpha(color, 0.14),
        border: '1px solid',
        borderColor: alpha(color, 0.35),
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}
