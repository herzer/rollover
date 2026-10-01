// Fallback transport: when two browsers cannot open a direct connection (a strict network),
// messages travel through a public MQTT broker instead. No account, no server of our own.
// Topics are namespaced by the game code; the code is the only "key", same as the link.

import mqtt, { type MqttClient } from 'mqtt';

const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const ROOT = 'rollover-tiles/v1/';

export const upTopic = (code: string) => `${ROOT}${code}/up`;
export const downTopic = (code: string, clientId: string) => `${ROOT}${code}/down/${clientId}`;

export function connectRelay(onReady: (c: MqttClient) => void, attempt = 0): MqttClient {
  const url = BROKERS[attempt % BROKERS.length];
  const c = mqtt.connect(url, { reconnectPeriod: 3000, connectTimeout: 8000, clean: true });
  let ready = false;
  c.on('connect', () => { if (!ready) { ready = true; onReady(c); } });
  c.on('error', () => {
    if (!ready && attempt < BROKERS.length - 1) { c.end(true); connectRelay(onReady, attempt + 1); }
  });
  return c;
}

export const encode = (o: unknown) => JSON.stringify(o);
export const decode = <T>(b: Uint8Array | string): T | null => {
  try { return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b)) as T; } catch { return null; }
};
