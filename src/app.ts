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
import FlightStream, { Resolutions } from './modules/FlightStream.module';
import Users from './modules/Users.module';
import FlightEvents from './modules/FlightEvents.module';
import APIServer from './modules/APIServer.module';
import RemoteControl from './modules/RemoteControl.module';

const startWithoutDisco: boolean = !!process.env.NO_DISCO;

const ip = process.env.DISCO_IP || '192.168.42.1';
const streamControlPort = Number(process.env.STREAM_CONTROL_PORT || '55005');
const streamVideoPort = Number(process.env.STREAM_VIDEO_PORT || '55004');
const d2cPort = Number(process.env.D2C_PORT || '9988');
const remoteControlPort = Number(process.env.REMOTE_CONTROL_PORT || '9999');

const disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
    ip,
    streamControlPort,
    streamVideoPort,
    d2cPort,
});

let homeLocation: { latitude: number; longitude: number; altitude: number } | null = null;

if (!!process.env.HOME_LOCATION) {
    const parts = process.env.HOME_LOCATION.split(',').map((e) => Number(e));

    homeLocation = {
        latitude: parts[0],
        longitude: parts[1],
        altitude: parts[2],
    };
}

const streamQuality: string = ['480p', '720p'].includes(process.env.STREAM_QUALITY)
    ? process.env.STREAM_QUALITY
    : '480p';

const discoId: string = process.env.DISCO_ID || Math.random().toString(36).slice(2);

const globalMap = new ParrotDiscoMap(process.env.MAP, logger, discoId, !!process.env.MAP);

const remoteControl = new RemoteControl(remoteControlPort, logger);

let isConnected: boolean = false;

const localCache: FlightCache = new FlightCache({
    gpsFixed: false,
    altitude: 0,
    flyingState: ParrotDiscoFlyingState.LANDED,
    homeLatitude: 0,
    homeLongitude: 0,
    homeAltitude: 0,
    cameraMaxTiltSpeed: 0,
    cameraMaxPanSpeed: 0,
    defaultCameraTilt: 0,
    defaultCameraPan: 0,
    pitotCalibrationRequired: false,
    magnetoCalibrationRequired: false,
    imuState: false,
    barometerState: false,
    ultrasonicState: false,
    gpsState: false,
    magnetometerState: false,
    verticalCameraState: false,
    motorState: true,
    flightPlanAvailability: false,
    homeTypeChosen: 'UNKNOWN',
    homeTypeWanted: 'TAKEOFF',
    takeOffAt: -1,
    nbFlights: 0,
    lastFlightDuration: 0,
    totalFlightDuration: 0,
    massStorageSize: 0,
    massStorageUsedSize: 0,
    maxAltitude: null,
    minAltitude: null,
    maxDistance: null,
    circlingAltitude: null,
    rthAltitude: null,
    geofenceEnabled: false,
    pictureFormat: 'unknown',
    autoWhiteBalance: 'unknown',
    exposition: { value: 0, min: -1.5, max: 1.5 },
    saturation: { value: 0, min: -100, max: 100 },
    timelapse: null,
    videoStabilization: 'unknown',
    videoRecordingMode: 'unknown',
    videoFramerate: 'unknown',
    videoResolutions: 'unknown',
    streamMode: 'unknown',
    returningHome: false,
    isRecording: false,
    canTakePicture: true,
    allowRemoteControl: false,
});

const canTakeOff = () => {
    const calibration = ['pitotCalibrationRequired', 'magnetoCalibrationRequired'];

    for (const key of calibration) {
        if (localCache.get(key)) return false;
    }

    const states = [
        'imuState',
        'barometerState',
        'ultrasonicState',
        'gpsState',
        'motorState',
        'magnetometerState',
        'verticalCameraState',
    ];

    for (const key of states) {
        if (!localCache.get(key)) return false;
    }

    return true;
};

const flightStream: FlightStream = new FlightStream(logger, Resolutions[streamQuality], streamVideoPort);

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

        logger.info(`Setting stream quality to ${streamQuality}`);

        if (streamQuality === '480p') {
            disco.PictureSettings.setVideoResolutions('rec1080_stream480');
        } else if (streamQuality === '720p') {
            disco.PictureSettings.setVideoResolutions('rec720_stream720');
        }

        logger.info(`Enabling video stream..`);

        disco.MediaStreaming.enableVideoStream();

        if (!!homeLocation) {
            logger.info(`Setting home location to N${homeLocation.latitude} E${homeLocation.longitude}`);

            disco.GPSSettings.sendControllerGPS(
                homeLocation.latitude,
                homeLocation.longitude,
                homeLocation.altitude,
                3,
                3,
            );

            disco.GPSSettings.setHomeType(1);
        }

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

const flightEvents = new FlightEvents(disco, sendPacketToEveryone, localCache, logger, globalMap, remoteControl);

flightEvents.createAlerts();
flightEvents.createChecks();
flightEvents.createTelemetry();

let reconneting = false;

disco.on('unknown', (data) => {
    const commandProject = data.readUInt8(0),
        commandClass = data.readUInt8(1),
        commandId = data.readUInt16LE(2);

    if ([136].includes(commandProject)) return;
    if (commandProject === 0 && commandClass === 5 && [11, 12, 13, 14].includes(commandId)) return;
    if (commandProject === 1 && commandClass === 20 && [7, 8, 9].includes(commandId)) return;
    if (commandProject === 0 && commandClass === 17 && [2].includes(commandId)) return;

    logger.warning(`Got unknown command ${commandProject} > ${commandClass} > ${commandId}`);
});

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

            logger.info(`Cancelling return to home..`);

            disco.Piloting.stopReturnToHome();
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

function move(pitch: number | undefined, roll: number | undefined, throttle: number | undefined) {
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

remoteControl.on('move', ({ pitch, roll, throttle }) => {
    if (localCache.get('allowRemoteControl') == true) {
        move(pitch, roll, throttle);
    }
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
                    if (localCache.get('allowRemoteControl') == false) {
                        const { pitch, roll, throttle } = packet.data;

                        move(pitch, roll, throttle);
                    }
                }
            }

            if (permissions.canMoveCamera) {
                if (packet.action && packet.action === 'camera-center') {
                    disco.Camera.moveTo(localCache.get('defaultCameraTilt'), localCache.get('defaultCameraPan'));
                } else if (packet.action && packet.action === 'take-picture') {
                    disco.MediaRecord.takePicture();

                    try {
                        peer.send(
                            JSON.stringify({
                                action: 'alert',
                                data: {
                                    level: 'info',
                                    message: 'Picture taken',
                                },
                            }),
                        );
                    } catch {}
                } else if (packet.action && packet.action === 'record') {
                    if (packet.data === true) {
                        disco.MediaRecord.startRecording();
                    } else {
                        disco.MediaRecord.stopRecording();
                    }
                } else if (packet.action && packet.action === 'camera') {
                    const { type } = packet.data;

                    if (!!type) {
                        if (type === 'absolute') {
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

                    const {
                        pictureFormat,
                        autoWhiteBalance,
                        exposition,
                        saturation,
                        timelapseEnabled,
                        timelapseInterval,
                        videoStabilization,
                        videoRecordingMode,
                        videoFramerate,
                        videoResolutions,
                        streamMode,
                    } = packet.data;

                    if (!!pictureFormat) disco.PictureSettings.setFormat(pictureFormat);
                    if (!!autoWhiteBalance) disco.PictureSettings.setWhiteBalanceMode(autoWhiteBalance);
                    if (!!exposition) disco.PictureSettings.setExposition(exposition);
                    if (!!saturation) disco.PictureSettings.setSaturation(saturation);
                    if (!!timelapseEnabled)
                        disco.PictureSettings.setTimelapse(timelapseEnabled ? 1 : 0, timelapseInterval || 0);
                    if (!!videoStabilization) disco.PictureSettings.setStabilizationMode(videoStabilization);
                    if (!!videoRecordingMode) disco.PictureSettings.setRecordingMode(videoRecordingMode);
                    if (!!videoFramerate) disco.PictureSettings.setVideoFramerate(videoFramerate);
                    if (!!videoResolutions) disco.PictureSettings.setVideoResolutions(videoResolutions);
                    if (!!streamMode) disco.MediaStreaming.setVideoStreamMode(streamMode);
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

                    if (canTakeOff()) {
                        disco.Piloting.userTakeOff();

                        logger.info(`User taking off`);

                        localCache.set('takeOffAt', Date.now());

                        if (!!homeLocation) {
                            logger.info(
                                `Setting home location to N${homeLocation.latitude} E${homeLocation.longitude} (after taking off) in 60 seconds`,
                            );

                            setTimeout(() => {
                                disco.GPSSettings.setHomeType(1);

                                logger.info(`Set home type [trigger after landing]`);
                            }, 60 * 1000);

                            setTimeout(() => {
                                disco.GPSSettings.sendControllerGPS(
                                    homeLocation.latitude,
                                    homeLocation.longitude,
                                    homeLocation.altitude,
                                    3,
                                    3,
                                );

                                logger.info(`Set pilot location [trigger after landing]`);
                            }, 65 * 1000);

                            setTimeout(() => {
                                disco.GPSSettings.setHomeType(1);

                                logger.info(`Set again home type [trigger after landing]`);
                            }, 70 * 1000);
                        }
                    } else {
                        logger.info(`Can't take off`);
                    }
                } else if (packet.action && packet.action === 'land') {
                    logger.info(`Got land command`);

                    disco.Piloting.land();
                } else if (packet.action && packet.action === 'flightPlanStart') {
                    logger.info(`Got flight plan start command`);

                    const name = packet.data;

                    if (canTakeOff() || packet.force === true) {
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
                    const type = packet.data;

                    logger.info(`Started test ${type}`);

                    if (type == 1) {
                        disco.MediaRecord.startRecording();
                    } else if (type == 2) {
                        disco.MediaRecord.stopRecording();
                    } else if (type == 3) {
                        disco.MediaRecord.takePicture();
                    } else if (type == 4) {
                    } else if (type == 5) {
                    }
                } else if (packet.action && packet.action === 'home') {
                    const { typeWanted, latitude, longitude, altitude } = packet.data;

                    if (!!typeWanted) {
                        logger.info(`User want home to ${typeWanted}`);

                        if (typeWanted === 'PILOT') {
                            disco.GPSSettings.setHomeType(1);
                        } else if (typeWanted === 'TAKEOFF') {
                            disco.GPSSettings.setHomeType(0);
                        }

                        localCache.set('homeTypeWanted', typeWanted);
                    }

                    if (!!latitude && !!longitude && !!altitude) {
                        logger.info(`User set home to N${latitude} E${longitude} ${altitude}`);

                        disco.GPSSettings.sendControllerGPS(latitude, longitude, altitude, 3, 3);
                    }
                } else if (packet.action && packet.action === 'geofence') {
                    const { maxAltitude, minAltitude, maxDistance, circlingAltitude, isEnabled, rthAltitude } =
                        packet.data;

                    if (maxAltitude !== undefined) disco.PilotingSettings.setMaxAltitude(maxAltitude);
                    if (minAltitude !== undefined) disco.PilotingSettings.setMinAltitude(minAltitude);
                    if (maxDistance !== undefined) disco.PilotingSettings.setMaxDistance(maxDistance);
                    if (circlingAltitude !== undefined) disco.PilotingSettings.setCirclingAltitude(circlingAltitude);
                    if (isEnabled !== undefined) disco.PilotingSettings.setGeofence(isEnabled ? 1 : 0);
                    if (rthAltitude !== undefined) disco.GPSSettings.setMinAltitude(rthAltitude);
                } else if (packet.action && packet.action === 'autonomous') {
                    const { isEnabled } = packet.data;

                    if (isEnabled !== undefined) {
                        localCache.set('allowRemoteControl', isEnabled);

                        logger.info(
                            isEnabled
                                ? 'External autonomous controller enabled'
                                : 'External autonomous controller disabled',
                        );

                        sendPacketToEveryone({
                            action: 'autonomous',
                            data: {
                                isEnabled,
                            },
                        });
                    }
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
                action: 'camera',
                data: {
                    maxSpeed: {
                        maxTiltSpeed: localCache.get('cameraMaxTiltSpeed'),
                        maxPanSpeed: localCache.get('cameraMaxPanSpeed'),
                    },
                    pictureFormat: localCache.get('pictureFormat'),
                    autoWhiteBalance: localCache.get('autoWhiteBalance'),
                    exposition: localCache.get('exposition'),
                    saturation: localCache.get('saturation'),
                    timelapse: localCache.get('timelapse'),
                    videoStabilization: localCache.get('videoStabilization'),
                    videoRecordingMode: localCache.get('videoRecordingMode'),
                    videoFramerate: localCache.get('videoFramerate'),
                    videoResolutions: localCache.get('videoResolutions'),
                    streamMode: localCache.get('streamMode'),
                    isRecording: localCache.get('isRecording'),
                    canTakePicture: localCache.get('canTakePicture'),
                },
            },
            {
                action: 'health',
                data: {
                    pitotCalibrationRequired: localCache.get('pitotCalibrationRequired'),
                    magnetoCalibrationRequired: localCache.get('magnetoCalibrationRequired'),
                    imuState: localCache.get('imuState'),
                    barometerState: localCache.get('barometerState'),
                    ultrasonicState: localCache.get('ultrasonicState'),
                    gpsState: localCache.get('gpsState'),
                    motorState: localCache.get('motorState'),
                    magnetometerState: localCache.get('magnetometerState'),
                    verticalCameraState: localCache.get('verticalCameraState'),
                    flightPlanAvailability: localCache.get('flightPlanAvailability'),
                },
            },
            {
                action: 'home',
                data: {
                    latitude: localCache.get('homeLatitude'),
                    longitude: localCache.get('homeLongitude'),
                    altitude: localCache.get('homeAltitude'),
                    typeWanted: localCache.get('homeTypeWanted'),
                    typeChosen: localCache.get('homeTypeChosen'),
                },
            },
            {
                action: 'stats',
                data: {
                    nbFlights: localCache.get('nbFlights'),
                    lastFlightDuration: localCache.get('lastFlightDuration'),
                    totalFlightDuration: localCache.get('totalFlightDuration'),
                    massStorageSize: localCache.get('massStorageSize'),
                    massStorageUsedSize: localCache.get('massStorageUsedSize'),
                },
            },
            {
                action: 'geofence',
                data: {
                    maxAltitude: localCache.get('maxAltitude'),
                    minAltitude: localCache.get('minAltitude'),
                    maxDistance: localCache.get('maxDistance'),
                    circlingAltitude: localCache.get('circlingAltitude'),
                    isEnabled: localCache.get('geofenceEnabled'),
                    rthAltitude: localCache.get('rthAltitude'),
                },
            },
            {
                action: 'autonomous',
                data: {
                    isEnabled: localCache.get('allowRemoteControl'),
                },
            },
            {
                action: 'rth',
                data: {
                    inProgress: localCache.get('returningHome'),
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
        logger.info(`Socket ${socket.id} disconnected, peer destroyed.`);

        const permissions = clients.getPermissions(socket.id);

        if (permissions.canPilotingPitch) disco.pilotingData.pitch = 0;
        if (permissions.canPilotingRoll) disco.pilotingData.roll = 0;
        if (permissions.canPilotingThrottle) disco.pilotingData.gaz = 0;

        clearInterval(pingInterval);

        peer.destroy();

        clients.delete(socket.id);
    });
});
