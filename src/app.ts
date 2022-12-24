import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';
import fs from 'fs/promises';
import { constants } from 'fs';
import { json as parseJSON } from 'body-parser';
import { Server as SocketServer } from 'socket.io';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

import logger from './utils/logger';
import paths, { Paths } from './utils/paths';

import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

import FTP from './modules/FTP.module';
import ParrotDiscoMap from './modules/ParrotDiscoMap.module';
import Validation from './modules/Validation.module';
import FlightCache from './modules/FlightCache.module';
import FlightStream, { Resolution } from './modules/FlightStream.module';
import Users from 'modules/Users.module';
import { User } from 'interfaces/User.interface';
import FlightEvents from 'modules/FlightEvents.module';

const startWithoutDisco: boolean = !!process.env.NO_DISCO;

const disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
    ip: process.env.DISCO_IP || '192.168.42.1',
    streamControlPort: Number(process.env.STREAM_CONTROL_PORT || '55005'),
    streamVideoPort: Number(process.env.STREAM_VIDEO_PORT || '55004'),
    d2cPort: Number(process.env.D2C_PORT || '9988'),
});

const streamQuality: string = ['480p', '720p'].includes(process.env.STREAM_QUALITY)
    ? process.env.STREAM_QUALITY
    : '480p';

const streamQualities: { [key: string]: Resolution } = {
    '480p': { width: 856, height: 480 },
    '720p': { width: 1280, height: 720 },
};

const discoId: string = process.env.DISCO_ID || Math.random().toString(36).slice(2);

const globalMap = !process.env.MAP ? null : new ParrotDiscoMap(process.env.MAP, logger, discoId);

let isConnected: boolean = false;

let takeOffAt: number = -1;

const localCache: FlightCache = new FlightCache({
    gpsFixed: false,
    altitude: 0,
    flyingState: ParrotDiscoFlyingState.LANDED,
    canTakeOff: false,
    cameraMaxTiltSpeed: 0,
    cameraMaxPanSpeed: 0,
    defaultCameraTilt: 0,
    defaultCameraPan: 0,
    lastCalibrationStatus: false,
    lastHardwareStatus: true,
    lastHomeTypeStatus: false,
    lastRTHStatus: false,
});

const flightStream: FlightStream = new FlightStream(logger, streamQualities[streamQuality]);

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

        await flightStream.start();
    })();
} else {
    logger.info(`Starting without disco`);
}

const port: number = Number(process.env.PORT || '8000');

const app: Application = express();

const server: Server = app.listen(port, () => logger.info(`Server listening on ${port}`));

app.use(parseJSON());

const clients = new Users();

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
    const users = clients.getUsers();

    res.json(
        Object.values(users).map((user: User) => ({
            id: user.id,
            ip: user.socket.handshake.address,
            isSuperUser: user.permissions.isSuperUser,
            canPilotingPitch: user.permissions.canPilotingPitch,
            canPilotingRoll: user.permissions.canPilotingRoll,
            canPilotingThrottle: user.permissions.canPilotingThrottle,
            canMoveCamera: user.permissions.canMoveCamera,
            canUseAutonomy: user.permissions.canUseAutonomy,
        })),
    );
});

app.get('/api/user/:id/permissions', (req, res) => {
    const socketId = req.params.id;

    const permissions = clients.getPermissions(socketId);

    if (!permissions) return res.sendStatus(404);

    res.json(permissions);
});

app.get('/api/user/:id/permission/:key/set/:value', (req, res) => {
    const socketId = req.params.id;

    if (!clients.exists(socketId)) return res.sendStatus(404);

    const { key, value } = req.params;

    const isEnabled: boolean = value == '1';

    clients.setPermission(socketId, key, isEnabled);

    const peer = clients.getPeer(socketId);

    peer.send(
        JSON.stringify({
            action: 'permission',
            data: {
                [key]: isEnabled,
            },
        }),
    );

    res.json(clients.getPermissions(socketId));
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

const io = new SocketServer(server, {
    allowEIO3: true,
});

const sendPacketToEveryone = (packet, onlyAuthorized = false) => {
    logger.debug(`Sending packet to everyone: ${JSON.stringify(packet)}`);

    const filteredClients = onlyAuthorized ? clients.getAuthorizedUsers() : clients.getUsers();

    for (const client of Object.values(filteredClients)) {
        try {
            client.peer.send(JSON.stringify(packet));
        } catch {}
    }
};

const flightEvents = new FlightEvents(disco, sendPacketToEveryone, localCache);

flightEvents.createAlerts();
flightEvents.createChecks();
flightEvents.createTelemetry();

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
    if (!sensorState) {
        localCache.set('lastHardwareStatus', false);

        sendPacketToEveryone({
            action: 'check',
            data: {
                lastHardwareStatus: localCache.get('lastHardwareStatus'),
            },
        });

        logger.error(`Cannot take off due to sensor state - ${sensorName}`);
    }
});

let lastAltitudePacket = 0;

disco.on('AltitudeChanged', ({ altitude }) => {
    localCache.set('altitude', altitude);

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
    localCache.set('flyingState', flyingState);

    sendPacketToEveryone({
        action: 'flyingState',
        data: flyingState,
    });

    sendPacketToEveryone({
        action: 'state',
        data: {
            flyingState: localCache.get('flyingState'),
        },
    });

    if (flyingState === 1) takeOffAt = Date.now();
    if (flyingState === 4) takeOffAt = -1;
});

disco.on('AvailabilityStateChanged', ({ AvailabilityState }) => {
    const canTakeOff = AvailabilityState === 1;

    if (!localCache.get('lastHardwareStatus')) {
        logger.error(`Can't take off!`);
    } else {
        localCache.set('canTakeOff', canTakeOff);

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
    localCache.set('cameraMaxTiltSpeed', cameraMaxTiltSpeed);
    localCache.set('cameraMaxPanSpeed', cameraMaxPanSpeed);

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
    localCache.set('defaultCameraTilt', tilt);
    localCache.set('defaultCameraPan', pan);
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
        await flightStream.stop();

        for (const client of Object.values(clients.getUsers())) {
            client.peer.removeStream(client.stream);
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

            await flightStream.start();

            const stream = new wrtc.MediaStream();

            stream.addTrack(flightStream.getOutput().track);

            for (const client of Object.values(clients.getUsers())) {
                client.peer.addStream(stream);
                client.stream = stream;
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

io.on('connection', async (socket) => {
    const address = socket.handshake.address;

    logger.info(`Connection ${socket.id} made from ${address}, creating peer..`);

    const stream = new wrtc.MediaStream();

    if (flightStream.isRunning()) stream.addTrack(flightStream.getOutput().track);

    const peer = new Peer({ initiator: true, wrtc });

    clients.create(
        socket.id,
        '',
        {
            isSuperUser: false,
            canPilotingPitch: false,
            canPilotingRoll: false,
            canPilotingThrottle: false,
            canMoveCamera: false,
            canUseAutonomy: false,
        },
        peer,
        socket,
        stream,
    );

    let pingInterval;

    peer.on('signal', (data) => socket.emit('signal', data));

    peer.on('data', (data) => {
        const packet = JSON.parse(data.toString());

        //console.log(packet);

        const permissions = clients.getPermissions(socket.id);

        if (!startWithoutDisco) {
            if (permissions.canPilotingPitch || permissions.canPilotingRoll || permissions.canPilotingThrottle) {
                if (packet.action && packet.action === 'circle') {
                    if (Validation.isValidCircleDirection(packet.action)) {
                        const direction = Validation.circleDirection(packet.action);

                        disco.Piloting.circle(direction);

                        logger.info(`Circling in direction: ${packet.data}`);
                    } else {
                        logger.error(`Invalid circle direction: ${packet.data}`);
                    }
                } else if (packet.action && packet.action === 'move') {
                    const { pitch, roll, throttle } = packet.data;

                    let isMoving = 0;

                    if (pitch !== undefined) {
                        if (pitch !== 0) {
                            disco.pilotingData.pitch = Validation.axis(pitch);

                            isMoving = 1;
                        } else {
                            disco.pilotingData.pitch = 0;
                        }
                    }

                    if (roll !== undefined) {
                        if (roll !== 0) {
                            disco.pilotingData.roll = Validation.axis(roll);

                            isMoving = 1;
                        } else {
                            disco.pilotingData.roll = 0;
                        }
                    }

                    if (throttle !== undefined) {
                        if (throttle !== 0) {
                            disco.pilotingData.gaz = Validation.axis(throttle);

                            isMoving = 1;
                        } else {
                            disco.pilotingData.gaz = 0;
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

            if (permissions.canMoveCamera) {
                if (packet.action && packet.action === 'camera-center') {
                    disco.Camera.moveTo(localCache.get('defaultCameraTilt'), localCache.get('defaultCameraPan'));
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

            if (permissions.canUseAutonomy) {
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

            if (permissions.isSuperUser) {
                if (packet.action && packet.action === 'takeOff') {
                    logger.info(`Got take off command`);

                    if (localCache.get('canTakeOff')) {
                        disco.Piloting.userTakeOff();

                        logger.info(`User taking off`);
                    } else {
                        logger.info(`Can't take off`);
                    }
                } else if (packet.action && packet.action === 'flightPlanStart') {
                    logger.info(`Got flight plan start command`);

                    const name = packet.data;

                    if (localCache.get('canTakeOff') || packet.force === true) {
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
                            flyingTime: takeOffAt < 0 ? 0 : Date.now() - takeOffAt,
                        },
                    }),
                );
            } catch {}
        } else if (packet.action === 'init') {
            const { token } = packet.data;

            const isAuthorized = ['test', 'letsroll', 'letsroll2'].includes(token);

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

                if (token === 'letsroll2') {
                    permissions = {
                        isSuperUser: false,
                        canPilotingPitch: false,
                        canPilotingRoll: true,
                        canPilotingThrottle: true,
                        canMoveCamera: true,
                        canUseAutonomy: false,
                    };
                }

                clients.setPermissions(socket.id, permissions);
                clients.setAuthorized(socket.id, isAuthorized);

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
                    flyingTime: takeOffAt < 0 ? 0 : Date.now() - takeOffAt,
                    flyingState: localCache.get('flyingState'),
                    canTakeOff: localCache.get('canTakeOff'),
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
                    isFixed: localCache.get('gpsFixed'),
                },
            },
            {
                action: 'altitude',
                data: localCache.get('altitude'),
            },
            {
                action: 'flyingState',
                data: localCache.get('flyingState'),
            },
            {
                action: 'canTakeOff',
                data: localCache.get('canTakeOff'),
            },
            {
                action: 'camera',
                data: {
                    maxSpeed: {
                        maxTiltSpeed: localCache.get('cameraMaxTiltSpeed'),
                        maxPanSpeed: localCache.get('cameraMaxPanSpeed'),
                    },
                },
            },
            {
                action: 'check',
                data: {
                    lastRTHStatus: localCache.get('lastRTHStatus'),
                    lastHomeTypeStatus: localCache.get('lastHomeTypeStatus'),
                    lastCalibrationStatus: localCache.get('lastCalibrationStatus'),
                    lastHardwareStatus: localCache.get('lastHardwareStatus'),
                },
            },
        ];

        logger.debug(`New client connected, sending initial packets: ${JSON.stringify(initialPackets)}`);

        for (const packet of initialPackets) {
            peer.send(JSON.stringify(packet));
        }
    });

    socket.on('signal', (data) => peer.signal(data));

    socket.on('disconnect', () => {
        logger.info('Socket disconnected, peer destroyed.');

        clearInterval(pingInterval);

        peer.destroy();

        clients.delete(socket.id);
    });
});
