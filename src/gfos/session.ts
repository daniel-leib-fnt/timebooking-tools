/**
 * Logged-in GFOS web session, persisted in $XDG_STATE_HOME/timebooking/session.json so that the
 * CLI, the widget and the MCP server reuse one login. A file lock serializes those processes.
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { CookieJar, SerializedCookieJar } from 'tough-cookie';
import { GfosAccount, loadAccount, loadPassword } from './credentials';
import { GfosAuthError, GfosClientOptions, GfosUnreachableError } from './types';

const REQUEST_TIMEOUT_MS = 15_000;
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ECONNRESET',
]);

export interface Page {
  /** Final URL after redirects. */
  url: string;
  html: string;
}

interface StoredSession {
  version: 1;
  baseUrl: string;
  personalnummer: string;
  /** PARAM token of the main page, also part of mainUrl. */
  param: string;
  /** main.xhtml URL including PARAM, opened before every action to get a fresh ViewState. */
  mainUrl: string;
  cookies: SerializedCookieJar;
  savedAt: string;
}

/** The stored session is no longer valid: GFOS redirected to the login page or the view expired. */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class GfosSession {
  private constructor(
    readonly account: GfosAccount,
    private readonly http: AxiosInstance,
    private readonly jar: CookieJar,
    private mainUrl: string,
  ) {}

  static create(account: GfosAccount, debug: boolean, stored?: StoredSession): GfosSession {
    const jar = stored ? CookieJar.deserializeSync(stored.cookies) : new CookieJar();
    const http = wrapper(
      axios.create({
        jar,
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 10,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }),
    );
    if (debug) {
      http.interceptors.request.use((config) => {
        console.error(`gfos: ${config.method?.toUpperCase()} ${config.url?.split(/[?;]/)[0]}`);
        return config;
      });
    }
    http.interceptors.response.use(undefined, (error: unknown) => {
      throw toUnreachableError(error, account.baseUrl) ?? error;
    });
    return new GfosSession(account, http, jar, stored?.mainUrl ?? '');
  }

  get param(): string {
    return this.mainUrl.match(/[?&]PARAM=([0-9]+)/)?.[1] ?? '';
  }

  toStored(): StoredSession {
    return {
      version: 1,
      baseUrl: this.account.baseUrl,
      personalnummer: this.account.personalnummer,
      param: this.param,
      mainUrl: this.mainUrl,
      cookies: this.jar.serializeSync()!,
      savedAt: new Date().toISOString(),
    };
  }

  async login(password: string): Promise<void> {
    const loginUrl = `${this.account.baseUrl}/login.xhtml?NOSSO=1`;
    const loginPage = toPage(await this.http.get<string>(loginUrl), loginUrl);
    const response = await this.submit(loginPage, 'loginform', {
      'loginform:mandant': this.account.mandant,
      'loginform:werk': this.account.werk,
      'loginform:personalnummer': this.account.personalnummer,
      'loginform:passwort': password,
      'loginform:login': 'loginform:login',
    });
    const main = toPage(response, loginUrl);
    if (!/[?&]PARAM=\d+/.test(main.url)) {
      const message = errorMessages(main.html);
      throw new GfosAuthError(`GFOS login rejected${message ? `: ${message}` : ''}`);
    }
    this.mainUrl = main.url;
  }

  async get(url: string, referer?: string): Promise<Page> {
    return checked(toPage(await this.http.get<string>(url, { headers: referer ? { Referer: referer } : {} }), url));
  }

  /**
   * Submits the JSF form `formId` of `page` like a browser does: all its fields with their
   * current values, overridden by `fields`.
   */
  async post(page: Page, formId: string, fields: Record<string, string>): Promise<Page> {
    return checked(toPage(await this.submit(page, formId, fields), page.url));
  }

  /** Opens main.xhtml with the stored PARAM; throws SessionExpiredError when GFOS shows the login page. */
  async openMain(): Promise<Page> {
    if (!this.mainUrl) throw new SessionExpiredError('no stored main page');
    return this.get(this.mainUrl);
  }

  /** Selects a menu entry of main.xhtml (e.g. "2_0" for the Zeitkonto) and loads the application page shown in its iframe. */
  async openMenu(menuId: string): Promise<Page> {
    const main = await this.openMain();
    const nav = await this.post(main, 'mainform', {
      'mainform:menu_menuid': menuId,
      'mainform:menu': 'mainform:menu',
      'mainform:fscrollpos': '0',
    });
    const src = cheerio.load(nav.html)('iframe#iFrame').attr('src');
    if (!src) throw new SessionExpiredError(`menu ${menuId}: application iframe not found`);
    return this.get(new URL(src, nav.url).toString(), nav.url);
  }

  /**
   * Sends a PrimeFaces AJAX request (`PrimeFaces.ab({s: source, p: execute, u: render})`) with the
   * fields of form `formId`. Returns the rendered updates as a page, with the new ViewState put
   * into the updated form so that it can be submitted again.
   */
  async ajax(
    page: Page,
    formId: string,
    source: string,
    fields: Record<string, string>,
    { execute = formId, render = formId, event }: { execute?: string; render?: string; event?: string } = {},
  ): Promise<Page> {
    const response = await this.submit(
      page,
      formId,
      {
        'javax.faces.partial.ajax': 'true',
        'javax.faces.source': source,
        'javax.faces.partial.execute': execute,
        'javax.faces.partial.render': render,
        ...(event ? { 'javax.faces.behavior.event': event, 'javax.faces.partial.event': event } : { [source]: source }),
        ...fields,
      },
      { 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' },
    );
    const $ = cheerio.load(String(response.data), { xml: true });
    const redirect = $('partial-response > redirect').attr('url');
    if (redirect) throw new SessionExpiredError(`GFOS redirected the AJAX request to ${redirect.split(/[?;]/)[0]}`);
    const error = $('partial-response > error');
    if (error.length) {
      const name = error.find('error-name').text();
      if (/ViewExpired/.test(name)) throw new SessionExpiredError('GFOS view expired');
      throw new Error(`GFOS AJAX error ${name}: ${clean(error.find('error-message').text())}`);
    }
    const updates = $('partial-response > changes > update');
    const viewState = updates
      .filter((_, update) => /javax\.faces\.ViewState/.test($(update).attr('id') ?? ''))
      .first()
      .text();
    const html = updates
      .filter((_, update) => !/javax\.faces\.ViewState/.test($(update).attr('id') ?? ''))
      .map((_, update) => $(update).text())
      .get()
      .join('\n');
    const updated = cheerio.load(html);
    const form = updated(`form[id="${formId}"]`);
    if (viewState) {
      // Into the updated form if it was rendered, otherwise at the end of the updates.
      const target = form.length ? form : updated('body');
      target.find('input[name="javax.faces.ViewState"]').remove();
      target.append(updated('<input type="hidden" name="javax.faces.ViewState">').attr('value', viewState));
    }
    return { url: page.url, html: updated.html() };
  }

  private async submit(
    page: Page,
    formId: string,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<AxiosResponse<string>> {
    const $ = cheerio.load(page.html);
    const form = $(`form[id="${formId}"]`);
    if (!form.length) throw new SessionExpiredError(`form ${formId} not found on ${page.url.split(/[?;]/)[0]}`);
    const body = new URLSearchParams({ ...formFields($, form), ...fields });
    const action = new URL(form.attr('action') ?? page.url, page.url).toString();
    return this.http.post<string>(action, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(page.url).origin,
        Referer: page.url,
        ...headers,
      },
    });
  }
}

/** Current values of a form's fields, as a browser would submit them without clicking a button. */
export function formFields($: cheerio.CheerioAPI, form: cheerio.Cheerio<any>): Record<string, string> {
  const fields: Record<string, string> = {};
  form.find('input[name], select[name], textarea[name]').each((_, element) => {
    const field = $(element);
    const name = field.attr('name')!;
    const type = (field.attr('type') ?? '').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return;
    if ((type === 'checkbox' || type === 'radio') && field.attr('checked') === undefined) return;
    if (element.tagName === 'select') {
      fields[name] = field.find('option[selected]').attr('value') ?? field.find('option').first().attr('value') ?? '';
    } else if (element.tagName === 'textarea') {
      fields[name] = field.text();
    } else {
      fields[name] = field.attr('value') ?? (type === 'checkbox' ? 'on' : '');
    }
  });
  return fields;
}

export interface GfosMessage {
  severity: 'error' | 'warning' | 'info';
  text: string;
}

/**
 * Messages GFOS shows as PrimeFaces growls. The server renders them into the widget
 * configuration, e.g. `PrimeFaces.cw("Growl","growlError",{…,msgs:[{summary:"…",detail:"…"}]})`.
 */
export function growlMessages(html: string): GfosMessage[] {
  const messages: GfosMessage[] = [];
  for (const growl of html.matchAll(/PrimeFaces\.cw\("Growl","growl(Error|Warning|Info)",\{.*?msgs:\[(.*?)\]\}\)/g)) {
    const severity = growl[1].toLowerCase() as GfosMessage['severity'];
    for (const message of growl[2].matchAll(/\{summary:("(?:[^"\\]|\\.)*")(?:,detail:("(?:[^"\\]|\\.)*"))?/g)) {
      const summary = jsString(message[1]);
      const detail = message[2] ? jsString(message[2]) : '';
      const text = clean(detail && detail !== summary ? `${summary} ${detail}` : summary);
      if (text) messages.push({ severity, text: cheerio.load(text).text() });
    }
  }
  return messages;
}

/** Value of a double-quoted JavaScript string literal. */
function jsString(literal: string): string {
  return JSON.parse(literal.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1').replace(/\\(['\/])/g, '$1')) as string;
}

/** Error texts on a page: error growls and PrimeFaces message components; empty when there are none. */
export function errorMessages(html: string): string {
  const growls = growlMessages(html)
    .filter((message) => message.severity === 'error')
    .map((message) => message.text);
  const components = clean(cheerio.load(html)('.ui-messages-error, .ui-message-error').text());
  return [...growls, components].filter(Boolean).join(' ');
}

export function clean(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

function toPage(response: AxiosResponse<string>, requestUrl: string): Page {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url: string = (response.request as any)?.res?.responseUrl ?? requestUrl;
  return { url, html: String(response.data) };
}

function checked(page: Page): Page {
  if (/\/login\.xhtml/.test(page.url) || page.html.includes('id="loginform"')) {
    throw new SessionExpiredError('GFOS redirected to the login page');
  }
  if (/ViewExpired/.test(page.html)) throw new SessionExpiredError('GFOS view expired');
  return page;
}

function toUnreachableError(error: unknown, baseUrl: string): GfosUnreachableError | null {
  const code = axios.isAxiosError(error) ? error.code : undefined;
  if (!code || !UNREACHABLE_CODES.has(code)) return null;
  return new GfosUnreachableError(`GFOS at ${new URL(baseUrl).host} is not reachable (${code}). Is the VPN connected?`, { cause: error });
}

export function stateDir(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'timebooking');
}

function sessionFile(): string {
  return join(stateDir(), 'session.json');
}

function loadStored(account: GfosAccount): StoredSession | undefined {
  try {
    const stored = JSON.parse(readFileSync(sessionFile(), 'utf8')) as StoredSession;
    const matches = stored.version === 1 && stored.baseUrl === account.baseUrl && stored.personalnummer === account.personalnummer;
    return matches ? stored : undefined;
  } catch {
    return undefined;
  }
}

function saveStored(session: GfosSession): void {
  const file = sessionFile();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(session.toStored(), null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * Runs `action` with the stored session; logs in again and retries once when the session has
 * expired. Holds the session file lock for the whole run.
 */
export async function withSession<T>(options: GfosClientOptions, action: (session: GfosSession) => Promise<T>): Promise<T> {
  const debug = options.debug ?? false;
  const log = (message: string) => debug && console.error(`gfos: ${message}`);
  const account = loadAccount();
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const release = await lock(sessionFile(), {
    realpath: false,
    stale: 30_000,
    retries: { retries: 120, minTimeout: 100, maxTimeout: 1000 },
  });
  try {
    const stored = loadStored(account);
    if (stored) {
      log('reusing session');
      const session = GfosSession.create(account, debug, stored);
      try {
        const result = await action(session);
        saveStored(session);
        return result;
      } catch (error) {
        if (!(error instanceof SessionExpiredError)) throw error;
        log(`session expired (${error.message})`);
      }
    }
    log('logging in');
    const session = GfosSession.create(account, debug);
    await session.login(loadPassword());
    saveStored(session);
    const result = await action(session);
    saveStored(session);
    return result;
  } finally {
    await release();
  }
}
