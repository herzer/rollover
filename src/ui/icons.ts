// Lucide icons (the house icon set for web apps), rendered to inline SVG strings.
import {
  Crown, Star, Undo2, Lightbulb, Hand, Check, ArrowDownWideNarrow, Layers, Volume2, VolumeX,
  Languages, LogOut, Copy, Bot, User, Users, Plus, X, Play, Wifi, WifiOff, Trophy, Sparkles,
  RefreshCw, Smile, Palette, Eye, Repeat, Link, Share2, HelpCircle, Settings2,
} from 'lucide';

type Node = [string, Record<string, string | number>][];
const ICONS: Record<string, Node> = {
  crown: Crown, star: Star, undo: Undo2, hint: Lightbulb, hand: Hand, check: Check,
  sortNum: ArrowDownWideNarrow, sortGroup: Layers, sound: Volume2, mute: VolumeX, lang: Languages,
  leave: LogOut, copy: Copy, bot: Bot, user: User, users: Users, plus: Plus, x: X, play: Play,
  wifi: Wifi, wifiOff: WifiOff, trophy: Trophy, sparkles: Sparkles, refresh: RefreshCw,
  smile: Smile, palette: Palette, eye: Eye, repeat: Repeat, link: Link, share: Share2, help: HelpCircle, settings: Settings2,
} as unknown as Record<string, Node>;

export function icon(name: keyof typeof ICONS | string, size = 18, stroke = 2): string {
  const node = ICONS[name];
  if (!node) return '';
  const inner = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
