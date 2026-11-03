/* Apariencia: automática (sigue al sistema), clara u oscura.
   Es preferencia del navegador (localStorage), no del proyecto. index.html aplica la guardada antes de pintar
   (sin parpadeo); aquí se cambia, se sigue al sistema y se actualizan el botón del encabezado y la barra del navegador. */
const KEY = 'rastro.theme';
const dark = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch (e) {
    return 'auto';
  }
}
export function resolvedTheme() {
  const t = getTheme();
  return t === 'auto' ? (dark.matches ? 'dark' : 'light') : t;
}
const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
const SUN =
  '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';
export function applyTheme() {
  const t = getTheme(),
    r = document.documentElement;
  if (t === 'auto') delete r.dataset.theme;
  else r.dataset.theme = t;
  const isDark = resolvedTheme() === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(r).getPropertyValue('--bg').trim() || (isDark ? '#141416' : '#fffbf2');
  const b = document.getElementById('bTheme');
  if (b) {
    b.setAttribute('aria-pressed', String(isDark));
    b.title = isDark ? 'Pasar a modo claro' : 'Pasar a modo oscuro';
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${isDark ? SUN : MOON}</svg>`;
  }
  listeners.forEach(f => f());
}
export function setTheme(t) {
  try {
    if (t === 'light' || t === 'dark') localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch (e) {}
  applyTheme();
}
export function toggleTheme() {
  setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
}
export function onThemeChange(f) {
  listeners.add(f);
}
dark.addEventListener('change', () => getTheme() === 'auto' && applyTheme());
