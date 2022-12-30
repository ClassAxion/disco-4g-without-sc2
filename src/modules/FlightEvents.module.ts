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

        /* TESTING */

        this.disco.on('VideoAutorecordChanged', (data) => {
            this.alert(`VideoAutorecordChanged got ${JSON.stringify(data)}`);

            this.logger.info(`VideoAutorecordChanged to ${JSON.stringify(data)}`);
        });

        this.disco.on('AlertStateChanged', (data) => {
            this.alert(`AlertStateChanged got ${JSON.stringify(data)}`);

            this.logger.info(`AlertStateChanged to ${JSON.stringify(data)}`);
        });

        this.disco.on('VibrationLevelChanged', ({ state }) => {
            this.alert(`VibrationLevelChanged changed to ${state}`);

            this.logger.info(`VibrationLevelChanged to ${state}`);
        });

        this.disco.on('ResetHomeChanged', (data) => {
            this.alert(`ResetHomeChanged to ${JSON.stringify(data)}`);

            this.logger.info(`ResetHomeChanged to ${JSON.stringify(data)}`);
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
            const available = AvailabilityState == 1;

            this.localCache.set('flightPlanAvailability', available);

            this.sendPacketToEveryone({
                action: 'health',
                data: {
                    flightPlanAvailability: available,
                },
            });
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
    }

    public createTelemetry() {
        this.disco.on('VideoStreamModeChanged', ({ mode }) => {
            this.localCache.set('streamMode', mode);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    streamMode: mode,
                },
            });
        });

        this.disco.on('PictureFormatChanged', ({ type }) => {
            this.localCache.set('pictureFormat', type);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    pictureFormat: type,
                },
            });
        });

        this.disco.on('AutoWhiteBalanceChanged', ({ type }) => {
            this.localCache.set('autoWhiteBalance', type);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    autoWhiteBalance: type,
                },
            });
        });

        this.disco.on('ExpositionChanged', ({ value, min, max }) => {
            this.localCache.set('exposition', { value, min, max });

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    exposition: {
                        value,
                        min,
                        max,
                    },
                },
            });
        });

        this.disco.on('SaturationChanged', ({ value, min, max }) => {
            this.localCache.set('saturation', { value, min, max });

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    saturation: {
                        value,
                        min,
                        max,
                    },
                },
            });
        });

        this.disco.on('TimelapseChanged', ({ enabled, interval, minInterval, maxInterval }) => {
            const isEnabled = enabled == 1;

            this.localCache.set('timelapse', { isEnabled, interval, minInterval, maxInterval });

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    timelapse: {
                        isEnabled,
                        interval,
                        minInterval,
                        maxInterval,
                    },
                },
            });
        });

        this.disco.on('VideoStabilizationModeChanged', ({ mode }) => {
            this.localCache.set('videoStabilization', mode);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    videoStabilization: mode,
                },
            });
        });

        this.disco.on('VideoRecordingModeChanged', ({ mode }) => {
            this.localCache.set('videoRecordingMode', mode);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    videoRecordingMode: mode,
                },
            });
        });

        this.disco.on('VideoFramerateChanged', ({ framerate }) => {
            this.localCache.set('videoFramerate', framerate);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    videoFramerate: framerate,
                },
            });
        });

        this.disco.on('VideoResolutionsChanged', ({ type }) => {
            this.localCache.set('videoResolutions', type);

            this.sendPacketToEveryone({
                action: 'camera',
                data: {
                    videoResolutions: type,
                },
            });
        });

        this.disco.on('MinAltitudeChanged', ({ current, min, max }) => {
            this.localCache.set('minAltitude', { current, min, max });

            this.sendPacketToEveryone({
                action: 'geofence',
                data: {
                    minAltitude: { current, min, max },
                },
            });

            this.logger.info(`Set min altitude to ${current}m`);
        });

        this.disco.on('MaxAltitudeChanged', ({ current, min, max }) => {
            this.localCache.set('maxAltitude', { current, min, max });

            this.sendPacketToEveryone({
                action: 'geofence',
                data: {
                    maxAltitude: { current, min, max },
                },
            });

            this.logger.info(`Set max altitude to ${current}m`);
        });

        this.disco.on('NoFlyOverMaxDistanceChanged', ({ shouldNotFlyOver }) => {
            const isEnabled = shouldNotFlyOver == 1;

            this.sendPacketToEveryone({
                action: 'geofence',
                data: {
                    isEnabled,
                },
            });

            this.localCache.set('geofenceEnabled', isEnabled);

            this.logger.info(`Geofence has been ${isEnabled ? 'enabled' : 'disabled'}`);
        });

        this.disco.on('MaxDistanceChanged', ({ current, min, max }) => {
            this.localCache.set('maxDistance', { current, min, max });

            this.sendPacketToEveryone({
                action: 'geofence',
                data: {
                    maxDistance: { current, min, max },
                },
            });

            this.logger.info(`Set max distance to ${current}m`);
        });

        this.disco.on('CirclingRadiusChanged', ({ current, min, max }) => {
            this.localCache.set('circlingRadius', { current, min, max });

            this.sendPacketToEveryone({
                action: 'geofence',
                data: {
                    circlingRadius: { current, min, max },
                },
            });

            this.logger.info(`Set circling radius to ${current}m`);
        });

        this.disco.on('CirclingAltitudeChanged', ({ current, min, max }) => {
            this.localCache.set('circlingAltitude', { current, min, max });

            this.sendPacketToEveryone({
                action: 'geofence',
                data: {
                    circlingAltitude: { current, min, max },
                },
            });

            this.logger.info(`Set circling altitude to ${current}m`);
        });

        this.disco.on('MassStorageInfoStateListChanged', ({ size, used_size }) => {
            this.localCache.set('massStorageSize', size);
            this.localCache.set('massStorageUsedSize', used_size);

            this.sendPacketToEveryone({
                action: 'stats',
                data: {
                    massStorageSize: size,
                    massStorageUsedSize: used_size,
                },
            });
        });

        this.disco.on('MotorFlightsStatusChanged', ({ nbFlights, lastFlightDuration, totalFlightDuration }) => {
            this.localCache.set('nbFlights', nbFlights);
            this.localCache.set('lastFlightDuration', lastFlightDuration);
            this.localCache.set('totalFlightDuration', totalFlightDuration);

            this.sendPacketToEveryone({
                action: 'stats',
                data: {
                    nbFlights,
                    lastFlightDuration,
                    totalFlightDuration,
                },
            });
        });

        this.disco.on('HomeChanged', ({ latitude, longitude, altitude }) => {
            if (latitude == 500 || longitude == 500 || altitude == 500) return;

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
