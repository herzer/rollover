// What the screen talks to. The same Client works for a game on this device (talking to
// a Host in memory) and for a game across the ocean (talking to a Host over PeerJS).

import Peer, { type DataConnection } from 'peerjs';
import type { GameState } from '../engine/game';
import type { Placed } from '../engine/board';
import { Host } from './host';
import type { MqttClient } from 'mqtt';
import { connectRelay, decode, downTopic, encode, upTopic } from './relay';
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

/** A per-device secret that proves a seat is ours when we reconnect. */
export function deviceSecret(fresh = false): string {
  const key = 'rollover.secret';
  const make = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try {
    const existing = sessionStorage.getItem(key) || (fresh ? null : localStorage.getItem(key));
    const v = existing || make();
    sessionStorage.setItem(key, v);
    if (!fresh) localStorage.setItem(key, v);
    return v;
  } catch { return make(); }
}

/** True when this browser has joined the game with this code before. */
export function knownGame(code: string): boolean {
  try { return !!(sessionStorage.getItem('rollover.id.' + code) || localStorage.getItem('rollover.id.' + code)); } catch { return false; }
}

export class Client {
  /** This device's clock minus the host's (for the turn timer: the countdown follows the host's clock). */
  clockOffset = 0;
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
  // relay fallback (see relay.ts)
  private relay: MqttClient | null = null;
  private relayTimer: ReturnType<typeof setInterval> | null = null;
  private relaySeen = new Map<string, number>();
  private lastHeard = 0;
  private openFails = 0;
  /** True when this guest talks to the host through the relay. */
  viaRelay = false;

  secret = '';
  constructor(public clientId: string, public name: string, public code: string | null) {}

  on(fn: (e: ClientEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: ClientEvent) { for (const fn of this.listeners) fn(e); }

  get isHost() { return this.host !== null; }

  send(msg: ToHost) {
    if (this.host) { const h = this.host; queueMicrotask(() => h.receive(this.clientId, msg)); return; }
    if (this.viaRelay && this.relay && this.code) { this.relay.publish(upTopic(this.code), encode({ from: this.clientId, msg })); return; }
    if (this.conn?.open) this.conn.send(msg);
  }

  private handle(msg: ToClient) {
    switch (msg.t) {
      case 'lobby': this.lobby = msg.lobby; this.emit({ t: 'update' }); break;
      case 'state': {
        const prevSeq = this.state?.seq;
        if (msg.now) this.clockOffset = Date.now() - msg.now;
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
      case 'pong': break;
      case 'who': this.send({ t: 'hello', clientId: this.clientId, name: this.name, secret: this.secret }); break;
    }
  }

  // ---- as host -------------------------------------------------------------

  /** Host a game. `code` null = this device only (against the computer). */
  static host(name: string, code: string | null, saved?: { lobby: Lobby; state: GameState | null }): Client {
    const id = saved?.lobby.hostId ?? deviceId(code);
    const c = new Client(id, name, saved ? saved.lobby.code : code);
    c.secret = saved?.lobby.secrets?.[id] ?? deviceSecret();
    c.host = new Host(id, name, c.code, saved, c.secret);
    c.host.attach(id, (m) => queueMicrotask(() => c.handle(m)));
    c.status = 'ok';
    c.send({ t: 'hello', clientId: id, name, secret: c.secret });
    if (saved) c.host.kick();
    if (c.code) { c.openHostPeer(0); c.openHostRelay(); }
    return c;
  }

  private openHostPeer(attempt: number) {
    if (this.disposed || !this.code || !this.host) return;
    const host = this.host;
    const peer = new Peer(PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('connection', (conn) => {
      let clientId: string | null = null;
      const send = (m: ToClient) => { if (conn.open) conn.send(m); };
      conn.on('data', (raw) => {
        const msg = raw as ToHost;
        if (msg?.t === 'hello' && !clientId) {
          // one identity per connection, and never the host's own
          if (typeof msg.clientId !== 'string' || msg.clientId === host.lobby.hostId) { conn.close(); return; }
          clientId = msg.clientId;
          host.attach(clientId, send);
        }
        if (clientId) host.receive(clientId, msg?.t === 'hello' ? { ...msg, clientId } : msg);
      });
      conn.on('close', () => { if (clientId) host.detach(clientId, send); });
      conn.on('error', () => { if (clientId) host.detach(clientId, send); });
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

  /** The host also listens on the relay, for guests whose network blocks a direct link. */
  private openHostRelay() {
    const host = this.host!, code = this.code!;
    connectRelay((c) => {
      if (this.disposed) { c.end(true); return; }
      this.relay = c;
      c.subscribe(upTopic(code));
      c.on('message', (_topic, payload) => {
        const m = decode<{ from: string; msg: ToHost | { t: 'ping' } }>(payload);
        if (!m || typeof m.from !== 'string' || !m.msg || m.from === host.lobby.hostId) return;
        const from = m.from;
        const reply = (out: ToClient) => c.publish(downTopic(code, from), encode(out));
        if (m.msg.t === 'hello') {
          host.attach(from, reply);
          host.receive(from, { ...m.msg, clientId: from });
          if (host.isAttached(from)) this.relaySeen.set(from, Date.now());
          return;
        }
        // nothing but hello is accepted from someone who has not said hello (e.g. after a host reload)
        if (!this.relaySeen.has(from)) { reply({ t: 'who' }); return; }
        this.relaySeen.set(from, Date.now());
        if (m.msg.t === 'ping') { reply({ t: 'pong' }); return; }
        host.receive(from, m.msg);
      });
    });
    this.relayTimer = setInterval(() => {
      for (const [id, at] of this.relaySeen) if (Date.now() - at > 30000) { this.relaySeen.delete(id); host.detach(id); }
    }, 10000);
  }

  // ---- as guest ------------------------------------------------------------

  static join(code: string, name: string, fresh = false): Client {
    const c = new Client(deviceId(code, fresh), name, code);
    c.secret = deviceSecret(fresh);
    if (new URLSearchParams(location.search).has('relay')) c.useRelay(); else c.connectGuest();
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
        else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          peer.destroy(); this.peer = null;
          if (++this.openFails >= 2) this.useRelay(); else this.again();
        }
      });
      peer.on('disconnected', () => { if (!this.disposed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
    }
    const go = () => {
      this.conn?.close(); // never keep a stale link open beside the new one
      const conn = peer.connect(PREFIX + this.code, { reliable: true });
      this.conn = conn;
      const timeout = setTimeout(() => {
        if (conn.open) return;
        conn.close();
        // the host exists but the direct link would not open: a strict network — use the relay
        if (++this.openFails >= 1) this.useRelay(); else this.again();
      }, 9000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.status = 'ok';
        conn.send({ t: 'hello', clientId: this.clientId, name: this.name, secret: this.secret } satisfies ToHost);
        this.emit({ t: 'update' });
      });
      conn.on('data', (raw) => this.handle(raw as ToClient));
      conn.on('close', () => { clearTimeout(timeout); if (this.conn === conn && this.status !== 'full') this.again(); });
    };
    if (peer.open) go(); else peer.once('open', go);
  }

  private useRelay() {
    if (this.viaRelay || this.disposed || !this.code) return;
    this.viaRelay = true;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.conn?.close(); this.conn = null;
    this.peer?.destroy(); this.peer = null;
    const code = this.code;
    connectRelay((c) => {
      if (this.disposed) { c.end(true); return; }
      this.relay = c;
      c.subscribe(downTopic(code, this.clientId));
      c.on('message', (_topic, payload) => {
        const m = decode<ToClient>(payload);
        if (!m) return;
        this.lastHeard = Date.now();
        if (this.status !== 'ok' && this.status !== 'full') { this.status = 'ok'; this.emit({ t: 'update' }); }
        this.handle(m);
      });
      const hello = () => this.send({ t: 'hello', clientId: this.clientId, name: this.name, secret: this.secret });
      hello();
      this.lastHeard = Date.now();
      this.relayTimer = setInterval(() => {
        c.publish(upTopic(code), encode({ from: this.clientId, msg: { t: 'ping' } }));
        if (Date.now() - this.lastHeard > 25000 && this.status === 'ok') { this.status = 'lost'; this.emit({ t: 'update' }); hello(); }
      }, 8000);
    });
  }

  private again() {
    if (this.disposed || this.retry || this.viaRelay) return;
    if (this.status === 'ok') { this.status = 'lost'; this.emit({ t: 'update' }); }
    this.retry = setTimeout(() => { this.retry = null; this.connectGuest(); }, 3000);
  }

  dispose() {
    this.disposed = true;
    if (this.retry) clearTimeout(this.retry);
    this.conn?.close();
    this.peer?.destroy();
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.relay?.end(true);
    this.host?.dispose();
  }
}
