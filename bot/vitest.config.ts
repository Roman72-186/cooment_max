import { defineConfig } from 'vitest/config';

// Явный exclude нужен: без него vitest в этой версии подхватывал
// скомпилированные .test.js из dist/ (два разных build-артефакта) вместе
// с исходными .test.ts — тройной прогон одних и тех же тестов и завышенный
// счётчик в `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
