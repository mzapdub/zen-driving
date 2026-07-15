export const GAMEPAD_DEADZONE = 0.16;

export const STANDARD_GAMEPAD_BUTTONS = Object.freeze({
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  leftTrigger: 6,
  rightTrigger: 7,
  start: 9,
  dpadLeft: 14,
  dpadRight: 15,
});

function buttonValue(button) {
  if (typeof button === 'number') return button;
  if (!button) return 0;
  return Math.max(button.pressed ? 1 : 0, Number(button.value) || 0);
}

function buttonPressed(button) {
  return buttonValue(button) > 0.5;
}

export function applyDeadzone(value, deadzone = GAMEPAD_DEADZONE) {
  const numeric = Number(value) || 0;
  return Math.abs(numeric) >= deadzone ? numeric : 0;
}

export function readStandardGamepad(gamepad, previousButtons = []) {
  const buttons = gamepad?.buttons ?? [];
  const axes = gamepad?.axes ?? [];
  const currentButtons = buttons.map(buttonPressed);
  const wasPressed = (index) => previousButtons[index] === true;
  const justPressed = (index) => currentButtons[index] === true && !wasPressed(index);
  const steer = applyDeadzone(axes[0]);

  return {
    state: {
      left: steer < 0 || currentButtons[STANDARD_GAMEPAD_BUTTONS.dpadLeft] === true,
      right: steer > 0 || currentButtons[STANDARD_GAMEPAD_BUTTONS.dpadRight] === true,
      boost: buttonValue(buttons[STANDARD_GAMEPAD_BUTTONS.rightTrigger]) >= GAMEPAD_DEADZONE
        || currentButtons[STANDARD_GAMEPAD_BUTTONS.south] === true,
      handbrake: buttonValue(buttons[STANDARD_GAMEPAD_BUTTONS.leftTrigger]) >= GAMEPAD_DEADZONE
        || currentButtons[STANDARD_GAMEPAD_BUTTONS.west] === true,
    },
    actions: {
      camera: justPressed(STANDARD_GAMEPAD_BUTTONS.north),
      radio: justPressed(STANDARD_GAMEPAD_BUTTONS.east),
      menu: justPressed(STANDARD_GAMEPAD_BUTTONS.start),
    },
    buttonStates: currentButtons,
  };
}
