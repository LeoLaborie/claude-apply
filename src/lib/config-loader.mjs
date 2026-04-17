import fs from 'node:fs';
import path from 'node:path';

export class MissingConfigError extends Error {
  constructor(filePath) {
    const rel = path.relative(process.cwd(), filePath) || filePath;
    super(
      `${rel} introuvable. Lance d'abord /apply-onboard pour construire tes fichiers de config.`
    );
    this.name = 'MissingConfigError';
    this.code = 'MISSING_CONFIG';
    this.path = filePath;
  }
}

export function requireConfig(filePath) {
  if (!fs.existsSync(filePath)) throw new MissingConfigError(filePath);
}
