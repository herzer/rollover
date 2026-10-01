import './ui/styles.css';
import './ui/tile-styles.css';
import './ui/candy.css';
import './ui/neon.css';
import './ui/friendly.css';
import { Client, newCode, knownGame } from './net/client';
import { Host } from './net/host';
import { GameView, tileClass, tileHTML, applyFinish } from './ui/game';
import { t, lang, setLang } from './ui/i18n';
import { icon } from './ui/icons';
import type { Tile } from './engine/tiles';
import type { AiLevel } from './engine/game';

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let client: Client | null = null;
let gameView: GameView | null = null;
let offClient: (() => void) | null = null;

const getName = () => { try { return localStorage.getItem('rollover.name') || ''; } catch { return ''; } };
const putName = (n: string) => { try { localStorage.setItem('rollover.name', n); } catch { /* storage blocked */ } };

function joinCodeFromUrl(): string | null {
  const m = location.hash.match(/join=([A-Z0-9]{4,8})/i);
  return m ? m[1].toUpperCase() : null;
}

function inviteLink(code: string) {
  return `${location.origin}${location.pathname}#join=${code}`;
}

function brandTiles() {
  const mk = (num: number): Tile => ({ id: -1, color: 0, num, joker: false, star: num === 1 });
  return [12, 13, 1].map((n) => `<span class="${tileClass(mk(n))}" style="position:relative;--tw:34px;--th:45px">${tileHTML(mk(n))}</span>`).join('');
}

// ------------------------------------------------------------------ home --

function home(message = '') {
  leaveClient();
  const tt = t();
  const code = joinCodeFromUrl();
  const saved = Host.load();
  const canResume = !!saved?.lobby.started && !!saved.state;
  let scores: [string, number][] = [];
  try { scores = Object.entries(JSON.parse(localStorage.getItem('rollover.scores') || '{}')).sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][]; } catch { /* storage blocked */ }

  app.innerHTML = `<div class="screen"><div class="home">
    <div class="row"><button class="btn sm lang-toggle" data-act="lang" title="${esc(tt.langTip)}">${icon('lang', 16)}${lang() === 'en' ? 'Deutsch' : 'English'}</button></div>
    <div class="brand"><div class="brand-tiles">${brandTiles()}</div><h1>${tt.appName}</h1></div>
    <p class="tagline">${esc(code ? tt.invited : tt.tagline)}</p>
    ${message ? `<p class="msg warn">${esc(message)}</p>` : ''}
    <div class="card stack">
      <label for="name"><b>${tt.yourName}</b></label>
      <input id="name" class="field" maxlength="20" placeholder="${esc(tt.yourNamePh)}" value="${esc(getName())}" autocomplete="nickname">
    </div>
    ${code ? `
      <div class="card stack">
        <div class="row"><span class="msg">${tt.code}</span><span class="bigcode">${code}</span></div>
        <button class="btn big primary" data-act="join" title="${esc(tt.joinTip)}">${icon('play')}${tt.joinGame}</button>
      </div>` : `
      <div class="card stack">
        <button class="btn big primary" data-act="family" title="${esc(tt.playFamilyTip)}">${icon('users')}${tt.playFamily}</button>
        <button class="btn big" data-act="computer" title="${esc(tt.playComputerTip)}">${icon('bot')}${tt.playComputer}</button>
        ${canResume ? `<button class="btn big" data-act="resume" title="${esc(tt.resumeTip)}">${icon('refresh')}${tt.resume}</button>` : ''}
      </div>
      <div class="card stack">
        <h2>${tt.joinTitle}</h2>
        <div class="row"><input id="code" class="field grow" maxlength="8" placeholder="${tt.joinPh}" style="text-transform:uppercase;letter-spacing:.1em" autocomplete="off">
        <button class="btn" data-act="joinCode" title="${esc(tt.joinTip)}">${icon('link')}${tt.join}</button></div>
      </div>`}
    <div class="card">
      <h2>${icon('trophy', 14)} ${tt.scoreboard}</h2>
      ${scores.length ? `<table class="scores">${scores.map(([n, w]) => `<tr><td><b>${esc(n)}</b></td><td>${esc(tt.wins(w))}</td></tr>`).join('')}</table>` : `<p class="msg" style="margin:0">${tt.noScores}</p>`}
    </div>
  </div></div>`;

  const nameEl = app.querySelector('#name') as HTMLInputElement;
  const name = () => {
    const n = nameEl.value.trim();
    if (!n) { nameEl.focus(); nameEl.style.borderColor = 'var(--warn)'; return null; }
    putName(n);
    return n;
  };
  app.querySelector('#code')?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') (app.querySelector('[data-act="joinCode"]') as HTMLElement).click(); });
  app.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'lang') { setLang(lang() === 'en' ? 'de' : 'en'); home(); return; }
    if (act === 'resume' && saved) { Host.clearSave(); connect(Client.host(saved.lobby.seats[0]?.name ?? getName(), saved.lobby.code, saved)); return; }
    const n = name();
    if (!n) return;
    if (act === 'computer') {
      Host.clearSave();
      const c = Client.host(n, null);
      c.host!.addComputer(t().computerNames);
      connect(c);
    } else if (act === 'family') {
      Host.clearSave();
      connect(Client.host(n, newCode()));
    } else if (act === 'join' && code) {
      connect(Client.join(code, n, new URLSearchParams(location.search).has('fresh')));
    } else if (act === 'joinCode') {
      const v = (app.querySelector('#code') as HTMLInputElement).value.trim().toUpperCase();
      if (v.length < 4) return;
      location.hash = 'join=' + v;
      connect(Client.join(v, n, new URLSearchParams(location.search).has('fresh')));
    }
  };
}

// ----------------------------------------------------------------- lobby --

function connect(c: Client) {
  leaveClient();
  client = c;
  try { if (c.isHost) sessionStorage.setItem('rollover.hosting', '1'); } catch { /* storage blocked */ }
  offClient = c.on((e) => { if (e.t === 'update') route(); });
  if (c.code && c.isHost) history.replaceState(null, '', location.pathname + location.search);
  route();
}

function leaveClient() {
  offClient?.(); offClient = null;
  gameView?.destroy(); gameView = null;
  client?.dispose(); client = null;
}

function leave() {
  const wasGuest = client && !client.isHost;
  try { sessionStorage.removeItem('rollover.hosting'); } catch { /* storage blocked */ }
  leaveClient();
  if (wasGuest) history.replaceState(null, '', location.pathname + location.search);
  home();
}

function route() {
  const c = client;
  if (!c) return;
  if (c.status === 'full') { leaveClient(); history.replaceState(null, '', location.pathname); home(t().gameFull); return; }
  if (c.lobby?.started && c.state) {
    if (!gameView) { app.onclick = null; app.onchange = null; gameView = new GameView(app, c, leave); }
    return;
  }
  if (gameView) { gameView.destroy(); gameView = null; }
  lobby(c);
}

function lobby(c: Client) {
  const tt = t();
  const L = c.lobby;
  const host = c.host;
  const focused = document.activeElement?.id;
  const statusMsg = c.status === 'connecting' ? tt.connecting : c.status === 'failed' ? tt.connectFailed : c.status === 'lost' ? tt.hostLost : '';
  const levelSel = (id: string, level: AiLevel = 2) => `<select class="field" data-level="${id}" title="${esc(tt.levelTip)}" ${host ? '' : 'disabled'}>
      ${([1, 2, 3] as AiLevel[]).map((l) => `<option value="${l}" ${l === level ? 'selected' : ''}>${[tt.easy, tt.medium, tt.hard][l - 1]}</option>`).join('')}</select>`;

  app.innerHTML = `<div class="screen"><div class="home">
    <div class="brand"><div class="brand-tiles">${brandTiles()}</div><h1>${tt.lobby}</h1></div>
    ${statusMsg ? `<p class="msg ${c.status === 'failed' ? 'warn' : ''}">${esc(statusMsg)}</p>` : ''}
    ${L?.code && host ? `
      <div class="card stack">
        <div class="row"><span class="msg">${tt.code}</span><span class="bigcode">${L.code}</span></div>
        <span class="msg">${tt.shareLink}</span>
        <div class="share"><input class="field" id="link" readonly value="${esc(inviteLink(L.code))}">
        <button class="btn" data-act="copy" title="${esc(tt.copyLinkTip)}">${icon('copy', 16)}<span>${tt.copyLink}</span></button></div>
      </div>` : ''}
    ${L ? `
      <div class="card">
        <h2>${tt.seats}</h2>
        ${L.seats.map((s) => `<div class="seat">
          <div class="who">${s.kind === 'ai' ? icon('bot') : `<span class="dot${s.online ? '' : ' off'}"></span>`}<span>${esc(s.name)}${s.id === c.clientId ? ` (${tt.you})` : ''}</span></div>
          ${s.kind === 'ai' ? levelSel(s.id, s.level) : ''}
          ${host && s.id !== L.hostId ? `<button class="btn icon sm" data-remove="${s.id}" title="${esc(tt.removeTip)}">${icon('x', 16)}</button>` : ''}
        </div>`).join('')}
        ${host && L.seats.length < 4 ? `<div style="margin-top:10px"><button class="btn" data-act="addAi" title="${esc(tt.addComputerTip)}">${icon('plus', 16)}${tt.addComputer}</button></div>` : ''}
      </div>
      <div class="card">
        <h2>${tt.rules}</h2>
        <label class="switch" title="${esc(tt.rolloverTip)}"><input type="checkbox" data-rule="rollover" ${L.rules.rollover ? 'checked' : ''} ${host ? '' : 'disabled'}><span><b>${tt.rolloverRule}</b><br><span class="msg">${tt.rolloverTip}</span></span></label>
        <label class="switch" title="${esc(tt.starsTip)}"><input type="checkbox" data-rule="stars" ${L.rules.stars ? 'checked' : ''} ${host ? '' : 'disabled'}><span><b>${tt.starsRule}</b><br><span class="msg">${tt.starsTip}</span></span></label>
        ${host ? '' : `<p class="msg" style="margin:6px 0 0">${tt.rulesFixed}</p>`}
      </div>` : ''}
    <div class="row">
      <button class="btn" data-act="back" title="${esc(tt.backTip)}">${icon('leave', 16)}${tt.back}</button>
      <span class="grow"></span>
      ${host ? `<button class="btn big primary" data-act="start" title="${esc(tt.startTip)}" ${L && L.seats.length >= 2 ? '' : 'disabled'}>${icon('play')}${tt.start}</button>`
        : L ? `<span class="msg">${tt.waitingHost}</span>` : ''}
    </div>
    ${host && L && L.seats.length < 2 ? `<p class="msg" style="text-align:right">${tt.needTwo}</p>` : ''}
  </div></div>`;
  if (focused) (document.getElementById(focused) as HTMLElement | null)?.focus();

  app.onclick = async (e) => {
    const el = e.target as HTMLElement;
    const rm = el.closest('[data-remove]') as HTMLElement | null;
    if (rm && host) { host.removeSeat(rm.dataset.remove!); return; }
    const b = el.closest('[data-act]') as HTMLElement | null;
    if (!b) return;
    switch (b.dataset.act) {
      case 'back': leave(); break;
      case 'addAi': host?.addComputer(t().computerNames); break;
      case 'start': host?.start(); break;
      case 'copy': {
        const link = (app.querySelector('#link') as HTMLInputElement);
        try { await navigator.clipboard.writeText(link.value); } catch { link.select(); document.execCommand('copy'); }
        b.querySelector('span')!.textContent = tt.copied;
        break;
      }
    }
  };
  app.onchange = (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.rule && host) host.setRules({ [el.dataset.rule]: el.checked });
    if (el.dataset.level && host) host.setLevel(el.dataset.level, Number(el.value) as AiLevel);
  };
}

/** Dev-only tile lab: the six finishes on felt and on the rack, for judging the look. */
function lab() {
  const mk = (color: 0 | 1 | 2 | 3, num: number, joker = false, star = false): Tile => ({ id: -1, color, num, joker, star });
  const row = (tiles: Tile[], tw: number) => tiles.map((x) => `<span class="${tileClass(x)}" style="position:relative;--tw:${tw}px;--th:${Math.round(tw * 1.32)}px;--pos:none">${tileHTML(x)}</span>`).join('');
  const set = [mk(0, 12), mk(0, 13), mk(0, 1, false, true), mk(1, 7), mk(2, 7), mk(3, 7), mk(0, 0, true)];
  const only = new URLSearchParams(location.search).get('lab');
  document.body.className = 'friendly ' + (new URLSearchParams(location.search).get('pal') ?? 'pal-sage');
  const finishes = ['ts-3d', 'ts-neon', 'ts-chrome', 'ts-gummy', 'ts-sugar', 'ts-hardcandy', '', 'ts-porcelain', 'ts-jade', 'ts-wood', 'ts-glass', 'ts-clay'].filter((f) => !only || only === 'all' || f === only || (only === 'ivory' && f === ''));
  app.innerHTML = `<div style="padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:20px">${finishes.map((f) => `
    <div class="${f}" style="display:flex;flex-direction:column;gap:10px">
      <div class="board" style="width:auto;height:auto;padding:26px 24px 34px;display:flex;gap:7px">${row(set, 58)}</div>
      <div class="rack" style="width:auto;height:auto;padding:12px 18px 18px;display:flex;gap:5px">${row(set, 40)}</div></div>`).join('')}</div>`;
}

function boot() {
  // a reload drops nobody out of the game: the host picks its game back up, a guest rejoins
  const code = joinCodeFromUrl();
  const name = getName();
  const saved = Host.load();
  let hosting = false;
  try { hosting = sessionStorage.getItem('rollover.hosting') === '1'; } catch { /* storage blocked */ }
  if (!code && hosting && saved) { connect(Client.host(saved.lobby.seats[0]?.name ?? name, saved.lobby.code, saved)); return; }
  if (code && name && knownGame(code)) { connect(Client.join(code, name, new URLSearchParams(location.search).has('fresh'))); return; }
  home();
}

document.documentElement.lang = lang();
window.addEventListener('hashchange', () => { if (!client) home(); });
applyFinish();
if (import.meta.env.DEV && location.search.includes('lab')) lab(); else boot();
