/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#3b82f6',
        'accent-dark': '#2563eb',
      },
      fontFamily: {
        // Inter first (loaded as a real webfont in index.html) so every
        // platform renders the same typeface; if that font hasn't loaded
        // yet (slow/offline first paint) it falls back to each platform's
        // own native system font rather than a generic serif/sans mismatch.
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
