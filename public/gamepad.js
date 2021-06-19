const buttonMap = {
    'map-auto-move': 0,
    'circle-ccw': 16,
    'circle-cw': 17,
    'start-rth': 18,
    'stop-rth': 19,
    'camera-center': 27,
    'take-off': 20,
    'start-flight-plan-land': 10,
    'start-flight-plan-test': 12,
};

const axisMap = {
    'camera-pan': 0,
    'camera-tilt': 1,
    'control-mode': 2,
    roll: 3,
    pitch: 4,
    'control-mode-inverted': 5,
};

const timings = {};

const variableMap = (value, inMin, inMax, outMin, outMax) =>
    ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;

const lastSentCameraMovement = { tilt: null, pan: null };
let lastAction = null;

const gamepadLoop = () => {
    const gamepads = navigator.getGamepads
        ? navigator.getGamepads()
        : navigator.webkitGetGamepads
        ? navigator.webkitGetGamepads
        : [];

    if (!gamepads || gamepads.length === 0) return;

    const isGamepadEnabled = $('#gamepadEnabled').is(':checked');

    if (!isGamepadEnabled) return setTimeout(gamepadLoop, 500);

    const gamepad = gamepads[0];

    const buttons = gamepad.buttons;

    for (let buttonId in buttons) {
        const button = buttons[buttonId];

        buttonId = Number(buttonId);

        const timing = timings['b-' + buttonId];

        if (button.pressed && (!timing || Date.now() - timing > 500)) {
            timings['b-' + buttonId] = Date.now();

            if (buttonId === buttonMap['camera-center']) {
                $('#cameraCenter').trigger('click');
            }

            if (buttonId === buttonMap['take-off']) {
                $('button[data-action="button"][data-property="action"]').trigger('click');
            }

            if (buttonId === buttonMap['circle-ccw']) {
                $('#circleLeft').trigger('click');
            }

            if (buttonId === buttonMap['circle-cw']) {
                $('#circleRight').trigger('click');
            }

            if (buttonId === buttonMap['map-auto-move']) {
                if ($('#mapAutoFollow').is(':checked')) {
                    $('#mapAutoFollow').attr('checked', false);
                } else {
                    $('#mapAutoFollow').attr('checked', true);
                }
            }

            if (buttonId === buttonMap['start-flight-plan-land']) {
                $('#flightPlanLand').trigger('click');
            }

            if (buttonId === buttonMap['start-flight-plan-test']) {
                $('#flightPlanTest').trigger('click');
            }

            if (buttonId === buttonMap['start-rth']) {
                $('#startRth').trigger('click');
            }

            if (buttonId === buttonMap['stop-rth']) {
                $('#stopRth').trigger('click');
            }
        }
    }

    const axes = gamepad.axes;

    const isCameraMovement = axes[axisMap['control-mode']] === 1;

    if (isCameraMovement) {
        if (lastAction !== 'camera') {
            $('#dronePitch-degrees, #droneRoll-degrees').val(0).trigger('change');

            lastAction = 'camera';
        }

        let tiltRaw = axes[axisMap['camera-tilt']];
        let panRaw = axes[axisMap['camera-pan']];

        if (tiltRaw < 0.01 && tiltRaw > -0.01) tiltRaw = 0;
        if (panRaw < 0.01 && panRaw > -0.01) panRaw = 0;

        const tilt = Number(variableMap(tiltRaw, -1, 1, -20, 20).toFixed(0));

        const pan = Number(variableMap(panRaw, -1, 1, -20, 20).toFixed(0));

        if (lastSentCameraMovement.tilt !== tilt || lastSentCameraMovement.pan !== pan) {
            lastSentCameraMovement.tilt = tilt;
            lastSentCameraMovement.pan = pan;

            $('#cameraTilt-degrees').val(tilt).trigger('change');
            $('#cameraPan-degrees').val(pan).trigger('change');
        }
    } else {
        if (lastAction !== 'drone') {
            $('#cameraTilt-degrees, #cameraPan-degrees').val(0).trigger('change');

            lastAction = 'drone';
        }

        let rollRaw = axes[axisMap.roll];
        let pitchRaw = axes[axisMap.pitch];

        if (rollRaw < 0.01 && rollRaw > -0.01) rollRaw = 0;
        if (pitchRaw < 0.01 && pitchRaw > -0.01) pitchRaw = 0;

        const roll = Number(variableMap(rollRaw, -1, 1, -75, 75).toFixed(0));

        const pitch = Number(variableMap(pitchRaw, -1, 1, -75, 75).toFixed(0));

        $('#droneRoll-degrees').val(roll).trigger('change');
        $('#dronePitch-degrees').val(pitch).trigger('change');
    }

    setTimeout(gamepadLoop, 50);
};

let isGamepadConnected = false;

window.addEventListener('gamepadconnected', (e) => {
    const gamepad = navigator.getGamepads()[e.gamepad.index];

    if (gamepad.id.includes('0738') && gamepad.id.includes('2218') && !isGamepadConnected) {
        $('*[data-action="gamepad"][data-property="status"]').css('color', 'green');

        isGamepadConnected = true;

        setTimeout(gamepadLoop);
    } else {
        console.log(`Got invalid gamepad: ${gamepad.id} with index ${gamepad.index}`);
    }
});

window.addEventListener('gamepaddisconnected', () => {
    $('*[data-action="gamepad"][data-property="status"]').css('color', 'red');

    isGamepadConnected = false;
});
