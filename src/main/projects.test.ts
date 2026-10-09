import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autouml-project-save-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => storageRoot,
    isPackaged: false,
  },
}));

import { createProject, initStorage, readPumlText, savePumlText } from './projects';

const source = '@startuml\nclass Example\n@enduml\n';

beforeAll(() => {
  initStorage();
});

afterAll(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe('savePumlText', () => {
  it('assigns the saved text to the project as diagram.puml', () => {
    createProject('Saved Diagram');

    const saved = savePumlText('Saved Diagram', `\uFEFF${source}`);

    expect(saved.meta.pumlFile).toBe('diagram.puml');
    expect(saved.meta.originalFileName).toBe('Saved Diagram.puml');
    expect(saved.puml?.fileName).toBe('diagram.puml');
    expect(readPumlText('Saved Diagram')).toBe(source);
    expect(fs.existsSync(path.join(saved.dir, 'diagram.puml.tmp'))).toBe(false);
  });
});
