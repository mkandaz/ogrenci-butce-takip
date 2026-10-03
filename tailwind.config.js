/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EAF2ED',
          100: '#D5E5DC',
          200: '#ABCCBD',
          300: '#81B39E',
          400: '#579A7F',
          500: '#356B57',
          600: '#2B5948',
          700: '#224639',
          800: '#183329',
          900: '#0F201A',
        },
        muvazene: {
          bg: '#F6F5F1',
          surface: '#FFFFFF',
          ink: '#172033',
          muted: '#667085',
          border: '#DDDCD5',
          sage: '#356B57',
          'sage-hover': '#2B5948',
          'sage-soft': '#EAF2ED',
          income: '#168760',
          expense: '#C84F5A',
          warning: '#B7791F',
          scenario: '#7257A8',
          'dark-bg': '#101511',
          'dark-surface': '#171D19',
          'dark-border': '#27332B',
          'dark-ink': '#F0F3F1',
          'dark-muted': '#8B9990',
          'dark-sage': '#44856D',
        }
      }
    },
  },
  plugins: [],
}
