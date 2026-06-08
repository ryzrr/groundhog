export const color = {
  bg:        '#060403',
  surface:   '#0d0a07',
  surfaceHi: '#16100a',

  amberHi:  '#f59e0b',
  amber:    '#d97706',
  amberDim: '#78350f',
  amberFaint:'#3d1f04',

  greenHi:  '#4ade80',
  green:    '#16a34a',
  greenDim: '#14532d',

  blue:     '#60a5fa',
  blueDim:  '#1e3a5f',

  red:      '#f87171',
  redDim:   '#7f1d1d',

  text:     '#e8ddd0',
  textDim:  '#8a7e74',
  textFaint:'#3d3228',

  border:   '#2a1f14',
  borderHi: '#4a3520',

  dot: {
    green: '#4ade80',
    amber: '#f59e0b',
    red:   '#f87171',
    gray:  '#4a3520',
  },
} as const;

export type Color = typeof color;
