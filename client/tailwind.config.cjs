/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        c1: '#EAF1FB',
        c2: '#003D96',
        c3: '#FFF2E8',
        c4: '#FF5C00',
        brand: {
          50: '#F3F7FD', 100: '#EAF1FB', 200: '#C9DAF4',
          300: '#96B8E8', 400: '#5D8FD3', 500: '#2664B6',
          600: '#003D96', 700: '#003580', 800: '#002A66', 900: '#001E4D'
        },
        secondary: { 50: '#FFF7F0', 100: '#FFF2E8', 500: '#FF5C00', 700: '#B84100' }
      },
      boxShadow: {
        soft: '0 10px 30px rgba(12, 33, 45, 0.12)'
      }
    }
  },
  plugins: []
};
