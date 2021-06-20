import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';
import fs from 'fs/promises';
import { constants } from 'fs';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

import logger from './utils/logger';
import paths, { Paths } from './utils/paths';

import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

const startWithoutDisco: boolean = !!process.env.NO_DISCO;

let disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
    ip: process.env.DISCO_IP || '192.168.42.1',
});

let isConnected: boolean = false;

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

app.use(express.static(paths[Paths.PUBLIC]));

let isFirstAuthorized = false;

const io = require('socket.io')(server, {
    allowEIO3: true,
});

let clients = [];

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
        action: 'event',
        eventId: 'MavlinkFilePlayingStateChanged',
        data,
    });
});

let lastSpeedPacket = 0;

disco.on('SpeedChanged', ({ speedX, speedY, speedZ }) => {
    const speed = Math.sqrt(Math.pow(speedX, 2) + Math.pow(speedY, 2) + Math.pow(speedZ, 2));

    if (!lastSpeedPacket || Date.now() - lastSpeedPacket > 1000) {
        sendPacketToEveryone({
            action: 'speed',
            data: speed,
        });

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

    if (!reconneting) {
        ffmpegProcess.kill();

        for (const client of clients) {
            client.peer.removeStream(client.socket.stream);
        }

        logger.info(`Disco disconnected, reconnecting..`);

        reconneting = true;

        const isDiscovered: boolean = await disco.discover();

        if (isDiscovered) {
            isConnected = true;

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
            logger.info(`Disco not discover`);
        }

        reconneting = false;
    }

    sendPacketToEveryone({
        action: 'disco-disconnected',
    });

    //process.exit(1);
});

const validateAxis = (value: number): number => {
    if (value > 75) return 75;
    if (value < -75) return -75;

    return value;
};

io.on('connection', async (socket) => {
    const address = socket.handshake.address;

    logger.info(`Connection ${socket.id} made from ${address}, creating peer..`);

    const stream = new wrtc.MediaStream();

    socket.stream = stream;

    socket.authorized = !isFirstAuthorized;

    isFirstAuthorized = true;

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

        if (socket.authorized && !startWithoutDisco) {
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
            } else if (packet.action && packet.action === 'takeOff') {
                logger.info(`Got take off command`);

                if (localCache.canTakeOff) {
                    disco.Piloting.userTakeOff();

                    logger.info(`User taking off`);
                } else {
                    logger.info(`Can't take off`);
                }
            } else if (packet.action && packet.action === 'circle') {
                if (packet.data === 'CCW' || packet.data === 'CW') {
                    disco.Piloting.circle(packet.data);

                    logger.info(`Circling in direction: ${packet.data}`);
                } else {
                    logger.error(`Invalid circle direction: ${packet.data}`);
                }
            } else if (packet.action && packet.action === 'flightPlanStart') {
                logger.info(`Got flight plan start command`);

                const name = packet.data;

                if (localCache.canTakeOff || packet.force === true) {
                    disco.Mavlink.start(name + '.mavlink');

                    logger.info(`User start flight plan`);
                } else {
                    logger.info(`Can't start flight plan`);
                }
            } else if (packet.action && packet.action === 'emergency') {
                if (packet.data === 'landingFlightPlan') {
                    disco.Mavlink.start('land.mavlink');

                    logger.info(`Started landing flight plan`);
                }
            } else if (packet.action && packet.action === 'rth') {
                if (packet.data) {
                    disco.Piloting.returnToHome();

                    logger.info(`Returning to home`);
                } else {
                    disco.Piloting.stopReturnToHome();

                    logger.info(`Return to home cancelled`);
                }
            } else if (packet.action && packet.action === 'move') {
                const { pitch, roll } = packet.data;

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

                if (isMoving === 0) {
                    disco.pilotingData.pitch = 0;
                    disco.pilotingData.roll = 0;
                }

                disco.pilotingData.flag = isMoving;
            }
        }

        if (packet.action === 'pong') {
            peer.send(
                JSON.stringify({
                    action: 'latency',
                    data: Date.now() - packet.data.time,
                }),
            );
        }
    });

    peer.on('connect', () => {
        pingInterval = setInterval(() => {
            peer.send(
                JSON.stringify({
                    action: 'ping',
                    data: {
                        time: Date.now(),
                    },
                }),
            );
        }, 1000);

        peer.addStream(stream);

        const initialPackets = [
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

        if (socket.authorized) {
            initialPackets.unshift({
                action: 'authorize',
                data: undefined,
            });
        }

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
