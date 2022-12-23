import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

export type LocalCache = {
    gpsFixed?: boolean;
    altitude?: number;
    flyingState?: ParrotDiscoFlyingState;
    canTakeOff?: boolean;
    sensorStates?: { [key: string]: boolean };
    cameraMaxTiltSpeed?: number;
    cameraMaxPanSpeed?: number;
    defaultCameraTilt?: number;
    defaultCameraPan?: number;
    lastCalibrationStatus?: boolean;
    lastHardwareStatus?: boolean;
    lastHomeTypeStatus?: boolean;
    lastRTHStatus?: boolean;
};
