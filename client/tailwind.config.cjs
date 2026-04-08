/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        c1: '#91C6BC',
        c2: '#4B9DA9',
        c3: '#F6F3C2',
        c4: '#E37434'
      },
      boxShadow: {
        soft: '0 10px 30px rgba(12, 33, 45, 0.12)'
      }
    }
  },
  plugins: []
};