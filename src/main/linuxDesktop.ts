import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * En Linux (GNOME/Wayland) el icono de la ventana sale del archivo .desktop cuyo
 * StartupWMClass coincide con la app; la opción `icon` de BrowserWindow se ignora.
 * Ni `npm run dev` ni un AppImage instalan ese archivo, así que lo registramos
 * nosotros al arrancar (issue #2). NoDisplay evita ensuciar el menú de aplicaciones.
 */
export function ensureLinuxDesktopEntry(): void {
  if (process.platform !== 'linux') return;
  try {
    const source = path.join(__dirname, '../../build/icon.png');
    if (!fs.existsSync(source)) return;

    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
    const iconPath = path.join(dataHome, 'icons/hicolor/512x512/apps/autouml.png');
    const desktopPath = path.join(dataHome, 'applications/autouml.desktop');
    const exec = process.env.APPIMAGE || process.execPath;

    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=AutoUML',
      `Exec="${exec}" %U`,
      `Icon=${iconPath}`,
      `StartupWMClass=${app.getName()}`,
      'NoDisplay=true',
      ''
    ].join('\n');

    const iconData = fs.readFileSync(source);
    if (!fs.existsSync(iconPath) || !fs.readFileSync(iconPath).equals(iconData)) {
      fs.mkdirSync(path.dirname(iconPath), { recursive: true });
      fs.writeFileSync(iconPath, iconData);
    }
    if (!fs.existsSync(desktopPath) || fs.readFileSync(desktopPath, 'utf8') !== entry) {
      fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
      fs.writeFileSync(desktopPath, entry);
    }
  } catch {
    // Mejor esfuerzo: sin icono en el dock no debe impedir abrir la app.
  }
}
