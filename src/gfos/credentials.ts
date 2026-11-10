/** GFOS account settings from the environment and the password from the Secret Service. */

import { execFileSync } from 'node:child_process';
import { GfosAuthError } from './types';

export interface GfosAccount {
  /** Base URL of the GFOS web application, e.g. https://gfos.example.com/gfos */
  baseUrl: string;
  mandant: string;
  werk: string;
  personalnummer: string;
}

export function loadAccount(): GfosAccount {
  const url = process.env.GFOS_URL;
  const mandant = process.env.GFOS_MANDANT;
  const werk = process.env.GFOS_ORG_EINHEIT;
  const personalnummer = process.env.GFOS_PERSONALNUMMER;
  if (!url || !mandant || !werk || !personalnummer) {
    throw new GfosAuthError('Missing GFOS account. Set GFOS_URL, GFOS_MANDANT, GFOS_ORG_EINHEIT and GFOS_PERSONALNUMMER.');
  }
  return { baseUrl: url.replace(/\/$/, ''), mandant, werk, personalnummer };
}

/** Reads the password via `secret-tool lookup service gfos`, falling back to GFOS_PASSWORT. */
export function loadPassword(): string {
  const password = lookupSecret() || process.env.GFOS_PASSWORT;
  if (!password) {
    throw new GfosAuthError('No GFOS password found. Store it with `secret-tool store --label=GFOS service gfos` or set GFOS_PASSWORT.');
  }
  return password;
}

function lookupSecret(): string | null {
  try {
    return execFileSync('secret-tool', ['lookup', 'service', 'gfos'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).replace(/\n$/, '');
  } catch {
    // Not found (exit code 1), secret-tool missing or no Secret Service running.
    return null;
  }
}
