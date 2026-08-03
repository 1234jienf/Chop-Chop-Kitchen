const DEFAULT_ROOM = 'KITCHEN';

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
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join', room, name })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'welcome') {
          this.playerId = message.playerId;
          settled = true;
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
          if (!settled) reject(new Error(message.message));
        }
      });
      socket.addEventListener('close', () => this.onRoom({ disconnected: true }));
      socket.addEventListener('error', () => {
        const error = new Error('멀티 서버에 연결하지 못했습니다.');
        this.onError(error.message);
        if (!settled) reject(error);
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
  sendActivity(activity) { return this.send('activity', { activity }); }
  nextDay(sharedState) { return this.send('next_day', { sharedState }); }
  disconnect() { this.socket?.close(); this.socket = null; }
}

export function defaultMultiplayerUrl() {
  const host = location.hostname || '127.0.0.1';
  return `ws://${host}:8001/ws`;
}
