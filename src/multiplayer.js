const DEFAULT_ROOM = 'KITCHEN';
const SERVER_STORAGE_KEY = 'chop-chop-multiplayer-url';

/** Three-player WebSocket client. The server owns the shared turn state. */
export class KitchenMultiplayer {
  constructor({ onRoom, onGame, onActivity, onError } = {}) {
    this.socket = null;
    this.room = null;
    this.playerId = null;
    this.snapshot = null;
    this.onRoom = onRoom || (() => {});
    this.onGame = onGame || (() => {});
    this.onActivity = onActivity || (() => {});
    this.onError = onError || (() => {});
  }

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  get activePlayerId() {
    const game = this.snapshot?.game;
    return game?.order?.[game.currentStep % 3] || null;
  }
  get isMyTurn() { return !this.connected || this.activePlayerId === this.playerId; }

  connect({ url, room = DEFAULT_ROOM, name }) {
    this.disconnect();
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(normalizeMultiplayerUrl(url));
      } catch (error) {
        reject(error);
        return;
      }
      this.socket = socket;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('멀티 서버 응답이 없습니다. 서버 주소와 실행 상태를 확인해 주세요.'));
      }, 8000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join', room, name })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'welcome') {
          this.playerId = message.playerId;
          settled = true;
          window.clearTimeout(timeout);
          resolve(message);
        }
        if (message.type === 'snapshot') {
          this.snapshot = message;
          this.room = message.room;
          this.onRoom(message);
          if (message.game?.started) this.onGame(message);
        }
        if (message.type === 'activity') this.onActivity(message.activity || {});
        if (message.type === 'error') {
          this.onError(message.message);
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(message.message));
          }
        }
      });
      socket.addEventListener('close', () => {
        window.clearTimeout(timeout);
        this.onRoom({ disconnected: true });
      });
      socket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        const error = new Error('멀티 서버에 연결하지 못했습니다. 서버 주소와 HTTPS 인증서를 확인해 주세요.');
        this.onError(error.message);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  send(type, payload = {}) {
    if (!this.connected) return false;
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }
  setName(name) { return this.send('name', { name }); }
  setOrder(order, sharedState) { return this.send('set_order', { order, sharedState }); }
  setReady(ready = true, sharedState) { return this.send('ready', { ready, sharedState }); }
  submitStep(accuracy, ingredientCuts = {}) { return this.send('step', { accuracy, ingredientCuts }); }
  enterStation() { return this.send('enter_station'); }
  sendActivity(activity) { return this.send('activity', { activity }); }
  nextDay(sharedState) { return this.send('next_day', { sharedState }); }
  disconnect() { this.socket?.close(); this.socket = null; }
}

export function defaultMultiplayerUrl() {
  const queryUrl = new URLSearchParams(location.search).get('server');
  const savedUrl = localStorage.getItem(SERVER_STORAGE_KEY);
  if (queryUrl || savedUrl) return queryUrl || savedUrl;

  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    return 'ws://127.0.0.1:8001/ws';
  }
  return '';
}

export function normalizeMultiplayerUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    throw new Error('배포된 멀티 서버의 HTTPS/WSS 주소를 입력해 주세요.');
  }

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error('멀티 서버 주소 형식이 올바르지 않습니다.');
  }
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('멀티 서버 주소는 HTTPS 또는 WSS 주소여야 합니다.');
  }
  if (location.protocol === 'https:' && url.protocol !== 'wss:') {
    throw new Error('GitHub Pages에서는 HTTPS/WSS 멀티 서버 주소가 필요합니다.');
  }
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  localStorage.setItem(SERVER_STORAGE_KEY, url.toString());
  return url.toString();
}

export function multiplayerApiUrl(path = '/') {
  const url = new URL(normalizeMultiplayerUrl(defaultMultiplayerUrl()));
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
