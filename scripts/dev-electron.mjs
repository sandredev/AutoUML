// Lanza Electron en desarrollo. En Linux, si chrome-sandbox no es root:root 4755
// (caso tipico tras `npm ci`), Electron aborta; solo en ese caso se agrega
// --no-sandbox y solo en dev. Los paquetes (`npm run dist`) no pasan por aqui.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const electronBin = createRequire(import.meta.url)('electron');
const args = ['.'];

if (process.platform === 'linux') {
  try {
    const st = statSync(join(dirname(electronBin), 'chrome-sandbox'));
    const ok = st.uid === 0 && (st.mode & 0o4000) !== 0;
    if (!ok) {
      args.push('--no-sandbox');
      console.warn(
        '[dev-electron] chrome-sandbox sin SUID root: arrancando con --no-sandbox (solo desarrollo). ' +
          'Para usar el sandbox: sudo chown root:root <chrome-sandbox> && sudo chmod 4755 <chrome-sandbox>'
      );
    }
  } catch {
    args.push('--no-sandbox');
  }
}

// En Wayland la pantalla completa deja el lienzo sin repintar hasta la siguiente entrada (#38): XWayland por
// defecto, como en el paquete (main.ts). AUTOUML_OZONE elige otra plataforma.
if (process.platform === 'linux') args.push(`--ozone-platform=${process.env.AUTOUML_OZONE || 'x11'}`);

const child = spawn(electronBin, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
