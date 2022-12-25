import express, { Application } from 'express';
import wrtc from 'wrtc';
import { Server as SocketServer } from 'socket.io';
import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';
import logger from './utils/logger';
import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';
import ParrotDiscoMap from './modules/ParrotDiscoMap.module';
import Validation from './modules/Validation.module';
import FlightCache from './modules/FlightCache.module';
import FlightStream, { Resolution, Resolutions } from './modules/FlightStream.module';
import Users from 'modules/Users.module';
import FlightEvents from 'modules/FlightEvents.module';
import APIServer from 'modules/APIServer.module';

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

const discoId: string = process.env.DISCO_ID || Math.random().toString(36).slice(2);

const globalMap = new ParrotDiscoMap(process.env.MAP, logger, discoId, !!process.env.MAP);

let isConnected: boolean = false;

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
    takeOffAt: -1,
});

const flightStream: FlightStream = new FlightStream(logger, Resolutions[streamQuality]);

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

const clients = new Users();

const port: number = Number(process.env.PORT || '8000');

const app: Application = express();

const server: Server = app.listen(port, () => logger.info(`Server listening on ${port}`));

const apiServer = new APIServer(app, clients);
apiServer.init();

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

const flightEvents = new FlightEvents(disco, sendPacketToEveryone, localCache, logger, globalMap);

flightEvents.createAlerts();
flightEvents.createChecks();
flightEvents.createTelemetry();

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
        address,
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

                const takeOffAt: number = localCache.get('takeOffAt');

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

            const isAuthorized = clients.isAuthorized(token);

            if (isAuthorized) {
                const permissions = clients.getPermissionsForToken(token);

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

        const takeOffAt: number = localCache.get('takeOffAt');

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
