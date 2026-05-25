#!/usr/bin/env python3
"""
TapController gamepad helper.
Spawned by Electron main process, receives JSON lines on stdin,
emits virtual input (Xbox 360 via ViGEm).
"""
import sys
import json
import os

# ── ViGEm / vgamepad ──────────────────────────────────────────────────────────
sys.stderr.write("Importing vgamepad...\n")
try:
    import vgamepad as vg
    VIGEM_OK = True
    sys.stderr.write("vgamepad imported successfully.\n")
except Exception as e:
    VIGEM_OK = False
    VIGEM_ERR = str(e)
    sys.stderr.write(f"vgamepad import failed: {e}\n")

# ── Gamepad pool (up to 4 controllers) ───────────────────────────────────────
controllers = {}   # client_id → VX360Gamepad

BUTTON_MAP = {
    'a':           vg.XUSB_BUTTON.XUSB_GAMEPAD_A           if VIGEM_OK else None,
    'b':           vg.XUSB_BUTTON.XUSB_GAMEPAD_B           if VIGEM_OK else None,
    'x':           vg.XUSB_BUTTON.XUSB_GAMEPAD_X           if VIGEM_OK else None,
    'y':           vg.XUSB_BUTTON.XUSB_GAMEPAD_Y           if VIGEM_OK else None,
    'lb':          vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER  if VIGEM_OK else None,
    'rb':          vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER if VIGEM_OK else None,
    'start':       vg.XUSB_BUTTON.XUSB_GAMEPAD_START       if VIGEM_OK else None,
    'back':        vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK        if VIGEM_OK else None,
    'guide':       vg.XUSB_BUTTON.XUSB_GAMEPAD_GUIDE       if VIGEM_OK else None,
    'thumb_left':  vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB  if VIGEM_OK else None,
    'thumb_right': vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB if VIGEM_OK else None,
    'dpad_up':     vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP     if VIGEM_OK else None,
    'dpad_down':   vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN   if VIGEM_OK else None,
    'dpad_left':   vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT   if VIGEM_OK else None,
    'dpad_right':  vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT  if VIGEM_OK else None,
    'lt':          vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER  if VIGEM_OK else None, # Fallback
    'rt':          vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER if VIGEM_OK else None, # Fallback
} if VIGEM_OK else {}

def get_or_create_ctrl(client_id):
    if client_id not in controllers and VIGEM_OK:
        try:
            ctrl = vg.VX360Gamepad()
            ctrl.update() # Force OS detection
            controllers[client_id] = ctrl
        except Exception as e:
            emit_err(f"Failed to create gamepad: {e}")
            return None
    return controllers.get(client_id)

def release_ctrl(client_id):
    ctrl = controllers.pop(client_id, None)
    if ctrl:
        try:
            ctrl.reset()
            ctrl.update()
        except Exception:
            pass

def emit(obj):
    print(json.dumps(obj), flush=True)

def emit_err(msg):
    emit({'type': 'error', 'message': msg})

def handle(msg):
    t    = msg.get('type')
    cid  = msg.get('client_id', '0')
    
    # Verbose logging for debugging
    sys.stderr.write(f"[helper] Received: {json.dumps(msg)}\\n")

    # ── Connect / disconnect ─────────────────────────────────────────────────
    if t == 'connect':
        get_or_create_ctrl(cid)
        return

    if t == 'disconnect':
        release_ctrl(cid)
        return

    # ── Button ───────────────────────────────────────────────────────────────
    if t == 'button':
        btn_id  = msg.get('id', '')
        pressed = bool(msg.get('pressed', False))

        ctrl = get_or_create_ctrl(cid)
        if ctrl and btn_id in BUTTON_MAP:
            vg_btn = BUTTON_MAP[btn_id]
            try:
                if pressed:
                    ctrl.press_button(button=vg_btn)
                else:
                    ctrl.release_button(button=vg_btn)
                ctrl.update()
            except Exception as e:
                emit_err(str(e))

    # ── Axis ─────────────────────────────────────────────────────────────────
    elif t == 'axis':
        axis_id = msg.get('id', '')
        x = float(msg.get('x', 0))
        y = float(msg.get('y', 0))

        ctrl = get_or_create_ctrl(cid)
        if ctrl:
            try:
                if axis_id == 'left':
                    ctrl.left_joystick_float(x_value_float=x, y_value_float=-y)
                elif axis_id == 'right':
                    ctrl.right_joystick_float(x_value_float=x, y_value_float=-y)
                ctrl.update()
            except Exception as e:
                emit_err(str(e))

    # ── Trigger ──────────────────────────────────────────────────────────────
    elif t == 'trigger':
        trig_id = msg.get('id', '')
        value   = max(0.0, min(1.0, float(msg.get('value', 0))))

        ctrl = get_or_create_ctrl(cid)
        if ctrl:
            try:
                if trig_id == 'left':
                    ctrl.left_trigger_float(value_float=value)
                elif trig_id == 'right':
                    ctrl.right_trigger_float(value_float=value)
                ctrl.update()
            except Exception as e:
                emit_err(str(e))

    # ── Gyro ─────────────────────────────────────────────────────────────────
    elif t == 'gyro':
        beta  = float(msg.get('beta', 0))
        gamma = float(msg.get('gamma', 0))

        SCALE = 45.0
        rx = max(-1.0, min(1.0, gamma / SCALE))
        ry = max(-1.0, min(1.0, (beta - 45.0) / SCALE))

        ctrl = get_or_create_ctrl(cid)
        if ctrl:
            try:
                ctrl.right_joystick_float(x_value_float=rx, y_value_float=ry)
                ctrl.update()
            except Exception as e:
                emit_err(str(e))

# ── Main loop ─────────────────────────────────────────────────────────────────
def main():
    status = {
        'type': 'ready',
        'vigem': VIGEM_OK,
        'pynput': False,
    }
    if not VIGEM_OK:
        status['vigem_error'] = VIGEM_ERR

    emit(status)

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            handle(msg)
        except json.JSONDecodeError:
            pass
        except Exception as e:
            emit_err(traceback.format_exc())

    # Cleanup on exit
    for cid in list(controllers.keys()):
        release_ctrl(cid)


if __name__ == '__main__':
    import traceback
    main()
