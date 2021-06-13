import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';
import winston from 'winston';
import fs from 'fs/promises';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

let disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
    ip: process.env.DISCO_IP || '192.168.42.1',
});

const format = winston.format.combine(
    winston.format.label(),
    winston.format.timestamp(),
    winston.format.printf(({ level, message, _, timestamp }) => `${timestamp} ${level}: ${message}`),
);

const logger = winston.createLogger({
    level: 'info',
    format,
    defaultMeta: { service: 'app' },
    transports: [
        new winston.transports.File({ filename: './error.log', level: 'error' }),
        new winston.transports.File({ filename: './app.log', level: 'debug' }),
        new winston.transports.Console({ format }),
    ],
});

const localCache: {
    gpsFixed?: boolean;
    altitude?: number;
    flyingState?: ParrotDiscoFlyingState;
    canTakeOff?: boolean;
    sensorStates?: { [key: string]: boolean };
} = {
    gpsFixed: false,
    altitude: 0,
    flyingState: ParrotDiscoFlyingState.LANDED,
    canTakeOff: false,
    sensorStates: {},
};

let videoOutput;

(async () => {
    logger.info(`Connecting to drone..`);

    const isConnected: boolean = await disco.connect();

    if (!isConnected) {
        logger.error(`Disco not connected!`);

        process.exit(1);
    }

    logger.info(`Parrot Disco connected!`);

    logger.info(`Enabling video stream..`);

    disco.MediaStreaming.enableVideoStream();

    logger.info(`Starting video output to media stream..`);

    videoOutput = await require('wrtc-to-ffmpeg')(wrtc).output({
        kind: 'video',
        width: 856,
        height: 480,
    });

    ffmpeg()
        .input(join(__dirname, 'stream.sdp'))
        .inputOption('-protocol_whitelist file,udp,rtp')
        .output(videoOutput.url)
        .outputOptions(videoOutput.options)
        .on('start', (command) => logger.debug(`ffmpeg started:`, command))
        .on('error', (error) => logger.error(`ffmpeg failed:`, error))
        .run();
})();

const port: number = Number(process.env.PORT || '8000');

const app: Application = express();

const server: Server = app.listen(port, () => logger.info(`Server listening on ${port}`));

app.get('/flightplans/test', async (req, res) => {
    const file: string = await fs.readFile(join(__dirname, 'flightplans', 'test.mavlink'), 'utf-8');
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
        name: 'test',
        waypoints,
    });
});

app.use(express.static(join(__dirname, 'public')));

const io = require('socket.io')(server);

let clients = [];

const sendPacketToEveryone = (packet) => {
    logger.debug(`Sending packet to everyone: ${JSON.stringify(packet)}`);

    for (const client of clients) {
        try {
            client.peer.send(JSON.stringify(packet));
        } catch {}
    }
};

disco.on('BatteryStateChanged', ({ percent }) => {
    sendPacketToEveryone({
        action: 'battery',
        data: {
            percent: percent,
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

let oldSpeed = 0;

let lastSpeedPacket = 0;

disco.on('SpeedChanged', ({ speedX, speedY, speedZ }) => {
    const speed = Math.sqrt(Math.pow(speedX, 2) + Math.pow(speedY, 2) + Math.pow(speedZ, 2));

    if (!lastSpeedPacket || Date.now() - lastSpeedPacket > 1000) {
        sendPacketToEveryone({
            action: 'speed',
            data: oldSpeed - speed,
        });

        lastSpeedPacket = Date.now();
    }

    oldSpeed = speed;
});

disco.on('SensorsStatesListChanged', ({ sensorName, sensorState }) => {
    localCache.sensorStates[sensorName] = sensorState === 1;
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

disco.on('disconnected', () => {
    logger.info(`Disco disconnected`);

    process.exit(1);
});

let takeOff = false;

io.on('connection', async (socket) => {
    const address = socket.handshake.address;

    logger.info(`Connection ${socket.id} made from ${address}, creating peer..`);

    const stream = new wrtc.MediaStream();

    socket.authorized = true;

    stream.addTrack(videoOutput.track);

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

        if (socket.authorized) {
            if (packet.action && packet.action === 'camera') {
                disco.Camera.move(packet.data.x, packet.data.y);
            } else if (packet.action && packet.action === 'takeOff') {
                logger.info(`Got take off command`);

                if (takeOff) {
                    logger.info(`Can't take off, user already take off`);
                } else if (localCache.canTakeOff) {
                    const startFlightPlan = true;

                    takeOff = true;

                    if (startFlightPlan) {
                        disco.Mavlink.start('/data/ftp/test.mavlink');

                        logger.info(`Starting flight plan`);
                    } else {
                        disco.Piloting.userTakeOff();

                        logger.info(`User taking off`);
                    }
                } else {
                    logger.info(`Can't take off`);
                }
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
        }, 2000);

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
