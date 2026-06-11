/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Keep the same class names (bg-brand-gold, bg-brand-navy) so no components need to change
          gold: '#006FCF',          // American Express bright blue — class names kept for minimal churn
          'gold-light': '#3B9BE8',
          navy: '#00175A',          // American Express deep blue
          'navy-deep': '#00112E',
          'navy-mid': '#0A2A6E',
          cream: '#F3F6FB',
          maroon: '#006FCF',        // alias
        }
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
