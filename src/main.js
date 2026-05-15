import {
  applyTheme,
  getActiveThemeName,
  loadThemes,
  saveImportedTheme,
  setActiveThemeName,
  validateEasyNotesTheme
} from './themes.js';
import { UndoManager } from './undo/undo-manager.js';

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

// ── State ──
let notes = [];
let currentIndex = 0;
let saveTimeout = null;
let animating = false;
let themes = [];
let activeTheme = null;
let undoManager = null;
let previousNoteShortcut = 'Ctrl+Shift+ArrowLeft';
let nextNoteShortcut = 'Ctrl+Shift+ArrowRight';
let mouseNoteButtonsEnabled = true;
let checklistSelectionMode = false;
const pressedModifiers = {
  ControlLeft: false,
  ControlRight: false,
  ShiftLeft: false,
  ShiftRight: false,
  AltLeft: false,
  AltRight: false,
  MetaLeft: false,
  MetaRight: false
};

// ── DOM ──
const canvas = document.getElementById('note-canvas');
const container = document.getElementById('canvas-container');
const checklistView = document.getElementById('checklist-view');
const indicator = document.getElementById('note-indicator');
const settingsButton = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const prevNoteButton = document.getElementById('btn-prev-note');
const nextNoteButton = document.getElementById('btn-next-note');

const importThemeButton = document.getElementById('btn-import-theme');
const themeFileInput = document.getElementById('theme-file-input');
const toggleShortcutInput = document.getElementById('toggle-shortcut-input');
const saveShortcutButton = document.getElementById('btn-save-shortcut');
const shortcutStatus = document.getElementById('shortcut-status');
const previousNoteShortcutInput = document.getElementById('previous-note-shortcut-input');
const nextNoteShortcutInput = document.getElementById('next-note-shortcut-input');
const saveNoteShortcutsButton = document.getElementById('btn-save-note-shortcuts');
const noteShortcutsStatus = document.getElementById('note-shortcuts-status');
const mouseNoteButtonsToggle = document.getElementById('mouse-note-buttons-toggle');
// ── Custom Theme Dropdown ──
const dropdownTrigger = document.getElementById('theme-dropdown-trigger');
const dropdownPanel = document.getElementById('theme-dropdown-panel');
const dropdownLabel = document.getElementById('theme-dropdown-label');
let dropdownOpen = false;

function closeDropdown() {
  dropdownOpen = false;
  dropdownTrigger.setAttribute('aria-expanded', 'false');
  dropdownPanel.hidden = true;
}

function toggleDropdown() {
  dropdownOpen = !dropdownOpen;
  dropdownTrigger.setAttribute('aria-expanded', String(dropdownOpen));
  dropdownPanel.hidden = !dropdownOpen;
}

dropdownTrigger?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown();
});

dropdownTrigger?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleDropdown();
  }
  if (e.key === 'Escape' && dropdownOpen) {
    closeDropdown();
    dropdownTrigger.focus();
  }
});

document.addEventListener('click', (e) => {
  if (dropdownOpen && !e.target.closest('.theme-dropdown')) {
    closeDropdown();
  }
});

// ── Theme System ──

async function initThemes() {
  themes = await loadThemes();
  const preferredName = getActiveThemeName();
  activeTheme = themes.find((theme) => theme.name === preferredName) || themes[0];
  applyTheme(activeTheme);
  renderThemeSelect();
}

function renderThemeSelect() {
  dropdownLabel.textContent = activeTheme.name;
  dropdownPanel.innerHTML = themes
    .map((theme) => {
      const selected = theme.name === activeTheme.name;
      const checkSvg = `<svg class="theme-option-check-icon" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const swatches = `<span class="theme-option-swatches" aria-hidden="true">
        <span class="theme-swatch" style="--swatch-color: ${escapeHtml(theme.background)}"></span>
        <span class="theme-swatch" style="--swatch-color: ${escapeHtml(theme.typeMain)}"></span>
        <span class="theme-swatch theme-swatch-accent" style="--swatch-color: ${escapeHtml(theme.accent1Main)}"></span>
      </span>`;
      return `<button class="theme-dropdown-option" role="option" aria-selected="${selected}" data-value="${escapeHtml(theme.name)}">
        <span class="theme-option-check">${selected ? checkSvg : ''}</span>
        ${swatches}
        <span class="theme-option-label">${escapeHtml(theme.name)}</span>
      </button>`;
    })
    .join('');
  dropdownPanel.querySelectorAll('.theme-dropdown-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      setThemeByName(btn.dataset.value);
      closeDropdown();
      dropdownTrigger.focus();
    });
  });
}

function setThemeByName(name) {
  const theme = themes.find((item) => item.name === name);
  if (!theme) return;
  activeTheme = theme;
  applyTheme(theme);
  setActiveThemeName(theme.name);
  renderThemeSelect();
}

async function importThemeFile(file) {
  try {
    const raw = await file.text();
    const imported = validateEasyNotesTheme(JSON.parse(raw));
    const existingIndex = themes.findIndex((theme) => theme.name === imported.name);

    if (existingIndex >= 0) {
      themes[existingIndex] = imported;
    } else {
      themes.push(imported);
    }

    await saveImportedTheme(imported);
    setThemeByName(imported.name);
  } catch (error) {
    console.error(error);
  } finally {
    themeFileInput.value = '';
  }
}

function toggleSettings(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !shouldOpen);
  settingsPanel.setAttribute('aria-hidden', String(!shouldOpen));
  settingsButton.classList.toggle('open', shouldOpen);
  document.documentElement.dataset.settings = shouldOpen ? 'open' : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));
}

// ── App Settings ──

async function initAppSettings() {
  try {
    const settings = await invoke('get_app_settings');
    toggleShortcutInput.value = settings.toggle_shortcut || 'Alt+A';
    previousNoteShortcut = settings.previous_note_shortcut || 'Ctrl+Shift+ArrowLeft';
    nextNoteShortcut = settings.next_note_shortcut || 'Ctrl+Shift+ArrowRight';
    mouseNoteButtonsEnabled = settings.mouse_note_buttons_enabled !== false;
    previousNoteShortcutInput.value = previousNoteShortcut;
    nextNoteShortcutInput.value = nextNoteShortcut;
    mouseNoteButtonsToggle.checked = mouseNoteButtonsEnabled;
  } catch (error) {
    console.error('Could not load settings:', error);
  }
}

function normalizeShortcutFromEvent(e) {
  const parts = [];
  const isModifierKey = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);

  if (pressedModifiers.ControlLeft && !pressedModifiers.ControlRight) {
    parts.push('LeftCtrl');
  } else if (pressedModifiers.ControlRight && !pressedModifiers.ControlLeft) {
    parts.push('RightCtrl');
  } else if (e.ctrlKey || pressedModifiers.ControlLeft || pressedModifiers.ControlRight) {
    parts.push('Ctrl');
  }

  if (pressedModifiers.AltLeft && !pressedModifiers.AltRight) {
    parts.push('LeftAlt');
  } else if (pressedModifiers.AltRight && !pressedModifiers.AltLeft) {
    parts.push('RightAlt');
  } else if (e.altKey || pressedModifiers.AltLeft || pressedModifiers.AltRight) {
    parts.push('Alt');
  }

  if (pressedModifiers.ShiftLeft && !pressedModifiers.ShiftRight) {
    parts.push('LeftShift');
  } else if (pressedModifiers.ShiftRight && !pressedModifiers.ShiftLeft) {
    parts.push('RightShift');
  } else if (e.shiftKey || pressedModifiers.ShiftLeft || pressedModifiers.ShiftRight) {
    parts.push('Shift');
  }

  if (pressedModifiers.MetaLeft && !pressedModifiers.MetaRight) {
    parts.push('LeftSuper');
  } else if (pressedModifiers.MetaRight && !pressedModifiers.MetaLeft) {
    parts.push('RightSuper');
  } else if (e.metaKey || pressedModifiers.MetaLeft || pressedModifiers.MetaRight) {
    parts.push('Super');
  }

  if (isModifierKey) return null;

  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  if (key.startsWith('Arrow')) key = key;

  parts.push(key);
  return parts.join('+');
}

function normalizeShortcutText(value) {
  return String(value)
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (upper === 'LEFTCONTROL' || upper === 'CONTROLLEFT' || upper === 'LEFTCTRL' || upper === 'CTRLLEFT') return 'LeftCtrl';
      if (upper === 'RIGHTCONTROL' || upper === 'CONTROLRIGHT' || upper === 'RIGHTCTRL' || upper === 'CTRLRIGHT') return 'RightCtrl';
      if (upper === 'LEFTALT' || upper === 'ALTLEFT') return 'LeftAlt';
      if (upper === 'RIGHTALT' || upper === 'ALTRIGHT') return 'RightAlt';
      if (upper === 'LEFTSHIFT' || upper === 'SHIFTLEFT') return 'LeftShift';
      if (upper === 'RIGHTSHIFT' || upper === 'SHIFTRIGHT') return 'RightShift';
      if (upper === 'LEFTSUPER' || upper === 'SUPERLEFT' || upper === 'LEFTMETA' || upper === 'METALEFT') return 'LeftSuper';
      if (upper === 'RIGHTSUPER' || upper === 'SUPERRIGHT' || upper === 'RIGHTMETA' || upper === 'METARIGHT') return 'RightSuper';
      if (upper === 'CONTROL' || upper === 'CTRL') return 'Ctrl';
      if (upper === 'OPTION' || upper === 'ALT') return 'Alt';
      if (upper === 'SHIFT') return 'Shift';
      if (upper === 'META' || upper === 'CMD' || upper === 'COMMAND' || upper === 'SUPER') return 'Super';
      if (upper === 'LEFT') return 'ArrowLeft';
      if (upper === 'RIGHT') return 'ArrowRight';
      if (upper === 'UP') return 'ArrowUp';
      if (upper === 'DOWN') return 'ArrowDown';
      if (upper === 'SPACE') return 'Space';
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join('+');
}

function eventMatchesShortcut(e, shortcut) {
  const eventShortcut = normalizeShortcutFromEvent(e);
  if (!eventShortcut) return false;
  return eventShortcut === normalizeShortcutText(shortcut);
}

async function saveToggleShortcut() {
  const shortcut = toggleShortcutInput.value.trim();
  if (!shortcut) return;

  shortcutStatus.textContent = '';
  shortcutStatus.classList.remove('error');
  saveShortcutButton.disabled = true;

  try {
    const settings = await invoke('set_toggle_shortcut', { shortcut });
    toggleShortcutInput.value = settings.toggle_shortcut;
    shortcutStatus.textContent = 'Saved';
  } catch (error) {
    console.error('Could not save shortcut:', error);
    shortcutStatus.textContent = String(error);
    shortcutStatus.classList.add('error');
  } finally {
    saveShortcutButton.disabled = false;
  }
}

async function saveNoteShortcuts() {
  const previousShortcut = normalizeShortcutText(previousNoteShortcutInput.value);
  const nextShortcut = normalizeShortcutText(nextNoteShortcutInput.value);

  noteShortcutsStatus.textContent = '';
  noteShortcutsStatus.classList.remove('error');
  saveNoteShortcutsButton.disabled = true;

  try {
    const settings = await invoke('set_note_shortcuts', {
      previousShortcut,
      nextShortcut
    });
    previousNoteShortcut = settings.previous_note_shortcut;
    nextNoteShortcut = settings.next_note_shortcut;
    previousNoteShortcutInput.value = previousNoteShortcut;
    nextNoteShortcutInput.value = nextNoteShortcut;
    noteShortcutsStatus.textContent = 'Saved';
  } catch (error) {
    console.error('Could not save note shortcuts:', error);
    noteShortcutsStatus.textContent = String(error);
    noteShortcutsStatus.classList.add('error');
  } finally {
    saveNoteShortcutsButton.disabled = false;
  }
}

async function setMouseNoteButtonsEnabled(enabled) {
  mouseNoteButtonsEnabled = enabled;
  try {
    const settings = await invoke('set_mouse_note_buttons_enabled', { enabled });
    mouseNoteButtonsEnabled = settings.mouse_note_buttons_enabled !== false;
    mouseNoteButtonsToggle.checked = mouseNoteButtonsEnabled;
  } catch (error) {
    console.error('Could not save mouse note button setting:', error);
    mouseNoteButtonsToggle.checked = mouseNoteButtonsEnabled;
  }
}

// ── Load & Render ──

async function loadNotes() {
  notes = await invoke('list_notes');
  if (notes.length === 0) {
    const note = await invoke('create_note');
    notes = [note];
  }
  currentIndex = 0;
  renderCurrentNote(false);
}

function renderCurrentNote(animate) {
  if (animate) return; // animated transitions handle their own rendering
  canvas.value = notes[currentIndex]?.content || '';
  renderChecklistView();
  updateIndicator();
}

function updateIndicator() {
  if (notes.length <= 1) {
    indicator.classList.remove('visible');
    indicator.innerHTML = '';
    return;
  }

  indicator.classList.add('visible');

  if (notes.length <= 12) {
    let html = '';
    for (let i = 0; i < notes.length; i++) {
      html += `<div class="dot${i === currentIndex ? ' active' : ''}"></div>`;
    }
    indicator.innerHTML = html;
  } else {
    indicator.innerHTML = `<span class="note-count">${currentIndex + 1} / ${notes.length}</span>`;
  }
}

// ── Save ──

function saveCurrentNote() {
  const note = notes[currentIndex];
  if (!note) return;
  const content = canvas.value;
  notes[currentIndex].content = content;
  invoke('save_note', { id: note.id, content });
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveCurrentNote(), 300);
  undoManager.activity();
}

function scheduleChecklistSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveCurrentNote(), 300);
}

// ── Checklist mode ──

const LIST_UNCHECKED = '[ ] ';
const LIST_CHECKED = '[x] ';
const DEFAULT_LIST_MARKER = '/list';
const LEGACY_LIST_MARKERS = new Set(['list', 'todo']);

function isListTrigger(text) {
  const value = text.trim().toLowerCase();
  return value === DEFAULT_LIST_MARKER;
}

function isChecklistLine(line) {
  return line.startsWith(LIST_UNCHECKED) || line.startsWith(LIST_CHECKED);
}

function hasChecklistMarker(lines) {
  const firstLine = (lines[0] || '').trim().toLowerCase();
  if (isListTrigger(firstLine)) return true;
  return LEGACY_LIST_MARKERS.has(firstLine) && lines.slice(1).some((line) => isChecklistLine(line));
}

function isChecklistNote() {
  const lines = canvas.value.split('\n');
  return hasChecklistMarker(lines) || lines.some((line) => isChecklistLine(line));
}

function stripChecklistPrefix(line) {
  if (line.startsWith(LIST_CHECKED)) return line.slice(LIST_CHECKED.length);
  if (line.startsWith(LIST_UNCHECKED)) return line.slice(LIST_UNCHECKED.length);
  return line;
}

function parseChecklistItems() {
  const lines = canvas.value.split('\n');
  const hasMarker = hasChecklistMarker(lines);
  const itemLines = hasMarker ? lines.slice(1) : lines;

  return itemLines.map((line) => {
    if (line.startsWith(LIST_CHECKED)) {
      return { checked: true, text: line.slice(LIST_CHECKED.length) };
    }
    if (line.startsWith(LIST_UNCHECKED)) {
      return { checked: false, text: line.slice(LIST_UNCHECKED.length) };
    }
    return { checked: false, text: line };
  });
}

function serializeChecklistItems() {
  const marker = checklistView.querySelector('.checklist-marker')?.textContent.trim() || DEFAULT_LIST_MARKER;
  return [...checklistView.querySelectorAll('.checklist-item')]
    .reduce((lines, item) => {
      const checked = item.classList.contains('checked');
      const text = item.querySelector('.checklist-text')?.textContent || '';
      lines.push(`${checked ? LIST_CHECKED : LIST_UNCHECKED}${text}`);
      return lines;
    }, [marker])
    .join('\n');
}

function updateChecklistSource() {
  canvas.value = serializeChecklistItems();
  notes[currentIndex].content = canvas.value;
  scheduleChecklistSave();
}

function checklistPlainText(markerText = '') {
  const itemText = [...checklistView.querySelectorAll('.checklist-item')]
    .map((item) => item.querySelector('.checklist-text')?.textContent || '')
    .join('\n');
  const marker = markerText.trim();
  return marker ? `${marker}\n${itemText}` : itemText;
}

function disableChecklistMode(markerText = '') {
  const value = checklistPlainText(markerText);
  canvas.value = value;
  notes[currentIndex].content = value;
  renderChecklistView();
  canvas.focus();
  canvas.selectionStart = Math.min(value.length, markerText.length);
  canvas.selectionEnd = canvas.selectionStart;
  scheduleSave();
}

function getEditableCaretOffset(element) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    return element.textContent.length;
  }

  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function setEditableCaretOffset(element, offset) {
  element.focus();
  if (!element.firstChild) {
    element.append(document.createTextNode(''));
  }

  const textNode = element.firstChild;
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(textNode, Math.min(offset, textNode.textContent.length));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusFirstChecklistItem() {
  const first = checklistView.querySelector('.checklist-text');
  if (!first) return false;
  setEditableCaretOffset(first, 0);
  return true;
}

function selectEntireChecklist() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(checklistView);
  selection.removeAllRanges();
  selection.addRange(range);
  checklistSelectionMode = true;
}

function clearChecklistNote() {
  replaceChecklistSelection('');
}

function replaceChecklistSelection(text) {
  checklistSelectionMode = false;
  canvas.value = text;
  notes[currentIndex].content = text;
  renderChecklistView();
  canvas.focus();
  canvas.selectionStart = text.length;
  canvas.selectionEnd = text.length;
  scheduleSave();
}

function isChecklistSelectionActive() {
  const selection = window.getSelection();
  if (!checklistSelectionMode || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;

  const range = selection.getRangeAt(0);
  return checklistView.contains(range.commonAncestorContainer) || range.commonAncestorContainer === checklistView;
}

function handleChecklistDocumentKeydown(e) {
  if (!isChecklistNote() || checklistView.classList.contains('hidden')) return false;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    const activeElement = document.activeElement;
    if (activeElement === checklistView || checklistView.contains(activeElement)) {
      e.preventDefault();
      selectEntireChecklist();
      return true;
    }
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && isChecklistSelectionActive()) {
    e.preventDefault();
    clearChecklistNote();
    return true;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && isChecklistSelectionActive()) {
    e.preventDefault();
    replaceChecklistSelection(e.key);
    return true;
  }

  return false;
}

function createChecklistMarker(markerText) {
  const row = document.createElement('div');
  row.className = 'checklist-marker-row';

  const marker = document.createElement('div');
  marker.className = 'checklist-marker';
  marker.contentEditable = 'true';
  marker.spellcheck = false;
  marker.textContent = markerText || DEFAULT_LIST_MARKER;
  marker.setAttribute('aria-label', 'List marker');

  marker.addEventListener('input', () => {
    checklistSelectionMode = false;
    const value = marker.textContent.trim();
    if (!isListTrigger(value)) {
      disableChecklistMode(value);
      return;
    }
    updateChecklistSource();
  });

  marker.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectEntireChecklist();
      return;
    }

    if (e.key === 'Backspace' && marker.textContent.trim() === '') {
      e.preventDefault();
      disableChecklistMode('');
      return;
    }

    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusFirstChecklistItem();
      return;
    }

    if (e.key === 'ArrowRight' && getEditableCaretOffset(marker) === marker.textContent.length) {
      e.preventDefault();
      focusFirstChecklistItem();
    }
  });

  row.append(marker);
  return row;
}

function createChecklistItem({ checked = false, text = '' } = {}) {
  const item = document.createElement('div');
  item.className = `checklist-item${checked ? ' checked' : ''}`;

  const toggle = document.createElement('button');
  toggle.className = 'checklist-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', checked ? 'Mark incomplete' : 'Mark complete');

  const content = document.createElement('div');
  content.className = 'checklist-text';
  content.contentEditable = 'true';
  content.spellcheck = false;
  content.textContent = text;

  toggle.addEventListener('click', () => {
    item.classList.toggle('checked');
    toggle.setAttribute('aria-label', item.classList.contains('checked') ? 'Mark incomplete' : 'Mark complete');
    updateChecklistSource();
  });

  function focusNeighbor(direction, edgeOnly = false) {
    const offset = getEditableCaretOffset(content);
    const atStart = offset === 0;
    const atEnd = offset === content.textContent.length;
    if (edgeOnly && direction < 0 && !atStart) return false;
    if (edgeOnly && direction > 0 && !atEnd) return false;

    const neighbor = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
    const neighborText = neighbor?.querySelector('.checklist-text');
    if (!neighborText && direction < 0) {
      const marker = checklistView.querySelector('.checklist-marker');
      if (!marker) return false;
      setEditableCaretOffset(marker, marker.textContent.length);
      return true;
    }
    if (!neighborText) return false;

    setEditableCaretOffset(neighborText, edgeOnly && direction < 0 ? neighborText.textContent.length : offset);
    return true;
  }

  content.addEventListener('input', () => {
    checklistSelectionMode = false;
    updateChecklistSource();
  });
  content.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectEntireChecklist();
      return;
    }

    if (e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      item.classList.toggle('checked');
      updateChecklistSource();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const next = createChecklistItem();
      item.after(next);
      next.querySelector('.checklist-text').focus();
      updateChecklistSource();
      return;
    }

    if (e.key === 'Backspace' && content.textContent === '' && checklistView.children.length > 1) {
      e.preventDefault();
      const focusTarget = item.previousElementSibling || item.nextElementSibling;
      item.remove();
      focusTarget?.querySelector('.checklist-text')?.focus();
      updateChecklistSource();
      return;
    }

    if (e.key === 'ArrowUp' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (focusNeighbor(-1)) e.preventDefault();
      return;
    }

    if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (focusNeighbor(1)) e.preventDefault();
      return;
    }

    if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (focusNeighbor(-1, true)) e.preventDefault();
      return;
    }

    if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (focusNeighbor(1, true)) e.preventDefault();
    }
  });

  item.append(toggle, content);
  return item;
}

function renderChecklistView({ focusFirst = false } = {}) {
  const checklistMode = isChecklistNote();
  canvas.classList.toggle('hidden', checklistMode);
  checklistView.classList.toggle('hidden', !checklistMode);
  container.classList.toggle('checklist-active', checklistMode);

  if (!checklistMode) {
    checklistView.innerHTML = '';
    return;
  }

  const lines = canvas.value.split('\n');
  const markerText = DEFAULT_LIST_MARKER;
  const items = parseChecklistItems();
  if (items.length === 0) items.push({ checked: false, text: '' });
  checklistView.replaceChildren(createChecklistMarker(markerText), ...items.map((item) => createChecklistItem(item)));
  if (focusFirst) {
    checklistView.querySelector('.checklist-text')?.focus();
  }
}

function getLineRange(position) {
  const value = canvas.value;
  const start = value.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const nextBreak = value.indexOf('\n', position);
  const end = nextBreak === -1 ? value.length : nextBreak;
  return { start, end, text: value.slice(start, end) };
}

function setCanvasValue(value, selectionStart, selectionEnd = selectionStart) {
  canvas.value = value;
  canvas.selectionStart = selectionStart;
  canvas.selectionEnd = selectionEnd;
  renderChecklistView();
  scheduleSave();
}

function insertAtSelection(text) {
  const start = canvas.selectionStart;
  const end = canvas.selectionEnd;
  const value = canvas.value;
  setCanvasValue(value.slice(0, start) + text + value.slice(end), start + text.length);
}

function normalizePastedChecklistTrigger() {
  const lines = canvas.value.split('\n');
  if (lines.length <= 1 || !isListTrigger(lines[0])) return false;

  const converted = lines.slice(1).map((line) => {
    if (isChecklistLine(line)) return line;
    return `${LIST_UNCHECKED}${line}`;
  });
  const value = `${lines[0].trim().toLowerCase()}\n${converted.join('\n')}`;
  setCanvasValue(value, value.length);
  return true;
}

function handleChecklistEnter(e) {
  if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return false;

  const { start, end, text } = getLineRange(canvas.selectionStart);
  if (isListTrigger(text)) {
    e.preventDefault();
    const value = canvas.value.slice(0, start) + `${text.trim().toLowerCase()}\n${LIST_UNCHECKED}` + canvas.value.slice(end);
    canvas.value = value;
    renderChecklistView({ focusFirst: true });
    scheduleSave();
    return true;
  }

  if (isChecklistNote() || isChecklistLine(text)) {
    e.preventDefault();
    insertAtSelection(`\n${LIST_UNCHECKED}`);
    return true;
  }

  return false;
}

function toggleCurrentChecklistLine() {
  const range = getLineRange(canvas.selectionStart);
  const value = canvas.value;
  let replacement = null;

  if (range.text.startsWith(LIST_UNCHECKED)) {
    replacement = LIST_CHECKED + range.text.slice(LIST_UNCHECKED.length);
  } else if (range.text.startsWith(LIST_CHECKED)) {
    replacement = LIST_UNCHECKED + range.text.slice(LIST_CHECKED.length);
  }

  if (!replacement) return false;

  const nextValue = value.slice(0, range.start) + replacement + value.slice(range.end);
  const cursorOffset = Math.max(0, canvas.selectionStart - range.start);
  setCanvasValue(nextValue, range.start + cursorOffset);
  return true;
}

// ── Animation helper ──

function prepareForNoteSwitch(newNoteId) {
  undoManager.onNoteSwitch(newNoteId);
}

function animateSwap(outClass, inClass, newContent) {
  return new Promise((resolve) => {
    animating = true;

    canvas.classList.add(outClass);

    setTimeout(() => {
      canvas.value = newContent;
      canvas.scrollTop = 0;
      renderChecklistView();

      canvas.classList.remove(outClass);
      canvas.classList.add(inClass);

      canvas.offsetHeight;

      canvas.classList.remove(inClass);

      setTimeout(() => {
        animating = false;
        canvas.focus();
        resolve();
      }, 200);
    }, 150);
  });
}

// ── Delete empty note helper ──

async function deleteIfEmpty() {
  const content = canvas.value.trim();
  if (content === '' && notes.length > 1) {
    const note = notes[currentIndex];
    undoManager.forget(note.id);
    await invoke('delete_note', { id: note.id });
    notes.splice(currentIndex, 1);
    if (currentIndex >= notes.length) currentIndex = notes.length - 1;
    return true;
  }
  return false;
}

// ── Slide ──

async function slideToNext() {
  if (animating) return;

  const deleted = await deleteIfEmpty();

  if (deleted) {
    await animateSwap('slide-left-out', 'slide-left-in', notes[currentIndex].content);
    updateIndicator();
    return;
  }

  if (currentIndex >= notes.length - 1) {
    saveCurrentNote();
    const newNote = await invoke('create_note');
    notes.push(newNote);
    prepareForNoteSwitch(newNote.id);
    currentIndex = notes.length - 1;
    await animateSwap('slide-left-out', 'slide-left-in', '');
  } else {
    saveCurrentNote();
    prepareForNoteSwitch(notes[currentIndex + 1].id);
    currentIndex++;
    await animateSwap('slide-left-out', 'slide-left-in', notes[currentIndex].content);
  }

  updateIndicator();
}

async function slideToPrev() {
  if (animating || currentIndex <= 0) return;

  const deleted = await deleteIfEmpty();

  if (deleted) {
    await animateSwap('slide-right-out', 'slide-right-in', notes[currentIndex].content);
    updateIndicator();
    return;
  }

  saveCurrentNote();
  prepareForNoteSwitch(notes[currentIndex - 1].id);
  currentIndex--;
  await animateSwap('slide-right-out', 'slide-right-in', notes[currentIndex].content);
  updateIndicator();
}

// ── Swipe Gesture (trackpad two-finger) ──

let accumulatedX = 0;
let gestureTimer = null;
let gestureLocked = false;
const SWIPE_THRESHOLD = 80;
const GESTURE_TIMEOUT = 200;

container.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

  e.preventDefault();

  if (gestureLocked || animating) return;

  accumulatedX += e.deltaX;

  if (gestureTimer) clearTimeout(gestureTimer);
  gestureTimer = setTimeout(() => {
    accumulatedX = 0;
    gestureLocked = false;
  }, GESTURE_TIMEOUT);

  if (Math.abs(accumulatedX) >= SWIPE_THRESHOLD) {
    gestureLocked = true;
    if (accumulatedX > 0) {
      slideToNext();
    } else {
      slideToPrev();
    }
    accumulatedX = 0;

    setTimeout(() => {
      gestureLocked = false;
    }, 400);
  }
}, { passive: false });

function handleMouseNoteButton(e) {
  if (!mouseNoteButtonsEnabled || animating) return;

  if (e.button === 3) {
    e.preventDefault();
    e.stopPropagation();
    slideToPrev();
  }

  if (e.button === 4) {
    e.preventDefault();
    e.stopPropagation();
    slideToNext();
  }
}

window.addEventListener('mousedown', handleMouseNoteButton, { capture: true });
window.addEventListener('auxclick', handleMouseNoteButton, { capture: true });
document.addEventListener('copy', (e) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  if (!isChecklistNote() || checklistView.classList.contains('hidden')) return;

  const range = selection.getRangeAt(0);
  if (!checklistView.contains(range.commonAncestorContainer)) return;
  if (range.commonAncestorContainer !== checklistView) return;

  e.preventDefault();
  e.clipboardData.setData('text/plain', canvas.value);
});
document.addEventListener('selectionchange', () => {
  if (!checklistSelectionMode) return;
  if (!isChecklistSelectionActive()) checklistSelectionMode = false;
});

// ── Keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  if (Object.prototype.hasOwnProperty.call(pressedModifiers, e.code)) {
    pressedModifiers[e.code] = true;
  }

  if (handleChecklistDocumentKeydown(e)) return;

  const mod = e.metaKey || e.ctrlKey;

  // Undo / Redo
  if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoManager.undo();
    return;
  }
  if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoManager.redo();
    return;
  }
  if (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    undoManager.redo();
    return;
  }

  if (e.key === 'Escape') toggleSettings(false);

  if (eventMatchesShortcut(e, nextNoteShortcut)) {
    e.preventDefault();
    slideToNext();
    return;
  }

  if (eventMatchesShortcut(e, previousNoteShortcut)) {
    e.preventDefault();
    slideToPrev();
    return;
  }

  if (mod && e.shiftKey) {
    if (e.key === ']') { e.preventDefault(); slideToNext(); }
    if (e.key === '[') { e.preventDefault(); slideToPrev(); }
  }
});

document.addEventListener('keyup', (e) => {
  if (Object.prototype.hasOwnProperty.call(pressedModifiers, e.code)) {
    pressedModifiers[e.code] = false;
  }
});

window.addEventListener('blur', () => {
  Object.keys(pressedModifiers).forEach((key) => {
    pressedModifiers[key] = false;
  });
});

// ── Init ──

window.addEventListener('DOMContentLoaded', () => {
  initThemes();
  initAppSettings();
  loadNotes();

  undoManager = new UndoManager({
    getValue:           () => canvas.value,
    setValue:           (v) => { canvas.value = v; },
    getSelectionStart:  () => canvas.selectionStart,
    getSelectionEnd:    () => canvas.selectionEnd,
    setSelection:       (s, e) => { canvas.selectionStart = s; canvas.selectionEnd = e; },
    getNoteId:          () => notes[currentIndex]?.id ?? null
  });

  canvas.addEventListener('input', () => {
    if (!normalizePastedChecklistTrigger()) scheduleSave();
  });
  canvas.addEventListener('beforeinput', () => undoManager.beforeInput());
  canvas.addEventListener('keydown', (e) => {
    if (handleChecklistEnter(e)) return;
    if (e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleCurrentChecklistLine();
    }
  });
  canvas.addEventListener('click', (e) => {
    if (e.offsetX > 42) return;
    toggleCurrentChecklistLine();
  });

  settingsButton?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    toggleSettings();
  });

  importThemeButton?.addEventListener('click', () => themeFileInput.click());
  themeFileInput?.addEventListener('change', (e) => {
    const [file] = e.target.files || [];
    if (file) importThemeFile(file);
  });

  prevNoteButton?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    slideToPrev();
  });

  nextNoteButton?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    slideToNext();
  });

  toggleShortcutInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveToggleShortcut();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      return;
    }

    const shortcut = normalizeShortcutFromEvent(e);
    if (!shortcut) return;

    e.preventDefault();
    e.stopPropagation();
    toggleShortcutInput.value = shortcut;
    shortcutStatus.textContent = '';
    shortcutStatus.classList.remove('error');
  });

  saveShortcutButton?.addEventListener('click', saveToggleShortcut);

  [previousNoteShortcutInput, nextNoteShortcutInput].forEach((input) => {
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNoteShortcuts();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        return;
      }

      const shortcut = normalizeShortcutFromEvent(e);
      if (!shortcut) return;

      e.preventDefault();
      e.stopPropagation();
      input.value = shortcut;
      noteShortcutsStatus.textContent = '';
      noteShortcutsStatus.classList.remove('error');
    });
  });

  saveNoteShortcutsButton?.addEventListener('click', saveNoteShortcuts);

  mouseNoteButtonsToggle?.addEventListener('change', () => {
    setMouseNoteButtonsEnabled(mouseNoteButtonsToggle.checked);
  });

  document.getElementById('btn-minimize')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    appWindow.minimize();
  });
  document.getElementById('btn-maximize')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    appWindow.toggleMaximize();
  });
  document.getElementById('btn-close')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    appWindow.close();
  });
});
