import type { LiveInputSnapshot, PlayerControlConfig } from './types';

function isButtonDown(btn: GamepadButton | undefined): boolean {
  if (!btn) return false;
  return Boolean(btn.pressed || btn.value > 0.42);
}

export interface TouchControlState {
  accelerate: boolean;
  brake: boolean;
  steer: number;
  turbo: boolean;
}

export class InputManager {
  private pressedKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private prevGamepadButtons: Map<number, boolean[]> = new Map();
  private latchedGamepadJustPressed: Map<number, Set<number>> = new Map();
  private frameEdgesLatched = false;

  private touchState: TouchControlState = {
    accelerate: false,
    brake: false,
    steer: 0,
    turbo: false,
  };
  private touchJumpJust = false;
  private touchItemJust = false;
  private touchPauseJust = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'NumpadEnter',
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
    if (!this.pressedKeys.has(e.code)) {
      this.justPressedKeys.add(e.code);
    }
    this.pressedKeys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.pressedKeys.delete(e.code);
  };

  private onBlur = () => {
    this.pressedKeys.clear();
    this.justPressedKeys.clear();
    this.clearTouchState();
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.pressedKeys.clear();
      this.justPressedKeys.clear();
      this.clearTouchState();
    }
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  public setTouchControlState(partial: Partial<TouchControlState>): void {
    this.touchState = { ...this.touchState, ...partial };
  }

  public triggerTouchPulse(action: 'jump' | 'item' | 'pause'): void {
    if (action === 'jump') this.touchJumpJust = true;
    if (action === 'item') this.touchItemJust = true;
    if (action === 'pause') this.touchPauseJust = true;
  }

  public clearTouchState(): void {
    this.touchState = { accelerate: false, brake: false, steer: 0, turbo: false };
    this.touchJumpJust = false;
    this.touchItemJust = false;
    this.touchPauseJust = false;
  }

  public clearInputs(): void {
    this.pressedKeys.clear();
    this.justPressedKeys.clear();
    this.latchedGamepadJustPressed.clear();
    this.frameEdgesLatched = false;
    this.clearTouchState();
  }

  private ensureFrameGamepadEdgesLatched(): void {
    if (this.frameEdgesLatched) return;
    this.frameEdgesLatched = true;
    const gamepads = this.getConnectedGamepads();
    for (const gp of gamepads) {
      const prev = this.prevGamepadButtons.get(gp.index) ?? [];
      let edgeSet = this.latchedGamepadJustPressed.get(gp.index);
      if (!edgeSet) {
        edgeSet = new Set<number>();
        this.latchedGamepadJustPressed.set(gp.index, edgeSet);
      }
      gp.buttons.forEach((b, idx) => {
        const down = isButtonDown(b);
        if (down && !prev[idx]) {
          edgeSet!.add(idx);
        }
      });
    }
  }

  public endFrame(): void {
    this.justPressedKeys.clear();
    this.touchJumpJust = false;
    this.touchItemJust = false;
    this.touchPauseJust = false;
    const gamepads = this.getConnectedGamepads();
    for (const gp of gamepads) {
      this.prevGamepadButtons.set(
        gp.index,
        gp.buttons.map((b) => isButtonDown(b)),
      );
    }
    this.latchedGamepadJustPressed.clear();
    this.frameEdgesLatched = false;
  }

  public getConnectedGamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    const list = navigator.getGamepads();
    const result: Gamepad[] = [];
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (gp && gp.connected && gp.buttons && gp.buttons.length >= 10) {
        result.push(gp);
      }
    }
    result.sort((a, b) => {
      const aStd = a.mapping === 'standard' ? 0 : 1;
      const bStd = b.mapping === 'standard' ? 0 : 1;
      if (aStd !== bStd) return aStd - bStd;
      return a.index - b.index;
    });
    return result;
  }

  public getPressedKeyList(): string[] {
    return Array.from(this.pressedKeys);
  }

  public wasKeyJustPressed(code: string): boolean {
    return this.justPressedKeys.has(code);
  }

  public isKeyPressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  public isShiftPressed(): boolean {
    return this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight');
  }

  public wasIntroGamepadPressed(): boolean {
    this.ensureFrameGamepadEdgesLatched();
    for (const gp of this.getConnectedGamepads()) {
      const edgeSet = this.latchedGamepadJustPressed.get(gp.index);
      if (edgeSet && (edgeSet.has(0) || edgeSet.has(9))) {
        return true;
      }
    }
    return false;
  }

  public samplePlayerInput(config: PlayerControlConfig): LiveInputSnapshot {
    this.ensureFrameGamepadEdgesLatched();

    const connected = this.getConnectedGamepads();
    const targetGpIndex = config.gamepadIndex ?? config.playerIndex;
    const gamepad =
      config.deviceMode === 'keyboard'
        ? undefined
        : connected.find((g) => g.index === targetGpIndex) ??
          (config.deviceMode === 'auto'
            ? connected[config.playerIndex] ?? (config.playerIndex === 0 ? connected[0] : undefined)
            : connected[config.playerIndex]);

    const kb = config.keyboard;
    const gpMap = config.gamepad;

    const kbAccel = this.pressedKeys.has(kb.accelerate);
    const kbBrake = this.pressedKeys.has(kb.brake);
    const kbLeft = this.pressedKeys.has(kb.left);
    const kbRight = this.pressedKeys.has(kb.right);
    const kbTurbo = this.pressedKeys.has(kb.turbo);
    const kbJumpJust = this.justPressedKeys.has(kb.jump);
    const kbItemJust = this.justPressedKeys.has(kb.item);
    const shiftDown = this.isShiftPressed();
    const kbPauseJust =
      config.playerIndex === 0 &&
      (this.justPressedKeys.has('Escape') || (this.justPressedKeys.has('KeyP') && !shiftDown));

    let gpAccel = false;
    let gpBrake = false;
    let gpSteer = 0;
    let gpTurbo = false;
    let gpJumpJust = false;
    let gpItemJust = false;
    let gpPauseJust = false;
    const rawGamepadButtons: number[] = [];
    const rawGamepadAxes: number[] = [];

    if (gamepad && config.deviceMode !== 'keyboard') {
      const edgeSet = this.latchedGamepadJustPressed.get(gamepad.index);
      const prevBtns = this.prevGamepadButtons.get(gamepad.index) ?? [];

      gamepad.buttons.forEach((b, idx) => {
        if (isButtonDown(b)) rawGamepadButtons.push(idx);
      });
      gamepad.axes.forEach((a) => rawGamepadAxes.push(Number(a.toFixed(2))));

      const isPressed = (idx: number) => isButtonDown(gamepad.buttons[idx]);
      const isJustPressed = (idx: number) =>
        Boolean(edgeSet?.has(idx) || (isButtonDown(gamepad.buttons[idx]) && !prevBtns[idx]));

      gpAccel = isPressed(gpMap.accelerate);
      gpItemJust = isJustPressed(gpMap.item);
      gpPauseJust = isJustPressed(gpMap.pause);

      const l1Held = isPressed(gpMap.jumpL1);
      const r1Held = isPressed(gpMap.jumpR1);
      const l1Just = isJustPressed(gpMap.jumpL1);
      const r1Just = isJustPressed(gpMap.jumpR1);

      if (l1Held && r1Held) {
        gpTurbo = true;
      } else if (l1Just || r1Just) {
        gpJumpJust = true;
      }

      const stickY = gamepad.axes[1] ?? 0;
      gpBrake = isPressed(gpMap.brake) || isPressed(13) || stickY > 0.45;

      const stickX = gamepad.axes[0] ?? 0;
      if (Math.abs(stickX) > 0.14) {
        gpSteer = stickX;
      } else if (isPressed(14)) {
        gpSteer = -1;
      } else if (isPressed(15)) {
        gpSteer = 1;
      }
    }

    const isP1 = config.playerIndex === 0;
    const touchAccel = isP1 && this.touchState.accelerate;
    const touchBrake = isP1 && this.touchState.brake;
    const touchSteer = isP1 ? this.touchState.steer : 0;
    const touchTurbo = isP1 && this.touchState.turbo;
    const touchJumpJust = isP1 && this.touchJumpJust;
    const touchItemJust = isP1 && this.touchItemJust;
    const touchPauseJust = isP1 && this.touchPauseJust;

    const kbSteer = (kbRight ? 1 : 0) - (kbLeft ? 1 : 0);
    const combinedSteer =
      Math.abs(touchSteer) > 0.05
        ? touchSteer
        : Math.abs(gpSteer) > 0.14
          ? gpSteer
          : kbSteer;

    let activeDeviceLabel = 'Teclado';
    if (isP1 && (touchAccel || touchBrake || Math.abs(touchSteer) > 0.05 || touchTurbo)) {
      activeDeviceLabel = 'Táctil';
    } else if (gamepad && config.deviceMode !== 'keyboard') {
      activeDeviceLabel =
        config.deviceMode === 'gamepad'
          ? `Mando ${gamepad.index + 1}`
          : rawGamepadButtons.length > 0 || Math.abs(gpSteer) > 0.2
            ? `Mando ${gamepad.index + 1}`
            : `Teclado / Mando ${gamepad.index + 1}`;
    }

    return {
      accelerate: kbAccel || gpAccel || touchAccel,
      brake: kbBrake || gpBrake || touchBrake,
      steer: Math.max(-1, Math.min(1, combinedSteer)),
      turbo: kbTurbo || gpTurbo || touchTurbo,
      jumpJustPressed: kbJumpJust || gpJumpJust || touchJumpJust,
      itemJustPressed: kbItemJust || gpItemJust || touchItemJust,
      pauseJustPressed: kbPauseJust || gpPauseJust || touchPauseJust,
      rawPressedKeys: this.getPressedKeyList(),
      rawGamepadButtons,
      rawGamepadAxes,
      activeDeviceLabel,
    };
  }
}
