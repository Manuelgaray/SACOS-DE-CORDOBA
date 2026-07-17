import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta verde-esmeralda + acentos oliva/crema
        brand: {
          green: '#009166',
          'green-dark': '#047150',
          'green-light': '#D7EFE5',
          'green-50': '#EEF7F2',
          orange: '#B8CA5B',
          'orange-dark': '#6E7D24',
          'orange-light': '#FBF7D2',
        },
        sidebar: {
          bg: '#00684B',
          hover: '#0A7557',
          active: '#0E8163',
          text: '#B9E0CF',
          'text-bright': '#FFFFFF',
        },
        // Colores por área — gama verde → amarillo (texto negro)
        almacen: { bg: '#CDEBD9', text: '#1A1A1A' },
        corte:   { bg: '#D3EAC0', text: '#1A1A1A' },
        small:   { bg: '#DDEBB0', text: '#1A1A1A' },
        big:     { bg: '#E6EDA6', text: '#1A1A1A' },
        tips:    { bg: '#EFEFA0', text: '#1A1A1A' },
        tapa:    { bg: '#F6EDA0', text: '#1A1A1A' },
        calidad: { bg: '#FBE99B', text: '#1A1A1A' },
        empaque: { bg: '#FCF6C8', text: '#1A1A1A' },
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'card': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 2px 6px rgba(0, 0, 0, 0.06)',
        'sidebar': 'none',
      },
    },
  },
  plugins: [],
};
export default config;
