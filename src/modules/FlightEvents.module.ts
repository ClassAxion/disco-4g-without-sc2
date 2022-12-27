import ParrotDisco from 'parrot-disco-api';
import { Logger } from 'winston';
import FlightCache from './FlightCache.module';
import ParrotDiscoMap from './ParrotDiscoMap.module';

export default class FlightEvents {
    private lastSpeedPacket: number = 0;
    private lastAltitudePacket: number = 0;
    private lastAttitudePacket: number = 0;

    constructor(
        private readonly disco: ParrotDisco,
        private readonly sendPacketToEveryone: Function,
        private readonly localCache: FlightCache,
        private readonly logger: Logger,
        private readonly map: ParrotDiscoMap,
    ) {}

    public alert(message: string, level: string = 'info') {
        this.sendPacketToEveryone({
            action: 'alert',
            data: {
                message,
                level,
            },
        });
    }

    public createAlerts() {
        this.disco.on('VideoStateChangedV2', ({ state }) => {
            if (state === 'started') {
                this.alert('Recording has been started (V2)', 'info');
            } else if (state === 'stopped') {
                this.alert('Recording has been stopped (V2)', 'info');
            }
        });

        this.disco.on('VideoStateChanged', ({ state }) => {
            if (state === 'started') {
                this.alert('Recording has been started', 'info');
            } else if (state === 'stopped') {
                this.alert('Recording has been stopped', 'info');
            }
        });

        this.disco.on('moveToChanged', ({ status }) => {
            this.alert(`MoveTo got ${status}`, 'success');
        });

        this.disco.on('MissonItemExecuted', ({ idx }) => {
            this.alert(`Executed waypoint #${idx}`, 'success');
        });

        this.disco.on('MavlinkFilePlayingStateChanged', (data) => {
            const { state } = data;

            if (state === 'playing') {
                this.alert('Flight plan start confirmed', 'success');
            } else if (state === 'paused') {
                this.alert('Flight plan paused', 'info');
            } else if (state === 'stopped') {
                this.alert('Flight plan stopped', 'info');
            }
        });

        /* TESTING */

        this.disco.on('AlertStateChanged', (data) => {
            this.alert(`AlertStateChanged got ${JSON.stringify(data)}`);

            this.logger.info(`AlertStateChanged to ${JSON.stringify(data)}`);
        });

        this.disco.on('VibrationLevelChanged', ({ state }) => {
            this.alert(`VibrationLevelChanged changed to ${state}`);

            this.logger.info(`VibrationLevelChanged to ${state}`);
        });

        this.disco.on('NavigateHomeStateChanged', ({ state, reason }) => {
            if (state === 'available') {
                this.alert(`Navigating home is available`);
                this.logger.warn(`Navigating home is available`);
            } else if (state === 'unavailable') {
                this.alert(`Navigating home is unavailable`, 'warning');

                this.logger.warn(`Navigating home is unavailable`);
            }
        });

        this.disco.on('HomeTypeAvailabilityChanged', ({ type, available }) => {
            this.alert(`Home ${type} is ${available ? 'available' : 'unavailable'}`);

            this.logger.info(`Home ${type} is ${available ? 'available' : 'unavailable'}`);
        });

        this.disco.on('ResetHomeChanged', (data) => {
            this.alert(`ResetHomeChanged to ${JSON.stringify(data)}`);

            this.logger.info(`ResetHomeChanged to ${JSON.stringify(data)}`);
        });

        this.disco.on('PitotCalibrationStateChanged', ({ state, lastError }) => {
            const required = state === 'required';

            this.localCache.set('pitotCalibrationRequired', required);

            this.sendPacketToEveryone({
                action: 'health',
                data: {
                    pitotCalibrationRequired: this.localCache.get('pitotCalibrationRequired'),
                },
            });

            if (required) {
                this.alert('Pitot need calibration', 'danger');

                this.logger.warn(`Pitot need calibration`);
            }
        });

        this.disco.on('MotorFlightsStatusChanged', (data) => {
            this.alert(`MotorFlightsStatusChanged to ${JSON.stringify(data)}`);

            this.logger.info(`MotorFlightsStatusChanged to ${JSON.stringify(data)}`);
        });

        this.disco.on('MotorErrorLastErrorChanged', (data) => {
            this.alert(`MotorErrorLastErrorChanged to ${JSON.stringify(data)}`);

            this.logger.info(`MotorErrorLastErrorChanged to ${JSON.stringify(data)}`);
        });
    }

    public createChecks() {
        this.disco.on('MagnetoCalibrationRequiredState', ({ required }) => {
            this.localCache.set('magnetoCalibrationRequired', required === 1);

            this.sendPacketToEveryone({
                action: 'health',
                data: {
                    magnetoCalibrationRequired: this.localCache.get('magnetoCalibrationRequired'),
                },
            });

            if (required === 1) {
                this.alert('Magneto need calibration', 'danger');

                this.logger.warn(`Magneto need calibration`);
            }
        });

        this.disco.on('HomeTypeChosenChanged', ({ type }) => {
            this.localCache.set('homeTypeChosen', type);

            this.sendPacketToEveryone({
                action: 'home',
                data: {
                    typeChosen: type,
                },
            });

            this.logger.info(`Home type chosen to ${type}`);
        });

        this.disco.on('HomeTypeChanged', ({ type }) => {
            this.localCache.set('homeTypeWanted', type);

            this.sendPacketToEveryone({
                action: 'home',
                data: {
                    typeWanted: type,
                },
            });

            this.logger.info(`Home type wanted changed to ${type}`);
        });

        this.disco.on('SensorsStatesListChanged', ({ sensorName, sensorState }) => {
            const sensorNameToKey = {
                IMU: 'imuState',
                barometer: 'barometerState',
                ultrasound: 'ultrasonicState',
                GPS: 'gpsState',
                magnetometer: 'magnetometerState',
                vertical_camera: 'verticalCameraState',
            };

            const key = sensorNameToKey[sensorName];

            if (!key) {
                this.logger.error(`Got invalid sensor - ${sensorName}`);

                return;
            }

            const state = sensorState === 1;

            this.localCache.set(key, state);

            this.sendPacketToEveryone({
                action: 'health',
                data: {
                    [key]: state,
                },
            });

            if (!state) this.logger.error(`Cannot take off due to sensor state - ${sensorName} = ${sensorState}`);
        });

        this.disco.on('AvailabilityStateChanged', ({ AvailabilityState }) => {
            const canTakeOff = AvailabilityState === 1;

            if (!this.localCache.get('lastHardwareStatus')) {
                this.logger.error(`Can't take off!`);
            } else {
                this.localCache.set('canTakeOff', canTakeOff);

                this.sendPacketToEveryone({
                    action: 'canTakeOff',
                    data: canTakeOff,
                });

                this.sendPacketToEveryone({
                    action: 'state',
                    data: {
                        canTakeOff: canTakeOff,
                    },
                });
            }
        });

        this.disco.on('flyingState', ({ flyingState }) => {
            this.localCache.set('flyingState', flyingState);

            this.sendPacketToEveryone({
                action: 'flyingState',
                data: flyingState,
            });

            this.sendPacketToEveryone({
                action: 'state',
                data: {
                    flyingState: this.localCache.get('flyingState'),
                },
            });

            if (flyingState === 1) this.localCache.set('takeOffAt', Date.now());
            if (flyingState === 4) this.localCache.set('takeOffAt', -1);
        });
    }

    public createTelemetry() {
        this.disco.on('HomeChanged', ({ latitude, longitude, altitude }) => {
            this.localCache.set('homeLatitude', latitude);
            this.localCache.set('homeLongitude', longitude);
            this.localCache.set('homeAltitude', altitude);

            this.sendPacketToEveryone({
                action: 'home',
                data: {
                    latitude,
                    longitude,
                    altitude,
                },
            });

            this.logger.info(`Reporting current home as N${latitude} E${longitude} ${altitude}`);
        });

        this.disco.on('AirSpeedChanged', ({ airSpeed }) => {
            this.sendPacketToEveryone({
                action: 'airspeed',
                data: airSpeed,
            });
        });

        this.disco.on('AltitudeAboveGroundChanged', ({ altitude }) => {
            this.sendPacketToEveryone({
                action: 'groundaltitude',
                data: altitude,
            });
        });

        this.disco.on('GPSFixStateChanged', ({ fixed }) => {
            const isFixed: boolean = fixed === 1;

            this.localCache.set('gpsFixed', isFixed);

            this.sendPacketToEveryone({
                action: 'gps',
                data: {
                    isFixed,
                },
            });
        });

        this.disco.on('NumberOfSatelliteChanged', ({ numberOfSatellite: satellites }) => {
            this.sendPacketToEveryone({
                action: 'gps',
                data: {
                    satellites,
                },
            });
        });

        this.disco.on('BatteryStateChanged', ({ percent }) => {
            this.sendPacketToEveryone({
                action: 'battery',
                data: {
                    percent,
                },
            });
        });

        this.disco.on('MavlinkPlayErrorStateChanged', ({ error }) => {
            this.alert(`MavlinkPlayErrorStateChanged set to ${error}`);

            this.sendPacketToEveryone({
                action: 'event',
                eventId: 'MavlinkPlayErrorStateChanged',
                data: { error },
            });
        });

        this.disco.on('SpeedChanged', ({ speedX, speedY, speedZ }) => {
            const speed = Math.sqrt(Math.pow(speedX, 2) + Math.pow(speedY, 2) + Math.pow(speedZ, 2));

            if (!this.lastSpeedPacket || Date.now() - this.lastSpeedPacket > 1000) {
                this.sendPacketToEveryone({
                    action: 'speed',
                    data: speed,
                });

                this.map.sendSpeed(speed);

                this.lastSpeedPacket = Date.now();
            }
        });

        this.disco.on('AltitudeChanged', ({ altitude }) => {
            this.localCache.set('altitude', altitude);

            if (!this.lastAltitudePacket || Date.now() - this.lastAltitudePacket > 1000) {
                this.sendPacketToEveryone({
                    action: 'altitude',
                    data: altitude,
                });

                this.map.sendAltitude(altitude);

                this.lastAltitudePacket = Date.now();
            }
        });

        this.disco.on('AttitudeChanged', ({ pitch, roll, yaw }) => {
            if (!this.lastAttitudePacket || Date.now() - this.lastAttitudePacket > 1000) {
                const yawDegress = yaw * (180 / Math.PI);
                const pitchDegress = pitch * (180 / Math.PI);
                const rollDegress = roll * (180 / Math.PI);

                this.sendPacketToEveryone({
                    action: 'attitude',
                    data: {
                        pitch: pitchDegress,
                        yaw: yawDegress,
                        roll: rollDegress,
                    },
                });

                this.map.sendYaw(yawDegress);

                this.lastAttitudePacket = Date.now();
            }
        });

        let lastPositionPacket = 0;

        this.disco.on('PositionChanged', ({ latitude: lat, longitude: lon }) => {
            if (!lastPositionPacket || Date.now() - lastPositionPacket > 1000) {
                if (lat !== 0 && lon !== 0) {
                    this.sendPacketToEveryone({
                        action: 'gps',
                        data: {
                            location: {
                                lat,
                                lon,
                            },
                        },
                    });

                    this.map.sendLocation(lat, lon);

                    lastPositionPacket = Date.now();
                }
            }
        });

        this.disco.on('VelocityRange', ({ max_tilt: cameraMaxTiltSpeed, max_pan: cameraMaxPanSpeed }) => {
            this.localCache.set('cameraMaxTiltSpeed', cameraMaxTiltSpeed);
            this.localCache.set('cameraMaxPanSpeed', cameraMaxPanSpeed);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    maxSpeed: {
                        maxTiltSpeed: cameraMaxTiltSpeed,
                        maxPanSpeed: cameraMaxPanSpeed,
                    },
                },
            });
        });

        let lastCameraOrientationPacket = 0;

        this.disco.on('Orientation', ({ tilt, pan }) => {
            if (!lastCameraOrientationPacket || Date.now() - lastCameraOrientationPacket > 1000) {
                this.sendPacketToEveryone({
                    action: 'camera',
                    data: {
                        orientation: {
                            tilt,
                            pan,
                        },
                    },
                });

                lastCameraOrientationPacket = Date.now();
            }
        });

        this.disco.on('defaultCameraOrientation', ({ tilt, pan }) => {
            this.localCache.set('defaultCameraTilt', tilt);
            this.localCache.set('defaultCameraPan', pan);
        });
    }
}
