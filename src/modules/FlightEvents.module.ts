import ParrotDisco from 'parrot-disco-api';
import FlightCache from './FlightCache.module';

export default class FlightEvents {
    private disco: ParrotDisco;
    private sendPacketToEveryone: Function;
    private localCache: FlightCache;

    constructor(disco: ParrotDisco, sendPacketToEveryone: Function, localCache: FlightCache) {
        this.disco = disco;
        this.sendPacketToEveryone = sendPacketToEveryone;
        this.localCache = localCache;
    }

    public createAlerts() {
        this.disco.on('VideoStateChangedV2', ({ state }) => {
            if (state === 'started') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'info',
                        message: 'Recording has been started (V2)',
                    },
                });
            } else if (state === 'stopped') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'info',
                        message: 'Recording has been stopped (V2)',
                    },
                });
            }
        });

        this.disco.on('VideoStateChanged', ({ state }) => {
            if (state === 'started') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'info',
                        message: 'Recording has been started (V2)',
                    },
                });
            } else if (state === 'stopped') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'info',
                        message: 'Recording has been stopped (V2)',
                    },
                });
            }
        });

        this.disco.on('VibrationLevelChanged', ({ state }) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'VibrationLevelChanged changed to ' + state,
            });
        });

        this.disco.on('moveToChanged', ({ status }) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: {
                    level: 'success',
                    message: 'MoveTo got ' + status,
                },
            });
        });

        this.disco.on('MissonItemExecuted', ({ idx }) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'MissonItemExecuted changed to ' + idx,
            });

            this.sendPacketToEveryone({
                action: 'alert',
                data: {
                    level: 'success',
                    message: 'Executed waypoint #' + idx,
                },
            });
        });

        this.disco.on('NavigateHomeStateChanged', (data) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'NavigateHomeStateChanged got ' + JSON.stringify(data),
            });
        });

        this.disco.on('AlertStateChanged', (data) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'AlertStateChanged got ' + JSON.stringify(data),
            });
        });

        this.disco.on('MavlinkFilePlayingStateChanged', (data) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'MavlinkFilePlayingStateChanged to ' + JSON.stringify(data),
            });

            const { state } = data;

            if (state === 'playing') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'success',
                        message: 'Flight plan start confirmed',
                    },
                });
            } else if (state === 'paused') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'info',
                        message: 'Flight plan paused',
                    },
                });
            } else if (state === 'stopped') {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'info',
                        message: 'Flight plan stopped',
                    },
                });
            }
        });

        this.disco.on('HomeChanged', (data) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'HomeChanged to ' + JSON.stringify(data),
            });
        });

        this.disco.on('HomeTypeAvailabilityChanged', (data) => {
            this.sendPacketToEveryone({
                action: 'alert',
                data: 'HomeTypeAvailabilityChanged to ' + JSON.stringify(data),
            });
        });
    }

    public createChecks() {
        this.disco.on('MagnetoCalibrationRequiredState', ({ required }) => {
            this.localCache.set('lastCalibrationStatus', required === 0);

            this.sendPacketToEveryone({
                action: 'check',
                data: {
                    lastCalibrationStatus: this.localCache.get('lastCalibrationStatus'),
                },
            });

            if (required === 1) {
                this.sendPacketToEveryone({
                    action: 'alert',
                    data: {
                        level: 'danger',
                        message: 'Magneto need calibration',
                    },
                });
            }
        });

        this.disco.on('HomeTypeChosenChanged', ({ type }) => {
            const isTakeOff: boolean = type === 'TAKEOFF';

            this.localCache.set('lastRTHStatus', isTakeOff);

            this.sendPacketToEveryone({
                action: 'check',
                data: {
                    lastRTHStatus: this.localCache.get('lastRTHStatus'),
                },
            });

            this.sendPacketToEveryone({
                action: 'alert',
                data: 'HomeTypeChosenChanged got ' + type,
            });
        });

        this.disco.on('HomeTypeChanged', ({ type }) => {
            const isTakeOff: boolean = type === 'TAKEOFF';

            this.localCache.set('lastHomeTypeStatus', isTakeOff);

            this.sendPacketToEveryone({
                action: 'check',
                data: {
                    lastHomeTypeStatus: this.localCache.get('lastHomeTypeStatus'),
                },
            });

            this.sendPacketToEveryone({
                action: 'alert',
                data: 'HomeTypeChanged got ' + type,
            });
        });
    }

    public createTelemetry() {
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

        this.disco.on('MavlinkPlayErrorStateChanged', (data) => {
            this.sendPacketToEveryone({
                action: 'event',
                eventId: 'MavlinkPlayErrorStateChanged',
                data,
            });
        });
    }
}
