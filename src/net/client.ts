// What the screen talks to. The same Client works for a game on this device (talking to
// a Host in memory) and for a game across the ocean (talking to a Host over PeerJS).

import Peer, { type DataConnection } from 'peerjs';
import type { GameState } from '../engine/game';
import type { Placed } from '../engine/board';
import { Host } from './host';
import type { Lobby, ToClient, ToHost } from './protocol';

const PREFIX = 'rollover-tiles-v1-';

export type Status = 'connecting' | 'ok' | 'lost' | 'failed' | 'full';
export type ClientEvent =
  | { t: 'update' }
  | { t: 'draft'; seat: number }
  | { t: 'react'; seat: number; emoji: string }
  | { t: 'error'; error: string };

export function newCode(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export function deviceId(code: string | null, fresh = false): string {
  const key = 'rollover.id.' + (code ?? 'local');
  const make = () => 'p-' + Math.random().toString(36).slice(2, 10);
  try {
    // ?fresh (for testing two players in one browser) keeps the id to this tab only
    const existing = sessionStorage.getItem(key) || (fresh ? null : localStorage.getItem(key));
    const id = existing || make();
    sessionStorage.setItem(key, id);
    if (!fresh) localStorage.setItem(key, id);
    return id;
  } catch { return make(); }
}

/** True when this browser has joined the game with this code before. */
export function knownGame(code: string): boolean {
  try { return !!(sessionStorage.getItem('rollover.id.' + code) || localStorage.getItem('rollover.id.' + code)); } catch { return false; }
}

export class Client {
  lobby: Lobby | null = null;
  state: GameState | null = null;
  seat = -1;
  drafts = new Map<number, { board: Placed[]; seq: number }>();
  status: Status = 'connecting';
  host: Host | null = null;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private listeners = new Set<(e: ClientEvent) => void>();
  private disposed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(public clientId: string, public name: string, public code: string | null) {}

  on(fn: (e: ClientEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: ClientEvent) { for (const fn of this.listeners) fn(e); }

  get isHost() { return this.host !== null; }

  send(msg: ToHost) {
    if (this.host) { const h = this.host; queueMicrotask(() => h.receive(this.clientId, msg)); return; }
    if (this.conn?.open) this.conn.send(msg);
  }

  private handle(msg: ToClient) {
    switch (msg.t) {
      case 'lobby': this.lobby = msg.lobby; this.emit({ t: 'update' }); break;
      case 'state': {
        const prevSeq = this.state?.seq;
        this.state = msg.state;
        this.seat = msg.seat;
        if (msg.state && msg.state.seq !== prevSeq) this.drafts.clear();
        this.emit({ t: 'update' });
        break;
      }
      case 'draft': this.drafts.set(msg.seat, { board: msg.board, seq: msg.seq }); this.emit({ t: 'draft', seat: msg.seat }); break;
      case 'react': this.emit({ t: 'react', seat: msg.seat, emoji: msg.emoji }); break;
      case 'error': this.emit({ t: 'error', error: msg.error }); break;
      case 'full': this.status = 'full'; this.emit({ t: 'update' }); break;
    }
  }

  // ---- as host -------------------------------------------------------------

  /** Host a game. `code` null = this device only (against the computer). */
  static host(name: string, code: string | null, saved?: { lobby: Lobby; state: GameState | null }): Client {
    const id = saved?.lobby.hostId ?? deviceId(code);
    const c = new Client(id, name, saved ? saved.lobby.code : code);
    c.host = new Host(id, name, c.code, saved);
    c.host.attach(id, (m) => queueMicrotask(() => c.handle(m)));
    c.status = 'ok';
    c.send({ t: 'hello', clientId: id, name });
    if (saved) c.host.kick();
    if (c.code) c.openHostPeer(0);
    return c;
  }

  private openHostPeer(attempt: number) {
    if (this.disposed || !this.code || !this.host) return;
    const host = this.host;
    const peer = new Peer(PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('connection', (conn) => {
      let clientId: string | null = null;
      conn.on('data', (raw) => {
        const msg = raw as ToHost;
        if (msg.t === 'hello') {
          clientId = msg.clientId;
          host.attach(clientId, (m) => { if (conn.open) conn.send(m); });
        }
        if (clientId) host.receive(clientId, msg);
      });
      conn.on('close', () => { if (clientId) host.detach(clientId); });
      conn.on('error', () => { if (clientId) host.detach(clientId); });
    });
    peer.on('disconnected', () => { if (!this.disposed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
    peer.on('error', (err: { type?: string }) => {
      if (err.type === 'unavailable-id' || err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        // the broker may still hold our id from before a reload — try again shortly
        peer.destroy();
        this.retry = setTimeout(() => this.openHostPeer(attempt + 1), Math.min(2000 + attempt * 1000, 8000));
      }
    });
  }

  // ---- as guest ------------------------------------------------------------

  static join(code: string, name: string, fresh = false): Client {
    const c = new Client(deviceId(code, fresh), name, code);
    c.connectGuest();
    return c;
  }

  private connectGuest() {
    if (this.disposed || !this.code) return;
    this.status = this.lobby ? 'lost' : 'connecting';
    this.emit({ t: 'update' });
    const reuse = this.peer && !this.peer.destroyed;
    const peer = reuse ? this.peer! : new Peer({ debug: 1 });
    this.peer = peer;
    if (!reuse) {
      peer.on('error', (err: { type?: string }) => {
        if (err.type === 'peer-unavailable') { this.status = this.lobby ? 'lost' : 'failed'; this.emit({ t: 'update' }); this.again(); }
        else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') { peer.destroy(); this.peer = null; this.again(); }
      });
      peer.on('disconnected', () => { if (!this.disposed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
    }
    const go = () => {
      const conn = peer.connect(PREFIX + this.code, { reliable: true });
      this.conn = conn;
      const timeout = setTimeout(() => { if (!conn.open) { conn.close(); this.again(); } }, 9000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.status = 'ok';
        conn.send({ t: 'hello', clientId: this.clientId, name: this.name } satisfies ToHost);
        this.emit({ t: 'update' });
      });
      conn.on('data', (raw) => this.handle(raw as ToClient));
      conn.on('close', () => { clearTimeout(timeout); if (this.status !== 'full') this.again(); });
    };
    if (peer.open) go(); else peer.once('open', go);
  }

  private again() {
    if (this.disposed || this.retry) return;
    if (this.status === 'ok') { this.status = 'lost'; this.emit({ t: 'update' }); }
    this.retry = setTimeout(() => { this.retry = null; this.connectGuest(); }, 3000);
  }

  dispose() {
    this.disposed = true;
    if (this.retry) clearTimeout(this.retry);
    this.conn?.close();
    this.peer?.destroy();
    this.host?.dispose();
  }
}
