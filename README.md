# EasyNotes

**An Antinote-style scratchpad for Windows.**

EasyNotes is a small Windows popup notepad for quick notes. It is built for people searching for an **Antinote for Windows alternative**: press a keybind, jot something down, switch between small notes, and hide it again.

EasyNotes is an independent open-source project and is not affiliated with Antinote.

## Features

- Global show/hide hotkey, default `Alt+A`
- System tray persistence with Show, Hide, and Quit
- Always-on-top compact note window
- Autosave while typing
- Stack-style note navigation
- Empty notes are cleaned up when you move away from them
- Configurable shortcuts for show/hide, previous note, and next note
- Optional Mouse4/Mouse5 navigation for previous and next note
- Header arrow buttons for switching notes
- Original EasyNotes light and dark themes
- Theme JSON import support

## Default Shortcuts

- Show/hide: `Alt+A`
- Previous note: `Ctrl+Shift+ArrowLeft`
- Next note: `Ctrl+Shift+ArrowRight`
- Legacy previous note: `Ctrl+Shift+[`
- Legacy next note: `Ctrl+Shift+]`
- Mouse4/back: previous note
- Mouse5/forward: next note

Note navigation shortcuts can distinguish side-specific modifiers such as `LeftCtrl`, `RightCtrl`, `LeftShift`, and `RightShift`. The global show/hide shortcut uses the operating system global hotkey API, so Control/Alt modifiers are treated generically there.

## Windows Install

Use the installer from `src-tauri/target/release/bundle/nsis/` after building:

```powershell
npm install
npm run tauri build
```

The Windows installer is generated as:

```text
src-tauri/target/release/bundle/nsis/EasyNotes_0.1.0_x64-setup.exe
```

## Development

Prerequisites:

- Rust
- Node.js
- Tauri v2 system dependencies

Commands:

```powershell
npm install
npm run tauri dev
npm run tauri build
```

## Notes

EasyNotes includes original light and dark themes. It does not ship third-party copyrighted theme packs.

## Tech Stack

- Tauri 2
- Rust
- Vanilla HTML/CSS/JS
