import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

let disco: ParrotDisco = new ParrotDisco();

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

io.on('connection', async (socket) => {
    console.log(`Connection made, creating peer..`);

    const stream = new wrtc.MediaStream();

    stream.addTrack(videoOutput.track);

    const peer = new Peer({ initiator: true, wrtc });

    peer.on('signal', (data) => socket.emit('signal', data));

    peer.on('data', (data) => {
        data = JSON.parse(data.toString());

        console.log(data);

        if (data.action && data.action === 'camera') {
            disco.Camera.move(data.data.x, data.data.y);
        }
    });

    peer.on('connect', () => {
        console.log(`Peer connected`);

        peer.addStream(stream);
    });

    socket.peer = peer;

    socket.on('signal', (data) => peer.signal(data));

    socket.on('disconnect', function () {
        console.log('Socket disconnected, peer destroyed.');

        peer.destroy();
    });
});
