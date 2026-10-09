import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        clickup: {
          purple: '#7b68ee',
          pink: '#ff007f',
          violet: '#7f56d9',
          blue: '#1e88e5',
          cyan: '#00d2d3',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#ef4444',
          // ClickUp Dark Theme surfaces
          darkBg: '#111217',
          darkSidebar: '#17181f',
          darkCard: '#1e1f26',
          darkCardHover: '#262732',
          darkBorder: '#2c2d38',
          darkMuted: '#9aa0ac',
          // ClickUp Light Theme surfaces
          lightBg: '#f7f8fa',
          lightSidebar: '#fbfcfd',
          lightCard: '#ffffff',
          lightCardHover: '#f4f5f8',
          lightBorder: '#e6e8eb',
          lightMuted: '#67727e',
        },
      },
      boxShadow: {
        clickup: '0 4px 20px -2px rgba(123, 104, 238, 0.25)',
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        cardDark: '0 4px 12px 0 rgba(0, 0, 0, 0.35)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
