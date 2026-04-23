import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:        '#0b0f17',
        surface:   '#111827',
        surface2:  '#1a2234',
        border:    '#23304a',
        muted:     '#7a8ca6',
        text:      '#e5edff',
        bullish:   '#16a34a',
        bearish:   '#dc2626',
        neutral:   '#6b7280',
        accent:    '#3b82f6',
        warning:   '#f59e0b',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
