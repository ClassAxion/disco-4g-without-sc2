import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

let disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
});

const localCache: {
    gpsFixed?: boolean;
    altitude?: number;
    flyingState?: ParrotDiscoFlyingState;
    canTakeOff?: boolean;
} = {
    gpsFixed: false,
    altitude: 0,
    flyingState: ParrotDiscoFlyingState.LANDED,
    canTakeOff: false,
};

let videoOutput;

(async () => {
    console.log(`Connecting to drone..`);

    const isConnected: boolean = await disco.connect();

    if (!isConnected) {
        console.error(`Disco not connected!`);

        process.exit(1);
    }

    console.log(`Parrot Disco connected!`);

    console.log(`Enabling video stream..`);

    disco.MediaStreaming.enableVideoStream();

    console.log(`Starting video output to media stream..`);

    videoOutput = await require('wrtc-to-ffmpeg')(wrtc).output({
        kind: 'video',
        width: 856,
        height: 480,
    });

    ffmpeg()
        .input('/home/classaxion/Storage/Repos/disco-4g-without-sc2/stream.sdp')
        .inputOption('-protocol_whitelist file,udp,rtp')
        .output(videoOutput.url)
        .outputOptions(videoOutput.options)
        .on('start', (command) => console.log(`ffmpeg started:`, command))
        .on('error', (error) => console.log(`ffmpeg failed:`, error))
        .run();
})();

const port: number = Number(process.env.PORT || '8000');

const app: Application = express();

const server: Server = app.listen(port, () => console.log(`Server listening on ${port}`));

app.use(express.static(join(__dirname, 'public')));

const io = require('socket.io')(server);

let clients = [];

const sendPacketToEveryone = (packet) => {
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

let lastAltitudePacket = 0;

disco.on('AltitudeChanged', ({ altitude }) => {
    localCache.altitude = altitude;

    if (!lastAltitudePacket || Date.now() - lastAltitudePacket > 250) {
        sendPacketToEveryone({
            action: 'altitude',
            data: altitude,
        });

        lastAltitudePacket = Date.now();
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

    localCache.canTakeOff = canTakeOff;

    sendPacketToEveryone({
        action: 'canTakeOff',
        data: canTakeOff,
    });
});

io.on('connection', async (socket) => {
    console.log(`Connection ${socket.id} made, creating peer..`);

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
                disco.Piloting.takeOff();
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
        console.log(`Peer connected`);

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
                action: 'authorize',
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
        ];

        for (const packet of initialPackets) {
            peer.send(JSON.stringify(packet));
        }
    });

    socket.peer = peer;

    socket.on('signal', (data) => peer.signal(data));

    socket.on('disconnect', function () {
        console.log('Socket disconnected, peer destroyed.');

        clearInterval(pingInterval);

        peer.destroy();

        clients = clients.filter((o) => o.id !== socket.id);
    });
});
