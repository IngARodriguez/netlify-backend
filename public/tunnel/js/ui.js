import { drawerEl, overlayEl, inputEl, sidebarEl, sidebarOverlayEl } from './dom.js';

export function openDrawer() {
  drawerEl.classList.add('open');
  overlayEl.classList.add('open');
  drawerEl.setAttribute('aria-hidden', 'false');
}

export function closeDrawer() {
  drawerEl.classList.remove('open');
  overlayEl.classList.remove('open');
  drawerEl.setAttribute('aria-hidden', 'true');
}

export function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarOverlayEl.classList.add('open');
}

export function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarOverlayEl.classList.remove('open');
}

export function autoresize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 220) + 'px';
}
