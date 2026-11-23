import type {
  CharacterId,
  KartCustomization,
  OnlineRoomState,
  RemoteKartTelemetry,
} from './types';

export interface OpenRoomSummary {
  code: string;
  trackId: string;
  laps: number;
  playerCount: number;
  maxPlayers: number;
  hostName: string;
}

export interface OnlineAttackEvent {
  senderId: string;
  attackType: 'homing_rocket' | 'bolt' | 'shockwave' | 'aku_aku_ram';
  targetId?: string;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface OnlineClientHandlers {
  onConnectionChange?: (connected: boolean) => void;
  onRoomsList?: (rooms: OpenRoomSummary[]) => void;
  onJoined?: (playerId: string, room: OnlineRoomState) => void;
  onRoomState?: (room: OnlineRoomState) => void;
  onRaceStart?: (room: OnlineRoomState, startedAt: number) => void;
  onRaceSnapshot?: (karts: RemoteKartTelemetry[]) => void;
  onAttackEvent?: (ev: OnlineAttackEvent) => void;
  onError?: (message: string) => void;
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private handlers: OnlineClientHandlers = {};
  private playerId: string | null = null;
  private room: OnlineRoomState | null = null;
  private pendingQueue: string[] = [];

  public setHandlers(handlers: OnlineClientHandlers): void {
    this.handlers = handlers;
  }

  public getPlayerId(): string | null {
    return this.playerId;
  }

  public getRoom(): OnlineRoomState | null {
    return this.room;
  }

  public isHost(): boolean {
    return Boolean(this.playerId && this.room && this.room.hostId === this.playerId);
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const sock = new WebSocket(url);
    this.ws = sock;

    sock.onopen = () => {
      this.handlers.onConnectionChange?.(true);
      while (this.pendingQueue.length > 0 && sock.readyState === WebSocket.OPEN) {
        const msg = this.pendingQueue.shift();
        if (msg) sock.send(msg);
      }
      this.requestOpenRooms();
    };

    sock.onclose = () => {
      this.handlers.onConnectionChange?.(false);
    };

    sock.onerror = () => {
      this.handlers.onError?.('Error de conexión con el servidor multijugador.');
    };

    sock.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
        const type = msg.type;
        if (type === 'rooms:list' && Array.isArray(msg.rooms)) {
          this.handlers.onRoomsList?.(msg.rooms as OpenRoomSummary[]);
        } else if (type === 'room:joined') {
          this.playerId = msg.playerId as string;
          this.room = msg.room as OnlineRoomState;
          this.handlers.onJoined?.(this.playerId, this.room);
        } else if (type === 'room:state') {
          this.room = msg.room as OnlineRoomState;
          this.handlers.onRoomState?.(this.room);
        } else if (type === 'race:start') {
          this.room = msg.room as OnlineRoomState;
          this.handlers.onRaceStart?.(this.room, Number(msg.startedAt) || Date.now());
        } else if (type === 'race:snapshot' && Array.isArray(msg.karts)) {
          this.handlers.onRaceSnapshot?.(msg.karts as RemoteKartTelemetry[]);
        } else if (type === 'race:attack_event') {
          this.handlers.onAttackEvent?.(msg as unknown as OnlineAttackEvent);
        } else if (type === 'room:error' && typeof msg.message === 'string') {
          this.handlers.onError?.(msg.message);
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }

  private send(payload: unknown): void {
    const encoded = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encoded);
    } else {
      this.pendingQueue.push(encoded);
      this.connect();
    }
  }

  public requestOpenRooms(): void {
    this.send({ type: 'rooms:list' });
  }

  public createRoom(params: {
    name: string;
    characterId: CharacterId;
    customization: KartCustomization;
    trackId: string;
    laps: number;
    aiCount: number;
  }): void {
    this.send({
      type: 'room:create',
      ...params,
      includeAI: params.aiCount > 0,
    });
  }

  public joinRoom(params: {
    code: string;
    name: string;
    characterId: CharacterId;
    customization: KartCustomization;
  }): void {
    this.send({
      type: 'room:join',
      ...params,
    });
  }

  public updatePlayer(params: {
    name?: string;
    characterId?: CharacterId;
    customization?: KartCustomization;
    ready?: boolean;
  }): void {
    this.send({ type: 'room:update_player', ...params });
  }

  public updateRoomSettings(params: {
    trackId?: string;
    laps?: number;
    aiCount?: number;
  }): void {
    this.send({
      type: 'room:update_settings',
      ...params,
      includeAI: typeof params.aiCount === 'number' ? params.aiCount > 0 : undefined,
    });
  }

  public startRoomRace(): void {
    this.send({ type: 'room:start' });
  }

  public backToLobby(): void {
    this.send({ type: 'room:back_to_lobby' });
  }

  public leaveRoom(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:leave' }));
    }
    this.room = null;
    this.playerId = null;
  }

  public sendTelemetry(kart: RemoteKartTelemetry, aiKarts?: RemoteKartTelemetry[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'race:telemetry', kart, aiKarts }));
  }

  public sendAttack(ev: Omit<OnlineAttackEvent, 'senderId'>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'race:attack', ...ev }));
  }

  public sendPlayerFinished(finishTimeMs: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'race:player_finished', finishTimeMs }));
  }

  public dispose(): void {
    this.leaveRoom();
    this.ws?.close();
    this.ws = null;
  }
}
