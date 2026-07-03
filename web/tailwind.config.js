/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf2ff', 100: '#fae5ff', 200: '#f5cbff', 300: '#eda1ff',
          400: '#e070ff', 500: '#cc3df0', 600: '#b01fd0', 700: '#9218ab',
          800: '#78188b', 900: '#631a72',
        },
      },
    },
  },
  plugins: [],
};
