import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';
import fs from 'fs/promises';
import { constants } from 'fs';
import { json as parseJSON } from 'body-parser';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

import logger from './utils/logger';
import paths, { Paths } from './utils/paths';

import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

import FTP from './modules/FTP.module';
import ParrotDiscoMap from './modules/ParrotDiscoMap.module';

const startWithoutDisco: boolean = !!process.env.NO_DISCO;

let disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
    ip: process.env.DISCO_IP || '192.168.42.1',
    streamControlPort: Number(process.env.STREAM_CONTROL_PORT || '55005'),
    streamVideoPort: Number(process.env.STREAM_VIDEO_PORT || '55004'),
    d2cPort: Number(process.env.D2C_PORT || '9988'),
});

const discoId: string = process.env.DISCO_ID || Math.random().toString(36).slice(2);

const globalMap = !process.env.MAP ? null : new ParrotDiscoMap(process.env.MAP, logger, discoId);

let isConnected: boolean = false;

let takeOffAt = null;

const localCache: {
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
} = {
    gpsFixed: false,
    altitude: 0,
    flyingState: ParrotDiscoFlyingState.LANDED,
    canTakeOff: false,
    sensorStates: {},
    cameraMaxTiltSpeed: 0,
    cameraMaxPanSpeed: 0,
    defaultCameraTilt: 0,
    defaultCameraPan: 0,
    lastCalibrationStatus: false,
    lastHardwareStatus: true,
    lastHomeTypeStatus: false,
    lastRTHStatus: false,
};

let videoOutput, ffmpegProcess;

const startStream = async () => {
    logger.info(`Starting video output to media stream..`);

    videoOutput = await require('wrtc-to-ffmpeg')(wrtc).output({
        kind: 'video',
        width: 856,
        height: 480,
    });

    ffmpegProcess = ffmpeg()
        .input(paths[Paths.SDP])
        .inputOption('-protocol_whitelist file,udp,rtp')
        .output(videoOutput.url)
        .outputOptions(videoOutput.options)
        .on('start', (command) => logger.debug(`Video bridge started:`, command))
        .on('error', (error) => logger.error(`Video bridge exited:`, error));

    ffmpegProcess.run();
};

/*
(async () => {
    const ftp: FTP = new FTP();

    await ftp.connect();

    console.log(ftp.isConnected());

    console.log(await ftp.list());

    console.log(await ftp.download('flightPlan.mavlink', '../flightplans/flightPlan.mavlink'));

    process.exit();
})();
*/

if (!startWithoutDisco) {
    (async () => {
        logger.info(`Connecting to drone..`);

        isConnected = await disco.connect();

        if (!isConnected) {
            logger.error(`Disco not connected!`);

            process.exit(1);
        }

        logger.info(`Parrot Disco connected!`);

        logger.info(`Enabling video stream..`);

        disco.MediaStreaming.enableVideoStream();

        await startStream();
    })();
} else {
    logger.info(`Starting without disco`);
}

const port: number = Number(process.env.PORT || '8000');

const app: Application = express();

const server: Server = app.listen(port, () => logger.info(`Server listening on ${port}`));

app.use(parseJSON());

let clients = [];

app.post('/api/token/check', (req, res) => {
    const { token } = req.body;

    const isValid: boolean = token === 'test';

    if (isValid) {
        res.status(200).json({ status: true });
    } else {
        res.status(400).json({ status: false });
    }
});

app.get('/api/users', (_, res) => {
    res.json(
        clients.map((client) => ({
            id: client.socket.id,
            ip: client.socket.handshake.address,
            isSuperUser: client.socket.permissions.isSuperUser,
            canPilotingPitch: client.socket.permissions.canPilotingPitch,
            canPilotingRoll: client.socket.permissions.canPilotingRoll,
            canPilotingThrottle: client.socket.permissions.canPilotingThrottle,
            canMoveCamera: client.socket.permissions.canMoveCamera,
            canUseAutonomy: client.socket.permissions.canUseAutonomy,
        })),
    );
});

app.get('/api/user/:id/permissions', (req, res) => {
    const socketId = req.params.id;

    const client = clients.find((client) => client.socket.id === socketId);

    if (!client) return res.sendStatus(404);

    res.json(client.socket.permissions);
});

app.get('/api/user/:id/permission/:key/set/:value', (req, res) => {
    const socketId = req.params.id;

    const client = clients.find((client) => client.socket.id === socketId);

    if (!client) return res.sendStatus(404);

    const { key, value } = req.params;

    const isEnabled: boolean = value == '1';

    client.socket.permissions[key] = isEnabled;

    client.peer.send(
        JSON.stringify({
            action: 'permission',
            data: {
                [key]: isEnabled,
            },
        }),
    );

    res.json(client.socket.permissions);
});

app.get('/flightplans/:name', async (req, res) => {
    const { name } = req.params;

    const flightPlanName: string = name + '.mavlink';

    const flightPlanPath: string = join(paths[Paths.FLIGHT_PLANS], flightPlanName);

    try {
        await fs.access(flightPlanPath, constants.F_OK);
    } catch {
        return res.sendStatus(404);
    }

    const file: string = await fs.readFile(flightPlanPath, 'utf-8');
    const lines = file
        .split(/\r?\n/g)
        .slice(1)
        .filter(Boolean)
        .map((line) => line.split(/\t/g));

    const waypoints = lines.map((o) => ({
        index: Number(o[0]),
        type: Number(o[3]),
        lat: Number(o[8]),
        lon: Number(o[9]),
        alt: Number(o[10]),
    }));

    res.json({
        name,
        waypoints,
    });
});

app.use((_, res) => res.sendStatus(404));

const io = require('socket.io')(server, {
    allowEIO3: true,
});

const sendPacketToEveryone = (packet, onlyUnAuthorized = false) => {
    logger.debug(`Sending packet to everyone: ${JSON.stringify(packet)}`);

    const filteredClients = onlyUnAuthorized ? clients.filter((client) => client.socket.authorized) : clients;

    for (const client of filteredClients) {
        try {
            client.peer.send(JSON.stringify(packet));
        } catch {}
    }
};

disco.on('MagnetoCalibrationRequiredState', ({ required }) => {
    localCache.lastCalibrationStatus = required === 0;

    sendPacketToEveryone({
        action: 'check',
        data: {
            lastCalibrationStatus: localCache.lastCalibrationStatus,
        },
    });

    if (required === 1) {
        sendPacketToEveryone({
            action: 'alert',
            data: {
                level: 'danger',
                message: 'Magneto need calibration',
            },
        });
    }
});

disco.on('VibrationLevelChanged', ({ state }) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'VibrationLevelChanged changed to ' + state,
    });
});

disco.on('AirSpeedChanged', ({ airSpeed }) => {
    sendPacketToEveryone({
        action: 'airspeed',
        data: airSpeed,
    });
});

disco.on('AltitudeAboveGroundChanged', ({ altitude }) => {
    sendPacketToEveryone({
        action: 'groundaltitude',
        data: altitude,
    });
});

disco.on('moveToChanged', ({ status }) => {
    sendPacketToEveryone({
        action: 'alert',
        data: {
            level: 'success',
            message: 'MoveTo got ' + status,
        },
    });
});

disco.on('MissonItemExecuted', ({ idx }) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'MissonItemExecuted changed to ' + idx,
    });

    sendPacketToEveryone({
        action: 'alert',
        data: {
            level: 'success',
            message: 'Executed waypoint #' + idx,
        },
    });
});

disco.on('HomeTypeChanged', ({ type }) => {
    const isTakeOff: boolean = type === 'TAKEOFF';

    localCache.lastHomeTypeStatus = isTakeOff;

    sendPacketToEveryone({
        action: 'check',
        data: {
            lastHomeTypeStatus: localCache.lastHomeTypeStatus,
        },
    });

    sendPacketToEveryone({
        action: 'alert',
        data: 'HomeTypeChanged got ' + type,
    });
});

disco.on('HomeTypeChosenChanged', ({ type }) => {
    const isTakeOff: boolean = type === 'TAKEOFF';

    localCache.lastRTHStatus = isTakeOff;

    sendPacketToEveryone({
        action: 'check',
        data: {
            lastRTHStatus: localCache.lastRTHStatus,
        },
    });

    sendPacketToEveryone({
        action: 'alert',
        data: 'HomeTypeChosenChanged got ' + type,
    });
});

disco.on('NavigateHomeStateChanged', (data) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'NavigateHomeStateChanged got ' + JSON.stringify(data),
    });
});

disco.on('AlertStateChanged', (data) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'AlertStateChanged got ' + JSON.stringify(data),
    });
});

disco.on('BatteryStateChanged', ({ percent }) => {
    sendPacketToEveryone({
        action: 'battery',
        data: {
            percent,
        },
    });
});

disco.on('GPSFixStateChanged', ({ fixed }) => {
    const isFixed: boolean = fixed === 1;

    localCache.gpsFixed = isFixed;

    sendPacketToEveryone({
        action: 'gps',
        data: {
            isFixed,
        },
    });
});

disco.on('MavlinkPlayErrorStateChanged', (data) => {
    sendPacketToEveryone({
        action: 'event',
        eventId: 'MavlinkPlayErrorStateChanged',
        data,
    });
});

disco.on('MavlinkFilePlayingStateChanged', (data) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'MavlinkFilePlayingStateChanged to ' + JSON.stringify(data),
    });

    const { state } = data;

    if (state === 'playing') {
        sendPacketToEveryone({
            action: 'alert',
            data: {
                level: 'success',
                message: 'Flight plan start confirmed',
            },
        });
    } else if (state === 'paused') {
        sendPacketToEveryone({
            action: 'alert',
            data: {
                level: 'info',
                message: 'Flight plan paused',
            },
        });
    } else if (state === 'stopped') {
        sendPacketToEveryone({
            action: 'alert',
            data: {
                level: 'info',
                message: 'Flight plan stopped',
            },
        });
    }
});

let lastSpeedPacket = 0;

disco.on('SpeedChanged', ({ speedX, speedY, speedZ }) => {
    const speed = Math.sqrt(Math.pow(speedX, 2) + Math.pow(speedY, 2) + Math.pow(speedZ, 2));

    if (!lastSpeedPacket || Date.now() - lastSpeedPacket > 1000) {
        sendPacketToEveryone({
            action: 'speed',
            data: speed,
        });

        if (globalMap) {
            globalMap.sendSpeed(speed);
        }

        lastSpeedPacket = Date.now();
    }
});

disco.on('SensorsStatesListChanged', ({ sensorName, sensorState }) => {
    localCache.sensorStates[sensorName] = sensorState === 1;

    if (!sensorState) {
        localCache.lastHardwareStatus = false;

        sendPacketToEveryone({
            action: 'check',
            data: {
                lastHardwareStatus: localCache.lastHardwareStatus,
            },
        });
    }
});

let lastAltitudePacket = 0;

disco.on('AltitudeChanged', ({ altitude }) => {
    localCache.altitude = altitude;

    if (!lastAltitudePacket || Date.now() - lastAltitudePacket > 1000) {
        sendPacketToEveryone({
            action: 'altitude',
            data: altitude,
        });

        if (globalMap) {
            globalMap.sendAltitude(altitude);
        }

        lastAltitudePacket = Date.now();
    }
});

let lastAttitudePacket = 0;

disco.on('AttitudeChanged', ({ pitch, roll, yaw }) => {
    if (!lastAttitudePacket || Date.now() - lastAttitudePacket > 1000) {
        const yawDegress = yaw * (180 / Math.PI);
        const pitchDegress = pitch * (180 / Math.PI);
        const rollDegress = roll * (180 / Math.PI);

        sendPacketToEveryone({
            action: 'attitude',
            data: {
                pitch: pitchDegress,
                yaw: yawDegress,
                roll: rollDegress,
            },
        });

        if (globalMap) {
            globalMap.sendYaw(yawDegress);
        }

        lastAttitudePacket = Date.now();
    }
});

disco.on('NumberOfSatelliteChanged', ({ numberOfSatellite: satellites }) => {
    sendPacketToEveryone({
        action: 'gps',
        data: {
            satellites,
        },
    });
});

let lastPositionPacket = 0;

disco.on('PositionChanged', ({ latitude: lat, longitude: lon }) => {
    if (!lastPositionPacket || Date.now() - lastPositionPacket > 1000) {
        if (lat !== 0 && lon !== 0) {
            sendPacketToEveryone({
                action: 'gps',
                data: {
                    location: {
                        lat,
                        lon,
                    },
                },
            });

            if (globalMap) {
                globalMap.sendLocation(lat, lon);
            }

            lastPositionPacket = Date.now();
        }
    }
});

disco.on('flyingState', ({ flyingState }) => {
    localCache.flyingState = flyingState;

    sendPacketToEveryone({
        action: 'flyingState',
        data: flyingState,
    });

    sendPacketToEveryone({
        action: 'state',
        data: {
            flyingState: localCache.flyingState,
        },
    });

    if (flyingState === 1) takeOffAt = Date.now();
    if (flyingState === 4) takeOffAt = null;
});

disco.on('HomeChanged', (data) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'HomeChanged to ' + JSON.stringify(data),
    });
});

disco.on('HomeTypeAvailabilityChanged', (data) => {
    sendPacketToEveryone({
        action: 'alert',
        data: 'HomeTypeAvailabilityChanged to ' + JSON.stringify(data),
    });
});

disco.on('AvailabilityStateChanged', ({ AvailabilityState }) => {
    const canTakeOff = AvailabilityState === 1;

    if (Object.values(localCache.sensorStates).filter((sensor) => !sensor).length > 0) {
        logger.error(`Can't take off! ${JSON.stringify(localCache.sensorStates)}`);
    } else {
        localCache.canTakeOff = canTakeOff;

        sendPacketToEveryone({
            action: 'canTakeOff',
            data: canTakeOff,
        });

        sendPacketToEveryone({
            action: 'state',
            data: {
                canTakeOff: canTakeOff,
            },
        });
    }
});

disco.on('VelocityRange', ({ max_tilt: cameraMaxTiltSpeed, max_pan: cameraMaxPanSpeed }) => {
    localCache.cameraMaxTiltSpeed = cameraMaxTiltSpeed;
    localCache.cameraMaxPanSpeed = cameraMaxPanSpeed;

    sendPacketToEveryone({
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

disco.on('Orientation', ({ tilt, pan }) => {
    if (!lastCameraOrientationPacket || Date.now() - lastCameraOrientationPacket > 1000) {
        sendPacketToEveryone({
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

disco.on('defaultCameraOrientation', ({ tilt, pan }) => {
    localCache.defaultCameraTilt = tilt;
    localCache.defaultCameraPan = pan;
});

let reconneting = false;

disco.on('disconnected', async () => {
    isConnected = false;

    sendPacketToEveryone({
        action: 'state',
        data: {
            isDiscoConnected: false,
        },
    });

    if (!reconneting) {
        ffmpegProcess.kill();

        for (const client of clients) {
            client.peer.removeStream(client.socket.stream);
        }

        logger.info(`Disco disconnected, reconnecting..`);

        sendPacketToEveryone({
            action: 'alert',
            data: {
                level: 'warning',
                message: 'Disco disconnected, reconnecting..',
            },
        });

        reconneting = true;

        const isDiscovered: boolean = await disco.discover();

        if (isDiscovered) {
            isConnected = true;

            sendPacketToEveryone({
                action: 'state',
                data: {
                    isDiscoConnected: true,
                },
            });

            sendPacketToEveryone({
                action: 'alert',
                data: {
                    level: 'success',
                    message: 'Disco connected',
                },
            });

            logger.info(`Disco discovered again!`);

            logger.info(`Enabling video stream again..`);

            disco.MediaStreaming.enableVideoStream();

            logger.info(`Starting new video stream..`);

            await startStream();

            const stream = new wrtc.MediaStream();

            stream.addTrack(videoOutput.track);

            for (const client of clients) {
                client.peer.addStream(stream);

                client.socket.stream = stream;
            }
        } else {
            logger.info(`Disco not discovered`);

            sendPacketToEveryone({
                action: 'alert',
                data: {
                    level: 'danger',
                    message: 'Disco not discovered',
                },
            });
        }

        reconneting = false;
    }

    //process.exit(1);
});

const validateAxis = (value: number): number => {
    if (value > 75) return 75;
    if (value < -75) return -75;

    return value;
};

const validateThrottle = (value: number): number => {
    if (value > 100) return 100;
    if (value < -100) return -100;

    return value;
};

io.on('connection', async (socket) => {
    const address = socket.handshake.address;

    logger.info(`Connection ${socket.id} made from ${address}, creating peer..`);

    const stream = new wrtc.MediaStream();

    socket.stream = stream;

    socket.permissions = {
        isSuperUser: false,
        canPilotingPitch: false,
        canPilotingRoll: false,
        canPilotingThrottle: false,
        canMoveCamera: false,
        canUseAutonomy: false,
    };

    if (videoOutput) stream.addTrack(videoOutput.track);

    const peer = new Peer({ initiator: true, wrtc });

    clients.push({
        id: socket.id,
        socket,
        peer,
    });

    let pingInterval;

    peer.on('signal', (data) => socket.emit('signal', data));

    peer.on('data', (data) => {
        const packet = JSON.parse(data.toString());

        //console.log(packet);

        if (!startWithoutDisco) {
            if (
                socket.permissions.canPilotingPitch ||
                socket.permissions.canPilotingRoll ||
                socket.permissions.canPilotingThrottle
            ) {
                if (packet.action && packet.action === 'circle') {
                    if (packet.data === 'CCW' || packet.data === 'CW') {
                        disco.Piloting.circle(packet.data);

                        logger.info(`Circling in direction: ${packet.data}`);
                    } else {
                        logger.error(`Invalid circle direction: ${packet.data}`);
                    }
                } else if (packet.action && packet.action === 'move') {
                    const { pitch, roll, throttle } = packet.data;

                    let isMoving = 0;

                    if (pitch !== undefined) {
                        if (pitch !== 0) {
                            disco.pilotingData.pitch = validateAxis(pitch);

                            isMoving = 1;
                        }
                    }

                    if (roll !== undefined) {
                        if (roll !== 0) {
                            disco.pilotingData.roll = validateAxis(roll);

                            isMoving = 1;
                        }
                    }

                    if (throttle !== undefined) {
                        if (throttle !== 0) {
                            disco.pilotingData.gaz = validateThrottle(throttle);

                            isMoving = 1;
                        }
                    }

                    if (isMoving === 0) {
                        disco.pilotingData.pitch = 0;
                        disco.pilotingData.roll = 0;
                        disco.pilotingData.gaz = 0;
                    }

                    disco.pilotingData.flag = isMoving;
                }
            }

            if (socket.permissions.canMoveCamera) {
                if (packet.action && packet.action === 'camera-center') {
                    disco.Camera.moveTo(localCache.defaultCameraTilt, localCache.defaultCameraPan);
                } else if (packet.action && packet.action === 'camera') {
                    if (packet.data.type === 'absolute') {
                        disco.Camera.moveTo(packet.data.tilt, packet.data.pan);
                    } else if (packet.data.type === 'degrees') {
                        disco.Camera.move(packet.data.tilt, packet.data.pan);

                        const { tilt, pan } = packet.data;

                        sendPacketToEveryone(
                            {
                                action: 'camera',
                                data: {
                                    currentSpeed: {
                                        tilt,
                                        pan,
                                    },
                                },
                            },
                            true,
                        );
                    }
                }
            }

            if (socket.permissions.canUseAutonomy) {
                if (packet.action && packet.action === 'rth') {
                    if (packet.data) {
                        disco.Piloting.returnToHome();

                        logger.info(`Returning to home`);

                        try {
                            peer.send(
                                JSON.stringify({
                                    action: 'alert',
                                    data: {
                                        level: 'info',
                                        message: 'Returning to home',
                                    },
                                }),
                            );
                        } catch {}
                    } else {
                        disco.Piloting.stopReturnToHome();

                        logger.info(`Return to home cancelled`);

                        try {
                            peer.send(
                                JSON.stringify({
                                    action: 'alert',
                                    data: {
                                        level: 'warning',
                                        message: 'Returning to home stopped',
                                    },
                                }),
                            );
                        } catch {}
                    }
                }
            }

            if (socket.permissions.isSuperUser) {
                if (packet.action && packet.action === 'takeOff') {
                    logger.info(`Got take off command`);

                    if (localCache.canTakeOff) {
                        disco.Piloting.userTakeOff();

                        logger.info(`User taking off`);
                    } else {
                        logger.info(`Can't take off`);
                    }
                } else if (packet.action && packet.action === 'flightPlanStart') {
                    logger.info(`Got flight plan start command`);

                    const name = packet.data;

                    if (localCache.canTakeOff || packet.force === true) {
                        if (name === 'test') {
                            logger.info(`Flight plan start TESTING`);

                            disco.Piloting.moveTo(53.353077, 17.64584, 80);
                        } else {
                            disco.Mavlink.start(name + '.mavlink');

                            logger.info(`User start flight plan`);

                            try {
                                peer.send(
                                    JSON.stringify({
                                        action: 'alert',
                                        data: {
                                            level: 'success',
                                            message: 'Flight plan started',
                                        },
                                    }),
                                );
                            } catch {}
                        }
                    } else {
                        logger.info(`Can't start flight plan`);

                        try {
                            peer.send(
                                JSON.stringify({
                                    action: 'alert',
                                    data: {
                                        level: 'danger',
                                        message: 'Flight plan failed',
                                    },
                                }),
                            );
                        } catch {}
                    }
                } else if (packet.action && packet.action === 'emergency') {
                    if (packet.data === 'landingFlightPlan') {
                        disco.Mavlink.start('land.mavlink');

                        logger.info(`Started landing flight plan`);
                    }
                } else if (packet.action && packet.action === 'test') {
                    disco.GPSSettings.resetHome();

                    disco.GPSSettings.setHomeLocation(53.34877, 17.64075, 50);

                    disco.GPSSettings.sendControllerGPS(53.34877, 17.64075, 50, 2, 2);

                    disco.GPSSettings.setHomeType(1);
                }
            }
        }

        if (packet.action === 'pong') {
            try {
                peer.send(
                    JSON.stringify({
                        action: 'latency',
                        data: Date.now() - packet.data.time,
                    }),
                );

                peer.send(
                    JSON.stringify({
                        action: 'state',
                        data: {
                            flyingTime: !takeOffAt ? 0 : Date.now() - takeOffAt,
                        },
                    }),
                );
            } catch {}
        } else if (packet.action === 'init') {
            const { token } = packet.data;

            const isAuthorized = ['test', 'letsroll'].includes(token);

            if (isAuthorized) {
                let permissions = {
                    isSuperUser: false,
                    canPilotingPitch: false,
                    canPilotingRoll: false,
                    canPilotingThrottle: false,
                    canMoveCamera: false,
                    canUseAutonomy: false,
                };

                if (token === 'test') {
                    permissions = {
                        isSuperUser: true,
                        canPilotingPitch: true,
                        canPilotingRoll: true,
                        canPilotingThrottle: true,
                        canMoveCamera: true,
                        canUseAutonomy: true,
                    };
                }

                if (token === 'letsroll') {
                    permissions = {
                        isSuperUser: false,
                        canPilotingPitch: false,
                        canPilotingRoll: true,
                        canPilotingThrottle: false,
                        canMoveCamera: true,
                        canUseAutonomy: false,
                    };
                }

                socket.permissions = permissions;

                peer.send(
                    JSON.stringify({
                        action: 'permission',
                        data: permissions,
                    }),
                );

                peer.send(
                    JSON.stringify({
                        action: 'alert',
                        data: {
                            level: 'success',
                            message: 'You got authorized by token',
                        },
                    }),
                );
            }
        }
    });

    peer.on('connect', () => {
        pingInterval = setInterval(() => {
            try {
                peer.send(
                    JSON.stringify({
                        action: 'ping',
                        data: {
                            time: Date.now(),
                        },
                    }),
                );
            } catch {}
        }, 1000);

        peer.addStream(stream);

        const initialPackets = [
            {
                action: 'init',
            },
            {
                action: 'state',
                data: {
                    flyingTime: !takeOffAt ? 0 : Date.now() - takeOffAt,
                    flyingState: localCache.flyingState,
                    canTakeOff: localCache.canTakeOff,
                    isDiscoConnected: isConnected,
                },
            },
            {
                action: 'battery',
                data: {
                    percent: disco.navData.battery,
                },
            },
            {
                action: 'gps',
                data: {
                    isFixed: localCache.gpsFixed,
                },
            },
            {
                action: 'altitude',
                data: localCache.altitude,
            },
            {
                action: 'flyingState',
                data: localCache.flyingState,
            },
            {
                action: 'canTakeOff',
                data: localCache.canTakeOff,
            },
            {
                action: 'camera',
                data: {
                    maxSpeed: {
                        maxTiltSpeed: localCache.cameraMaxTiltSpeed,
                        maxPanSpeed: localCache.cameraMaxPanSpeed,
                    },
                },
            },
            {
                action: 'check',
                data: {
                    lastRTHStatus: localCache.lastRTHStatus,
                    lastHomeTypeStatus: localCache.lastHomeTypeStatus,
                    lastCalibrationStatus: localCache.lastCalibrationStatus,
                    lastHardwareStatus: localCache.lastHardwareStatus,
                },
            },
        ];

        logger.debug(`New client connected, sending initial packets: ${JSON.stringify(initialPackets)}`);

        for (const packet of initialPackets) {
            peer.send(JSON.stringify(packet));
        }
    });

    socket.peer = peer;

    socket.on('signal', (data) => peer.signal(data));

    socket.on('disconnect', () => {
        logger.info('Socket disconnected, peer destroyed.');

        clearInterval(pingInterval);

        peer.destroy();

        clients = clients.filter((o) => o.id !== socket.id);
    });
});
